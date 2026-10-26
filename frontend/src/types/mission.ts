export type AppRole = 'GROUND_STATION' | 'DRONE' | 'RUNNER' | 'MANUAL' | 'TESTBENCH' | 'SELECT';

export type FlightCommandAuthority = 'AUTONOMOUS' | 'MANUAL' | 'RTL' | 'NONE';

export type MissionState =
  | 'IDLE'
  | 'CONFIGURING'
  | 'HOME_SET'
  | 'READY'
  | 'STARTING'
  | 'TAKEOFF'
  | 'CLIMBING'
  | 'CLIMBING_TO_ALTITUDE'
  | 'ALTITUDE_STABILIZING'
  | 'ALTITUDE_UPDATING'
  | 'SEARCHING'
  | 'OBJECT_DETECTED'
  | 'BOX_DETECTED'
  | 'BOX_TRACKING'
  | 'BOX_CENTERED'
  | 'INSPECTING'
  | 'QR_DETECTION'
  | 'QR_DETECTED'
  | 'QR_SCANNING'
  | 'QR_DECODED'
  | 'DATA_CONFIRMED'
  | 'SEND_TO_RUNNER'
  | 'WAIT_FOR_RUNNER_ACK'
  | 'RUNNER_CONFIRMED'
  | 'MISSION_COMPLETE'
  | 'RTL_REQUESTED'
  | 'RTL'
  | 'RETURNING_HOME'
  | 'LANDING'
  | 'LANDED'
  | 'ERROR'
  | 'ABORTED'
  | 'FAILSAFE'
  | 'EMERGENCY_RTL'
  | 'MISSION_TIMEOUT'
  | 'CONNECTION_LOST'
  | 'GPS_ERROR'
  | 'CAMERA_ERROR'
  | 'BOUNDARY_ERROR'
  | 'PLANNING'
  | 'MISSION_VALIDATED'
  | 'OUTBOUND_NAVIGATION'
  | 'TARGET_INVESTIGATION'
  | 'OUTBOUND_COMPLETE'
  | 'RETURN_NAVIGATION'
  | 'HOME_REACHED'
  | 'LOW_BATTERY'
  | 'MANUAL_CONTROL';

export type SearchBoundaryType = 'RECTANGLE' | 'SQUARE' | 'CIRCLE' | 'POLYGON' | 'CUSTOM';
export type SearchAlgorithmType =
  | 'GRID'
  | 'SPIRAL'
  | 'EXPANDING_SPIRAL'
  | 'PERIMETER'
  | 'ADAPTIVE'
  | 'SECTOR'
  | 'CONTOUR';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface SearchBoundaryConfig {
  type: SearchBoundaryType;
  coordinates: LatLngPoint[];
  circleCenter?: LatLngPoint;
  circleRadiusMeters?: number;
  circleDirection?: 'CW' | 'CCW';
  widthMeters?: number;
  heightMeters?: number;
  areaSquareMeters?: number;
  label?: string;
}

export interface AutonomousMissionConfig {
  searchAltitude: number;             // Altitude above home reference (meters, e.g. 10m)
  searchBoundary: SearchBoundaryConfig;
  searchAlgorithm: SearchAlgorithmType; // e.g. 'GRID' | 'SPIRAL' | 'PERIMETER' | 'ADAPTIVE'
  flightSpeedMs: number;              // Target ground speed during search (m/s, e.g. 3.0)
  gridSpacingMeters: number;          // Lawnmower transect separation (meters, e.g. 5.0)
  desiredOverlapPercent?: number;     // Camera FOV overlap percent (default 25%)
  cameraFovHorizontalDeg?: number;    // Camera HFOV degrees (default 70°)
  cameraFovVerticalDeg?: number;      // Camera VFOV degrees (default 52°)
  inspectionHoverSeconds?: number;    // Hover duration for target inspection (default 4s)
  rtlOnQrConfirmation: boolean;       // RTL on QR Confirmation [ON / OFF]
  autoRtlOnCriticalFailure: boolean;  // Automatic RTL on Critical Failure [ON / OFF]
  stabilizationSeconds: number;       // Hover duration at target altitude before search (default 2s)
  altitudeToleranceMeters: number;    // Tolerance band around target altitude (default 0.5m)
}

export interface MissionPreFlightCondition {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
  severity: 'error' | 'warning' | 'ok';
}

export interface AutonomousMissionValidation {
  isValid: boolean;
  conditions: MissionPreFlightCondition[];
  allPassed: boolean;
  errors: string[];
}

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  altitude: number;
  satellites: number;
  hdop: number;
  isLocked: boolean;
  fixType?: string;
  lastUpdated?: number;
}

export type GPSLocation = GPSCoordinates;

export interface HomePoint {
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: number;
  isSet: boolean;
}

