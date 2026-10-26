import { useState, useEffect, useRef } from 'react';
import { DroneTelemetry } from '../types/mission';
import { PixhawkConnectionState } from '../types/mavlink';
import { mavlinkService } from '../services/mavlinkService';
import { missionEngine } from '../services/missionEngine';

export interface DashboardTelemetryData {
  isFixture: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  isArmed: boolean;
  flightMode: string;
  satellites: number;
  hdop: number;
  batteryPercent: number;
  batteryVoltage: number;
  altitudeMeters: number;
  speedMs: number;
  verticalSpeedMs: number;
  headingDeg: number;
  rollDeg: number;
  pitchDeg: number;
  latitude: number;
  longitude: number;
  gpsAltitudeMeters: number;
  gpsFixType: string;
  isGpsLocked: boolean;
  isGpsValid: boolean;
  lastGpsUpdate: number;
  gpsAgeMs: number;
  gpsStatusMessage: string;
  flightTimeStr: string;
  rcSignalDetected: boolean;
  rcOverrideEnabled: boolean;
  magFieldStrength: number;
  isCompassHealthy: boolean;
  isCompassCalibrated: boolean;
  isStale: boolean;
  isLinkLost: boolean;
  rawTelemetry: DroneTelemetry;
  rawConnectionState: PixhawkConnectionState;
}

