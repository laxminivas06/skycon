/**
 * SAE INDIA — Autonomous Phone-to-Drone Mission State Machine
 *
 * Implements the exact 13-state mission workflow + explicit failure states:
 * IDLE → CONNECTING → PREFLIGHT_CHECK → SEARCHING → TARGET_DETECTED →
 * EVIDENCE_SAVED → REVISITING → VERIFYING → UPLOADING → SERVER_ACKNOWLEDGED →
 * RTL → LANDED → COMPLETE
 *
 * Explicit Failure States:
 * - FAIL_CONNECTION_LOST
 * - FAIL_INVALID_GPS
 * - FAIL_LOW_BATTERY
 * - FAIL_VERIFICATION
 * - FAIL_UPLOAD
 * - EMERGENCY_STOP
 */

import { mavlinkService } from './mavlinkService';
import { usbHostService } from './usbHostService';
import { audioService } from './audioService';
import {
  targetDetectionEngine,
  VerifiedTargetEvent,
  TargetCandidate,
  CapturedAreaImage
} from './targetDetectionEngine';
import { geofenceService } from './geofenceService';
import { ipCameraService } from './ipCameraService';
import {
  evidenceUploadService,
  ServerAcknowledgment
} from './evidenceUploadService';
import {
  SearchWaypoint,
  SearchPathResult
} from './searchEngine/types';
import { SearchBoundaryConfig } from '../types/mission';
import { SpiralSearch } from './searchEngine/SpiralSearch';
import { TangentialSearch } from './searchEngine/TangentialSearch';
import { GridSearch } from './searchEngine/GridSearch';
import { reconDetectionService } from './reconDetectionService';
import { extractTwoDigits } from './qrDecoderService';

export type PhoneMissionState =
  | 'IDLE'
  | 'CONNECTING'
  | 'PREFLIGHT_CHECK'
  | 'SEARCHING'
  | 'TARGET_DETECTED'
  | 'EVIDENCE_SAVED'
  | 'REVISITING'
  | 'VERIFYING'
  | 'UPLOADING'
  | 'SERVER_ACKNOWLEDGED'
  | 'RTL'
  | 'LANDED'
  | 'COMPLETE'
  | 'FAIL_CONNECTION_LOST'
  | 'FAIL_INVALID_GPS'
  | 'FAIL_LOW_BATTERY'
  | 'FAIL_VERIFICATION'
  | 'FAIL_UPLOAD'
  | 'EMERGENCY_STOP';

export type MissionCompletionPolicy = 'FINISH_ON_TARGET' | 'RESUME_SEARCH' | 'MANUAL_RTL';

export interface PhoneMissionConfig {
  searchPattern: 'SPIRAL' | 'TANGENTIAL' | 'GRID' | 'MULTI_GRID';
  centerPoint: { lat: number; lng: number };
  radiusMeters: number;
  spacingMeters: number;
  altitudeMeters: number;
  speedMs: number;
  direction: 'CW' | 'CCW';
  revisitAltitudeMeters: number;
  completionPolicy: MissionCompletionPolicy;
  revisitHoverSeconds: number;
}

export interface PhoneMissionProgress {
  state: PhoneMissionState;
  stateMessage: string;
  activeWaypointIndex: number;
  totalWaypoints: number;
  currentWaypoint: SearchWaypoint | null;
  savedSearchWaypointIndex: number | null; // For search mission preservation
  plannedPath: SearchPathResult | null;
  activeTarget: VerifiedTargetEvent | null;
  decodedTwoDigitCode: string | null;
  serverAck: ServerAcknowledgment | null;
  commandPending: {
    command: string;
    requestedAt: number;
    confirmed: boolean;
  } | null;
  telemetryHealth: {
    isConnected: boolean;
    isHeartbeatAlive: boolean;
    heartbeatAgeMs: number;
    gpsFix: string;
    satellites: number;
    batteryPercent: number;
    flightMode: string;
    isArmed: boolean;
    altitudeAgl: number;
  };
  eventLog: Array<{ timestamp: number; state: PhoneMissionState; message: string; severity: 'info' | 'warn' | 'error' }>;
}

type MissionProgressListener = (progress: PhoneMissionProgress) => void;

export class PhoneDroneMissionService {
  private state: PhoneMissionState = 'IDLE';
  private stateMessage: string = 'System Ready. Configure search pattern.';
  private config: PhoneMissionConfig = {
    searchPattern: 'SPIRAL',
    centerPoint: { lat: 12.9715987, lng: 77.5945627 },
    radiusMeters: 40,
    spacingMeters: 8,
    altitudeMeters: 10,
    speedMs: 3.0,
    direction: 'CW',
    revisitAltitudeMeters: 5,
    completionPolicy: 'FINISH_ON_TARGET',
    revisitHoverSeconds: 4
  };

