import { mavlinkService } from './mavlinkService';
import { missionEngine } from './missionEngine';
import { visionService } from './visionService';
import { boxDetectionService } from './boxDetectionService';
import { MissionState, DroneTelemetry } from '../types/mission';

export interface GroundStationLogEvent {
  id: string;
  timeStr: string;
  timestamp: number;
  message: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

type LogEventListener = (events: GroundStationLogEvent[]) => void;

class EventLogService {
  private events: GroundStationLogEvent[] = [];
  private listeners: Set<LogEventListener> = new Set();
  private maxLogs: number = 200;

  // Track state transitions to avoid spam
  private lastArmed: boolean = false;
  private lastGpsFix: boolean = false;
  private lastHomeSet: boolean = false;
  private lastMissionState: MissionState = 'IDLE';
  private lastBoxDetected: boolean = false;
  private lastQrDecoded: string = '';

  constructor() {
    this.initDefaultLogs();
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.setupListeners();
      }, 0);
    } else {
      this.setupListeners();
    }
  }

  private formatTime(ts: number = Date.now()): string {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  public addEvent(message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
    const timeStr = this.formatTime();
    const event: GroundStationLogEvent = {
      id: `EVT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      timeStr,
      timestamp: Date.now(),
      message,
      type
    };
    this.events.unshift(event);
    if (this.events.length > this.maxLogs) {
      this.events = this.events.slice(0, this.maxLogs);
    }
    this.notify();
  }

  public getEvents(): GroundStationLogEvent[] {
    return [...this.events];
  }

  public subscribeEvents(fn: LogEventListener): () => void {
    this.listeners.add(fn);
    fn(this.getEvents());
    return () => this.listeners.delete(fn);
  }

  public clearEvents(): void {
    this.events = [];
    this.notify();
  }

  private notify(): void {
    const current = this.getEvents();
    this.listeners.forEach((fn) => fn(current));
  }

  private initDefaultLogs(): void {
    const now = Date.now();
    this.events = [
      {
        id: 'INIT_1',
        timeStr: this.formatTime(now - 12000),
        timestamp: now - 12000,
        message: 'Ground Station interface initialized',
        type: 'info'
      },
      {
        id: 'INIT_2',
        timeStr: this.formatTime(now - 8000),
        timestamp: now - 8000,
        message: 'Telemetry subsystem online',
        type: 'info'
      }
    ];
  }

  private setupListeners(): void {
    // 1. Telemetry changes
    mavlinkService.subscribeTelemetry((telem: DroneTelemetry) => {
      // GPS Fix
      const hasFix = (telem.gps?.satellites ?? 0) >= 6 && telem.gps?.fixType !== 'NO_FIX';
      if (hasFix && !this.lastGpsFix) {
        this.addEvent(`GPS FIX acquired (${telem.gps.satellites} satellites, ${telem.gps.fixType || '3D'})`, 'success');
        this.lastGpsFix = true;
      } else if (!hasFix && this.lastGpsFix) {
        this.addEvent('GPS lock degraded or lost', 'warn');
        this.lastGpsFix = false;
      }

      // Home position
      const home = mavlinkService.getHomePoint();
      if (home.isSet && !this.lastHomeSet) {
        this.addEvent(`Home position set (${home.latitude.toFixed(6)}, ${home.longitude.toFixed(6)})`, 'success');
        this.lastHomeSet = true;
      } else if (!home.isSet && this.lastHomeSet) {
        this.addEvent('Home position cleared', 'info');
        this.lastHomeSet = false;
      }

      // Armed / Disarmed
      if (telem.isArmed && !this.lastArmed) {
        this.addEvent('Vehicle Armed (Motors active)', 'warn');
        this.lastArmed = true;
      } else if (!telem.isArmed && this.lastArmed) {
        this.addEvent('Vehicle Disarmed', 'info');
        this.lastArmed = false;
      }
    });

    // 2. Pixhawk connection state
    mavlinkService.subscribeConnection((conn) => {
      if (conn.isUsbConnected && !conn.isConnected) {
        this.addEvent('Pixhawk serial link opened — waiting for heartbeat', 'info');
      }
      if (conn.isConnected && (conn.heartbeatHz || 0) > 0) {
        // Heartbeat active
      }
      if (conn.latestStatusMessage) {
        const text = conn.latestStatusMessage.text;
        // Don't duplicate if same as last text
        if (text && !this.events.some(e => e.message === text && (Date.now() - e.timestamp) < 3000)) {
          const isErr = conn.latestStatusMessage.severity === 'ERROR' || conn.latestStatusMessage.severity === 'CRITICAL';
          const isWarn = conn.latestStatusMessage.severity === 'WARNING';
          this.addEvent(text, isErr ? 'error' : isWarn ? 'warn' : 'info');
        }
      }
    });

    // 3. Mission Engine state machine transitions
    if (missionEngine?.subscribeState) {
      missionEngine.subscribeState((state: MissionState) => {
        if (state !== this.lastMissionState) {
          this.lastMissionState = state;
          switch (state) {
            case 'READY':
              this.addEvent('Pre-arm checks passed — READY for mission', 'success');
              break;
            case 'STARTING':
              this.addEvent('Mission starting: Requesting arming from flight controller', 'info');
              break;
            case 'TAKEOFF':
            case 'CLIMBING':
            case 'CLIMBING_TO_ALTITUDE':
              this.addEvent('Takeoff started — climbing to mission altitude', 'info');
              break;
            case 'SEARCHING':
              this.addEvent('Search started — autonomous search pattern active', 'info');
              break;
            case 'BOX_DETECTED':
            case 'OBJECT_DETECTED':
              this.addEvent('Box detected — initiating target visual tracking', 'warn');
              break;
            case 'QR_DETECTED':
              this.addEvent('QR detected in camera field-of-view', 'warn');
              break;
            case 'DATA_CONFIRMED':
              this.addEvent('QR decoded and verified', 'success');
              break;
            case 'SEND_TO_RUNNER':
              this.addEvent('QR result dispatched to ground runner', 'info');
              break;
            case 'RUNNER_CONFIRMED':
              this.addEvent('QR result received & acknowledged by runner', 'success');
              break;
            case 'RTL_REQUESTED':
            case 'RTL':
            case 'RETURNING_HOME':
              this.addEvent('RTL initiated — returning to home reference', 'warn');
              break;
            case 'LANDING':
              this.addEvent('Landing sequence initiated', 'info');
              break;
            case 'MISSION_COMPLETE':
              this.addEvent('Mission successfully completed', 'success');
              break;
            case 'ABORTED':
              this.addEvent('Mission ABORTED by operator — safe hold initiated', 'error');
              break;
            case 'EMERGENCY_RTL':
              this.addEvent('EMERGENCY RTL triggered by operator', 'error');
              break;
          }
        }
      });
    }

    // 4. Box detection
    if (boxDetectionService?.subscribeBox) {
      boxDetectionService.subscribeBox((box) => {
        if (box.isDetected && !this.lastBoxDetected) {
          this.lastBoxDetected = true;
          this.addEvent(`Box detected at ${box.confidence ? Math.round(box.confidence * 100) : 95}% confidence`, 'warn');
        } else if (!box.isDetected) {
          this.lastBoxDetected = false;
        }
      });
    }

    // 5. QR detection
    if (visionService?.subscribeQR) {
      visionService.subscribeQR((qr) => {
        if (qr && qr.code && qr.code !== this.lastQrDecoded) {
          this.lastQrDecoded = qr.code;
          this.addEvent(`QR detected: [${qr.code}]`, 'success');
        }
      });
    }
  }
}

export const eventLogService = new EventLogService();
