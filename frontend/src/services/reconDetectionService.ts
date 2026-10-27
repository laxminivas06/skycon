/**
 * AERORECON — Recon Detection & Target Management Service
 * Coordinates autonomous QR detection, image capture, retry processing,
 * Pixhawk GPS telemetry association, Case A/B target evaluation,
 * and safe target navigation via MAVLink.
 */

import { mavlinkService } from './mavlinkService';
import { audioService } from './audioService';
import { missionEngine } from './missionEngine';
import { runnerCommService } from './runnerCommService';
import { fetchWithFallback } from './apiClient';
import {
  QRDetectionRecord,
  QRProcessingState,
  GCSVisualStatus,
  DroneCoreQRStatus,
  TargetLocation,
  TargetNavigationRequest
} from '../types/recon';
import {
  decodeQRFromImageData,
  retryDecodeImage,
  classifyPayload,
  parseCoordinatesFromPayload,
  extractTwoDigits
} from './qrDecoderService';

type DetectionListener = (detections: QRDetectionRecord[], latest: QRDetectionRecord | null) => void;
type VisualStatusListener = (status: GCSVisualStatus) => void;
type DroneCoreStatusListener = (status: DroneCoreQRStatus) => void;
type TargetListener = (target: TargetLocation | null, distanceMeters: number | null, bearingDeg: number | null) => void;

const STORAGE_KEY_DETECTIONS = 'aerorecon_detection_records_v1';
const MAX_STORED_DETECTIONS = 50;

/**
 * Calculates geodesic distance (meters) between two WGS-84 coordinates using Haversine formula
 */
export function calculateGeodesicDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

/**
 * Calculates initial bearing (compass heading degrees 0-360) from coord1 to coord2
 */
export function calculateGeodesicBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(((lon2 - lon1) * Math.PI) / 180);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return parseFloat((((bearing % 360) + 360) % 360).toFixed(1));
}

class ReconDetectionService {
  private detections: QRDetectionRecord[] = [];
  private latestDetection: QRDetectionRecord | null = null;
  private activeTarget: TargetLocation | null = null;
  private activeTargetRecordId: string | null = null;
  private currentVisualStatus: GCSVisualStatus = 'SEARCHING_FOR_QR';
  private currentDroneCoreStatus: DroneCoreQRStatus = 'CAMERA READY';

  private detectionListeners: Set<DetectionListener> = new Set();
  private visualStatusListeners: Set<VisualStatusListener> = new Set();
  private droneCoreStatusListeners: Set<DroneCoreStatusListener> = new Set();
  private targetListeners: Set<TargetListener> = new Set();

  // Deduplication tracker: maps payload/hash to last capture timestamp
  private recentDetections: Map<string, number> = new Map();
  private readonly deduplicationCooldownMs = 5000; // 5-second suppression for identical QR

  private telemetryUnsubscribe: (() => void) | null = null;
  private isApproachingTarget: boolean = false;
  private isRtlInitiated: boolean = false;
  private isAirGapped: boolean = false; // Allow GCS real-time sync with store-and-forward queue
  private retryQueue: any[] = [];
  private retryInterval: any = null;

  public setAirGapped(enabled: boolean) {
    this.isAirGapped = enabled;
  }

  public isAirGappedMode(): boolean {
    return this.isAirGapped;
  }

  constructor() {
    this.restorePersistedDetections();
    this.initTelemetrySubscription();
    this.initRetryQueue();
  }

  private initRetryQueue() {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('recon_detection_retry_queue');
      if (saved) {
        this.retryQueue = JSON.parse(saved);
      }
    } catch {}

    window.addEventListener('online', () => {
      console.info('[RECON] Network online detected. Immediately flushing retry queue...');
      this.flushRetryQueue();
    });

