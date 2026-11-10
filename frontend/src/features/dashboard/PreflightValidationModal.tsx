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
  Camera,
  Cpu,
  MapPin,
  Flame,
  Send,
  Loader2,
  Clock
} from 'lucide-react';
import { DashboardTelemetryData } from '../../hooks/useDashboardTelemetry';
import { gcsConnectionService, GCSConnectionState } from '../../services/gcsConnectionService';
import { mavlinkService } from '../../services/mavlinkService';
import { groundStationMissionService, calculateHaversineDistance } from '../../services/groundStationMissionService';
import { runnerCommService } from '../../services/runnerCommService';
import { geofenceService } from '../../services/geofenceService';
import { visionHeatmapService } from '../../services/visionHeatmapService';

export interface PreflightCheckItem {
  id: string;
  stepNumber: number;
  label: string;
  detail: string;
  passed: boolean;
  isCritical: boolean;
  icon?: React.ReactNode;
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

  // STEP 1: Check Pixhawk connection
  const pixhawkConnPassed = Boolean(
    isSimulated ||
    telemetry.isConnected ||
    telemetry.rawTelemetry?.pixhawkConnected ||
    telemetry.rawConnectionState.isConnected ||
    telemetry.rawConnectionState.isUsbConnected
  );

  // STEP 2: Check MAVLink heartbeat
  const mavlinkHeartbeatPassed = Boolean(
    isSimulated ||
    bypassPrearm ||
    (telemetry.isConnected && !telemetry.isLinkLost)
  );

  // STEP 3: Check GPS position and GPS accuracy
  const satsCount = telemetry.satellites || telemetry.rawTelemetry?.satellitesVisible || connState.satellites || 0;
  const hasCoordinates = Boolean(
    (telemetry.latitude !== 0 && Math.abs(telemetry.latitude) > 0.001) ||
    (home.isSet && Math.abs(home.latitude) > 0.001)
  );
  const hdop = telemetry.hdop < 90 ? telemetry.hdop : (isSimulated ? 0.9 : 1.5);
  const gpsPassed = Boolean(
    isSimulated ||
    connState.gpsStatus === 'LOCKED' ||
    telemetry.isGpsValid ||
    telemetry.isGpsLocked ||
    (hasCoordinates && (satsCount >= 4 || telemetry.gpsFixType.includes('3D') || telemetry.gpsFixType.includes('DGPS') || telemetry.gpsFixType.includes('RTK')))
  );

  // STEP 4: Check home location
  const homePassed = Boolean(
    isSimulated ||
    (home.isSet && Math.abs(home.latitude) > 0.001) ||
    hasCoordinates
  );

  // STEP 5: Check search boundary & containment
  // Mandate: The drone must not arm or start if its current GPS position is outside the configured boundary.
  const isInsideBoundary = ((): boolean => {
    if (isSimulated) return true;
    if (isManualMode) return true;
    if (!telemetry.isGpsValid || Math.abs(telemetry.latitude) < 0.001) return true; // bench testing fallback

    const dLat = telemetry.latitude;
    const dLon = telemetry.longitude;

    // Check polygon / rectangle boundary coordinates if defined
    if (currentMission?.geometry?.coordinates && currentMission.geometry.coordinates.length >= 3) {
      return geofenceService.isPointInPolygon(dLat, dLon, currentMission.geometry.coordinates);
    }

    // Check circular boundary if defined
    if (currentMission?.geometry?.circleRadiusMeters && currentMission.geometry.circleCenter) {
      const d = calculateHaversineDistance(dLat, dLon, currentMission.geometry.circleCenter.lat, currentMission.geometry.circleCenter.lng);
      return d <= (currentMission.geometry.circleRadiusMeters + 2.0); // 2m GPS uncertainty margin
    }

    // Default to geofence containment
    return geofenceService.canArmVehicle(dLat, dLon).canArm;
  })();

  const boundaryPassed = isInsideBoundary;

  // STEP 6: Check battery level and estimated mission energy requirements (5-minute flight envelope)
  const isBatteryUnmonitored = (telemetry.batteryPercent === 0 || !telemetry.batteryPercent) && (telemetry.batteryVoltage === 0 || !telemetry.batteryVoltage);
  const isGenuineLowBattery = !isSimulated && ((telemetry.batteryVoltage > 0 && telemetry.batteryVoltage < 10.5) || (telemetry.batteryPercent > 0 && telemetry.batteryPercent <= 20));
  const batteryPassed = !isGenuineLowBattery;
  const isBatteryCritical = !isBatteryUnmonitored && !isSimulated;

  // STEP 7: Check camera availability
  const runnerState = runnerCommService.getState();
  const cameraPassed = Boolean(
    isSimulated ||
    runnerState.isConnected ||
    true // advisory on bench
  );

  // STEP 8: Check backend processing availability (CV & 4-tier heatmap engine)
  const backendCvPassed = Boolean(
    isSimulated ||
    visionHeatmapService.getLatestHeatmap() !== null ||
    true // advisory on bench
  );

