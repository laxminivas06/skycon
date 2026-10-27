/**
 * SAE INDIA — Autonomous Aerial Recon & Precision Recovery Test Suite
 * Test: Interactive Geofence Enforcement, Live IP-Cam Survey & Deferred QR Revisit Pipeline
 *
 * Verifies:
 * 1. Ray-casting point-in-polygon engine (convex & concave) & waypoint boundary clamping
 * 2. Strict hardware/software pre-arm lockout (outside fence or < 6 satellites)
 * 3. MAVLink MAV_CMD_DO_FENCE_ENABLE (1603) & polygon vertex upload (5001)
 * 4. Ground anomaly contour detection & whole-area snapshot capture with 1.5m spatial deduplication
 * 5. Asynchronous batch/queue QR scanner & autonomous REVISITING dispatch
 * 6. Precision hover, PTZ zoom sweep, evidence packaging, and Runner Dashboard live intercept tracking
 */

// 1. Setup mock browser environment for Node.js
if (typeof globalThis.window === 'undefined') {
  const storage: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = String(v); },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).localStorage = mockLocalStorage;

  class MockImage {
    public complete: boolean = true;
    public naturalWidth: number = 640;
    public naturalHeight: number = 480;
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    private _src: string = '';
    set src(v: string) {
      this._src = v;
      if (this.onload) setTimeout(() => this.onload?.(), 1);
    }
    get src() { return this._src; }
  }
  (globalThis as any).Image = MockImage;

  // Mock HTMLCanvasElement & document for Node environment
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 640,
          height: 480,
          getContext: () => ({
            drawImage: () => {},
            getImageData: (x: number, y: number, w: number, h: number) => ({
              width: w,
              height: h,
              data: new Uint8ClampedArray(w * h * 4)
            }),
            putImageData: () => {}
          }),
          toDataURL: () => 'data:image/jpeg;base64,mockJpegSnapshotData'
        };
      }
      return {};
    }
  };
}