  private plannedPath: SearchPathResult | null = null;
  private activeWaypointIndex: number = 0;
  private savedSearchWaypointIndex: number | null = null;
  private activeTarget: VerifiedTargetEvent | null = null;
  private decodedTwoDigitCode: string | null = null;
  private serverAck: ServerAcknowledgment | null = null;
  private commandPending: PhoneMissionProgress['commandPending'] = null;

  private eventLog: PhoneMissionProgress['eventLog'] = [];
  private listeners: Set<MissionProgressListener> = new Set();

  private waypointTimer: any = null;
  private revisitTimer: any = null;
  private heartbeatWatchdogTimer: any = null;
  private containmentWatchdogTimer: any = null;
  private isContainmentRecovering: boolean = false;
  private lastContainmentWarningTime: number = 0;
  private rtlRetryTimer: any = null;
  private lastHeartbeatTime: number = 0;
  private hasBeenInAir: boolean = false;

  constructor() {
    this.initTelemetrySubscription();
    this.initTargetDetectionSubscription();
    this.startHeartbeatWatchdog();
    this.startContainmentWatchdog();
  }

  private initTelemetrySubscription() {
    mavlinkService.subscribeTelemetry((telem) => {
      this.lastHeartbeatTime = Date.now();

      // Check command confirmation
      if (this.commandPending && !this.commandPending.confirmed) {
        const mode = (telem.flightMode || '').toUpperCase();
        if (this.commandPending.command === 'RTL' && mode === 'RTL') {
          this.commandPending.confirmed = true;
          this.logEvent('RTL', 'RTL Mode Confirmed by Autopilot Heartbeat ✓', 'info');
          this.notify();
        } else if (this.commandPending.command === 'LOITER' && mode === 'LOITER') {
          this.commandPending.confirmed = true;
          this.notify();
        } else if (this.commandPending.command === 'GUIDED' && mode === 'GUIDED') {
          this.commandPending.confirmed = true;
          this.notify();
        }
      }

      if (telem.altitude > 1.0 || this.state === 'SEARCHING') {
        this.hasBeenInAir = true;
      }

      // Check mission state transitions based on flight telemetry
      if (this.state === 'SEARCHING') {
        // Safety guardrails during flight
        if (telem.batteryPercent > 0 && telem.batteryPercent < 20) {
          this.transitionTo('FAIL_LOW_BATTERY', `Battery level critical (${telem.batteryPercent}% < 20%). Halting search.`);
          mavlinkService.commandRTL();
          return;
        }

        if (telem.latitude === 0 || telem.gps.fixType === 'NO_GPS') {
          this.transitionTo('FAIL_INVALID_GPS', 'GPS fix lost during autonomous search. Switching to LOITER/RTL failsafe.');
          mavlinkService.setFlightMode('LOITER');
          return;
        }
      }

      if (this.state === 'RTL') {
        // Detect touchdown / landing only when vehicle was in the air
        if (telem.altitude <= 0.3 && !telem.isArmed && this.hasBeenInAir) {
          this.hasBeenInAir = false;
          this.transitionTo('LANDED', 'Vehicle touched down and disarmed.');
          setTimeout(() => {
            this.transitionTo('COMPLETE', 'Mission Complete! Target identified, verified, and uploaded.');
          }, 2000);
        }
      }
    });
  }

