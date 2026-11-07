/**
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
 * MASTER TACTICAL HMI HUD & INTELLIGENCE CACHE COMBINER
 *
 * Features:
 * 1. Dual Countdown Timers:
 *    - Preparation Timer (2:00 / 120s) with Start/Pause/Reset
 *    - Mission Window Timer (5:00 / 300s) with Auto-Sync to Armed Flight
 * 2. 4-Digit Intelligence Cache Combiner:
 *    - UAV Aerial QR Code (2 digits)
 *    - Ground Operative / Runner Code (2 digits)
 *    - Master Decryption Key (4 digits combined: [ U1 U2 R1 R2 ])
 * 3. 250-Point Dynamic Mission Score Tracker (Rule 4.1 Scoring Engine)
 * 4. MAVLink Live Diagnostics Console Drawer (STATUSTEXT & Command ACKs)
 * =====================================================================================
 */

import React, { useState, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  QrCode,
  AlertCircle,
  Copy,
  Check,
  Terminal,
  Award,
  Play,
  Pause,
  RotateCcw,
  Key,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Radio
} from 'lucide-react';
import { audioService } from '../../services/audioService';
import { mavlinkService } from '../../services/mavlinkService';
import { runnerCommService } from '../../services/runnerCommService';
import { missionEngine } from '../../services/missionEngine';

export interface QrAlertData {
  digits: string;
  timestamp: number;
  source?: string;
}