export interface DroneTelemetry {
  latitude: number;
  longitude: number;
  altitude: number;
  targetAltitude: number;
  groundSpeed: number;
  airSpeed?: number;
  verticalSpeed: number;
  heading: number;
  pitch?: number;
  roll?: number;
  satellitesVisible?: number;
  batteryPercent: number;
  batteryVoltage: number;
  batteryCurrent?: number;
  batteryCellCount?: number;
  flightMode: string;
  isArmed: boolean;
  vehicleState?: 'ARMED' | 'DISARMED' | 'ARMING' | 'DISARMING' | 'UNKNOWN';
  controlMode?: 'RC' | 'NO_RC';
  rcSignalDetected?: boolean;
  rcOverrideEnabled?: boolean;
  rcRssi?: number;
  magHeading?: number;
  magFieldStrength?: number;
  magX?: number;
  magY?: number;
  magZ?: number;
  isCompassHealthy?: boolean;
  isCompassCalibrated?: boolean;
  pixhawkConnected: boolean;
  cameraReady: boolean;
  runnerConnected?: boolean;
  gps: GPSCoordinates;
  distanceToHome: number;
  distanceFromHomeMeters?: number;
  searchProgress?: number;
  timestamp?: number;
}

export interface TargetBoxDetection {
  isDetected: boolean;
  isLocked: boolean;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  aspectRatio: number;
  areaPercent: number;
  offsetXPercent: number; // -100% (left) to +100% (right)
  offsetYPercent: number; // -100% (up) to +100% (down)
  distanceOffsetMeters: number;
  confidence: number;
  fcGuidance: VisualServoingCommand;
  detectedAt: number;
}

export interface VisualServoingCommand {
  action: 'SEARCHING_PATTERN' | 'ADJUST_PITCH_ROLL' | 'HOLD_CENTER' | 'DESCEND_FOR_SCAN';
  targetPitchRoll: {
    forwardSpeedMs: number; // + forward, - backward
    lateralSpeedMs: number; // + right, - left
    descentRateMs: number;  // + descend
    yawCorrectionDeg: number;
  };
  flightControlLog: string;
  isCentered: boolean;
}

export interface QRCornerPoint {
  x: number;
  y: number;
  xPercent: number;
  yPercent: number;
}

export interface DecodedQRData {
  rawText: string;
  code: string;
  isValidTwoDigit: boolean;
  detectedAt: number;
  confidence: number;
  photoSnapshotUrl?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  normalizedBox?: {
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
    centerXPercent: number;
    centerYPercent: number;
  };
  corners?: {
    topLeft: QRCornerPoint;
    topRight: QRCornerPoint;
    bottomRight: QRCornerPoint;
    bottomLeft: QRCornerPoint;
  };
}

export interface PhotoCaptureEvent {
  id: string;
  timestamp: number;
  intervalSec: number;
  qrFound: boolean;
  qrCode?: string;
  autoPurged: boolean;
  photoDataUrl?: string;
  altitudeMeters: number;
  latitude: number;
  longitude: number;
}

export interface PreFlightChecklist {
  droneConnected: boolean;
  pixhawkConnected: boolean;
  mavlinkAvailable: boolean;
  gpsAvailable: boolean;
  homePointValid: boolean;
  batterySufficient: boolean;
  cameraAvailable: boolean;
  qrScannerAvailable: boolean;
  runnerConnectionAvailable: boolean;
  missionTimerReady: boolean;
}

export interface MissionLogEntry {
  id: string;
  missionNumber: number;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  homePoint: HomePoint;
  flightPath?: Array<{ lat: number; lng: number; alt?: number; timestamp?: number }>;
  waypoints?: Array<{ seq: number; lat: number; lng: number; alt: number; command?: number; action?: string; param1?: number; param2?: number }>;
  telemetrySnapshot?: {
    maxAltitude?: number;
    avgSpeed?: number;
    batteryUsedPercent?: number;
    batteryStartVoltage?: number;
    batteryEndVoltage?: number;
    satellites?: number;
    flightMode?: string;
  };
  qrResult: string;
  qrData?: {
    code: string;
    detectedAt?: number;
    confidence?: number;
  };
  verifiedSnapshotUrl?: string;
  photosAnalyzedCount?: number;
  photosPurgedCount?: number;
  runnerAckReceived: boolean;
  runnerAckLatencyMs: number;
  rtlStatus: 'COMPLETED' | 'FAILED' | 'EMERGENCY_RTL' | string;
  landingStatus: 'COMPLETED' | 'MANUAL_TAKEOVER' | 'FAILED' | string;
  completionStatus: 'SUCCESS' | 'TIMEOUT' | 'ABORTED' | 'EMERGENCY_RTL' | string;
  stateTransitions: Array<{ state: MissionState; timestamp: number; note?: string }>;
}
