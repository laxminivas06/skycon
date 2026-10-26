import React, { useState, useEffect } from 'react';
import { DroneTelemetry, HomePoint, MissionState, PreFlightChecklist as ChecklistType } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { mavlinkService } from '../../services/mavlinkService';
import { missionEngine } from '../../services/missionEngine';
import { runnerCommService } from '../../services/runnerCommService';
import { audioService } from '../../services/audioService';

// Stitch AI Tactical Cockpit Components
import { CockpitInstrumentsPanel } from './CockpitInstrumentsPanel';
import { TacticalCommandRail } from './TacticalCommandRail';
import { MissionProfileElevationDock } from './MissionProfileElevationDock';

// Workspace & Visual Feed Components
import { GoogleMapGroundStation } from './GoogleMapGroundStation';
import { LiveVideoFeed } from './LiveVideoFeed';

// Modals
import { AutonomousMissionConfigModal } from '../Mission/AutonomousMissionConfigModal';
import { CircleTestMissionModal } from '../Mission/CircleTestMissionModal';
import { LoiterTestMissionModal } from '../Mission/LoiterTestMissionModal';
import { GeofenceControlModal } from './GeofenceControlModal';
import { groundStationMissionService } from '../../services/groundStationMissionService';

// Detailed Multi-Card View Components
import { ConnectionStatusDeck } from '../common/ConnectionStatusDeck';
import { PixhawkConnectionCard } from '../Drone/PixhawkConnectionCard';
import { AutonomousMissionStatusBar } from '../Mission/AutonomousMissionStatusBar';
import { TelemetryHUD } from '../common/TelemetryHUD';
import { StatusBadge } from '../common/StatusBadge';
import { HomePointSetter } from './HomePointSetter';
import { PreArmChecksPanel } from '../common/PreArmChecksPanel';
import { ControlModePanel } from '../common/ControlModePanel';
import { MissionTimer } from '../common/MissionTimer';
import { LoiterTestMissionCard } from '../Mission/LoiterTestMissionCard';
import { CircleTestMissionCard } from '../Mission/CircleTestMissionCard';

import {
  Play,
  ShieldAlert,
  Power,
  Sliders,
  Settings,
  Map as MapIcon,
  Columns,
  Video as VideoIcon,
  Gauge,
  Eye,
  EyeOff,
  AlertTriangle,
  Clock,
  Radio,
  Cpu
} from 'lucide-react';

interface GroundStationDashboardProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  checklist: ChecklistType;
  isReadyForMission: boolean;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  onSetHomePoint: (coords?: { lat: number; lng: number }) => void;
  onStartMission: () => void;
  onEmergencyRTL: () => void;
  onSwitchToManual?: () => void;
  onOpenHistory?: () => void;
}

