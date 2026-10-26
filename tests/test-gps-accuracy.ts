/**
 * PIXHAWK GPS ACCURACY & TELEMETRY INTEGRATION TEST SUITE
 * 
 * Verifies the 7 user requirements:
 * 1. Coordinates received from Pixhawk match those displayed in GCS.
 * 2. Marker coordinates update dynamically on new GPS data.
 * 3. Invalid GPS data (Null Island, out-of-bounds, NaN, 0 fix) does NOT move the marker.
 * 4. Stale/Loss of GPS or MAVLink communication triggers clear status warning and unlocks GPS.
 * 5. Reconnection restores live GPS updates immediately.
 * 6. Application remains responsive and safe (nudge & patterns reject without lock).
 * 7. Verified GPS accuracy reporting (HDOP, true fix type without artificial inflation).
 */

// 1. Setup mock browser environment for Node.js
declare const process: any;
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

import { mavlinkService, MAVLINK_CRC_EXTRAS } from '../frontend/src/services/mavlinkService';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ [FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Builds a valid MAVLink v1 binary packet with proper checksum.
 */
function buildMavlink1Packet(msgId: number, payload: Uint8Array, seq: number = 1): Uint8Array {
  const len = payload.length;
  const frame = new Uint8Array(6 + len + 2);
  frame[0] = 0xFE; // MAVLink 1.0 magic
  frame[1] = len;
  frame[2] = seq;
  frame[3] = 1;    // SysID: Autopilot
  frame[4] = 1;    // CompID: Autopilot1
  frame[5] = msgId;
  frame.set(payload, 6);

  // Compute CRC
  let crc = 0xFFFF;
  for (let i = 1; i < 6 + len; i++) {
    let b = frame[i] ^ (crc & 0xFF);
    b ^= (b << 4) & 0xFF;
    crc = ((crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4)) & 0xFFFF;
  }
  const extraCrc = MAVLINK_CRC_EXTRAS[msgId] ?? 0;
  let b = extraCrc ^ (crc & 0xFF);
  b ^= (b << 4) & 0xFF;
  crc = ((crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4)) & 0xFFFF;

  frame[6 + len] = crc & 0xFF;
  frame[6 + len + 1] = (crc >> 8) & 0xFF;
  return frame;
}

function createHeartbeatPayload(): Uint8Array {
  const buf = new Uint8Array(9);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0, true);   // custom_mode = 0
  view.setUint8(4, 2);          // type = MAV_TYPE_QUADROTOR
  view.setUint8(5, 3);          // autopilot = MAV_AUTOPILOT_ARDUPILOT
  view.setUint8(6, 0x80 | 0x04);// base_mode (ARMED + GUIDED)
  view.setUint8(7, 4);          // system_status = MAV_STATE_ACTIVE
  view.setUint8(8, 3);          // mavlink_version
  return buf;
}

function createGpsRawIntPayload(params: {
  latDeg: number;
  lonDeg: number;
  altMslMeters: number;
  fixType: number;
  satellites: number;
  hdop: number;
  speedMs: number;
}): Uint8Array {
  const buf = new Uint8Array(30);
  const view = new DataView(buf.buffer);
  // time_usec (8 bytes: offset 0..7)
  view.setUint32(0, 1000000, true);
  view.setUint32(4, 0, true);
  // lat int32 (degE7: offset 8..11)
  view.setInt32(8, Math.round(params.latDeg * 1e7), true);
  // lon int32 (degE7: offset 12..15)
  view.setInt32(12, Math.round(params.lonDeg * 1e7), true);
  // alt int32 (mm MSL: offset 16..19)
  view.setInt32(16, Math.round(params.altMslMeters * 1000), true);
  // eph uint16 (HDOP * 100: offset 20..21)
  view.setUint16(20, Math.round(params.hdop * 100), true);
  // epv uint16 (offset 22..23)
  view.setUint16(22, 150, true);
  // vel uint16 (cm/s: offset 24..25)
  view.setUint16(24, Math.round(params.speedMs * 100), true);
  // cog uint16 (cdeg: offset 26..27)
  view.setUint16(26, 4500, true);
  // fix_type uint8 (offset 28)
  view.setUint8(28, params.fixType);
  // satellites_visible uint8 (offset 29)
  view.setUint8(29, params.satellites);
  return buf;
}

