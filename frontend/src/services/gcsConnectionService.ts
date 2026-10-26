/**
 * AERORECON — GCS Live Connection & Initialization Service
 * 
 * Manages the Ground Control Station START workflow:
 * 1. Initial State: Wi-Fi, MAVLink, and Pixhawk GPS indicators are pending/inactive.
 * 2. Start Action: Verifies Wi-Fi/network connectivity, initializes MAVLink link, and monitors Pixhawk GPS telemetry.
 * 3. Automatic Updates: Indicators update automatically based on actual verified states.
 * 4. Safety Guarantee: Start initiates verification only; does NOT arm or launch the drone.
 */

import { mavlinkService } from './mavlinkService';
import { usbHostService } from './usbHostService';
import { DroneTelemetry } from '../types/mission';
import { PixhawkConnectionState } from '../types/mavlink';

export type WifiConnectionStatus = 'PENDING' | 'CONNECTING' | 'VERIFIED' | 'FAILED';
export type MavlinkConnectionStatus = 'PENDING' | 'CONNECTING' | 'ACTIVE' | 'DISCONNECTED';
export type GpsConnectionStatus = 'PENDING' | 'ACQUIRING' | 'LOCKED' | 'NO_FIX';

export interface GCSConnectionState {
  isStarted: boolean;
  isInitializing: boolean;
  wifiStatus: WifiConnectionStatus;
  mavlinkStatus: MavlinkConnectionStatus;
  gpsStatus: GpsConnectionStatus;
  satellites: number;
  hdop: number;
  gpsFixType: string;
  lastChecked: number;
  errorMessage: string | null;
}

type ConnectionStateListener = (state: GCSConnectionState) => void;

class GCSConnectionService {
  private state: GCSConnectionState = {
    isStarted: false,
    isInitializing: false,
    wifiStatus: 'PENDING',
    mavlinkStatus: 'PENDING',
    gpsStatus: 'PENDING',
    satellites: 0,
    hdop: 99,
    gpsFixType: 'NO_GPS',
    lastChecked: 0,
    errorMessage: null
  };

  private listeners: Set<ConnectionStateListener> = new Set();
  private telemetryUnsubscribe: (() => void) | null = null;
  private connectionUnsubscribe: (() => void) | null = null;
  private networkWatchdog: any = null;
  private isCheckingNetwork: boolean = false;

  constructor() {
    this.initListeners();
  }

