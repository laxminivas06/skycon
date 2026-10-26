/**
 * SAE INDIA AUTONOMOUS DRONE — COMPREHENSIVE BACKEND & WORKFLOW E2E TEST SUITE
 * 
 * Thoroughly validates all backend actions, REST endpoints, WebSocket protocols,
 * security hardening, and full mission upload workflows:
 * 
 * 1. Server Lifecycle, CORS & Static SPA Fallback
 * 2. REST Endpoints (GET /health, GET /, GET /mission/status, 404 handler)
 * 3. Token Authentication Hardening (/connector & /ws)
 * 4. Drone Connector Initial Handshake & Telemetry Status Broadcasting
 * 5. Bidirectional Zero-Copy MAVLink v1 & v2 Frame Forwarding (Uplink & Downlink)
 * 6. Cloud Mission Upload Handshake Workflow (MISSION_COUNT -> REQUEST_INT -> ITEM_INT -> ACK -> SUCCESS)
 * 7. Disconnect Detection, Browser Notification & Reconnect Recovery
 */

import http from 'http';
import WebSocket from 'ws';
import { fork, ChildProcess } from 'child_process';
import path from 'path';

const TEST_PORT = 3456;
const RELAY_TOKEN = 'saeindia_sec_99348a7b1c0e';
const SERVER_PATH = path.resolve(process.cwd(), 'backend/server.js');

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Minimal MAVLink 1 Frame Builder
function makeMavlink1Packet(msgId: number, payload: Buffer, seq = 0, sysId = 1, compId = 1): Buffer {
  const len = payload.length;
  const frame = Buffer.alloc(6 + len + 2);
  frame[0] = 0xFE;
  frame[1] = len;
  frame[2] = seq & 0xFF;
  frame[3] = sysId;
  frame[4] = compId;
  frame[5] = msgId;
  payload.copy(frame, 6);

  // X.25 CRC
  let crc = 0xFFFF;
  for (let i = 1; i < 6 + len; i++) {
    let b = frame[i] ^ (crc & 0xFF);
    b ^= (b << 4) & 0xFF;
    crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
  }
  const extra = 50; // Extra CRC seed
  let b = extra ^ (crc & 0xFF);
  b ^= (b << 4) & 0xFF;
  crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
  frame[6 + len] = crc & 0xFF;
  frame[6 + len + 1] = (crc >> 8) & 0xFF;
  return frame;
}

// HTTP request helper
function httpRequest(options: http.RequestOptions, bodyData?: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed: any = data;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: parsed
        });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
}

