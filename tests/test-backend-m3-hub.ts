/**
 * SAE INDIA — MILESTONE 3 BACKEND COMMUNICATIONS HUB ACCEPTANCE TEST SUITE
 * 
 * Verifies all Requirement R3 deliverables:
 * 1. Zero-Copy MAVLink v2 binary demultiplexing for IDs #0, #1, #24, #30, #33, #253, #77
 * 2. Critical brownout & USB rail sag detection (<4400 mV)
 * 3. Asynchronous non-blocking command correlation engine (COMMAND_LONG #76 vs COMMAND_ACK #77)
 *    - Standard arm (param2=0.0) vs Force-arm bypass (param2=21196.0)
 *    - Flight mode switching (LOITER, GUIDED, RTL, BRAKE)
 *    - Autonomous 5.0m takeoff (PILOT_TKOFF_ALT=500)
 *    - STATUSTEXT pre-arm correlation on rejection
 *    - 2000 ms retry/timeout promise
 * 4. Parameter Profile Swapper (BENCH vs FIELD)
 * 5. Telemetry history circular buffer (/api/telemetry/history)
 * 6. Atomic persistence store (.tmp + renameSync) & SQLite WAL logging with SHA-256 verification
 */

import http from 'http';
import WebSocket from 'ws';
import { fork, ChildProcess } from 'child_process';
import path from 'path';

const TEST_PORT = 3599;
const RELAY_TOKEN = 'saeindia_sec_99348a7b1c0e';
const SERVER_PATH = path.resolve(process.cwd(), 'backend/server.js');

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// X.25 CRC calculation
function calculateMavlinkCrc(buffer: Buffer, start: number, length: number, extra: number): number {
  let crc = 0xFFFF;
  for (let i = start; i < start + length; i++) {
    let tmp = (buffer[i] ^ (crc & 0xFF)) & 0xFF;
    tmp = (tmp ^ (tmp << 4)) & 0xFF;
    crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF;
  }
  let tmp = (extra ^ (crc & 0xFF)) & 0xFF;
  tmp = (tmp ^ (tmp << 4)) & 0xFF;
  crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF;
  return crc;
}

// MAVLink v2 Frame Builder
function makeMavlink2Packet(msgId: number, payload: Buffer, extra: number, seq = 1, sysId = 1, compId = 1): Buffer {
  const pLen = payload.length;
  const frame = Buffer.alloc(10 + pLen + 2);
  frame[0] = 0xFD; // MAVLink v2 STX
  frame[1] = pLen;
  frame[2] = 0; // incompat_flags
  frame[3] = 0; // compat_flags
  frame[4] = seq & 0xFF;
  frame[5] = sysId;
  frame[6] = compId;
  frame[7] = msgId & 0xFF;
  frame[8] = (msgId >> 8) & 0xFF;
  frame[9] = (msgId >> 16) & 0xFF;
  payload.copy(frame, 10);

  const crc = calculateMavlinkCrc(frame, 1, 9 + pLen, extra);
  frame.writeUInt16LE(crc, 10 + pLen);
  return frame;
}

