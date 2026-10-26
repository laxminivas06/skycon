import React from 'react';
import { DroneTelemetry } from '../../types/mission';
import { 
  ArrowUpRight, 
  Battery, 
  Compass, 
  Gauge, 
  MapPin, 
  Navigation, 
  Satellite, 
  ShieldCheck, 
  ShieldAlert,
  Zap
} from 'lucide-react';

interface TelemetryHUDProps {
  telemetry: DroneTelemetry;
  className?: string;
}

export const TelemetryHUD: React.FC<TelemetryHUDProps> = ({
  telemetry,
  className = ''
}) => {
  const getFlightModeColor = (mode: string) => {
    switch (mode) {
      case 'AUTO':
        return 'text-sky-400 bg-sky-950/40 border-sky-500/40';
      case 'RTL':
        return 'text-amber-400 bg-amber-950/40 border-amber-500/40 animate-pulse';
      case 'LAND':
        return 'text-purple-400 bg-purple-950/40 border-purple-500/40';
      case 'GUIDED':
        return 'text-emerald-400 bg-emerald-950/40 border-emerald-500/40';
      case 'DISARMED':
        return 'text-slate-400 bg-slate-800/60 border-slate-700';
      default:
        return 'text-slate-300 bg-slate-800 border-slate-700';
    }
  };

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono ${className}`}>
      {/* 1. Altitude */}
      <div className="bg-slate-900/80 p-2.5 sm:p-3 rounded-lg border border-slate-800 hud-border flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span className="flex items-center space-x-1">
            <ArrowUpRight className="w-3 h-3 text-sky-400" />
            <span>ALTITUDE</span>
          </span>
          <span className="text-[10px] text-slate-500">AGL</span>
        </div>
        <div className="flex items-baseline space-x-1 my-1">
          <span className="text-2xl sm:text-3xl font-extrabold text-white">
            {telemetry.altitude.toFixed(1)}
          </span>
          <span className="text-xs text-sky-400 font-bold">m</span>
        </div>
        <div className="text-[10px] text-slate-500 flex justify-between">
          <span>Target: {telemetry.targetAltitude}m</span>
          <span>V: {telemetry.verticalSpeed >= 0 ? '+' : ''}{telemetry.verticalSpeed.toFixed(1)}m/s</span>
        </div>
      </div>

      {/* 2. Ground Speed */}
      <div className="bg-slate-900/80 p-2.5 sm:p-3 rounded-lg border border-slate-800 hud-border flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span className="flex items-center space-x-1">
            <Gauge className="w-3 h-3 text-emerald-400" />
            <span>GROUND SPEED</span>
          </span>
          <span className="text-[10px] text-slate-500">SPD</span>
        </div>
        <div className="flex items-baseline space-x-1 my-1">
          <span className="text-2xl sm:text-3xl font-extrabold text-emerald-400">
            {telemetry.groundSpeed.toFixed(1)}
          </span>
          <span className="text-xs text-slate-400 font-bold">m/s</span>
        </div>
        <div className="text-[10px] text-slate-500 flex justify-between">
          <span>{(telemetry.groundSpeed * 3.6).toFixed(1)} km/h</span>
          <span>HDG: {Math.round(telemetry.heading)}°</span>
        </div>
      </div>

      {/* 3. Battery & Power */}
      <div className="bg-slate-900/80 p-2.5 sm:p-3 rounded-lg border border-slate-800 hud-border flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span className="flex items-center space-x-1">
            <Battery className="w-3 h-3 text-amber-400" />
            <span>BATTERY</span>
          </span>
          <span className="text-[10px] text-slate-500">
            {(telemetry.batteryCellCount || (telemetry.batteryVoltage > 20.0 ? 6 : telemetry.batteryVoltage > 13.2 ? 4 : 3))}S LIPO
          </span>
        </div>
        <div className="flex items-baseline space-x-1 my-1">
          <span className={`text-2xl sm:text-3xl font-extrabold ${
            telemetry.batteryPercent > 30 ? 'text-white' : 'text-rose-400 animate-pulse'
          }`}>
            {telemetry.batteryPercent}%
          </span>
          <span className="text-xs text-amber-400 font-bold">{telemetry.batteryVoltage}V</span>
        </div>
        <div className="text-[10px] text-slate-500 flex justify-between">
          <span>Current: {telemetry.batteryCurrent}A</span>
          <span className={telemetry.batteryPercent > 20 ? 'text-emerald-400' : 'text-rose-400'}>
            {telemetry.batteryPercent > 20 ? 'HEALTHY ✓' : 'CRITICAL !'}
          </span>
        </div>
      </div>

      {/* 4. Flight Mode & Distance to Home */}
      <div className="bg-slate-900/80 p-2.5 sm:p-3 rounded-lg border border-slate-800 hud-border flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span className="flex items-center space-x-1">
            <Navigation className="w-3 h-3 text-purple-400" />
            <span>FLIGHT MODE</span>
          </span>
          <span className={`text-[10px] font-bold px-1 rounded ${
            telemetry.isArmed ? 'text-emerald-400 bg-emerald-950/40' : 'text-slate-400 bg-slate-800'
          }`}>
            {telemetry.isArmed ? 'ARMED' : 'DISARMED'}
          </span>
        </div>
        <div className="my-1">
          <span className={`text-lg sm:text-xl font-black px-2 py-0.5 rounded border inline-block ${getFlightModeColor(telemetry.flightMode)}`}>
            {telemetry.flightMode}
          </span>
        </div>
        <div className="text-[10px] text-slate-500 flex justify-between">
          <span>Home Dist: <strong className="text-slate-300">{telemetry.distanceToHome}m</strong></span>
          <span>Grid: <strong className="text-sky-400">{telemetry.searchProgress}%</strong></span>
        </div>
      </div>
    </div>
  );
};
