import React from 'react';
import { HomePoint, GPSLocation } from '../../types/mission';
import { Home, MapPin, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

interface HomePointSetterProps {
  homePoint: HomePoint;
  gps: GPSLocation;
  onSetHomePoint: () => void;
  disabled?: boolean;
}

export const HomePointSetter: React.FC<HomePointSetterProps> = ({
  homePoint,
  gps,
  onSetHomePoint,
  disabled = false
}) => {
  const fixType = gps.fixType || 'NO_FIX';
  const isGpsReady = gps.isLocked || (gps.satellites >= 6 && fixType !== 'NO_GPS' && fixType !== 'NO_FIX');
  const fixLabel = fixType === '3D_FIX' ? '3D' : fixType.replace('_', ' ');
  const canSetHome = isGpsReady || (gps.latitude !== 0 && gps.longitude !== 0);

  return (
    <div className="bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 hud-border font-mono flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
        <div className="flex items-center space-x-2">
          <Home className="w-4 h-4 text-sky-400" />
          <span className="text-xs sm:text-sm font-extrabold uppercase text-slate-200">
            HOME POINT CONFIGURATION
          </span>
        </div>
        <div className="flex items-center space-x-1.5">
          <span className="text-[10px] text-slate-400">GPS STATUS:</span>
          {isGpsReady ? (
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/40 flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>GPS READY ({fixLabel})</span>
            </span>
          ) : (
            <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/40 flex items-center space-x-1">
              <AlertTriangle className="w-3 h-3" />
              <span>NO LOCK</span>
            </span>
          )}
        </div>
      </div>

      {/* Coordinates Display Table */}
      <div className="space-y-1.5 text-xs bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 mb-3">
        <div className="flex justify-between items-center text-slate-400">
          <span>Latitude:</span>
          <span className="font-bold text-slate-200">
            {homePoint.isSet ? `${homePoint.latitude.toFixed(7)}°` : `${gps.latitude.toFixed(7)}° (Current)`}
          </span>
        </div>
        <div className="flex justify-between items-center text-slate-400">
          <span>Longitude:</span>
          <span className="font-bold text-slate-200">
            {homePoint.isSet ? `${homePoint.longitude.toFixed(7)}°` : `${gps.longitude.toFixed(7)}° (Current)`}
          </span>
        </div>
        <div className="flex justify-between items-center text-slate-400">
          <span>Altitude:</span>
          <span className="font-bold text-slate-200">
            {homePoint.isSet ? `${homePoint.altitude.toFixed(1)} m (MSL)` : `${gps.altitude.toFixed(1)} m (MSL)`}
          </span>
        </div>
        <div className="flex justify-between items-center text-slate-400">
          <span>Satellites / HDOP:</span>
          <span className="font-bold text-sky-400">
            {gps.satellites} / 7 Sats (Fix: {fixLabel}, HDOP: {gps.hdop})
          </span>
        </div>
      </div>

      {/* Action Button & Status Pill */}
      <div className="flex items-center space-x-2">
        <button
          onClick={onSetHomePoint}
          disabled={disabled || !canSetHome}
          className={`flex-1 py-2.5 px-3 rounded-lg font-bold text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition ${
            homePoint.isSet
              ? 'bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-sky-300 border border-sky-500/40'
              : 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-lg shadow-sky-600/30'
          } ${disabled || !canSetHome ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <MapPin className="w-4 h-4" />
          <span>{homePoint.isSet ? 'UPDATE HOME POINT' : 'SET HOME POINT'}</span>
        </button>

        {homePoint.isSet && (
          <div className="px-3 py-2.5 bg-emerald-950/40 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs font-bold flex items-center space-x-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">VALID</span>
          </div>
        )}
      </div>
    </div>
  );
};
