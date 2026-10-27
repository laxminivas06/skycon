import React, { useState, useEffect } from 'react';
import {
  Compass,
  ShieldCheck,
  AlertTriangle,
  RotateCw,
  Octagon,
  Home,
  PlaneLanding,
  Navigation,
  Crosshair,
  Sliders,
  ChevronDown
} from 'lucide-react';
import { mavlinkService, FlightModeName } from '../../services/mavlinkService';
import { DroneTelemetry } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';

export interface FlightModeConfig {
  mode: FlightModeName;
  label: string;
  shortDesc: string;
  requiresGps: boolean;
  colorClass: string;
  icon: React.ReactNode;
}

export const ALL_FLIGHT_MODES: FlightModeConfig[] = [
  {
    mode: 'LOITER',
    label: 'LOITER',
    shortDesc: 'GPS Pos & Alt Hold',
    requiresGps: true,
    colorClass: 'border-emerald-500/50 hover:bg-emerald-950/60 text-emerald-300',
    icon: <Crosshair className="w-3.5 h-3.5" />
  },
  {
    mode: 'RTL',
    label: 'RTL',
    shortDesc: 'Return To Launch',
    requiresGps: true,
    colorClass: 'border-amber-500/50 hover:bg-amber-950/60 text-amber-300',
    icon: <Home className="w-3.5 h-3.5" />
  },
  {
    mode: 'STABILIZE',
    label: 'STABILIZE',
    shortDesc: 'Manual Level (No GPS)',
    requiresGps: false,
    colorClass: 'border-blue-500/50 hover:bg-blue-950/60 text-blue-300',
    icon: <Sliders className="w-3.5 h-3.5" />
  },
  {
    mode: 'GUIDED',
    label: 'GUIDED',
    shortDesc: 'GCS Point Navigation',
    requiresGps: true,
    colorClass: 'border-cyan-500/50 hover:bg-cyan-950/60 text-cyan-300',
    icon: <Navigation className="w-3.5 h-3.5" />
  },
  {
    mode: 'AUTO',
    label: 'AUTO',
    shortDesc: 'Mission Waypoints',
    requiresGps: true,
    colorClass: 'border-purple-500/50 hover:bg-purple-950/60 text-purple-300',
    icon: <RotateCw className="w-3.5 h-3.5" />
  },
  {
    mode: 'LAND',
    label: 'LAND',
    shortDesc: 'Vertical Touchdown',
    requiresGps: false,
    colorClass: 'border-rose-500/50 hover:bg-rose-950/60 text-rose-300',
    icon: <PlaneLanding className="w-3.5 h-3.5" />
  },
  {
    mode: 'ALT_HOLD',
    label: 'ALT_HOLD',
    shortDesc: 'Baro Alt Hold (No GPS)',
    requiresGps: false,
    colorClass: 'border-teal-500/50 hover:bg-teal-950/60 text-teal-300',
    icon: <Sliders className="w-3.5 h-3.5" />
  },
  {
    mode: 'POSHOLD',
    label: 'POSHOLD',
    shortDesc: 'GPS Hold + Stick Control',
    requiresGps: true,
    colorClass: 'border-emerald-500/50 hover:bg-emerald-950/60 text-emerald-300',
    icon: <Compass className="w-3.5 h-3.5" />
  },
  {
    mode: 'BRAKE',
    label: 'BRAKE',
    shortDesc: 'Instant Air Stop',
    requiresGps: true,
    colorClass: 'border-red-500/60 hover:bg-red-950/60 text-red-300',
    icon: <Octagon className="w-3.5 h-3.5" />
  },
  {
    mode: 'CIRCLE',
    label: 'CIRCLE',
    shortDesc: 'Orbit Position',
    requiresGps: true,
    colorClass: 'border-indigo-500/50 hover:bg-indigo-950/60 text-indigo-300',
    icon: <RotateCw className="w-3.5 h-3.5" />
  }
];

interface FlightModeSelectorProps {
  variant?: 'strip' | 'dropdown';
  className?: string;
  onModeChanged?: (mode: FlightModeName) => void;
}

