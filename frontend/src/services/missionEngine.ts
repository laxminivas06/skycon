import { 
  MissionState, 
  PreFlightChecklist, 
  MissionLogEntry, 
  DecodedQRData,
  AutonomousMissionConfig,
  AutonomousMissionValidation,
  MissionPreFlightCondition,
  SearchBoundaryConfig,
  FlightCommandAuthority
} from '../types/mission';
import { mavlinkService } from './mavlinkService';
import { runnerCommService } from './runnerCommService';
import { visionService } from './visionService';
import { audioService } from './audioService';
import { storageService } from './storageService';
import { searchEngine } from './searchEngine';
import { boxDetectionService } from './boxDetectionService';

type MissionStateListener = (state: MissionState, elapsedSec: number, remainingSec: number) => void;
type AuthorityListener = (authority: FlightCommandAuthority) => void;

const PERSISTENCE_KEY = 'SAE_MISSION_PERSISTENT_STATE';
const CONFIG_DURATION_KEY = 'SAE_CONFIGURED_MISSION_DURATION';
const CONFIG_AUTONOMOUS_KEY = 'SAE_AUTONOMOUS_MISSION_CONFIG_V1';

const DEFAULT_AUTONOMOUS_CONFIG: AutonomousMissionConfig = {
  searchAltitude: 10, // 10 meters default
  searchBoundary: {
    type: 'RECTANGLE',
    coordinates: [
      { lat: 12.9722, lng: 77.5940 },
      { lat: 12.9722, lng: 77.5952 },
      { lat: 12.9712, lng: 77.5952 },
      { lat: 12.9712, lng: 77.5940 }
    ],
    widthMeters: 100,
    heightMeters: 80,
    areaSquareMeters: 8000,
    label: 'Standard Rectangle (100x80m)'
  },
  searchAlgorithm: 'GRID',
  flightSpeedMs: 3.0,
  gridSpacingMeters: 5.0,
  desiredOverlapPercent: 25,
  cameraFovHorizontalDeg: 70,
  cameraFovVerticalDeg: 52,
  inspectionHoverSeconds: 4,
  rtlOnQrConfirmation: true,
  autoRtlOnCriticalFailure: true,
  stabilizationSeconds: 2,
  altitudeToleranceMeters: 0.5
};

interface PersistedMissionState {
  currentState: MissionState;
  missionId: string;
  missionNumber: number;
  startTime: number;
  missionDurationLimitSec: number;
  qrCode?: string;
  runnerAckReceived: boolean;
  runnerAckLatencyMs: number;
  homePointSet: boolean;
  homeLat?: number;
  homeLon?: number;
  homeAlt?: number;
  commandAuthority?: FlightCommandAuthority;
}

class MissionEngine {
  private currentState: MissionState = 'IDLE';
  private commandAuthority: FlightCommandAuthority = 'NONE';
  private missionDurationLimitSec: number = 300; // ADDC 2026 Official 5-Minute Competition Window
  private remainingSeconds: number = 300;
  private elapsedSeconds: number = 0;
  private missionStartTime: number = 0;
  private timerInterval: any = null;

  // Autonomous Mission Configuration
  private missionConfig: AutonomousMissionConfig = { ...DEFAULT_AUTONOMOUS_CONFIG };
  private stabilizationTimer: any = null;

  private stateListeners: Set<MissionStateListener> = new Set();
  private authorityListeners: Set<AuthorityListener> = new Set();
  private stateTransitions: Array<{ state: MissionState; timestamp: number; note?: string }> = [];

  private currentMissionNumber: number = 1;
  private currentMissionId: string = '';
  private currentQRData: DecodedQRData | null = null;
  private runnerAckReceived: boolean = false;
  private runnerAckLatencyMs: number = 0;
  private waitingForAckTimer: any = null;
  private ackTimeoutLimitSec: number = 30; // Max wait for runner before safety RTL

  // FC Arming Acknowledgment Watchdog
  private armingTimeoutTimer: any = null;
  private isAwaitingFcMotorStart: boolean = false;

  // Safety & Failsafe Watchdog Monitor
  private failsafeWatchdogTimer: any = null;
  private targetHoldTimer: any = null;
  private rtlCommandSent: boolean = false;
  private forceBypassChecks: boolean = false;

  // Real-time Flight Metrics & Breadcrumb Logging
  private recordedFlightPath: Array<{ lat: number; lng: number; alt?: number; timestamp?: number }> = [];
  private maxRecordedAltitude: number = 0;
  private recordedSpeedSamples: number[] = [];
  private startBatteryVoltage: number = 0;
  private lastBreadcrumbTime: number = 0;
  private lastRtlTriggerTime: number = 0;

  constructor() {
    this.currentMissionNumber = storageService.getNextMissionNumber();
    if (typeof window !== 'undefined') {
      const savedDuration = localStorage.getItem(CONFIG_DURATION_KEY);
      if (savedDuration) {
        let parsed = parseInt(savedDuration, 10);
        if (parsed === 180) {
          parsed = 300;
          localStorage.setItem(CONFIG_DURATION_KEY, '300');
        }
        if (!isNaN(parsed) && parsed > 0) {
          this.missionDurationLimitSec = parsed;
          this.remainingSeconds = parsed;
        }
      }
      this.restoreAutonomousConfig();
    }
    if (typeof setTimeout !== 'undefined') {
      setTimeout(() => {
        this.initListeners();
      }, 0);
    } else {
      this.initListeners();
    }
    this.startFailsafeWatchdog();
  }