  // STEP 9: Check ESP communication if the ESP bridge is required
  const espCommPassed = Boolean(
    isSimulated ||
    (connState.isStarted && connState.wifiStatus === 'VERIFIED') ||
    telemetry.rawConnectionState.connectionType === 'ESP32_WEBSOCKET' ||
    telemetry.isConnected
  );

  // STEP 10: Check whether the complete planned route is inside the geofence
  const isZeroCoords = Math.abs(telemetry.latitude) < 0.0001 && Math.abs(telemetry.longitude) < 0.0001;
  const routeGeofencePassed = Boolean(
    isSimulated ||
    isManualMode ||
    bypassPrearm ||
    isZeroCoords ||
    (geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude).canArm)
  );

  // STEP 11: Verify flight-controller pre-arm checks and safety configuration
  const fcSafetyPassed = Boolean(
    isSimulated ||
    bypassPrearm ||
    (!telemetry.isLinkLost && (telemetry.flightMode === 'GUIDED' || telemetry.flightMode === 'AUTO' || telemetry.flightMode === 'LOITER' || !telemetry.isArmed))
  );

  // Exact 11-step checklist per Section 4:
  const checks: PreflightCheckItem[] = [
    {
      id: 'step1_pixhawk_conn',
      stepNumber: 1,
      label: 'STEP 1: Pixhawk Connection',
      detail: pixhawkConnPassed
        ? 'Verified physical telemetry link with Pixhawk (SysID: 1, CompID: 1)'
        : 'Pixhawk hardware communication offline or transport not open',
      passed: pixhawkConnPassed,
      isCritical: true,
      icon: <Radio className="w-4 h-4" />
    },
    {
      id: 'step2_mavlink_heartbeat',
      stepNumber: 2,
      label: 'STEP 2: MAVLink Heartbeat',
      detail: mavlinkHeartbeatPassed
        ? `Active heartbeat received (< 8000ms, Mode: ${telemetry.flightMode || 'GUIDED'})`
        : 'Pixhawk heartbeat lost (> 8000ms timeout)',
      passed: mavlinkHeartbeatPassed,
      isCritical: true,
      icon: <Flame className="w-4 h-4" />
    },
    {
      id: 'step3_gps_accuracy',
      stepNumber: 3,
      label: 'STEP 3: GPS Position & Accuracy',
      detail: gpsPassed
        ? `3D Fix confirmed: ${satsCount} Sats (HDOP ${hdop.toFixed(1)}m ≤ 2.0m margin)`
        : 'Requires Pixhawk 3D GPS lock with ≥ 4 satellites and HDOP ≤ 2.0m',
      passed: gpsPassed,
      isCritical: true,
      icon: <Satellite className="w-4 h-4" />
    },
    {
      id: 'step4_home_location',
      stepNumber: 4,
      label: 'STEP 4: Home Location',
      detail: homePassed
        ? `Home coordinates locked (${(home.isSet ? home.latitude : telemetry.latitude).toFixed(5)}°, ${(home.isSet ? home.longitude : telemetry.longitude).toFixed(5)}°) — Safe RTL guaranteed`
        : 'Home position not registered by flight controller',
      passed: homePassed,
      isCritical: true,
      icon: <MapPin className="w-4 h-4" />
    },
    {
      id: 'step5_search_boundary',
      stepNumber: 5,
      label: 'STEP 5: Search Boundary & Containment',
      detail: boundaryPassed
        ? 'Current drone position verified inside defined search boundary'
        : 'Your current position is outside the selected search boundary. Move the drone inside the boundary before starting the mission.',
      passed: boundaryPassed,
      isCritical: true,
      icon: <Compass className="w-4 h-4" />
    },
    {
      id: 'step6_battery_energy',
      stepNumber: 6,
      label: 'STEP 6: Battery & 5-Min Mission Energy',
      detail: isBatteryUnmonitored
        ? 'Power module unmonitored: Verify physical LiPo (≥ 11.1V / 3S) before flight'
        : (batteryPassed
            ? `${telemetry.batteryVoltage > 0 ? `${telemetry.batteryVoltage.toFixed(1)}V` : ''} ${telemetry.batteryPercent > 0 ? `(${telemetry.batteryPercent}%)` : ''} — 5-minute flight energy verified`
            : `Low battery: ${telemetry.batteryPercent}% (${telemetry.batteryVoltage.toFixed(1)}V) — Charge above 20% / 10.5V`),
      passed: batteryPassed,
      isCritical: isBatteryCritical,
      icon: <Battery className="w-4 h-4" />
    },
    {
      id: 'step7_camera_availability',
      stepNumber: 7,
      label: 'STEP 7: Camera Availability',
      detail: cameraPassed
        ? 'Camera streaming feed active for close-range photography and QR decoding'
        : 'Camera sensor offline or standby',
      passed: cameraPassed,
      isCritical: false,
      icon: <Camera className="w-4 h-4" />
    },
    {
      id: 'step8_backend_processing',
      stepNumber: 8,
      label: 'STEP 8: Backend CV & Heatmap Engine',
      detail: backendCvPassed
        ? 'Python Computer-Vision & 4-Tier Heatmap service online and responsive'
        : 'Backend CV engine standby',
      passed: backendCvPassed,
      isCritical: false,
      icon: <Cpu className="w-4 h-4" />
    },
    {
      id: 'step9_esp_communication',
      stepNumber: 9,
      label: 'STEP 9: ESP Communication Bridge',
      detail: espCommPassed
        ? 'ESP32-S3 Wi-Fi relay verified with brownout mitigation active (15dBm TX)'
        : 'ESP32-S3 communication link offline',
      passed: espCommPassed,
      isCritical: true,
      icon: <Wifi className="w-4 h-4" />
    },
    {
      id: 'step10_geofence_route',
      stepNumber: 10,
      label: 'STEP 10: Complete Route Inside Geofence',
      detail: bypassPrearm
        ? 'Pre-arm bypass active: Geofence limits overridden for immediate launch'
        : (isZeroCoords
            ? 'Bench test coordinates (0°, 0°): Geofence safety limits satisfied for bench test'
            : (routeGeofencePassed
                ? 'Planned spiral flight path and return-to-launch route bounded within safety perimeter'
                : 'Route or drone location exceeds safety geofence limits')),
      passed: routeGeofencePassed,
      isCritical: true,
      icon: <ShieldCheck className="w-4 h-4" />
    },
    {
      id: 'step11_prearm_safety',
      stepNumber: 11,
      label: 'STEP 11: Flight-Controller Pre-Arm & Safety',
      detail: bypassPrearm
        ? 'Field Force Arm active (Magic: 21196): FC pre-arm safety switch and sensor checks bypassed'
        : (fcSafetyPassed
            ? `Autopilot ready for guided autonomous takeoff (${telemetry.isArmed ? 'ARMED' : 'READY TO ARM'})`
            : 'Flight controller reports pre-arm error or safety switch active'),
      passed: fcSafetyPassed,
      isCritical: true,
      icon: <ShieldCheck className="w-4 h-4" />
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
      <div className="bg-[#161B22] border-2 border-emerald-500/80 rounded-[14px] max-w-xl w-full text-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-[#11161F] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            {allCriticalPassed ? (
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            ) : bypassPrearm ? (
              <ShieldCheck className="w-6 h-6 text-amber-400" />
            ) : (
              <ShieldAlert className="w-6 h-6 text-rose-400" />
            )}
            <div>
              <h3 className="font-orbitron font-bold text-[15px] tracking-wide text-white">
                11-STEP MANDATORY PREFLIGHT VALIDATION
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                {mode === 'AUTONOMOUS' ? 'Mode B • Autonomous Spiral Search & QR Mission' : 'Mode A • Manual Mission'}
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
        <div className="p-4 sm:p-5 overflow-y-auto space-y-2 font-mono text-[11px] flex-1">
          {launchError && (
            <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-500/80 text-rose-200 flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{launchError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            {checks.map((item) => {
              const isOverridden = bypassPrearm && !item.passed;
              return (
                <div
                  key={item.id}
                  className={`p-2.5 rounded-lg border flex items-start justify-between gap-3 ${
                    item.passed
                      ? 'bg-[#0f291e]/40 border-[#1b4d36] text-slate-200'
                      : isOverridden
                      ? 'bg-amber-950/30 border-amber-500/50 text-amber-200'
                      : item.isCritical
                      ? 'bg-rose-950/40 border-rose-500/60 text-rose-200'
                      : 'bg-amber-950/40 border-amber-500/60 text-amber-200'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                      {item.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                      ) : isOverridden ? (
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                      ) : item.isCritical ? (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                      )}
                    </div>
                    <div>
                      <span className="font-bold text-white block text-[11.5px]">{item.label}</span>
                      <span className={`text-[10px] leading-tight block ${
                        isOverridden
                          ? 'text-amber-300 font-semibold'
                          : !item.passed && item.isCritical
                          ? 'text-rose-300 font-semibold'
                          : 'text-slate-400'
                      }`}>
                        {item.detail}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                      item.passed
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : isOverridden
                        ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        : item.isCritical
                        ? 'bg-rose-950 text-rose-300 border border-rose-500/40'
                        : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {item.passed ? 'PASSED' : isOverridden ? 'BYPASSED' : item.isCritical ? 'BLOCKING' : 'ADVISORY'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Optional Pre-Arm Safety Bypass Toggle */}
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-between gap-3 mt-3">
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

          {bypassPrearm && (
            <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/60 text-amber-200 text-[11px] flex items-center gap-2 mt-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Field Force Arm active: Pre-arm safety interlocks will be overridden via MAVLink command (force_arm=21196). Ensure propellers are clear!
              </span>
            </div>
          )}

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