async function runComprehensiveBackendTests() {
  console.log('\n===============================================================');
  console.log('🛸 SAE INDIA — FULL BACKEND WORKFLOW & E2E INTEGRATION TEST');
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

  // 1. Launch backend server
  console.log(`[BOOT] Launching backend relay on 127.0.0.1:${TEST_PORT}...`);
  const serverProcess: ChildProcess = fork(SERVER_PATH, [], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      RELAY_TOKEN: RELAY_TOKEN,
      DISABLE_KEEP_ALIVE: 'true'
    },
    stdio: 'pipe'
  });

  serverProcess.on('error', (err) => {
    console.error('[SERVER ERROR]', err);
  });

  await wait(1500);

  let simulatedDroneWs: WebSocket | null = null;
  let simulatedBrowserWs: WebSocket | null = null;

  try {
    // ------------------------------------------------------------------------
    // SECTION 1: HTTP REST & CORS Endpoints
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 1: REST Endpoints & Health Check Telemetry');

    // 1.1 GET /health
    const health = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET'
    });
    assert(health.statusCode === 200, 'GET /health returns HTTP 200 OK');
    assert(health.body.status === 'ok', 'Health payload status is "ok"');
    assert(health.body.tcpNoDelay === true, 'Health telemetry confirms TCP_NODELAY enabled (0ms Nagle delay)');
    assert(health.body.perMessageDeflate === false, 'Health telemetry confirms perMessageDeflate disabled (0ms compression latency)');
    assert(health.body.connectorOnline === false, 'Initial state: connectorOnline is false');
    assert(health.body.esp32Online === false, 'Initial state: esp32Online is false');
    assert(health.body.browserClientsCount === 0, 'Initial state: browserClientsCount is 0');

    // 1.2 OPTIONS /health (CORS preflight)
    const optionsHealth = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'OPTIONS'
    });
    assert(optionsHealth.statusCode === 204, 'OPTIONS /health returns HTTP 204 No Content for CORS preflight');
    assert(optionsHealth.headers['access-control-allow-origin'] === '*', 'CORS Access-Control-Allow-Origin header is wildcard');

    // 1.3 GET / root overview
    const rootRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/',
      method: 'GET'
    });
    assert(rootRes.statusCode === 200, 'GET / returns HTTP 200 (SPA HTML or Overview JSON)');
    const isHtml = typeof rootRes.body === 'string' && (rootRes.body.includes('<html') || rootRes.body.includes('<!DOCTYPE') || rootRes.body.includes('<!doctype'));
    const isJson = typeof rootRes.body === 'object' && rootRes.body !== null && typeof rootRes.body.service === 'string';
    assert(isHtml || isJson, 'GET / correctly serves production SPA index.html or API overview payload');

    // 1.4 GET /mission/status initial
    const missionStatus = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mission/status',
      method: 'GET'
    });
    assert(missionStatus.statusCode === 200, 'GET /mission/status returns HTTP 200 OK');
    assert(missionStatus.body.job.status === 'IDLE', 'Mission upload job initialized in IDLE state');

    // 1.5 POST /mission/upload with empty items
    const emptyUpload = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mission/upload',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ items: [] }));
    assert(emptyUpload.statusCode === 400, 'POST /mission/upload with empty items rejected with HTTP 400 Bad Request');

    // 1.6 POST /mission/upload when drone is offline
    const offlineUpload = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mission/upload',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({
      items: [
        { lat: 17.385044, lng: 78.486671, alt: 5.0 }
      ]
    }));
    assert(offlineUpload.statusCode === 503, 'POST /mission/upload returns HTTP 503 Service Unavailable when drone is offline');
    assert(offlineUpload.body.error.includes('offline'), 'Descriptive error identifies offline ESP32 link');

    // 1.7 Client-side SPA routing fallback on GET & 404 on unhandled POST
    const spaRouteRes = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/fly/telemetry_cockpit',
      method: 'GET'
    });
    assert(spaRouteRes.statusCode === 200, 'GET /fly/telemetry_cockpit falls back cleanly to SPA index.html (200 OK)');

    const notFoundPost = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/unhandled_api_endpoint',
      method: 'POST'
    });
    assert(notFoundPost.statusCode === 404, 'POST /unhandled_api_endpoint returns HTTP 404 Not Found');

    // ------------------------------------------------------------------------
    // SECTION 2: WebSocket Authentication & Hardening
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 2: WebSocket Authentication & Security Hardening');

    // 2.1 /connector without token
    const connNoToken = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/connector`);
      ws.on('open', () => { ws.close(); resolve(false); });
      ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode === 401); });
      ws.on('error', () => { resolve(true); });
    });
    assert(connNoToken, 'WS /connector without token rejected with HTTP 401');

    // 2.2 /connector with invalid token
    const connBadToken = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/connector?token=bad_invalid_token`);
      ws.on('open', () => { ws.close(); resolve(false); });
      ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode === 401); });
      ws.on('error', () => { resolve(true); });
    });
    assert(connBadToken, 'WS /connector with invalid token rejected with HTTP 401');

    // 2.3 /ws without token
    const wsNoToken = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);
      ws.on('open', () => { ws.close(); resolve(false); });
      ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode === 401); });
      ws.on('error', () => { resolve(true); });
    });
    assert(wsNoToken, 'WS /ws without token rejected with HTTP 401');

    // 2.4 /ws with invalid token
    const wsBadToken = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?token=bad_invalid_token`);
      ws.on('open', () => { ws.close(); resolve(false); });
      ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode === 401); });
      ws.on('error', () => { resolve(true); });
    });
    assert(wsBadToken, 'WS /ws with invalid token rejected with HTTP 401');

    // ------------------------------------------------------------------------
    // SECTION 3: Drone Connector & Browser Handshake Integration
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 3: Drone Connector Connection & Status Broadcasting');

    // 3.1 Connect Simulated Drone on /connector
    simulatedDroneWs = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/connector?token=${RELAY_TOKEN}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
    assert(simulatedDroneWs.readyState === WebSocket.OPEN, 'Simulated drone successfully connected to /connector with valid token');

    // 3.2 Connect Simulated Browser on /ws
    const browserMessages: any[] = [];
    simulatedBrowserWs = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?token=${RELAY_TOKEN}`);
      ws.binaryType = 'arraybuffer';
      ws.on('open', () => resolve(ws));
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          try {
            browserMessages.push(JSON.parse(data.toString()));
          } catch {}
        }
      });
      ws.on('error', reject);
    });
    assert(simulatedBrowserWs.readyState === WebSocket.OPEN, 'Simulated browser successfully connected to /ws with valid token');

    // Wait for initial RELAY_STATUS
    await wait(300);
    assert(browserMessages.length > 0, 'Browser received immediate initial status message');
    const initialMsg = browserMessages[0];
    assert(initialMsg.type === 'RELAY_STATUS', 'Initial message type is "RELAY_STATUS"');
    assert(initialMsg.connectorOnline === true, 'Initial status indicates connectorOnline is true');

    // 3.3 Drone announces ESP32 online state
    simulatedDroneWs.send(JSON.stringify({
      type: 'ESP32_STATUS',
      status: 'CONNECTED',
      error: ''
    }));
    await wait(300);

    const latestMsg = browserMessages[browserMessages.length - 1];
    assert(latestMsg.type === 'RELAY_STATUS' && latestMsg.esp32Online === true, 'Drone ESP32_STATUS "CONNECTED" broadcasted to browser as esp32Online: true');

    // Verify /health reflects 1 browser and online drone
    const activeHealth = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET'
    });
    assert(activeHealth.body.connectorOnline === true, 'Active health confirms connectorOnline is true');
    assert(activeHealth.body.esp32Online === true, 'Active health confirms esp32Online is true');
    assert(activeHealth.body.browserClientsCount === 1, 'Active health confirms browserClientsCount is 1');

    // ------------------------------------------------------------------------
    // SECTION 4: Bidirectional MAVLink Frame Forwarding (Uplink & Downlink)
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 4: Bidirectional Zero-Copy MAVLink Telemetry & Command Forwarding');

    // 4.1 Uplink: Drone sends MAVLink frame to Browser
    const binaryReceivedByBrowser: Buffer[] = [];
    simulatedBrowserWs.on('message', (data, isBinary) => {
      if (isBinary) {
        binaryReceivedByBrowser.push(Buffer.from(data as ArrayBuffer));
      }
    });

    // Create 14-byte MAVLink 1 Heartbeat: [FE 09 01 01 01 00 ... ]
    const heartbeatPayload = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x02, 0x03, 0x00, 0x00, 0x03]);
    const heartbeatPacket = makeMavlink1Packet(0, heartbeatPayload, 1, 1, 1);
    simulatedDroneWs.send(heartbeatPacket, { binary: true });
    await wait(300);

    assert(binaryReceivedByBrowser.length === 1, 'Browser received binary MAVLink uplink packet from Drone');
    assert(binaryReceivedByBrowser[0].length === heartbeatPacket.length, `Received exact packet length (${heartbeatPacket.length} bytes)`);
    assert(binaryReceivedByBrowser[0][0] === 0xFE, 'Packet header verified as MAVLink v1 (0xFE)');
    assert(binaryReceivedByBrowser[0][5] === 0, 'Packet MSG_ID verified as HEARTBEAT (0)');

    // 4.2 Downlink: Browser sends MAVLink command to Drone
    const binaryReceivedByDrone: Buffer[] = [];
    simulatedDroneWs.on('message', (data, isBinary) => {
      if (isBinary) {
        binaryReceivedByDrone.push(Buffer.from(data as ArrayBuffer));
      }
    });

    // Create 41-byte COMMAND_LONG (Takeoff #22 or Arm #400)
    const armPayload = Buffer.alloc(33);
    armPayload.writeFloatLE(1.0, 0); // Param1 = 1 (Arm)
    armPayload.writeUInt16LE(400, 28); // Command = 400 (MAV_CMD_COMPONENT_ARM_DISARM)
    armPayload[30] = 1; // target_system = 1
    armPayload[31] = 1; // target_component = 1
    const armPacket = makeMavlink1Packet(76, armPayload, 2, 255, 190);

    simulatedBrowserWs.send(armPacket, { binary: true });
    await wait(300);

    assert(binaryReceivedByDrone.length === 1, 'Drone received binary MAVLink downlink command from Browser');
    assert(binaryReceivedByDrone[0].length === armPacket.length, `Received exact command length (${armPacket.length} bytes)`);
    assert(binaryReceivedByDrone[0][5] === 76, 'Command MSG_ID verified as COMMAND_LONG (76)');

    // ------------------------------------------------------------------------
    // SECTION 5: Full Cloud Mission Upload Workflow Handshake
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 5: Full Cloud Mission Upload Handshake Workflow');

    // 5.1 Browser initiates Mission Upload POST /mission/upload
    const missionItems = [
      { lat: 17.385044, lng: 78.486671, alt: 5.0 },
      { lat: 17.385100, lng: 78.486700, alt: 5.0 },
      { lat: 17.385200, lng: 78.486800, alt: 5.0 }
    ];

    const uploadReq = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mission/upload',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({
      upload_id: 'up_test_4488',
      items: missionItems
    }));

    assert(uploadReq.statusCode === 200, 'POST /mission/upload with online drone returns HTTP 200 OK');
    assert(uploadReq.body.success === true, 'Upload response indicates success: true');
    assert(uploadReq.body.upload_id === 'up_test_4488', 'Upload ID matched "up_test_4488"');
    assert(uploadReq.body.status.status === 'UPLOADING', 'Mission job transitioned to status "UPLOADING"');

    // Verify browser received broadcast MISSION_JOB_START
    const jobStartMsg = browserMessages.find(m => m.type === 'MISSION_JOB_START');
    assert(jobStartMsg !== undefined, 'Browser received broadcast MISSION_JOB_START message over WebSocket');
    assert(jobStartMsg?.itemCount === 3, 'Broadcast indicates itemCount = 3');

    // 5.2 Browser sends MAVLink MISSION_COUNT (44)
    // Payload: count (uint16 = 3), target_system (1), target_component (1)
    const countPayload = Buffer.alloc(4);
    countPayload.writeUInt16LE(3, 0);
    countPayload[2] = 1;
    countPayload[3] = 1;
    const missionCountPacket = makeMavlink1Packet(44, countPayload, 3, 255, 190);
    simulatedBrowserWs.send(missionCountPacket, { binary: true });
    await wait(200);

    // Drone received MISSION_COUNT
    const lastDronePacket = binaryReceivedByDrone[binaryReceivedByDrone.length - 1];
    assert(lastDronePacket[5] === 44, 'Drone received MISSION_COUNT (44) frame from Browser');

    // 5.3 Drone requests item 0: MISSION_REQUEST_INT (51)
    const req0Payload = Buffer.alloc(4);
    req0Payload.writeUInt16LE(0, 0); // seq = 0
    req0Payload[2] = 255; // target_system
    req0Payload[3] = 190; // target_component
    const req0Packet = makeMavlink1Packet(51, req0Payload, 10, 1, 1);
    simulatedDroneWs.send(req0Packet, { binary: true });
    await wait(200);

    // Check status endpoint tracks lastSeqRequested
    let queryStatus = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mission/status',
      method: 'GET'
    });
    assert(queryStatus.body.job.lastSeqRequested === 0, 'Relay tracked lastSeqRequested = 0 in active mission job');

    // 5.4 Drone requests item 1 & 2
    const req2Payload = Buffer.alloc(4);
    req2Payload.writeUInt16LE(2, 0); // seq = 2
    req2Payload[2] = 255;
    req2Payload[3] = 190;
    const req2Packet = makeMavlink1Packet(51, req2Payload, 11, 1, 1);
    simulatedDroneWs.send(req2Packet, { binary: true });
    await wait(200);

    queryStatus = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mission/status',
      method: 'GET'
    });
    assert(queryStatus.body.job.lastSeqRequested === 2, 'Relay tracked progression to lastSeqRequested = 2');

    // 5.5 Drone acknowledges mission completion: MISSION_ACK (47) with ACCEPTED (0)
    // Payload: target_system (1), target_component (1), type (0 = MAV_MISSION_ACCEPTED)
    const ackPayload = Buffer.alloc(3);
    ackPayload[0] = 255;
    ackPayload[1] = 190;
    ackPayload[2] = 0; // MAV_MISSION_ACCEPTED = 0
    const ackPacket = makeMavlink1Packet(47, ackPayload, 12, 1, 1);
    simulatedDroneWs.send(ackPacket, { binary: true });
    await wait(300);

    // Verify upload job resolved to SUCCESS
    const finalJobStatus = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mission/status',
      method: 'GET'
    });
    assert(finalJobStatus.body.job.status === 'SUCCESS', 'Relay finalized active mission job status to "SUCCESS"');
    assert(finalJobStatus.body.job.lastAckResult === 0, 'Relay recorded lastAckResult = 0 (MAV_MISSION_ACCEPTED)');
    assert(finalJobStatus.body.job.durationMs >= 0, 'Relay recorded valid mission upload duration');

    // ------------------------------------------------------------------------
    // SECTION 6: Drone Disconnect Detection & Recovery
    // ------------------------------------------------------------------------
    console.log('\n▶ SECTION 6: Drone Disconnect Detection & Automatic Recovery');

    // 6.1 Abruptly close drone connection
    simulatedDroneWs.close();
    await wait(300);

    // Check /health immediately reflects offline drone
    const disconnectedHealth = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET'
    });
    assert(disconnectedHealth.body.connectorOnline === false, 'Drone disconnect detected: connectorOnline is false');
    assert(disconnectedHealth.body.esp32Online === false, 'Drone disconnect detected: esp32Online is false');

    // Check browser received disconnect status update
    const disconnectNotice = browserMessages[browserMessages.length - 1];
    assert(disconnectNotice.type === 'RELAY_STATUS' && disconnectNotice.connectorOnline === false, 'Browser received broadcast RELAY_STATUS indicating connector is offline');

    // 6.2 New mission upload attempt fails with 503
    const failUpload = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mission/upload',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ items: missionItems }));
    assert(failUpload.statusCode === 503, 'Subsequent mission upload fails with HTTP 503 while drone is offline');

    // 6.3 Reconnect drone
    simulatedDroneWs = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/connector?token=${RELAY_TOKEN}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
    simulatedDroneWs.send(JSON.stringify({
      type: 'ESP32_STATUS',
      status: 'CONNECTED',
      error: ''
    }));
    await wait(300);

    const reconnectedHealth = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/health',
      method: 'GET'
    });
    assert(reconnectedHealth.body.connectorOnline === true, 'Drone reconnection: connectorOnline is true');
    assert(reconnectedHealth.body.esp32Online === true, 'Drone reconnection: esp32Online is true');

  } finally {
    // Teardown
    if (simulatedDroneWs && simulatedDroneWs.readyState === WebSocket.OPEN) {
      simulatedDroneWs.close();
    }
    if (simulatedBrowserWs && simulatedBrowserWs.readyState === WebSocket.OPEN) {
      simulatedBrowserWs.close();
    }
    serverProcess.kill('SIGTERM');
  }

  console.log('\n===============================================================');
  console.log(`📊 BACKEND WORKFLOW RESULTS: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runComprehensiveBackendTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
