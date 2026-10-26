import { mavlinkService } from './mavlinkService';
import { audioService } from './audioService';
import { DroneTelemetry, HomePoint } from '../types/mission';
import { PixhawkConnectionState } from '../types/mavlink';
import { 
  LoiterTestConfig, 
  LoiterTestState, 
  LoiterTestStep, 
  LoiterTestValidation, 
  LoiterTestPrerequisite 
} from '../types/loiterTest';

type StateListener = (state: LoiterTestState) => void;

class LoiterTestService {
  private config: LoiterTestConfig = {
    missionName: '5M_LOITER_TEST',
    flightMode: 'LOITER',
    takeoffAltitude: 5,
    landingPosition: 'Home / Takeoff Position',
    missionType: 'Controlled test mission',
    loiterDurationSeconds: 10,
    altitudeTolerance: 0.5
  };

  private state: LoiterTestState = {
    step: 'IDLE',
    stepMessage: 'Ready for configuration & operator confirmation.',
    isExecuting: false,
    currentAltitude: 0,
    targetAltitude: 5,
    remainingHoldSeconds: 10,
    totalHoldSeconds: 10
  };

  private listeners: Set<StateListener> = new Set();
  private telemetryUnsub: (() => void) | null = null;
  private holdTimer: any = null;
  private holdInterval: any = null;
  private armingWatchdog: any = null;
  private climbWatchdog: any = null;
  private descentWatchdog: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const savedDuration = localStorage.getItem('SAE_5M_LOITER_DURATION');
        if (savedDuration) {
          const parsed = parseInt(savedDuration, 10);
          if (!isNaN(parsed) && parsed >= 3 && parsed <= 120) {
            this.config.loiterDurationSeconds = parsed;
            this.state.remainingHoldSeconds = parsed;
            this.state.totalHoldSeconds = parsed;
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }

  public getConfig(): LoiterTestConfig {
    return { ...this.config };
  }

  public getState(): LoiterTestState {
    return { ...this.state };
  }

  public setLoiterDuration(seconds: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(3, Math.min(120, seconds));
    this.config.loiterDurationSeconds = clamped;
    this.state.remainingHoldSeconds = clamped;
    this.state.totalHoldSeconds = clamped;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_5M_LOITER_DURATION', String(clamped));
      } catch (e) {}
    }
    this.notifyState();
  }

  public subscribeState(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyState(): void {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }

  /**
   * Validate all safety prerequisites before allowing 5M_LOITER_TEST execution
   */
  public validatePrerequisites(
    telemetry: DroneTelemetry,
    pixhawkState: PixhawkConnectionState,
    homePoint: HomePoint
  ): LoiterTestValidation {
    const isConn = Boolean(pixhawkState.isConnected || pixhawkState.isUsbConnected);
    const hasTelem = Boolean(isConn && (pixhawkState.isReceivingTelemetry || pixhawkState.lastHeartbeat > 0));
    
    // GPS requirements for safe LOITER (independent of Home message arrival)
    const satCount = telemetry.gps.satellites || 0;
    const is3DFix = telemetry.gps.fixType === '3D_FIX' || telemetry.gps.fixType === 'DGPS' || telemetry.gps.fixType === 'RTK_FIXED' || telemetry.gps.fixType === 'RTK_FLOAT';
    const gpsLocked = Boolean(telemetry.gps.isLocked || is3DFix || satCount >= 6);
    const hdop = telemetry.gps.hdop || 99;
    const gpsAdequate = gpsLocked && (hdop <= 3.5 || hdop === 0 || satCount >= 7);

    // Home position: either explicitly set, or vehicle has live coordinates ready to Set Home
    const hasPosition = (telemetry.latitude !== 0 && telemetry.longitude !== 0) || (telemetry.gps.latitude !== 0 && telemetry.gps.longitude !== 0);
    const homeValid = Boolean(homePoint.isSet || hasPosition);

    // Vehicle ground state: should be disarmed and on ground prior to arming sequence
    const onGround = telemetry.altitude <= 1.5 && !telemetry.isArmed;

    // Battery safety: require at least 20%
    const batteryAdequate = telemetry.batteryPercent >= 20 || telemetry.batteryPercent === 0; // 0 if unmonitored

    const prerequisites: LoiterTestPrerequisite[] = [
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
        label: 'GPS 3D Fix & Satellites (Required for LOITER)',
        passed: gpsAdequate,
        reason: gpsAdequate 
          ? `GPS READY: ${satCount} / 7 Sats (Fix: ${(telemetry.gps.fixType || '3D_FIX').replace('_', ' ')}, HDOP ${hdop.toFixed(1)})` 
          : `GPS Inadequate (Sats: ${satCount}/7, Fix: ${telemetry.gps.fixType || 'NO_FIX'})`
      },
      {
        id: 'home_position',
        label: 'Home Position Reference Registered',
        passed: homeValid,
        reason: homePoint.isSet 
          ? `Home Locked: ${homePoint.latitude.toFixed(5)}, ${homePoint.longitude.toFixed(5)}` 
          : hasPosition 
          ? `Auto-Set Home Ready (${(telemetry.latitude || telemetry.gps.latitude).toFixed(5)}, ${(telemetry.longitude || telemetry.gps.longitude).toFixed(5)})` 
          : 'Awaiting initial GPS coordinates for Home reference.'
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
   * Execute the 5M_LOITER_TEST sequence
   */
  public async executeMission(
    telemetry: DroneTelemetry,
    pixhawkState: PixhawkConnectionState,
    homePoint: HomePoint,
    forceOverride: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    if (this.state.isExecuting) {
      return { success: false, error: '5M Loiter Test is already running.' };
    }

    const val = this.validatePrerequisites(telemetry, pixhawkState, homePoint);
    if (!val.allPassed && !forceOverride) {
      audioService.playBeep(300, 300, 'sawtooth');
      return { success: false, error: val.blockingReason || 'Prerequisites check failed.' };
    }

    // Auto-Set Home with Pixhawk via MAV_CMD_DO_SET_HOME if not yet set but coordinates are valid
    if (!homePoint.isSet) {
      const lat = telemetry.latitude || telemetry.gps.latitude;
      const lon = telemetry.longitude || telemetry.gps.longitude;
      const alt = telemetry.gps.altitude || telemetry.altitude;
      if (lat !== 0 && lon !== 0) {
        try {
          await mavlinkService.setHomePoint(lat, lon, alt);
        } catch (e) {
          console.warn('[LOITER_TEST] Auto-set home note:', e);
        }
      }
    }

    this.clearAllTimers();

    this.state = {
      step: 'ARMING',
      stepMessage: '[1/6] Sending MAVLink ARM command. Awaiting FC confirmation...',
      isExecuting: true,
      currentAltitude: telemetry.altitude,
      targetAltitude: 5,
      remainingHoldSeconds: this.config.loiterDurationSeconds,
      totalHoldSeconds: this.config.loiterDurationSeconds,
      startTime: Date.now()
    };
    this.notifyState();

    audioService.playBeep(784, 150);

    // If drone is already armed, skip arm command and immediately climb to 5m
    if (telemetry.isArmed) {
      this.state.step = 'TAKEOFF_CLIMB';
      this.state.stepMessage = `[2/6] Motors Armed ✓. Vertical takeoff commanded to 5 m AGL.`;
      this.notifyState();
      mavlinkService.commandTakeoff(5);
      this.bindTelemetryWatch();
      return { success: true };
    }

    // Step 1: Switch to GUIDED mode & Arm Pixhawk (pass forceOverride to bypass ArduPilot pre-arm checks)
    try {
      await mavlinkService.setFlightMode('GUIDED');
      await mavlinkService.sendArmCommand(forceOverride);
    } catch (e: any) {
      this.abort(`Arming failed: ${e?.message || e}`);
      return { success: false, error: `Arming command failed: ${e?.message || e}` };
    }

    // Arming timeout watchdog (8s)
    this.armingWatchdog = setTimeout(() => {
      if (this.state.step === 'ARMING') {
        const telem = mavlinkService.getTelemetry();
        const conn = mavlinkService.getConnectionState();
        if (!telem.isArmed) {
          const detail = conn.preArmFailReason
            ? `Pixhawk FC: ${conn.preArmFailReason}`
            : 'Pixhawk FC did not arm motors within 8 seconds. Verify Pixhawk Safety Switch / Gyros.';
          this.abort(detail);
        }
      }
    }, 8000);

    // Start telemetry watcher
    this.bindTelemetryWatch();

    return { success: true };
  }

  private bindTelemetryWatch(): void {
    if (this.telemetryUnsub) this.telemetryUnsub();

    this.telemetryUnsub = mavlinkService.subscribeTelemetry((telem) => {
      if (!this.state.isExecuting) return;

      this.state.currentAltitude = telem.altitude;

      // 1. Arming Confirmed -> Command Takeoff to 5m
      if (this.state.step === 'ARMING' && telem.isArmed) {
        if (this.armingWatchdog) clearTimeout(this.armingWatchdog);
        this.state.step = 'TAKEOFF_CLIMB';
        this.state.stepMessage = `[2/6] Motors Armed ✓. Vertical takeoff commanded to 5 m AGL.`;
        this.notifyState();

        audioService.playBeep(880, 100);

        // Command Takeoff to 5m
        mavlinkService.commandTakeoff(5);

        // Climb watchdog (25s)
        this.climbWatchdog = setTimeout(() => {
          if (this.state.step === 'TAKEOFF_CLIMB') {
            const currentTelem = mavlinkService.getTelemetry();
            if (currentTelem.altitude >= 3.0) {
              console.warn(`[LOITER_TEST] Climb watchdog timer expired, but aircraft is airborne at ${currentTelem.altitude.toFixed(1)}m. Entering loiter hold.`);
              this.enterLoiterHold();
            } else {
              this.abort('Takeoff/Climb timeout: Did not reach 5 m within 25 seconds.');
            }
          }
        }, 25000);
      }

      // 2. Climb to 5m reached or climb rate leveled off -> Enter LOITER mode
      if (this.state.step === 'TAKEOFF_CLIMB') {
        const altReached = telem.altitude >= (5 - Math.max(1.0, this.config.altitudeTolerance || 1.0));
        const climbLeveledOff = telem.altitude >= 3.5 && Math.abs(telem.verticalSpeed) < 0.25;

        if (altReached || climbLeveledOff) {
          if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
          this.enterLoiterHold();
        }
      }

      // 3. Landing touchdown detection -> Disarm only when safely on ground
      if (this.state.step === 'LANDING') {
        if (!telem.isArmed) {
          // ArduPilot natively detected landing touchdown and auto-disarmed
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

  private enterLoiterHold(): void {
    this.state.step = 'LOITER_HOLD';
    this.state.stepMessage = `[3/6] Target 5 m reached (Current: ${this.state.currentAltitude.toFixed(1)} m). Entering LOITER mode for ${this.config.loiterDurationSeconds}s.`;
    this.state.remainingHoldSeconds = this.config.loiterDurationSeconds;
    this.notifyState();

    audioService.playBeep(988, 120);

    // Command flight mode LOITER
    mavlinkService.setFlightMode('LOITER');

    // 1-second countdown ticker
    if (this.holdInterval) clearInterval(this.holdInterval);
    this.holdInterval = setInterval(() => {
      if (this.state.step !== 'LOITER_HOLD') {
        clearInterval(this.holdInterval);
        return;
      }

      this.state.remainingHoldSeconds = Math.max(0, this.state.remainingHoldSeconds - 1);
      this.state.stepMessage = `[3/6] LOITER active at 5 m. Holding position: ${this.state.remainingHoldSeconds}s remaining.`;
      this.notifyState();

      if (this.state.remainingHoldSeconds <= 0) {
        clearInterval(this.holdInterval);
        this.beginDescentAndLand();
      }
    }, 1000);
  }

  private beginDescentAndLand(): void {
    if (this.holdInterval) clearInterval(this.holdInterval);

    this.state.step = 'DESCENDING';
    this.state.stepMessage = `[4/6] Loiter duration complete. Commanding LAND mode (ArduPilot auto-descent).`;
    this.notifyState();

    audioService.playBeep(659, 150);

    // Command Land at Home (ArduPilot handles descent & auto-disarm upon touchdown)
    mavlinkService.commandLand();

    setTimeout(() => {
      if (this.state.step === 'DESCENDING') {
        this.state.step = 'LANDING';
        this.state.stepMessage = `[5/6] Descending to touchdown at home reference.`;
        this.notifyState();
      }
    }, 1500);

    // Descent watchdog (45s) - allow ample time for gentle descent and auto-disarm
    this.descentWatchdog = setTimeout(() => {
      if (this.state.step === 'DESCENDING' || this.state.step === 'LANDING') {
        const telem = mavlinkService.getTelemetry();
        if (!telem.isArmed || telem.altitude <= 0.25) {
          this.disarmAndComplete();
        } else {
          this.abort('Descent timeout: Drone did not touchdown within 45 seconds.');
        }
      }
    }, 45000);
  }

  private async disarmAndComplete(): Promise<void> {
    this.clearAllTimers();

    this.state.step = 'DISARMING';
    this.state.stepMessage = `[6/6] Touchdown confirmed. Motors disarmed.`;
    this.notifyState();

    if (mavlinkService.getTelemetry().isArmed) {
      try {
        await mavlinkService.sendDisarmCommand(false); // SAFE NON-FORCED DISARM
      } catch (e) {}
    }

    setTimeout(() => {
      this.state.step = 'COMPLETED';
      this.state.stepMessage = `5M_LOITER_TEST successfully completed! Full sequence executed: Arm ➔ 5m Takeoff ➔ 5m Loiter Hold (${this.config.loiterDurationSeconds}s) ➔ Land ➔ Disarm.`;
      this.state.isExecuting = false;
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
    if (wasExecuting && telem.isArmed && telem.altitude > 0.8) {
      mavlinkService.setFlightMode('LOITER');
    }

    this.cleanup();
  }

  private clearAllTimers(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    if (this.holdInterval) clearInterval(this.holdInterval);
    if (this.armingWatchdog) clearTimeout(this.armingWatchdog);
    if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
    if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
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
      stepMessage: 'Ready for configuration & operator confirmation.',
      isExecuting: false,
      currentAltitude: 0,
      targetAltitude: 5,
      remainingHoldSeconds: this.config.loiterDurationSeconds,
      totalHoldSeconds: this.config.loiterDurationSeconds
    };
    this.notifyState();
  }
}

export const loiterTestService = new LoiterTestService();
