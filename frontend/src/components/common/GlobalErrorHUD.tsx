/**
 * ===============================================================================
 * SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
 * TOP ERROR & OPERATOR NOTICE BANNER (GlobalErrorHUD)
 * ===============================================================================
 * Mounted prominently above the entire application interface.
 * Shows all active drone errors, Pixhawk pre-arm check rejections, geofence
 * warnings, low battery alerts, and communication status with actionable remedies.
 */

import React, { useState, useEffect } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Zap,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import { systemAlertService, SystemAlertItem } from '../../services/systemAlertService';
import { audioService } from '../../services/audioService';

export const GlobalErrorHUD: React.FC = () => {
  const [alerts, setAlerts] = useState<SystemAlertItem[]>([]);
  const [activeAlert, setActiveAlert] = useState<SystemAlertItem | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [minimized, setMinimized] = useState<boolean>(false);

  useEffect(() => {
    const unsub = systemAlertService.subscribe((all, active) => {
      setAlerts(all.filter((a) => !a.dismissed));
      setActiveAlert(active);

      // Play alert chime when a critical or error arrives
      if (active && (active.severity === 'CRITICAL' || active.severity === 'ERROR')) {
        try {
          audioService.playBeep(440, 140, 'sawtooth');
          setTimeout(() => audioService.playBeep(330, 180, 'sawtooth'), 150);
          audioService.triggerHaptic('warning');
        } catch {}
      } else if (active && active.severity === 'WARNING') {
        try {
          audioService.playBeep(520, 100, 'triangle');
        } catch {}
      }
    });

    return () => unsub();
  }, []);

  const activeList = alerts;
  const currentItem = activeAlert || (activeList.length > 0 ? activeList[currentIndex % activeList.length] : null);

  if (!currentItem) {
    return null;
  }

  const isCritical = currentItem.severity === 'CRITICAL' || currentItem.severity === 'ERROR';
  const isWarning = currentItem.severity === 'WARNING';

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  const handleNext = () => {
    if (activeList.length > 1) {
      setCurrentIndex((prev) => (prev + 1) % activeList.length);
    }
  };

  const handlePrev = () => {
    if (activeList.length > 1) {
      setCurrentIndex((prev) => (prev - 1 + activeList.length) % activeList.length);
    }
  };

  const handleDismiss = () => {
    systemAlertService.dismissActive();
  };

  const handleClearAll = () => {
    systemAlertService.clearAll();
  };

  if (minimized) {
    return (
      <aside 
        aria-label="System Alert Minimized Bar"
        className="fixed top-2 right-4 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
      >
        <button
          onClick={() => setMinimized(false)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-2xl border text-xs font-mono font-bold cursor-pointer transition ${
            isCritical
              ? 'bg-rose-950/95 border-rose-500 text-rose-200 shadow-rose-900/50 animate-pulse'
              : 'bg-amber-950/95 border-amber-500 text-amber-200 shadow-amber-900/50'
          }`}
        >
          <AlertOctagon className="w-4 h-4 shrink-0" />
          <span>{activeList.length} ACTIVE ALERT{activeList.length > 1 ? 'S' : ''} (CLICK TO EXPAND)</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Active System Alerts"
      className="fixed top-0 left-0 right-0 z-[9999] shadow-2xl animate-in slide-in-from-top duration-300 select-none"
    >
      <div
        className={`w-full px-3 sm:px-6 py-2.5 sm:py-3 border-b backdrop-blur-xl transition-all ${
          isCritical
            ? 'bg-[#180a0d]/98 border-rose-600/80 text-rose-100 shadow-[0_8px_30px_rgba(225,29,72,0.4)]'
            : isWarning
            ? 'bg-[#1a1306]/98 border-amber-500/80 text-amber-100 shadow-[0_8px_30px_rgba(245,158,11,0.3)]'
            : 'bg-[#0a121e]/98 border-sky-500/80 text-sky-100 shadow-[0_8px_30px_rgba(14,165,233,0.3)]'
        }`}
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          {/* Left: Icon & Core Error Message */}
          <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
            <div
              className={`p-1.5 rounded-lg shrink-0 mt-0.5 sm:mt-0 ${
                isCritical
                  ? 'bg-rose-600/30 text-rose-400 border border-rose-500/50 animate-pulse'
                  : isWarning
                  ? 'bg-amber-600/30 text-amber-400 border border-amber-500/50'
                  : 'bg-sky-600/30 text-sky-400 border border-sky-500/50'
              }`}
            >
              {isCritical ? (
                <ShieldAlert className="w-5 h-5 sm:w-6 sm:h-6" />
              ) : isWarning ? (
                <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
              ) : (
                <Info className="w-5 h-5 sm:w-6 sm:h-6" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded tracking-wider border ${
                    isCritical
                      ? 'bg-rose-900/80 border-rose-500 text-rose-200'
                      : isWarning
                      ? 'bg-amber-900/80 border-amber-500 text-amber-200'
                      : 'bg-sky-900/80 border-sky-500 text-sky-200'
                  }`}
                >
                  {currentItem.severity} • {currentItem.source}
                </span>

                <span className="text-[11px] font-bold font-sans tracking-wide text-white">
                  {currentItem.title}
                </span>

                <span className="text-[10px] font-mono text-slate-400">
                  [{formatTime(currentItem.timestamp)}]
                </span>

                {activeList.length > 1 && (
                  <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.2 rounded bg-black/40 border border-slate-700">
                    {currentIndex + 1} of {activeList.length}
                  </span>
                )}
              </div>

              {/* Exact Error Message */}
              <p className="text-xs sm:text-sm font-semibold tracking-tight text-white mt-0.5 break-words">
                {currentItem.message}
              </p>

              {/* Actionable Remedy Hint */}
              {currentItem.actionHint && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded w-fit">
                  <span className="font-bold text-emerald-400">💡 FIX:</span>
                  <span>{currentItem.actionHint}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Actions, Navigation & Dismiss */}
          <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
            {activeList.length > 1 && (
              <div className="flex items-center bg-black/40 border border-slate-700/60 rounded-lg p-0.5">
                <button
                  onClick={handlePrev}
                  className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
                  title="Previous Alert"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={handleNext}
                  className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
                  title="Next Alert"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              onClick={() => setMinimized(true)}
              className="px-2 py-1 text-[11px] font-mono text-slate-400 hover:text-white bg-black/30 hover:bg-slate-800/80 rounded border border-slate-700/50 transition cursor-pointer"
              title="Minimize banner"
            >
              Minimize
            </button>

            <button
              onClick={handleClearAll}
              className="px-2 py-1 text-[11px] font-mono text-slate-400 hover:text-rose-300 bg-black/30 hover:bg-rose-950/40 rounded border border-slate-700/50 transition cursor-pointer flex items-center gap-1"
              title="Clear all alerts"
            >
              <Trash2 className="w-3 h-3" />
              <span className="hidden sm:inline">Clear All</span>
            </button>

            <button
              onClick={handleDismiss}
              className="p-1.5 text-slate-300 hover:text-white bg-black/40 hover:bg-rose-600 rounded-lg border border-slate-700/60 transition cursor-pointer"
              title="Acknowledge and dismiss this alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
