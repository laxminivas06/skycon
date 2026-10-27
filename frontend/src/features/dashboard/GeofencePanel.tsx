import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Lock,
  Unlock,
  MapPin,
  EyeOff
} from 'lucide-react';
import {
  geofenceService,
  GeofenceState,
  GeofenceLockStatus
} from '../../services/geofenceService';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';

interface GeofencePanelProps {
  onStartDrawingPolygon?: () => void;
  isDrawingPolygon?: boolean;
  className?: string;
}

export const GeofencePanel: React.FC<GeofencePanelProps> = ({
  onStartDrawingPolygon,
  isDrawingPolygon = false,
  className = ''
}) => {
  const [geofenceState, setGeofenceState] = useState<GeofenceState>(() => geofenceService.getState());
  const [telemetry, setTelemetry] = useState(() => mavlinkService.getTelemetry());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsubGeo = geofenceService.subscribe((st) => setGeofenceState(st));
    const unsubTelem = mavlinkService.subscribeTelemetry((telem) => setTelemetry(telem));
    return () => {
      unsubGeo();
      unsubTelem();
    };
  }, []);

  const showNotification = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const handleToggleGeofence = () => {
    const nextState = !geofenceState.enabled;
    geofenceService.setEnabled(nextState);
    audioService.playBeep(nextState ? 880 : 450, 80);
    showNotification(
      nextState
        ? 'Geofence ACTIVE: Aircraft armed containment locked inside'
        : 'Geofence BYPASSED / OFF: Software interlock disabled'
    );
  };

  const handleApplyADDCDefaults = () => {
    geofenceService.resetToADDCDefaults();
    showNotification('Applied SAE India ADDC Rule 3.3 Defaults (50m × 50m Arena, 25m Ceiling)');
  };

  const canArmStatus = geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude);
  const boundaryVertices = geofenceService.getBoundaryVertices();
  const lockStatus: GeofenceLockStatus = geofenceState.geofenceStatus;

  return (
    <div className={`bg-[#0d1627] border border-slate-800 rounded-xl p-3 sm:p-4 text-xs font-mono shadow-xl flex flex-col gap-3 ${className}`}>
      {/* 1. Header with Geofence ON/OFF Toggle Switch */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          {lockStatus === 'BREACHED' ? (
            <ShieldAlert className="w-5 h-5 text-red-400 animate-pulse" />
          ) : geofenceState.enabled ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <Shield className="w-5 h-5 text-slate-500" />
          )}
          <div>
            <div className="text-white font-bold text-[13px] tracking-wide flex items-center gap-1.5">
              <span>GEOFENCE ENFORCEMENT</span>
              {geofenceState.enabled && <Lock className="w-3.5 h-3.5 text-emerald-400" />}
            </div>
            <div className="text-[10px] text-slate-400">SAE INDIA ADDC Rule 3.3 Flight Containment</div>
          </div>
        </div>

        {/* High-Visibility ON/OFF Toggle Switch */}
        <button
          type="button"
          onClick={handleToggleGeofence}
          className={`px-3 py-1.5 rounded-lg border font-bold text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer ${
            geofenceState.enabled
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-emerald-900/40'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
          }`}
          title="Toggle Geofence Enforcement"
        >
          {geofenceState.enabled ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-200" />
              <span>GEOFENCE ON</span>
            </>
          ) : (
            <>
              <Unlock className="w-4 h-4 text-slate-400" />
              <span>GEOFENCE OFF</span>
            </>
          )}
        </button>
      </div>

      {/* 2. Clear High-Visibility Status Badge */}
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-[11px]">CONTAINMENT STATUS:</span>
        {lockStatus === 'ACTIVE_ARMED_LOCKED' && (
          <div className="px-2.5 py-1 rounded-md bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-bold flex items-center gap-1.5 text-[11px] shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>ACTIVE — ARMED LOCKED INSIDE</span>
          </div>
        )}
        {lockStatus === 'BREACHED' && (
          <div className="px-2.5 py-1 rounded-md bg-red-950/90 border border-red-500 text-red-200 font-extrabold flex items-center gap-1.5 text-[11px] shadow-lg animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span>BREACHED: {geofenceState.breachReason || 'OUT OF BOUNDS'}</span>
          </div>
        )}
        {lockStatus === 'BYPASSED_OFF' && (
          <div className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-400 font-semibold flex items-center gap-1.5 text-[11px]">
            <EyeOff className="w-3.5 h-3.5 text-slate-500" />
            <span>BYPASSED / OFF</span>
          </div>
        )}
      </div>

      {/* 3. Pre-Arm Containment Interlock Banner */}
      <div
        className={`p-2.5 rounded-lg border flex items-center gap-2 text-[11px] ${
          canArmStatus.canArm
            ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
            : 'bg-red-950/50 border-red-500/60 text-red-200 animate-pulse'
        }`}
      >
        {canArmStatus.canArm ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>PRE-ARM PASS: Vehicle is inside active perimeter with 3D GPS lock ({telemetry.gps.satellites} sats).</span>
          </>
        ) : (
          <>
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="font-bold">{canArmStatus.reason}</span>
          </>
        )}
      </div>

      {/* 4. Polygon Vertices & Boundary Controls */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-300 font-bold flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-amber-400" />
            <span>POLYGON BOUNDARY ({boundaryVertices.length} Vertices)</span>
          </span>
          <span className="text-[10px] text-cyan-400 font-bold uppercase">
            SHAPE: {geofenceState.shape}
          </span>
        </div>

        {/* Boundary Control Buttons */}
        <div className="grid grid-cols-2 gap-2">
          {onStartDrawingPolygon && (
            <button
              type="button"
              onClick={onStartDrawingPolygon}
              className={`px-2.5 py-1.5 rounded-md border text-[11px] font-bold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer ${
                isDrawingPolygon
                  ? 'bg-cyan-600 border-cyan-400 text-white animate-pulse'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-cyan-300'
              }`}
            >
              <span>{isDrawingPolygon ? 'Finish Polygon' : 'Draw Polygon on Map'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleApplyADDCDefaults}
            className="px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 font-bold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3 text-amber-400" />
            <span>50m Arena Preset</span>
          </button>
        </div>

        {/* Altitude & Breach Failsafe Limits */}
        <div className="grid grid-cols-3 gap-2 pt-1 text-[10px] text-slate-300">
          <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
            <span className="text-slate-500 block">CEILING</span>
            <span className="font-bold text-amber-300">{geofenceState.maxAltitudeMeters}m AGL</span>
          </div>
          <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
            <span className="text-slate-500 block">FLOOR</span>
            <span className="font-bold text-cyan-300">{geofenceState.minAltitudeMeters}m AGL</span>
          </div>
          <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
            <span className="text-slate-500 block">FAILSAFE</span>
            <span className="font-bold text-red-400">{geofenceState.breachAction}</span>
          </div>
        </div>
      </div>

      {/* Temporary toast notice */}
      {notice && (
        <div className="p-2 rounded bg-cyan-950/90 border border-cyan-500/60 text-cyan-200 text-[10px] flex items-center gap-1.5 animate-in fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
};
