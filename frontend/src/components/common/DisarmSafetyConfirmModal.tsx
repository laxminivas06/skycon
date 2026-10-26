import React, { useState } from 'react';
import { AlertTriangle, Power, PlaneLanding, X, AlertOctagon, ShieldAlert, ArrowDown } from 'lucide-react';

interface DisarmSafetyConfirmModalProps {
  isOpen: boolean;
  currentAltitude: number;
  verticalSpeed?: number;
  flightMode?: string;
  isForceCutoff?: boolean;
  onConfirmDisarm: () => void;
  onCommandLand: () => void;
  onCancel: () => void;
}

export const DisarmSafetyConfirmModal: React.FC<DisarmSafetyConfirmModalProps> = ({
  isOpen,
  currentAltitude,
  verticalSpeed = 0,
  flightMode = 'UNKNOWN',
  isForceCutoff = false,
  onConfirmDisarm,
  onCommandLand,
  onCancel
}) => {
  const [overrideAcknowledged, setOverrideAcknowledged] = useState<boolean>(false);

  if (!isOpen) return null;

  const altitudeDisplay = Math.max(0, currentAltitude).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150 font-mono select-none">
      <div className="bg-slate-900 border-2 border-rose-500 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl shadow-rose-950/80 space-y-4 text-slate-100">
        {/* Header Banner */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-rose-500/30">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-rose-950 border border-rose-500/60 text-rose-400 shrink-0 animate-pulse">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-rose-400">
                CRITICAL AIRBORNE SAFETY WARNING
              </div>
              <div className="text-sm sm:text-base font-black text-white">
                DRONE IS STILL AT {altitudeDisplay} M HEIGHT!
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Telemetry Altitude Pill */}
        <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-center">
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-bold">Current Altitude</div>
            <div className="text-base sm:text-lg font-black text-rose-400">{altitudeDisplay} m</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-bold">Vertical Speed</div>
            <div className="text-base sm:text-lg font-black text-amber-300">
              {verticalSpeed > 0 ? `+${verticalSpeed.toFixed(1)}` : verticalSpeed.toFixed(1)} m/s
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-bold">Flight Mode</div>
            <div className="text-base sm:text-lg font-black text-sky-400 truncate">{flightMode}</div>
          </div>
        </div>

        {/* Warning Body */}
        <div className="p-3.5 bg-rose-950/50 border border-rose-500/40 rounded-xl space-y-2 text-xs text-rose-200">
          <div className="font-bold flex items-center space-x-2 text-white">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Are you sure you want to DISARM while airborne?</span>
          </div>
          <p className="text-[11px] leading-relaxed text-rose-300">
            Disarming motors while the drone is at <strong className="text-white underline">{altitudeDisplay} meters</strong> will immediately stop all propeller thrust. The vehicle will freefall, violently strike the ground, and sustain severe frame, motor, and electronics damage.
          </p>
        </div>

        {/* Recommended Safe Action: LAND */}
        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            onClick={onCommandLand}
            className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center space-x-2.5 shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-400/40 transition active:scale-[0.98] cursor-pointer"
          >
            <PlaneLanding className="w-5 h-5 shrink-0" />
            <span>SWITCH TO LAND MODE (RECOMMENDED)</span>
          </button>
          <div className="text-[10px] text-emerald-400 text-center">
            ✓ ArduPilot will descend steadily and auto-disarm gently upon ground touchdown.
          </div>
        </div>

        {/* Keep Flying Button */}
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
        >
          Cancel &amp; Keep Motors Running
        </button>

        {/* Dangerous Mid-Air Cutoff Override */}
        <div className="pt-2 border-t border-slate-800/80 space-y-2">
          <label className="flex items-center space-x-2 text-[11px] text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={overrideAcknowledged}
              onChange={(e) => setOverrideAcknowledged(e.target.checked)}
              className="rounded border-rose-500/60 text-rose-500 focus:ring-0 bg-slate-950"
            />
            <span>I accept full risk of crash damage and insist on immediate motor shutdown.</span>
          </label>

          {overrideAcknowledged && (
            <button
              type="button"
              onClick={onConfirmDisarm}
              className="w-full py-2.5 px-3 rounded-xl bg-rose-950 border border-rose-500 text-rose-200 hover:bg-rose-900 font-black text-[11px] uppercase tracking-wider flex items-center justify-center space-x-2 transition cursor-pointer"
            >
              <Power className="w-4 h-4 text-rose-400" />
              <span>EMERGENCY FORCE DISARM AT {altitudeDisplay}M</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
