import { mavlinkService } from './mavlinkService';
import { audioService } from './audioService';
import { DroneTelemetry, HomePoint } from '../types/mission';
import { PixhawkConnectionState } from '../types/mavlink';
import {
  CircleTestConfig,
  CircleTestState,
  CircleTestValidation,
  CircleTestPrerequisite
} from '../types/circleTest';

type CircleStateListener = (state: CircleTestState) => void;

class CircleTestService {
  private config: CircleTestConfig = {
    missionName: 'AUTONOMOUS_CIRCLE_TEST',
    circleDiameterMeters: 10,
    targetAltitudeMeters: 5,
    flightSpeedMps: 2.0,
    laps: 1,
    direction: 'CW',
    landingPosition: 'Home / Takeoff Position',
    altitudeTolerance: 0.5
  };

  private state: CircleTestState = {
    step: 'IDLE',
    stepMessage: 'Ready for diameter, altitude configuration & operator authorization.',
    isExecuting: false,
    currentAltitude: 0,
    targetAltitude: 5,
    circleDiameterMeters: 10,
    circleRadiusMeters: 5,
    currentAngleDeg: 0,
    currentLap: 1,
    totalLaps: 1,
    progressPercent: 0,
    flightSpeedMps: 2.0,
    direction: 'CW',
    elapsedSeconds: 0
  };

  private listeners: Set<CircleStateListener> = new Set();
  private telemetryUnsub: (() => void) | null = null;
  private orbitTicker: any = null;
  private waypointsTicker: any = null;
  private armingWatchdog: any = null;
  private climbWatchdog: any = null;
  private transitWatchdog: any = null;
  private descentWatchdog: any = null;
  private centerRef: { lat: number; lon: number; alt: number } | null = null;
  private perimeterRef: { lat: number; lon: number } | null = null;
  private circleWaypoints: Array<{ lat: number; lon: number; alt: number; angleDeg: number }> = [];
  private currentWpIdx: number = 0;
  private currentWpStartTime: number = 0;
  private startOrbitAngle: number = 0;
  private totalDegreesTraveled: number = 0;
  private simOrbitInterval: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const savedDiameter = localStorage.getItem('SAE_CIRCLE_DIAMETER');
        if (savedDiameter) {
          const parsed = parseFloat(savedDiameter);
          if (!isNaN(parsed) && parsed >= 2 && parsed <= 150) {
            this.config.circleDiameterMeters = parsed;
            this.state.circleDiameterMeters = parsed;
            this.state.circleRadiusMeters = +(parsed / 2).toFixed(1);
          }
        }

        const savedAlt = localStorage.getItem('SAE_CIRCLE_ALTITUDE');
        if (savedAlt) {
          const parsed = parseFloat(savedAlt);
          if (!isNaN(parsed) && parsed >= 2 && parsed <= 60) {
            this.config.targetAltitudeMeters = parsed;
            this.state.targetAltitude = parsed;
          }
        }