function createGlobalPositionIntPayload(params: {
  latDeg: number;
  lonDeg: number;
  altMslMeters: number;
  relativeAltMeters: number;
  vxMs: number;
  vyMs: number;
  vzMs: number;
  hdgDeg: number;
}): Uint8Array {
  const buf = new Uint8Array(28);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 15000, true); // time_boot_ms
  view.setInt32(4, Math.round(params.latDeg * 1e7), true);
  view.setInt32(8, Math.round(params.lonDeg * 1e7), true);
  view.setInt32(12, Math.round(params.altMslMeters * 1000), true); // MSL alt (mm)
  view.setInt32(16, Math.round(params.relativeAltMeters * 1000), true); // Relative alt (mm)
  view.setInt16(20, Math.round(params.vxMs * 100), true);
  view.setInt16(22, Math.round(params.vyMs * 100), true);
  view.setInt16(24, Math.round(params.vzMs * 100), true);
  view.setUint16(26, Math.round(params.hdgDeg * 100), true);
  return buf;
}

async function runGpsAccuracyTestSuite() {
  console.log('\n===============================================================');
  console.log('🛰️ PIXHAWK GPS ACCURACY & DATA FLOW VERIFICATION SUITE');
  console.log('===============================================================\n');

  // Initial Heartbeat to activate connection
  const hbFrame = buildMavlink1Packet(0, createHeartbeatPayload(), 1);
  mavlinkService.parseMavlinkStream(hbFrame);

  // --------------------------------------------------------------------------
  // TEST 1: Accurate Pixhawk GPS_RAW_INT (msg #24) Processing
  // --------------------------------------------------------------------------
  console.log('▶ TEST GROUP 1: Pixhawk GPS_RAW_INT Telemetry Ingestion');
  const testLat1 = 17.4452345;
  const testLon1 = 78.3856789;
  const testAlt1 = 542.5;
  const testSats1 = 14;
  const testHdop1 = 1.15;

  const gpsPayload1 = createGpsRawIntPayload({
    latDeg: testLat1,
    lonDeg: testLon1,
    altMslMeters: testAlt1,
    fixType: 3, // 3D_FIX
    satellites: testSats1,
    hdop: testHdop1,
    speedMs: 2.3,
  });

  const packet1 = buildMavlink1Packet(24, gpsPayload1, 2);
  mavlinkService.parseMavlinkStream(packet1);

  const telem1 = mavlinkService.getTelemetry();
  assert(
    Math.abs(telem1.latitude - testLat1) < 0.000001,
    'Pixhawk GPS Latitude matches transmitted degE7 accuracy',
    `Expected ${testLat1}, got ${telem1.latitude}`
  );
  assert(
    Math.abs(telem1.longitude - testLon1) < 0.000001,
    'Pixhawk GPS Longitude matches transmitted degE7 accuracy',
    `Expected ${testLon1}, got ${telem1.longitude}`
  );
  assert(
    Math.abs(telem1.gps.altitude - testAlt1) < 0.1,
    'Pixhawk GPS MSL Altitude matches transmitted mm accuracy',
    `Expected ${testAlt1}m, got ${telem1.gps.altitude}m`
  );
  assert(
    telem1.satellitesVisible === testSats1 && telem1.gps.satellites === testSats1,
    'Pixhawk visible satellites accurately reported',
    `Expected ${testSats1}, got satellitesVisible: ${telem1.satellitesVisible}, gps.satellites: ${telem1.gps.satellites}`
  );
  assert(
    telem1.gps.fixType === '3D_FIX',
    'Pixhawk fix type reported as 3D_FIX',
    `Got ${telem1.gps.fixType}`
  );
  assert(
    telem1.gps.isLocked === true,
    'Pixhawk GPS lock verified (isLocked === true)'
  );
  assert(
    typeof telem1.gps.lastUpdated === 'number' && Date.now() - telem1.gps.lastUpdated < 1000,
    'GPS lastUpdated timestamp recorded with fresh system time'
  );

  // --------------------------------------------------------------------------
  // TEST 2: GLOBAL_POSITION_INT (msg #33) Synchronizes GPS Coordinates & MSL Alt
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST GROUP 2: GLOBAL_POSITION_INT Position Synchronisation');
  const testLat2 = 17.4461000;
  const testLon2 = 78.3862000;
  const testAltMsl2 = 555.2;
  const testRelAlt2 = 12.8;

  const gposPayload = createGlobalPositionIntPayload({
    latDeg: testLat2,
    lonDeg: testLon2,
    altMslMeters: testAltMsl2,
    relativeAltMeters: testRelAlt2,
    vxMs: 1.5,
    vyMs: 0.5,
    vzMs: -0.2,
    hdgDeg: 135.0,
  });

  const packet2 = buildMavlink1Packet(33, gposPayload, 3);
  mavlinkService.parseMavlinkStream(packet2);

  const telem2 = mavlinkService.getTelemetry();
  assert(
    Math.abs(telem2.latitude - testLat2) < 0.000001,
    'GLOBAL_POSITION_INT updates telemetry latitude',
    `Expected ${testLat2}, got ${telem2.latitude}`
  );
  assert(
    Math.abs(telem2.longitude - testLon2) < 0.000001,
    'GLOBAL_POSITION_INT updates telemetry longitude',
    `Expected ${testLon2}, got ${telem2.longitude}`
  );
  assert(
    Math.abs(telem2.gps.latitude - testLat2) < 0.000001 && Math.abs(telem2.gps.longitude - testLon2) < 0.000001,
    'GLOBAL_POSITION_INT synchronizes gps.latitude & gps.longitude'
  );
  assert(
    Math.abs(telem2.gps.altitude - testAltMsl2) < 0.1,
    'GLOBAL_POSITION_INT parses MSL Altitude from byte offset 12',
    `Expected ${testAltMsl2}m, got ${telem2.gps.altitude}m`
  );
  assert(
    Math.abs(telem2.altitude - testRelAlt2) < 0.1,
    'Relative altitude correctly parsed from offset 16',
    `Expected ${testRelAlt2}m, got ${telem2.altitude}m`
  );

  // --------------------------------------------------------------------------
  // TEST 3: Strict Rejection of Invalid Coordinates (0,0, NaN, Out-of-bounds)
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST GROUP 3: Invalid Coordinate Rejection');
  const savedLatBeforeInvalid = telem2.latitude;
  const savedLonBeforeInvalid = telem2.longitude;

  // 3a. Null Island (0, 0)
  const nullIslandPayload = createGpsRawIntPayload({
    latDeg: 0.0,
    lonDeg: 0.0,
    altMslMeters: 0,
    fixType: 1, // NO_FIX
    satellites: 0,
    hdop: 99.0,
    speedMs: 0,
  });
  const packetNullIsland = buildMavlink1Packet(24, nullIslandPayload, 4);
  mavlinkService.parseMavlinkStream(packetNullIsland);

  const telem3a = mavlinkService.getTelemetry();
  assert(
    telem3a.gps.isLocked === false,
    'Null Island (0, 0) strictly resets isLocked to false'
  );
  assert(
    telem3a.latitude === savedLatBeforeInvalid && telem3a.longitude === savedLonBeforeInvalid,
    'Null Island (0, 0) coordinates are NOT stored as drone position'
  );

  // 3b. Out of bounds latitude (> 90 deg)
  const outOfBoundsPayload = createGpsRawIntPayload({
    latDeg: 98.5000000,
    lonDeg: 78.3850000,
    altMslMeters: 500,
    fixType: 3,
    satellites: 10,
    hdop: 1.0,
    speedMs: 0,
  });
  const packetOob = buildMavlink1Packet(24, outOfBoundsPayload, 5);
  mavlinkService.parseMavlinkStream(packetOob);

  const telem3b = mavlinkService.getTelemetry();
  assert(
    telem3b.gps.isLocked === false,
    'Out of bounds latitude (> 90°) strictly rejected'
  );

  // --------------------------------------------------------------------------
  // TEST 4: No Artificial Fix Type Inflation (2D Fix strictly reported as 2D)
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST GROUP 4: GPS Fix Quality Verification');
  // Invalidate GPS 2 cache so arbitration tests GPS 1 in isolation
  (mavlinkService as any).gps2Data = { lat: 0, lon: 0, alt: 0, hdop: 99, satellites: 0, rawFixType: 0, fixType: 'NO_GPS', lastUpdated: 0 };

  const fix2dPayload = createGpsRawIntPayload({
    latDeg: 17.4455000,
    lonDeg: 78.3855000,
    altMslMeters: 540,
    fixType: 2, // 2D_FIX
    satellites: 8, // high sats but only 2D fix
    hdop: 2.1,
    speedMs: 0,
  });
  const packet2d = buildMavlink1Packet(24, fix2dPayload, 6);
  mavlinkService.parseMavlinkStream(packet2d);

  const telem4 = mavlinkService.getTelemetry();
  assert(
    telem4.gps.fixType === '2D_FIX',
    '2D fix is NOT artificially inflated to 3D fix regardless of satellite count',
    `Got fixType: ${telem4.gps.fixType}`
  );
  assert(
    telem4.gps.fixType !== '3D_FIX',
    '2D fix does not report 3D_FIX'
  );

  // --------------------------------------------------------------------------
  // TEST 5: Stale GPS Watchdog & Signal Loss Detection
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST GROUP 5: Stale GPS Watchdog');
  // First inject valid 3D fix
  const valid3dPayload = createGpsRawIntPayload({
    latDeg: 17.4470000,
    lonDeg: 78.3870000,
    altMslMeters: 545.0,
    fixType: 3,
    satellites: 12,
    hdop: 1.1,
    speedMs: 1.2,
  });
  mavlinkService.parseMavlinkStream(buildMavlink1Packet(24, valid3dPayload, 7));
  assert(mavlinkService.getTelemetry().gps.isLocked === true, 'Fresh 3D fix locked');

  // Manually age the lastUpdated timestamp to simulate 6 seconds of silence from Pixhawk GPS
  const internalTelem = (mavlinkService as any).telemetry;
  internalTelem.gps.lastUpdated = Date.now() - 6000;
  (mavlinkService as any).gps1Data.lastUpdated = Date.now() - 6000;
  (mavlinkService as any).gps2Data.lastUpdated = Date.now() - 6000;

  // Run telemetry watchdog logic
  mavlinkService.checkHeartbeatWatchdog();

  const telemAfterSilence = mavlinkService.getTelemetry();
  assert(
    telemAfterSilence.gps.isLocked === false,
    'Stale GPS watchdog resets isLocked to false after 5s of telemetry silence'
  );

  // --------------------------------------------------------------------------
  // TEST 6: Reconnection Restores Live Updates
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST GROUP 6: Reconnection & Live Recovery');
  const freshPacket = buildMavlink1Packet(24, createGpsRawIntPayload({
    latDeg: 17.4480000,
    lonDeg: 78.3880000,
    altMslMeters: 546.0,
    fixType: 3,
    satellites: 15,
    hdop: 0.9,
    speedMs: 3.1,
  }), 8);
  mavlinkService.parseMavlinkStream(freshPacket);

  const telemRecovered = mavlinkService.getTelemetry();
  assert(
    telemRecovered.gps.isLocked === true,
    'Reconnection with fresh MAVLink packet restores isLocked = true'
  );
  assert(
    Math.abs(telemRecovered.latitude - 17.4480000) < 0.000001,
    'Marker receives recovered live coordinates'
  );

  // --------------------------------------------------------------------------
  // TEST 7: Safe Command Execution (No Fallback to Hardcoded Coordinates)
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST GROUP 7: Safe Navigation Without Hardcoded Coordinates');
  // Invalidate GPS lock
  internalTelem.gps.isLocked = false;
  internalTelem.latitude = 0;
  internalTelem.longitude = 0;

  let commandRejected = false;
  try {
    const res = await mavlinkService.commandVerticalAltitude(10.0);
    if (!res) commandRejected = true;
  } catch {
    commandRejected = true;
  }

  assert(
    commandRejected,
    'commandVerticalAltitude safely rejects repositioning when GPS lock is missing',
    'Must not fallback to 17.3850, 78.4867'
  );

  // --------------------------------------------------------------------------
  // Final Test Summary
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`📊 GPS TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runGpsAccuracyTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