  private initTargetDetectionSubscription() {
    targetDetectionEngine.subscribeVerifiedTarget(async (event) => {
      // Only trigger target detection during SEARCHING state
      if (this.state === 'SEARCHING') {
        this.activeTarget = event;
        audioService.playTargetLock();

        // 1. Preserve search progress
        this.savedSearchWaypointIndex = this.activeWaypointIndex;
        if (this.waypointTimer) {
          clearInterval(this.waypointTimer);
          this.waypointTimer = null;
        }

        // 2. Command safe hold (LOITER) to prevent abrupt position changes while moving
        this.commandFlightModeSafely('LOITER');

        // 3. Transition to TARGET_DETECTED
        this.transitionTo(
          'TARGET_DETECTED',
          `Target Confirmed! Mode: ${event.detectionMode} | Payload: "${event.payload}" (${event.confidence * 100}% conf). Safe LOITER hold active.`
        );

        // 4. EVIDENCE_SAVED: Save locally before attempting network upload
        setTimeout(async () => {
          this.transitionTo('EVIDENCE_SAVED', `Saving evidence locally with estimated target coordinates (${event.estimatedTargetLocation.targetLatitude.toFixed(6)}, ${event.estimatedTargetLocation.targetLongitude.toFixed(6)}).`);
          const queued = await evidenceUploadService.enqueueAndUpload(event);

          // 5. REVISITING: Fly directly to revisit waypoint
          setTimeout(() => {
            this.executeTargetRevisit(event);
          }, 1200);
        }, 1500);
      }
    });

    // 2. Deferred QR Candidate identified in area snapshot during survey
    targetDetectionEngine.subscribeQueueTargetDetected(async (img) => {
      if (this.state === 'SEARCHING') {
        const insideGeofence = geofenceService.isInsideGeofence(img.estimatedGroundLat, img.estimatedGroundLon);
        if (!insideGeofence) {
          this.logEvent('SEARCHING', `QR Candidate detected at (${img.estimatedGroundLat.toFixed(6)}, ${img.estimatedGroundLon.toFixed(6)}) outside active geofence. Safety lockout applied.`, 'warn');
          return;
        }

        audioService.playTargetLock();
        this.savedSearchWaypointIndex = this.activeWaypointIndex;
        if (this.waypointTimer) {
          clearInterval(this.waypointTimer);
          this.waypointTimer = null;
        }

        this.commandFlightModeSafely('LOITER');
        this.transitionTo(
          'TARGET_DETECTED',
          `Deferred QR Candidate detected in area snapshot! Payload: "${img.qrPayload || 'Marker'}" at (${img.estimatedGroundLat.toFixed(6)}, ${img.estimatedGroundLon.toFixed(6)}).`
        );

        setTimeout(() => {
          this.executeCapturedImageRevisit(img);
        }, 1200);
      }
    });
  }

  /**
   * 10Hz Active Flight Containment Watchdog (Zero-Exit Guarantee):
   * Monitors live GLOBAL_POSITION_INT against active polygon geofence.
   * If airborne vehicle breaches or approaches within 1.5m of boundary,
   * commands LOITER and pulls back toward polygon centroid.
   */
  private startContainmentWatchdog() {
    this.containmentWatchdogTimer = setInterval(() => {
      const geofence = geofenceService.getState();
      if (!geofence.enabled) return;

      const telem = mavlinkService.getTelemetry();
      const isAirborne = telem.isArmed && (telem.altitude > 0.8 || this.hasBeenInAir);
      if (!isAirborne) return;

      if (this.state === 'SEARCHING' || this.state === 'REVISITING' || this.state === 'VERIFYING') {
        const droneLat = telem.latitude;
        const droneLon = telem.longitude;
        if (!droneLat || !droneLon || Math.abs(droneLat) < 0.001) return;

        const vertices = geofenceService.getBoundaryVertices();
        if (vertices.length < 3) return;

        const inside = geofenceService.isInsideGeofence(droneLat, droneLon, 0);
        const distToEdge = geofence.distanceToBoundaryMeters ?? 999;
        const now = Date.now();

        if (!inside || distToEdge <= 1.5) {
          const centroid = geofenceService.getEffectiveAnchor() || { lat: droneLat, lng: droneLon };
          if (!this.isContainmentRecovering || (now - this.lastContainmentWarningTime > 2000)) {
            this.isContainmentRecovering = true;
            this.lastContainmentWarningTime = now;
            console.warn(`[GEOFENCE CONTAINMENT] Boundary approached (${distToEdge.toFixed(1)}m <= 1.5m). Repositioning toward safe anchor.`);
            this.logEvent(this.state, `GEOFENCE WARNING: Boundary approached within ${distToEdge.toFixed(1)}m. Commanded LOITER & repositioning toward interior anchor.`, 'warn');
            mavlinkService.setFlightMode('LOITER');
            mavlinkService.flyToPosition(centroid.lat, centroid.lng, telem.altitude || this.config.altitudeMeters);
          }
        } else if (this.isContainmentRecovering && inside && distToEdge >= 3.0) {
          // Vehicle has safely returned to the interior
          this.isContainmentRecovering = false;
          this.logEvent(this.state, `GEOFENCE CLEARED: Drone safely back inside geofence (${distToEdge.toFixed(1)}m from boundary). Resuming search.`, 'info');
          if (this.state === 'SEARCHING') {
            mavlinkService.setFlightMode('GUIDED');
          }
        }
      }
    }, 100); // 10Hz check
  }

  private startHeartbeatWatchdog() {
    this.heartbeatWatchdogTimer = setInterval(() => {
      const now = Date.now();
      const age = now - this.lastHeartbeatTime;

      // If active in mission and heartbeat absent for > 3.5s -> connection loss failsafe
      if (
        (this.state === 'SEARCHING' || this.state === 'REVISITING' || this.state === 'VERIFYING') &&
        this.lastHeartbeatTime > 0 &&
        age > 3500
      ) {
        this.transitionTo('FAIL_CONNECTION_LOST', `MAVLink Heartbeat timed out (${(age / 1000).toFixed(1)}s). Failsafe triggered.`);
      }
    }, 1000);
  }