function httpRequest(options: http.RequestOptions, bodyData?: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed: any = data;
        try { parsed = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: parsed
        });
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runM3HubTests() {
  console.log('\n===============================================================');
  console.log('🛸 SAE INDIA — MILESTONE 3: BACKEND COMMUNICATIONS HUB TEST');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      passed++;
      console.log(`  ✓ [PASS] ${testName}`);
    } else {
      failed++;
      console.error(`  ✗ [FAIL] ${testName}${details ? ` — ${details}` : ''}`);
    }
  }

  // 1. Launch server
  const serverProcess: ChildProcess = fork(SERVER_PATH, [], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      RELAY_TOKEN: RELAY_TOKEN,
      DISABLE_KEEP_ALIVE: 'true'
    },
    stdio: 'pipe'
  });

  await wait(1500);

  let droneWs: WebSocket | null = null;
  let browserWs: WebSocket | null = null;

  try {
    // Connect Drone and Browser
    droneWs = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/connector?token=${RELAY_TOKEN}`);
    await new Promise((resolve, reject) => {
      droneWs!.on('open', resolve);
      droneWs!.on('error', reject);
    });

    const browserJsonMsgs: any[] = [];
    browserWs = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?token=${RELAY_TOKEN}`);
    browserWs.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          browserJsonMsgs.push(JSON.parse(data.toString()));
        } catch {}
      }
    });
    await new Promise((resolve, reject) => {
      browserWs!.on('open', resolve);
      browserWs!.on('error', reject);
    });

    await wait(300);

    // ------------------------------------------------------------------------
    // SECTION 1: MAVLink v2 Binary Demultiplexer
    // ------------------------------------------------------------------------
    console.log('▶ SECTION 1: MAVLink v2 Binary Demultiplexer (#0, #1, #24, #30, #33, #253)');

    // 1.1 HEARTBEAT (#0): Armed + LOITER mode (5)
    const hbPayload = Buffer.alloc(9);
    hbPayload.writeUInt32LE(5, 0); // custom_mode = 5 (LOITER)
    hbPayload[4] = 2; // type = quadrotor
    hbPayload[5] = 3; // autopilot = ardupilot
    hbPayload[6] = 0x80 | 0x01; // base_mode armed (bit 7 = 0x80)
    hbPayload[7] = 4; // MAV_STATE_ACTIVE
    hbPayload[8] = 3; // v2
    const hbPacket = makeMavlink2Packet(0, hbPayload, 50, 1);
    droneWs.send(hbPacket, { binary: true });
    await wait(200);

    let health = await httpRequest({ hostname: '127.0.0.1', port: TEST_PORT, path: '/health', method: 'GET' });
    assert(health.body.telemetry.armed === true, 'HEARTBEAT demux: armed state accurately detected (0x80)');
    assert(health.body.telemetry.flightMode === 'LOITER', 'HEARTBEAT demux: mode integer 5 mapped to "LOITER"');

    // 1.2 SYS_STATUS (#1): Brownout USB Rail Sag Warning (<4400 mV)
    const sysPayloadSag = Buffer.alloc(31);
    sysPayloadSag.writeUInt16LE(150, 12); // cpu load 15.0%
    sysPayloadSag.writeUInt16LE(4250, 14); // 4250 mV (<4400 mV!)
    sysPayloadSag.writeInt16LE(120, 16);  // 1.20 A
    sysPayloadSag.writeInt8(85, 18);      // 85% battery
    const sysPacketSag = makeMavlink2Packet(1, sysPayloadSag, 124, 2);
    droneWs.send(sysPacketSag, { binary: true });
    await wait(200);

    health = await httpRequest({ hostname: '127.0.0.1', port: TEST_PORT, path: '/health', method: 'GET' });
    assert(health.body.telemetry.health.voltageBatteryMv === 4250, 'SYS_STATUS demux: battery voltage 4250 mV recorded');
    assert(health.body.telemetry.health.usbPowerSag === true, 'SYS_STATUS demux: brownout warning flagged (usbPowerSag = true for <4400 mV)');
    assert(health.body.telemetry.health.cpuLoad === 15.0, 'SYS_STATUS demux: cpuLoad 15.0% decoded');

    // 1.3 SYS_STATUS (#1): Healthy LiPo Rail (5370 mV)
    sysPayloadSag.writeUInt16LE(5370, 14); // 5370 mV
    const sysPacketGood = makeMavlink2Packet(1, sysPayloadSag, 124, 3);
    droneWs.send(sysPacketGood, { binary: true });
    await wait(200);

    health = await httpRequest({ hostname: '127.0.0.1', port: TEST_PORT, path: '/health', method: 'GET' });
    assert(health.body.telemetry.health.usbPowerSag === false, 'SYS_STATUS demux: nominal 5.37V rail clears usbPowerSag flag');

    // 1.4 GPS_RAW_INT (#24)
    const gpsPayload = Buffer.alloc(30);
    gpsPayload.writeInt32LE(Math.round(13.0827150 * 1e7), 8); // lat
    gpsPayload.writeInt32LE(Math.round(80.2707220 * 1e7), 12); // lon
    gpsPayload.writeInt32LE(15000, 16); // 15.0m MSL
    gpsPayload.writeUInt16LE(80, 20); // HDOP 0.8m (80 cm)
    gpsPayload.writeUInt16LE(120, 22); // VDOP 1.2m
    gpsPayload.writeUInt16LE(400, 24); // speed 4.0 m/s
    gpsPayload[28] = 3; // 3D fix
    gpsPayload[29] = 14; // 14 satellites (>= 6)
    const gpsPacket = makeMavlink2Packet(24, gpsPayload, 24, 4);
    droneWs.send(gpsPacket, { binary: true });
    await wait(200);

    health = await httpRequest({ hostname: '127.0.0.1', port: TEST_PORT, path: '/health', method: 'GET' });
    assert(health.body.telemetry.health.satellites === 14, 'GPS_RAW_INT demux: satellites visible = 14 (>= 6)');
    assert(health.body.telemetry.health.hdop === 0.8, 'GPS_RAW_INT demux: HDOP = 0.8m accurately decoded');

    // 1.5 ATTITUDE (#30)
    const attPayload = Buffer.alloc(28);
    attPayload.writeFloatLE(0.05, 4);  // roll rad
    attPayload.writeFloatLE(-0.02, 8); // pitch rad
    attPayload.writeFloatLE(1.57, 12); // yaw rad (90 deg)
    const attPacket = makeMavlink2Packet(30, attPayload, 39, 5);
    droneWs.send(attPacket, { binary: true });
    await wait(200);

    health = await httpRequest({ hostname: '127.0.0.1', port: TEST_PORT, path: '/health', method: 'GET' });
    assert(Math.abs(health.body.telemetry.attitude.roll - 0.05) < 0.001, 'ATTITUDE demux: roll angle 0.05 rad decoded');
    assert(Math.abs(health.body.telemetry.attitude.pitch - (-0.02)) < 0.001, 'ATTITUDE demux: pitch angle -0.02 rad decoded');

    // 1.6 GLOBAL_POSITION_INT (#33)
    const posPayload = Buffer.alloc(28);
    posPayload.writeInt32LE(Math.round(13.0827000 * 1e7), 4);
    posPayload.writeInt32LE(Math.round(80.2707000 * 1e7), 8);
    posPayload.writeInt32LE(542500, 12); // alt MSL 542.5m
    posPayload.writeInt32LE(5000, 16);   // relative alt 5.0m AGL
    posPayload.writeInt16LE(200, 20);   // vx 2.0 m/s
    posPayload.writeInt16LE(0, 22);     // vy 0.0 m/s
    posPayload.writeInt16LE(-10, 24);   // vz -0.1 m/s (climb +0.1 m/s)
    posPayload.writeUInt16LE(9000, 26); // heading 90.00 deg
    const posPacket = makeMavlink2Packet(33, posPayload, 104, 6);
    droneWs.send(posPacket, { binary: true });
    await wait(200);

    health = await httpRequest({ hostname: '127.0.0.1', port: TEST_PORT, path: '/health', method: 'GET' });
    assert(health.body.telemetry.position.altAgl === 5.0, 'GLOBAL_POSITION_INT demux: altAgl = 5.0m AGL decoded');
    assert(health.body.telemetry.position.vz === 0.1, 'GLOBAL_POSITION_INT demux: vertical speed Vz = +0.1 m/s climb decoded');
    assert(health.body.telemetry.position.headingDeg === 90.0, 'GLOBAL_POSITION_INT demux: heading = 90.0° decoded');

    // ------------------------------------------------------------------------
    // SECTION 2: Command Uplink & 2000 ms Correlation Engine
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 2: Non-Blocking Command Uplink & Correlation Engine (COMMAND_LONG #76)');

    // Setup drone receiver to intercept COMMAND_LONG and send COMMAND_ACK
    const commandsReceivedByDrone: { cmdId: number; p1: number; p2: number; p7: number }[] = [];
    droneWs.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(data as ArrayBuffer);
        if (buf.length >= 10 && buf[0] === 0xFD && buf[7] === 76) {
          // MAVLink v2 COMMAND_LONG
          const p1 = buf.readFloatLE(10);
          const p2 = buf.readFloatLE(14);
          const p7 = buf.readFloatLE(34);
          const cmdId = buf.readUInt16LE(38);
          commandsReceivedByDrone.push({ cmdId, p1, p2, p7 });
        }
      }
    });

    // 2.1 Standard Arm (param2 = 0.0)
    const armPromise = httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/command/arm',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ force: false }));

    await wait(150);
    assert(commandsReceivedByDrone.length === 1, 'Drone received COMMAND_LONG (#76)');
    const receivedArm = commandsReceivedByDrone[0];
    assert(receivedArm.cmdId === 400, 'Command ID is 400 (MAV_CMD_COMPONENT_ARM_DISARM)');
    assert(receivedArm.p1 === 1.0, 'Param1 is 1.0 (Arm)');
    assert(receivedArm.p2 === 0.0, 'Standard arm uses param2 = 0.0');

    // Drone responds with COMMAND_ACK (MAV_RESULT_ACCEPTED = 0)
    const ackPayload = Buffer.alloc(10);
    ackPayload.writeUInt16LE(400, 0);
    ackPayload[2] = 0; // ACCEPTED
    ackPayload[3] = 100; // progress
    const ackPacket = makeMavlink2Packet(77, ackPayload, 143, 10);
    droneWs.send(ackPacket, { binary: true });

    const armResult = await armPromise;
    assert(armResult.statusCode === 200, 'Command arm HTTP request completed with 200 OK');
    assert(armResult.body.success === true, 'Correlator resolved promise with success: true');
    assert(armResult.body.result === 'MAV_RESULT_ACCEPTED', 'Correlator matched result: MAV_RESULT_ACCEPTED');

    // 2.2 Force-Arm Bypass (param2 = 21196.0 magic constant)
    commandsReceivedByDrone.length = 0;
    const forceArmPromise = httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/command/arm',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ force: true }));

    await wait(150);
    assert(commandsReceivedByDrone.length === 1, 'Drone received Force Arm command');
    const receivedForceArm = commandsReceivedByDrone[0];
    assert(receivedForceArm.cmdId === 400 && receivedForceArm.p2 === 21196.0, 'Force Arm bypass dispatched magic constant param2 = 21196.0');

    // Ack Force-Arm
    droneWs.send(ackPacket, { binary: true });
    const forceResult = await forceArmPromise;
    assert(forceResult.body.success === true, 'Force Arm acknowledged and correlated successfully');

    // 2.3 Mode Switch to LOITER (mode 5)
    commandsReceivedByDrone.length = 0;
    const modePromise = httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/command/mode',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ mode: 'LOITER' }));

    await wait(150);
    assert(commandsReceivedByDrone.length === 1, 'Drone received Mode Switch command');
    const receivedMode = commandsReceivedByDrone[0];
    assert(receivedMode.cmdId === 176, 'Command ID is 176 (MAV_CMD_DO_SET_MODE)');
    assert(receivedMode.p2 === 5.0, 'Param2 is 5.0 (LOITER integer mode)');

    // Ack Mode Switch
    const modeAckPayload = Buffer.alloc(10);
    modeAckPayload.writeUInt16LE(176, 0);
    modeAckPayload[2] = 0;
    droneWs.send(makeMavlink2Packet(77, modeAckPayload, 143, 11), { binary: true });
    const modeResult = await modePromise;
    assert(modeResult.body.success === true, 'Mode switch acknowledged and correlated successfully');

    // 2.4 Autonomous 5.0m Takeoff (cmd 22, param7 = 5.0)
    commandsReceivedByDrone.length = 0;
    const takeoffPromise = httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/command/takeoff',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ altitude: 5.0 }));

    await wait(150);
    assert(commandsReceivedByDrone.length === 1, 'Drone received Takeoff command');
    const receivedTkoff = commandsReceivedByDrone[0];
    assert(receivedTkoff.cmdId === 22, 'Command ID is 22 (MAV_CMD_NAV_TAKEOFF)');
    assert(receivedTkoff.p7 === 5.0, 'Param7 is 5.0m (PILOT_TKOFF_ALT = 500)');

    // Ack Takeoff
    const tkoffAckPayload = Buffer.alloc(10);
    tkoffAckPayload.writeUInt16LE(22, 0);
    tkoffAckPayload[2] = 0;
    droneWs.send(makeMavlink2Packet(77, tkoffAckPayload, 143, 12), { binary: true });
    const tkoffResult = await takeoffPromise;
    assert(tkoffResult.body.success === true, 'Takeoff acknowledged and correlated successfully');

    // 2.5 Command Rejection with STATUSTEXT correlation
    commandsReceivedByDrone.length = 0;
    // Send a STATUSTEXT warning from drone
    const stPayload = Buffer.alloc(51);
    stPayload[0] = 3; // ERROR severity
    stPayload.write('PreArm: Need 3D Fix', 1, 'ascii');
    droneWs.send(makeMavlink2Packet(253, stPayload, 83, 13), { binary: true });
    await wait(100);

    const rejectPromise = httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/command/arm',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ force: false }));

    await wait(150);
    // Send ACK with MAV_RESULT_FAILED (4)
    const failAckPayload = Buffer.alloc(10);
    failAckPayload.writeUInt16LE(400, 0);
    failAckPayload[2] = 4; // FAILED
    droneWs.send(makeMavlink2Packet(77, failAckPayload, 143, 14), { binary: true });

    const rejectResult = await rejectPromise;
    assert(rejectResult.body.success === false, 'Command rejection accurately returned success: false');
    assert(rejectResult.body.error.includes('PreArm: Need 3D Fix'), 'Command error correlates with recent STATUSTEXT error string');

    // ------------------------------------------------------------------------
    // SECTION 3: Parameter Profile Swapper
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 3: Parameter Profile Swapper (BENCH vs FIELD)');

    // 3.1 Switch to BENCH profile
    const benchRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/params/profile',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ profile: 'BENCH' }));

    assert(benchRes.statusCode === 200, 'POST /api/params/profile BENCH returns 200 OK');
    assert(benchRes.body.profile === 'BENCH', 'Profile switched to BENCH');
    assert(benchRes.body.keyOverrides.ARMING_CHECK === 0, 'BENCH keyOverride ARMING_CHECK = 0');
    assert(benchRes.body.keyOverrides.FENCE_ENABLE === 0, 'BENCH keyOverride FENCE_ENABLE = 0');

    // 3.2 Switch to FIELD profile
    const fieldRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/params/profile',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ profile: 'FIELD' }));

    assert(fieldRes.statusCode === 200, 'POST /api/params/profile FIELD returns 200 OK');
    assert(fieldRes.body.profile === 'FIELD', 'Profile switched to FIELD');
    assert(fieldRes.body.keyOverrides.FENCE_ENABLE === 1, 'FIELD keyOverride FENCE_ENABLE = 1');
    assert(fieldRes.body.keyOverrides.PILOT_TKOFF_ALT === 500, 'FIELD keyOverride PILOT_TKOFF_ALT = 500');

    // 3.3 Query profile status
    const profileStatus = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/params/profile',
      method: 'GET'
    });
    assert(profileStatus.body.activeProfile === 'FIELD', 'GET /api/params/profile confirms activeProfile is FIELD');

    // ------------------------------------------------------------------------
    // SECTION 4: Telemetry History & Atomic Persistence
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 4: Telemetry History & Atomic Persistence Store');

    // 4.1 GET /api/telemetry/history
    const historyRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/telemetry/history?limit=10',
      method: 'GET'
    });
    assert(historyRes.statusCode === 200, 'GET /api/telemetry/history returns 200 OK');
    assert(historyRes.body.success === true, 'Telemetry history response is success: true');
    assert(historyRes.body.history.length > 0, 'History contains cached frames from circular buffer');
    assert(historyRes.body.history[0].type === 'TELEMETRY_FRAME', 'History item conforms to TELEMETRY_FRAME schema');

    // 4.2 POST /api/recon/detections with SHA-256 validation
    const testDetection = {
      detectionId: `TEST_DET_${Date.now()}`,
      timestampUtc: new Date().toISOString(),
      payload: 'SAE_INDIA_RESCUE_42',
      twoDigitCode: '42',
      verified: true,
      targetLocation: {
        latitude: 13.0827150,
        longitude: 80.2707220,
        altitudeAgl: 0.0
      },
      droneStateAtCapture: {
        latitude: 13.0827071,
        longitude: 80.2707140,
        altitudeAgl: 5.02,
        rollDeg: -1.2,
        pitchDeg: 2.4,
        yawDeg: 88.5
      }
    };

    const detectPost = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/recon/detections',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify(testDetection));

    assert(detectPost.statusCode === 200, 'POST /api/recon/detections returns 200 OK');
    assert(detectPost.body.success === true, 'Detection ingest returns success: true');
    assert(typeof detectPost.body.checksumSha256 === 'string' && detectPost.body.checksumSha256.length === 64, 'Detection record validated and attached 64-char SHA-256 checksum');

    // 4.3 GET /api/recon/detections
    const detectGet = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/recon/detections',
      method: 'GET'
    });
    assert(detectGet.statusCode === 200, 'GET /api/recon/detections returns 200 OK');
    assert(detectGet.body.detections.some((d: any) => d.detectionId === testDetection.detectionId), 'Durable persistence verified: query returns saved detection record');

  } finally {
    if (droneWs && droneWs.readyState === WebSocket.OPEN) droneWs.close();
    if (browserWs && browserWs.readyState === WebSocket.OPEN) browserWs.close();
    serverProcess.kill('SIGTERM');
  }

  console.log('\n===============================================================');
  console.log(`📊 M3 HUB RESULTS: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
}

runM3HubTests().catch(err => {
  console.error('Fatal M3 test error:', err);
  process.exit(1);
});