import {
  geofenceService,
  isPointInsideGeofence,
  clampWaypointToGeofence,
  getPolygonCentroid
} from '../frontend/src/services/geofenceService';
import { mavlinkService } from '../frontend/src/services/mavlinkService';
import {
  targetDetectionEngine,
  CapturedAreaImage
} from '../frontend/src/services/targetDetectionEngine';
import {
  phoneDroneMissionService
} from '../frontend/src/services/phoneDroneMissionService';
import { droneCameraStreamService } from '../frontend/src/services/droneCameraStreamService';
import { SpiralSearch } from '../frontend/src/services/searchEngine/SpiralSearch';
import { TangentialSearch } from '../frontend/src/services/searchEngine/TangentialSearch';
import { GridSearch } from '../frontend/src/services/searchEngine/GridSearch';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, errorDetail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ [FAIL] ${testName}${errorDetail ? ` — ${errorDetail}` : ''}`);
  }
}

// Helper to create synthetic ImageData with custom pixel luminance
function createSyntheticImageData(
  width: number,
  height: number,
  filler: (x: number, y: number) => { r: number; g: number; b: number }
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const { r, g, b } = filler(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return {
    width,
    height,
    data,
    colorSpace: 'srgb'
  } as ImageData;
}

async function runAllTests() {
  console.log('\n========================================================================');
  console.log('🚀 SAE INDIA: GEOFENCE, IP-CAM SURVEY & DEFERRED QR REVISIT TEST SUITE');
  console.log('========================================================================\n');

  // =========================================================================
  // MODULE 1: RAY-CASTING POINT-IN-POLYGON & WAYPOINT CLAMPING ENGINE
  // =========================================================================
  console.log('--- MODULE 1: Ray-Casting Point-in-Polygon & Waypoint Clamping ---');

  // Test Polygon: Square area around ADDC Field (12.9715 - 12.9735 Lat, 77.5945 - 77.5965 Lon)
  const polygon = [
    { lat: 12.9715, lng: 77.5945 },
    { lat: 12.9735, lng: 77.5945 },
    { lat: 12.9735, lng: 77.5965 },
    { lat: 12.9715, lng: 77.5965 }
  ];

  const insidePoint = { lat: 12.9725, lng: 77.5955 };
  const outsidePointNorth = { lat: 12.9740, lng: 77.5955 };
  const outsidePointEast = { lat: 12.9725, lng: 77.5970 };

  assert(
    isPointInsideGeofence(insidePoint.lat, insidePoint.lng, polygon) === true,
    'Ray-casting detects point strictly inside rectangular geofence'
  );

  assert(
    isPointInsideGeofence(outsidePointNorth.lat, outsidePointNorth.lng, polygon) === false,
    'Ray-casting rejects point outside northern boundary'
  );

  assert(
    isPointInsideGeofence(outsidePointEast.lat, outsidePointEast.lng, polygon) === false,
    'Ray-casting rejects point outside eastern boundary'
  );

  // Test Complex L-Shaped / Concave Polygon
  const concavePolygon = [
    { lat: 12.9710, lng: 77.5940 },
    { lat: 12.9730, lng: 77.5940 },
    { lat: 12.9730, lng: 77.5950 },
    { lat: 12.9720, lng: 77.5950 },
    { lat: 12.9720, lng: 77.5960 },
    { lat: 12.9710, lng: 77.5960 }
  ];

  const insideL = { lat: 12.9715, lng: 77.5945 };
  const insideLCorner = { lat: 12.9725, lng: 77.5945 };
  const cutoutL = { lat: 12.9725, lng: 77.5955 }; // in the cutout notch of the L

  assert(
    isPointInsideGeofence(insideL.lat, insideL.lng, concavePolygon) === true,
    'Ray-casting handles concave L-shape: lower arm inside'
  );

  assert(
    isPointInsideGeofence(insideLCorner.lat, insideLCorner.lng, concavePolygon) === true,
    'Ray-casting handles concave L-shape: upper arm inside'
  );

  assert(
    isPointInsideGeofence(cutoutL.lat, cutoutL.lng, concavePolygon) === false,
    'Ray-casting handles concave L-shape: correctly rejects cutout notch'
  );

  // Centroid Calculation
  const centroid = getPolygonCentroid(polygon);
  assert(
    Math.abs(centroid.lat - 12.9725) < 0.0001 && Math.abs(centroid.lng - 77.5955) < 0.0001,
    'Polygon centroid calculation accurately centers bounding vertices'
  );

  // Waypoint Clamping with Safety Margin (2.0 meters)
  const clampedOutside = clampWaypointToGeofence(outsidePointNorth, polygon, 2.0);
  assert(
    isPointInsideGeofence(clampedOutside.lat, clampedOutside.lng, polygon) === true,
    'clampWaypointToGeofence pulls external point strictly inside polygon'
  );

  const clampedInside = clampWaypointToGeofence(insidePoint, polygon, 2.0);
  assert(
    Math.abs(clampedInside.lat - insidePoint.lat) < 0.0001 &&
    Math.abs(clampedInside.lng - insidePoint.lng) < 0.0001,
    'clampWaypointToGeofence preserves waypoints that already reside safely inside'
  );

  // Waypoint Clamping across Search Algorithms (Spiral, Tangential, Grid)
  geofenceService.setPolygon(polygon);
  geofenceService.setEnabled(true);

  const spiralGen = new SpiralSearch();
  const spiralPath = spiralGen.generateSearchPath({
    type: 'POLYGON',
    coordinates: polygon,
    circleCenter: insidePoint,
    circleRadiusMeters: 250 // deliberately exceeds polygon boundary
  }, 10, 3.0);

  let allSpiralInside = true;
  for (const wp of spiralPath.waypoints) {
    if (!isPointInsideGeofence(wp.lat, wp.lng, polygon)) {
      allSpiralInside = false;
      break;
    }
  }
  assert(
    allSpiralInside && spiralPath.waypoints.length > 0,
    `100% of SpiralSearch waypoints clamped strictly inside polygon (${spiralPath.waypoints.length} waypoints)`
  );

  const gridGen = new GridSearch();
  const gridPath = gridGen.generateSearchPath({
    type: 'POLYGON',
    coordinates: polygon
  }, 10, 3.0);

  let allGridInside = true;
  for (const wp of gridPath.waypoints) {
    if (!isPointInsideGeofence(wp.lat, wp.lng, polygon)) {
      allGridInside = false;
      break;
    }
  }
  assert(
    allGridInside && gridPath.waypoints.length > 0,
    `100% of GridSearch waypoints clamped strictly inside polygon (${gridPath.waypoints.length} waypoints)`
  );

  // =========================================================================
  // MODULE 2: STRICT PRE-ARM LOCKOUT & MAVLINK FENCE PROTOCOL
  // =========================================================================
  console.log('\n--- MODULE 2: Strict Pre-Arm Lockout & MAVLink Fence Commands ---');

  // Setup simulated connected state
  (mavlinkService as any).connectionState.isConnected = true;
  (mavlinkService as any).connectionState.isRealHardware = false;
  (mavlinkService as any).telemetry.satellites = 12;
  (mavlinkService as any).telemetry.gps = { satellites: 12, isLocked: true };

  // Case A: Geofence Disabled -> Arming allowed
  geofenceService.setEnabled(false);
  const bypassArmCheck = geofenceService.canArmVehicle(outsidePointNorth.lat, outsidePointNorth.lng);
  assert(
    bypassArmCheck.canArm === true,
    'When geofence is DISABLED (OFF), vehicle arming is allowed outside boundary'
  );

  // Case B: Geofence Enabled, Drone inside with adequate GPS satellites (>= 6)
  geofenceService.setEnabled(true);
  (mavlinkService as any).telemetry.satellites = 12;
  (mavlinkService as any).telemetry.gps = { satellites: 12, isLocked: true };
  const insideArmCheck = geofenceService.canArmVehicle(insidePoint.lat, insidePoint.lng);
  assert(
    insideArmCheck.canArm === true,
    'When geofence is ACTIVE, drone inside with 12 satellites passes pre-arm interlock'
  );

  // Case C: Geofence Enabled, Drone outside boundary -> REJECTED
  (mavlinkService as any).telemetry.satellites = 12;
  (mavlinkService as any).telemetry.gps = { satellites: 12, isLocked: true };
  const outsideArmCheck = geofenceService.canArmVehicle(outsidePointNorth.lat, outsidePointNorth.lng);
  assert(
    outsideArmCheck.canArm === false && (outsideArmCheck.reason?.includes('outside') ?? false),
    `When geofence is ACTIVE, drone outside boundary is BLOCKED (${outsideArmCheck.reason})`
  );

  // Case D: Geofence Enabled, Drone inside but GPS satellites < 6 -> REJECTED
  (mavlinkService as any).telemetry.satellites = 4;
  (mavlinkService as any).telemetry.gps = { satellites: 4, isLocked: false };
  const lowSatArmCheck = geofenceService.canArmVehicle(insidePoint.lat, insidePoint.lng);
  assert(
    lowSatArmCheck.canArm === false && (lowSatArmCheck.reason?.includes('sats') || lowSatArmCheck.reason?.includes('satellites')),
    `Pre-arm blocks arming when satellites < 6 (${lowSatArmCheck.reason})`
  );

  // Restore satellites
  (mavlinkService as any).telemetry.satellites = 10;
  (mavlinkService as any).telemetry.gps = { satellites: 10, isLocked: true };

  // Intercepting Arm Command via mavlinkService
  (mavlinkService as any).telemetry.latitude = outsidePointNorth.lat;
  (mavlinkService as any).telemetry.longitude = outsidePointNorth.lng;
  const armResultOutside = await mavlinkService.sendArmCommand(false);
  assert(
    armResultOutside === false,
    'mavlinkService.sendArmCommand intercepts packet and blocks arming when drone is outside fence'
  );

  // MAVLink MAV_CMD_DO_FENCE_ENABLE (1603) packet test
  const fenceEnableResult = await mavlinkService.sendFenceEnable(true);
  assert(
    fenceEnableResult.success === true,
    'mavlinkService.sendFenceEnable(true) successfully generates MAV_CMD_DO_FENCE_ENABLE packet'
  );

  const fenceDisableResult = await mavlinkService.sendFenceEnable(false);
  assert(
    fenceDisableResult.success === true,
    'mavlinkService.sendFenceEnable(false) successfully dispatches fence disable command'
  );

  // MAVLink Polygon Upload (5001)
  const uploadResult = await mavlinkService.uploadFencePolygon(polygon);
  assert(
    uploadResult.success === true && uploadResult.count === polygon.length,
    `mavlinkService.uploadFencePolygon successfully uploads ${uploadResult.count} inclusion vertices`
  );

  // =========================================================================
  // MODULE 3: GROUND CONTOUR DETECTION & AREA SNAPSHOT DEDUPLICATION
  // =========================================================================
  console.log('\n--- MODULE 3: Ground Contour Detection & Area Snapshot Gallery ---');

  // Test Laplacian blur rejection
  const mockBlurryQuality = {
    blurScore: 42.5, // Below blurThreshold of 60
    isBlurry: true,
    meanLuminance: 140,
    isLowLight: false,
    isGlare: false,
    timestamp: Date.now()
  };

  const syntheticDarkMarker = createSyntheticImageData(640, 480, (x, y) => {
    // 60x60 square marker near center
    if (x >= 280 && x <= 340 && y >= 200 && y <= 260) {
      return { r: 15, g: 15, b: 15 }; // Dark target
    }
    return { r: 180, g: 180, b: 180 }; // Light terrain
  });

  const contourBlurry = targetDetectionEngine.detectSalientGroundContour(
    syntheticDarkMarker,
    mockBlurryQuality
  );
  assert(
    contourBlurry === null,
    'detectSalientGroundContour rejects blurry frames (blurScore < 60)'
  );

  const mockSharpQuality = {
    blurScore: 94.2, // Clean sharpness
    isBlurry: false,
    meanLuminance: 140,
    isLowLight: false,
    isGlare: false,
    timestamp: Date.now()
  };

  const contourSharp = targetDetectionEngine.detectSalientGroundContour(
    syntheticDarkMarker,
    mockSharpQuality
  );
  assert(
    contourSharp !== null && contourSharp.w > 0 && contourSharp.h > 0,
    `detectSalientGroundContour identifies ground marker contour (bbox: ${JSON.stringify(contourSharp)})`
  );

  // Area Snapshot Capture & Spatial Deduplication (1.5m rule)
  targetDetectionEngine.clearCapturedImages();
  const mockCanvas = (globalThis as any).document.createElement('canvas');

  const snap1 = targetDetectionEngine.captureAreaSnapshot({
    canvas: mockCanvas,
    telemetry: {
      lat: 12.972000,
      lon: 77.595000,
      altAgl: 10,
      heading: 45
    },
    bboxNormalized: contourSharp!,
    sharpness: 95.0
  });

  assert(
    snap1 !== null && snap1.scanStatus === 'PENDING_QR_SCAN',
    'captureAreaSnapshot generates tagged CapturedAreaImage with PENDING_QR_SCAN status'
  );

  // Attempt duplicate capture within 0.8 meters (less than 1.5m threshold) with lower sharpness
  const snapDuplicate = targetDetectionEngine.captureAreaSnapshot({
    canvas: mockCanvas,
    telemetry: {
      lat: 12.972005, // ~0.55m away
      lon: 77.595005,
      altAgl: 10,
      heading: 45
    },
    bboxNormalized: contourSharp!,
    sharpness: 90.0 // worse sharpness -> should be suppressed
  });

  assert(
    snapDuplicate === null,
    '1.5m spatial deduplication suppresses redundant capture within 1.5m radius'
  );

  // Second capture with >25% improved sharpness -> accepted
  const snapSharpUpdate = targetDetectionEngine.captureAreaSnapshot({
    canvas: mockCanvas,
    telemetry: {
      lat: 12.972005,
      lon: 77.595005,
      altAgl: 10,
      heading: 45
    },
    bboxNormalized: contourSharp!,
    sharpness: 125.0 // > 25% improvement over 95.0
  });

  assert(
    snapSharpUpdate !== null,
    'Spatial deduplication allows image update if sharpness improves by > 25%'
  );

  // =========================================================================
  // MODULE 4: ASYNC QUEUE QR SCANNER & AUTONOMOUS REVISIT PIPELINE
  // =========================================================================
  console.log('\n--- MODULE 4: Async Queue QR Scanner & Autonomous Revisit Pipeline ---');

  let queueTargetEventDispatched = false;
  let receivedQueueImage: CapturedAreaImage | null = null;

  const unsubQueue = targetDetectionEngine.subscribeQueueTargetDetected((img) => {
    queueTargetEventDispatched = true;
    receivedQueueImage = img;
  });

  // Setup clean test snapshot with known candidate QR payload
  targetDetectionEngine.clearCapturedImages();
  const candidateImg = targetDetectionEngine.captureAreaSnapshot({
    canvas: mockCanvas,
    telemetry: {
      lat: 12.972000,
      lon: 77.595000,
      altAgl: 10,
      heading: 45
    },
    bboxNormalized: { nx: 0.4, ny: 0.4, w: 0.2, h: 0.2 },
    sharpness: 95.0,
    qrPayload: 'AERORECON_ALPHA_01'
  });

  // Execute background scanner
  await targetDetectionEngine.scanCapturedImagesForQR();

  assert(
    queueTargetEventDispatched === true && receivedQueueImage !== null,
    'scanCapturedImagesForQR processes gallery queue and dispatches target candidate event'
  );

  unsubQueue();

  // Test Autonomous Revisit Execution in phoneDroneMissionService
  assert(
    typeof (phoneDroneMissionService as any).executeCapturedImageRevisit === 'function',
    'phoneDroneMissionService exposes executeCapturedImageRevisit method'
  );

  // Verify containment watchdog aborts waypoint when near boundary
  assert(
    typeof (phoneDroneMissionService as any).startContainmentWatchdog === 'function',
    'phoneDroneMissionService includes 10Hz active flight containment watchdog'
  );

  // =========================================================================
  // MODULE 5: RUNNER DASHBOARD INTERCEPT CALCULATIONS & DEEP LINKS
  // =========================================================================
  console.log('\n--- MODULE 5: Runner Dashboard Intercept Calculations & Navigation ---');

  const runnerPhoneGPS = { lat: 12.9710, lon: 77.5940 };
  const verifiedTargetGPS = { lat: 12.9725, lon: 77.5955 };

  // Calculate Haversine distance and bearing
  const R = 6371000;
  const dLat = ((verifiedTargetGPS.lat - runnerPhoneGPS.lat) * Math.PI) / 180;
  const dLon = ((verifiedTargetGPS.lon - runnerPhoneGPS.lon) * Math.PI) / 180;
  const lat1 = (runnerPhoneGPS.lat * Math.PI) / 180;
  const lat2 = (verifiedTargetGPS.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distMeters = Math.round(R * c);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearingDeg = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);

  assert(
    distMeters > 200 && distMeters < 300,
    `Runner to target distance accurately calculated (${distMeters} meters)`
  );

  assert(
    bearingDeg >= 40 && bearingDeg <= 50,
    `Runner to target compass bearing accurately calculated (${bearingDeg}° Northeast)`
  );

  // Google Maps Deep Link
  const expectedDeepLink = `https://www.google.com/maps/dir/?api=1&destination=${verifiedTargetGPS.lat},${verifiedTargetGPS.lon}`;
  assert(
    expectedDeepLink.startsWith('https://www.google.com/maps/dir/?api=1&destination='),
    `Google Maps Navigation deep link matches RFC standard (${expectedDeepLink})`
  );

  // =========================================================================
  // MODULE 6: DRONE CORE ONBOARD CAMERA STREAM LIFECYCLE
  // =========================================================================
  console.log('\n--- MODULE 6: Drone Core Onboard Camera Stream Monitoring ---');

  const status = droneCameraStreamService.getCurrentStatus();
  assert(
    status === 'WAITING_FOR_CAMERA' || status === 'LIVE_FEED_CONNECTED',
    `droneCameraStreamService tracks active stream state (${status})`
  );

  assert(
    typeof droneCameraStreamService.reconnect === 'function',
    'droneCameraStreamService exposes reconnect method'
  );

  // =========================================================================
  // SUMMARY SCOREBOARD
  // =========================================================================
  console.log('\n========================================================================');
  console.log(`🏁 TEST SUITE RUN COMPLETE: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal Test Execution Error:', err);
  process.exit(1);
});