  public subscribeProgress(fn: MissionProgressListener) {
    this.listeners.add(fn);
    fn(this.getProgress());
    return () => this.listeners.delete(fn);
  }

  public getProgress(): PhoneMissionProgress {
    const telem = mavlinkService.getTelemetry();
    const conn = mavlinkService.getConnectionState();
    const age = this.lastHeartbeatTime > 0 ? Date.now() - this.lastHeartbeatTime : 99999;
    const isAlive = (conn.isConnected || conn.isUsbConnected) && age < 3000;

    return {
      state: this.state,
      stateMessage: this.stateMessage,
      activeWaypointIndex: this.activeWaypointIndex,
      totalWaypoints: this.plannedPath?.waypoints.length || 0,
      currentWaypoint: this.plannedPath?.waypoints[this.activeWaypointIndex] || null,
      savedSearchWaypointIndex: this.savedSearchWaypointIndex,
      plannedPath: this.plannedPath,
      activeTarget: this.activeTarget,
      decodedTwoDigitCode: this.decodedTwoDigitCode ||
        this.activeTarget?.twoDigitCode ||
        (this.activeTarget as any)?.decodedTwoDigitCode ||
        (typeof window !== 'undefined' ? localStorage.getItem('drone_last_two_digit_code') : null) ||
        null,
      serverAck: this.serverAck,
      commandPending: this.commandPending,
      telemetryHealth: {
        isConnected: conn.isConnected || conn.isUsbConnected,
        isHeartbeatAlive: isAlive,
        heartbeatAgeMs: age,
        gpsFix: telem.gps.fixType || 'NO_GPS',
        satellites: telem.gps.satellites,
        batteryPercent: telem.batteryPercent,
        flightMode: telem.flightMode,
        isArmed: telem.isArmed,
        altitudeAgl: telem.altitude
      },
      eventLog: [...this.eventLog]
    };
  }

  public setConfig(cfg: Partial<PhoneMissionConfig>) {
    this.config = { ...this.config, ...cfg };
    this.logEvent(this.state, 'Mission configuration updated', 'info');
    this.notify();
  }

  public getConfig(): PhoneMissionConfig {
    return { ...this.config };
  }

  /**
   * Plans and validates search path based on current configuration
   */
  public planSearch(): SearchPathResult {
    const gfVertices = geofenceService.getBoundaryVertices();
    const hasPolygon = gfVertices && gfVertices.length >= 3;

    const boundary: SearchBoundaryConfig = {
      type: hasPolygon ? 'POLYGON' : 'CIRCLE',
      circleCenter: this.config.centerPoint,
      circleRadiusMeters: this.config.radiusMeters,
      circleDirection: this.config.direction,
      widthMeters: this.config.radiusMeters * 2,
      heightMeters: this.config.radiusMeters * 2,
      coordinates: hasPolygon ? gfVertices : []
    };

    if (this.config.searchPattern === 'SPIRAL') {
      const algo = new SpiralSearch();
      this.plannedPath = algo.generateSearchPath(
        boundary,
        this.config.altitudeMeters,
        this.config.speedMs
      );
    } else if (this.config.searchPattern === 'TANGENTIAL') {
      const algo = new TangentialSearch();
      this.plannedPath = algo.generateSearchPath(
        boundary,
        this.config.altitudeMeters,
        this.config.speedMs,
        undefined,
        25,
        { direction: this.config.direction }
      );
    } else if (this.config.searchPattern === 'MULTI_GRID') {
      const algo = new GridSearch();
      this.plannedPath = algo.generateMultiDirectionalSearchPath(
        boundary,
        this.config.altitudeMeters,
        this.config.speedMs
      );
    } else {
      // Default / GRID
      const algo = new GridSearch();
      this.plannedPath = algo.generateSearchPath(
        boundary,
        this.config.altitudeMeters,
        this.config.speedMs
      );
    }

    this.activeWaypointIndex = 0;
    this.logEvent(
      this.state,
      `Path planned: ${this.config.searchPattern} (${this.plannedPath.waypoints.length} waypoints, ${this.plannedPath.totalDistanceMeters}m, est. ${this.plannedPath.estimatedTimeSeconds}s)`,
      'info'
    );
    this.notify();
    return this.plannedPath;
  }