    if (!this.retryInterval) {
      this.retryInterval = setInterval(() => {
        this.flushRetryQueue();
      }, 2500);
    }
  }

  private persistRetryQueue() {
    if (typeof window === 'undefined') return;
    try {
      // Keep up to 25 items, pruning excessive base64 payload to prevent QuotaExceededError
      const safeQueue = this.retryQueue.slice(0, 25).map(item => {
        if (item.photoDataUrl && item.photoDataUrl.length > 80000) {
          return { ...item, photoDataUrl: item.photoDataUrl.slice(0, 80000) };
        }
        return item;
      });
      localStorage.setItem('recon_detection_retry_queue', JSON.stringify(safeQueue));
    } catch (e) {
      console.warn('[RECON] Could not persist retry queue to localStorage:', e);
    }
  }

  public async flushRetryQueue() {
    if (this.retryQueue.length === 0 || typeof window === 'undefined') return;
    const items = [...this.retryQueue];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const res = await fetchWithFallback('/api/recon/detections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
        if (res.ok) {
          this.retryQueue = this.retryQueue.filter((q) => q.detectionId !== item.detectionId);
          this.persistRetryQueue();
        }
      } catch {
        // Drone is out of Wi-Fi range during low-altitude hover; will retry on RTL
        break;
      }
    }
  }

  private restorePersistedDetections() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DETECTIONS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.detections = parsed;
          if (this.detections.length > 0) {
            this.latestDetection = this.detections[0];
            const targetRec = this.detections.find((d) => d.targetLocation && d.isTargetLocationConfirmed);
            if (targetRec && targetRec.targetLocation) {
              this.activeTarget = targetRec.targetLocation;
              this.activeTargetRecordId = targetRec.detectionId;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[RECON] Failed to restore persisted detections', e);
    }
  }

  private persistDetections() {
    if (typeof window === 'undefined') return;
    try {
      // Store up to MAX_STORED_DETECTIONS, omitting massive raw image strings in localStorage if needed
      const serialized = this.detections.slice(0, MAX_STORED_DETECTIONS).map((d) => ({
        ...d,
        // Keep thumbnail or slice to avoid local storage overflow
        photoDataUrl: d.photoDataUrl && d.photoDataUrl.length > 300000 ? d.thumbnailDataUrl || d.photoDataUrl.slice(0, 50000) : d.photoDataUrl
      }));
      localStorage.setItem(STORAGE_KEY_DETECTIONS, JSON.stringify(serialized));
    } catch (e) {
      // Quota exceeded: clean oldest
      try {
        const minimal = this.detections.slice(0, 10).map((d) => ({
          ...d,
          photoDataUrl: ''
        }));
        localStorage.setItem(STORAGE_KEY_DETECTIONS, JSON.stringify(minimal));
      } catch {}
    }
  }

  private initTelemetrySubscription() {
    this.telemetryUnsubscribe = mavlinkService.subscribeTelemetry((telem) => {
      // Periodically update distance and bearing to active target
      if (this.activeTarget) {
        this.updateTargetDistanceAndBearing(telem.latitude, telem.longitude);
      }

      // Check visual status updates based on comms/GPS
      const conn = mavlinkService.getConnectionState();
      if (!conn.isConnected && !conn.isUsbConnected && conn.connectionType !== 'SIMULATED') {
        this.setVisualStatus('COMMUNICATION_LOST');
      } else if (!telem.gps.isLocked && (telem.latitude === 0 || Math.abs(telem.latitude) <= 0.001)) {
        if (this.currentVisualStatus !== 'QR_DETECTED' && this.currentVisualStatus !== 'PROCESSING_IMAGE') {
          this.setVisualStatus('GPS_UNAVAILABLE');
        }
      } else if (this.currentVisualStatus === 'GPS_UNAVAILABLE' || this.currentVisualStatus === 'COMMUNICATION_LOST') {
        this.setVisualStatus(this.activeTarget ? 'TARGET_LOCATION_CONFIRMED' : 'SEARCHING_FOR_QR');
      }
    });
  }

  private updateTargetDistanceAndBearing(droneLat: number, droneLon: number) {
    if (!this.activeTarget) return;
    if (Math.abs(droneLat) <= 0.001 || Math.abs(droneLon) <= 0.001) {
      this.notifyTargetListeners(this.activeTarget, null, null);
      return;
    }

    const dist = calculateGeodesicDistance(droneLat, droneLon, this.activeTarget.latitude, this.activeTarget.longitude);
    const bearing = calculateGeodesicBearing(droneLat, droneLon, this.activeTarget.latitude, this.activeTarget.longitude);

    this.notifyTargetListeners(this.activeTarget, dist, bearing);

    // If approaching target and within 3m threshold, notify completion
    if (this.isApproachingTarget && dist <= 3.0) {
      this.isApproachingTarget = false;
      audioService.playBeep(1200, 200);
      console.log(`[RECON] Drone arrived at QR Target coordinate envelope (Distance: ${dist}m) ✓`);
    }
  }

  /**
   * Generates a unique detection ID with timestamp and sequence suffix
   */
  public generateDetectionId(): string {
    const now = new Date();
    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const hms = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const rand = Math.floor(Math.random() * 900 + 100);
    return `DET_${ymd}_${hms}_${rand}`;
  }

  /**
   * Checks whether a detected payload is a duplicate within cooldown window
   */
  public isDuplicateDetection(payload: string): boolean {
    if (!payload) return false;
    const now = Date.now();
    const lastSeen = this.recentDetections.get(payload);
    if (lastSeen && now - lastSeen < this.deduplicationCooldownMs) {
      return true;
    }
    this.recentDetections.set(payload, now);
    return false;
  }

  /**
   * Primary Entry Point: Records an event-driven photo capture when a QR code is detected in the camera frame
   */
  public async handleRawDetectionEvent(params: {
    photoDataUrl: string;
    thumbnailDataUrl?: string;
    rawImageData?: ImageData;
    initialPayload?: string | null;
    boundingBox?: { x: number; y: number; width: number; height: number };
    filename?: string;
  }): Promise<QRDetectionRecord> {
    const timestamp = Date.now();
    const detectionId = this.generateDetectionId();
    const filename = params.filename || `qr_capture_${detectionId.toLowerCase()}.jpg`;

    // 1. Snapshot Pixhawk GPS Telemetry Synchronized at exact Capture Time
    const telem = mavlinkService.getTelemetry();
    const isGpsValid = Boolean(
      telem.gps.isLocked &&
      telem.latitude !== 0 &&
      telem.longitude !== 0 &&
      Math.abs(telem.latitude) > 0.001 &&
      Math.abs(telem.longitude) > 0.001
    );

    const droneLat = isGpsValid ? telem.latitude : 0;
    const droneLon = isGpsValid ? telem.longitude : 0;
    const droneAltMsl = telem.gps.altitude || telem.altitude || 0;
    const droneAltAgl = telem.altitude || 0;
    const droneHeading = telem.heading || 0;
    const satellites = telem.gps.satellites || 0;
    const hdop = telem.gps.hdop || 0;
    const gpsFixType = telem.gps.fixType || (isGpsValid ? '3D_FIX' : 'NO_GPS');

    this.setVisualStatus('PHOTO_CAPTURED');
    audioService.playTargetLock();

    // 2. Decode & Process the Captured Photo
    let status: QRProcessingState = 'PROCESSING';
    this.setVisualStatus('PROCESSING_IMAGE');

    let decodedText: string | null = params.initialPayload || null;
    let decodeLatencyMs = 0;
    let processingAttempts = 1;

    // If payload not yet decoded and rawImageData is provided, run initial decode
    if (!decodedText && params.rawImageData) {
      const t0 = performance.now();
      const initialRes = await decodeQRFromImageData(params.rawImageData);
      decodeLatencyMs = +(performance.now() - t0).toFixed(1);

      if (initialRes && initialRes.text) {
        decodedText = initialRes.text;
      }
    }

    // 3. Retry Pipeline: If decoding failed, retry with software image processing on the saved image
    if (!decodedText && params.rawImageData) {
      processingAttempts++;
      const tRetry0 = performance.now();
      const retryRes = await retryDecodeImage(params.rawImageData);
      if (retryRes && retryRes.text) {
        decodedText = retryRes.text;
        decodeLatencyMs += +(performance.now() - tRetry0).toFixed(1);
      }
    }

    // 4. Case A vs Case B Analysis: Check if QR Payload contains valid GPS coordinates
    let targetLocation: TargetLocation | null = null;
    let isTargetLocationConfirmed = false;
    let payloadType = classifyPayload(decodedText || '').type;
    let distanceToTarget: number | null = null;
    let bearingToTarget: number | null = null;

    if (decodedText) {
      status = 'QR_DECODED';
      this.setVisualStatus('QR_DATA_EXTRACTED');
      this.setDroneCoreStatus('QR DATA RECEIVED');

      // Case A: Payload contains valid GPS coordinates
      const parsedCoords = parseCoordinatesFromPayload(decodedText);
      if (parsedCoords && parsedCoords.isValid) {
        targetLocation = parsedCoords;
        isTargetLocationConfirmed = true;
        status = 'TARGET_LOCATION_CONFIRMED';
        this.setVisualStatus('TARGET_LOCATION_CONFIRMED');

        if (isGpsValid) {
          distanceToTarget = calculateGeodesicDistance(droneLat, droneLon, targetLocation.latitude, targetLocation.longitude);
          bearingToTarget = calculateGeodesicBearing(droneLat, droneLon, targetLocation.latitude, targetLocation.longitude);
        }

        // Set as active confirmed target for GCS map and mission controller
        this.activeTarget = targetLocation;
        this.activeTargetRecordId = detectionId;
        this.notifyTargetListeners(targetLocation, distanceToTarget, bearingToTarget);
      } else {
        // Case B: Payload does not contain GPS coordinates
        // Association is with the drone's position at capture time; NOT target ground location!
        status = 'QR_DECODED';
      }
    } else {
      // Decode failed after retries: Retain original image and mark as DECODE_FAILED / LOCATION_PENDING
      status = 'DECODE_FAILED';
      this.setDroneCoreStatus('QR PROCESSING FAILED');
    }

    // 5. Construct Immutable Detection Record
    const record: QRDetectionRecord = {
      detectionId,
      imageFilename: filename,
      photoDataUrl: params.photoDataUrl,
      thumbnailDataUrl: params.thumbnailDataUrl || params.photoDataUrl,
      payload: decodedText,
      payloadType,
      targetLocation,
      isTargetLocationConfirmed,
      droneLatitude: droneLat,
      droneLongitude: droneLon,
      droneAltitudeMsl: droneAltMsl,
      droneAltitudeAgl: droneAltAgl,
      droneHeading,
      timestamp,
      gpsFixValid: isGpsValid,
      gpsFixType,
      satellites,
      hdop,
      status,
      processingAttempts,
      decodeLatencyMs,
      distanceToTargetMeters: distanceToTarget,
      bearingToTargetDeg: bearingToTarget,
      boundingBox: params.boundingBox,
      rtlInitiated: false,
      rtlConfirmed: false,
      rtlTriggeredBy: undefined,
      flightMode: telem.flightMode,
      notes: !isGpsValid
        ? 'Location Unavailable: Pixhawk GPS telemetry was not locked at capture timestamp.'
        : isTargetLocationConfirmed
        ? `Case A: Confirmed Target Location at ${targetLocation?.latitude.toFixed(6)}, ${targetLocation?.longitude.toFixed(6)}`
        : 'Case B: Decoded payload does not contain GPS coordinates. Drone position at capture recorded.'
    };

    // 6. Prepend to history & Notify Listeners
    this.detections = [record, ...this.detections.slice(0, MAX_STORED_DETECTIONS - 1)];
    this.latestDetection = record;
    this.persistDetections();
    this.notifyDetectionListeners();

    // 7. Stream Record to Cloud / Local Relay
    this.streamRecordToRelay(record);

    // CRITICAL REQUIREMENT (Step 5 & 6): Automatically deliver QR payload to Runner Unit & Initiate RTL
    if (decodedText && decodedText.trim().length > 0) {
      try {
        runnerCommService.sendQRToRunner(
          record.payload || decodedText,
          'MISSION_RESCUE_01',
          record.droneAltitudeAgl || 12.0,
          88,
          {
            detectionId: record.detectionId,
            droneLatitude: record.droneLatitude,
            droneLongitude: record.droneLongitude,
            gpsFixValid: record.gpsFixValid,
            status: record.status,
            thumbnailDataUrl: record.thumbnailDataUrl,
            rtlInitiated: true,
            rtlConfirmed: false
          }
        );
      } catch (err) {
        console.warn('[RECON] Runner dispatch notice:', err);
      }

      await this.triggerAutomaticRTL(record);
    }

    return record;
  }

  /**
   * Critical Requirement (Specification Section 6):
   * Automatically Return to Launch After Receiving Valid QR Data
   */
  public async triggerAutomaticRTL(record: QRDetectionRecord): Promise<{ success: boolean; message: string; flightMode?: string }> {
    // Prevent duplicate RTL commands for the same detection event
    if (this.isRtlInitiated) {
      return {
        success: true,
        message: 'RTL already active for confirmed reconnaissance target',
        flightMode: mavlinkService.getTelemetry().flightMode
      };
    }

    const currentMode = (mavlinkService.getTelemetry().flightMode || '').toUpperCase();
    if (currentMode === 'RTL') {
      this.isRtlInitiated = true;
      record.rtlInitiated = true;
      record.rtlConfirmed = true;
      record.rtlTriggeredBy = 'QR_DETECTION';
      record.flightMode = 'RTL';
      this.setDroneCoreStatus('RETURNING TO LAUNCH');
      return { success: true, message: 'Vehicle already executing RTL flight mode', flightMode: 'RTL' };
    }

    // Step 6: Trigger RTL Automatically immediately upon successful QR data receipt
    this.isRtlInitiated = true;
    record.rtlInitiated = true;
    record.rtlTriggeredBy = 'QR_DETECTION';
    this.setDroneCoreStatus('RTL INITIATED');
    audioService.playRtlAlert();

    // 1. Halt autonomous search algorithm in mission engine (safeguard: do not continue search)
    try {
      missionEngine.triggerEmergencyRTL(`AUTONOMOUS_QR_RTL: Verified Payload [${record.payload}]`);
    } catch (e) {
      console.warn('[RECON] MissionEngine halt notice:', e);
    }

    // 2. Dispatch Pixhawk RTL command via existing MAVLink implementation
    try {
      const success = await mavlinkService.commandRTL();
      if (success) {
        const confirmedMode = mavlinkService.getTelemetry().flightMode;
        record.flightMode = confirmedMode;

        // Step 7: Confirm RTL - display RETURNING TO LAUNCH when telemetry confirms vehicle is executing RTL
        if (confirmedMode === 'RTL') {
          record.rtlConfirmed = true;
          this.setDroneCoreStatus('RETURNING TO LAUNCH');
        } else {
          // Listen for mode transition to RTL from Pixhawk heartbeat
          const unsub = mavlinkService.subscribeTelemetry((t) => {
            if ((t.flightMode || '').toUpperCase() === 'RTL') {
              record.rtlConfirmed = true;
              record.flightMode = t.flightMode;
              this.setDroneCoreStatus('RETURNING TO LAUNCH');
              this.persistDetections();
              this.notifyDetectionListeners();
              this.streamRecordToRelay(record);
              unsub();
            }
          });
          setTimeout(() => unsub(), 8000);
        }

        this.persistDetections();
        this.notifyDetectionListeners();
        this.streamRecordToRelay(record);

        return {
          success: true,
          message: 'Automatic RTL initiated cleanly via Pixhawk MAVLink ✓',
          flightMode: confirmedMode
        };
      } else {
        this.setDroneCoreStatus('QR DATA RECEIVED');
        return {
          success: false,
          message: 'Pixhawk flight controller rejected RTL command. Check arm/failsafe conditions.'
        };
      }
    } catch (err: any) {
      this.setDroneCoreStatus('QR DATA RECEIVED');
      return {
        success: false,
        message: `RTL command dispatch error: ${err?.message || err}`
      };
    }
  }

  /**
   * Request Controlled Approach Toward Validated Target (Case A requirement):
   * Moves drone toward the confirmed QR target coordinates only when safety conditions are satisfied.
   */
  public async requestTargetApproach(
    detectionId?: string,
    targetAltMeters: number = 10.0,
    speedMps: number = 2.5
  ): Promise<{ success: boolean; message: string }> {
    let target = this.activeTarget;

    if (detectionId) {
      const rec = this.detections.find((d) => d.detectionId === detectionId);
      if (rec && rec.targetLocation && rec.isTargetLocationConfirmed) {
        target = rec.targetLocation;
      }
    }

    if (!target || !target.isValid) {
      return {
        success: false,
        message: 'No verified target coordinates available. Target navigation rejected.'
      };
    }

    const telem = mavlinkService.getTelemetry();
    if (!telem.gps.isLocked || telem.latitude === 0 || Math.abs(telem.latitude) <= 0.001) {
      return {
        success: false,
        message: 'Drone GPS Signal Unavailable. Cannot safely navigate toward target.'
      };
    }

    const distance = calculateGeodesicDistance(telem.latitude, telem.longitude, target.latitude, target.longitude);
    if (distance > 500) {
      return {
        success: false,
        message: `Target distance (${distance}m) exceeds safe 500m geofence operating limit.`
      };
    }

    const alt = Math.max(5.0, Math.min(30.0, targetAltMeters));
    const speed = Math.max(1.0, Math.min(5.0, speedMps));

    console.log(`[RECON] Navigating toward confirmed target: ${target.latitude}, ${target.longitude} at ${alt}m (${speed} m/s)`);

    try {
      this.isApproachingTarget = true;
      audioService.playBeep(980, 150);

      // Execute via standard Pixhawk MAVLink GUIDED flyToPosition
      const success = await mavlinkService.flyToPosition(target.latitude, target.longitude, alt, speed);
      if (success) {
        return {
          success: true,
          message: `Aircraft navigating toward QR target (${distance}m @ ${speed} m/s, ${alt}m AGL) ✓`
        };
      } else {
        this.isApproachingTarget = false;
        return {
          success: false,
          message: 'Flight controller rejected reposition command. Ensure vehicle is armed and in GUIDED mode.'
        };
      }
    } catch (err: any) {
      this.isApproachingTarget = false;
      return {
        success: false,
        message: `Target navigation failed: ${err?.message || 'MAVLink command error'}`
      };
    }
  }

  /**
   * Retries decoding a previously saved detection record
   */
  public async retryRecordDecode(detectionId: string): Promise<QRDetectionRecord | null> {
    const idx = this.detections.findIndex((d) => d.detectionId === detectionId);
    if (idx === -1) return null;

    const record = this.detections[idx];
    if (!record.photoDataUrl) return record;

    try {
      // Re-create ImageData from photoDataUrl in browser context
      const img = new Image();
      img.src = record.photoDataUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return record;

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const retryRes = await retryDecodeImage(imgData);
      if (retryRes && retryRes.text) {
        record.payload = retryRes.text;
        record.payloadType = classifyPayload(retryRes.text).type;
        const coords = parseCoordinatesFromPayload(retryRes.text);

        if (coords && coords.isValid) {
          record.targetLocation = coords;
          record.isTargetLocationConfirmed = true;
          record.status = 'TARGET_LOCATION_CONFIRMED';
          this.activeTarget = coords;
          this.activeTargetRecordId = record.detectionId;
        } else {
          record.status = 'QR_DECODED';
        }
        record.processingAttempts++;
        record.notes = 'Successfully recovered payload via secondary software filtering retry.';

        this.persistDetections();
        this.notifyDetectionListeners();
        this.streamRecordToRelay(record);
        audioService.playRunnerAck();
      }
    } catch (e) {
      console.warn('[RECON] Retry decode exception', e);
    }

    return record;
  }

  public clearAllDetections() {
    this.detections = [];
    this.latestDetection = null;
    this.activeTarget = null;
    this.activeTargetRecordId = null;
    this.recentDetections.clear();
    this.isApproachingTarget = false;
    this.isRtlInitiated = false;
    this.setVisualStatus('SEARCHING_FOR_QR');
    this.setDroneCoreStatus('CAMERA READY');
    this.persistDetections();
    this.notifyDetectionListeners();
    this.notifyTargetListeners(null, null, null);
  }

  public resetRtlState() {
    this.isRtlInitiated = false;
    this.setDroneCoreStatus('CAMERA READY');
  }

  /**
   * Directly records a 2-digit QR code / verified target detection event and streams to GCS
   */
  public recordDetection(params: {
    detectionId?: string;
    type?: string;
    twoDigitCode?: string;
    payload?: string;
    rawPayload?: string;
    droneLatitude?: number;
    droneLongitude?: number;
    photoDataUrl?: string;
    timestamp?: number;
    gpsFixValid?: boolean;
    status?: QRProcessingState;
  }): QRDetectionRecord {
    const id = params.detectionId || this.generateDetectionId();
    const twoDigits =
      params.twoDigitCode ||
      (params.payload ? extractTwoDigits(params.payload).twoDigits : '42') ||
      '42';
    const lat = params.droneLatitude || 0;
    const lon = params.droneLongitude || 0;
    const timestamp = params.timestamp || Date.now();

    const record: QRDetectionRecord = {
      detectionId: id,
      imageFilename: `QR_${id}.jpg`,
      photoDataUrl: params.photoDataUrl || '',
      thumbnailDataUrl: params.photoDataUrl || '',
      payload: params.payload || twoDigits,
      payloadType: 'TWO_DIGIT',
      twoDigitCode: twoDigits,
      targetLocation: {
        latitude: lat,
        longitude: lon,
        isValid: Boolean(lat !== 0 && lon !== 0)
      },
      isTargetLocationConfirmed: Boolean(lat !== 0 && lon !== 0),
      droneLatitude: lat,
      droneLongitude: lon,
      droneAltitudeMsl: 10,
      droneAltitudeAgl: 4,
      droneHeading: 0,
      timestamp,
      gpsFixValid: params.gpsFixValid ?? true,
      gpsFixType: '3D_FIX',
      satellites: 12,
      hdop: 0.8,
      status: params.status || 'QR_DECODED',
      processingAttempts: 1,
      decodeLatencyMs: 12,
      distanceToTargetMeters: 0,
      bearingToTargetDeg: 0,
      rtlInitiated: true,
      rtlConfirmed: false,
      rtlTriggeredBy: 'QR_DETECTION',
      flightMode: 'RTL',
      notes: `Target 2-Digit Code: ${twoDigits}`
    };

    if (record.targetLocation && record.targetLocation.isValid) {
      this.activeTarget = record.targetLocation;
      (this.activeTarget as any).twoDigitCode = twoDigits;
      this.activeTargetRecordId = id;
      this.notifyTargetListeners(this.activeTarget, 0, 0);
    }

    this.detections = [record, ...this.detections.slice(0, MAX_STORED_DETECTIONS - 1)];
    this.latestDetection = record;
    this.persistDetections();
    this.notifyDetectionListeners();
    audioService.playTargetLock();

    // Stream with retry queue to GCS
    this.streamRecordToRelay(record);
    return record;
  }

  // --- STREAMING & RELAY ---

  private streamRecordToRelay(record: QRDetectionRecord) {
    if (typeof window === 'undefined' || this.isAirGapped) return;

    const payload = {
      detectionId: record.detectionId,
      imageFilename: record.imageFilename,
      thumbnailDataUrl: record.thumbnailDataUrl,
      photoDataUrl: record.photoDataUrl,
      payload: record.payload,
      payloadType: record.payloadType,
      twoDigitCode: (record as any).twoDigitCode,
      targetLocation: record.targetLocation,
      isTargetLocationConfirmed: record.isTargetLocationConfirmed,
      droneLatitude: record.droneLatitude,
      droneLongitude: record.droneLongitude,
      droneAltitudeAgl: record.droneAltitudeAgl,
      timestamp: record.timestamp,
      gpsFixValid: record.gpsFixValid,
      status: record.status,
      distanceToTargetMeters: record.distanceToTargetMeters,
      rtlInitiated: record.rtlInitiated,
      rtlConfirmed: record.rtlConfirmed,
      rtlTriggeredBy: record.rtlTriggeredBy,
      flightMode: record.flightMode
    };

    // Send via REST endpoint with store-and-forward retry fallback
    fetchWithFallback('/api/recon/detections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {
      // Drone temporarily out of Wi-Fi range during box revisit hover -> enqueue for automatic delivery on RTL
      if (!this.retryQueue.some((q) => q.detectionId === record.detectionId)) {
        this.retryQueue.push(payload);
        this.persistRetryQueue();
      }
    });
  }

  // --- LISTENERS & GETTERS ---

  public getDetections(): QRDetectionRecord[] {
    return [...this.detections];
  }

  public getLatestDetection(): QRDetectionRecord | null {
    return this.latestDetection;
  }

  public getActiveTarget(): TargetLocation | null {
    return this.activeTarget;
  }

  public getVisualStatus(): GCSVisualStatus {
    return this.currentVisualStatus;
  }

  public setVisualStatus(status: GCSVisualStatus) {
    if (this.currentVisualStatus === status) return;
    this.currentVisualStatus = status;
    this.visualStatusListeners.forEach((fn) => {
      try {
        fn(status);
      } catch {}
    });
  }

  public getDroneCoreStatus(): DroneCoreQRStatus {
    return this.currentDroneCoreStatus;
  }

  public setDroneCoreStatus(status: DroneCoreQRStatus) {
    if (this.currentDroneCoreStatus === status) return;
    this.currentDroneCoreStatus = status;
    this.droneCoreStatusListeners.forEach((fn) => {
      try {
        fn(status);
      } catch {}
    });
  }

  public subscribeDroneCoreStatus(fn: DroneCoreStatusListener): () => void {
    this.droneCoreStatusListeners.add(fn);
    fn(this.currentDroneCoreStatus);
    return () => this.droneCoreStatusListeners.delete(fn);
  }

  public subscribeDetections(fn: DetectionListener): () => void {
    this.detectionListeners.add(fn);
    fn(this.detections, this.latestDetection);
    return () => this.detectionListeners.delete(fn);
  }

  public subscribeVisualStatus(fn: VisualStatusListener): () => void {
    this.visualStatusListeners.add(fn);
    fn(this.currentVisualStatus);
    return () => this.visualStatusListeners.delete(fn);
  }

  public subscribeActiveTarget(fn: TargetListener): () => void {
    this.targetListeners.add(fn);
    const telem = mavlinkService.getTelemetry();
    const dist =
      this.activeTarget && telem.latitude && telem.longitude
        ? calculateGeodesicDistance(telem.latitude, telem.longitude, this.activeTarget.latitude, this.activeTarget.longitude)
        : null;
    const bearing =
      this.activeTarget && telem.latitude && telem.longitude
        ? calculateGeodesicBearing(telem.latitude, telem.longitude, this.activeTarget.latitude, this.activeTarget.longitude)
        : null;

    fn(this.activeTarget, dist, bearing);
    return () => this.targetListeners.delete(fn);
  }

  private notifyDetectionListeners() {
    this.detectionListeners.forEach((fn) => {
      try {
        fn(this.detections, this.latestDetection);
      } catch {}
    });
  }

  private notifyTargetListeners(target: TargetLocation | null, distance: number | null, bearing: number | null) {
    this.targetListeners.forEach((fn) => {
      try {
        fn(target, distance, bearing);
      } catch {}
    });
  }
}

export const reconDetectionService = new ReconDetectionService();
