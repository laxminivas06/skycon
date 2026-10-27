/**
 * SAE INDIA AUTONOMOUS MULTI-DIRECTIONAL GEOFENCE SEARCH,
 * TOP-DOWN CUBOID BOX & 2-DIGIT QR DECODER, ONBOARD WEBRTC & DUAL-PATH GCS TEST SUITE
 */

import { geofenceService } from '../frontend/src/services/geofenceService';
import { GridSearch } from '../frontend/src/services/searchEngine/GridSearch';
import { targetDetectionEngine } from '../frontend/src/services/targetDetectionEngine';
import { ipCameraService } from '../frontend/src/services/ipCameraService';
import { mavlinkService } from '../frontend/src/services/mavlinkService';
import { phoneDroneMissionService } from '../frontend/src/services/phoneDroneMissionService';
import { reconDetectionService } from '../frontend/src/services/reconDetectionService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion Failed: ${message}`);
  }
  console.log(`  ✓ [PASS] ${message}`);
}

async function runAllTests() {
  console.log('\n========================================================================');
  console.log('🛸 AUTONOMOUS MULTI-DIRECTIONAL SEARCH, CUBOID BOX & 2-DIGIT QR SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`  ❌ [FAIL] ${name}:`, e?.message || e);
    }
  };

  // --- MODULE 1: CONCAVE GEOFENCE CENTROID EDGE CASE & SAFE INTERIOR ANCHOR ---
  console.log('--- MODULE 1: Concave Polygon Geofence & Safe Interior Anchor ---');

  await test('getSafeInteriorAnchor finds interior point when centroid is in external cutout', () => {
    // Concave L-shaped polygon
    const lShapePolygon = [
      { lat: 12.9710, lng: 77.5920 }, // Bottom-left
      { lat: 12.9710, lng: 77.5930 }, // Bottom-right of foot
      { lat: 12.9720, lng: 77.5930 }, // Inner corner right
      { lat: 12.9720, lng: 77.5925 }, // Inner cutout corner
      { lat: 12.9730, lng: 77.5925 }, // Top-right of stalk
      { lat: 12.9730, lng: 77.5920 }  // Top-left of stalk
    ];

    // Mathematical centroid of this L-shape can fall near the outer corner or near the edge
    const interiorAnchor = geofenceService.getSafeInteriorAnchor(lShapePolygon);
    assert(interiorAnchor !== null, 'Interior anchor generated successfully');
    
    // Check that anchor is strictly inside the polygon
    const isInside = geofenceService.isPointInPolygon(interiorAnchor.lat, interiorAnchor.lng, lShapePolygon);
    assert(isInside, 'Safe interior anchor lies strictly INSIDE the concave polygon');

    // Check clearance to perimeter is positive
    const distToEdge = geofenceService.getDistanceToPerimeter(interiorAnchor.lat, interiorAnchor.lng, lShapePolygon);
    assert(distToEdge >= 2.0, `Safe interior anchor has >= 2.0m safety clearance (got ${distToEdge.toFixed(1)}m)`);
  });

  await test('clampWaypointToGeofence vectors outside waypoints toward safe interior anchor', () => {
    const lShapePolygon = [
      { lat: 12.9710, lng: 77.5920 },
      { lat: 12.9710, lng: 77.5930 },
      { lat: 12.9720, lng: 77.5930 },
      { lat: 12.9720, lng: 77.5925 },
      { lat: 12.9730, lng: 77.5925 },
      { lat: 12.9730, lng: 77.5920 }
    ];

    // Point in the cutout notch (outside the polygon)
    const notchPoint = { lat: 12.9725, lng: 77.5928 };
    assert(!geofenceService.isPointInPolygon(notchPoint.lat, notchPoint.lng, lShapePolygon), 'Test notch point is outside polygon');

    const clamped = geofenceService.clampWaypointToGeofence(notchPoint.lat, notchPoint.lng, lShapePolygon, 2.0);
    const clampedInside = geofenceService.isPointInPolygon(clamped.lat, clamped.lng, lShapePolygon);
    assert(clampedInside, 'Clamped waypoint is successfully pulled inside the polygon');
  });

  // --- MODULE 2: MULTI-DIRECTIONAL AUTONOMOUS GEOFENCE SEARCH ---
  console.log('\n--- MODULE 2: Multi-Directional Autonomous Geofence Search ---');

  await test('GridSearch generates Pass 1 (Primary) and Pass 2 (Cross-Grid 90°) waypoints strictly inside geofence', () => {
    const polygon = [
      { lat: 12.9710, lng: 77.5910 },
      { lat: 12.9710, lng: 77.5940 },
      { lat: 12.9730, lng: 77.5940 },
      { lat: 12.9730, lng: 77.5910 }
    ];

    const center = { lat: 12.9720, lng: 77.5925 };

    // 1. Primary Pass
    const primaryPath = GridSearch.generateSearchPath({
      center,
      radiusMeters: 100,
      boundingPolygon: polygon,
      targetAltitudeMeters: 12.0,
      gridSpacingMeters: 15.0,
      passDirection: 'PRIMARY'
    });
    assert(primaryPath.waypoints.length > 0, `Primary pass generated ${primaryPath.waypoints.length} waypoints`);

    // 2. Cross-Grid (90° rotated) Pass
    const crossPath = GridSearch.generateCrossGridSearchPath({
      center,
      radiusMeters: 100,
      boundingPolygon: polygon,
      targetAltitudeMeters: 12.0,
      gridSpacingMeters: 15.0
    });
    assert(crossPath.waypoints.length > 0, `Cross-Grid pass generated ${crossPath.waypoints.length} waypoints`);

    // 3. Multi-directional combined
    const multiPath = GridSearch.generateMultiDirectionalSearchPath({
      center,
      radiusMeters: 100,
      boundingPolygon: polygon,
      targetAltitudeMeters: 12.0,
      gridSpacingMeters: 15.0
    });
    assert(
      multiPath.waypoints.length === primaryPath.waypoints.length + crossPath.waypoints.length,
      `Multi-directional path combines Pass 1 & Pass 2 (${multiPath.waypoints.length} total waypoints)`
    );

    // Verify 100% containment of all multi-directional waypoints inside geofence with safety margin
    let allInside = true;
    for (const wp of multiPath.waypoints) {
      if (!geofenceService.isPointInPolygon(wp.lat, wp.lng, polygon)) {
        allInside = false;
        break;
      }
    }
    assert(allInside, '100% of Multi-Directional Search waypoints are strictly clamped inside polygon');
  });

  // --- MODULE 3: TOP-DOWN CUBOID BOX DETECTION & MULTI-SCALE 2-DIGIT QR DECODER ---
  console.log('\n--- MODULE 3: Top-Down Cuboid Box Detection & 2-Digit QR Decoder ---');

  await test('detectCuboidBoxAndQRContour rejects blurry frames (Laplacian variance < 60)', () => {
    // Blurry image mock: low contrast, low variance
    const width = 640;
    const height = 480;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 120;     // R
      data[i + 1] = 120; // G
      data[i + 2] = 120; // B
      data[i + 3] = 255; // A
    }

    const box = targetDetectionEngine.detectCuboidBoxAndQRContour(data, width, height, {
      droneLat: 12.9720,
      droneLon: 77.5925,
      altAgl: 12.0,
      headingDeg: 90
    });

    assert(box === null, 'Blurry/flat frame correctly rejected by Laplacian filter');
  });

  await test('detectCuboidBoxAndQRContour identifies sharp rectangular box contour', () => {
    const width = 640;
    const height = 480;
    const data = new Uint8ClampedArray(width * height * 4);

    // Fill with textured grass/dirt ground (mean lum ~95 with texture noise)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const textureNoise = ((x * 17 + y * 31) % 25) - 12;
        const val = Math.max(30, Math.min(130, 95 + textureNoise));
        data[idx] = val;
        data[idx + 1] = val + 5;
        data[idx + 2] = val - 5;
        data[idx + 3] = 255;
      }
    }

    // Draw a prominent quadrangle cuboid box top face near center (x: 280-360, y: 200-280)
    for (let y = 200; y < 280; y++) {
      for (let x = 280; x < 360; x++) {
        const idx = (y * width + x) * 4;
        // Bright white box top & QR label
        data[idx] = 245;
        data[idx + 1] = 245;
        data[idx + 2] = 245;
        data[idx + 3] = 255;
      }
    }

    const box = targetDetectionEngine.detectCuboidBoxAndQRContour(data, width, height, {
      droneLat: 12.9720,
      droneLon: 77.5925,
      altAgl: 12.0,
      headingDeg: 90
    });

    assert(box !== null, 'Cuboid box contour detected successfully');
    assert(box!.aspectRatio >= 0.5 && box!.aspectRatio <= 2.0, `Aspect ratio in valid cuboid range: ${box!.aspectRatio.toFixed(2)}`);
    assert(Math.abs(box!.normalizedCenterOffset.ex) < 0.3, `Center offset ex near zero: ${box!.normalizedCenterOffset.ex.toFixed(2)}`);
    assert(Math.abs(box!.normalizedCenterOffset.ey) < 0.3, `Center offset ey near zero: ${box!.normalizedCenterOffset.ey.toFixed(2)}`);
    assert(box!.estimatedGroundLat !== 0 && box!.estimatedGroundLon !== 0, 'Pinhole ground GPS coordinates estimated');
  });

  await test('decodeTwoDigitQR extracts strict and embedded 2-digit payloads', async () => {
    // 1. Strict 2-digit format
    const res1 = await targetDetectionEngine.decodeTwoDigitQR({ text: '42' });
    assert(res1.isValid && res1.twoDigitCode === '42', `Decoded strict "42" -> "${res1.twoDigitCode}"`);

    const res2 = await targetDetectionEngine.decodeTwoDigitQR({ text: '07' });
    assert(res2.isValid && res2.twoDigitCode === '07', `Decoded strict "07" -> "${res2.twoDigitCode}"`);

    // 2. Embedded 2-digit format
    const res3 = await targetDetectionEngine.decodeTwoDigitQR({ text: 'BOX-89' });
    assert(res3.isValid && res3.twoDigitCode === '89', `Decoded embedded "BOX-89" -> "${res3.twoDigitCode}"`);

    const res4 = await targetDetectionEngine.decodeTwoDigitQR({ text: 'ID:99_ALPHA' });
    assert(res4.isValid && res4.twoDigitCode === '99', `Decoded embedded "ID:99_ALPHA" -> "${res4.twoDigitCode}"`);

    // 3. Invalid non-numeric payload rejected
    const res5 = await targetDetectionEngine.decodeTwoDigitQR({ text: 'NO_DIGITS_HERE' });
    assert(!res5.isValid && res5.twoDigitCode === null, 'Non-digit payload rejected correctly');
  });

  // --- MODULE 4: ONBOARD WEBRTC EDGE CAMERA & HARDWARE ZOOM ---
  console.log('\n--- MODULE 4: Onboard WebRTC Edge Camera & Hardware Zoom ---');

  await test('ipCameraService supports ONBOARD_WEBRTC source mode and zoom controls', async () => {
    ipCameraService.setSourceMode('ONBOARD_WEBRTC');
    assert(ipCameraService.getSourceMode() === 'ONBOARD_WEBRTC', 'Camera source mode set to ONBOARD_WEBRTC');

    // Test zoom control
    const zoomResult = await ipCameraService.setCameraZoom(2.5);
    assert(zoomResult.zoomLevel === 2.5, `Camera zoom set to 2.5x (actual: ${zoomResult.zoomLevel}x, applied via ${zoomResult.appliedVia})`);

    // Test zoom clamping
    const clampHigh = await ipCameraService.setCameraZoom(10.0);
    assert(clampHigh.zoomLevel <= 4.0, `Camera zoom clamped to max 4.0x (got ${clampHigh.zoomLevel}x)`);

    const clampLow = await ipCameraService.setCameraZoom(0.2);
    assert(clampLow.zoomLevel >= 1.0, `Camera zoom clamped to min 1.0x (got ${clampLow.zoomLevel}x)`);
  });

  // --- MODULE 5: MAVLINK STATUSTEXT DOWNLINK & RETURN TO LAUNCH (RTL) ---
  console.log('\n--- MODULE 5: MAVLink STATUSTEXT Downlink & Return to Launch (RTL) ---');

  await test('mavlinkService packs and sends MAVLink message #253 STATUSTEXT', () => {
    const sent = mavlinkService.sendStatusText('QR_CODE_DETECTED: 42', 6);
    assert(sent, 'MAVLink STATUSTEXT message #253 dispatched successfully');
  });

  await test('phoneDroneMissionService handleRevisitVerificationComplete sets 2-digit code & triggers RTL', async () => {
    phoneDroneMissionService.reset();
    
    // Set mission in VERIFYING state
    (phoneDroneMissionService as any).state = 'VERIFYING';
    (phoneDroneMissionService as any).activeTarget = {
      eventId: 'TARGET_TEST_01',
      detectionMode: 'QR_CODE',
      payload: 'BOX-42',
      twoDigitCode: '42',
      confidence: 0.99,
      timestamp: Date.now(),
      thumbnailDataUrl: 'data:image/jpeg;base64,mock',
      dronePosition: { lat: 12.9720, lon: 77.5925, altAgl: 4.0, altMsl: 4.0, heading: 0 },
      estimatedTargetLocation: {
        targetLatitude: 12.97205,
        targetLongitude: 77.59255,
        droneLatitude: 12.9720,
        droneLongitude: 77.5925,
        droneAltitudeAgl: 4.0,
        headingDeg: 0,
        uncertaintyMeters: 0.5,
        isProjected: true,
        groundOffsetMeters: { dxForward: 5, dyRight: 5, distanceTotal: 7 }
      },
      frameQuality: { blurScore: 90, isBlurry: false, meanLuminance: 120, isLowLight: false, isGlare: false, contrastScore: 60 },
      boundingBox: { x: 300, y: 220, width: 80, height: 80 }
    };

    await phoneDroneMissionService.handleRevisitVerificationComplete(true);

    const progress = phoneDroneMissionService.getProgress();
    assert(progress.decodedTwoDigitCode === '42', `Progress reports decodedTwoDigitCode = "${progress.decodedTwoDigitCode}"`);
    assert(progress.state === 'RTL' || progress.state === 'MISSION_COMPLETE', `Mission state transitioned to RTL (actual: ${progress.state})`);
  });

  // --- MODULE 6: DUAL-PATH GCS SYNC & STORE-AND-FORWARD RETRY QUEUE ---
  console.log('\n--- MODULE 6: Dual-Path GCS Sync & Store-and-Forward Queue ---');

  await test('reconDetectionService stores detection and manages retry queue if offline', async () => {
    const record = reconDetectionService.recordDetection({
      detectionId: 'DET_TEST_42',
      payload: 'BOX-42',
      twoDigitCode: '42',
      droneLatitude: 12.97205,
      droneLongitude: 77.59255,
      photoDataUrl: 'data:image/jpeg;base64,mock',
      gpsFixValid: true
    });

    assert(record.twoDigitCode === '42', `Record contains 2-digit code "${record.twoDigitCode}"`);
    assert(record.status === 'QR_DECODED', `Record status is QR_DECODED (actual: ${record.status})`);
    assert(record.rtlInitiated === true, 'Record tracks rtlInitiated = true');

    const latest = reconDetectionService.getLatestDetection();
    assert(latest !== null && latest.twoDigitCode === '42', 'getLatestDetection() returns active 2-digit detection');
  });

  console.log('\n========================================================================');
  console.log(`🏁 TEST SUITE RUN COMPLETE: ${passed}/${passed + failed} Passed (${failed} Failed)`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('Fatal Test Runner Error:', e);
  process.exit(1);
});