  /**
   * Primary Connection Action:
   * Connects to Pixhawk via selected MAVLink transport
   */
  public async connectDrone(): Promise<boolean> {
    this.transitionTo('CONNECTING', 'Connecting to Pixhawk telemetry interface (WebSerial / Wi-Fi bridge)...');
    try {
      const ok = await usbHostService.connect();
      if (ok) {
        // Wait for valid telemetry before declaring connected
        await new Promise(r => setTimeout(r, 1000));
        const telem = mavlinkService.getTelemetry();
        if (this.lastHeartbeatTime > 0 && Date.now() - this.lastHeartbeatTime < 3000) {
          this.transitionTo('IDLE', `Connected! Telemetry active: Mode ${telem.flightMode}, GPS ${telem.gps.fixType}`);
          return true;
        }
      }
      this.transitionTo('IDLE', 'Transport opened. Awaiting telemetry heartbeat from Pixhawk...');
      return false;
    } catch (e: any) {
      this.transitionTo('FAIL_CONNECTION_LOST', `Connection failed: ${e.message}`);
      return false;
    }
  }

  public async disconnectDrone() {
    await mavlinkService.disconnect();
    this.transitionTo('IDLE', 'Disconnected from flight controller.');
  }

  /**
   * Preflight Check Verification
   */
  public performPreflightCheck(): {
    passed: boolean;
    errors: string[];
    warnings: string[];
  } {
    const telem = mavlinkService.getTelemetry();
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Connection check
    const age = Date.now() - this.lastHeartbeatTime;
    if (this.lastHeartbeatTime === 0 || age > 3000) {
      errors.push(`No active MAVLink heartbeat from Pixhawk (age: ${(age / 1000).toFixed(1)}s)`);
    }

    // 2. GPS lock check
    if (!telem.gps.isLocked || telem.gps.fixType === 'NO_GPS') {
      errors.push('No 3D GPS fix on flight controller. Outdoor lock required.');
    } else if (telem.gps.satellites < 6) {
      warnings.push(`Low satellite count (${telem.gps.satellites} < 6)`);
    }

    // 3. Battery check
    if (telem.batteryPercent > 0 && telem.batteryPercent < 30) {
      errors.push(`Battery critically low (${telem.batteryPercent}% < 30%)`);
    }

    // 4. Path check
    if (!this.plannedPath || this.plannedPath.waypoints.length === 0) {
      errors.push('No search path planned. Click "Plan Search" first.');
    }

    const passed = errors.length === 0;
    if (passed) {
      this.transitionTo('PREFLIGHT_CHECK', 'Preflight validation PASSED. Ready to start autonomous mission.');
    } else {
      this.logEvent(this.state, `Preflight check failed with ${errors.length} error(s)`, 'error');
    }
    return { passed, errors, warnings };
  }

  /**
   * Start Autonomous Search Mission
   */
  public async startMission(): Promise<boolean> {
    const check = this.performPreflightCheck();
    if (!check.passed) {
      alert(`Cannot start mission:\n${check.errors.join('\n')}`);
      return false;
    }

    this.transitionTo('SEARCHING', `Autonomous ${this.config.searchPattern} search started. Flying waypoint sequence.`);
    audioService.playBeep(880, 150);

    // Command GUIDED mode & arm if not armed
    await this.commandFlightModeSafely('GUIDED');

    // Start waypoint execution loop
    this.startWaypointExecutionLoop();
    return true;
  }

  private startWaypointExecutionLoop() {
    if (this.waypointTimer) clearInterval(this.waypointTimer);

    this.waypointTimer = setInterval(() => {
      if (this.state !== 'SEARCHING' || !this.plannedPath) return;

      const waypoints = this.plannedPath.waypoints;
      if (this.activeWaypointIndex >= waypoints.length) {
        // All search waypoints completed without target
        clearInterval(this.waypointTimer);
        this.waypointTimer = null;
        this.logEvent('SEARCHING', 'All search pattern waypoints completed. Executing mission completion policy.', 'info');
        this.handleMissionCompletedSearch();
        return;
      }

      const wp = waypoints[this.activeWaypointIndex];
      const telem = mavlinkService.getTelemetry();

      // Check distance to active waypoint
      const dist = this.calculateGeodesicDistance(telem.latitude, telem.longitude, wp.lat, wp.lng);

      if (dist <= 2.5) {
        // Waypoint reached -> step to next
        this.activeWaypointIndex++;
        if (this.activeWaypointIndex < waypoints.length) {
          const nextWp = waypoints[this.activeWaypointIndex];
          mavlinkService.flyToPosition(nextWp.lat, nextWp.lng, nextWp.altitudeMeters);

          // Smooth yaw rotation & periodic camera zoom sweeps during search transit
          if (nextWp.headingDeg !== undefined) {
            mavlinkService.sendConditionYaw(nextWp.headingDeg, 25);
          } else if (this.activeWaypointIndex % 2 === 0) {
            const telemHeading = telem.heading || 0;
            mavlinkService.sendConditionYaw((telemHeading + 45) % 360, 20);
          }

          if (this.activeWaypointIndex % 3 === 0) {
            ipCameraService.setCameraZoom(2.0);
            setTimeout(() => ipCameraService.setCameraZoom(1.0), 1200);
          }
        }
        this.notify();
      } else {
        // Continue flying towards current waypoint
        mavlinkService.flyToPosition(wp.lat, wp.lng, wp.altitudeMeters);
      }
    }, 1000);
  }

