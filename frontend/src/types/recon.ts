/**
 * AERORECON — Drone-Core Camera Intelligence & Recon Data Types
 * Defines data models for autonomous QR detection, Pixhawk GPS association,
 * image processing state machine, target navigation, and GCS streaming.
 */

export type QRProcessingState =
  | 'QR_DETECTED'
  | 'IMAGE_CAPTURED'
  | 'PROCESSING'
  | 'QR_DECODED'
  | 'DECODE_FAILED'
  | 'LOCATION_PENDING'
  | 'TARGET_LOCATION_CONFIRMED';

export type GCSVisualStatus =
  | 'CAMERA_CONNECTED'
  | 'SEARCHING_FOR_QR'
  | 'QR_DETECTED'
  | 'PHOTO_CAPTURED'
  | 'PROCESSING_IMAGE'
  | 'QR_DATA_EXTRACTED'
  | 'TARGET_LOCATION_CONFIRMED'
  | 'GPS_UNAVAILABLE'
  | 'COMMUNICATION_LOST';

/**
 * Autonomous Edge-Only Drone Core State Machine
 */
export type EdgeDroneCoreState =
  | 'STANDBY'
  | 'SEARCHING'
  | 'TARGET_DETECTED'
  | 'APPROACHING'
  | 'DECODING'
  | 'RTL';

/**
 * Drone Core Compact Status Indicator States (Specification 4.B)
 */
export type DroneCoreQRStatus =
  | 'CAMERA READY'
  | 'SEARCHING FOR QR'
  | 'QR DETECTED'
  | 'CAPTURING PHOTO'
  | 'PROCESSING QR'
  | 'QR DATA RECEIVED'
  | 'RTL INITIATED'
  | 'RETURNING TO LAUNCH'
  | 'CAMERA ERROR'
  | 'QR PROCESSING FAILED';

export type QRPayloadType =
  | 'COORDINATES'
  | 'TEXT'
  | 'URL'
  | 'JSON'
  | 'TWO_DIGIT'
  | 'UNKNOWN';

export interface TargetLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
  rawCoordinateString?: string;
  isValid: boolean;
  confidence?: number;
}

export interface QRDetectionRecord {
  detectionId: string;
  imageFilename: string;
  photoDataUrl: string; // Original full-resolution image
  thumbnailDataUrl?: string; // Optimized thumbnail for fast streaming
  payload: string | null;
  payloadType: QRPayloadType;
  twoDigitCode?: string;
  targetLocation: TargetLocation | null;
  isTargetLocationConfirmed: boolean;

  // Pixhawk Telemetry Synchronized at Capture Time
  droneLatitude: number;
  droneLongitude: number;
  droneAltitudeMsl: number;
  droneAltitudeAgl: number;
  droneHeading: number;
  timestamp: number;
  gpsFixValid: boolean;
  gpsFixType: string;
  satellites: number;
  hdop: number;

  // Image Processing & Navigation State
  status: QRProcessingState;
  processingAttempts: number;
  decodeLatencyMs: number;
  distanceToTargetMeters: number | null;
  bearingToTargetDeg: number | null;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  notes?: string;

  // Autonomous Return-to-Launch (RTL) Tracking
  rtlInitiated?: boolean;
  rtlConfirmed?: boolean;
  rtlTriggeredBy?: 'QR_DETECTION' | 'MANUAL_OPERATOR' | 'FAILSAFE';
  flightMode?: string;
}

export interface TargetNavigationRequest {
  detectionId: string;
  targetLat: number;
  targetLon: number;
  targetAlt: number;
  speedMps: number;
  timestamp: number;
}

export interface ReconTelemetryStream {
  visualStatus: GCSVisualStatus;
  processingStatus: QRProcessingState;
  latestDetection: QRDetectionRecord | null;
  totalDetectionsCount: number;
  confirmedTargetsCount: number;
  cameraFps: number;
  isCameraActive: boolean;
  isGpsValid: boolean;
}
