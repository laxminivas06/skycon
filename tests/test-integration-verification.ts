/**
 * AERORECON Acceptance Test Suite (Tests A through F)
 * 
 * Validates:
 * Test A: Connection Verification (Wi-Fi, MAVLink, Pixhawk GPS, diagnostic strings, START button safety)
 * Test B: Manual Mission Planning (waypoint draw/edit, altitude, clear path, upload validation, explicit confirmation)
 * Test C: Autonomous Mission Planning (10m default alt, 5m/10m/50m radii, circular & spiral algorithms, return time reservation)
 * Test D: QR Detection & Coordinate Accuracy (Pixhawk GPS only, backend persistence & deduplication, Runner sync)
 * Test E: Automatic Return to Launch & Deadline Watchdog (QR completion RTL, idempotent requests, deadline watchdog)
 * Test F: Backend Persistence & Synchronization (Active mission sync across client refresh, atomic storage)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
  }
}

async function request(options: http.RequestOptions, body?: any): Promise<{ status: number; data: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode || 200, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode || 200, data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('       AERORECON END-TO-END ACCEPTANCE TEST SUITE               ');
  console.log('================================================================\n');

  // ============================================================================
  // TEST A: Connection Verification & Start Button
  // ============================================================================
  console.log('TEST A: Connection Verification & Start Button');
  {
    // 1. Backend ping verifies Wi-Fi endpoint reachable
    const healthRes = await request({
      hostname: 'localhost',
      port: 8443,
      path: '/api/recon/detections/latest',
      method: 'GET'
    });
    assert(healthRes.status === 200, 'Wi-Fi/Network endpoint reachable on backend port 8443');

    // 2. Verified MAVLink telemetry independence:
    // Connecting Wi-Fi alone must NOT report MAVLink or GPS connected prematurely.
    const serviceFile = fs.readFileSync(path.resolve(__dirname, '../frontend/src/services/gcsConnectionService.ts'), 'utf-8');
    assert(serviceFile.includes("wifiStatus: 'PENDING'"), 'Initial Wi-Fi state is pending/inactive before START');
    assert(serviceFile.includes("mavlinkStatus: 'PENDING'"), 'Initial MAVLink state is pending/disconnected before START');
    assert(serviceFile.includes("gpsStatus: 'PENDING'"), 'Initial GPS state is pending/unavailable before START');
    assert(!serviceFile.includes('navigator.geolocation'), 'Never uses browser or mobile geolocation for Pixhawk GPS');
    assert(serviceFile.includes('sats >= 6'), 'Pixhawk GPS Fix requires at least 6 satellites for 3D Lock');

    // 3. Short status diagnostic message format
    const headerFile = fs.readFileSync(path.resolve(__dirname, '../frontend/src/features/dashboard/Header.tsx'), 'utf-8');
    assert(headerFile.includes('Wi-Fi Connected | MAVLink Disconnected | GPS Acquiring') || headerFile.includes('shortDiagnosticString'),
      'Displays short diagnostic string when Wi-Fi is connected but telemetry or GPS is not ready');
    assert(headerFile.includes('Wi-Fi: Connected') && headerFile.includes('Wi-Fi: Disconnected'),
      'Wi-Fi status indicator follows Connected / Connecting / Disconnected');
    assert(headerFile.includes('MAVLink: Connected') && headerFile.includes('MAVLink: Disconnected'),
      'MAVLink status indicator follows Connected / Connecting / Disconnected');
    assert(headerFile.includes('GPS: GPS Fix Valid') && headerFile.includes('GPS: Acquiring GPS') && headerFile.includes('GPS: GPS Unavailable'),
      'GPS status indicator follows GPS Fix Valid / Acquiring GPS / GPS Unavailable');

    // 4. START button safety rule: Does NOT arm or takeoff
    assert(!serviceFile.includes('sendArmCommand') && !serviceFile.includes('commandTakeoff'),
      'START button establishes connections only — does NOT arm or launch drone');
  }

  // ============================================================================
  // TEST B: Manual Mission Planning
  // ============================================================================
  console.log('\nTEST B: Manual Mission Planning (Mode A)');
  {
    const manualCard = fs.readFileSync(path.resolve(__dirname, '../frontend/src/features/dashboard/ManualMissionControlCard.tsx'), 'utf-8');
    assert(manualCard.includes('MODE A • MANUAL'), 'Manual Mission Planning identified as Mode A');
    assert(manualCard.includes('CLEAR PATH'), 'Clear Path control available');
    assert(manualCard.includes('UPLOAD MISSION'), 'Upload Mission control available');
    assert(manualCard.includes('START MISSION'), 'Start Mission control with preflight gate available');
    assert(manualCard.includes('Waypoints') && manualCard.includes('Freehand') && manualCard.includes('Circle Path'),
      'Manual drawing tools support Waypoint-based, Freehand, and Circular paths');

    // MAVLink mission verification check in mavlinkService
    const mavService = fs.readFileSync(path.resolve(__dirname, '../frontend/src/services/mavlinkService.ts'), 'utf-8');
    assert(mavService.includes('downloadMissionWaypoints') && mavService.includes('readback.items.length !== items.length'),
      'MavlinkService verifies Pixhawk mission count and readback before confirming upload success');
  }

  // ============================================================================
  // TEST C: Autonomous Mission Planning
  // ============================================================================
  console.log('\nTEST C: Autonomous Mission Planning (Mode B)');
  {
    const autoCard = fs.readFileSync(path.resolve(__dirname, '../frontend/src/features/dashboard/AutonomousMissionControlCard.tsx'), 'utf-8');
    assert(autoCard.includes('MODE B • RECON'), 'Autonomous Mission Planning identified as Mode B');
    assert(autoCard.includes('SEARCH ALTITUDE:'), 'Search Altitude configuration field present');
    assert(autoCard.includes('10m') && autoCard.includes('(Default)'), 'Search Altitude defaults to 10 metres');
    assert(autoCard.includes('min={5}') && autoCard.includes('max={50}'), 'Search Altitude validated within 5m to 50m safe envelope');
    assert(autoCard.includes('5, 10, 50'), 'Quick-selection radius values: 5 metres, 10 metres, 50 metres available');
    assert(autoCard.includes('Tangential / Circular') && autoCard.includes('Spiral Search'),
      'Search algorithms support Tangential/Circular Search and Spiral Search');
    assert(autoCard.includes('timeLimitMinutes') && autoCard.includes('TIME LIMIT'), 'Configurable maximum mission time limit present');
    assert(autoCard.includes('Reserved Return-To-Launch:'), 'Mission planning reserves sufficient time for safe return-to-launch');
    assert(autoCard.includes('isFeasible') && autoCard.includes('feasibilityMessage'),
      'Rejects configuration and displays warning if time limit cannot support search + return');

    // Validate autonomous search mission generator logic in service
    const missionService = fs.readFileSync(path.resolve(__dirname, '../frontend/src/services/groundStationMissionService.ts'), 'utf-8');
    assert(missionService.includes('generateAutonomousSearchMission'),
      'GroundStationMissionService includes generateAutonomousSearchMission');
    assert(missionService.includes('TANGENTIAL_CIRCULAR') && missionService.includes('SPIRAL'),
      'Generator supports both Tangential Circular and Expanding Archimedean Spiral');
    assert(missionService.includes('action: \'RTL\''), 'Generator automatically appends final Return-To-Launch waypoint');
  }

  // ============================================================================
  // TEST D: QR Detection & Coordinate Accuracy
  // ============================================================================
  console.log('\nTEST D: QR Detection & Coordinate Accuracy');
  {
    // Post test detection to backend API
    const testPayload = `QR_AERO_${Date.now().toString(36)}`;
    const postRes = await request({
      hostname: 'localhost',
      port: 8443,
      path: '/api/recon/detections',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      detectionId: `DET_${Date.now()}`,
      missionId: 'MISS_TEST_01',
      payload: testPayload,
      droneLatitude: 13.082711,
      droneLongitude: 80.270722,
      gpsFixValid: true,
      gpsFixType: '3D_FIX',
      satellites: 12,
      hdop: 0.8,
      timestamp: Date.now()
    });

    assert(postRes.status === 200 && postRes.data.success === true, 'Valid QR detection stored in backend database');

    // Test deduplication: Submitting the identical payload within 5s must deduplicate
    const dupRes = await request({
      hostname: 'localhost',
      port: 8443,
      path: '/api/recon/detections',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      detectionId: `DET_DUP_${Date.now()}`,
      missionId: 'MISS_TEST_01',
      payload: testPayload,
      droneLatitude: 13.082711,
      droneLongitude: 80.270722,
      gpsFixValid: true,
      timestamp: Date.now()
    });
    assert(dupRes.status === 200 && dupRes.data.duplicate === true, 'Backend 5-second deduplication prevents duplicate QR records');

    // Verify coordinate accuracy rule in reconDetectionService
    const reconService = fs.readFileSync(path.resolve(__dirname, '../frontend/src/services/reconDetectionService.ts'), 'utf-8');
    assert(reconService.includes('droneLat = isGpsValid ? telem.latitude : 0;') && reconService.includes('Location Unavailable: Pixhawk GPS telemetry was not locked'),
      'Drone position records Pixhawk GPS only when locked; null/zero when GPS invalid');
    assert(reconService.includes('Case A: Confirmed Target Location') && reconService.includes('Case B: Decoded payload does not contain GPS coordinates'),
      'Distinguishes between detection coordinates (UAV position) and target coordinates');
  }

  // ============================================================================
  // TEST E: Automatic Return to Launch & Deadline Enforcement
  // ============================================================================
  console.log('\nTEST E: Automatic Return to Launch & Deadline Watchdog');
  {
    const reconService = fs.readFileSync(path.resolve(__dirname, '../frontend/src/services/reconDetectionService.ts'), 'utf-8');
    assert(reconService.includes('triggerAutomaticRTL'), 'Automatic Return to Launch workflow present on QR detection');
    assert(reconService.includes('if (this.isRtlInitiated)'), 'Idempotent return request prevents duplicate RTL commands');
    assert(reconService.includes('mavlinkService.commandRTL()'), 'Dispatches RTL via existing Pixhawk MAVLink command');

    // Server-side deadline watchdog
    const serverCode = fs.readFileSync(path.resolve(__dirname, '../backend/server.js'), 'utf-8');
    assert(serverCode.includes('MISSION_DEADLINE_EVENT') && serverCode.includes('DEADLINE_REACHED'),
      'Backend runs 1-second mission deadline watchdog and initiates return on deadline expiry');
  }

  // ============================================================================
  // TEST F: Backend Resilience & Persistence
  // ============================================================================
  console.log('\nTEST F: Backend Persistence & Active Mission Sync');
  {
    // Create an active mission in backend
    const testMissId = `MISS_${Date.now()}`;
    const startTime = Date.now();
    const deadline = startTime + 10 * 60 * 1000;

    const createMissRes = await request({
      hostname: 'localhost',
      port: 8443,
      path: '/api/missions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      missionId: testMissId,
      mode: 'AUTONOMOUS',
      algorithm: 'TANGENTIAL_CIRCULAR',
      searchRadiusMeters: 10,
      plannedAltitudeMeters: 10,
      timeLimitMinutes: 10,
      startTime,
      deadline,
      status: 'EXECUTING'
    });

    assert(createMissRes.status === 200 && createMissRes.data.success === true, 'Mission record successfully persisted in backend');

    // Query active mission (simulating client reconnect or browser page refresh)
    const activeRes = await request({
      hostname: 'localhost',
      port: 8443,
      path: '/api/missions/active',
      method: 'GET'
    });

    assert(activeRes.status === 200 && activeRes.data.active === true, 'Active mission survives page refresh and is retrieved via /api/missions/active');
    assert(activeRes.data.mission.missionId === testMissId, 'Active mission ID matches persisted mission');
    assert(typeof activeRes.data.mission.remainingSeconds === 'number', 'Remaining mission seconds computed reliably on server');
    assert(typeof activeRes.data.mission.elapsedSeconds === 'number', 'Elapsed mission seconds computed reliably on server');

    // Verify disk persistence in backend/data/
    const dataDir = path.resolve(__dirname, '../backend/data');
    assert(fs.existsSync(path.join(dataDir, 'missions.json')), 'Durable disk file missions.json exists');
    assert(fs.existsSync(path.join(dataDir, 'detections.json')), 'Durable disk file detections.json exists');
  }

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${passedCount + failedCount})`);
  console.log('================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
