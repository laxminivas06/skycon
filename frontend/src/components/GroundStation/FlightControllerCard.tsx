import React, { useState } from 'react';
import { DroneTelemetry, MissionState } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import { missionEngine } from '../../services/missionEngine';
import {
  Gamepad2,
  Power,
  Play,
  Square,
  ShieldAlert,
  Compass,
  Battery,
  Navigation,
  Gauge,
  Activity,
  ArrowUp,
  AlertTriangle,
  RotateCcw,
  CheckCircle2
} from 'lucide-react';

interface FlightControllerCardProps {
  telemetry: DroneTelemetry;
  pixhawkState: PixhawkConnectionState;
  missionState: MissionState;
  isReadyForMission: boolean;
  forceBypassChecks: boolean;
  elapsedSeconds?: number;
  onStartMission: () => void;
  onStopAbortMission: () => void;
  onEmergencyRTL: () => void;
  className?: string;
}

export const FlightControllerCard: React.FC<FlightControllerCardProps> = ({
  telemetry,
  pixhawkState,
  missionState,
  isReadyForMission,
  forceBypassChecks,
  elapsedSeconds = 0,
  onStartMission,
  onStopAbortMission,
  onEmergencyRTL,
  className = ''
}) => {
  const [isArming, setIsArming] = useState<boolean>(false);
  const [isDisarming, setIsDisarming] = useState<boolean>(false);
  const [targetAltitude, setTargetAltitude] = useState<number>(15);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const isConnected = pixhawkState.isConnected || pixhawkState.isUsbConnected || pixhawkState.isRealHardware || pixhawkState.connectionType === 'SIMULATED';
  const isArmed = telemetry.isArmed;
  const activeMode = (telemetry.flightMode || 'STABILIZE').toUpperCase();

  const supportedModes = [
    'STABILIZE',
    'ALT_HOLD',
    'LOITER',
    'GUIDED',
    'AUTO',
    'RTL',
    'LAND'
  ];

  const isMissionRunning =
    missionState !== 'IDLE' &&
    missionState !== 'HOME_SET' &&
    missionState !== 'READY' &&
    missionState !== 'MISSION_COMPLETE' &&
    missionState !== 'ABORTED';

  const handleModeChange = async (mode: string) => {
    setFeedbackMsg(`Setting mode to ${mode}...`);
    const ok = await mavlinkService.setFlightMode(mode as any);
    if (ok) {
      setFeedbackMsg(`Flight Mode changed to ${mode} ✓`);
      setTimeout(() => setFeedbackMsg(null), 2500);
    } else {
      const errorMsg = pixhawkState.lastModeChangeError || `Mode ${mode} rejected: Pixhawk requires 3D GPS Fix (6+ sats). Use STABILIZE or ALT_HOLD for bench testing.`;
      setFeedbackMsg(errorMsg);
    }
  };

  const handleArm = async () => {
    if (!isConnected) {
      setFeedbackMsg('Flight controller not connected');
      return;
    }
    setFeedbackMsg(null);
    setIsArming(true);
    const sent = await mavlinkService.sendArmCommand(forceBypassChecks);
    if (!sent) {
      setIsArming(false);
      setFeedbackMsg('Arm command transmission failed');
      return;
    }
    // Check state update
    setTimeout(() => {
      setIsArming(false);
      if (mavlinkService.getTelemetry().isArmed) {
        setFeedbackMsg('Vehicle Armed ✓');
        setTimeout(() => setFeedbackMsg(null), 2000);
      }
    }, 1500);
  };

  const handleDisarm = async () => {
    if (!isConnected) return;
    setFeedbackMsg(null);
    setIsDisarming(true);
    const shouldForce = forceBypassChecks || (telemetry.altitude <= 1.0);
    const sent = await mavlinkService.sendDisarmCommand(shouldForce);
    setTimeout(() => {
      setIsDisarming(false);
      if (!mavlinkService.getTelemetry().isArmed) {
        setFeedbackMsg('Vehicle Disarmed ✓');
        setTimeout(() => setFeedbackMsg(null), 2000);
      } else {
        setFeedbackMsg(sent ? 'Disarm command transmitted' : 'Disarm command failed');
        setTimeout(() => setFeedbackMsg(null), 2000);
      }
    }, 1500);
  };

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-xl font-mono select-none space-y-4 ${className}`}>
      {/* 1. Header & Live Connection Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-sky-950/80 border border-sky-500/40 text-sky-400">
            <Gamepad2 className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs sm:text-sm font-black tracking-wider text-slate-100 uppercase">
              FLIGHT CONTROLLER
            </span>
            <div className="text-[10px] text-slate-400">
              Primary Vehicle Command & Telemetry Interface
            </div>
          </div>
        </div>

        {/* Connection & Timer Indicators */}
        <div className="flex items-center space-x-2.5 self-start sm:self-auto">
          {/* Mission Timer */}
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-950/90 border border-slate-800 text-[11px]">
            <span className="text-[10px] text-slate-400 font-bold uppercase">Timer:</span>
            <span className="font-extrabold text-amber-300">
              {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
            </span>
          </div>

          <span className={`px-2 py-0.5 rounded text-[11px] font-extrabold flex items-center space-x-1.5 border ${
            isConnected
              ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300'
              : 'bg-rose-950/80 border-rose-400 text-rose-300'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            <span>{isConnected ? '● Connected' : '○ Disconnected'}</span>
          </span>
        </div>
      </div>

      {/* 2. Real-Time Telemetry Row (Mode, GPS, Alt, Speed, Batt, Heading) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 bg-slate-950/70 p-3 rounded-lg border border-slate-800 text-xs">
        {/* Mode */}
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Mode:</span>
          <span className="text-xs font-black text-sky-400 truncate block">
            {activeMode}
          </span>
        </div>

        {/* GPS */}
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">GPS:</span>
          <span className={`text-xs font-black flex items-center space-x-1 ${
            (telemetry.gps?.satellites || 0) >= 6 ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            <span>● {telemetry.gps?.satellites || 0} satellites</span>
          </span>
        </div>

        {/* Altitude */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 uppercase font-bold block">Altitude (AGL):</span>
            {!telemetry.isArmed && (
              <button
                type="button"
                onClick={() => mavlinkService.calibrateGroundAltitude()}
                title="Zero Altitude (Recalibrate Ground Elevation AGL to 0.0m)"
                className="text-[9px] text-sky-400 hover:text-sky-300 hover:underline cursor-pointer"
              >
                Zero
              </button>
            )}
          </div>
          <span className="text-xs font-black text-amber-300">
            {telemetry.altitude.toFixed(1)} m
          </span>
        </div>

        {/* Ground Speed */}
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Ground Speed:</span>
          <span className="text-xs font-black text-slate-200">
            {telemetry.groundSpeed.toFixed(1)} m/s
          </span>
        </div>

        {/* Battery */}
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Battery:</span>
          <span className={`text-xs font-black ${
            telemetry.batteryPercent > 25 ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {telemetry.batteryPercent}%
          </span>
        </div>

        {/* Heading */}
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Heading:</span>
          <span className="text-xs font-black text-slate-200">
            {Math.round(telemetry.heading)}°
          </span>
        </div>
      </div>

      {/* 3. Controls: [ ARM ] [ DISARM ], Flight Mode Dropdown, Target Altitude */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
        {/* Arm / Disarm Buttons */}
        <div className="sm:col-span-4 flex items-center space-x-2">
          <button
            type="button"
            disabled={!isConnected || isArmed || isArming}
            onClick={handleArm}
            className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center space-x-1.5 transition ${
              isArmed
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-md shadow-emerald-600/30 cursor-pointer'
            } ${!isConnected || isArming ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{isArming ? 'ARMING...' : isArmed ? 'ARMED' : 'ARM'}</span>
          </button>

          <button
            type="button"
            disabled={!isConnected || isDisarming}
            onClick={handleDisarm}
            className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center space-x-1.5 transition ${
              !isArmed
                ? 'bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 cursor-pointer'
                : 'bg-rose-700 hover:bg-rose-600 active:bg-rose-800 text-white shadow-md shadow-rose-700/30 cursor-pointer'
            } ${!isConnected || isDisarming ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Send MAVLink DISARM command"
          >
            <Power className="w-3.5 h-3.5" />
            <span>{isDisarming ? 'DISARMING...' : isArmed ? 'DISARM' : 'FORCE DISARM'}</span>
          </button>
        </div>

        {/* Flight Mode Dropdown (Req 9: Supported modes dynamically populated) */}
        <div className="sm:col-span-5 flex items-center space-x-2">
          <label className="text-[11px] font-bold text-slate-400 uppercase shrink-0">
            Flight Mode:
          </label>
          <select
            value={activeMode}
            onChange={(e) => handleModeChange(e.target.value)}
            disabled={!isConnected}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white font-bold focus:border-sky-500 focus:outline-none cursor-pointer disabled:opacity-50"
          >
            {supportedModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>

        {/* Target Altitude */}
        <div className="sm:col-span-3 flex items-center space-x-2">
          <label className="text-[11px] font-bold text-slate-400 uppercase shrink-0">
            Altitude:
          </label>
          <div className="flex items-center space-x-1 w-full">
            <input
              type="number"
              min="2"
              max="100"
              step="1"
              value={targetAltitude}
              onChange={(e) => {
                const alt = parseInt(e.target.value) || 10;
                setTargetAltitude(alt);
                missionEngine.updateMissionConfig({ searchAltitude: alt });
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-xs text-amber-300 font-bold text-center focus:border-sky-500 focus:outline-none"
            />
            <span className="text-xs text-slate-400 shrink-0">m</span>
          </div>
        </div>
      </div>

      {feedbackMsg && (
        <div className="p-2 bg-sky-950/60 border border-sky-500/40 rounded-lg text-sky-300 text-xs flex items-center space-x-1.5 animate-in fade-in">
          <Activity className="w-3.5 h-3.5 shrink-0 text-sky-400" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* 4. Main Mission Controls: [ START MISSION ] (Primary Action), [ STOP / ABORT ], [ RTL ] */}
      <div className="pt-2 border-t border-slate-800/80 space-y-2">
        {/* Primary Action Button: START MISSION */}
        <button
          type="button"
          disabled={(!isReadyForMission && !forceBypassChecks) || isMissionRunning}
          onClick={onStartMission}
          className={`w-full py-3.5 sm:py-4 px-4 rounded-xl font-black text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition shadow-xl ${
            (isReadyForMission || forceBypassChecks) && !isMissionRunning
              ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-600/40 cursor-pointer animate-pulse'
              : 'bg-slate-800/80 text-slate-500 border border-slate-700/50 cursor-not-allowed'
          }`}
          title={
            forceBypassChecks
              ? 'FORCE START MISSION (Bypass active)'
              : !isReadyForMission
              ? 'Cannot start: System not ready or link disconnected'
              : 'Start Autonomous Mission'
          }
        >
          <Play className="w-4 h-4 fill-current" />
          <span>START MISSION</span>
        </button>

        {/* Secondary Mission Controls: [ STOP / ABORT ] and [ RTL ] (Separate per Req 11) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onStopAbortMission}
            className="py-2.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 transition shadow-md shadow-amber-600/30 cursor-pointer"
            title="Immediately Stop Autonomous Mission & Hold Position Safely (LOITER)"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>STOP / ABORT</span>
          </button>

          <button
            type="button"
            onClick={onEmergencyRTL}
            className="py-2.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 transition shadow-md shadow-rose-600/30 cursor-pointer"
            title="Command Flight Controller to Return-To-Launch"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>RTL</span>
          </button>
        </div>
      </div>
    </div>
  );
};
