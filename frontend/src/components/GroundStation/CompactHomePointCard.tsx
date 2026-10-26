import React from 'react';
import { HomePoint, GPSCoordinates } from '../../types/mission';
import { missionEngine } from '../../services/missionEngine';
import {
  MapPin,
  CheckCircle2,
  XCircle,
  Home,
  Compass,
  Trash2,
  Crosshair
} from 'lucide-react';

interface CompactHomePointCardProps {
  homePoint: HomePoint;
  gps: GPSCoordinates;
  onSetHomePoint: (coords?: { lat: number; lng: number }) => void;
  disabled?: boolean;
  className?: string;
}

export const CompactHomePointCard: React.FC<CompactHomePointCardProps> = ({
  homePoint,
  gps,
  onSetHomePoint,
  disabled = false,
  className = ''
}) => {
  const isHomeSet = homePoint.isSet;
  const hasGpsCoordinates = gps.latitude !== 0 && gps.longitude !== 0;

  const handleClearHome = () => {
    if (disabled) return;
    missionEngine.clearHomePoint();
  };

  const handleSetCurrentGps = () => {
    if (disabled) return;
    onSetHomePoint();
  };

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl p-3.5 shadow-lg font-mono select-none ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-sky-950/80 border border-sky-500/40 text-sky-400">
            <Home className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-black tracking-wider text-slate-200 uppercase">
            HOME POINT
          </span>
        </div>

        {/* Status Pill */}
        <div className="flex items-center space-x-1.5">
          {isHomeSet ? (
            <span className="text-[11px] font-extrabold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/40 flex items-center space-x-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Status: ✓ Set</span>
            </span>
          ) : (
            <span className="text-[11px] font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/40 flex items-center space-x-1">
              <XCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Status: ✗ Not Set</span>
            </span>
          )}
        </div>
      </div>

      {/* Coordinate Readouts */}
      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 text-xs">
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Latitude:</span>
          <span className="font-extrabold text-slate-200">
            {isHomeSet
              ? homePoint.latitude.toFixed(6)
              : hasGpsCoordinates
              ? `${gps.latitude.toFixed(6)} (GPS)`
              : '--.------'}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Longitude:</span>
          <span className="font-extrabold text-slate-200">
            {isHomeSet
              ? homePoint.longitude.toFixed(6)
              : hasGpsCoordinates
              ? `${gps.longitude.toFixed(6)} (GPS)`
              : '--.------'}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Altitude (MSL):</span>
          <span className="font-extrabold text-amber-300">
            {isHomeSet
              ? `${homePoint.altitude.toFixed(1)} m`
              : hasGpsCoordinates
              ? `${gps.altitude.toFixed(1)} m (GPS)`
              : '--.- m'}
          </span>
        </div>
      </div>

      {/* Pixhawk Home Established Indicator (Req 6) */}
      {isHomeSet && (
        <div className="mt-2 text-[11px] text-emerald-300 font-bold flex items-center space-x-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>✓ Pixhawk Home Position</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-3 flex items-center space-x-2">
        <button
          type="button"
          disabled={disabled || !hasGpsCoordinates}
          onClick={handleSetCurrentGps}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition ${
            isHomeSet
              ? 'bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40 cursor-pointer'
              : 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-md shadow-sky-600/30 cursor-pointer'
          } ${disabled || !hasGpsCoordinates ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>Set Current GPS as Home</span>
        </button>

        <button
          type="button"
          disabled={disabled || !isHomeSet}
          onClick={handleClearHome}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/80 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/50 text-xs font-bold uppercase flex items-center space-x-1 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="Clear Home Position"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
};
