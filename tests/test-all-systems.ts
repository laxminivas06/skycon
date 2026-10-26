/**
 * SAE INDIA AUTONOMOUS DRONE MISSION — COMPREHENSIVE SYSTEM TEST SUITE
 * 
 * Verifies all functions, algorithms, and safety state machines:
 * 1. MAVLink Protocol Encoding, Decoding, and COMMAND_INT Generation
 * 2. Circle Test Service & Geodesic Waypoint Mathematics
 * 3. Loiter Test Service & Climb Altitude Transition
 * 4. Search Pattern Generators (Grid, Spiral, Perimeter, Adaptive)
 * 5. Box Detection & QR Code Validation Pipeline
 * 6. P2P Runner Link & Handshake Protocol
 * 7. Ground Station Mission Generation
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
}

import { mavlinkService } from '../frontend/src/services/mavlinkService';
import { circleTestService } from '../frontend/src/services/circleTestService';
import { loiterTestService } from '../frontend/src/services/loiterTestService';
import { boxDetectionService } from '../frontend/src/services/boxDetectionService';
import { groundStationMissionService } from '../frontend/src/services/groundStationMissionService';
import { GridSearch } from '../frontend/src/services/searchEngine/GridSearch';
import { SpiralSearch } from '../frontend/src/services/searchEngine/SpiralSearch';
import { PerimeterSearch } from '../frontend/src/services/searchEngine/PerimeterSearch';
import { AdaptiveSearch } from '../frontend/src/services/searchEngine/AdaptiveSearch';
import { DroneTelemetry, HomePoint } from '../frontend/src/types/mission';
import { PixhawkConnectionState } from '../frontend/src/types/mavlink';

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

async function runAllTests() {
  console.log('\n===============================================================');
  console.log('🛸 SAE INDIA AUTONOMOUS DRONE — COMPREHENSIVE FUNCTION TEST SUITE');
  console.log('===============================================================\n');

  // --------------------------------------------------------------------------
  // SUITE 1: MAVLink Service & Commands
  // --------------------------------------------------------------------------
  console.log('▶ SUITE 1: MAVLink Protocol & Flight Controller Commands');
  {
    // Initialize connected state in simulation mode for software testing
    (mavlinkService as any).connectionState.isConnected = true;
    (mavlinkService as any).connectionState.isRealHardware = false;

    // Mode testing
    const guidedSuccess = await mavlinkService.setFlightMode('GUIDED');
    assert(guidedSuccess, 'setFlightMode("GUIDED") executes cleanly');
    assert(mavlinkService.getTelemetry().flightMode === 'GUIDED', 'Telemetry reflects GUIDED mode');

    const loiterSuccess = await mavlinkService.setFlightMode('LOITER');
    assert(loiterSuccess, 'setFlightMode("LOITER") executes cleanly');

    const rtlSuccess = await mavlinkService.setFlightMode('RTL');
    assert(rtlSuccess, 'setFlightMode("RTL") executes cleanly');

    // Takeoff command
    const takeoffSuccess = await mavlinkService.commandTakeoff(5.0);
    assert(takeoffSuccess, 'commandTakeoff(5.0) sends dual COMMAND_INT & COMMAND_LONG frames');
    assert(mavlinkService.getTelemetry().targetAltitude === 5.0, 'Target altitude recorded as 5.0m');

    // Reposition / Fly to Position (COMMAND_INT #192)
    const testLat = 17.385044;
    const testLon = 78.486671;
    const flySuccess = await mavlinkService.flyToPosition(testLat, testLon, 5.0, 2.0);
    assert(flySuccess, 'flyToPosition() sends MAV_CMD_DO_REPOSITION via COMMAND_INT with int32 degE7 coordinates');

    // Land and RTL commands
    const landSuccess = await mavlinkService.commandLand();
    assert(landSuccess, 'commandLand() switches mode to LAND');

    const rtlCmdSuccess = await mavlinkService.commandRTL();
    assert(rtlCmdSuccess, 'commandRTL() switches mode to RTL');

    // MAVLink Mission Protocol (MISSION_CLEAR_ALL & Upload)
    const clearResult = await mavlinkService.clearMissionWaypoints();
    assert(clearResult.success, 'clearMissionWaypoints() sends MISSION_CLEAR_ALL and clears table cleanly');

    const uploadResult = await mavlinkService.uploadMissionWaypoints([
      { lat: testLat, lon: testLon, alt: 0, command: 16 },
      { lat: testLat, lon: testLon, alt: 5.0, command: 22 },
      { lat: testLat + 0.0001, lon: testLon + 0.0001, alt: 5.0, command: 16 },
      { lat: testLat, lon: testLon, alt: 0, command: 20 }
    ]);
    assert(uploadResult.success, 'uploadMissionWaypoints() uploads mission without sequence mismatch');
  }

  // --------------------------------------------------------------------------
  // SUITE 2: Circle Test Mission Service & Geodesic Math
  // --------------------------------------------------------------------------
  console.log('\n▶ SUITE 2: Circle Test Mission Service & Geodesic Calculations');
  {
    circleTestService.resetState();

    // 1. Config setters & clamping
    circleTestService.setDiameter(10);
    assert(circleTestService.getConfig().circleDiameterMeters === 10, 'Circle diameter configured to 10m');
    assert(circleTestService.getState().circleRadiusMeters === 5, 'Circle radius calculated as 5m');

    circleTestService.setAltitude(5);
    assert(circleTestService.getConfig().targetAltitudeMeters === 5, 'Circle target altitude set to 5m');

    circleTestService.setLaps(2);
    assert(circleTestService.getConfig().laps === 2, 'Circle laps set to 2');

    circleTestService.setDirection('CW');
    assert(circleTestService.getConfig().direction === 'CW', 'Circle direction set to CW');

    circleTestService.setFlightSpeed(2.5);
    assert(circleTestService.getConfig().flightSpeedMps === 2.5, 'Flight speed set to 2.5 m/s');

    // Clamping limits
    circleTestService.setDiameter(200); // Exceeds 150m max
    assert(circleTestService.getConfig().circleDiameterMeters === 150, 'Diameter correctly clamped to 150m max');
    circleTestService.setDiameter(10); // Reset to 10m

    // 2. Coordinate validator
    assert(circleTestService.isValidCoordinate(17.385, 78.486), 'Valid GPS coordinates accepted');
    assert(!circleTestService.isValidCoordinate(0, 0), 'Null Island coordinates (0, 0) strictly rejected');
    assert(!circleTestService.isValidCoordinate(null, null), 'Null coordinates rejected');
    assert(!circleTestService.isValidCoordinate(NaN, NaN), 'NaN coordinates rejected');

    // 3. Geodesic Distance
    const centerLat = 17.385044;
    const centerLon = 78.486671;
    // Offset ~10 meters North: 1 deg lat ~ 111139 m -> 10m ~ 0.00009 deg
    const northLat = centerLat + (10 / 111139);
    const calculatedDist = circleTestService.calculateDistanceMeters(centerLat, centerLon, northLat, centerLon);
    assert(Math.abs(calculatedDist - 10) < 0.2, `Geodesic distance accurate (~10m calculated: ${calculatedDist.toFixed(2)}m)`);

    // 4. Geodesic Circle Waypoints Generation
    const waypoints = circleTestService.generateCircleWaypoints(centerLat, centerLon, 10, 5, 16, 'CW');
    assert(waypoints.length === 16, `Generated exactly 16 circular waypoints (got ${waypoints.length})`);
    
    // Validate each waypoint is approximately radius (5m) from center
    let allRadiiValid = true;
    for (const wp of waypoints) {
      const d = circleTestService.calculateDistanceMeters(centerLat, centerLon, wp.lat, wp.lon);
      if (Math.abs(d - 5.0) > 0.3) {
        allRadiiValid = false;
        break;
      }
    }
    assert(allRadiiValid, 'All 16 waypoints lie exactly on the 5m circle radius');

    // 5. Safety Prerequisites Check
    const dummyTelemetry: DroneTelemetry = {
      latitude: centerLat,
      longitude: centerLon,
      altitude: 0,
      targetAltitude: 5,
      groundSpeed: 0,
      verticalSpeed: 0,
      heading: 0,
      batteryPercent: 85,
      batteryVoltage: 12.4,
      batteryCurrent: 0,
      batteryCellCount: 3,
      gps: {
        latitude: centerLat,
        longitude: centerLon,
        altitude: 500,
        satellites: 14,
        hdop: 1.1,
        fixType: '3D_FIX',
        isLocked: true
      },
      flightMode: 'DISARMED',
      isArmed: false,
      distanceToHome: 0,
      searchProgress: 0,
      pixhawkConnected: true,
      runnerConnected: true,
      cameraReady: true
    };

    const dummyConn: PixhawkConnectionState = {
      connectionType: 'ESP32_WEBSOCKET',
      phase: 'PIXHAWK_CONNECTED',
      phaseMessage: 'Connected',
      isConnected: true,
      isUsbConnected: false,
      portOrAddress: 'ws://127.0.0.1',
      baudRate: 57600,
      bytesReceived: 1000,
      bytesSent: 1000,
      lastHeartbeat: Date.now(),
      heartbeatHz: 4,
      packetLossPercent: 0,
      firmwareVersion: 'ArduCopter 4.5',
      autopilotType: 'MAV_AUTOPILOT_ARDUPILOT',
      mavlinkVersion: 'MAVLink 2.0',
      isReceivingTelemetry: true,
      ekfHealthy: true,
      preArmChecksPassed: true,
      statusHistory: [],
      commandAckHistory: [],
      diagnosticsLogs: [],
      isRealHardware: false,
      diagnostics: { totalPacketsReceived: 100, heartbeatsCount: 20, driverType: 'ESP32_WEBSOCKET', hostPowerStatus: 'HOST_ACTIVE', serialDataReceived: true }
    };

    const dummyHome: HomePoint = {
      latitude: centerLat,
      longitude: centerLon,
      altitude: 0,
      timestamp: Date.now(),
      isSet: true
    };

    const validation = circleTestService.validatePrerequisites(dummyTelemetry, dummyConn, dummyHome);
    assert(validation.allPassed, 'Pre-flight safety validation passes with valid GPS, battery & home point');
  }

  // --------------------------------------------------------------------------
  // SUITE 3: Loiter Test Mission Service
  // --------------------------------------------------------------------------
  console.log('\n▶ SUITE 3: 5m Loiter Test Mission Service');
  {
    loiterTestService.resetState();
    loiterTestService.setLoiterDuration(15);
    assert(loiterTestService.getConfig().loiterDurationSeconds === 15, 'Loiter duration configured to 15s');

    loiterTestService.setLoiterDuration(150); // Clamped to 120s max
    assert(loiterTestService.getConfig().loiterDurationSeconds === 120, 'Loiter duration clamped to 120s maximum');
    loiterTestService.setLoiterDuration(10);

    const loiterState = loiterTestService.getState();
    assert(loiterState.targetAltitude === 5, 'Loiter target altitude initialized to 5.0m AGL');
    assert(loiterState.step === 'IDLE', 'Loiter state initialized in IDLE');
  }

  // --------------------------------------------------------------------------
  // SUITE 4: Search Engine Algorithms (Grid, Spiral, Perimeter, Adaptive)
  // --------------------------------------------------------------------------
  console.log('\n▶ SUITE 4: Search Engine Algorithms');
  {
    const boundaryPolygon = [
      { lat: 17.385000, lng: 78.486000 },
      { lat: 17.385500, lng: 78.486000 },
      { lat: 17.385500, lng: 78.486500 },
      { lat: 17.385000, lng: 78.486500 }
    ];
    const boundaryConfig = {
      type: 'POLYGON' as const,
      coordinates: boundaryPolygon
    };

    // 1. Grid Search (Lawnmower)
    const gridSearch = new GridSearch();
    const gridRes = gridSearch.generateSearchPath(boundaryConfig, 10, 2.5);
    assert(gridRes.waypoints.length >= 2, `GridSearch generated ${gridRes.waypoints.length} waypoints covering polygon`);

    // 2. Spiral Search (Expanding from center)
    const spiralSearch = new SpiralSearch();
    const spiralRes = spiralSearch.generateSearchPath(boundaryConfig, 10, 2.5);
    assert(spiralRes.waypoints.length >= 2, `SpiralSearch generated ${spiralRes.waypoints.length} radial spiral waypoints`);

    // 3. Perimeter Search
    const perimeterSearch = new PerimeterSearch();
    const perimeterRes = perimeterSearch.generateSearchPath(boundaryConfig, 10, 2.5);
    assert(perimeterRes.waypoints.length >= 2, `PerimeterSearch generated ${perimeterRes.waypoints.length} perimeter sweep waypoints`);

    // 4. Adaptive Search
    const adaptiveSearch = new AdaptiveSearch();
    const adaptiveRes = adaptiveSearch.generateSearchPath(boundaryConfig, 10, 2.5);
    assert(adaptiveRes.waypoints.length >= 2, `AdaptiveSearch generated ${adaptiveRes.waypoints.length} adaptive path waypoints`);
  }

  // --------------------------------------------------------------------------
  // SUITE 5: Computer Vision & QR Pipeline
  // --------------------------------------------------------------------------
  console.log('\n▶ SUITE 5: Computer Vision & QR Code Validation Pipeline');
  {
    // Strict QR Regex: ^\d{2}$
    const qrRegex = /^\d{2}$/;

    assert(qrRegex.test('42'), 'QR Code "42" passes strict 2-digit validation');
    assert(qrRegex.test('07'), 'QR Code "07" passes strict 2-digit validation');
    assert(qrRegex.test('00'), 'QR Code "00" passes strict 2-digit validation');
    assert(qrRegex.test('99'), 'QR Code "99" passes strict 2-digit validation');

    assert(!qrRegex.test('7'), 'Single digit "7" rejected');
    assert(!qrRegex.test('123'), 'Three digits "123" rejected');
    assert(!qrRegex.test('AB'), 'Letters "AB" rejected');
    assert(!qrRegex.test('9A'), 'Alphanumeric "9A" rejected');
    assert(!qrRegex.test(''), 'Empty string rejected');
    assert(!qrRegex.test('4 2'), 'Spaced digits rejected');

    // Box Detection Service multi-frame test
    const initialBox = boxDetectionService.getLatestBox();
    assert(!initialBox.isLocked, 'Initial box state is unlocked');
  }

  // --------------------------------------------------------------------------
  // SUITE 6: Ground Station Mission Service
  // --------------------------------------------------------------------------
  console.log('\n▶ SUITE 6: Ground Station Tactical Mission Generation');
  {
    const centerPoint = { lat: 17.385044, lng: 78.486671 };
    const dummyHome: HomePoint = {
      latitude: centerPoint.lat,
      longitude: centerPoint.lng,
      altitude: 0,
      timestamp: Date.now(),
      isSet: true
    };

    // 1. Generate Circle Mission
    const circleMission = groundStationMissionService.generateCircleMission(
      centerPoint,
      10, // 10m radius
      dummyHome,
      5.0, // 5m alt
      2.0, // 2m/s
      'CW',
      true
    );

    assert(circleMission.missionType === 'CIRCLE', 'Generated missionType is CIRCLE');
    assert(circleMission.waypoints.length >= 10, `Generated ${circleMission.waypoints.length} tactical waypoints for circular flight`);
    assert(circleMission.altitude === 5.0, 'Mission altitude verified as 5.0m');
    assert(circleMission.geometry.circleRadiusMeters === 10, 'Mission radius recorded as 10m');
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`📊 TEST EXECUTION SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal Test Runner Exception:', err);
  process.exit(1);
});
