import React, { useState, useEffect } from 'react';
import { DroneTelemetry, MissionState, DecodedQRData, TargetBoxDetection } from '../../types/mission';
import { customRouteService, LiveWaypointProgress } from '../../services/customRouteService';
import { Activity, Clock, Crosshair, QrCode, Gauge, Compass, Route, CheckCircle2 } from 'lucide-react';

interface MissionStatusCardProps {
  missionState: MissionState;
  telemetry: DroneTelemetry;
  elapsedSeconds: number;
  remainingSeconds: number;
  boxDetection?: TargetBoxDetection;
  decodedQR?: DecodedQRData | null;
  className?: string;
}

export const MissionStatusCard: React.FC<MissionStatusCardProps> = ({
  missionState,
  telemetry,
  elapsedSeconds,
  remainingSeconds,
  boxDetection,
  decodedQR,
  className = ''
}) => {
  const [liveProgress, setLiveProgress] = useState<LiveWaypointProgress>(() =>
    customRouteService.getProgress()
  );

  useEffect(() => {
    return customRouteService.subscribeProgress((p) => {
      setLiveProgress(p);
    });
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Human-readable Phase from state
  const getPhaseLabel = (state: MissionState): string => {
    switch (state) {
      case 'IDLE': return 'Standby';
      case 'HOME_SET': return 'Home Locked';
      case 'READY': return 'Pre-Flight Ready';
      case 'STARTING': return 'Arming & Starting';
      case 'TAKEOFF':
      case 'CLIMBING':
      case 'CLIMBING_TO_ALTITUDE': return 'Climbing to Altitude';
      case 'ALTITUDE_STABILIZING': return 'Altitude Stabilizing';
      case 'SEARCHING': return 'Autonomous Waypoint Following';
      case 'OBJECT_DETECTED':
      case 'BOX_DETECTED': return 'Box Detected (Tracking)';
      case 'BOX_TRACKING':
      case 'BOX_CENTERED':
      case 'INSPECTING': return 'Target Visual Inspection';
      case 'QR_DETECTION':
      case 'QR_DETECTED':
      case 'QR_SCANNING': return 'High-Rate QR Decoding';
      case 'QR_DECODED':
      case 'DATA_CONFIRMED': return 'QR Data Confirmed';
      case 'SEND_TO_RUNNER': return 'Dispatching Code to Runner';
      case 'WAIT_FOR_RUNNER_ACK': return 'Awaiting Runner Handshake';
      case 'RUNNER_CONFIRMED':
      case 'MISSION_COMPLETE': return 'Mission Complete';
      case 'RTL_REQUESTED':
      case 'RTL':
      case 'RETURNING_HOME': return 'Return-To-Launch (RTL)';
      case 'LANDING': return 'Autonomous Descent';
      case 'LANDED': return 'Touchdown Complete';
      case 'ABORTED': return 'Mission Aborted (Holding)';
      case 'EMERGENCY_RTL': return 'Emergency RTL Fail-Safe';
      case 'MISSION_TIMEOUT': return 'Timer Expired (Auto RTL)';
      default: return String(state).replace('_', ' ');
    }
  };

  const isTargetDetected = boxDetection?.isDetected || missionState === 'BOX_DETECTED' || missionState === 'QR_DETECTED' || Boolean(decodedQR);
  const isQrDetected = Boolean(decodedQR && decodedQR.code);

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-lg font-mono select-none space-y-3.5 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-black tracking-wider text-slate-100 uppercase">
            MISSION STATUS
          </span>
        </div>

        {/* State Pill */}
        <div className="flex items-center space-x-1.5">
          <span className={`w-2 h-2 rounded-full ${
            missionState === 'SEARCHING' || missionState === 'CLIMBING'
              ? 'bg-sky-400 animate-ping'
              : missionState === 'MISSION_COMPLETE' || missionState === 'RUNNER_CONFIRMED'
              ? 'bg-emerald-400'
              : missionState === 'ABORTED' || missionState === 'EMERGENCY_RTL'
              ? 'bg-rose-400'
              : 'bg-amber-400'
          }`} />
          <span className="text-xs font-extrabold text-sky-300 uppercase">
            ● {missionState.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Live Waypoint Status (Requirement 15) */}
      {liveProgress.totalWaypoints > 0 && (
        <div className="p-3 bg-slate-950/80 border border-sky-500/40 rounded-xl space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div className="flex items-center space-x-2 text-sky-400">
              <Route className="w-4 h-4 text-sky-400" />
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-200">
                CURRENT WAYPOINT
              </span>
            </div>
            <span className="text-xs font-black text-sky-300 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-500/50">
              WP{liveProgress.currentWaypointIndex} / {liveProgress.totalWaypoints}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Current WP:</span>
              <span className="font-extrabold text-white truncate block">
                {liveProgress.currentWaypointName}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Distance to WP:</span>
              <span className="font-extrabold text-amber-300 block">
                {liveProgress.distanceToCurrentMeters} m
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Next Waypoint:</span>
              <span className="font-extrabold text-slate-200 truncate block">
                {liveProgress.nextWaypointName}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Mission Leg:</span>
              <span className={`font-black uppercase block ${liveProgress.currentLeg === 'RETURN' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {liveProgress.currentLeg}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Grid of Real-Time Values */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        {/* Phase */}
        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Phase:</span>
          <span className="font-extrabold text-slate-200 truncate block">
            {getPhaseLabel(missionState)}
          </span>
        </div>

        {/* Altitude */}
        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Altitude:</span>
          <span className="font-extrabold text-amber-300 block">
            {telemetry.altitude.toFixed(1)} m
          </span>
        </div>

        {/* Speed */}
        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Speed:</span>
          <span className="font-extrabold text-sky-300 block">
            {telemetry.groundSpeed.toFixed(1)} m/s
          </span>
        </div>

        {/* Elapsed */}
        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Elapsed:</span>
          <span className="font-extrabold text-slate-200 block">
            {formatTime(elapsedSeconds)}
          </span>
        </div>

        {/* Remaining */}
        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Remaining:</span>
          <span className={`font-extrabold block ${remainingSeconds <= 30 ? 'text-rose-400' : 'text-slate-200'}`}>
            {formatTime(remainingSeconds)}
          </span>
        </div>

        {/* Target */}
        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Target:</span>
          <span className={`font-extrabold block ${isTargetDetected ? 'text-emerald-400' : 'text-slate-400'}`}>
            {isTargetDetected ? '✓ Detected' : 'Not Detected'}
          </span>
        </div>

        {/* QR Detection Status (Requirement 18) */}
        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 uppercase font-bold">QR Status:</span>
            <span className={`font-black text-[11px] ${isQrDetected ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isQrDetected ? '✓ QR FOUND' : 'Waiting…'}
            </span>
          </div>
          {isQrDetected && decodedQR?.code && (
            <div className="mt-1 space-y-0.5 text-[11px]">
              <div className="text-slate-300">
                QR DATA: <span className="font-mono font-bold text-emerald-300">{decodedQR.code}</span>
              </div>
              <div className="text-[10px] text-emerald-400 font-bold flex items-center space-x-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>QR Result Sent ✓</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