export const GroundStationDashboard: React.FC<GroundStationDashboardProps> = ({
  telemetry,
  homePoint,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  checklist,
  isReadyForMission,
  pixhawkState,
  runnerLink,
  onSetHomePoint,
  onStartMission,
  onEmergencyRTL,
  onSwitchToManual,
  onOpenHistory
}) => {
  // View Modes: COCKPIT (Default Stitch UI), DETAILED (Multi-card view), SPLIT, VIDEO
  const [viewMode, setViewMode] = useState<'COCKPIT' | 'DETAILED' | 'SPLIT' | 'VIDEO'>('COCKPIT');

  // Floating Overlay Toggles
  const [showInstruments, setShowInstruments] = useState<boolean>(true);
  const [isPipVideoVisible, setIsPipVideoVisible] = useState<boolean>(true);
  const [showTrafficRadar, setShowTrafficRadar] = useState<boolean>(true);

  // Modals
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [isCircleTestOpen, setIsCircleTestOpen] = useState<boolean>(false);
  const [isLoiterTestOpen, setIsLoiterTestOpen] = useState<boolean>(false);
  const [isGeofenceModalOpen, setIsGeofenceModalOpen] = useState<boolean>(false);

  // Arming & Pre-Arm State
  const [isArming, setIsArming] = useState<boolean>(false);
  const [isDisarming, setIsDisarming] = useState<boolean>(false);
  const [armFeedback, setArmFeedback] = useState<string | null>(null);
  const [forceBypassChecks, setForceBypassChecks] = useState<boolean>(() => missionEngine.getForceBypassChecks());

  // Mission Duration Configuration
  const configuredSecs = missionEngine.getMissionDurationSeconds();
  const [selectedDuration, setSelectedDuration] = useState<number>(configuredSecs);
  const [isCustom, setIsCustom] = useState<boolean>(![60, 120, 180, 300, 600].includes(configuredSecs));
  const [customMinutes, setCustomMinutes] = useState<string>(
    ![60, 120, 180, 300, 600].includes(configuredSecs) ? String(Math.round(configuredSecs / 60) || 1) : '4'
  );

  const missionValidation = missionEngine.validateMission();
  const missionConfig = missionEngine.getMissionConfig();

  const isMissionActive =
    missionState !== 'IDLE' &&
    missionState !== 'HOME_SET' &&
    missionState !== 'READY' &&
    missionState !== 'MISSION_COMPLETE';

  const isDroneAirborne = telemetry.isArmed && telemetry.altitude > 1.0;
  const isArmed = telemetry.isArmed;

  useEffect(() => {
    if (isArmed) {
      setIsArming(false);
      setArmFeedback(null);
    } else {
      setIsDisarming(false);
    }
  }, [isArmed]);

  // Dedicated Arm Handler with Watchdog
  const handleDedicatedArmClick = async (force: boolean = false) => {
    if (!pixhawkState.isConnected) {
      setArmFeedback('Flight controller not connected. Connect first.');
      return;
    }
    setArmFeedback(null);
    setIsArming(true);
    const sent = await mavlinkService.sendArmCommand(force);
    if (!sent) {
      setIsArming(false);
      setArmFeedback('ARM TRANSMISSION FAILED: Check WebSocket / ESP32 TX Link.');
      return;
    }
    const startWait = Date.now();
    const watchdog = setInterval(() => {
      if (mavlinkService.getTelemetry().isArmed) {
        setIsArming(false);
        setArmFeedback(null);
        clearInterval(watchdog);
      } else {
        const s = mavlinkService.getConnectionState();
        const lastAck = s.lastArmCommandAck || s.lastCommandAck;
        if (lastAck && lastAck.command === 400 && lastAck.result !== 0) {
          setIsArming(false);
          clearInterval(watchdog);
          const reason = s.preArmFailReason || (s.statusHistory?.length ? s.statusHistory[0].text : undefined);
          let msg = `ARM REJECTED by Pixhawk (${lastAck.resultName || 'FAILED'})`;
          if (reason) msg += ` — ${reason}`;
          setArmFeedback(msg);
          return;
        }
        if (Date.now() - startWait > 4500) {
          setIsArming(false);
          clearInterval(watchdog);
          setArmFeedback(s.preArmFailReason ? `ARM REJECTED: ${s.preArmFailReason}` : 'ARM ACK TIMEOUT');
        }
      }
    }, 200);
  };

  // Dedicated Disarm Handler
  const handleDedicatedDisarmClick = async (force: boolean = false) => {
    const isConn = pixhawkState.isConnected || pixhawkState.isUsbConnected || pixhawkState.isRealHardware || pixhawkState.connectionType === 'SIMULATED';
    if (!isConn) {
      setArmFeedback('Flight controller not connected. Connect first.');
      return;
    }
    setArmFeedback(null);
    setIsDisarming(true);
    const shouldForce = force || telemetry.altitude <= 1.0;
    const sent = await mavlinkService.sendDisarmCommand(shouldForce);
    if (!sent) {
      setIsDisarming(false);
      setArmFeedback('Disarm command transmission failed.');
      return;
    }
    const startWait = Date.now();
    const watchdog = setInterval(() => {
      if (!mavlinkService.getTelemetry().isArmed) {
        setIsDisarming(false);
        setArmFeedback(null);
        clearInterval(watchdog);
      } else if (Date.now() - startWait > 4500) {
        setIsDisarming(false);
        clearInterval(watchdog);
      }
    }, 250);
  };

  // Stitch Tactical Command Rail Handlers
  const handleTakeoff = async () => {
    if (!telemetry.isArmed) {
      const armed = await mavlinkService.sendArmCommand(forceBypassChecks);
      if (!armed) return;
    }
    await mavlinkService.commandTakeoff(telemetry.targetAltitude || 5.0);
    audioService.playBeep(880, 100);
  };

  const handleLoiter = async () => {
    await mavlinkService.setFlightMode('LOITER');
    audioService.playBeep(660, 80);
  };

  const handleLand = async () => {
    await mavlinkService.setFlightMode('LAND');
    audioService.playBeep(520, 80);
  };

  const handleDropPayload = () => {
    const qr = missionEngine.getDecodedQR();
    if (qr?.code) {
      runnerCommService.sendQRToRunner(qr.code, 'MISSION_RESCUE_01');
    } else {
      mavlinkService.sendMavlinkCommandLong(183 /* MAV_CMD_DO_SET_SERVO */, 9, 2000);
    }
    audioService.playBeep(1040, 150);
  };

  const handleSetAltitude = async (alt: number) => {
    await mavlinkService.setTargetAltitude(alt);
  };

  const handleArmToggle = () => {
    if (telemetry.isArmed) {
      handleDedicatedDisarmClick();
    } else {
      handleDedicatedArmClick(forceBypassChecks);
    }
  };

  const handleStartMissionClick = () => {
    missionEngine.startMission(forceBypassChecks);
    onStartMission();
  };

  // Helper formatting for flight elapsed time
  const formatFlightTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="relative w-full h-[calc(100vh-48px)] bg-[#121315] text-slate-100 overflow-hidden select-none flex flex-col font-mono">
      {/* ============================================================ */}
      {/* 1. TACTICAL TOP STATUS & VIEW CONTROL RIBBON                */}
      {/* ============================================================ */}
      <div className="h-9 px-3 bg-[#1b1c1e]/90 border-b border-[#343537]/80 backdrop-blur-md flex items-center justify-between z-40 text-xs shrink-0">
        {/* Left: View Mode Switcher */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode('COCKPIT')}
            className={`px-2.5 py-1 rounded text-[10px] font-sans font-bold uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer ${
              viewMode === 'COCKPIT'
                ? 'bg-[#2f6fd6] text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-[#292a2c]'
            }`}
            title="Full-Bleed Stitch Aerospace Cockpit Workspace"
          >
            <span className="material-symbols-outlined text-[14px]">view_in_ar</span>
            <span>TACTICAL COCKPIT</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('DETAILED')}
            className={`px-2.5 py-1 rounded text-[10px] font-sans font-bold uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer ${
              viewMode === 'DETAILED'
                ? 'bg-[#2f6fd6] text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-[#292a2c]'
            }`}
            title="Multi-Panel Detailed Telemetry Grid"
          >
            <Columns className="w-3 h-3" />
            <span>DETAILED PANELS</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('SPLIT')}
            className={`px-2.5 py-1 rounded text-[10px] font-sans font-bold uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer ${
              viewMode === 'SPLIT'
                ? 'bg-[#2f6fd6] text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-[#292a2c]'
            }`}
            title="Split Recon Stream & Map"
          >
            <VideoIcon className="w-3 h-3" />
            <span>SPLIT RECON</span>
          </button>
        </div>

        {/* Center: Live Mission Quick Telemetry Badges */}
        <div className="hidden md:flex items-center gap-2 font-mono text-[10px]">
          <div className="flex items-center gap-1 bg-[#0d0e10] px-2 py-0.5 rounded border border-[#343537]/50">
            <span className="text-slate-400">MODE:</span>
            <span className="text-[#aec6ff] font-bold">{telemetry.flightMode || 'GUIDED'}</span>
          </div>

          <div className="flex items-center gap-1 bg-[#0d0e10] px-2 py-0.5 rounded border border-[#343537]/50">
            <span className="text-slate-400">ALT:</span>
            <span className="text-[#57df85] font-bold">{(telemetry.altitude || 0).toFixed(1)}m</span>
          </div>

          <div className="flex items-center gap-1 bg-[#0d0e10] px-2 py-0.5 rounded border border-[#343537]/50">
            <span className="text-slate-400">SPD:</span>
            <span className="text-[#ffb95f] font-bold">{(telemetry.groundSpeed || 0).toFixed(1)} m/s</span>
          </div>

          <div className="flex items-center gap-1 bg-[#0d0e10] px-2 py-0.5 rounded border border-[#343537]/50">
            <span className="text-slate-400">GPS:</span>
            <span className="text-slate-200 font-bold">{telemetry.gps?.satellites ?? telemetry.satellitesVisible ?? 0} Sats</span>
          </div>

          <div className="flex items-center gap-1 bg-[#0d0e10] px-2 py-0.5 rounded border border-[#343537]/50">
            <span className="text-slate-400">BATT:</span>
            <span className="text-[#57df85] font-bold">{telemetry.batteryPercent || 88}%</span>
          </div>
        </div>

        {/* Right: Quick Overlay Toggles & Config */}
        <div className="flex items-center gap-1.5">
          {viewMode === 'COCKPIT' && (
            <>
              <button
                type="button"
                onClick={() => setShowInstruments(!showInstruments)}
                className={`px-2 py-1 rounded text-[10px] font-sans font-bold flex items-center gap-1 transition-colors cursor-pointer border ${
                  showInstruments
                    ? 'bg-[#292a2c] text-[#aec6ff] border-[#2f6fd6]/40'
                    : 'bg-[#1f2022] text-slate-400 border-[#343537]'
                }`}
                title="Toggle Instruments Overlay"
              >
                <Gauge className="w-3 h-3" />
                <span className="hidden sm:inline">GAUGES</span>
              </button>

              <button
                type="button"
                onClick={() => setIsPipVideoVisible(!isPipVideoVisible)}
                className={`px-2 py-1 rounded text-[10px] font-sans font-bold flex items-center gap-1 transition-colors cursor-pointer border ${
                  isPipVideoVisible
                    ? 'bg-[#292a2c] text-[#57df85] border-[#008442]/40'
                    : 'bg-[#1f2022] text-slate-400 border-[#343537]'
                }`}
                title="Toggle PiP Camera Feed"
              >
                <VideoIcon className="w-3 h-3" />
                <span className="hidden sm:inline">PIP CAM</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setIsConfigModalOpen(true)}
            className="px-2 py-1 rounded bg-[#1f2022] hover:bg-[#292a2c] text-[#ffb95f] border border-[#343537] text-[10px] font-sans font-bold flex items-center gap-1 transition-colors cursor-pointer"
            title="Configure Autonomous Search & Mission Parameters"
          >
            <Settings className="w-3 h-3" />
            <span className="hidden sm:inline">CONFIG</span>
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2. MAIN COCKPIT VIEWPORT (IMAGE 1 WORKSTATION ARCHITECTURE) */}
      {/* ============================================================ */}
      {/* ============================================================ */}
      {/* 2. MAIN COCKPIT VIEWPORT (UPPER-LEFT GAUGES + MAP + BIG CAM) */}
      {/* ============================================================ */}
      {viewMode === 'COCKPIT' && (
        <div className="flex-1 flex overflow-hidden relative">
          {/* ======================================================== */}
          {/* A. CENTER / MAIN MAP WORKSPACE WITH FLOATING INSTRUMENTS */}
          {/* ======================================================== */}
          <div className="flex-1 relative h-full overflow-hidden">
            {/* Background Interactive Google Maps Engine Workspace */}
            <div className="absolute inset-0 z-0">
              <GoogleMapGroundStation
                telemetry={telemetry}
                homePoint={homePoint}
                pixhawkState={pixhawkState}
                missionState={missionState}
                onSetHomePoint={onSetHomePoint}
                onStartMission={onStartMission}
                onEmergencyRTL={onEmergencyRTL}
                isPipVideoVisible={false}
                isCockpitView={true}
                className="w-full h-full"
              />
            </div>

            {/* Upper-Left Corner: Authentic 6-Pack Flight Instruments Cluster */}
            {showInstruments && (
              <div className="absolute left-3 top-3 z-30 w-80 sm:w-84 max-h-[380px] shadow-2xl animate-in fade-in">
                <CockpitInstrumentsPanel
                  telemetry={telemetry}
                  flightTimeStr={formatFlightTime(elapsedSeconds)}
                  onOpenSettings={() => setIsConfigModalOpen(true)}
                  className="w-full"
                />
              </div>
            )}

            {/* Tactical Command Rail (Takeoff, Loiter, Land, RTL, Tools) */}
            <TacticalCommandRail
              className={`absolute top-3 z-30 transition-all ${
                showInstruments ? 'left-[360px]' : 'left-3'
              }`}
              isArmed={telemetry.isArmed}
              flightMode={telemetry.flightMode || 'GUIDED'}
              onTakeoff={handleTakeoff}
              onLoiter={handleLoiter}
              onLand={handleLand}
              onEmergencyRTL={onEmergencyRTL}
              onOpenSettings={() => setIsConfigModalOpen(true)}
              onTogglePlayMission={handleStartMissionClick}
              onOpenGeofence={() => setIsGeofenceModalOpen(true)}
              onDeleteMission={() => groundStationMissionService.deleteMission()}
            />

            {/* Live Arm/Disarm Feedback Alert Banner */}
            {armFeedback && !isArmed && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-[#93000a]/90 border border-[#ffb4ab] text-white px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-sans">
                <AlertTriangle className="w-4 h-4 text-[#ffb4ab] shrink-0" />
                <span>{armFeedback}</span>
                <button
                  type="button"
                  onClick={() => setArmFeedback(null)}
                  className="ml-2 text-white/80 hover:text-white"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* B. RIGHT SIDEBAR: BIG SCREEN CAMERA LIVE RECON FEED      */}
          {/* ======================================================== */}
          {isPipVideoVisible && (
            <aside className="w-88 md:w-96 lg:w-[440px] xl:w-[480px] 2xl:w-[540px] h-full flex flex-col bg-[#141518]/95 backdrop-blur-md border-l border-[#2d2e33] shrink-0 z-20 shadow-2xl overflow-hidden select-none">
              {/* 1. Header Bar */}
              <div className="px-3 py-2 bg-[#1b1c20] border-b border-[#2d2e33] flex items-center justify-between text-slate-200">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shadow-sm shadow-rose-500" />
                  <span className="font-sans text-xs uppercase font-extrabold tracking-wider text-white">
                    OPTICAL RECON FEED
                  </span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-bold">
                    LIVE 1080P
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-500/50 text-sky-300">
                    30 FPS
                  </span>
                  <button
                    onClick={() => setViewMode('SPLIT')}
                    className="w-6 h-6 rounded hover:bg-[#2a2b30] flex items-center justify-center text-slate-400 hover:text-white transition cursor-pointer"
                    title="Expand / Fullscreen Feed"
                  >
                    <span className="material-symbols-outlined text-[15px]">fullscreen</span>
                  </button>
                </div>
              </div>

              {/* 2. Big Screen Video Canvas */}
              <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center min-h-[300px]">
                <LiveVideoFeed className="w-full h-full object-cover" />

                {/* Tactical HUD Crosshair Overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-16 h-16 border border-emerald-500/50 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-ping" />
                  </div>
                  <div className="absolute w-28 h-px bg-emerald-500/30" />
                  <div className="absolute h-28 w-px bg-emerald-500/30" />
                </div>

                {/* Target Lock Bounding Box (HUD Overlay - Bottom Left of Video) */}
                <div className="absolute bottom-11 left-2 px-2.5 py-1 rounded-lg bg-black/85 backdrop-blur-sm border border-emerald-500/70 flex flex-col text-[10px] pointer-events-none z-10 shadow-lg">
                  <div className="flex items-center gap-1.5 font-sans font-black text-emerald-400 uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>TARGET BOX 42</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[9px] font-mono text-slate-300 mt-0.5">
                    <span>CONFIDENCE: <strong className="text-emerald-300">94%</strong></span>
                    <span>LOCK: <strong className="text-sky-300">ACQUIRED</strong></span>
                  </div>
                </div>

                {/* QR Code Decoded Badge (HUD Overlay - Bottom Right of Video) */}
                <div className="absolute bottom-11 right-2 px-2.5 py-1 rounded-lg bg-black/85 backdrop-blur-sm border border-sky-500/70 flex flex-col text-[10px] pointer-events-none z-10 shadow-lg">
                  <div className="flex items-center gap-1.5 font-sans font-black text-sky-400 uppercase">
                    <span className="material-symbols-outlined text-[12px] text-sky-400">qr_code_2</span>
                    <span>QR PAYLOAD</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[9px] font-mono text-slate-300 mt-0.5">
                    <span>CODE: <strong className="text-sky-300 text-xs font-bold">42</strong></span>
                    <span className="text-emerald-400 font-bold">ACK OK</span>
                  </div>
                </div>

                {/* Flight Telemetry HUD Tape (Bottom of Video Feed) */}
                <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1.5 rounded-lg bg-black/80 backdrop-blur-sm border border-slate-700/80 flex items-center justify-between text-[10px] font-mono text-slate-200 pointer-events-none z-10">
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">ALT:</span>
                    <span className="text-white font-bold">{(telemetry.altitude || 0).toFixed(1)}m</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">SPD:</span>
                    <span className="text-white font-bold">{(telemetry.groundSpeed || 0).toFixed(1)}m/s</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">HDG:</span>
                    <span className="text-sky-300 font-bold">{Math.round(((telemetry.heading || 0) % 360 + 360) % 360)}°</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">MODE:</span>
                    <span className="text-emerald-400 font-bold">{telemetry.flightMode || 'GUIDED'}</span>
                  </div>
                </div>
              </div>

              {/* 3. Recon Status & Mission Target Summary */}
              <div className="p-2.5 bg-[#17181c] border-t border-[#2d2e33] flex flex-col gap-2 font-mono text-[11px]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#0f1013] p-2 rounded-xl border border-[#27282e] flex flex-col">
                    <span className="text-[9px] text-slate-400 uppercase font-sans font-bold">Runner P2P Link</span>
                    <span className="text-emerald-400 font-bold text-xs mt-0.5">DISPATCH READY</span>
                    <span className="text-[8px] text-slate-500 font-mono">10-15m Range • Field Unit</span>
                  </div>
                  <div className="bg-[#0f1013] p-2 rounded-xl border border-[#27282e] flex flex-col">
                    <span className="text-[9px] text-slate-400 uppercase font-sans font-bold">Optical Servoing</span>
                    <span className="text-sky-300 font-bold text-xs mt-0.5">TRACKING ACTIVE</span>
                    <span className="text-[8px] text-slate-500 font-mono">Center Deviation &lt; 5px</span>
                  </div>
                </div>

                {/* Bottom Action Controls */}
                <div className="flex items-center justify-between pt-1 border-t border-[#25262c]">
                  <button
                    type="button"
                    onClick={() => setIsConfigModalOpen(true)}
                    className="px-2.5 py-1 rounded-lg bg-[#222329] hover:bg-[#2c2d35] text-slate-300 hover:text-white border border-[#34353d] text-[10px] font-sans font-bold flex items-center gap-1 transition cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[13px]">tune</span>
                    <span>Camera Settings</span>
                  </button>
                  <div className="flex items-center gap-1.5 text-[9px] text-slate-400">
                    <span>RECON LATENCY:</span>
                    <span className="text-emerald-400 font-bold">38ms</span>
                  </div>
                </div>
              </div>
            </aside>
          )}

          <button
            type="button"
            onClick={() => setIsConfigModalOpen(true)}
            className="px-2 py-1 rounded bg-[#1f2022] hover:bg-[#292a2c] text-[#ffb95f] border border-[#343537] text-[10px] font-sans font-bold flex items-center gap-1 transition-colors cursor-pointer"
            title="Configure Autonomous Search & Mission Parameters"
          >
            <Settings className="w-3 h-3" />
            <span className="hidden sm:inline">CONFIG</span>
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* 3. SPLIT RECON VIEWPORT (Split 50/50 Video & Map)            */}
      {/* ============================================================ */}
      {viewMode === 'SPLIT' && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-2 p-2 overflow-hidden">
          <div className="rounded-xl overflow-hidden border border-[#343537] bg-black">
            <LiveVideoFeed className="w-full h-full object-cover" />
          </div>
          <div className="rounded-xl overflow-hidden border border-[#343537] relative">
            <GoogleMapGroundStation
              telemetry={telemetry}
              homePoint={homePoint}
              pixhawkState={pixhawkState}
              missionState={missionState}
              onSetHomePoint={onSetHomePoint}
              onStartMission={onStartMission}
              onEmergencyRTL={onEmergencyRTL}
              className="w-full h-full"
            />
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. FULL RECON VIDEO STREAM VIEWPORT                          */}
      {/* ============================================================ */}
      {viewMode === 'VIDEO' && (
        <div className="flex-1 p-2 overflow-hidden flex flex-col">
          <div className="flex-1 rounded-xl overflow-hidden border border-[#343537] bg-black relative">
            <LiveVideoFeed className="w-full h-full object-cover" />
            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
              <button
                onClick={handleTakeoff}
                className="px-3 py-1.5 rounded-lg bg-[#2f6fd6] text-white font-sans text-xs font-bold uppercase shadow-lg"
              >
                Takeoff 5m
              </button>
              <button
                onClick={handleLoiter}
                className="px-3 py-1.5 rounded-lg bg-[#ee9800] text-[#5b3800] font-sans text-xs font-bold uppercase shadow-lg"
              >
                Loiter
              </button>
              <button
                onClick={onEmergencyRTL}
                className="px-3 py-1.5 rounded-lg bg-[#93000a] text-white font-sans text-xs font-bold uppercase shadow-lg"
              >
                RTL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 5. MULTI-PANEL DETAILED GRID VIEWPORT (Scrollable Cards)      */}
      {/* ============================================================ */}
      {viewMode === 'DETAILED' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-7xl mx-auto w-full">
          <ConnectionStatusDeck
            pixhawkState={pixhawkState}
            runnerLink={runnerLink}
            telemetry={telemetry}
          />

          <PixhawkConnectionCard connectionState={pixhawkState} />

          <AutonomousMissionStatusBar
            telemetry={telemetry}
            missionState={missionState}
            pixhawkState={pixhawkState}
            onOpenConfig={() => setIsConfigModalOpen(true)}
            isAuthorizedOperator={true}
          />

          <TelemetryHUD telemetry={telemetry} />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-6 space-y-4">
              <LoiterTestMissionCard
                telemetry={telemetry}
                homePoint={homePoint}
                pixhawkState={pixhawkState}
              />
              <CircleTestMissionCard
                telemetry={telemetry}
                homePoint={homePoint}
                pixhawkState={pixhawkState}
              />
              <MissionTimer
                remainingSeconds={remainingSeconds}
                elapsedSeconds={elapsedSeconds}
                missionState={missionState}
              />
              <HomePointSetter
                homePoint={homePoint}
                gps={telemetry.gps}
                onSetHomePoint={onSetHomePoint}
                disabled={isMissionActive}
              />
            </div>

            <div className="lg:col-span-6 space-y-4">
              <PreArmChecksPanel
                connectionState={pixhawkState}
                telemetry={telemetry}
                homePoint={homePoint}
                isReady={missionValidation.isValid}
              />
              <ControlModePanel
                telemetry={telemetry}
                connectionState={pixhawkState}
                onArmClick={handleDedicatedArmClick}
                onDisarmClick={() => handleDedicatedDisarmClick(telemetry.altitude <= 1.0)}
                isArmingInProgress={isArming}
                isDisarmingInProgress={isDisarming}
              />
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 6. MODALS                                                    */}
      {/* ============================================================ */}
      <AutonomousMissionConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        telemetry={telemetry}
        homePoint={homePoint}
        pixhawkState={pixhawkState}
        missionState={missionState}
        onStartMission={onStartMission}
      />

      <CircleTestMissionModal
        isOpen={isCircleTestOpen}
        onClose={() => setIsCircleTestOpen(false)}
        telemetry={telemetry}
        homePoint={homePoint}
        pixhawkState={pixhawkState}
      />

      <LoiterTestMissionModal
        isOpen={isLoiterTestOpen}
        onClose={() => setIsLoiterTestOpen(false)}
        telemetry={telemetry}
        homePoint={homePoint}
        pixhawkState={pixhawkState}
      />

      <GeofenceControlModal
        isOpen={isGeofenceModalOpen}
        onClose={() => setIsGeofenceModalOpen(false)}
      />
    </div>
  );
};
