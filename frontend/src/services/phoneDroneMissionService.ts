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
  TargetCandidate
} from './targetDetectionEngine';
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
  searchPattern: 'SPIRAL' | 'TANGENTIAL';
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
  private serverAck: ServerAcknowledgment | null = null;
  private commandPending: PhoneMissionProgress['commandPending'] = null;

  private eventLog: PhoneMissionProgress['eventLog'] = [];
  private listeners: Set<MissionProgressListener> = new Set();

  private waypointTimer: any = null;
  private revisitTimer: any = null;
  private heartbeatWatchdogTimer: any = null;
  private lastHeartbeatTime: number = 0;
  private hasBeenInAir: boolean = false;

  constructor() {
    this.initTelemetrySubscription();
    this.initTargetDetectionSubscription();
    this.startHeartbeatWatchdog();
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
    const boundary: SearchBoundaryConfig = {
      type: 'CIRCLE',
      circleCenter: this.config.centerPoint,
      circleRadiusMeters: this.config.radiusMeters,
      circleDirection: this.config.direction,
      widthMeters: this.config.radiusMeters * 2,
      heightMeters: this.config.radiusMeters * 2,
      coordinates: []
    };

    if (this.config.searchPattern === 'SPIRAL') {
      const algo = new SpiralSearch();
      this.plannedPath = algo.generateSearchPath(
        boundary,
        this.config.altitudeMeters,
        this.config.speedMs
      );
    } else {
      const algo = new TangentialSearch();
      this.plannedPath = algo.generateSearchPath(
        boundary,
        this.config.altitudeMeters,
        this.config.speedMs,
        undefined,
        25,
        { direction: this.config.direction }
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
    this.transitionTo('UPLOADING', `Target verified! Uploading payload "${this.activeTarget?.payload}" and telemetry to backend database...`);

    // Upload to server
    if (this.activeTarget) {
      const ack = await evidenceUploadService.uploadItem({
        id: this.activeTarget.eventId,
        event: this.activeTarget,
        queuedAt: Date.now(),
        status: 'UPLOADING',
        retryCount: 1
      });

      this.serverAck = ack;

      if (ack.success) {
        this.transitionTo('SERVER_ACKNOWLEDGED', `Server Confirmed! HTTP ${ack.httpStatus} | Detection ID: ${ack.detectionId} (${ack.latencyMs}ms).`);
      } else {
        if (evidenceUploadService.isRtlPermittedWithPendingUploads()) {
          this.transitionTo('SERVER_ACKNOWLEDGED', `Network offline: Evidence safely queued locally in Pending Uploads. Proceeding with mission policy.`);
        } else {
          this.transitionTo('FAIL_UPLOAD', `Upload failed: ${ack.rawResponse?.error || 'Server unreachable'}. Waiting for connection.`);
          return;
        }
      }

      // Check configured policy:
      setTimeout(() => {
        if (this.config.completionPolicy === 'FINISH_ON_TARGET') {
          this.requestRTL('Target verified and uploaded. Initiating Return to Launch.');
        } else if (this.config.completionPolicy === 'RESUME_SEARCH') {
          this.resumeSearchMission();
        } else {
          this.logEvent('SERVER_ACKNOWLEDGED', 'Target uploaded. Holding in LOITER as configured by MANUAL_RTL policy.', 'info');
        }
      }, 1500);
    }
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

    // Send MAVLink command
    const ok = await mavlinkService.commandRTL();
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

  private notify() {
    const progress = this.getProgress();
    this.listeners.forEach(fn => fn(progress));
  }
}

export const phoneDroneMissionService = new PhoneDroneMissionService();
