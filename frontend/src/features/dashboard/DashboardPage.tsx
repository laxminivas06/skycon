import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  X,
  ArrowUp,
  ArrowDown,
  Pause,
  Crosshair,
  Send,
  Calendar,
  Power
} from 'lucide-react';
import { useDashboardTelemetry } from '../../hooks/useDashboardTelemetry';
import { mavlinkService } from '../../services/mavlinkService';
import { missionEngine } from '../../services/missionEngine';
import { groundStationMissionService, computeDestination } from '../../services/groundStationMissionService';
import { runnerCommService } from '../../services/runnerCommService';
import { audioService } from '../../services/audioService';
import { geofenceService } from '../../services/geofenceService';
import { Header } from './Header';
import { TelemetryPanel } from './TelemetryPanel';
import { FlightOperationsCard } from './FlightOperationsCard';
import { ManualMissionControlCard } from './ManualMissionControlCard';
import { AutonomousMissionControlCard } from './AutonomousMissionControlCard';
import { PreflightValidationModal } from './PreflightValidationModal';
import { MapPanel } from './MapPanel';
import { CameraFeed } from './CameraFeed';
import { WaypointManager } from './WaypointManager';
import { FlightParams } from './FlightParams';
import { AutonomousMissionConfigModal } from '../../components/Mission/AutonomousMissionConfigModal';
import { MissionHistoryModal } from '../../components/History/MissionHistoryModal';
import { SerialDiagnosticsModal } from '../../components/Drone/SerialDiagnosticsModal';
import { AppRole } from '../../types/mission';