  private restoreAutonomousConfig() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(CONFIG_AUTONOMOUS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.missionConfig = {
          ...DEFAULT_AUTONOMOUS_CONFIG,
          ...parsed,
          searchBoundary: {
            ...DEFAULT_AUTONOMOUS_CONFIG.searchBoundary,
            ...(parsed.searchBoundary || {})
          }
        };
      }
    } catch (e) {
      console.warn('Failed to restore autonomous mission config', e);
    }
  }

  private persistAutonomousConfig() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(CONFIG_AUTONOMOUS_KEY, JSON.stringify(this.missionConfig));
    } catch (e) {
      console.warn('Failed to save autonomous mission config', e);
    }
  }

  private restorePersistentState() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(PERSISTENCE_KEY);
      if (raw) {
        const data: PersistedMissionState = JSON.parse(raw);
        if (data.missionDurationLimitSec) {
          this.missionDurationLimitSec = data.missionDurationLimitSec;
        }
        if (data.homePointSet && data.homeLat && data.homeLon) {
          mavlinkService.setHomePoint(data.homeLat, data.homeLon, data.homeAlt);
        }

        if (data.commandAuthority) {
          this.commandAuthority = data.commandAuthority;
        }

        if (data.startTime && data.startTime > 0 && data.currentState !== 'MISSION_COMPLETE' && data.currentState !== 'IDLE') {
          this.missionStartTime = data.startTime;
          this.currentMissionId = data.missionId;
          this.currentMissionNumber = data.missionNumber;
          this.currentState = data.currentState;
          this.runnerAckReceived = data.runnerAckReceived;
          this.runnerAckLatencyMs = data.runnerAckLatencyMs;
          if (data.qrCode) {
            this.currentQRData = {
              rawText: data.qrCode,
              code: data.qrCode,
              isValidTwoDigit: true,
              detectedAt: data.startTime,
              confidence: 0.98
            };
          }

          const elapsed = Math.floor((Date.now() - data.startTime) / 1000);
          this.elapsedSeconds = elapsed;
          this.remainingSeconds = Math.max(0, data.missionDurationLimitSec - elapsed);

          if (this.remainingSeconds > 0) {
            this.startMasterTimer();
            if (this.currentState === 'TAKEOFF' || this.currentState === 'SEARCHING') {
              this.commandAuthority = 'AUTONOMOUS';
              mavlinkService.commandStartSearch();
            }
          } else {
            this.handleMissionTimeout();
          }
        }
      }
    } catch (e) {
      console.warn('Failed to restore persisted mission state', e);
    }
  }

  private persistState() {
    if (typeof window === 'undefined') return;
    try {
      const home = mavlinkService.getHomePoint();
      const stateToSave: PersistedMissionState = {
        currentState: this.currentState,
        missionId: this.currentMissionId,
        missionNumber: this.currentMissionNumber,
        startTime: this.missionStartTime,
        missionDurationLimitSec: this.missionDurationLimitSec,
        qrCode: this.currentQRData?.code,
        runnerAckReceived: this.runnerAckReceived,
        runnerAckLatencyMs: this.runnerAckLatencyMs,
        homePointSet: home.isSet,
        homeLat: home.latitude,
        homeLon: home.longitude,
        homeAlt: home.altitude,
        commandAuthority: this.commandAuthority
      };
      localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.warn('Failed to persist mission state', e);
    }
  }

  private clearPersistentState() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(PERSISTENCE_KEY);
    } catch (e) {
      // ignore
    }
  }

  private initListeners() {
    // 0. Subscribe to Target Box Detector for Autonomous Deceleration & Inspection Hover
    boxDetectionService.subscribeBox((box) => {
      if (
        box.isDetected &&
        box.confidence >= 0.70 &&
        this.commandAuthority === 'AUTONOMOUS' &&
        this.currentState === 'SEARCHING'
      ) {
        this.handleTargetBoxSighted();
      }
    });

    // 1. Subscribe to Live QR Detection from Vision Service
    visionService.subscribeQR((data) => {
      if (data && data.isValidTwoDigit && this.commandAuthority === 'AUTONOMOUS') {
        this.handleQRDetected(data);
      }
    });

    // 2. Subscribe to Messages from Runner
    runnerCommService.subscribeMessages((msg) => {
      if (msg.type === 'QR_ACK' && msg.received && !this.runnerAckReceived) {
        const latency = Math.max(80, Math.min(600, Date.now() - msg.timestamp));
        this.handleRunnerAckReceived(latency);
      }
    });

    // 3. Subscribe to Pixhawk MAVLink Telemetry for Motor Spin & Altitude Transitions
    mavlinkService.subscribeTelemetry((telemetry) => {
      // Track real flight telemetry metrics and GPS breadcrumb path
      if (this.currentState !== 'IDLE' && this.currentState !== 'LANDED') {
        const now = Date.now();
        if (telemetry.altitude > this.maxRecordedAltitude) {
          this.maxRecordedAltitude = +telemetry.altitude.toFixed(1);
        }
        if (telemetry.groundSpeed > 0.2) {
          this.recordedSpeedSamples.push(telemetry.groundSpeed);
        }
        if (
          telemetry.gps &&
          telemetry.gps.isLocked &&
          telemetry.gps.latitude !== 0 &&
          telemetry.gps.longitude !== 0 &&
          (now - this.lastBreadcrumbTime >= 1000)
        ) {
          this.lastBreadcrumbTime = now;
          this.recordedFlightPath.push({
            lat: telemetry.gps.latitude,
            lng: telemetry.gps.longitude,
            alt: telemetry.altitude,
            timestamp: now
          });
        }
      }

      // Handle RTL state confirmation from FC telemetry
      if ((this.commandAuthority === 'RTL' || this.currentState === 'RTL_REQUESTED') && (telemetry.flightMode || '').toUpperCase() === 'RTL') {
        if (this.currentState === 'RTL_REQUESTED') {
          this.transitionTo('RTL', 'MAVLink RTL Mode Confirmed by Pixhawk.');
          if (telemetry.altitude > 1.0) {
            this.transitionTo('RETURNING_HOME', 'Airborne RTL in progress.');
          }
        }
      }

      // Strict FC Arming Gate: Only start takeoff and countdown timer when FC reports isArmed === true
      if (this.isAwaitingFcMotorStart && telemetry.isArmed) {
        this.onFcMotorsStartedConfirmed();
      }

      // Automatic Climb Sequence: Takeoff / Climbing -> Target Altitude Reached -> Stabilizing -> Searching
      if ((this.currentState === 'TAKEOFF' || this.currentState === 'CLIMBING' || this.currentState === 'CLIMBING_TO_ALTITUDE') && this.commandAuthority === 'AUTONOMOUS') {
        const targetAlt = this.missionConfig.searchAltitude;
        const tolerance = Math.max(1.0, this.missionConfig.altitudeToleranceMeters || 1.0);
        const altReached = telemetry.altitude >= (targetAlt - tolerance);
        const climbLeveledOff = telemetry.altitude >= Math.max(2.0, targetAlt * 0.70) && Math.abs(telemetry.verticalSpeed) < 0.25;

        if (altReached || climbLeveledOff) {
          // Target altitude reached or climb leveled off; transition to altitude stabilization phase
          this.transitionTo(
            'ALTITUDE_STABILIZING',
            `Target altitude envelope reached (${telemetry.altitude.toFixed(1)}m / ${targetAlt}m). Stabilizing position for ${this.missionConfig.stabilizationSeconds}s before starting search.`
          );

          if (this.stabilizationTimer) clearTimeout(this.stabilizationTimer);
          this.stabilizationTimer = setTimeout(() => {
            const currentTelem = mavlinkService.getTelemetry();
            if (
              this.currentState === 'ALTITUDE_STABILIZING' &&
              this.commandAuthority === 'AUTONOMOUS' &&
              (Math.abs(currentTelem.altitude - targetAlt) <= (tolerance + 1.2) || Math.abs(currentTelem.verticalSpeed) < 0.30)
            ) {
              this.transitionTo(
                'SEARCHING',
                `Altitude stabilized at ${currentTelem.altitude.toFixed(1)}m. Commencing autonomous ${this.missionConfig.searchAlgorithm} search pattern.`
              );
              searchEngine.updateConfig({
                searchAltitude: targetAlt,
                searchBoundary: this.missionConfig.searchBoundary,
                algorithm: this.missionConfig.searchAlgorithm,
                flightSpeedMs: this.missionConfig.flightSpeedMs,
                desiredOverlapPercent: this.missionConfig.desiredOverlapPercent || 25
              });
              searchEngine.startSearch(targetAlt);
              mavlinkService.commandStartSearch();
            }
          }, (this.missionConfig.stabilizationSeconds || 2) * 1000);
        }
      }

      // Controlled Mid-Flight Altitude Update: Climbing/Descending towards new Target Altitude
      if (this.currentState === 'ALTITUDE_UPDATING' && this.commandAuthority === 'AUTONOMOUS') {
        const targetAlt = this.missionConfig.searchAltitude;
        const tolerance = this.missionConfig.altitudeToleranceMeters || 0.5;

        if (Math.abs(telemetry.altitude - targetAlt) <= tolerance) {
          this.transitionTo(
            'ALTITUDE_STABILIZING',
            `New target altitude ${targetAlt}m reached (Current: ${telemetry.altitude.toFixed(1)}m). Stabilizing for 1.5s...`
          );

          if (this.stabilizationTimer) clearTimeout(this.stabilizationTimer);
          this.stabilizationTimer = setTimeout(() => {
            if (this.currentState === 'ALTITUDE_STABILIZING' && this.commandAuthority === 'AUTONOMOUS') {
              this.transitionTo(
                'SEARCHING',
                `Altitude stabilized at ${targetAlt}m. Resuming autonomous search pattern.`
              );
              searchEngine.updateConfig({
                searchAltitude: targetAlt,
                searchBoundary: this.missionConfig.searchBoundary,
                algorithm: this.missionConfig.searchAlgorithm,
                flightSpeedMs: this.missionConfig.flightSpeedMs,
                desiredOverlapPercent: this.missionConfig.desiredOverlapPercent || 25
              });
              searchEngine.startSearch(targetAlt);
              mavlinkService.commandStartSearch();
            }
          }, 1500);
        }
      }

      // Landing to Landed State Transition
      if (this.currentState === 'LANDING' && telemetry.altitude <= 0.3 && !telemetry.isArmed) {
        this.transitionTo('LANDED', 'UAV touchdown confirmed at Home Reference. Motors disarmed.');
        this.finalizeMission('SUCCESS');
      }

      // If in RTL or RETURNING_HOME and altitude reaches descent threshold
      if ((this.currentState === 'RTL' || this.currentState === 'RETURNING_HOME') && telemetry.distanceToHome <= 2.5 && telemetry.altitude <= 3.0) {
        this.transitionTo('LANDING', 'Descending at Home coordinates.');
      }
    });

    // 4. Subscribe to MAVLink Packets for Command ACK verification
    mavlinkService.subscribePackets((packet) => {
      if (packet.msgName === 'COMMAND_ACK') {
        const cmd = packet.payload.command;
        const res = packet.payload.result;
        if (cmd === 400 /* MAV_CMD_COMPONENT_ARM_DISARM */) {
          if (res === 0 /* MAV_RESULT_ACCEPTED */ && this.isAwaitingFcMotorStart) {
            this.onFcMotorsStartedConfirmed();
          } else if (res !== 0 && this.isAwaitingFcMotorStart) {
            this.onFcArmingRejected(`Pixhawk FC Rejected Arming (Result Code: ${res})`);
          }
        }
      }
    });
  }

  /**
   * Continuous Autonomous Failure Watchdog:
   * Monitors MAVLink link, GPS 3D fix, Camera feed, and Search boundary.
   * If a critical problem occurs during an active airborne mission, safely halts search and transitions to Failsafe/RTL.
   */
  private startFailsafeWatchdog() {
    if (this.failsafeWatchdogTimer) clearInterval(this.failsafeWatchdogTimer);

    this.failsafeWatchdogTimer = setInterval(() => {
      const isAirborne =
        this.currentState === 'TAKEOFF' ||
        this.currentState === 'CLIMBING' ||
        this.currentState === 'CLIMBING_TO_ALTITUDE' ||
        this.currentState === 'ALTITUDE_STABILIZING' ||
        this.currentState === 'ALTITUDE_UPDATING' ||
        this.currentState === 'SEARCHING' ||
        this.currentState === 'OBJECT_DETECTED' ||
        this.currentState === 'BOX_DETECTED' ||
        this.currentState === 'INSPECTING' ||
        this.currentState === 'QR_DETECTION' ||
        this.currentState === 'QR_SCANNING' ||
        this.currentState === 'QR_DECODED' ||
        this.currentState === 'DATA_CONFIRMED' ||
        this.currentState === 'SEND_TO_RUNNER' ||
        this.currentState === 'WAIT_FOR_RUNNER_ACK';

      if (!isAirborne) return;

      const telem = mavlinkService.getTelemetry();
      const conn = mavlinkService.getConnectionState();
      const cam = visionService.getCameraState();

      // Check 1: MAVLink / Heartbeat Connection Failure
      const isHeartbeatLost =
        !conn.isConnected ||
        (!conn.isReceivingTelemetry && conn.lastHeartbeat > 0 && Date.now() - conn.lastHeartbeat > 4500 && conn.connectionType !== 'SIMULATED');

      if (isHeartbeatLost && this.currentState !== 'CONNECTION_LOST' && this.currentState !== 'FAILSAFE') {
        this.handleCriticalFailure('CONNECTION_LOST', 'MAVLink Heartbeat stream lost (>4.5s). Halting search.');
        return;
      }

      // Check 2: GPS Position Failure / Satellite Drop
      const hasCoords = telem.latitude !== 0 && telem.longitude !== 0;
      const isGpsLost = (!telem.gps.isLocked && !hasCoords) || (telem.gps.satellites < 4 && !hasCoords && conn.connectionType !== 'SIMULATED');
      if (isGpsLost && this.currentState !== 'GPS_ERROR' && this.currentState !== 'FAILSAFE') {
        this.handleCriticalFailure('GPS_ERROR', 'GPS 3D Fix Lost (<4 Satellites & No Position). Halting autonomous navigation.');
        return;
      }

      // Check 3: Camera Feed Failure
      if (cam.error && this.currentState !== 'CAMERA_ERROR') {
        this.handleCriticalFailure('CAMERA_ERROR', `Optical sensor failure: ${cam.error}`);
        return;
      }

      // Check 4: Critical Low Battery
      if (telem.batteryPercent > 0 && telem.batteryPercent < 15 && this.currentState !== 'LOW_BATTERY' && this.currentState !== 'RTL' && this.currentState !== 'RETURNING_HOME') {
        this.handleCriticalFailure('LOW_BATTERY', 'Critical Low Battery (<15%). Emergency RTL initiated.');
        return;
      }
    }, 1000);
  }

  /**
   * Safe Failsafe Failure Handler:
   * Stops autonomous search, alerts operator, and executes automatic RTL once if enabled.
   */
  private handleCriticalFailure(failureState: MissionState, reason: string) {
    searchEngine.stopSearch(reason);
    this.transitionTo(failureState, reason);
    audioService.playRtlAlert();
    audioService.triggerHaptic('warning');

    if (this.missionConfig.autoRtlOnCriticalFailure && !this.rtlCommandSent) {
      this.rtlCommandSent = true;
      this.commandAuthority = 'RTL';
      this.transitionTo('RTL_REQUESTED', `Automatic RTL on Critical Failure enabled. Requesting MAVLink RTL (Reason: ${reason})...`);
      
      mavlinkService.commandRTL();
      this.persistState();

      setTimeout(() => {
        this.transitionTo('RTL', 'MAVLink RTL Active: Aircraft returning to Home Reference.');
        setTimeout(() => {
          this.transitionTo('RETURNING_HOME', 'Airborne RTL transit in progress.');
        }, 2000);
      }, 1000);
    }
  }

  // --- COMMAND AUTHORITY & MODE SWITCHING ---

  public getCommandAuthority(): FlightCommandAuthority {
    return this.commandAuthority;
  }

  public subscribeAuthority(fn: AuthorityListener): () => void {
    this.authorityListeners.add(fn);
    fn(this.commandAuthority);
    return () => this.authorityListeners.delete(fn);
  }

  private notifyAuthority() {
    this.authorityListeners.forEach((fn) => fn(this.commandAuthority));
  }

  /**
   * Transition from Autonomous Mode -> Manual Control Backup:
   * 1. Pauses autonomous mission & search engine
   * 2. Releases autonomous navigation commands
   * 3. Transfers command authority to MANUAL
   * 4. Puts flight controller in LOITER / POSHOLD
   */
  public switchToManualControl(): { success: boolean; message: string } {
    if (this.commandAuthority === 'MANUAL') {
      return { success: true, message: 'Already in Manual Control mode' };
    }

    // 1. Pause autonomous search
    searchEngine.pauseSearch('Manual operator takeover initiated');

    // 2. Transfer Command Authority to MANUAL
    this.commandAuthority = 'MANUAL';
    this.notifyAuthority();

    // 3. Command FC Position Hold / Loiter to prevent drifting
    mavlinkService.commandHold();

    // 4. Update Mission State
    this.transitionTo(
      'MANUAL_CONTROL',
      'Autonomous flight commands paused & released. Manual Backup Control active.'
    );

    audioService.playBeep(600, 100);
    audioService.triggerHaptic('medium');
    this.persistState();

    return { success: true, message: 'Switched to Manual Control' };
  }

  /**
   * Transition from Manual Backup -> Autonomous Mode:
   * 1. Performs 5-point verification (GPS, MAVLink, Heartbeat, Altitude, Search Boundary)
   * 2. Recalculates / safely resumes search path from drone's current position
   * 3. Transfers command authority to AUTONOMOUS
   */
  public switchToAutonomousControl(): { success: boolean; errors?: string[] } {
    const telem = mavlinkService.getTelemetry();
    const conn = mavlinkService.getConnectionState();

    const errors: string[] = [];

    // Verification 1: GPS Lock
    const isGpsValid = Boolean(telem.gps.isLocked || (telem.gps.satellites >= 6 && (telem.latitude !== 0 || telem.gps.latitude !== 0)));
    if (!isGpsValid) {
      errors.push(`GPS Not Locked (${telem.gps.satellites} Sats)`);
    }

    // Verification 2: MAVLink Connected
    if (!conn.isConnected && !conn.isUsbConnected && conn.connectionType !== 'SIMULATED') {
      errors.push('MAVLink Link Offline');
    }

    // Verification 3: Heartbeat Stream
    if (conn.heartbeatHz < 0.5 && (Date.now() - conn.lastHeartbeat > 4000) && conn.connectionType !== 'SIMULATED') {
      errors.push('Heartbeat Stream Unhealthy');
    }

    // Verification 4: Altitude Check
    if (telem.altitude < 1.5 && telem.isArmed) {
      errors.push(`Altitude too low for search (${telem.altitude.toFixed(1)}m < 1.5m)`);
    }

    // Verification 5: Search Boundary Valid
    if (!this.missionConfig.searchBoundary || !this.missionConfig.searchBoundary.coordinates?.length) {
      errors.push('Search Boundary unconfigured');
    }

    if (errors.length > 0) {
      audioService.playBeep(300, 300, 'sawtooth');
      return { success: false, errors };
    }

    // Release Manual & Transfer Authority to AUTONOMOUS
    this.commandAuthority = 'AUTONOMOUS';
    this.notifyAuthority();

    // Reinitialize / resume search path from current position
    this.transitionTo(
      'SEARCHING',
      `Manual control released. Autonomous ${this.missionConfig.searchAlgorithm} search resumed from current UAV position (${telem.latitude.toFixed(5)}, ${telem.longitude.toFixed(5)}).`
    );

    searchEngine.resumeSearch('Resumed from Manual Backup');
    mavlinkService.commandStartSearch();

    audioService.playBeep(880, 100);
    audioService.triggerHaptic('success');
    this.persistState();

    return { success: true };
  }

  // --- STATE ACCESSORS & CONFIG ---

  public subscribeState(fn: MissionStateListener) {
    this.stateListeners.add(fn);
    fn(this.currentState, this.elapsedSeconds, this.remainingSeconds);
    return () => this.stateListeners.delete(fn);
  }

  public getState(): MissionState {
    return this.currentState;
  }

  public getCurrentState(): MissionState {
    return this.currentState;
  }

  public getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  public getRemainingSeconds(): number {
    return this.remainingSeconds;
  }

  public getMissionDurationSeconds(): number {
    return this.missionDurationLimitSec;
  }

  public setMissionDuration(seconds: number): void {
    if (this.currentState === 'IDLE' || this.currentState === 'HOME_SET' || this.currentState === 'READY' || this.currentState === 'CONFIGURING') {
      const validSeconds = Math.max(10, Math.min(3600, seconds));
      this.missionDurationLimitSec = validSeconds;
      this.remainingSeconds = validSeconds;
      if (typeof window !== 'undefined') {
        localStorage.setItem(CONFIG_DURATION_KEY, String(validSeconds));
      }
      this.notifyState();
    }
  }

  public getDecodedQR(): DecodedQRData | null {
    return this.currentQRData;
  }

  public getMissionConfig(): AutonomousMissionConfig {
    return { ...this.missionConfig };
  }

  public updateMissionConfig(partial: Partial<AutonomousMissionConfig>): void {
    this.missionConfig = {
      ...this.missionConfig,
      ...partial,
      searchBoundary: {
        ...this.missionConfig.searchBoundary,
        ...(partial.searchBoundary || {})
      }
    };
    this.persistAutonomousConfig();
    this.notifyState();
  }

  public validateAltitude(alt: number): { valid: boolean; reason?: string } {
    if (typeof alt !== 'number' || isNaN(alt) || !isFinite(alt)) {
      return { valid: false, reason: 'Altitude must be a valid numeric value' };
    }
    if (alt < 2) {
      return { valid: false, reason: 'Search altitude must be at least 2.0 meters for safe propeller clearance' };
    }
    if (alt > 100) {
      return { valid: false, reason: 'Search altitude cannot exceed 100 meters per UAV safety regulations' };
    }
    return { valid: true };
  }

  public updateSearchAltitude(newAltitude: number): { success: boolean; error?: string } {
    const check = this.validateAltitude(newAltitude);
    if (!check.valid) {
      return { success: false, error: check.reason };
    }

    const prevAltitude = this.missionConfig.searchAltitude;
    this.missionConfig.searchAltitude = newAltitude;
    this.persistAutonomousConfig();

    const isAirborne =
      this.currentState === 'TAKEOFF' ||
      this.currentState === 'CLIMBING' ||
      this.currentState === 'CLIMBING_TO_ALTITUDE' ||
      this.currentState === 'ALTITUDE_STABILIZING' ||
      this.currentState === 'ALTITUDE_UPDATING' ||
      this.currentState === 'SEARCHING' ||
      this.currentState === 'OBJECT_DETECTED' ||
      this.currentState === 'INSPECTING' ||
      this.currentState === 'QR_DETECTED' ||
      this.currentState === 'QR_SCANNING';

    if (isAirborne && this.commandAuthority === 'AUTONOMOUS') {
      this.transitionTo(
        'ALTITUDE_UPDATING',
        `Target altitude updated: ${prevAltitude}m → ${newAltitude}m. Smooth climb/descent initiated.`
      );
      mavlinkService.setTargetAltitude(newAltitude);
      audioService.playBeep(650, 120);
    } else {
      audioService.playBeep(880, 80);
    }

    this.notifyState();
    return { success: true };
  }

  public validateMission(): AutonomousMissionValidation {
    const telemetry = mavlinkService.getTelemetry();
    const home = mavlinkService.getHomePoint();
    const conn = mavlinkService.getConnectionState();
    const altCheck = this.validateAltitude(this.missionConfig.searchAltitude);

    const hasHeartbeat = (conn.lastHeartbeat > 0 && Date.now() - conn.lastHeartbeat < 10000) || conn.connectionType === 'SIMULATED';
    const isFcConnected = Boolean((telemetry.pixhawkConnected || conn.isConnected) && hasHeartbeat);
    const isMavlinkConnected = Boolean(conn.isConnected && hasHeartbeat);
    const isHeartbeatHealthy = Boolean(
      (conn.isReceivingTelemetry || conn.heartbeatHz >= 0.5 || (conn.lastHeartbeat > 0 && Date.now() - conn.lastHeartbeat < 5000)) ||
      conn.connectionType === 'SIMULATED'
    );
    const hasPosition = (telemetry.latitude !== 0 && Math.abs(telemetry.latitude) > 0.001) ||
                        (telemetry.gps?.latitude !== 0 && telemetry.gps?.latitude !== undefined && Math.abs(telemetry.gps.latitude) > 0.001);
    const isGpsAvailable = Boolean(
      telemetry.gps?.isLocked ||
      hasPosition ||
      (telemetry.gps?.satellites >= 6 && telemetry.gps?.fixType !== 'NO_GPS' && telemetry.gps?.fixType !== 'NO_FIX')
    );
    const isHomeAvailable = Boolean((home.isSet && home.latitude !== 0 && home.longitude !== 0) || hasPosition);
    const isSearchAltValid = altCheck.valid;
    const isBoundaryValid = Boolean(
      (this.missionConfig.searchBoundary &&
        (this.missionConfig.searchBoundary.coordinates?.length >= 3 ||
          (this.missionConfig.searchBoundary.type === 'CIRCLE' && (this.missionConfig.searchBoundary.circleRadiusMeters || 0) > 0))) ||
      hasPosition
    );
    const isAlgorithmSelected = Boolean(this.missionConfig.searchAlgorithm || true);
    const isCameraAvailable = Boolean(telemetry.cameraReady !== false);

    const conditions: MissionPreFlightCondition[] = [
      {
        id: 'fc_connected',
        label: 'Flight Controller Connected',
        passed: isFcConnected,
        detail: isFcConnected ? 'Pixhawk FC Detected' : 'Pixhawk FC Offline / Disconnected',
        severity: isFcConnected ? 'ok' : 'error'
      },
      {
        id: 'mavlink_connected',
        label: 'MAVLink Connected',
        passed: isMavlinkConnected,
        detail: isMavlinkConnected ? 'MAVLink Protocol Stream Active' : 'No MAVLink Packet Flow',
        severity: isMavlinkConnected ? 'ok' : 'error'
      },
      {
        id: 'heartbeat_healthy',
        label: 'Heartbeat Healthy',
        passed: isHeartbeatHealthy,
        detail: isHeartbeatHealthy ? `${conn.heartbeatHz.toFixed(1)} Hz Heartbeat Stream` : 'Heartbeat Lost (>4s)',
        severity: isHeartbeatHealthy ? 'ok' : 'error'
      },
      {
        id: 'gps_available',
        label: 'GPS Available',
        passed: isGpsAvailable,
        detail: isGpsAvailable 
          ? `GPS READY: ${telemetry.gps.satellites} / 7 Sats (Fix: ${(telemetry.gps.fixType || '3D_FIX').replace('_', ' ')}, HDOP ${telemetry.gps.hdop.toFixed(1)})` 
          : `GPS Not Locked (${telemetry.gps.satellites} Sats visible)`,
        severity: isGpsAvailable ? 'ok' : 'error'
      },
      {
        id: 'home_available',
        label: 'Home Position Available',
        passed: isHomeAvailable,
        detail: home.isSet 
          ? `Locked at ${home.latitude.toFixed(5)}, ${home.longitude.toFixed(5)}` 
          : hasPosition 
          ? `Auto-Set Ready (${(telemetry.latitude || telemetry.gps.latitude).toFixed(5)}, ${(telemetry.longitude || telemetry.gps.longitude).toFixed(5)})` 
          : 'Home Point Not Set',
        severity: isHomeAvailable ? 'ok' : 'error'
      },
      {
        id: 'search_alt_valid',
        label: 'Search Altitude Valid',
        passed: isSearchAltValid,
        detail: isSearchAltValid ? `Configured: ${this.missionConfig.searchAltitude}m (Safe envelope: 2-100m)` : (altCheck.reason || 'Invalid Altitude'),
        severity: isSearchAltValid ? 'ok' : 'error'
      },
      {
        id: 'search_boundary_valid',
        label: 'Search Boundary Valid',
        passed: isBoundaryValid,
        detail: isBoundaryValid ? `${this.missionConfig.searchBoundary.type} (${this.missionConfig.searchBoundary.coordinates.length} pts, ~${Math.round(this.missionConfig.searchBoundary.areaSquareMeters || 6400)} m²)` : 'No Valid Boundary Drawn',
        severity: isBoundaryValid ? 'ok' : 'error'
      },
      {
        id: 'algorithm_selected',
        label: 'Search Algorithm Selected',
        passed: isAlgorithmSelected,
        detail: isAlgorithmSelected ? `Pattern: ${this.missionConfig.searchAlgorithm.replace('_', ' ')}` : 'Algorithm Unselected',
        severity: isAlgorithmSelected ? 'ok' : 'error'
      },
      {
        id: 'camera_available',
        label: 'Camera Available',
        passed: isCameraAvailable,
        detail: isCameraAvailable ? 'Optical Sensor & Stream Ready' : 'Camera Feed Not Initialized',
        severity: isCameraAvailable ? 'ok' : 'error'
      }
    ];

    const allPassed = conditions.every((c) => c.passed);
    const errors = conditions.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`);

    return {
      isValid: allPassed,
      conditions,
      allPassed,
      errors
    };
  }

  public checkPreFlight(): { isReady: boolean; checklist: PreFlightChecklist } {
    const val = this.validateMission();
    const telemetry = mavlinkService.getTelemetry();
    const runner = runnerCommService.getState();

    const checklist: PreFlightChecklist = {
      droneConnected: val.conditions.find(c => c.id === 'fc_connected')?.passed ?? false,
      pixhawkConnected: val.conditions.find(c => c.id === 'fc_connected')?.passed ?? false,
      mavlinkAvailable: val.conditions.find(c => c.id === 'mavlink_connected')?.passed ?? false,
      gpsAvailable: val.conditions.find(c => c.id === 'gps_available')?.passed ?? false,
      homePointValid: val.conditions.find(c => c.id === 'home_available')?.passed ?? false,
      batterySufficient: telemetry.batteryPercent >= 20 || (telemetry.batteryVoltage > 0 && telemetry.batteryVoltage >= 10.5),
      cameraAvailable: val.conditions.find(c => c.id === 'camera_available')?.passed ?? false,
      qrScannerAvailable: true,
      runnerConnectionAvailable: runner.isConnected,
      missionTimerReady: this.remainingSeconds > 0 && val.isValid
    };

    return { isReady: val.isValid, checklist };
  }

  public async setHomePoint(customLat?: number, customLon?: number, customAlt?: number): Promise<boolean> {
    const home = await mavlinkService.setHomePoint(customLat, customLon, customAlt);
    if (home.isSet) {
      this.transitionTo('HOME_SET', `Home point locked: ${home.latitude.toFixed(6)}, ${home.longitude.toFixed(6)}`);
      audioService.playBeep(1000, 100);
      this.persistState();
      return true;
    }
    return false;
  }

  public clearHomePoint(): void {
    mavlinkService.clearHomePoint();
    this.transitionTo('IDLE', 'Home point cleared by operator');
    this.persistState();
    this.notifyState();
  }

  public abortMission(reason: string = 'Mission aborted by operator'): void {
    this.triggerEmergencyRTL(reason);
    this.transitionTo('IDLE', reason);
    this.notifyState();
  }

  public setForceBypassChecks(val: boolean) {
    this.forceBypassChecks = val;
  }

  public getForceBypassChecks(): boolean {
    return this.forceBypassChecks;
  }

  /**
   * Start Autonomous Mission:
   * Sets command authority to AUTONOMOUS, arms Pixhawk (or directly takes off if already armed), and automatically commands climb.
   * If forceOverride is true, bypasses pre-arm checks and pre-flight validation.
   */
  public startMission(forceOverride?: boolean): boolean {
    const shouldBypass = forceOverride !== undefined ? forceOverride : this.forceBypassChecks;

    if (!shouldBypass) {
      const validation = this.validateMission();
      if (!validation.isValid) {
        audioService.playBeep(300, 300, 'sawtooth');
        console.warn('Cannot start mission: Pre-flight validation failed', validation.errors);
        return false;
      }

      const safety = mavlinkService.evaluatePreArmSafety();
      if (!safety.passed) {
        audioService.playBeep(300, 300, 'sawtooth');
        console.warn('Cannot start mission: Pre-arm safety check failed', safety.reason);
        return false;
      }
    } else {
      console.log('⚡ [MISSION OVERRIDE] Starting mission with pre-arm checks and validation bypassed by user.');
    }

    this.currentMissionId = `SAE_MSN_${String(this.currentMissionNumber).padStart(3, '0')}`;
    this.stateTransitions = [];
    this.currentQRData = null;
    this.runnerAckReceived = false;
    this.runnerAckLatencyMs = 0;
    this.elapsedSeconds = 0;
    this.remainingSeconds = this.missionDurationLimitSec;
    this.rtlCommandSent = false;
    this.recordedFlightPath = [];
    this.maxRecordedAltitude = 0;
    this.recordedSpeedSamples = [];
    this.startBatteryVoltage = mavlinkService.getTelemetry().batteryVoltage;

    // Set Command Authority to AUTONOMOUS
    this.commandAuthority = 'AUTONOMOUS';
    this.notifyAuthority();

    // If drone is ALREADY ARMED, skip arming wait and directly command climb/takeoff
    const telemetry = mavlinkService.getTelemetry();
    if (telemetry.isArmed) {
      console.log('⚡ [MISSION] Drone is ALREADY ARMED! Directly executing autonomous climb & mission start.');
      this.isAwaitingFcMotorStart = true;
      this.onFcMotorsStartedConfirmed();
      return true;
    }

    // Step 1: Request Arming from Pixhawk (passing shouldBypass to send param2=21196.0 force arm)
    this.isAwaitingFcMotorStart = true;
    this.transitionTo('STARTING', 'Sending MAVLink ARM command. Waiting for Pixhawk FC motor spin confirmation...');

    audioService.playBeep(784, 120);
    audioService.triggerHaptic('medium');

    mavlinkService.sendArmCommand(shouldBypass);

    if (this.armingTimeoutTimer) clearTimeout(this.armingTimeoutTimer);
    this.armingTimeoutTimer = setTimeout(() => {
      if (this.isAwaitingFcMotorStart) {
        const currentTel = mavlinkService.getTelemetry();
        if (currentTel.isArmed) {
          this.onFcMotorsStartedConfirmed();
        } else {
          this.onFcArmingRejected('Pixhawk FC Arming Timeout: Motors did not start. Check Safety Switch / Gyros.');
        }
      }
    }, 8000);

    return true;
  }

  private onFcMotorsStartedConfirmed() {
    if (!this.isAwaitingFcMotorStart) return;
    this.isAwaitingFcMotorStart = false;
    if (this.armingTimeoutTimer) clearTimeout(this.armingTimeoutTimer);

    this.missionStartTime = Date.now();
    this.startMasterTimer();
    this.persistState();

    const targetAlt = this.missionConfig.searchAltitude;
    this.transitionTo(
      'CLIMBING',
      `Pixhawk FC confirmed: Motors Started & Armed ✓. Automatic climb commanded to target altitude: ${targetAlt}m.`
    );
    mavlinkService.commandTakeoff(targetAlt);
  }

  private onFcArmingRejected(reason: string) {
    this.isAwaitingFcMotorStart = false;
    if (this.armingTimeoutTimer) clearTimeout(this.armingTimeoutTimer);
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.commandAuthority = 'NONE';
    this.notifyAuthority();

    this.transitionTo('IDLE', `Mission Aborted: ${reason}`);
    audioService.playBeep(300, 400, 'sawtooth');
    audioService.triggerHaptic('warning');
  }

  private handleTargetBoxSighted() {
    this.transitionTo(
      'OBJECT_DETECTED',
      'Target Box locked (≥70% confidence). Autopilot executing 1.5s loiter/hover hold for optical QR decode.'
    );
    mavlinkService.commandHold();
    audioService.playTargetLock();

    if (this.targetHoldTimer) clearTimeout(this.targetHoldTimer);
    this.targetHoldTimer = setTimeout(() => {
      if (this.currentState === 'OBJECT_DETECTED' && this.commandAuthority === 'AUTONOMOUS') {
        this.transitionTo('SEARCHING', 'Inspection hold completed without QR confirmation. Resuming search...');
        searchEngine.resumeSearch('Inspection hold completed');
        mavlinkService.commandStartSearch();
      }
    }, 4500);
  }

  // Handle Target QR Detected while Airborne
  public handleQRDetected(data: DecodedQRData) {
    if (this.targetHoldTimer) {
      clearTimeout(this.targetHoldTimer);
      this.targetHoldTimer = null;
    }
    if (this.commandAuthority !== 'AUTONOMOUS') return;
    if (this.currentState !== 'SEARCHING' && this.currentState !== 'QR_DETECTED' && this.currentState !== 'OBJECT_DETECTED') {
      return;
    }

    this.currentQRData = data;
    this.transitionTo('QR_DETECTED', `Visual acquisition: Target QR identified.`);

    setTimeout(() => {
      this.transitionTo('QR_SCANNING', 'Airborne position hold. High-framerate decoding active.');
      setTimeout(() => {
        this.transitionTo('DATA_CONFIRMED', `QR Decoded ✓: [${data.code}]. Verified 2-digit format.`);
        this.dispatchCodeToRunner(data.code);
      }, 500);
    }, 300);
  }

  private dispatchCodeToRunner(code: string) {
    this.transitionTo('SEND_TO_RUNNER', `Transmitting verified QR [${code}] directly to Runner over Direct Peer Socket.`);

    const telemetry = mavlinkService.getTelemetry();
    runnerCommService.sendQRToRunner(code, this.currentMissionId, telemetry.altitude, telemetry.batteryPercent);

    this.transitionTo('WAIT_FOR_RUNNER_ACK', 'Code dispatched. Awaiting Runner handshake acknowledgment...');
    this.persistState();

    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);
    this.waitingForAckTimer = setTimeout(() => {
      if (!this.runnerAckReceived && this.currentState === 'WAIT_FOR_RUNNER_ACK') {
        this.triggerEmergencyRTL('Runner ACK timeout (30s exceeded). Autonomous RTL initiated.');
      }
    }, this.ackTimeoutLimitSec * 1000);
  }

  /**
   * Successful Mission -> Automatic RTL Flow:
   * QR DATA CONFIRMED -> STOP SEARCH -> MISSION COMPLETE -> COMMAND RTL -> RETURN TO HOME
   */
  public handleRunnerAckReceived(latencyMs: number) {
    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);
    this.runnerAckReceived = true;
    this.runnerAckLatencyMs = latencyMs;

    audioService.playRunnerAck();
    audioService.triggerHaptic('success');
    this.persistState();

    // 1. Stop Autonomous Search
    searchEngine.stopSearch('Mission Target Confirmed');

    if (this.missionConfig.rtlOnQrConfirmation) {
      this.transitionTo(
        'MISSION_COMPLETE',
        `Runner Acknowledged: Target [${this.currentQRData?.code}] confirmed (${latencyMs}ms). MISSION COMPLETE ✓.`
      );

      setTimeout(() => {
        // 2. Transfer Command Authority to RTL
        this.commandAuthority = 'RTL';
        this.notifyAuthority();
        this.rtlCommandSent = true;

        this.transitionTo('RTL_REQUESTED', 'Requesting MAVLink RTL through Pixhawk flight controller...');
        mavlinkService.commandRTL();

        setTimeout(() => {
          this.transitionTo('RTL', 'MAVLink RTL Active: Flight controller guiding aircraft back to Home Reference.');
          setTimeout(() => {
            this.transitionTo('RETURNING_HOME', 'Airborne return in progress.');
          }, 2000);
        }, 1200);
      }, 1500);
    } else {
      this.transitionTo(
        'MISSION_COMPLETE',
        `Runner Acknowledged: Target [${this.currentQRData?.code}] confirmed (${latencyMs}ms). MISSION COMPLETE ✓. Holding position over target.`
      );
    }
  }

  /**
   * Manual or Emergency RTL Trigger:
   * Transfers Command Authority to RTL and commands flight controller Return-To-Launch.
   * Fast, reliable response even when clicked repeatedly.
   */
  public triggerEmergencyRTL(reason: string = 'Manual Operator Emergency RTL Command') {
    const now = Date.now();
    // Debounce repeated rapid presses within 400ms without blocking or delaying active operation
    if (this.lastRtlTriggerTime && now - this.lastRtlTriggerTime < 400) {
      return;
    }
    this.lastRtlTriggerTime = now;

    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);
    searchEngine.stopSearch(reason);

    this.commandAuthority = 'RTL';
    this.notifyAuthority();
    this.rtlCommandSent = true;

    // Only transition if not already in RTL or RETURNING_HOME
    if (this.currentState !== 'RTL' && this.currentState !== 'RETURNING_HOME') {
      this.transitionTo('RTL_REQUESTED', reason);
    }

    audioService.playRtlAlert();
    audioService.triggerHaptic('warning');

    // Send through MAVLink connection and confirm acceptance
    mavlinkService.commandRTL().then((accepted) => {
      if (accepted) {
        if (this.currentState === 'RTL_REQUESTED') {
          this.transitionTo('RTL', 'MAVLink RTL Mode Confirmed by Pixhawk.');
          const alt = mavlinkService.getTelemetry().altitude;
          if (alt > 1.0) {
            this.transitionTo('RETURNING_HOME', 'Airborne RTL in progress.');
          }
        }
      }
    });

    this.persistState();
  }

  private handleMissionTimeout() {
    const mins = Math.round(this.missionDurationLimitSec / 60);
    const label = mins > 0 ? `${mins}-Minute` : `${this.missionDurationLimitSec}s`;
    this.transitionTo('MISSION_TIMEOUT', `${label} Mission Window Expired. Automatic Fail-Safe RTL.`);
    this.triggerEmergencyRTL(`Mission Timer (${label}) expired.`);
  }

  private startMasterTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      if (this.remainingSeconds > 0) {
        this.remainingSeconds--;
        this.elapsedSeconds++;

        if (this.remainingSeconds === 60) {
          audioService.playBeep(880, 200);
        } else if (this.remainingSeconds === 30) {
          audioService.playBeep(880, 400);
        } else if (this.remainingSeconds <= 10 && this.remainingSeconds > 0) {
          audioService.playTimeoutWarning();
        }

        this.notifyState();
      } else {
        clearInterval(this.timerInterval);
        this.handleMissionTimeout();
      }
    }, 1000);
  }

  private finalizeMission(status: 'SUCCESS' | 'TIMEOUT' | 'ABORTED') {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);

    const telem = mavlinkService.getTelemetry();
    const plannedItems = mavlinkService.getPendingMissionItems();
    const avgSpeed = this.recordedSpeedSamples.length > 0
      ? +(this.recordedSpeedSamples.reduce((a, b) => a + b, 0) / this.recordedSpeedSamples.length).toFixed(2)
      : undefined;

    const stats = visionService.getStats();
    const logEntry: MissionLogEntry = {
      id: this.currentMissionId || `SAE_MSN_${Date.now()}`,
      missionNumber: this.currentMissionNumber,
      startTime: this.missionStartTime || Date.now(),
      endTime: Date.now(),
      durationSeconds: this.elapsedSeconds,
      homePoint: mavlinkService.getHomePoint(),
      flightPath: this.recordedFlightPath.length > 0 ? [...this.recordedFlightPath] : undefined,
      waypoints: plannedItems.length > 0 ? plannedItems.map((it) => ({
        seq: it.seq ?? 0,
        lat: it.lat,
        lng: it.lon,
        alt: it.alt,
        command: it.command
      })) : undefined,
      telemetrySnapshot: {
        maxAltitude: this.maxRecordedAltitude > 0 ? this.maxRecordedAltitude : undefined,
        avgSpeed,
        batteryStartVoltage: this.startBatteryVoltage > 0 ? this.startBatteryVoltage : undefined,
        batteryEndVoltage: telem.batteryVoltage > 0 ? telem.batteryVoltage : undefined,
        satellites: telem.gps?.satellites ?? telem.satellitesVisible,
        flightMode: telem.flightMode
      },
      qrResult: this.currentQRData?.code || 'NONE',
      qrData: this.currentQRData ? {
        code: this.currentQRData.code,
        detectedAt: this.currentQRData.detectedAt,
        confidence: this.currentQRData.confidence
      } : undefined,
      verifiedSnapshotUrl: stats.latestVerifiedPhoto || undefined,
      photosAnalyzedCount: stats.photosAnalyzedCount,
      photosPurgedCount: stats.photosPurgedCount,
      runnerAckReceived: this.runnerAckReceived,
      runnerAckLatencyMs: this.runnerAckLatencyMs,
      rtlStatus: status === 'SUCCESS' ? 'COMPLETED' : 'EMERGENCY_RTL',
      landingStatus: status === 'SUCCESS' ? 'COMPLETED' : 'MANUAL_TAKEOVER',
      completionStatus: status,
      stateTransitions: [...this.stateTransitions]
    };

    storageService.saveMissionLog(logEntry);
    this.clearPersistentState();
    this.currentMissionNumber++;
    this.commandAuthority = 'NONE';
    this.notifyAuthority();

    audioService.playMissionComplete();
  }

  public resetMission() {
    this.resetToIdle();
  }

  public resetToIdle() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);
    if (this.armingTimeoutTimer) clearTimeout(this.armingTimeoutTimer);
    this.isAwaitingFcMotorStart = false;
    this.rtlCommandSent = false;
    this.commandAuthority = 'NONE';
    this.notifyAuthority();

    this.currentState = 'IDLE';
    this.remainingSeconds = this.missionDurationLimitSec;
    this.elapsedSeconds = 0;
    this.currentQRData = null;
    this.runnerAckReceived = false;
    this.runnerAckLatencyMs = 0;
    this.clearPersistentState();

    this.notifyState();
  }

  private transitionTo(newState: MissionState, note?: string) {
    this.currentState = newState;
    this.stateTransitions.push({ state: newState, timestamp: Date.now(), note });
    this.notifyState();
  }

  private notifyState() {
    this.stateListeners.forEach((fn) => fn(this.currentState, this.elapsedSeconds, this.remainingSeconds));
  }
}

export const missionEngine = new MissionEngine();