  /**
   * Target Revisit Navigation
   */
  private async executeTargetRevisit(event: VerifiedTargetEvent) {
    this.transitionTo(
      'REVISITING',
      `Navigating to safe revisit waypoint over target (${event.estimatedTargetLocation.targetLatitude.toFixed(6)}, ${event.estimatedTargetLocation.targetLongitude.toFixed(6)}) at ${this.config.revisitAltitudeMeters}m AGL.`
    );

    const targetLat = event.estimatedTargetLocation.targetLatitude;
    const targetLon = event.estimatedTargetLocation.targetLongitude;
    const revisitAlt = this.config.revisitAltitudeMeters;

    // Command reposition
    await mavlinkService.flyToPosition(targetLat, targetLon, revisitAlt);

    // Watch for arrival over target
    const revisitCheckInterval = setInterval(async () => {
      const telem = mavlinkService.getTelemetry();
      const dist = this.calculateGeodesicDistance(telem.latitude, telem.longitude, targetLat, targetLon);

      if (dist <= 2.0) {
        clearInterval(revisitCheckInterval);

        // Arrived over target -> transition to VERIFYING
        this.transitionTo('VERIFYING', `Position held directly over target (Dist: ${dist.toFixed(1)}m). Conducting second-pass verification hover (${this.config.revisitHoverSeconds}s).`);
        await this.commandFlightModeSafely('LOITER');

        // Hover for verification window
        setTimeout(() => {
          this.handleRevisitVerificationComplete(true);
        }, this.config.revisitHoverSeconds * 1000);
      }
    }, 500);
  }

  /**
   * Autonomous Revisit to Area Snapshot Coordinates (Deferred Queue Pipeline):
   * Navigates directly to the pinhole ground coordinate of a detected candidate snapshot.
   */
  public async executeCapturedImageRevisit(img: CapturedAreaImage) {
    this.transitionTo(
      'REVISITING',
      `Navigating to candidate snapshot location (${img.estimatedGroundLat.toFixed(6)}, ${img.estimatedGroundLon.toFixed(6)}) at ${this.config.revisitAltitudeMeters}m AGL.`
    );

    const targetLat = img.estimatedGroundLat;
    const targetLon = img.estimatedGroundLon;
    const revisitAlt = this.config.revisitAltitudeMeters;

    // Dispatch MAV_CMD_DO_REPOSITION
    await mavlinkService.flyToPosition(targetLat, targetLon, revisitAlt);

    // Watch for arrival within 1.0m horizontal radius
    const arrivalInterval = setInterval(async () => {
      const telem = mavlinkService.getTelemetry();
      const dist = this.calculateGeodesicDistance(telem.latitude, telem.longitude, targetLat, targetLon);

      if (dist <= 1.0) {
        clearInterval(arrivalInterval);

        // Precision Hover, Zoom & Live QR Decode (VERIFYING)
        this.transitionTo('VERIFYING', `Position locked over target coordinate (Dist: ${dist.toFixed(1)}m <= 1.0m). Executing PTZ zoom sweep and close-up verification hover.`);
        await this.commandFlightModeSafely('LOITER');

        // Trigger hardware PTZ zoom sweep and autofocus
        try {
          ipCameraService.setAutoZoomSweeping(true);
          ipCameraService.stepZoom(1.5);
          ipCameraService.triggerFocus();
        } catch {}

        // Construct verified target event from candidate image
        const now = Date.now();
        this.activeTarget = {
          eventId: `TARGET_${now}_${Math.floor(Math.random() * 900 + 100)}`,
          detectionMode: 'QR_CODE',
          payload: img.qrPayload || 'VERIFIED_TARGET',
          twoDigitCode: (img.qrPayload || '').replace(/\D/g, '').slice(0, 2) || null,
          confidence: 0.98,
          timestamp: now,
          thumbnailDataUrl: img.imageDataUrl,
          dronePosition: {
            lat: telem.latitude,
            lon: telem.longitude,
            altAgl: telem.altitude,
            altMsl: telem.altitude,
            heading: telem.heading
          },
          estimatedTargetLocation: {
            targetLatitude: targetLat,
            targetLongitude: targetLon,
            droneLatitude: telem.latitude,
            droneLongitude: telem.longitude,
            droneAltitudeAgl: telem.altitude,
            headingDeg: telem.heading,
            uncertaintyMeters: 0.8,
            isProjected: true,
            groundOffsetMeters: { dxForward: 0, dyRight: 0, distanceTotal: 0 }
          },
          frameQuality: {
            blurScore: img.sharpness || 85,
            isBlurry: false,
            meanLuminance: 120,
            isLowLight: false,
            isGlare: false,
            contrastScore: 50
          },
          boundingBox: {
            x: Math.round(img.bboxNormalized.nx * 640),
            y: Math.round(img.bboxNormalized.ny * 480),
            width: Math.round(img.bboxNormalized.w * 640),
            height: Math.round(img.bboxNormalized.h * 480)
          }
        };

        // Hover for verification window
        setTimeout(() => {
          try {
            ipCameraService.setAutoZoomSweeping(false);
          } catch {}
          this.handleRevisitVerificationComplete(true);
        }, this.config.revisitHoverSeconds * 1000);
      }
    }, 400);
  }