export const useDashboardTelemetry = (): DashboardTelemetryData => {
  const isFixtureMode =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('fixture') === 'reference';

  const [telemetry, setTelemetry] = useState<DroneTelemetry>(() => mavlinkService.getTelemetry());
  const [connState, setConnState] = useState<PixhawkConnectionState>(() => mavlinkService.getConnectionState());
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => missionEngine.getElapsedSeconds());
  const [isStale, setIsStale] = useState<boolean>(false);
  const [isLinkLost, setIsLinkLost] = useState<boolean>(false);

  const lastUpdateRef = useRef<number>(0);
  const pendingUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCoordsRef = useRef<{ lat: number; lon: number }>({ lat: 0, lon: 0 });

  useEffect(() => {
    if (isFixtureMode) return;

    // Intelligent throttle: Immediate dispatch for GPS/coordinate changes; throttled to 100ms for continuous IMU
    const unsubTelemetry = mavlinkService.subscribeTelemetry((t) => {
      const now = Date.now();
      const coordsChanged =
        Math.abs(t.latitude - lastCoordsRef.current.lat) > 0.000001 ||
        Math.abs(t.longitude - lastCoordsRef.current.lon) > 0.000001;

      if (coordsChanged || now - lastUpdateRef.current >= 100) {
        if (pendingUpdateTimerRef.current) {
          clearTimeout(pendingUpdateTimerRef.current);
          pendingUpdateTimerRef.current = null;
        }
        lastUpdateRef.current = now;
        lastCoordsRef.current = { lat: t.latitude, lon: t.longitude };
        setTelemetry(t);
      } else if (!pendingUpdateTimerRef.current) {
        // Trailing edge throttle to guarantee latest data is never dropped
        pendingUpdateTimerRef.current = setTimeout(() => {
          lastUpdateRef.current = Date.now();
          lastCoordsRef.current = { lat: t.latitude, lon: t.longitude };
          setTelemetry(mavlinkService.getTelemetry());
          pendingUpdateTimerRef.current = null;
        }, 100);
      }
    });

    const unsubConn = mavlinkService.subscribeConnection((c) => {
      setConnState(c);
    });

    const unsubMission = missionEngine.subscribeState((_st, elapsed) => {
      setElapsedSeconds(elapsed);
    });

    // Watchdog for stale heartbeat (> 3.5s) and link lost (> 10s)
    const watchdog = setInterval(() => {
      const state = mavlinkService.getConnectionState();
      if ((state.isConnected || state.isUsbConnected || state.isReceivingTelemetry) && state.lastHeartbeat > 0) {
        const age = Date.now() - state.lastHeartbeat;
        setIsStale(age > 3500);
        setIsLinkLost(age > 10000);
      } else {
        setIsStale(false);
        setIsLinkLost(false);
      }
    }, 500);

    return () => {
      unsubTelemetry();
      unsubConn();
      unsubMission();
      clearInterval(watchdog);
      if (pendingUpdateTimerRef.current) {
        clearTimeout(pendingUpdateTimerRef.current);
      }
    };
  }, [isFixtureMode]);

  const formatFlightTime = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (isFixtureMode) {
    return {
      isFixture: true,
      isConnected: true,
      isConnecting: false,
      isArmed: false,
      flightMode: 'DISARMED',
      satellites: 8,
      hdop: 0.9,
      batteryPercent: 88,
      batteryVoltage: 12.4,
      altitudeMeters: 0.0,
      speedMs: 0.0,
      verticalSpeedMs: 0.0,
      headingDeg: 0,
      rollDeg: 0.0,
      pitchDeg: 0.0,
      latitude: 17.3850,
      longitude: 78.4867,
      gpsAltitudeMeters: 540.2,
      gpsFixType: '3D_FIX',
      isGpsLocked: true,
      isGpsValid: true,
      lastGpsUpdate: Date.now(),
      gpsAgeMs: 50,
      gpsStatusMessage: '3D FIX (8 Sats)',
      flightTimeStr: '00:00',
      rcSignalDetected: false,
      rcOverrideEnabled: true,
      magFieldStrength: 480,
      isCompassHealthy: true,
      isCompassCalibrated: true,
      isStale: false,
      isLinkLost: false,
      rawTelemetry: telemetry,
      rawConnectionState: connState,
    };
  }

  const now = Date.now();
  const isSimulated = connState.connectionType === 'SIMULATED';
  const hasLiveHeartbeat = (connState.lastHeartbeat > 0 && (now - connState.lastHeartbeat < 10000)) || isSimulated;
  const isConnected = Boolean(
    (connState.isConnected || connState.isReceivingTelemetry || telemetry.pixhawkConnected || isSimulated) &&
    hasLiveHeartbeat &&
    !isLinkLost
  );
  const isConnecting = Boolean(
    !isSimulated &&
    ((connState.isUsbConnected && !hasLiveHeartbeat) ||
    connState.phase === 'WAITING_FOR_MAVLINK' ||
    connState.phase === 'SERIAL_OPENING' ||
    connState.phase === 'WAITING_FOR_HEARTBEAT' ||
    connState.phase === 'SERIAL_OPEN')
  );

  const lat = telemetry.latitude || telemetry.gps?.latitude || 0;
  const lon = telemetry.longitude || telemetry.gps?.longitude || 0;
  const hasValidGpsCoords = Boolean(
    lat !== 0 &&
    lon !== 0 &&
    Math.abs(lat) > 0.0001 &&
    Math.abs(lon) > 0.0001 &&
    Math.abs(lat) <= 90.0 &&
    Math.abs(lon) <= 180.0
  );

  const sats = telemetry.gps?.satellites || telemetry.satellitesVisible || 0;
  const lastGpsUpdate = telemetry.gps?.lastUpdated || 0;
  const gpsAgeMs = lastGpsUpdate > 0 ? (now - lastGpsUpdate) : (connState.lastHeartbeat > 0 ? now - connState.lastHeartbeat : 999999);
  const isGpsLocked = Boolean(
    telemetry.gps?.isLocked ||
    hasValidGpsCoords ||
    (telemetry.gps?.fixType && telemetry.gps.fixType.includes('3D')) ||
    (sats >= 4 && !isLinkLost)
  );
  const isGpsValid = Boolean(isGpsLocked && hasValidGpsCoords);
  const gpsFixType = telemetry.gps?.fixType || (isGpsValid ? '3D_FIX' : 'NO_GPS');
  const gpsAltitudeMeters = telemetry.gps?.altitude || 0.0;

  let gpsStatusMessage = 'Pixhawk GPS Signal Unavailable';
  if (isGpsValid) {
    gpsStatusMessage = `${gpsFixType} (${sats} Sats)`;
  } else if (!isConnected) {
    gpsStatusMessage = 'Pixhawk Disconnected';
  } else if (isLinkLost || isStale) {
    gpsStatusMessage = 'MAVLink Telemetry Stale / Paused';
  } else if (sats > 0) {
    gpsStatusMessage = `Acquiring Fix (${sats} Sats Visible)`;
  }

  return {
    isFixture: false,
    isConnected,
    isConnecting,
    isArmed: isConnected ? Boolean(telemetry.isArmed) : false,
    flightMode: isConnected ? (telemetry.flightMode || 'DISARMED') : 'DISCONNECTED',
    satellites: sats,
    hdop: telemetry.gps?.hdop ?? (isGpsValid ? 1.0 : 99.0),
    batteryPercent: telemetry.batteryPercent ?? 0,
    batteryVoltage: telemetry.batteryVoltage ?? 0,
    altitudeMeters: telemetry.altitude ?? 0.0,
    speedMs: telemetry.groundSpeed ?? 0.0,
    verticalSpeedMs: telemetry.verticalSpeed ?? 0.0,
    headingDeg: Math.round(((telemetry.heading ?? 0) % 360 + 360) % 360),
    rollDeg: telemetry.roll ?? 0.0,
    pitchDeg: telemetry.pitch ?? 0.0,
    latitude: hasValidGpsCoords ? lat : 0,
    longitude: hasValidGpsCoords ? lon : 0,
    gpsAltitudeMeters,
    gpsFixType,
    isGpsLocked,
    isGpsValid,
    lastGpsUpdate,
    gpsAgeMs,
    gpsStatusMessage,
    flightTimeStr: formatFlightTime(elapsedSeconds),
    rcSignalDetected: Boolean(telemetry.rcSignalDetected),
    rcOverrideEnabled: Boolean(connState.rcOverrideEnabled ?? telemetry.rcOverrideEnabled ?? true),
    magFieldStrength: telemetry.magFieldStrength ?? 480,
    isCompassHealthy: telemetry.isCompassHealthy ?? true,
    isCompassCalibrated: telemetry.isCompassCalibrated ?? true,
    isStale,
    isLinkLost,
    rawTelemetry: telemetry,
    rawConnectionState: connState,
  };
};