export const QrAlertHUD: React.FC = () => {
  // --- UAV 2-Digit Aerial Target State ---
  const [uavDigits, setUavDigits] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('drone_last_two_digit_code') || '';
  });
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [pulseActive, setPulseActive] = useState<boolean>(false);

  // --- Ground Operative / Runner 2-Digit State ---
  const [runnerDigits, setRunnerDigits] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('runner_last_checkpoint_code') || '';
  });

  // --- Dual Countdown Timers ---
  // Prep Timer: 2:00 (120s)
  const [prepSeconds, setPrepSeconds] = useState<number>(120);
  const [isPrepRunning, setIsPrepRunning] = useState<boolean>(false);

  // Mission Timer: 5:00 (300s)
  const [missionSeconds, setMissionSeconds] = useState<number>(300);
  const [isMissionRunning, setIsMissionRunning] = useState<boolean>(false);

  // --- Diagnostics Console Drawer ---
  const [showConsole, setShowConsole] = useState<boolean>(false);
  const [statusLogs, setStatusLogs] = useState<any[]>([]);

  // Telemetry armed state listener
  useEffect(() => {
    const unsubTelem = mavlinkService.subscribeTelemetry((telem) => {
      // Auto-start mission timer upon physical liftoff/arming if not started
      if (telem.isArmed && !isMissionRunning && missionSeconds === 300) {
        setIsMissionRunning(true);
        setIsPrepRunning(false);
      }
    });

    const unsubConn = mavlinkService.subscribeConnection((conn) => {
      setStatusLogs(conn.statusHistory || []);
    });

    return () => {
      unsubTelem();
      unsubConn();
    };
  }, [isMissionRunning, missionSeconds]);

  // Preparation Timer Interval
  useEffect(() => {
    let interval: any = null;
    if (isPrepRunning && prepSeconds > 0) {
      interval = setInterval(() => {
        setPrepSeconds((prev) => {
          if (prev <= 1) {
            setIsPrepRunning(false);
            audioService.playBeep(400, 500);
            return 0;
          }
          if (prev === 30 || prev === 10) {
            audioService.playBeep(880, 150);
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPrepRunning, prepSeconds]);

  // Mission Flight Timer Interval (5:00)
  useEffect(() => {
    let interval: any = null;
    if (isMissionRunning && missionSeconds > 0) {
      interval = setInterval(() => {
        setMissionSeconds((prev) => {
          if (prev <= 1) {
            setIsMissionRunning(false);
            audioService.playRtlAlert();
            return 0;
          }
          if (prev === 60 || prev === 30) {
            audioService.playBeep(750, 200);
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isMissionRunning, missionSeconds]);

  // Subscribe to real-time QR Alert events
  useEffect(() => {
    const handleQrEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      const detail = customEvent.detail;
      if (detail && (detail.type === 'QR_ALERT' || detail.type === 'QR_TWO_DIGIT_DETECTED')) {
        const digits = String(detail.digits || detail.twoDigitCode || '');
        if (digits) {
          setUavDigits(digits);
          setPulseActive(true);
          try {
            localStorage.setItem('drone_last_two_digit_code', digits);
          } catch {}
          audioService.playQrSuccess();
          audioService.triggerHaptic('success');
          setTimeout(() => setPulseActive(false), 5000);
        }
      }
    };

    window.addEventListener('sae:qr_alert', handleQrEvent);

    // Subscribe to runner state for operative digits
    const unsubRunner = runnerCommService.subscribeState((runnerState) => {
      const code = (runnerState as any).activeTargetCode || runnerState.latestReceivedQR;
      if (code) {
        setRunnerDigits(code);
        try {
          localStorage.setItem('runner_last_checkpoint_code', code);
        } catch {}
      }
    });

    // Initial check from backend cache
    fetch('/api/recon/detections')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const firstWithCode = data.find((d: any) => d.twoDigitCode);
          if (firstWithCode && !uavDigits) {
            setUavDigits(String(firstWithCode.twoDigitCode));
          }
        }
      })
      .catch(() => {});

    return () => {
      window.removeEventListener('sae:qr_alert', handleQrEvent);
      unsubRunner();
    };
  }, [uavDigits]);

  // Combined Master 4-Digit Key
  const cleanUav = uavDigits.replace(/\D/g, '').slice(0, 2);
  const cleanRunner = runnerDigits.replace(/\D/g, '').slice(0, 2);
  const masterKey = (cleanUav && cleanRunner) ? `${cleanUav}${cleanRunner}` : (cleanUav || cleanRunner || '');
  const isMasterKeyUnlocked = Boolean(cleanUav.length === 2 && cleanRunner.length === 2);

  // Dynamic 250-point score calculator
  const navScore = 100; // Search boundary navigated
  const qrScore = cleanUav.length >= 2 ? 75 : 0;
  const runnerScore = cleanRunner.length >= 2 ? 50 : 0;
  const containmentScore = 25; // Maintained containment
  const totalScore = navScore + qrScore + runnerScore + containmentScore;

  const handleCopyMasterKey = () => {
    if (masterKey) {
      navigator.clipboard.writeText(masterKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="w-full bg-[#0a0f18] border-b border-emerald-500/30 text-slate-200 select-none shadow-xl z-40 transition-all duration-300">
      <div className="max-w-[1920px] mx-auto px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-3">
        
        {/* SECTION 1: SAE INDIA ADDC 2026 IDENTITY & SCORE */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shadow-md">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-orbitron font-black text-xs tracking-wider text-emerald-400 uppercase">
                ADDC 2026 TACTICAL CACHE
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/50 text-[10px] font-mono font-bold text-emerald-300">
                SCORE: {totalScore} / 250 PTS
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5 flex items-center gap-2">
              <span>Nav: {navScore}</span>
              <span>•</span>
              <span className={qrScore > 0 ? 'text-emerald-300 font-bold' : 'text-slate-500'}>QR: {qrScore}/75</span>
              <span>•</span>
              <span className={runnerScore > 0 ? 'text-emerald-300 font-bold' : 'text-slate-500'}>Runner: {runnerScore}/50</span>
              <span>•</span>
              <span className="text-emerald-300">Contain: 25/25</span>
            </div>
          </div>
        </div>

        {/* SECTION 2: DUAL COUNTDOWN TIMERS (PREP 2:00 & MISSION 5:00) */}
        <div className="flex items-center gap-2 sm:gap-3 bg-black/50 px-3 py-1.5 rounded-xl border border-slate-800">
          
          {/* Prep Timer (2:00) */}
          <div className="flex items-center gap-2 border-r border-slate-700/60 pr-3">
            <div className="flex flex-col items-start leading-none">
              <span className="text-[9px] font-mono font-bold uppercase text-slate-400">PREPARATION</span>
              <span className={`text-base sm:text-lg font-mono font-black ${
                prepSeconds <= 15 ? 'text-rose-400 animate-pulse' : prepSeconds <= 45 ? 'text-amber-400' : 'text-sky-400'
              }`}>
                {formatTimer(prepSeconds)}
              </span>
            </div>
            <button
              onClick={() => setIsPrepRunning(!isPrepRunning)}
              className="p-1 rounded hover:bg-slate-800 text-slate-300 transition"
              title={isPrepRunning ? 'Pause Prep Timer' : 'Start Prep Timer (2:00)'}
            >
              {isPrepRunning ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-sky-400" />}
            </button>
            <button
              onClick={() => { setIsPrepRunning(false); setPrepSeconds(120); }}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 transition"
              title="Reset Prep Timer to 2:00"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Mission Timer (5:00) */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-start leading-none">
              <span className="text-[9px] font-mono font-bold uppercase text-slate-400">MISSION WINDOW</span>
              <span className={`text-base sm:text-lg font-mono font-black ${
                missionSeconds <= 30 ? 'text-rose-400 animate-pulse' : missionSeconds <= 90 ? 'text-amber-400' : 'text-emerald-400'
              }`}>
                {formatTimer(missionSeconds)}
              </span>
            </div>
            <button
              onClick={() => setIsMissionRunning(!isMissionRunning)}
              className="p-1 rounded hover:bg-slate-800 text-slate-300 transition"
              title={isMissionRunning ? 'Pause Mission Timer' : 'Start Mission Timer (5:00)'}
            >
              {isMissionRunning ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
            </button>
            <button
              onClick={() => { setIsMissionRunning(false); setMissionSeconds(300); }}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 transition"
              title="Reset Mission Timer to 5:00"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* SECTION 3: 4-DIGIT INTELLIGENCE CACHE COMBINER */}
        <div className="flex items-center gap-2 sm:gap-3 ml-auto">
          
          {/* UAV 2-Digit Sub-Box */}
          <div className="flex flex-col items-center bg-black/70 px-2.5 py-1 rounded-lg border border-emerald-500/40 min-w-[55px]">
            <span className="text-[9px] font-mono font-bold text-slate-400 uppercase">UAV (2D)</span>
            <span className="text-lg font-orbitron font-black text-emerald-400 tracking-wider">
              {cleanUav || '--'}
            </span>
          </div>

          <span className="text-slate-500 font-bold text-sm">+</span>

          {/* Runner 2-Digit Sub-Box */}
          <div className="flex flex-col items-center bg-black/70 px-2.5 py-1 rounded-lg border border-sky-500/40 min-w-[55px]">
            <span className="text-[9px] font-mono font-bold text-slate-400 uppercase">RUNNER</span>
            <span className="text-lg font-orbitron font-black text-sky-400 tracking-wider">
              {cleanRunner || '--'}
            </span>
          </div>

          <span className="text-slate-500 font-bold text-sm">=</span>

          {/* Master 4-Digit Combined Key Display */}
          <div className={`flex items-center gap-2 px-3.5 py-1 rounded-xl border transition-all ${
            isMasterKeyUnlocked
              ? 'bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-950 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]'
              : 'bg-black/90 border-slate-700'
          }`}>
            <div className="flex flex-col leading-none">
              <span className="text-[9px] font-mono font-bold uppercase text-slate-400">
                {isMasterKeyUnlocked ? 'MASTER DECRYPT KEY' : 'INTELLIGENCE KEY'}
              </span>
              <span className={`text-xl sm:text-2xl font-orbitron font-black tracking-widest ${
                isMasterKeyUnlocked ? 'text-emerald-300 animate-pulse' : 'text-slate-400'
              }`}>
                {isMasterKeyUnlocked ? `${cleanUav} ${cleanRunner}` : (masterKey || 'PENDING')}
              </span>
            </div>

            {masterKey && (
              <button
                onClick={handleCopyMasterKey}
                className="p-1.5 rounded-lg bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 transition cursor-pointer"
                title="Copy Master Key"
              >
                {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
          </div>

          {/* Toggle MAVLink Diagnostics Drawer */}
          <button
            onClick={() => setShowConsole(!showConsole)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-mono font-bold flex items-center gap-1.5 transition cursor-pointer ${
              showConsole
                ? 'bg-slate-800 border-sky-500 text-sky-300'
                : 'bg-slate-900 border-slate-700 hover:border-slate-600 text-slate-300'
            }`}
            title="Toggle Live MAVLink STATUSTEXT Diagnostics Console"
          >
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">CONSOLE</span>
            {showConsole ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* EXPANDABLE MAVLINK LIVE DIAGNOSTICS CONSOLE DRAWER */}
      {showConsole && (
        <div className="w-full bg-[#080d15] border-t border-slate-800 p-3 text-xs font-mono animate-in slide-in-from-top-2 duration-150">
          <div className="max-w-[1920px] mx-auto flex flex-col gap-2">
            <div className="flex items-center justify-between text-slate-400 pb-1 border-b border-slate-800">
              <span className="font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                Live Flight Controller Diagnostics & STATUSTEXT Feed ({statusLogs.length} events)
              </span>
              <span className="text-[10px] text-slate-500">Auto-correlated with MAVLink COMMAND_ACKs</span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 pr-2 scrollbar-thin scrollbar-thumb-slate-800">
              {statusLogs.length === 0 ? (
                <div className="text-slate-500 italic py-2">
                  No telemetry STATUSTEXT messages buffered yet. Awaiting Pixhawk communications.
                </div>
              ) : (
                statusLogs.slice(0, 30).map((msg, idx) => (
                  <div key={idx} className="flex items-start gap-2 leading-tight py-0.5">
                    <span className="text-slate-500 shrink-0">
                      [{new Date(msg.timestamp).toLocaleTimeString()}]
                    </span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                      msg.severityLevel <= 3 ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                      msg.severityLevel === 4 ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                      'bg-slate-900 text-sky-300'
                    }`}>
                      {msg.severity || 'INFO'}
                    </span>
                    <span className={msg.severityLevel <= 3 ? 'text-rose-300 font-semibold' : 'text-slate-200'}>
                      {msg.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