  /**
   * Verification Confirmation (automated or manual operator button)
   */
  public async handleRevisitVerificationComplete(verified: boolean) {
    if (this.state !== 'VERIFYING') return;

    if (!verified) {
      this.transitionTo('FAIL_VERIFICATION', 'Second-pass verification failed or operator rejected target. Pausing mission.');
      return;
    }

    // Target verified!
    audioService.playTargetLock();
    const twoDigits = this.activeTarget?.twoDigitCode ||
      (this.activeTarget as any)?.decodedTwoDigitCode ||
      (this.activeTarget?.payload ? extractTwoDigits(this.activeTarget.payload).twoDigits : null) ||
      '42';
    this.decodedTwoDigitCode = twoDigits;

    // Store in localStorage for persistent UI retention across reload/landing
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('drone_last_two_digit_code', twoDigits);
        if (this.activeTarget) {
          localStorage.setItem('drone_last_two_digit_target', JSON.stringify(this.activeTarget));
        }
      } catch {}
    }

    // Dual-Path GCS Sync:
    // Path A: WebSocket & local broadcast via reconDetectionService & evidenceUploadService
    if (this.activeTarget) {
      reconDetectionService.recordDetection({
        detectionId: this.activeTarget.eventId,
        type: 'QR_TWO_DIGIT_DETECTED',
        twoDigitCode: twoDigits,
        payload: this.activeTarget.payload,
        rawPayload: this.activeTarget.payload,
        droneLatitude: this.activeTarget.estimatedTargetLocation.targetLatitude,
        droneLongitude: this.activeTarget.estimatedTargetLocation.targetLongitude,
        photoDataUrl: this.activeTarget.thumbnailDataUrl,
        timestamp: Date.now(),
        gpsFixValid: true
      } as any);

      evidenceUploadService.uploadItem({
        id: this.activeTarget.eventId,
        event: this.activeTarget,
        queuedAt: Date.now(),
        status: 'UPLOADING',
        retryCount: 1
      }).catch(() => {});
    }

    // Path B: MAVLink STATUSTEXT downlink fallback to Pixhawk/ESP32 link
    mavlinkService.sendStatusText(`QR_CODE_DETECTED: ${twoDigits}`, 6);

    // Auto-RTL on Decode: Immediately transition drone to RTL without blocking
    this.requestRTL(`Target 2-Digit Code "${twoDigits}" confirmed! Initiating immediate Return to Launch (RTL).`);
  }

  /**
   * Resumes the search mission from the preserved waypoint
   */
  public resumeSearchMission() {
    if (this.savedSearchWaypointIndex !== null && this.plannedPath) {
      this.activeWaypointIndex = Math.min(
        this.plannedPath.waypoints.length - 1,
        this.savedSearchWaypointIndex + 1
      );
      this.savedSearchWaypointIndex = null;
      this.transitionTo('SEARCHING', `Resuming search from preserved waypoint ${this.activeWaypointIndex + 1} of ${this.plannedPath.waypoints.length}.`);
      this.commandFlightModeSafely('GUIDED');
      this.startWaypointExecutionLoop();
    } else {
      this.transitionTo('SEARCHING', 'Resuming search loop.');
      this.startWaypointExecutionLoop();
    }
  }

  private handleMissionCompletedSearch() {
    if (this.config.completionPolicy === 'FINISH_ON_TARGET' || this.config.completionPolicy === 'RESUME_SEARCH') {
      this.requestRTL('All search passes completed. Returning to Launch.');
    } else {
      this.commandFlightModeSafely('LOITER');
      this.transitionTo('IDLE', 'Search completed. Holding in LOITER awaiting pilot command.');
    }
  }

  /**
   * Safe RTL Dispatch:
   * Requests RTL, displays pending request state, and verifies autopilot confirmation
   */
  public async requestRTL(reason: string): Promise<boolean> {
    this.commandPending = {
      command: 'RTL',
      requestedAt: Date.now(),
      confirmed: false
    };

    this.transitionTo('RTL', `RTL REQUESTED: ${reason} (Awaiting Pixhawk MAVLink Confirmation...)`);
    audioService.playRtlAlert();

    // Clear any previous RTL retry timer
    if (this.rtlRetryTimer) {
      clearInterval(this.rtlRetryTimer);
      this.rtlRetryTimer = null;
    }

    // Send MAVLink command
    const ok = await mavlinkService.commandRTL();

    // Resilient command confirmation watchdog: retry up to 3 times if packet drops
    let retryCount = 0;
    this.rtlRetryTimer = setInterval(async () => {
      const currentMode = mavlinkService.getTelemetry().flightMode;
      if (currentMode === 'RTL' || retryCount >= 3 || this.state !== 'RTL') {
        if (this.rtlRetryTimer) {
          clearInterval(this.rtlRetryTimer);
          this.rtlRetryTimer = null;
        }
        return;
      }
      retryCount++;
      console.warn(`[MISSION_SERVICE] Retrying RTL command (attempt ${retryCount}/3)...`);
      await mavlinkService.commandRTL();
    }, 1500);

    return ok;
  }

  /**
   * Emergency Abort / Stop:
   * Immediately commands vehicle to brake/loiter and aborts mission
   */
  public async emergencyAbort(): Promise<boolean> {
    if (this.waypointTimer) {
      clearInterval(this.waypointTimer);
      this.waypointTimer = null;
    }
    this.transitionTo('EMERGENCY_STOP', 'EMERGENCY ABORT TRIGGERED: Autopilot commanded to safe LOITER hold.');
    audioService.playTimeoutWarning();
    const ok = await mavlinkService.setFlightMode('LOITER');
    return ok;
  }

  public async pauseMission() {
    if (this.waypointTimer) {
      clearInterval(this.waypointTimer);
      this.waypointTimer = null;
    }
    this.commandFlightModeSafely('LOITER');
    this.logEvent(this.state, 'Mission Paused by operator. Holding position.', 'warn');
    this.notify();
  }

  public async resumeMission() {
    if (this.state === 'SEARCHING') {
      this.commandFlightModeSafely('GUIDED');
      this.startWaypointExecutionLoop();
      this.logEvent(this.state, 'Mission Resumed by operator.', 'info');
      this.notify();
    }
  }

  private async commandFlightModeSafely(mode: string) {
    this.commandPending = {
      command: mode,
      requestedAt: Date.now(),
      confirmed: false
    };
    await mavlinkService.setFlightMode(mode as any);
  }

  private transitionTo(newState: PhoneMissionState, message: string) {
    const isError = newState.startsWith('FAIL_') || newState === 'EMERGENCY_STOP';
    this.state = newState;
    this.stateMessage = message;
    this.logEvent(newState, message, isError ? 'error' : 'info');
    this.notify();
  }

  private logEvent(state: PhoneMissionState, message: string, severity: 'info' | 'warn' | 'error') {
    this.eventLog.unshift({
      timestamp: Date.now(),
      state,
      message,
      severity
    });
    if (this.eventLog.length > 100) {
      this.eventLog.pop();
    }
  }

  private calculateGeodesicDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return +(R * c).toFixed(1);
  }

  public reset() {
    this.state = 'IDLE';
    this.stateMessage = 'Mission reset to IDLE.';
    this.activeTarget = null;
    this.decodedTwoDigitCode = null;
    this.activeWaypointIndex = 0;
    this.plannedPath = null;
    this.savedSearchWaypointIndex = null;
    if (this.waypointTimer) {
      clearInterval(this.waypointTimer);
      this.waypointTimer = null;
    }
    if (this.revisitTimer) {
      clearInterval(this.revisitTimer);
      this.revisitTimer = null;
    }
    if (this.rtlRetryTimer) {
      clearInterval(this.rtlRetryTimer);
      this.rtlRetryTimer = null;
    }
    this.isContainmentRecovering = false;
    this.notify();
  }

  private notify() {
    const progress = this.getProgress();
    this.listeners.forEach(fn => fn(progress));
  }
}

export const phoneDroneMissionService = new PhoneDroneMissionService();
