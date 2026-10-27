import React, { useEffect, useState, useRef } from 'react';
import { RunnerLinkState, DroneQRDispatchPayload } from '../../types/runner';
import { MissionState } from '../../types/mission';
import { QRDetectionRecord } from '../../types/recon';
import { runnerCommService } from '../../services/runnerCommService';
import { reconDetectionService } from '../../services/reconDetectionService';
import { missionEngine } from '../../services/missionEngine';
import { audioService } from '../../services/audioService';
import { AckProtocolCard } from './AckProtocolCard';
import { 
  CheckCircle2, 
  Clock, 
  Radio, 
  Wifi, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MapPin,
  Calendar,
  ShieldCheck,
  RotateCcw,
  Navigation,
  Copy,
  ExternalLink,
  Compass
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface RunnerDashboardProps {
  runnerLink: RunnerLinkState;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  className?: string;
}

export const RunnerDashboard: React.FC<RunnerDashboardProps> = ({
  runnerLink,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  className = '',
}) => {
  const [receivedCode, setReceivedCode] = useState<string | null>(runnerLink.latestReceivedQR || null);
  const [latestRecord, setLatestRecord] = useState<Partial<DroneQRDispatchPayload> | QRDetectionRecord | null>(null);
  const [ackDispatched, setAckDispatched] = useState<boolean>(false);
  const [receiptTimestamp, setReceiptTimestamp] = useState<number | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [runnerGps, setRunnerGps] = useState<{ lat: number; lon: number } | null>(null);
  const [copiedCoords, setCopiedCoords] = useState<boolean>(false);

  // Watch Runner's phone GPS for live intercept tracking
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setRunnerGps({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          });
        },
        (err) => {
          console.warn('[RUNNER_GPS] Watch error:', err.message);
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, []);

  // Deduplication lock to prevent duplicate sound alerts or timer interruptions
  const lastProcessedIdRef = useRef<string | null>(null);

  // 1. Direct wireless P2P packets from Drone Core via BroadcastChannel / LocalStorage
  useEffect(() => {
    const unsubscribe = runnerCommService.subscribeMessages((msg) => {
      if (msg.type === 'QR_DISPATCH') {
        const dispatch = msg as DroneQRDispatchPayload;
        const eventId = dispatch.detectionId || dispatch.messageId;

        if (eventId && eventId === lastProcessedIdRef.current) {
          return; // Suppress duplicate packet processing
        }
        lastProcessedIdRef.current = eventId;

        setReceivedCode(dispatch.qrCode);
        setLatestRecord(dispatch);
        setReceiptTimestamp(dispatch.timestamp || Date.now());

        // Celebratory visual & audio confirmation
        try {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.6 }
          });
        } catch (e) {}

        // Immediate automatic acknowledgment back to Drone Core
        runnerCommService.sendAckToDrone(
          dispatch.qrCode,
          dispatch.messageId,
          dispatch.missionId,
          96
        );
        setAckDispatched(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 2. Synchronize with ReconDetectionService (WebSockets & REST Relay)
  useEffect(() => {
    const unsubRecon = reconDetectionService.subscribeDetections((list, latest) => {
      if (latest && (latest.twoDigitCode || (latest.payload && latest.payload.trim().length > 0))) {
        if (latest.detectionId !== lastProcessedIdRef.current) {
          lastProcessedIdRef.current = latest.detectionId;
          const displayCode = latest.twoDigitCode || latest.payload || '';
          setReceivedCode(displayCode);
          setLatestRecord(latest);
          setReceiptTimestamp(latest.timestamp || Date.now());
          setAckDispatched(true);
          audioService.playRunnerAck();
          audioService.triggerHaptic('success');
        }
      }
    });

    // 3. Fallback network poll in case Runner is on separate network / initial load
    const pollInterval = setInterval(async () => {
      if (typeof window === 'undefined') return;
      try {
        const res = await fetch('/api/recon/detections/latest');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.detection && (data.detection.twoDigitCode || data.detection.payload)) {
            const det = data.detection as QRDetectionRecord;
            if (det.detectionId !== lastProcessedIdRef.current) {
              lastProcessedIdRef.current = det.detectionId;
              const displayCode = det.twoDigitCode || det.payload || '';
              setReceivedCode(displayCode);
              setLatestRecord(det);
              setReceiptTimestamp(det.timestamp || Date.now());
              setAckDispatched(true);
              audioService.playRunnerAck();
              audioService.triggerHaptic('success');
            }
          }
        }
      } catch (e) {
        // network silent retry
      }
    }, 2000);

    return () => {
      unsubRecon();
      clearInterval(pollInterval);
    };
  }, []);

  const totalDuration = missionEngine.getMissionDurationSeconds() || 300;
  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const isCritical = remainingSeconds <= Math.min(45, Math.max(15, Math.floor(totalDuration * 0.25))) && remainingSeconds > 0;
  const isWarning = remainingSeconds > Math.min(45, Math.max(15, Math.floor(totalDuration * 0.25))) && remainingSeconds <= Math.min(90, Math.max(30, Math.floor(totalDuration * 0.5)));
  const isComplete = missionState === 'MISSION_COMPLETE';
  const isExpired = remainingSeconds === 0;

  const isConnected = runnerLink.isConnected;

  const targetLat: number | null = (latestRecord as any)?.estimatedTargetLocation?.targetLatitude ?? (latestRecord as any)?.targetLatitude ?? (latestRecord as any)?.droneLatitude ?? null;
  const targetLon: number | null = (latestRecord as any)?.estimatedTargetLocation?.targetLongitude ?? (latestRecord as any)?.targetLongitude ?? (latestRecord as any)?.droneLongitude ?? null;
  const snapshotUrl: string | null = (latestRecord as any)?.photoDataUrl ?? (latestRecord as any)?.thumbnailDataUrl ?? null;

  const calculateDistanceAndBearing = () => {
    if (!runnerGps || targetLat === null || targetLon === null) return null;
    const R = 6371000;
    const dLat = ((targetLat - runnerGps.lat) * Math.PI) / 180;
    const dLon = ((targetLon - runnerGps.lon) * Math.PI) / 180;
    const lat1 = (runnerGps.lat * Math.PI) / 180;
    const lat2 = (targetLat * Math.PI) / 180;

    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distMeters = Math.round(R * c);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearingDeg = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);

    return { distMeters, bearingDeg };
  };
  const intercept = calculateDistanceAndBearing();

  return (
    <div className={`p-3 sm:p-5 max-w-6xl mx-auto space-y-4 sm:space-y-5 font-mono ${className}`}>
      {/* 1. TOP BANNER: Minimal Field Unit Status Bar */}
      <div className="bg-slate-900/90 p-3 sm:p-4 rounded-xl border border-slate-800 hud-border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-lg">
        <div>
          <div className="text-[10px] sm:text-[11px] text-slate-400 font-bold uppercase tracking-wider">
            RUNNER ANDROID FIELD UNIT
          </div>
          <div className="text-sm sm:text-base font-black text-slate-100 mt-0.5 flex items-center space-x-2">
            <span>RUNNER STATUS:</span>
            {isConnected ? (
              <span className="text-emerald-400 flex items-center space-x-1 font-extrabold">
                <CheckCircle2 className="w-4 h-4" />
                <span>LINK ACTIVE ✓</span>
              </span>
            ) : (
              <span className="text-rose-400 flex items-center space-x-1 font-extrabold animate-pulse">
                <AlertTriangle className="w-4 h-4" />
                <span>LINK DISCONNECTED</span>
              </span>
            )}
          </div>
        </div>

        {/* Wireless Link Status Info */}
        <div className="flex items-center space-x-2 text-xs self-start sm:self-auto">
          <div className="bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 text-slate-300 flex items-center space-x-1.5">
            <Wifi className={`w-3.5 h-3.5 ${isConnected ? 'text-sky-400' : 'text-slate-500'}`} />
            <span>P2P Direct ({runnerLink.signalStrengthDbm} dBm)</span>
          </div>
          <div className="bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-emerald-400 font-bold text-xs">
            ~12m Proximity
          </div>
        </div>
      </div>

      {/* Disconnection Warning Banner if link is lost */}
      {!isConnected && (
        <div className="bg-rose-950/80 border border-rose-500/80 text-rose-200 px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-lg animate-pulse">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>WIRELESS LINK LOST: Direct drone telemetry interrupted. Awaiting signal recovery...</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* 2. DUAL HERO CARDS: OFFICIAL TIMER & DECODED QR DATA         */}
      {/* High contrast, glanceable at distance across all devices     */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* HERO CARD 1: OFFICIAL MISSION WINDOW TIMER */}
        <div className={`p-5 sm:p-7 rounded-2xl border-2 flex flex-col justify-between text-center transition-all ${
          isComplete
            ? 'bg-gradient-to-b from-slate-900 via-emerald-950/30 to-slate-900 border-emerald-500 shadow-xl'
            : isExpired
            ? 'bg-gradient-to-b from-slate-900 via-rose-950/40 to-slate-900 border-rose-500 shadow-xl animate-pulse'
            : isCritical
            ? 'bg-gradient-to-b from-slate-900 via-rose-950/30 to-slate-900 border-rose-500/70 shadow-xl'
            : isWarning
            ? 'bg-gradient-to-b from-slate-900 via-amber-950/30 to-slate-900 border-amber-500/60 shadow-xl'
            : 'bg-slate-900/90 border-sky-500/40 shadow-xl'
        }`}>
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <span className="text-[11px] sm:text-xs font-black uppercase tracking-widest text-slate-400">
                OFFICIAL MISSION WINDOW
              </span>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full border bg-slate-950 border-slate-700 text-slate-300">
                MAX {totalDuration}s
              </span>
            </div>

            <div className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-400 mb-1">
              REMAINING TIME
            </div>

            {/* Prominent REMAINING TIME Countdown */}
            <div className="py-4 sm:py-6">
              <div className={`text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-black tracking-widest leading-none ${
                isComplete
                  ? 'text-emerald-400'
                  : isExpired
                  ? 'text-rose-500'
                  : isCritical
                  ? 'text-rose-400 animate-pulse'
                  : isWarning
                  ? 'text-amber-400'
                  : 'text-white'
              }`}>
                {formatTime(remainingSeconds)}
              </div>

              <div className="text-xs sm:text-sm font-bold text-slate-400 mt-2 flex items-center justify-center space-x-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>ELAPSED: +{formatTime(elapsedSeconds)}</span>
              </div>
            </div>
          </div>

          {/* Time Progress Bar & Footer */}
          <div className="space-y-2 mt-3">
            <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-1000 ${
                  isCritical ? 'bg-rose-500' : isWarning ? 'bg-amber-500' : isComplete ? 'bg-emerald-500' : 'bg-sky-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, (remainingSeconds / totalDuration) * 100))}%` }}
              />
            </div>

            <div className="text-[11px] text-slate-400 font-bold flex items-center justify-center space-x-1">
              {isCritical && !isComplete && (
                <span className="text-rose-400 flex items-center space-x-1 animate-pulse">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>CRITICAL: Safe RTL Standby</span>
                </span>
              )}
              {isComplete && (
                <span className="text-emerald-400 flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>MISSION COMPLETED IN TIME</span>
                </span>
              )}
              {!isCritical && !isComplete && (
                <span className="text-sky-400">COUNTDOWN SYNCHRONIZED WITH DRONE & GCS</span>
              )}
            </div>
          </div>
        </div>

        {/* HERO CARD 2: DECODED QR DATA RECEIVED FROM DRONE CORE */}
        <div className={`p-5 sm:p-7 rounded-2xl border-2 flex flex-col justify-between text-center transition-all ${
          receivedCode
            ? 'bg-gradient-to-b from-slate-900 via-emerald-950/40 to-slate-900 border-emerald-500 shadow-2xl shadow-emerald-500/20'
            : 'bg-slate-900/90 border-slate-800 shadow-xl'
        }`}>
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <span className="text-[11px] sm:text-xs font-black uppercase tracking-widest text-slate-400">
                DRONE CORE RECON INTEL
              </span>
              <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                receivedCode
                  ? 'bg-emerald-950 border-emerald-400 text-emerald-300 animate-pulse'
                  : 'bg-slate-950 border-slate-700 text-sky-400'
              }`}>
                {receivedCode ? 'LOCK CONFIRMED' : 'SEARCHING'}
              </span>
            </div>

            <div className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-400 mb-1">
              DECODED QR PAYLOAD
            </div>

            {/* Prominent Decoded QR Data Display */}
            <div className="py-4 sm:py-6">
              {receivedCode ? (
                <div className="space-y-2">
                  <div className="text-5xl sm:text-6xl md:text-7xl font-black text-white tracking-wider leading-none drop-shadow-[0_10px_25px_rgba(16,185,129,0.6)] break-all px-2">
                    {receivedCode}
                  </div>
                  {receiptTimestamp && (
                    <div className="text-[11px] text-slate-400 font-mono mt-1">
                      Received at {new Date(receiptTimestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-5xl sm:text-6xl md:text-7xl font-black text-slate-600 tracking-widest leading-none animate-pulse">
                    ---
                  </div>
                  <div className="text-xs sm:text-sm text-slate-400 font-bold flex items-center justify-center space-x-1.5 mt-2">
                    <Radio className="w-4 h-4 text-sky-400 animate-spin" />
                    <span>AWAITING AIRBORNE QR LOCK</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* QR Footer Status & Telemetry Metadata */}
          <div className="mt-3 space-y-2">
            {receivedCode ? (
              <div className="space-y-2">
                <div className="bg-emerald-950/80 border border-emerald-500/80 p-3 rounded-xl text-emerald-200 text-xs sm:text-sm font-extrabold flex items-center justify-center space-x-2 shadow-md">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>RECEIVED & AUTO-ACKNOWLEDGED</span>
                </div>

                {/* Additional Detection Metadata (GPS & RTL confirmation) */}
                {latestRecord && (
                  <div className="bg-black/50 p-2 rounded-lg border border-slate-800 text-[10px] text-slate-300 grid grid-cols-2 gap-2 text-left">
                    <div>
                      <span className="text-slate-500 block">PIXHAWK CAPTURE GPS</span>
                      <span className="font-semibold text-slate-200">
                        {'droneLatitude' in latestRecord && latestRecord.droneLatitude && latestRecord.gpsFixValid
                          ? `${latestRecord.droneLatitude.toFixed(6)}°, ${latestRecord.droneLongitude?.toFixed(6)}°`
                          : 'GPS Sync Standby'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">FLIGHT CONTROLLER STATUS</span>
                      <span className="font-semibold text-amber-300 flex items-center gap-1">
                        <RotateCcw className="w-3 h-3 text-amber-400" />
                        <span>{'rtlInitiated' in latestRecord && latestRecord.rtlInitiated ? 'RTL AUTO-TRIGGERED' : 'CRUISING'}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-xl text-slate-400 text-xs flex items-center justify-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                <span>QR data appears automatically upon Drone Core recognition</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2.5 TARGET INTERCEPT CARD (High-contrast real-time navigation) */}
      {/* ============================================================ */}
      {receivedCode && (
        <div className="bg-gradient-to-r from-slate-900 via-emerald-950/60 to-slate-900 p-4 sm:p-6 rounded-2xl border-2 border-emerald-400 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-emerald-500/30 pb-3">
            <div className="flex items-center space-x-2">
              <span className="p-2 bg-emerald-500/20 rounded-xl text-emerald-400">
                <Navigation className="w-5 h-5 animate-pulse" />
              </span>
              <div>
                <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <span>TARGET INTERCEPT CARD</span>
                  <span className="text-[10px] bg-emerald-500 text-slate-950 font-black px-2 py-0.5 rounded-full uppercase">
                    LIVE
                  </span>
                </h3>
                <p className="text-xs text-slate-400">Ground recovery navigation vector for Runner field unit</p>
              </div>
            </div>

            {/* Decoded QR Code Payload Badge */}
            <div className="bg-emerald-950 border-2 border-emerald-400 text-emerald-300 font-black text-xl sm:text-2xl px-4 py-1.5 rounded-xl text-center shadow-lg">
              {receivedCode}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Snapshot Preview with Bounding Box Overlay */}
            <div className="relative bg-slate-950 rounded-xl border border-slate-800 overflow-hidden min-h-[180px] flex items-center justify-center">
              {snapshotUrl ? (
                <div className="relative w-full h-full max-h-56">
                  <img
                    src={snapshotUrl}
                    alt="Target Snapshot"
                    className="w-full h-full object-contain rounded-lg"
                  />
                  <div className="absolute inset-4 border-2 border-emerald-400 pointer-events-none rounded animate-pulse" />
                  <span className="absolute bottom-2 left-2 text-[10px] bg-black/80 px-2 py-0.5 rounded text-emerald-400 font-mono">
                    Airborne Capture Snapshot
                  </span>
                </div>
              ) : (
                <div className="text-center p-6 text-slate-500 text-xs">
                  <MapPin className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                  <span>No thumbnail attached to detection packet</span>
                </div>
              )}
            </div>

            {/* Target Coordinates & Navigation Actions */}
            <div className="flex flex-col justify-between space-y-3">
              <div className="bg-slate-950/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                <div className="text-xs text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
                  <span>EXACT TARGET GPS</span>
                  {targetLat !== null && targetLon !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== 'undefined' && navigator.clipboard) {
                          navigator.clipboard.writeText(`${targetLat.toFixed(7)}, ${targetLon.toFixed(7)}`);
                          setCopiedCoords(true);
                          setTimeout(() => setCopiedCoords(false), 2000);
                        }
                      }}
                      className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center space-x-1 cursor-pointer font-bold"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedCoords ? 'COPIED!' : 'COPY'}</span>
                    </button>
                  )}
                </div>

                <div className="font-mono text-lg sm:text-xl font-black text-emerald-300">
                  {targetLat !== null && targetLon !== null
                    ? `${targetLat.toFixed(6)}°, ${targetLon.toFixed(6)}°`
                    : 'Awaiting Target Georeference...'}
                </div>

                {/* Distance & Bearing Vector */}
                {intercept ? (
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[10px]">DISTANCE TO TARGET</span>
                      <span className="text-sm font-bold text-white flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{intercept.distMeters} meters</span>
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">BEARING / COMPASS</span>
                      <span className="text-sm font-bold text-sky-400 flex items-center gap-1">
                        <Compass className="w-3.5 h-3.5 text-sky-400" />
                        <span>{intercept.bearingDeg}°</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 flex items-center space-x-1">
                    <Compass className="w-3.5 h-3.5" />
                    <span>Awaiting phone GPS fix for distance & bearing calculation...</span>
                  </div>
                )}
              </div>

              {/* One-Tap Deep Link to Google Maps Navigation */}
              {targetLat !== null && targetLon !== null && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 px-4 rounded-xl flex items-center justify-center space-x-2 shadow-lg hover:shadow-emerald-500/30 transition text-sm sm:text-base cursor-pointer"
                >
                  <Navigation className="w-5 h-5" />
                  <span>OPEN IN GOOGLE MAPS NAVIGATION</span>
                  <ExternalLink className="w-4 h-4 ml-1" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. WIRELESS TELEMETRY & ACK PROTOCOL (Collapsible for zero clutter) */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800/80 overflow-hidden shadow-md">
        <button
          type="button"
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 transition font-bold uppercase cursor-pointer"
        >
          <span className="flex items-center space-x-2">
            <span>WIRELESS TELEMETRY & ACK PROTOCOL</span>
            <span className="text-[10px] text-emerald-400 font-extrabold">• DIRECT LINK</span>
          </span>
          {showDiagnostics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showDiagnostics && (
          <div className="p-3.5 pt-0 border-t border-slate-800/80">
            <AckProtocolCard
              runnerLink={runnerLink}
              receivedCode={receivedCode || undefined}
              ackSent={ackDispatched}
            />
          </div>
        )}
      </div>
    </div>
  );
};