export const FlightModeSelector: React.FC<FlightModeSelectorProps> = ({
  variant = 'strip',
  className = '',
  onModeChanged
}) => {
  const [telemetry, setTelemetry] = useState<DroneTelemetry>(() => mavlinkService.getTelemetry());
  const [connState, setConnState] = useState<PixhawkConnectionState>(() => mavlinkService.getConnectionState());
  const [isChangingMode, setIsChangingMode] = useState<FlightModeName | null>(null);
  const [modeFeedback, setModeFeedback] = useState<{ mode: FlightModeName; success: boolean; msg: string } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    const unsubTelem = mavlinkService.subscribeTelemetry((t) => setTelemetry(t));
    const unsubConn = mavlinkService.subscribeConnection((c) => setConnState(c));
    return () => {
      unsubTelem();
      unsubConn();
    };
  }, []);

  const currentModeStr = (telemetry.flightMode || 'STABILIZE').toUpperCase();
  const isLinkActive = Boolean(
    connState.isConnected ||
    connState.isUsbConnected ||
    connState.isRealHardware ||
    connState.connectionType === 'SIMULATED'
  );

  const handleModeSelect = async (mode: FlightModeName) => {
    if (!isLinkActive) {
      setModeFeedback({
        mode,
        success: false,
        msg: 'Cannot change mode: Drone is not connected via MAVLink.'
      });
      return;
    }

    if (currentModeStr === mode) {
      setDropdownOpen(false);
      return;
    }

    setIsChangingMode(mode);
    setModeFeedback(null);
    setDropdownOpen(false);

    try {
      const ok = await mavlinkService.setFlightMode(mode);
      setIsChangingMode(null);
      if (ok) {
        setModeFeedback({ mode, success: true, msg: `Flight mode switched to ${mode} ✓` });
        onModeChanged?.(mode);
        setTimeout(() => setModeFeedback(null), 3500);
      } else {
        const err = connState.lastModeChangeError ||
          (ALL_FLIGHT_MODES.find(m => m.mode === mode)?.requiresGps && (!telemetry.gps.isLocked || telemetry.gps.satellites < 6)
            ? `Pixhawk rejected ${mode}: Requires 3D GPS fix (6+ sats). Use STABILIZE or ALT_HOLD for bench test.`
            : `Pixhawk rejected ${mode} flight mode request.`);
        setModeFeedback({ mode, success: false, msg: err });
      }
    } catch (err: any) {
      setIsChangingMode(null);
      setModeFeedback({
        mode,
        success: false,
        msg: err?.message || `Failed to set flight mode ${mode}`
      });
    }
  };

  // ---------------------------------------------------------------------------
  // VARIANT: DROPDOWN (Ideal for Header bar)
  // ---------------------------------------------------------------------------
  if (variant === 'dropdown') {
    return (
      <div className={`relative inline-block text-left ${className}`}>
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border text-[11px] font-mono font-bold transition shadow-sm cursor-pointer select-none ${
            isChangingMode
              ? 'bg-amber-600/90 border-amber-400 text-white animate-pulse'
              : 'bg-[#11161F] border-emerald-500/40 text-emerald-300 hover:bg-[#161B22] hover:border-emerald-400'
          }`}
          title="Click to switch Pixhawk Flight Mode (Loiter, RTL, Stabilize, Guided, Auto, etc.)"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>MODE:</span>
          <span className="text-white font-black tracking-wide">
            {isChangingMode ? `SWITCHING ${isChangingMode}...` : currentModeStr}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setDropdownOpen(false)}
            />
            <div className="absolute right-0 mt-1.5 w-64 bg-[#0d1117] border border-slate-700 rounded-xl shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95">
              <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] font-mono font-bold text-slate-400 flex items-center justify-between">
                <span>SELECT FLIGHT MODE</span>
                <span className="text-emerald-400 font-normal">Active: {currentModeStr}</span>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/40 py-1">
                {ALL_FLIGHT_MODES.map((cfg) => {
                  const isActive = currentModeStr === cfg.mode;
                  const isPending = isChangingMode === cfg.mode;

                  return (
                    <button
                      key={cfg.mode}
                      type="button"
                      onClick={() => handleModeSelect(cfg.mode)}
                      className={`w-full px-3 py-2 flex items-center justify-between text-left transition cursor-pointer text-xs font-mono ${
                        isActive
                          ? 'bg-emerald-950/70 text-emerald-300 font-bold border-l-2 border-emerald-400'
                          : isPending
                          ? 'bg-amber-950/60 text-amber-300 font-bold'
                          : 'text-slate-300 hover:bg-[#161B22] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {cfg.icon}
                        <div>
                          <div className="font-bold tracking-wide">{cfg.label}</div>
                          <div className="text-[10px] text-slate-400 font-normal">{cfg.shortDesc}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                          cfg.requiresGps ? 'bg-amber-950/60 text-amber-400 border border-amber-800/40' : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                        }`}>
                          {cfg.requiresGps ? 'GPS' : 'NO GPS'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VARIANT: FULL HORIZONTAL TACTICAL STRIP (For Map / Dashboard Header)
  // ---------------------------------------------------------------------------
  return (
    <div className={`w-full bg-[#0d1117] border border-slate-800 rounded-xl p-2.5 font-mono shadow-md space-y-2 select-none ${className}`}>
      {/* Top Banner: Active Mode Status & Quick Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-slate-800/70 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#161B22] border border-slate-700/80">
            <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">FLIGHT MODE:</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-300 font-black text-sm tracking-wide">
              {currentModeStr}
            </span>
          </div>

          {isChangingMode && (
            <span className="text-amber-400 font-bold text-xs animate-pulse flex items-center gap-1">
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              Switching to {isChangingMode}...
            </span>
          )}
        </div>

        {/* Emergency Quick Actions */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleModeSelect('BRAKE')}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/80 border border-red-600/60 hover:bg-red-900 text-red-200 text-[11px] font-bold transition shadow-sm cursor-pointer"
            title="Instant Electronic Air Brake: Stops drone dead in mid-air"
          >
            <Octagon className="w-3 h-3 text-red-400" />
            <span>BRAKE</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSelect('RTL')}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-950/80 border border-amber-600/60 hover:bg-amber-900 text-amber-200 text-[11px] font-bold transition shadow-sm cursor-pointer"
            title="Return to Launch: Automatically returns to takeoff location and lands"
          >
            <Home className="w-3 h-3 text-amber-400" />
            <span>RTL</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSelect('LAND')}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-950/80 border border-rose-600/60 hover:bg-rose-900 text-rose-200 text-[11px] font-bold transition shadow-sm cursor-pointer"
            title="Land: Descends vertically straight down and auto-disarms"
          >
            <PlaneLanding className="w-3 h-3 text-rose-400" />
            <span>LAND</span>
          </button>
        </div>
      </div>

      {/* Mode Change Feedback Alert */}
      {(modeFeedback || connState.lastModeChangeError) && (
        <div className={`p-2 rounded-lg text-xs flex items-center justify-between border ${
          modeFeedback?.success
            ? 'bg-emerald-950/90 border-emerald-500/70 text-emerald-200'
            : 'bg-amber-950/90 border-amber-500/70 text-amber-200'
        }`}>
          <div className="flex items-center gap-2">
            {modeFeedback?.success ? (
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span className="text-[11px] font-semibold">
              {modeFeedback?.msg || connState.lastModeChangeError}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setModeFeedback(null)}
            className="text-slate-400 hover:text-white px-1.5 py-0.5 text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Grid of All 10 Supported Flight Modes */}
      <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-1.5">
        {ALL_FLIGHT_MODES.map((cfg) => {
          const isActive = currentModeStr === cfg.mode;
          const isPending = isChangingMode === cfg.mode;

          return (
            <button
              key={cfg.mode}
              type="button"
              onClick={() => handleModeSelect(cfg.mode)}
              disabled={isChangingMode !== null}
              className={`p-1.5 rounded-lg border text-[11px] font-mono transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer select-none active:scale-95 ${
                isActive
                  ? 'bg-emerald-600 border-emerald-400 text-white font-black shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-400'
                  : isPending
                  ? 'bg-amber-600 border-amber-400 text-white font-bold animate-pulse ring-2 ring-amber-400'
                  : 'bg-[#161B22] border-slate-700/80 text-slate-300 hover:bg-[#21262D] hover:text-white hover:border-slate-500'
              }`}
              title={`${cfg.label}: ${cfg.shortDesc} (${cfg.requiresGps ? 'Requires 3D GPS lock' : 'Works without GPS'})`}
            >
              <div className="flex items-center gap-1 font-bold">
                {cfg.icon}
                <span>{cfg.label}</span>
              </div>
              <span className={`text-[8px] font-sans font-semibold tracking-tighter ${
                isActive
                  ? 'text-emerald-100'
                  : cfg.requiresGps
                  ? 'text-amber-400/90'
                  : 'text-emerald-400/90'
              }`}>
                {isActive ? 'ACTIVE' : cfg.requiresGps ? 'GPS REQ' : 'NO GPS'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