  private initListeners() {
    // Listen to MAVLink telemetry updates to dynamically update MAVLink & GPS status
    this.telemetryUnsubscribe = mavlinkService.subscribeTelemetry((telem: DroneTelemetry) => {
      if (!this.state.isStarted && mavlinkService.getConnectionState().connectionType !== 'SIMULATED') return;
      this.evaluateTelemetry(telem);
    });

    // Listen to MAVLink connection state changes
    this.connectionUnsubscribe = mavlinkService.subscribeConnection((conn: PixhawkConnectionState) => {
      if (!this.state.isStarted && conn.connectionType !== 'SIMULATED') return;
      this.evaluateConnection(conn);
    });

    // Listen to browser online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this.state.isStarted) this.verifyNetwork();
      });
      window.addEventListener('offline', () => {
        if (this.state.isStarted) {
          this.state.wifiStatus = 'FAILED';
          this.notify();
        }
      });
    }
  }

  public getState(): GCSConnectionState {
    return { ...this.state };
  }

  public subscribe(fn: ConnectionStateListener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  /**
   * Evaluates Pixhawk GPS status originating directly from the flight controller
   */
  private evaluateTelemetry(telem: DroneTelemetry) {
    const hasCoords = Boolean(
      (telem.latitude !== 0 && Math.abs(telem.latitude) > 0.001) ||
      (telem.gps?.latitude !== 0 && telem.gps?.latitude !== undefined && Math.abs(telem.gps.latitude) > 0.001)
    );

    const isLocked = Boolean(
      telem.gps?.isLocked ||
      telem.gps?.fixType === '3D_FIX' ||
      telem.gps?.fixType === '3D_DGPS' ||
      telem.gps?.fixType === 'RTK_FLOAT' ||
      telem.gps?.fixType === 'RTK_FIXED' ||
      hasCoords
    );

    const sats = telem.gps?.satellites || telem.satellitesVisible || 0;
    const hdop = telem.gps?.hdop || 99;
    const fixType = telem.gps?.fixType || (isLocked ? '3D_FIX' : 'NO_GPS');

    let gpsStatus: GpsConnectionStatus = 'NO_FIX';
    if (isLocked && (sats >= 6 || (sats >= 4 && hasCoords) || hasCoords || telem.gps?.isLocked)) {
      gpsStatus = 'LOCKED';
    } else if (sats > 0) {
      gpsStatus = 'ACQUIRING';
    } else {
      gpsStatus = 'NO_FIX';
    }

    this.state.gpsStatus = gpsStatus;
    this.state.satellites = sats;
    this.state.hdop = hdop;
    this.state.gpsFixType = fixType;

    // Only update MAVLink status to ACTIVE if Pixhawk heartbeat is verified live
    const conn = mavlinkService.getConnectionState();
    if (conn.connectionType === 'SIMULATED') {
      this.state.isStarted = true;
      this.state.wifiStatus = 'VERIFIED';
      this.state.mavlinkStatus = 'ACTIVE';
      this.state.gpsStatus = 'LOCKED';
      this.state.satellites = sats || 14;
      this.state.hdop = hdop < 90 ? hdop : 0.8;
      this.state.gpsFixType = fixType || '3D_FIX';
      this.notify();
      return;
    }

    const hasHeartbeat = conn.lastHeartbeat > 0 && (Date.now() - conn.lastHeartbeat < 10000);
    if (hasHeartbeat && telem.pixhawkConnected) {
      this.state.mavlinkStatus = 'ACTIVE';
    } else if (conn.isConnected || conn.isUsbConnected || this.state.isStarted) {
      this.state.mavlinkStatus = 'CONNECTING';
    } else {
      this.state.mavlinkStatus = 'DISCONNECTED';
    }

    this.notify();
  }

  /**
   * Evaluates MAVLink communication layer status
   */
  private evaluateConnection(conn: PixhawkConnectionState) {
    if (conn.connectionType === 'SIMULATED') {
      this.state.isStarted = true;
      this.state.wifiStatus = 'VERIFIED';
      this.state.mavlinkStatus = 'ACTIVE';
      this.notify();
      return;
    }

    const now = Date.now();
    const hasHeartbeat = conn.lastHeartbeat > 0 && (now - conn.lastHeartbeat < 10000);
    const isTransportOpen = Boolean(conn.isConnected || conn.isUsbConnected);

    if (hasHeartbeat && conn.isConnected && conn.isReceivingTelemetry) {
      this.state.mavlinkStatus = 'ACTIVE';
    } else if (isTransportOpen || conn.phase === 'WAITING_FOR_HEARTBEAT' || conn.phase === 'SERIAL_OPENING' || conn.phase === 'WAITING_FOR_MAVLINK' || conn.phase === 'SERIAL_OPEN') {
      // Transport (WS/USB) is open, but awaiting Pixhawk heartbeat
      this.state.mavlinkStatus = 'CONNECTING';
    } else {
      this.state.mavlinkStatus = 'DISCONNECTED';
    }
    this.notify();
  }

  /**
   * Verifies Wi-Fi / Network connectivity against backend API
   */
  public async verifyNetwork(): Promise<boolean> {
    if (this.isCheckingNetwork) return this.state.wifiStatus === 'VERIFIED';
    this.isCheckingNetwork = true;
    this.state.wifiStatus = 'CONNECTING';
    this.notify();

    try {
      if (typeof window !== 'undefined' && !navigator.onLine) {
        this.state.wifiStatus = 'FAILED';
        this.isCheckingNetwork = false;
        this.notify();
        return false;
      }

      // Ping existing backend health or detection endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const res = await fetch('/api/recon/detections/latest', {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' }
      }).catch(() => null);

      clearTimeout(timeout);

      // Even if endpoint returns 404/200, HTTP response proves network path to backend is verified
      const isOnline = Boolean(res && (res.ok || res.status < 500));
      this.state.wifiStatus = isOnline ? 'VERIFIED' : 'FAILED';
      this.notify();
      this.isCheckingNetwork = false;
      return isOnline;
    } catch {
      this.state.wifiStatus = 'FAILED';
      this.isCheckingNetwork = false;
      this.notify();
      return false;
    }
  }

  /**
   * Operator presses START on GCS:
   * Initializes connections, checks Wi-Fi, initiates MAVLink bridge, and begins checking GPS.
   */
  public async start(): Promise<GCSConnectionState> {
    // Avoid creating duplicate connections if already initializing
    if (this.state.isInitializing) {
      return this.getState();
    }

    this.state.isStarted = true;
    this.state.isInitializing = true;
    this.state.errorMessage = null;
    this.state.lastChecked = Date.now();
    this.notify();

    try {
      // 1. Check Network Connectivity
      await this.verifyNetwork();

      // 2. Initialize MAVLink Connection Layer
      this.state.mavlinkStatus = 'CONNECTING';
      this.notify();

      try {
        await usbHostService.autoConnect();
      } catch (err: any) {
        console.warn('[GCS START] Transport auto-connect notice:', err);
      }

      // Read current state from MAVLink service
      const conn = mavlinkService.getConnectionState();
      this.evaluateConnection(conn);

      // 3. Begin Checking Pixhawk GPS Telemetry
      const telem = mavlinkService.getTelemetry();
      this.evaluateTelemetry(telem);

      // Start periodic background network watchdog (every 6s)
      if (!this.networkWatchdog) {
        this.networkWatchdog = setInterval(() => {
          if (this.state.isStarted) {
            this.verifyNetwork();
          }
        }, 6000);
      }
    } catch (err: any) {
      this.state.errorMessage = err?.message || 'Connection initialization failed';
    } finally {
      this.state.isInitializing = false;
      this.notify();
    }

    return this.getState();
  }

  public reset() {
    if (this.networkWatchdog) {
      clearInterval(this.networkWatchdog);
      this.networkWatchdog = null;
    }
    this.state = {
      isStarted: false,
      isInitializing: false,
      wifiStatus: 'PENDING',
      mavlinkStatus: 'PENDING',
      gpsStatus: 'PENDING',
      satellites: 0,
      hdop: 99,
      gpsFixType: 'NO_GPS',
      lastChecked: 0,
      errorMessage: null
    };
    this.notify();
  }

  private notify() {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }
}

export const gcsConnectionService = new GCSConnectionService();
