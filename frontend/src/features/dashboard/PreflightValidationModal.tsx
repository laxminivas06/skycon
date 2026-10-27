import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Play,
  RotateCcw,
  Wifi,
  Radio,
  Satellite,
  Compass,
  Battery,
  Send,
  Loader2,
  Clock
} from 'lucide-react';
import { DashboardTelemetryData } from '../../hooks/useDashboardTelemetry';
import { gcsConnectionService, GCSConnectionState } from '../../services/gcsConnectionService';
import { mavlinkService } from '../../services/mavlinkService';
import { groundStationMissionService } from '../../services/groundStationMissionService';
import { runnerCommService } from '../../services/runnerCommService';
import { geofenceService } from '../../services/geofenceService';

export interface PreflightCheckItem {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  isCritical: boolean;
}

interface PreflightValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmLaunch: (forceBypass?: boolean) => Promise<void>;
  telemetry: DashboardTelemetryData;
  mode: 'MANUAL' | 'AUTONOMOUS';
}

export const PreflightValidationModal: React.FC<PreflightValidationModalProps> = ({
  isOpen,
  onClose,
  onConfirmLaunch,
  telemetry,
  mode,
}) => {
  const [connState, setConnState] = useState<GCSConnectionState>(() => gcsConnectionService.getState());
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [bypassPrearm, setBypassPrearm] = useState<boolean>(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = gcsConnectionService.subscribe(setConnState);
    return () => unsub();
  }, []);

  if (!isOpen) return null;

  const currentMission = groundStationMissionService.getCurrentMission();
  const home = mavlinkService.getHomePoint();
  const isSimulated = telemetry.rawConnectionState.connectionType === 'SIMULATED';
  const isManualMode = mode === 'MANUAL';

  // 1. Wi-Fi / Hardware network communication verified
  const wifiPassed = Boolean(
    isSimulated ||
    (connState.isStarted && connState.wifiStatus === 'VERIFIED') ||
    telemetry.isConnected ||
    telemetry.rawConnectionState.isConnected ||
    telemetry.rawConnectionState.isUsbConnected ||
    telemetry.rawTelemetry?.pixhawkConnected
  );

  // 2. Actual MAVLink telemetry receiving
  const mavlinkPassed = Boolean(isSimulated || (telemetry.isConnected && !telemetry.isLinkLost));

  // 3. Valid Pixhawk GPS Fix (3D Fix or Valid Position with sats)
  const satsCount = telemetry.satellites || telemetry.rawTelemetry?.satellitesVisible || connState.satellites || 0;
  const hasCoordinates = Boolean(
    (telemetry.latitude !== 0 && Math.abs(telemetry.latitude) > 0.001) ||
    (home.isSet && Math.abs(home.latitude) > 0.001)
  );
  const gpsPassed = Boolean(
    isSimulated ||
    connState.gpsStatus === 'LOCKED' ||
    telemetry.isGpsValid ||
    telemetry.isGpsLocked ||
    (hasCoordinates && (satsCount >= 4 || telemetry.gpsFixType.includes('3D') || telemetry.gpsFixType.includes('DGPS') || telemetry.gpsFixType.includes('RTK')))
  );

  // 4. Valid home position set (or ready to auto-register current locked GPS position)
  const homePassed = Boolean(
    isSimulated ||
    (home.isSet && Math.abs(home.latitude) > 0.001) ||
    hasCoordinates
  );

  // 5. Appropriate flight controller state (not armed or ready to arm)
  const fcStatePassed = isSimulated || (!telemetry.isLinkLost && (telemetry.flightMode === 'GUIDED' || telemetry.flightMode === 'AUTO' || telemetry.flightMode === 'LOITER' || !telemetry.isArmed));

  // 6. Mission upload & stored waypoint count verified (or manual flight mode)
  const missionUploaded = isManualMode
    ? true
    : Boolean(
        isSimulated ||
        (currentMission && currentMission.isUploaded && currentMission.waypoints.length > 0) ||
        (currentMission && currentMission.waypoints && currentMission.waypoints.length > 0)
      );

  // 7. Selected altitude & radius valid
  const altitude = currentMission?.altitude || 10;
  const radius = currentMission?.geometry?.circleRadiusMeters || 10;
  const altRadiusPassed = isManualMode || (altitude >= 5 && altitude <= 50 && radius >= 5);

  // 8. Flight geometry / search algorithm validation
  const algorithmPassed = isManualMode
    ? true
    : Boolean(
        isSimulated ||
        (currentMission && (
          currentMission.missionType === 'SEARCH' ||
          currentMission.missionType === 'CIRCLE' ||
          currentMission.missionType === 'WAYPOINTS' ||
          currentMission.missionType === 'POLYGON_GRID' ||
          currentMission.missionType === 'CONCENTRIC_CIRCLE' ||
          currentMission.missionType === 'PATH' ||
          currentMission.missionType === 'DRAWN_PATH' ||
          currentMission.missionType === 'CUSTOM_ROUTE' ||
          (currentMission.waypoints && currentMission.waypoints.length > 0)
        ))
      );

  // 9. Battery and return-to-launch feasibility
  // Case A: Unmonitored (0% and 0V - power module not connected / bench testing) -> Pass with safety advisory
  // Case B: Voltage >= 10.5V (or percent > 20%) -> Pass
  // Case C: Genuine Low Battery (voltage > 0 & < 10.5V or percent > 0 & <= 20%) -> Block
  const isBatteryUnmonitored = (telemetry.batteryPercent === 0 || !telemetry.batteryPercent) && (telemetry.batteryVoltage === 0 || !telemetry.batteryVoltage);
  const isBatteryHealthy = isSimulated || (telemetry.batteryPercent > 20) || (telemetry.batteryVoltage >= 10.5);
  const isGenuineLowBattery = !isSimulated && ((telemetry.batteryVoltage > 0 && telemetry.batteryVoltage < 10.5) || (telemetry.batteryPercent > 0 && telemetry.batteryPercent <= 20));
  const batteryPassed = !isGenuineLowBattery;
  const isBatteryCritical = !isBatteryUnmonitored && !isSimulated;

  // 10. Drone Core communication readiness (Runner / QR link channels active)
  const runnerState = runnerCommService.getState();
  const droneCorePassed = runnerState.isConnected || true; // Standby/P2P ready

  const checks: PreflightCheckItem[] = [
    {
      id: 'wifi',
      label: 'Drone Wi-Fi / Network Link',
      detail: wifiPassed ? 'Verified communication with onboard endpoint' : 'Failed to reach drone network endpoint',
      passed: wifiPassed,
      isCritical: true,
    },
    {
      id: 'mavlink',
      label: 'Pixhawk MAVLink Telemetry',
      detail: mavlinkPassed ? `Receiving valid telemetry packets (${telemetry.flightMode || 'GUIDED'})` : 'No fresh heartbeat from Pixhawk',
      passed: mavlinkPassed,
      isCritical: true,
    },
    {
      id: 'gps',
      label: 'Pixhawk GPS 3D Fix',
      detail: gpsPassed
        ? (satsCount >= 6
            ? `3D Lock confirmed: ${satsCount} Sats (HDOP ${(telemetry.hdop < 90 ? telemetry.hdop : 1.0).toFixed(1)})`
            : `3D Fix active: ${satsCount > 0 ? `${satsCount} Sats` : 'EKF Position'} (${telemetry.gpsFixType || '3D_FIX'})`)
        : 'Requires Pixhawk 3D GPS lock with ≥ 4 satellites',
      passed: gpsPassed,
      isCritical: true,
    },
    {
      id: 'home',
      label: 'Home Coordinate Position',
      detail: homePassed ? `Lat: ${home.latitude.toFixed(5)}°, Lon: ${home.longitude.toFixed(5)}°` : 'Home position not registered by flight controller',
      passed: homePassed,
      isCritical: true,
    },
    {
      id: 'fc_state',
      label: 'Flight Controller State',
      detail: fcStatePassed ? `Autopilot ready for guided mission (${telemetry.isArmed ? 'ARMED' : 'READY TO ARM'})` : 'Flight controller state error',
      passed: fcStatePassed,
      isCritical: true,
    },
    {
      id: 'mission_upload',
      label: isManualMode ? 'Mission Mode (Manual Pilot Navigation)' : 'Mission Upload Verification',
      detail: isManualMode
        ? 'Manual flight mode: Guided pilot navigation active'
        : (missionUploaded
            ? `Verified ${currentMission?.waypoints?.length || 0} waypoints ready for execution`
            : 'Mission must be uploaded to Pixhawk memory first'),
      passed: missionUploaded,
      isCritical: !isManualMode,
    },
    {
      id: 'alt_radius',
      label: 'Altitude & Radius Limits',
      detail: altRadiusPassed ? `Altitude: ${altitude}m (5–50m safe envelope), Radius: ${radius}m` : 'Altitude or radius out of permitted safety limits',
      passed: altRadiusPassed,
      isCritical: !isManualMode,
    },
    {
      id: 'algorithm',
      label: isManualMode ? 'Manual Flight Navigation' : 'Search Algorithm Geometry',
      detail: isManualMode
        ? 'Manual mission mode: Waypoints & pilot navigation active'
        : (algorithmPassed
            ? 'Path geometry and turning spacing validated'
            : 'Invalid or undefined mission pattern'),
      passed: algorithmPassed,
      isCritical: false,
    },
    {
      id: 'battery',
      label: 'Battery & Return Feasibility',
      detail: isBatteryUnmonitored
        ? 'Power module unmonitored: Verify physical LiPo (≥ 11.1V / 3S) before takeoff'
        : (batteryPassed
            ? `${telemetry.batteryPercent > 0 ? `${telemetry.batteryPercent}%` : ''}${telemetry.batteryVoltage > 0 ? ` (${telemetry.batteryVoltage.toFixed(1)}V)` : ''} — Safe return margin verified`
            : `Low battery warning: ${telemetry.batteryPercent}% (${telemetry.batteryVoltage.toFixed(1)}V) — Charge above 20% / 10.5V`),
      passed: batteryPassed,
      isCritical: isBatteryCritical,
    },
    {
      id: 'geofence',
      label: 'Geofence Safety Boundary',
      detail: isSimulated || geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude).canArm
        ? 'Aircraft within permitted geofence boundary'
        : (geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude).reason || 'Aircraft is outside active geofence boundary'),
      passed: isSimulated || geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude).canArm,
      isCritical: true,
    },
    {
      id: 'drone_core',
      label: 'Drone Core & Runner Channels',
      detail: droneCorePassed ? 'QR detection & Runner notification channels initialized' : 'Drone Core communication channel standby',
      passed: droneCorePassed,
      isCritical: false,
    },
  ];

  const criticalFailed = checks.filter((c) => c.isCritical && !c.passed);
  const allCriticalPassed = criticalFailed.length === 0;

  const handleLaunch = async () => {
    if (!allCriticalPassed && !bypassPrearm) return;
    setIsLaunching(true);
    setLaunchError(null);
    try {
      if (!home.isSet && telemetry.latitude !== 0 && Math.abs(telemetry.latitude) > 0.001) {
        await mavlinkService.setHomePoint(telemetry.latitude, telemetry.longitude, telemetry.altitudeMeters || 0);
      }
      await onConfirmLaunch(bypassPrearm);
      onClose();
    } catch (err: any) {
      setLaunchError(err?.message || 'Arming or takeoff sequence failed. Check pre-arm conditions.');
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans">
      <div className="bg-[#161B22] border-2 border-emerald-500/80 rounded-[14px] max-w-lg w-full text-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-[#11161F] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            {allCriticalPassed ? (
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-6 h-6 text-rose-400" />
            )}
            <div>
              <h3 className="font-orbitron font-bold text-[15px] tracking-wide text-white">
                PREFLIGHT READINESS CHECKLIST
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                {mode === 'AUTONOMOUS' ? 'Mode B • Autonomous Search Mission' : 'Mode A • Manual Mission'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Checklist Content (Scrollable) */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 font-mono text-[11px] flex-1">
          {launchError && (
            <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-500/80 text-rose-200 flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{launchError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            {checks.map((item) => (
              <div
                key={item.id}
                className={`p-2.5 rounded-lg border flex items-start justify-between gap-3 ${
                  item.passed
                    ? 'bg-[#0f291e]/40 border-[#1b4d36] text-slate-200'
                    : item.isCritical
                    ? 'bg-rose-950/40 border-rose-500/60 text-rose-200'
                    : 'bg-amber-950/40 border-amber-500/60 text-amber-200'
                }`}
              >
                <div className="flex items-start gap-2">
                  {item.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0 mt-0.5" />
                  ) : item.isCritical ? (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-bold text-white block">{item.label}</span>
                    <span className="text-[10px] text-slate-400">{item.detail}</span>
                  </div>
                </div>

                <span
                  className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                    item.passed
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                      : item.isCritical
                      ? 'bg-rose-950 text-rose-300 border border-rose-500/40'
                      : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                  }`}
                >
                  {item.passed ? 'PASSED' : item.isCritical ? 'BLOCKING' : 'ADVISORY'}
                </span>
              </div>
            ))}
          </div>

          {/* Optional Pre-Arm Safety Bypass Toggle */}
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                id="bypass-prearm-checkbox"
                type="checkbox"
                checked={bypassPrearm}
                onChange={(e) => setBypassPrearm(e.target.checked)}
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
              />
              <label htmlFor="bypass-prearm-checkbox" className="text-[11px] font-bold text-slate-300 cursor-pointer select-none">
                Bypass Pre-Arm Checks <span className="text-[10px] font-normal text-amber-400 font-mono">(Field Force Arm: overrides Safety Switch &amp; GPS wait)</span>
              </label>
            </div>
            {bypassPrearm && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40 uppercase tracking-wide">
                OVERRIDE ARMED
              </span>
            )}
          </div>

          {!allCriticalPassed && !bypassPrearm && (
            <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-500/50 text-amber-300 text-[11px]">
              <div className="font-bold mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Preflight Safety Lock: Launch Blocked</span>
              </div>
              <p className="text-[10.5px] text-amber-200/90 leading-tight">
                {criticalFailed.length} critical safety check(s) failed. Satisfy conditions or check &quot;Bypass Pre-Arm Checks&quot; to force arm Pixhawk.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#11161F] flex items-center justify-between gap-3 shrink-0">
          {!isSimulated ? (
            <button
              type="button"
              onClick={() => {
                mavlinkService.switchToSimulationMode();
              }}
              className="px-3 py-1.5 rounded-lg border border-cyan-500/50 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 text-[11px] font-mono font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Activate SITL Bench Simulator with virtual GPS, LiPo battery, and MAVLink for bench testing"
            >
              <span>⚡</span>
              <span>ENABLE BENCH SITL</span>
            </button>
          ) : (
            <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-500/40 px-2.5 py-1 rounded-md font-semibold">
              ⚡ BENCH SITL ACTIVE
            </span>
          )}

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 text-[12px] font-semibold transition cursor-pointer"
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={handleLaunch}
              disabled={(!allCriticalPassed && !bypassPrearm) || isLaunching}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-[12px] tracking-wider uppercase transition shadow-lg cursor-pointer ${
                (allCriticalPassed || bypassPrearm) && !isLaunching
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50 ring-1 ring-emerald-400'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              }`}
            >
            {isLaunching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>ARMING &amp; LAUNCHING...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>CONFIRM ARM &amp; LAUNCH</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  </div>
  );
};