interface DashboardPageProps {
  onLogout?: () => void;
  currentRole?: AppRole;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  onLogout,
  currentRole = 'GROUND_STATION',
}) => {
  const telemetry = useDashboardTelemetry();
  // Section 3: Two Primary Mission Modes (MANUAL and AUTONOMOUS)
  const [missionMode, setMissionMode] = useState<'MANUAL' | 'AUTONOMOUS'>(
    () => (localStorage.getItem('sae_gcs_mission_mode') as 'MANUAL' | 'AUTONOMOUS') || 'MANUAL'
  );
  const [activeTab, setActiveTab] = useState<'Plan' | 'Fly' | 'Logs'>('Fly');
  const [activeNav, setActiveNav] = useState<string>('Dashboard');
  const [mobileView, setMobileView] = useState<'telemetry' | 'map' | 'operations'>('map');
  const [showPreflightModal, setShowPreflightModal] = useState<boolean>(false);
  const [showRtlModal, setShowRtlModal] = useState<boolean>(false);
  const [rtlConfirmPending, setRtlConfirmPending] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Synchronized active mission state (survives page refresh via backend /api/missions/active)
  const [activeMissionData, setActiveMissionData] = useState<{
    elapsedSeconds: number;
    remainingSeconds: number;
    status: string;
    deadline?: number;
    isExecuting: boolean;
  } | null>(null);

  const rtlTimerRef = useRef<NodeJS.Timeout | null>(null);
  const userSelectedModeRef = useRef<boolean>(false);
  const initialSyncDoneRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (rtlTimerRef.current) clearTimeout(rtlTimerRef.current);
    };
  }, []);

  // Poll backend for active mission every 2s to survive GCS browser refreshes
  useEffect(() => {
    let isMounted = true;
    const fetchActiveMission = async () => {
      try {
        const res = await fetch('/api/missions/active');
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.success && data.active && data.mission) {
            setActiveMissionData({
              elapsedSeconds: data.mission.elapsedSeconds || 0,
              remainingSeconds: data.mission.remainingSeconds || 0,
              status: data.mission.status || 'EXECUTING',
              deadline: data.mission.deadline,
              isExecuting: data.mission.status === 'EXECUTING',
            });
            // Only synchronize mission mode on initial mount if operator hasn't explicitly selected one
            if (!initialSyncDoneRef.current && !userSelectedModeRef.current) {
              initialSyncDoneRef.current = true;
              if (data.mission.status === 'EXECUTING' && (data.mission.mode === 'AUTONOMOUS' || data.mission.mode === 'MANUAL')) {
                setMissionMode(data.mission.mode);
                localStorage.setItem('sae_gcs_mission_mode', data.mission.mode);
              }
            }
          } else if (isMounted && !data.active) {
            setActiveMissionData(null);
            initialSyncDoneRef.current = true;
          }
        }
      } catch (e) {
        // network silent retry
      }
    };

    fetchActiveMission();
    const interval = setInterval(fetchActiveMission, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Modals & Overlays (Streamlined essential cockpit modals)
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [isDiagnosticsModalOpen, setIsDiagnosticsModalOpen] = useState<boolean>(false);
  const [isFlightControlModalOpen, setIsFlightControlModalOpen] = useState<boolean>(false);

  const showNotification = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 4000);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as any);
    audioService.playBeep(700, 50);

    if (tab === 'Logs') {
      setActiveNav('Logs');
      showNotification('Flight Logs & MAVLink Telemetry Deck active');
    } else if (tab === 'Plan') {
      showNotification('Plan Mode Active: Define waypoints, search patterns, and geofence.');
    } else if (tab === 'Fly') {
      setActiveNav('Dashboard');
    }
  };

  const handleNavChange = (nav: string) => {
    setActiveNav(nav);
    audioService.playBeep(650, 40);

    if (nav === 'Mission' || nav === 'Mission Plan') {
      setIsConfigModalOpen(true);
    } else if (nav === 'Diagnostics' || nav === 'Telemetry') {
      setIsDiagnosticsModalOpen(true);
    } else if (nav === 'Logs' || nav === 'Flight Logs') {
      setActiveTab('Logs');
    } else if (nav === 'Flight Control') {
      setIsFlightControlModalOpen(true);
    } else if (nav === 'Dashboard' || nav === 'Cockpit') {
      setActiveTab('Fly');
      setActiveNav('Dashboard');
    }
  };

  const handleToggleRC = () => {
    const nextState = mavlinkService.toggleRCOverride();
    audioService.playBeep(nextState ? 950 : 520, 90);
    showNotification(
      nextState
        ? '🎮 RC MANUAL CONTROL OVERRIDE: ON (Handheld Transmitter in Command)'
        : '🤖 RC OVERRIDE: OFF (Autonomous GCS Navigation Active)'
    );
  };

  const handleToggleArm = async (force: boolean = false) => {
    if (telemetry.isArmed) {
      showNotification('Disarming vehicle motors...');
      audioService.playBeep(450, 120);
      try {
        const success = await mavlinkService.sendDisarmCommand(force);
        if (success) {
          showNotification('Vehicle Disarmed ✓');
          audioService.playBeep(350, 150);
        } else {
          showNotification('Disarm rejected by Pixhawk (Confirm vehicle is landed or use Force Disarm)');
        }
      } catch (err: any) {
        showNotification(`Disarm failed: ${err?.message || 'Check connection'}`);
      }
    } else {
      const geofenceCheck = geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude);
      if (!geofenceCheck.canArm && !force) {
        audioService.playBeep(350, 200);
        showNotification(`❌ ${geofenceCheck.reason}`);
        return;
      }
      showNotification('Sending ARM command to flight controller...');
      audioService.playBeep(850, 100);
      try {
        const success = await mavlinkService.sendArmCommand(false);
        if (success) {
          showNotification('Vehicle Armed — Motors spinning ✓');
          audioService.playBeep(1100, 150);
        } else {
          showNotification('Arm rejected by Pixhawk. Check safety switch, GPS 3D fix, and compass.');
        }
      } catch (err: any) {
        showNotification(`Arm failed: ${err?.message || 'Check pre-arm conditions'}`);
      }
    }
  };

  const handleNudge = async (direction: 'N' | 'S' | 'E' | 'W' | 'UP' | 'DOWN', distanceMeters: number = 5) => {
    if (direction !== 'UP' && direction !== 'DOWN') {
      if (!telemetry.isGpsValid || !telemetry.latitude || Math.abs(telemetry.latitude) <= 0.001) {
        showNotification('⚠️ Cannot nudge drone: Pixhawk GPS Signal Unavailable (No Lock)');
        return;
      }
    }
    const lat = telemetry.latitude;
    const lon = telemetry.longitude;
    const alt = telemetry.altitudeMeters || 5.0;

    let targetLat = lat;
    let targetLon = lon;
    let targetAlt = alt;

    if (direction === 'N') {
      const dest = computeDestination(lat, lon, distanceMeters, 0);
      targetLat = dest.lat; targetLon = dest.lng;
    } else if (direction === 'S') {
      const dest = computeDestination(lat, lon, distanceMeters, 180);
      targetLat = dest.lat; targetLon = dest.lng;
    } else if (direction === 'E') {
      const dest = computeDestination(lat, lon, distanceMeters, 90);
      targetLat = dest.lat; targetLon = dest.lng;
    } else if (direction === 'W') {
      const dest = computeDestination(lat, lon, distanceMeters, 270);
      targetLat = dest.lat; targetLon = dest.lng;
    } else if (direction === 'UP') {
      targetAlt = Math.min(120, alt + 2);
    } else if (direction === 'DOWN') {
      targetAlt = Math.max(1, alt - 2);
    }

    try {
      if (direction === 'UP' || direction === 'DOWN') {
        await mavlinkService.commandVerticalAltitude(targetAlt);
        showNotification(`Vertical ${direction === 'UP' ? 'Climb ▲' : 'Descent ▼'} to ${targetAlt.toFixed(1)}m at current location ✓`);
      } else {
        await mavlinkService.flyToPosition(targetLat, targetLon, targetAlt);
        showNotification(`Nudged ${direction} by ${distanceMeters}m`);
      }
      audioService.playBeep(880, 80);
    } catch (err: any) {
      showNotification(`Nudge failed: ${err?.message || 'Error'}`);
    }
  };

  const handleArmAndFly = () => {
    setShowPreflightModal(true);
    audioService.playBeep(900, 100);
  };

  const confirmArmAndLaunch = async () => {
    const geofenceCheck = geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude);
    if (!geofenceCheck.canArm) {
      audioService.playBeep(350, 200);
      showNotification(`❌ ${geofenceCheck.reason}`);
      return;
    }
    setShowPreflightModal(false);
    showNotification(`Arming flight controller and starting ${missionMode} mission...`);
    try {
      const currentMission = groundStationMissionService.getCurrentMission();
      let started = false;
      let statusMsg = '';

      if (currentMission && currentMission.waypoints && currentMission.waypoints.length > 0) {
        const res = await groundStationMissionService.startGroundStationMission(false);
        started = res.success;
        statusMsg = res.message;
      } else if (missionEngine?.startMission) {
        started = missionEngine.startMission();
        statusMsg = started ? `Autonomous ${missionMode} mission commenced` : 'Mission pre-flight checks rejected arming';
      } else {
        const armSuccess = await mavlinkService.sendArmCommand(false);
        if (armSuccess) {
          await mavlinkService.setFlightMode('AUTO');
          started = true;
          statusMsg = 'Armed and switched to AUTO mode';
        } else {
          started = false;
          statusMsg = 'Pixhawk rejected arm command';
        }
      }

      if (!started) {
        audioService.playBeep(300, 300, 'sawtooth');
        showNotification(`❌ Start Mission rejected: ${statusMsg}`);
        return;
      }

      showNotification(`🚀 ${statusMsg}`);

      // Register active mission with backend /api/missions (preserves start time & deadline)
      const m = groundStationMissionService.getCurrentMission();
      const timeLimitMin = 10;
      const now = Date.now();
      const deadline = now + timeLimitMin * 60 * 1000;

      fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: m?.id || `MISS_${now}`,
          mode: missionMode,
          algorithm: m?.missionType === 'SEARCH' ? 'SPIRAL' : 'TANGENTIAL_CIRCULAR',
          searchCenter: m?.geometry?.circleCenter || { lat: telemetry.latitude, lng: telemetry.longitude },
          searchRadiusMeters: m?.geometry?.circleRadiusMeters || 10,
          plannedAltitudeMeters: m?.altitude || 10,
          timeLimitMinutes: timeLimitMin,
          startTime: now,
          deadline,
          waypoints: m?.waypoints || [],
          status: 'EXECUTING',
        }),
      }).catch(() => {});

      setActiveMissionData({
        elapsedSeconds: 0,
        remainingSeconds: timeLimitMin * 60,
        status: 'EXECUTING',
        deadline,
        isExecuting: true,
      });

      showNotification(`Vehicle Armed — ${missionMode} mission initiated ✓`);
      audioService.playBeep(1000, 120);
    } catch (err: any) {
      showNotification(`Mission start failed: ${err?.message || 'Check pre-arm conditions'}`);
      throw err;
    }
  };

  const handleEmergencyRTL = async () => {
    if (!rtlConfirmPending) {
      // 1st Click: Prime RTL confirmation with 4-second auto-disarm timer
      setRtlConfirmPending(true);
      audioService.playBeep(450, 150);
      showNotification('⚠️ CONFIRM RTL: Click the button a 2nd time within 4s to Return to Launch!');
      if (rtlTimerRef.current) clearTimeout(rtlTimerRef.current);
      rtlTimerRef.current = setTimeout(() => {
        setRtlConfirmPending(false);
      }, 4000);
    } else {
      // 2nd Click: Immediately execute Return to Launch without blocking modals
      if (rtlTimerRef.current) {
        clearTimeout(rtlTimerRef.current);
        rtlTimerRef.current = null;
      }
      setRtlConfirmPending(false);
      setShowRtlModal(false);
      showNotification('🚨 EMERGENCY RTL EXECUTED — Aircraft Returning to Launch Site ✓');
      audioService.playRtlAlert();
      try {
        await mavlinkService.commandRTL();
        if (missionEngine?.triggerEmergencyRTL) {
          missionEngine.triggerEmergencyRTL('Operator 2-Click Emergency RTL from Dashboard');
        }
      } catch (err: any) {
        showNotification(`RTL failed: ${err?.message || 'Check MAVLink link'}`);
      }
    }
  };

  const confirmEmergencyRTL = async () => {
    setShowRtlModal(false);
    setRtlConfirmPending(false);
    showNotification('🚨 EMERGENCY RTL EXECUTED — Aircraft Returning to Launch Site ✓');
    audioService.playRtlAlert();
    try {
      await mavlinkService.commandRTL();
      if (missionEngine?.triggerEmergencyRTL) {
        missionEngine.triggerEmergencyRTL('Operator Emergency RTL from Dashboard');
      }
    } catch (err: any) {
      showNotification(`RTL failed: ${err?.message || 'Could not send mode'}`);
    }
  };

  const handleUploadWaypoints = async () => {
    const mission = groundStationMissionService.getCurrentMission();
    if (!mission || mission.waypoints.length === 0) {
      showNotification('No waypoints to upload. Click map or select a pattern first.');
      return;
    }

    showNotification(`Uploading ${mission.waypoints.length} waypoints to Pixhawk flight controller...`);
    try {
      const res = await groundStationMissionService.uploadMissionToDrone();
      if (res.success) {
        showNotification(`Waypoints uploaded & verified ✓ (${mission.waypoints.length} items)`);
        audioService.playBeep(980, 100);
      } else {
        showNotification(`Upload failed: ${res.message}`);
      }
    } catch (err: any) {
      showNotification(`Upload error: ${err?.message || 'Check connection'}`);
    }
  };

  const handleModeChange = (mode: 'MANUAL' | 'AUTONOMOUS') => {
    userSelectedModeRef.current = true;
    setMissionMode(mode);
    try {
      localStorage.setItem('sae_gcs_mission_mode', mode);
    } catch {}
    audioService.playBeep(mode === 'MANUAL' ? 700 : 850, 60);

    if (mode === 'MANUAL') {
      missionEngine.switchToManualControl();
    } else {
      missionEngine.switchToAutonomousControl();
    }

    // Persist mode switch to backend if active mission is executing
    fetch('/api/missions/active/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    }).catch(() => {});

    showNotification(`${mode} MISSION MODE ACTIVE`);
  };

  return (
    <div className="h-[100dvh] w-full bg-[var(--uav-bg)] text-[var(--uav-text)] flex flex-col font-sans select-none overflow-hidden">
      {/* 1. Header (Fixed 68px) */}
      <Header
        telemetry={telemetry}
        missionMode={missionMode}
        onModeChange={handleModeChange}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onOpenSettings={() => setIsConfigModalOpen(true)}
        onLogout={onLogout}
        currentRole={currentRole}
        onArmClick={() => {
          if (telemetry.isArmed) {
            handleToggleArm((telemetry.altitudeMeters || 0) <= 1.0);
          } else {
            setShowPreflightModal(true);
          }
        }}
        onToggleRC={handleToggleRC}
        rcOverrideEnabled={telemetry.rcOverrideEnabled}
      />

      {/* Alert Banners (Link Lost / Stale Heartbeat / Connecting) */}
      {telemetry.isLinkLost && (
        <div className="w-full bg-red-600/95 border-b border-red-500 text-white px-4 py-1.5 flex items-center justify-between z-30 shrink-0 shadow-lg">
          <div className="flex items-center gap-2 text-[12px] font-bold tracking-wide">
            <AlertTriangle className="w-4 h-4 animate-pulse text-amber-300" />
            <span>CRITICAL LINK LOST: No MAVLink heartbeat from Pixhawk for &gt; 5 seconds. Use RC transmitter switch to RTL or LAND immediately.</span>
          </div>
          <button
            type="button"
            onClick={handleEmergencyRTL}
            className={`px-3 py-0.5 font-bold text-[11px] rounded uppercase tracking-wider cursor-pointer ${
              rtlConfirmPending ? 'bg-red-600 text-white animate-pulse border-2 border-white' : 'bg-white text-red-700 hover:bg-red-50'
            }`}
          >
            {rtlConfirmPending ? 'Confirm RTL Now' : 'Force RTL'}
          </button>
        </div>
      )}

      {!telemetry.isLinkLost && telemetry.isStale && (
        <div className="w-full bg-amber-600/90 border-b border-amber-500 text-white px-4 py-1 flex items-center gap-2 text-[12px] font-semibold z-30 shrink-0">
          <AlertTriangle className="w-4 h-4 text-white" />
          <span>STALE HEARTBEAT: Telemetry stream delayed (&gt; 2s). Check wireless signal strength or USB connection.</span>
        </div>
      )}

      {telemetry.isConnecting && (
        <div className="w-full bg-[var(--uav-primary-blue)]/90 border-b border-blue-400 text-white px-4 py-1 flex items-center gap-2 text-[12px] font-semibold z-30 shrink-0">
          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span>CONNECTING: Establishing MAVLink bridge to Pixhawk flight controller...</span>
        </div>
      )}

      {/* Floating Action Notice Banner */}
      {actionNotice && (
        <div className="fixed top-20 right-6 z-50 bg-[#161B22] border border-[var(--uav-primary-blue)] text-white px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2 text-[12px] font-medium animate-in fade-in slide-in-from-top-4">
          <CheckCircle2 className="w-4 h-4 text-[var(--uav-icon-blue)]" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Responsive View Switcher for Small Screens (< lg) */}
      <div className="lg:hidden w-full bg-[#11161F] border-b border-[var(--uav-card-border)] px-3 py-1.5 flex items-center justify-between shrink-0 z-20">
        <span className="text-[11px] font-mono font-bold text-slate-400 uppercase">
          GROUND STATION VIEW:
        </span>
        <div className="flex items-center gap-1 bg-[#161B22] p-0.5 rounded-lg border border-[var(--uav-card-border)] text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMobileView('telemetry')}
            className={`px-2.5 py-1 rounded transition cursor-pointer ${
              mobileView === 'telemetry' ? 'bg-[#10B981] text-emerald-950 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            📊 Telemetry
          </button>
          <button
            type="button"
            onClick={() => setMobileView('map')}
            className={`px-2.5 py-1 rounded transition cursor-pointer ${
              mobileView === 'map' ? 'bg-[#10B981] text-emerald-950 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            🗺️ Live Map
          </button>
          <button
            type="button"
            onClick={() => setMobileView('operations')}
            className={`px-2.5 py-1 rounded transition cursor-pointer ${
              mobileView === 'operations' ? 'bg-[#10B981] text-emerald-950 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            🎮 Controls
          </button>
        </div>
      </div>

      {/* 3-Section Full-Screen Fixed Viewport Grid */}
      <div className="flex-1 min-h-0 w-full grid grid-cols-1 lg:grid-cols-[280px_1fr_400px] xl:grid-cols-[300px_1fr_420px] overflow-hidden">
        
        {/* 1. LEFT PANEL: Live Drone Telemetry (Fixed Position, Internal Scroll Only) */}
        <aside
          className={`h-full min-h-0 overflow-y-auto overflow-x-hidden p-3 bg-[var(--uav-header)] border-r border-[var(--uav-card-border)] scrollbar-thin scrollbar-thumb-slate-800 ${
            mobileView === 'telemetry' ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'
          }`}
        >
          <TelemetryPanel
            telemetry={telemetry}
            onArm={async (force) => {
              const geofenceCheck = geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude);
              if (!geofenceCheck.canArm && !force) {
                audioService.playBeep(350, 200);
                showNotification(`❌ ${geofenceCheck.reason}`);
                return false;
              }
              const ok = await mavlinkService.sendArmCommand(force);
              if (ok) {
                showNotification(force ? '⚠️ FORCE ARM Command Dispatched to Pixhawk' : 'MOTOR ARM Command Dispatched to Pixhawk ✓');
              } else {
                showNotification('Arm command failed — Check pre-arm safety checks');
              }
              return ok;
            }}
            onDisarm={async (force) => {
              const ok = await mavlinkService.sendDisarmCommand(Boolean(force));
              if (ok) {
                showNotification(force ? '⚠️ FORCE DISARM Command Dispatched to Pixhawk' : 'MOTOR DISARM Command Dispatched to Pixhawk ✓');
              } else {
                showNotification('Disarm command failed — Check MAVLink link');
              }
              return ok;
            }}
            onNotification={showNotification}
          />
        </aside>

        {/* 2. CENTER PANEL: Live Drone Map (Primary Visual Element, Fills Center Space) */}
        <section
          className={`h-full min-h-0 w-full relative overflow-hidden bg-[#0D1117] flex flex-col ${
            mobileView === 'map' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <MapPanel
            telemetry={telemetry}
            className="h-full w-full min-h-0 flex-1 border-0 rounded-none"
            onWaypointAdded={(_lat, _lon) => showNotification('Waypoint added to mission plan')}
          />
        </section>

        {/* 3. RIGHT PANEL: Camera & Operations (Adapts between MODE A and MODE B) */}
        <aside
          className={`h-full min-h-0 overflow-y-auto overflow-x-hidden p-3 bg-[var(--uav-header)] border-l border-[var(--uav-card-border)] flex flex-col gap-3 scrollbar-thin scrollbar-thumb-slate-800 ${
            mobileView === 'operations' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* A. Drone Camera Feed with Live QR Recognition */}
          <CameraFeed telemetry={telemetry} className="w-full shrink-0" />

          {/* B. Mode-Specific Operations Card */}
          {missionMode === 'MANUAL' ? (
            <>
              {/* MODE A: Manual Mission Planning & Controls */}
              <ManualMissionControlCard
                telemetry={telemetry}
                onOpenPreflightModal={() => setShowPreflightModal(true)}
                onUploadWaypoints={handleUploadWaypoints}
                onEmergencyRTL={handleEmergencyRTL}
                rtlConfirmPending={rtlConfirmPending}
              />

              {/* Waypoint Management Table */}
              <WaypointManager
                className="w-full shrink-0"
                onClearAll={() => showNotification('Mission waypoints cleared')}
                onSaveKml={() => showNotification('Mission KML downloaded')}
                onLoadKml={() => showNotification('Mission KML loaded')}
              />
            </>
          ) : (
            <>
              {/* MODE B: Autonomous Search Mission (4 Configurable Fields) */}
              <AutonomousMissionControlCard
                telemetry={telemetry}
                onOpenPreflightModal={() => setShowPreflightModal(true)}
                onUploadWaypoints={handleUploadWaypoints}
                onEmergencyRTL={handleEmergencyRTL}
                rtlConfirmPending={rtlConfirmPending}
                activeMissionTime={activeMissionData || undefined}
              />
            </>
          )}

          {/* C. Flight Parameters */}
          <FlightParams className="w-full shrink-0" />
        </aside>

      </div>

      {/* 4. Preflight Readiness Verification Modal (Section 5) */}
      <PreflightValidationModal
        isOpen={showPreflightModal}
        onClose={() => setShowPreflightModal(false)}
        onConfirmLaunch={confirmArmAndLaunch}
        telemetry={telemetry}
        mode={missionMode}
      />

      {/* 5. Safety Confirmation Modal: EMERGENCY RTL */}
      {showRtlModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#161B22] border-2 border-red-600 rounded-[12px] max-w-md w-full p-6 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between text-red-500">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-8 h-8 text-red-500 animate-pulse" />
                <h3 className="font-orbitron font-bold text-[16px] tracking-wide text-white">
                  EMERGENCY RETURN-TO-LAUNCH
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRtlModal(false)}
                className="text-[var(--uav-muted)] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[12px] text-slate-300 leading-relaxed">
              This will immediately abort any active search or servo tracking and command the Pixhawk flight controller to enter RTL mode, climbing to safe altitude and returning directly to the home coordinate.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRtlModal(false)}
                className="px-4 py-2 rounded-lg border border-[var(--uav-card-border)] text-[var(--uav-muted)] hover:text-white hover:bg-[#21262D] text-[12px] font-semibold transition cursor-pointer"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={confirmEmergencyRTL}
                className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-[12px] tracking-wider uppercase transition shadow-lg cursor-pointer"
              >
                EXECUTE EMERGENCY RTL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Autonomous Mission Configuration Modal */}
      {isConfigModalOpen && (
        <AutonomousMissionConfigModal
          isOpen={isConfigModalOpen}
          onClose={() => {
            setIsConfigModalOpen(false);
            setActiveNav('Dashboard');
          }}
          telemetry={telemetry.rawTelemetry}
          homePoint={mavlinkService.getHomePoint()}
          pixhawkState={telemetry.rawConnectionState}
          missionState={missionEngine.getCurrentState()}
          onStartMission={() => {
            setIsConfigModalOpen(false);
            setActiveNav('Dashboard');
            missionEngine.startMission();
          }}
        />
      )}

      {/* 7. Mission History / Analytics Modal */}
      {isHistoryModalOpen && (
        <MissionHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => {
            setIsHistoryModalOpen(false);
            setActiveNav('Dashboard');
          }}
        />
      )}

      {/* 8. Serial & Diagnostics Modal */}
      {isDiagnosticsModalOpen && (
        <SerialDiagnosticsModal
          isOpen={isDiagnosticsModalOpen}
          onClose={() => {
            setIsDiagnosticsModalOpen(false);
            setActiveNav('Dashboard');
            if (activeTab === 'Logs') setActiveTab('Fly');
          }}
          connectionState={telemetry.rawConnectionState}
          telemetry={telemetry.rawTelemetry}
          runnerLink={runnerCommService.getState()}
        />
      )}

      {/* 9. Tactical Flight Control Modal */}
      {isFlightControlModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[12px] max-w-2xl w-full p-5 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--uav-card-border)]">
              <div className="flex items-center gap-2.5">
                <Crosshair className="w-5 h-5 text-[var(--uav-primary-blue)]" />
                <h3 className="font-orbitron font-bold text-[15px] tracking-wide text-white">
                  TACTICAL FLIGHT CONTROL &amp; AUTOPILOT OVERRIDES
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsFlightControlModalOpen(false);
                  setActiveNav('Dashboard');
                }}
                className="text-[var(--uav-muted)] hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Command Buttons */}
            <div>
              <span className="text-[11px] font-bold text-[var(--uav-muted)] uppercase tracking-wider block mb-2">
                Primary Flight Modes & Engine Cutoff
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!telemetry.isArmed) {
                      await mavlinkService.sendArmCommand(true);
                    }
                    await mavlinkService.commandTakeoff(5.0);
                    showNotification('Takeoff commanded: 5.0m AGL');
                  }}
                  className="py-2.5 px-3 rounded-lg bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-300 font-semibold text-[12px] flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <ArrowUp className="w-4 h-4 text-emerald-400" />
                  <span>Takeoff (5m)</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await mavlinkService.setFlightMode('LOITER');
                    showNotification('Autopilot switched to LOITER');
                  }}
                  className="py-2.5 px-3 rounded-lg bg-[#10B981]/20 border border-emerald-500/40 hover:bg-[#10B981]/30 text-emerald-300 font-semibold text-[12px] flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <Pause className="w-4 h-4 text-emerald-400" />
                  <span>Loiter Hold</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await mavlinkService.setFlightMode('LAND');
                    showNotification('Autopilot switched to LAND');
                  }}
                  className="py-2.5 px-3 rounded-lg bg-amber-600/20 border border-amber-500/40 hover:bg-amber-600/30 text-amber-300 font-semibold text-[12px] flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <ArrowDown className="w-4 h-4 text-amber-400" />
                  <span>Land Now</span>
                </button>
                <button
                  type="button"
                  onClick={handleEmergencyRTL}
                  className={`py-2.5 px-3 rounded-lg font-semibold text-[12px] flex items-center justify-center gap-2 transition cursor-pointer ${
                    rtlConfirmPending
                      ? 'bg-red-600 border-2 border-white text-white animate-pulse shadow-lg'
                      : 'bg-rose-600/20 border border-rose-500/40 hover:bg-rose-600/30 text-rose-300'
                  }`}
                  title={
                    rtlConfirmPending
                      ? 'CLICK AGAIN TO RETURN TO LAUNCH NOW'
                      : 'Emergency Return To Launch (Click once to prime, click 2nd time to execute)'
                  }
                >
                  <AlertTriangle
                    className={`w-4 h-4 ${
                      rtlConfirmPending ? 'text-white animate-bounce' : 'text-rose-400'
                    }`}
                  />
                  <span>
                    {rtlConfirmPending ? 'Confirm RTL' : 'Emergency RTL'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const isLowAlt = (telemetry.altitudeMeters || 0) <= 1.0;
                    showNotification('Disarming vehicle motors...');
                    audioService.playBeep(450, 120);
                    const ok = await mavlinkService.sendDisarmCommand(isLowAlt);
                    if (ok) {
                      showNotification('Vehicle Disarmed ✓');
                      audioService.playBeep(350, 150);
                    } else {
                      showNotification('Disarm rejected by Pixhawk (Use Force Disarm on Telemetry Panel)');
                    }
                  }}
                  className={`py-2.5 px-3 rounded-lg font-semibold text-[12px] flex items-center justify-center gap-2 transition cursor-pointer ${
                    telemetry.isArmed
                      ? 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 shadow-md shadow-rose-950/50 active:scale-95'
                      : 'bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700 text-zinc-300 active:scale-95'
                  }`}
                  title="Cut motor power / Disarm UAV"
                >
                  <Power className="w-4 h-4 text-white" />
                  <span>{telemetry.isArmed ? 'Disarm Motors' : 'Force Disarm'}</span>
                </button>
              </div>
            </div>

            {/* Guided Directional Nudges */}
            <div>
              <span className="text-[11px] font-bold text-[var(--uav-muted)] uppercase tracking-wider block mb-2">
                Guided 3D Reposition Nudges (±5m Horizontal, ±2m Vertical)
              </span>
              <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                <div />
                <button
                  type="button"
                  onClick={() => handleNudge('N', 5)}
                  className="py-2 px-3 rounded-lg bg-[#21262D] border border-[var(--uav-card-border)] hover:bg-[#262C36] text-white text-[12px] font-mono font-bold transition cursor-pointer"
                >
                  ▲ North (+5m)
                </button>
                <button
                  type="button"
                  onClick={() => handleNudge('UP', 2)}
                  className="py-2 px-3 rounded-lg bg-[#21262D] border border-[var(--uav-card-border)] hover:bg-[#262C36] text-emerald-300 text-[12px] font-mono font-bold transition cursor-pointer"
                >
                  ▲ Climb (+2m)
                </button>

                <button
                  type="button"
                  onClick={() => handleNudge('W', 5)}
                  className="py-2 px-3 rounded-lg bg-[#21262D] border border-[var(--uav-card-border)] hover:bg-[#262C36] text-white text-[12px] font-mono font-bold transition cursor-pointer"
                >
                  ◀ West (+5m)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await mavlinkService.setFlightMode('LOITER');
                    showNotification('Loiter Hold');
                  }}
                  className="py-2 px-3 rounded-lg bg-[#10B981] hover:bg-[#059669] text-emerald-950 font-bold text-[12px] font-mono transition cursor-pointer"
                >
                  STOP / HOLD
                </button>
                <button
                  type="button"
                  onClick={() => handleNudge('E', 5)}
                  className="py-2 px-3 rounded-lg bg-[#21262D] border border-[var(--uav-card-border)] hover:bg-[#262C36] text-white text-[12px] font-mono font-bold transition cursor-pointer"
                >
                  East (+5m) ▶
                </button>

                <div />
                <button
                  type="button"
                  onClick={() => handleNudge('S', 5)}
                  className="py-2 px-3 rounded-lg bg-[#21262D] border border-[var(--uav-card-border)] hover:bg-[#262C36] text-white text-[12px] font-mono font-bold transition cursor-pointer"
                >
                  ▼ South (+5m)
                </button>
                <button
                  type="button"
                  onClick={() => handleNudge('DOWN', 2)}
                  className="py-2 px-3 rounded-lg bg-[#21262D] border border-[var(--uav-card-border)] hover:bg-[#262C36] text-amber-300 text-[12px] font-mono font-bold transition cursor-pointer"
                >
                  ▼ Descend (-2m)
                </button>
              </div>
            </div>

            {/* Active Flight Status Footer */}
            {/* Active Flight Status Footer */}
            <div className="pt-2 border-t border-[var(--uav-card-border)] flex items-center justify-between">
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-[var(--uav-muted)]">
                  Mode: <strong className="text-emerald-400">{telemetry.flightMode || 'GUIDED'}</strong>
                </span>
                <span className="text-[var(--uav-muted)]">
                  Motors: <strong className={telemetry.isArmed ? 'text-red-400' : 'text-emerald-400'}>{telemetry.isArmed ? 'ARMED' : 'DISARMED'}</strong>
                </span>
                <span className="text-[var(--uav-muted)]">
                  Altitude: <strong className="text-amber-400">{(telemetry.altitudeMeters || 0).toFixed(1)}m</strong>
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsFlightControlModalOpen(false);
                  setActiveNav('Dashboard');
                }}
                className="px-4 py-1.5 rounded-lg border border-[var(--uav-card-border)] text-[var(--uav-muted)] hover:text-white text-[12px] font-semibold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
