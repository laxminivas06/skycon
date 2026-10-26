import { LatLngPoint, SearchBoundaryConfig } from '../../types/mission';

export type SearchAlgorithmId = 'GRID' | 'SPIRAL' | 'EXPANDING_SPIRAL' | 'PERIMETER' | 'ADAPTIVE' | 'SECTOR' | 'CONTOUR';

export interface CameraParameters {
  fovHorizontalDeg: number;  // Horizontal Field of View (degrees, default: 70)
  fovVerticalDeg: number;    // Vertical Field of View (degrees, default: 52)
  aspectRatio: number;       // Camera aspect ratio width/height (default: 16/9)
  focalLengthMm?: number;
  sensorWidthMm?: number;
  sensorHeightMm?: number;
}

export interface GroundFootprint {
  widthMeters: number;       // Ground width covered by camera at current altitude
  heightMeters: number;      // Ground height covered by camera at current altitude
  areaSquareMeters: number;  // Total ground footprint area
  effectiveLaneSpacingMeters: number; // Lane spacing accounting for desired overlap
  gsdCmPerPixel?: number;    // Ground Sample Distance (cm/px)
}

export interface SearchWaypoint {
  id: string;
  lat: number;
  lng: number;
  altitudeMeters: number;
  speedMs: number;
  action: 'TRANSIT' | 'SCAN_PASS' | 'TURN' | 'HOVER_INSPECT' | 'RETURN_TO_PATH';
  laneIndex?: number;
  radiusFromCenterMeters?: number;
  headingDeg?: number;
  isInspected?: boolean;
}

export interface SearchPathResult {
  algorithm: SearchAlgorithmId;
  waypoints: SearchWaypoint[];
  totalDistanceMeters: number;
  estimatedTimeSeconds: number;
  laneCount: number;
  laneSpacingMeters: number;
  groundFootprint: GroundFootprint;
  boundaryAreaMeters: number;
  coverageEfficiencyPercent: number;
}

export interface DetectedTargetRecord {
  id: string;
  timestamp: number;
  gpsPosition: {
    lat: number;
    lng: number;
    altitude: number;
  };
  objectClass: 'CARDBOARD_BOX' | 'PACKAGE' | 'CONTAINER' | 'WHITE_TOP_FACE' | 'TARGET_OBJECT' | 'UNKNOWN';
  confidence: number;
  evidenceFrameUrl?: string;
  qrCandidateDetected: boolean;
  qrDecodedText?: string;
  inspectionStatus: 'PENDING' | 'INSPECTING' | 'CONFIRMED' | 'REJECTED' | 'DUPLICATE_IGNORED';
  inspectionDurationMs: number;
  distanceFromDroneMeters: number;
}

export interface SearchEngineStatus {
  state: 'STANDBY' | 'GENERATING_PATH' | 'SEARCHING' | 'TARGET_DETECTED' | 'INSPECTING_TARGET' | 'QR_ACTIVE' | 'QR_CONFIRMED' | 'RESUMING_SEARCH' | 'COMPLETED';
  algorithm: SearchAlgorithmId;
  activeWaypointIndex: number;
  totalWaypoints: number;
  currentLane: number;
  totalLanes: number;
  progressPercent: number;
  distanceCoveredMeters: number;
  remainingDistanceMeters: number;
  objectDetectionActive: boolean;
  qrScannerActive: boolean;
  activeZoomLevel: number;
  currentTarget: DetectedTargetRecord | null;
  targetHistory: DetectedTargetRecord[];
  isSuspendedForInspection: boolean;
  groundFootprint: GroundFootprint;
  statusMessage: string;
}

export interface SearchEngineConfig {
  searchAltitude: number;
  searchBoundary: SearchBoundaryConfig;
  algorithm: SearchAlgorithmId;
  flightSpeedMs: number;
  desiredOverlapPercent: number; // 10% to 50% (default: 25%)
  cameraParams: CameraParameters;
  inspectionHoverSeconds: number; // default: 4s
  duplicateDistanceThresholdMeters: number; // default: 4.0m
  maxInspectionAttempts: number; // default: 2
}