        const savedLaps = localStorage.getItem('SAE_CIRCLE_LAPS');
        if (savedLaps) {
          const parsed = parseInt(savedLaps, 10);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
            this.config.laps = parsed;
            this.state.totalLaps = parsed;
          }
        }

        const savedDir = localStorage.getItem('SAE_CIRCLE_DIRECTION');
        if (savedDir === 'CW' || savedDir === 'CCW') {
          this.config.direction = savedDir;
          this.state.direction = savedDir;
        }
      } catch (e) {
        // ignore
      }
    }
  }

  public getConfig(): CircleTestConfig {
    return { ...this.config };
  }

  public getState(): CircleTestState {
    return { ...this.state };
  }

  public setDiameter(diameter: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(2, Math.min(150, +diameter.toFixed(1)));
    this.config.circleDiameterMeters = clamped;
    this.state.circleDiameterMeters = clamped;
    this.state.circleRadiusMeters = +(clamped / 2).toFixed(1);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_CIRCLE_DIAMETER', String(clamped));
      } catch (e) {}
    }
    this.notifyState();
  }

  public setAltitude(altitude: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(2, Math.min(60, +altitude.toFixed(1)));
    this.config.targetAltitudeMeters = clamped;
    this.state.targetAltitude = clamped;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_CIRCLE_ALTITUDE', String(clamped));
      } catch (e) {}
    }
    this.notifyState();
  }

  public setLaps(laps: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(1, Math.min(5, Math.floor(laps)));
    this.config.laps = clamped;
    this.state.totalLaps = clamped;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_CIRCLE_LAPS', String(clamped));
      } catch (e) {}
    }
    this.notifyState();
  }

  public setFlightSpeed(speed: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(1.0, Math.min(5.0, +speed.toFixed(1)));
    this.config.flightSpeedMps = clamped;
    this.state.flightSpeedMps = clamped;
    this.notifyState();
  }

  public setDirection(direction: 'CW' | 'CCW'): void {
    if (this.state.isExecuting) return;
    this.config.direction = direction;
    this.state.direction = direction;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_CIRCLE_DIRECTION', direction);
      } catch (e) {}
    }
    this.notifyState();
  }

  public subscribeState(listener: CircleStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyState(): void {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }

  /**
   * Validate safety prerequisites before allowing autonomous circle test
   */
  /**
   * Strict coordinate validator: guarantees valid, non-zero, finite, real-world GPS coordinates
   */
  public isValidCoordinate(lat?: number | null, lon?: number | null): boolean {
    if (lat === null || lat === undefined || lon === null || lon === undefined) return false;
    if (typeof lat !== 'number' || typeof lon !== 'number') return false;
    if (isNaN(lat) || isNaN(lon) || !isFinite(lat) || !isFinite(lon)) return false;
    if (lat === 0 && lon === 0) return false;
    if (Math.abs(lat) < 0.0001 || Math.abs(lon) < 0.0001) return false;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
    return true;
  }

  /**
   * Geodesic distance calculation between two GPS coordinates using WGS-84 projection (in meters)
   */
  public calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const earthRadius = 6378137.0;
    const dLat = ((lat2 - lat1) * Math.PI) / 180.0;
    const dLon = ((lon2 - lon1) * Math.PI) / 180.0;
    const meanLat = ((lat1 + lat2) / 2.0) * (Math.PI / 180.0);
    const y = dLat * earthRadius;
    const x = dLon * earthRadius * Math.cos(meanLat);
    return Math.hypot(x, y);
  }

  /**
   * Generates GPS circular waypoints around a valid center reference point.
   * Uses proper Earth local-coordinate conversion (WGS-84 tangent plane)
   * radius = diameter / 2
   * angle = 2π * i / numberOfPoints
   */
  public generateCircleWaypoints(
    centerLat: number,
    centerLon: number,
    diameterMeters: number,
    altitudeMeters: number,
    numberOfPoints: number = 16,
    direction: 'CW' | 'CCW' = 'CW'
  ): Array<{ lat: number; lon: number; alt: number; angleDeg: number }> {
    const radius = diameterMeters / 2.0;
    const earthRadius = 6378137.0; // WGS-84 equatorial radius in meters
    const waypoints: Array<{ lat: number; lon: number; alt: number; angleDeg: number }> = [];

    const radLat = (centerLat * Math.PI) / 180.0;
    const cosLat = Math.cos(radLat);

    for (let i = 0; i < numberOfPoints; i++) {
      const fraction = i / numberOfPoints;
      const angleRad = (direction === 'CW' ? 1 : -1) * 2.0 * Math.PI * fraction;
      const angleDeg = (fraction * 360.0) % 360.0;

      // Local tangent plane offsets in meters:
      // dx: East offset (+East, -West)
      // dy: North offset (+North, -South)
      const dxMeters = radius * Math.sin(angleRad);
      const dyMeters = radius * Math.cos(angleRad);

      // Geodesic coordinate conversion:
      const dLat = (dyMeters / earthRadius) * (180.0 / Math.PI);
      const dLon = (dxMeters / (earthRadius * cosLat)) * (180.0 / Math.PI);

      waypoints.push({
        lat: +(centerLat + dLat).toFixed(7),
        lon: +(centerLon + dLon).toFixed(7),
        alt: altitudeMeters,
        angleDeg: Math.round(angleDeg)
      });
    }

    return waypoints;
  }

  /**
   * Validate safety prerequisites before allowing autonomous circle test
   */
  public validatePrerequisites(
    telemetry: DroneTelemetry,
    pixhawkState: PixhawkConnectionState,
    homePoint: HomePoint
  ): CircleTestValidation {
    const isConn = Boolean(pixhawkState.isConnected || pixhawkState.isUsbConnected);
    const hasTelem = Boolean(isConn && (pixhawkState.isReceivingTelemetry || pixhawkState.lastHeartbeat > 0));

    // GPS requirements for safe autonomous navigation
    const satCount = telemetry.gps.satellites || 0;
    const is3DFix =
      telemetry.gps.fixType === '3D_FIX' ||
      telemetry.gps.fixType === 'DGPS' ||
      telemetry.gps.fixType === 'RTK_FIXED' ||
      telemetry.gps.fixType === 'RTK_FLOAT';
    const hdop = telemetry.gps.hdop || 99;
    const gpsLocked = Boolean(telemetry.gps.isLocked || is3DFix);
    const gpsAdequate = gpsLocked && is3DFix && satCount >= 6 && (hdop <= 3.5 || hdop === 0);

    // Validate Home position & GPS coordinates strictly (no 0,0, no null/undefined, no stale coordinates)
    const isHomeValid = Boolean(homePoint.isSet && this.isValidCoordinate(homePoint.latitude, homePoint.longitude));
    const isCurrentGpsValid = Boolean(
      is3DFix &&
      this.isValidCoordinate(telemetry.latitude, telemetry.longitude) &&
      this.isValidCoordinate(telemetry.gps.latitude, telemetry.gps.longitude)
    );
    const hasValidCenter = isHomeValid || isCurrentGpsValid;

    // Vehicle ground state
    const onGround = telemetry.altitude <= 1.5 && !telemetry.isArmed;

    // Battery safety
    const batteryAdequate = telemetry.batteryPercent >= 20 || telemetry.batteryPercent === 0;

    const prerequisites: CircleTestPrerequisite[] = [
      {
        id: 'fc_connection',
        label: 'Flight Controller MAVLink Connected',
        passed: isConn,
        reason: isConn ? 'Link active' : 'Flight controller is offline. Check WebSocket / USB link.'
      },
      {
        id: 'fc_telemetry',
        label: 'Live Telemetry & Heartbeat Streaming',
        passed: hasTelem,
        reason: hasTelem ? 'Heartbeat active' : 'No MAVLink heartbeat received from Pixhawk.'
      },
      {
        id: 'gps_lock',
        label: 'GPS 3D Fix & Satellites (Required for Orbit)',
        passed: gpsAdequate,
        reason: gpsAdequate
          ? `GPS READY: ${satCount} Sats (Fix: ${(telemetry.gps.fixType || '3D_FIX').replace('_', ' ')}, HDOP ${hdop.toFixed(1)})`
          : `GPS Inadequate (Sats: ${satCount}/6, Fix: ${telemetry.gps.fixType || 'NO_FIX'})`
      },
      {
        id: 'home_position',
        label: 'Home Position / GPS Anchor (Orbit Center)',
        passed: hasValidCenter,
        reason: isHomeValid
          ? `Home Reference Locked: ${homePoint.latitude.toFixed(6)}, ${homePoint.longitude.toFixed(6)}`
          : isCurrentGpsValid
          ? `GPS Position Locked: ${telemetry.latitude.toFixed(6)}, ${telemetry.longitude.toFixed(6)}`
          : 'Valid Home/GPS position required for Circle Test'
      },
      {
        id: 'vehicle_state',
        label: 'Vehicle Disarmed on Ground',
        passed: onGround,
        reason: onGround ? 'Disarmed on ground ✓' : (telemetry.isArmed ? 'Vehicle is already ARMED!' : 'Altitude > 1.5m')
      },
      {
        id: 'battery_level',
        label: 'Battery Level Above Minimum Reserve (≥20%)',
        passed: batteryAdequate,
        reason: batteryAdequate ? `${telemetry.batteryPercent}% Remaining` : `Battery critical: ${telemetry.batteryPercent}%`
      }
    ];

    const failed = prerequisites.find((p) => !p.passed);
    return {
      allPassed: !failed,
      prerequisites,
      blockingReason: failed ? `${failed.label}: ${failed.reason}` : undefined
    };
  }

  /**
   * Execute the AUTONOMOUS_CIRCLE_TEST sequence using real GPS circular waypoints
   */
  public async executeMission(
    telemetry: DroneTelemetry,
    pixhawkState: PixhawkConnectionState,
    homePoint: HomePoint,
    forceOverride: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    if (this.state.isExecuting) {
      return { success: false, error: 'Autonomous Circle Test is already executing.' };
    }

    const val = this.validatePrerequisites(telemetry, pixhawkState, homePoint);
    if (!val.allPassed && !forceOverride) {
      audioService.playBeep(300, 300, 'sawtooth');
      return { success: false, error: val.blockingReason || 'Prerequisites check failed.' };
    }

    const is3DFix =
      telemetry.gps.fixType === '3D_FIX' ||
      telemetry.gps.fixType === 'DGPS' ||
      telemetry.gps.fixType === 'RTK_FIXED' ||
      telemetry.gps.fixType === 'RTK_FLOAT';

    // Strict coordinate validation: retrieve valid Home or live GPS anchor
    let centerLat: number | null = null;
    let centerLon: number | null = null;
    let centerAlt: number = 0;

    if (homePoint.isSet && this.isValidCoordinate(homePoint.latitude, homePoint.longitude)) {
      centerLat = homePoint.latitude;
      centerLon = homePoint.longitude;
      centerAlt = homePoint.altitude || telemetry.altitude || 0;
    } else if (
      is3DFix &&
      this.isValidCoordinate(telemetry.latitude, telemetry.longitude)
    ) {
      centerLat = telemetry.latitude;
      centerLon = telemetry.longitude;
      centerAlt = telemetry.gps.altitude || telemetry.altitude || 0;
    }

    // Fail safe: If no valid real-world coordinates, abort immediately (do NOT use (0,0) or fallback)
    if (
      centerLat === null ||
      centerLon === null ||
      !this.isValidCoordinate(centerLat, centerLon)
    ) {
      audioService.playBeep(300, 300, 'sawtooth');
      return {
        success: false,
        error: 'Valid Home/GPS position required for Circle Test'
      };
    }

    this.centerRef = { lat: centerLat, lon: centerLon, alt: centerAlt };

    // Auto-Set Home with Pixhawk if not yet registered
    if (!homePoint.isSet) {
      try {
        await mavlinkService.setHomePoint(centerLat, centerLon, centerAlt);
      } catch (e) {
        console.warn('[CIRCLE_TEST] Set home note:', e);
      }
    }

    const radiusMeters = this.config.circleDiameterMeters / 2.0;
    const targetAlt = this.config.targetAltitudeMeters;
    const numberOfPoints = 16;

    // Generate 16 GPS circle waypoints using geodesic Earth projection around Home
    const waypoints = this.generateCircleWaypoints(
      centerLat,
      centerLon,
      this.config.circleDiameterMeters,
      targetAlt,
      numberOfPoints,
      this.config.direction
    );
    this.circleWaypoints = waypoints;
    this.currentWpIdx = 0;

    // Upload MAVLink mission containing takeoff, circular perimeter waypoints, return to center, and land
    try {
      const missionPayload = [
        { seq: 0, lat: centerLat, lon: centerLon, alt: 0, command: 16 /* Home */, frame: 0, autocontinue: 1, current: 0 },
        { seq: 1, lat: centerLat, lon: centerLon, alt: targetAlt, command: 22 /* Takeoff */, frame: 6, autocontinue: 1, current: 0 },
        ...waypoints.map((wp, idx) => ({
          seq: 2 + idx,
          lat: wp.lat,
          lon: wp.lon,
          alt: wp.alt,
          command: 16 /* Waypoint */,
          frame: 6,
          param2: 1.0,
          autocontinue: 1,
          current: 0
        })),
        { seq: 2 + waypoints.length, lat: centerLat, lon: centerLon, alt: targetAlt, command: 16, frame: 6, autocontinue: 1, current: 0 },
        { seq: 3 + waypoints.length, lat: centerLat, lon: centerLon, alt: 0, command: 21 /* Land */, frame: 0, autocontinue: 1, current: 0 }
      ];
      const uploadRes = await mavlinkService.uploadMissionWaypoints(missionPayload);
      if (!uploadRes.success) {
        console.warn('[CIRCLE_TEST] MAVLink mission upload warning:', uploadRes.message);
      }
    } catch (e) {
      console.warn('[CIRCLE_TEST] MAVLink mission upload notice:', e);
    }

    this.clearAllTimers();
    this.totalDegreesTraveled = 0;
    this.startOrbitAngle = 0;

    this.state = {
      step: 'ARMING',
      stepMessage: `[1/6] Arming Pixhawk FC in GUIDED mode (Target Alt: ${targetAlt}m, Diameter: ${this.config.circleDiameterMeters}m, ${numberOfPoints} waypoints)...`,
      isExecuting: true,
      currentAltitude: telemetry.altitude,
      targetAltitude: targetAlt,
      circleDiameterMeters: this.config.circleDiameterMeters,
      circleRadiusMeters: radiusMeters,
      currentAngleDeg: 0,
      currentLap: 1,
      totalLaps: this.config.laps,
      progressPercent: 0,
      flightSpeedMps: this.config.flightSpeedMps,
      direction: this.config.direction,
      startTime: Date.now(),
      elapsedSeconds: 0
    };
    this.notifyState();
    audioService.playBeep(784, 150);

    // Step 1: Switch to GUIDED flight mode and Arm motors
    try {
      await mavlinkService.setFlightMode('GUIDED');
      if (!telemetry.isArmed) {
        await mavlinkService.sendArmCommand(forceOverride);
      }
    } catch (e: any) {
      this.abort(`Arming failed: ${e?.message || e}`);
      return { success: false, error: `Arming failed: ${e?.message || e}` };
    }

    // Arming timeout watchdog (8s)
    this.armingWatchdog = setTimeout(() => {
      if (this.state.step === 'ARMING') {
        const telem = mavlinkService.getTelemetry();
        const conn = mavlinkService.getConnectionState();
        if (!telem.isArmed) {
          const detail = conn.preArmFailReason
            ? `Pixhawk PreArm: ${conn.preArmFailReason}`
            : 'Pixhawk FC did not arm motors within 8 seconds. Verify Safety Switch / Compass.';
          this.abort(detail);
        }
      }
    }, 8000);

    // Bind telemetry stream watcher for climb, orbit navigation, return, and landing
    this.bindTelemetryWatch();

    // If already armed on ground, immediately climb
    if (telemetry.isArmed) {
      this.initiateClimb();
    }

    return { success: true };
  }

  private initiateClimb(): void {
    if (this.armingWatchdog) clearTimeout(this.armingWatchdog);
    this.state.step = 'TAKEOFF_CLIMB';
    const alt = this.config.targetAltitudeMeters;
    this.state.stepMessage = `[2/6] Motors Armed ✓. Autonomous vertical takeoff to ${alt}m AGL...`;
    this.notifyState();

    audioService.playBeep(880, 100);

    // If vehicle is already airborne and leveled near target altitude, transition directly to orbit
    const curTelem = mavlinkService.getTelemetry();
    if (curTelem.isArmed && curTelem.altitude >= (alt - 1.0)) {
      this.state.stepMessage = `Aircraft already airborne at ${curTelem.altitude.toFixed(1)}m ✓. Commencing circular orbit directly...`;
      this.notifyState();
      this.startCircularOrbit();
      return;
    }

    // Command Takeoff to target altitude
    mavlinkService.commandTakeoff(alt);

    // Climb watchdog: if aircraft is safely airborne and leveled off, smoothly proceed to orbit
    if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
    this.climbWatchdog = setTimeout(() => {
      if (this.state.step === 'TAKEOFF_CLIMB') {
        const cur = mavlinkService.getTelemetry();
        if (cur.altitude >= Math.max(2.0, alt * 0.65)) {
          console.warn(`[CIRCLE_TEST] Climb watchdog timer expired, but aircraft is airborne at ${cur.altitude.toFixed(1)}m. Commencing orbit.`);
          this.startCircularOrbit();
        } else {
          this.abort(`Takeoff timeout: Did not reach ${alt}m within 25 seconds.`);
        }
      }
    }, 25000);
  }

  private bindTelemetryWatch(): void {
    if (this.telemetryUnsub) this.telemetryUnsub();

    this.telemetryUnsub = mavlinkService.subscribeTelemetry((telem) => {
      if (!this.state.isExecuting) return;

      this.state.currentAltitude = telem.altitude;

      // 1. Arming Confirmed -> Start Climb
      if (this.state.step === 'ARMING' && telem.isArmed) {
        this.initiateClimb();
      }

      // 2. Altitude Reached or Climb Leveled Off -> Start Circle Waypoints Orbit
      if (this.state.step === 'TAKEOFF_CLIMB') {
        const targetAlt = this.config.targetAltitudeMeters;
        const margin = Math.max(1.0, this.config.altitudeTolerance || 1.0);
        const altReached = telem.altitude >= (targetAlt - margin);
        // Barometer level-off check: reached at least 70% of target altitude and vertical speed leveled off
        const climbLeveledOff = telem.altitude >= Math.max(1.8, targetAlt * 0.70) && Math.abs(telem.verticalSpeed) < 0.25;

        if (altReached || climbLeveledOff) {
          if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
          this.startCircularOrbit();
        }
      }

      // 3. Landing touchdown detection -> Disarm only when safely on ground
      if (this.state.step === 'DESCENDING' || this.state.step === 'LANDING') {
        if (!telem.isArmed) {
          // ArduPilot natively detected touchdown and disarmed
          if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
          this.disarmAndComplete();
        } else if (telem.altitude <= 0.20 && Math.abs(telem.verticalSpeed) <= 0.15) {
          // Sustained stationary contact on ground
          if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
          setTimeout(() => {
            const cur = mavlinkService.getTelemetry();
            if (!cur.isArmed || cur.altitude <= 0.20) {
              this.disarmAndComplete();
            }
          }, 1500);
        }
      }
    });
  }

  /**
   * Executes the circular flight by guiding the drone sequentially through
   * the 16 geodesic GPS waypoints using Pixhawk's onboard position controller.
   */
  private async startCircularOrbit(): Promise<void> {
    if (!this.centerRef || this.circleWaypoints.length === 0) return;

    this.state.step = 'ORBITING';
    const radius = this.state.circleRadiusMeters;
    const speed = this.config.flightSpeedMps;
    const alt = this.config.targetAltitudeMeters;
    const totalWaypoints = this.circleWaypoints.length;

    this.state.stepMessage = `[4/6] Executing Circle Flight: Diameter ${this.config.circleDiameterMeters}m (Radius: ${radius}m) at ${speed}m/s [${this.config.direction}]...`;
    this.notifyState();

    audioService.playBeep(1046, 150);

    this.currentWpIdx = 0;
    this.currentWpStartTime = Date.now();

    // Command the first circle waypoint to Pixhawk position controller
    const initialWp = this.circleWaypoints[0];
    await mavlinkService.flyToPosition(initialWp.lat, initialWp.lon, alt, speed);

    // Calculate arc distance between consecutive circle waypoints: (2 * PI * R) / totalWaypoints
    const arcLengthMeters = (2 * Math.PI * radius) / totalWaypoints;
    const estimatedTimePerWpSec = Math.max(3.0, arcLengthMeters / speed);
    // Give drone ample time (at least 25 seconds per waypoint) to navigate to each arc point
    const maxTimeoutPerWpMs = Math.max(25000, Math.round((estimatedTimePerWpSec * 3 + 10) * 1000));

    if (this.waypointsTicker) clearInterval(this.waypointsTicker);

    let lastRepositionSendTime = Date.now();

    this.waypointsTicker = setInterval(async () => {
      if (this.state.step !== 'ORBITING') {
        clearInterval(this.waypointsTicker);
        return;
      }

      const telem = mavlinkService.getTelemetry();
      const currentTarget = this.circleWaypoints[this.currentWpIdx];
      if (!currentTarget) {
        clearInterval(this.waypointsTicker);
        this.returnToCenterTakeoffPoint();
        return;
      }

      // Check distance from current drone GPS to active circle waypoint
      const dist = this.calculateDistanceMeters(
        telem.latitude,
        telem.longitude,
        currentTarget.lat,
        currentTarget.lon
      );

      const elapsedOnWpMs = Date.now() - this.currentWpStartTime;
      // Dynamically scale acceptance radius based on arc length so points are not skipped prematurely
      const dynamicAcceptanceRadius = Math.max(1.2, Math.min(2.8, arcLengthMeters * 0.65));
      const waypointReached = dist <= dynamicAcceptanceRadius || elapsedOnWpMs >= maxTimeoutPerWpMs;

      // Periodically refresh position target to Pixhawk position controller every 2.5 seconds
      if (Date.now() - lastRepositionSendTime >= 2500) {
        lastRepositionSendTime = Date.now();
        mavlinkService.flyToPosition(currentTarget.lat, currentTarget.lon, alt, speed);
      }

      if (waypointReached) {
        this.currentWpIdx++;
        this.currentWpStartTime = Date.now();
        lastRepositionSendTime = Date.now();

        // Check if lap or all laps complete
        if (this.currentWpIdx >= totalWaypoints) {
          if (this.state.currentLap < this.config.laps) {
            this.state.currentLap++;
            this.currentWpIdx = 0;
            const nextWp = this.circleWaypoints[0];
            await mavlinkService.flyToPosition(nextWp.lat, nextWp.lon, alt, speed);
          } else {
            // All laps finished!
            clearInterval(this.waypointsTicker);
            this.returnToCenterTakeoffPoint();
            return;
          }
        } else {
          // Progress to next waypoint along circle
          const nextWp = this.circleWaypoints[this.currentWpIdx];
          await mavlinkService.flyToPosition(nextWp.lat, nextWp.lon, alt, speed);
        }
      }

      // Update progress metrics
      const activeWp = this.circleWaypoints[Math.min(this.currentWpIdx, totalWaypoints - 1)];
      const totalPoints = totalWaypoints * this.config.laps;
      const completedPoints = (this.state.currentLap - 1) * totalWaypoints + this.currentWpIdx;
      const progress = Math.min(99, Math.round((completedPoints / totalPoints) * 100));

      this.state.currentAngleDeg = activeWp.angleDeg;
      this.state.progressPercent = progress;
      this.state.stepMessage = `[4/6] Flying Circle Waypoint ${this.currentWpIdx + 1}/${totalWaypoints} (${activeWp.angleDeg}°) — Lap ${this.state.currentLap}/${this.config.laps}, D: ${this.config.circleDiameterMeters}m, Alt: ${telem.altitude.toFixed(1)}m.`;
      this.notifyState();
    }, 400);
  }

  private async returnToCenterTakeoffPoint(): Promise<void> {
    if (!this.centerRef) return;

    this.state.step = 'RETURNING_TO_CENTER';
    const alt = this.config.targetAltitudeMeters;
    this.state.stepMessage = `[5/6] ${this.config.laps} lap(s) complete! Repositioning back to Home position (${this.centerRef.lat.toFixed(5)}, ${this.centerRef.lon.toFixed(5)})...`;
    this.notifyState();

    audioService.playBeep(784, 150);

    // Fly back to takeoff center coordinate
    await mavlinkService.flyToPosition(
      this.centerRef.lat,
      this.centerRef.lon,
      alt,
      this.config.flightSpeedMps
    );

    const returnTimeoutMs = Math.max(4000, Math.min(15000, Math.round((this.state.circleRadiusMeters / this.config.flightSpeedMps) * 1000) + 2500));
    const returnStartTime = Date.now();

    const returnInterval = setInterval(() => {
      if (this.state.step !== 'RETURNING_TO_CENTER') {
        clearInterval(returnInterval);
        return;
      }
      const telem = mavlinkService.getTelemetry();
      const dist = this.calculateDistanceMeters(telem.latitude, telem.longitude, this.centerRef!.lat, this.centerRef!.lon);
      const elapsed = Date.now() - returnStartTime;
      if (dist <= 1.8 || elapsed >= returnTimeoutMs) {
        clearInterval(returnInterval);
        this.beginDescentAndLand();
      }
    }, 300);
  }

  private beginDescentAndLand(): void {
    this.state.step = 'DESCENDING';
    this.state.stepMessage = `[6/6] Over Home reference. Initiating controlled vertical descent & landing...`;
    this.notifyState();

    audioService.playBeep(659, 150);

    // Command Landing
    mavlinkService.commandLand();

    setTimeout(() => {
      if (this.state.step === 'DESCENDING') {
        this.state.step = 'LANDING';
        this.state.stepMessage = `[6/6] Final descent to touchdown at Home position.`;
        this.notifyState();
      }
    }, 1500);

    // Descent watchdog (50s) - allow ample time for safe landing and ArduPilot native touchdown disarm
    if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
    this.descentWatchdog = setTimeout(() => {
      if (this.state.step === 'DESCENDING' || this.state.step === 'LANDING') {
        const cur = mavlinkService.getTelemetry();
        if (!cur.isArmed || cur.altitude <= 0.25) {
          this.disarmAndComplete();
        } else {
          this.abort('Descent timeout: Drone did not touchdown within 50 seconds.');
        }
      }
    }, 50000);
  }

  private async disarmAndComplete(): Promise<void> {
    this.clearAllTimers();

    this.state.step = 'DISARMING';
    this.state.stepMessage = `Touchdown confirmed. Motors disarmed.`;
    this.notifyState();

    if (mavlinkService.getTelemetry().isArmed) {
      try {
        await mavlinkService.sendDisarmCommand(false); // SAFE NON-FORCED DISARM
      } catch (e) {}
    }

    setTimeout(() => {
      this.state.step = 'COMPLETED';
      this.state.stepMessage = `AUTONOMOUS CIRCLE TEST complete! Successfully executed: Takeoff (${this.config.targetAltitudeMeters}m) ➔ Diameter ${this.config.circleDiameterMeters}m Orbit (${this.config.laps} lap, ${this.config.direction}) ➔ Return to Center ➔ Touchdown ➔ Disarmed.`;
      this.state.isExecuting = false;
      this.state.progressPercent = 100;
      this.notifyState();

      audioService.playBeep(1046, 250);
      this.cleanup();
    }, 1500);
  }

  public abort(reason: string = 'Operator Aborted'): void {
    this.clearAllTimers();

    const wasExecuting = this.state.isExecuting;
    this.state.isExecuting = false;
    this.state.step = 'ABORTED';
    this.state.error = reason;
    this.state.stepMessage = `Mission Aborted: ${reason}`;
    this.notifyState();

    audioService.playBeep(300, 400, 'sawtooth');

    // If airborne, maintain position in LOITER or command LAND for safety
    const telem = mavlinkService.getTelemetry();
    const isAirborne = telem.altitude > 0.3 || ['CLIMBING', 'TRANSITING_TO_PERIMETER', 'ORBITING', 'RETURNING_TO_CENTER', 'DESCENDING'].includes(this.state.step);
    if (wasExecuting && telem.isArmed && isAirborne) {
      mavlinkService.setFlightMode('LOITER');
    }

    this.cleanup();
  }

  private clearAllTimers(): void {
    if (this.orbitTicker) clearInterval(this.orbitTicker);
    if (this.waypointsTicker) clearInterval(this.waypointsTicker);
    if (this.armingWatchdog) clearTimeout(this.armingWatchdog);
    if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
    if (this.transitWatchdog) clearTimeout(this.transitWatchdog);
    if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
    if (this.simOrbitInterval) clearInterval(this.simOrbitInterval);
  }

  private cleanup(): void {
    if (this.telemetryUnsub) {
      this.telemetryUnsub();
      this.telemetryUnsub = null;
    }
  }

  public resetState(): void {
    if (this.state.isExecuting) return;
    this.clearAllTimers();
    this.cleanup();
    this.state = {
      step: 'IDLE',
      stepMessage: 'Ready for diameter, altitude configuration & operator authorization.',
      isExecuting: false,
      currentAltitude: 0,
      targetAltitude: this.config.targetAltitudeMeters,
      circleDiameterMeters: this.config.circleDiameterMeters,
      circleRadiusMeters: +(this.config.circleDiameterMeters / 2).toFixed(1),
      currentAngleDeg: 0,
      currentLap: 1,
      totalLaps: this.config.laps,
      progressPercent: 0,
      flightSpeedMps: this.config.flightSpeedMps,
      direction: this.config.direction,
      elapsedSeconds: 0
    };
    this.notifyState();
  }
}

export const circleTestService = new CircleTestService();
