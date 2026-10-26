/**
 * VERIFICATION TEST SUITE: Transport Connectivity, Heartbeat Watchdog & MAVLink Stream Initialization
 * 
 * Verifies all 7 critical scenarios required by the task:
 * 1. Transport disconnected: MAVLink packets rejected cleanly; no watchdog callbacks send packets.
 * 2. Transport connected but no Pixhawk heartbeat received: Drone is NOT marked connected; stream requests suppressed.
 * 3. Valid Pixhawk heartbeat received: System marks FC connected, starts watchdog, requests data streams.
 * 4. Normal telemetry streaming: Parsed correctly and telemetry state updated.
 * 5. Temporary transport interruption & reconnection: Watchdog stopped, pending requests aborted, clean recovery on reconnect.
 * 6. Repeated watchdog callbacks: Stream requests throttled with concurrency guard; no command flooding.
 * 7. Failed packet transmission followed by successful recovery: Transport bridge error handled safely, subsequent TX succeeds.
 */

declare const process: any;

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

import { mavlinkService, MAVLINK_CRC_EXTRAS } from '../frontend/src/services/mavlinkService';
import { usbHostService } from '../frontend/src/services/usbHostService';
import { transportManager } from '../frontend/src/services/transports/TransportManager';

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

/**
 * Helper to construct valid MAVLink 2.0 frames with correct CRC and CRC_EXTRA
 */
function buildMavlink2Frame(msgId: number, payload: Uint8Array, sysId: number = 1, compId: number = 1, seq: number = 0): Uint8Array {
  const len = payload.length;
  const frame = new Uint8Array(10 + len + 2);
  frame[0] = 0xFD; // MAVLink 2 Magic
  frame[1] = len;
  frame[2] = 0;    // Incompat flags
  frame[3] = 0;    // Compat flags
  frame[4] = seq;
  frame[5] = sysId;
  frame[6] = compId;
  frame[7] = msgId & 0xFF;
  frame[8] = (msgId >> 8) & 0xFF;
  frame[9] = (msgId >> 16) & 0xFF;

  frame.set(payload, 10);

  // X.25 CRC-16
  let crc = 0xFFFF;
  for (let i = 1; i < 10 + len; i++) {
    let b = frame[i] ^ (crc & 0xFF);
    b ^= (b << 4) & 0xFF;
    crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
  }
  const extraCrc = MAVLINK_CRC_EXTRAS[msgId] ?? 0;
  let b = extraCrc ^ (crc & 0xFF);
  b ^= (b << 4) & 0xFF;
  crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);

  frame[10 + len] = crc & 0xFF;
  frame[10 + len + 1] = (crc >> 8) & 0xFF;

  return frame;
}

function buildHeartbeatFrame(sysId: number = 1, compId: number = 1, isArmed: boolean = false): Uint8Array {
  const payload = new Uint8Array(9);
  const view = new DataView(payload.buffer);
  view.setUint32(0, 4 /* GUIDED mode */, true);
  view.setUint8(4, 2 /* MAV_TYPE_QUADROTOR */);
  view.setUint8(5, 3 /* MAV_AUTOPILOT_ARDUPILOTMEGA */);
  view.setUint8(6, isArmed ? 128 /* MAV_MODE_FLAG_SAFETY_ARMED */ : 0);
  view.setUint8(7, 4 /* MAV_STATE_ACTIVE */);
  view.setUint8(8, 3 /* MAVLink version */);
  return buildMavlink2Frame(0, payload, sysId, compId, 1);
}

function buildAttitudeFrame(rollRad: number, pitchRad: number, yawRad: number): Uint8Array {
  const payload = new Uint8Array(28);
  const view = new DataView(payload.buffer);
  view.setUint32(0, Date.now() & 0xFFFFFFFF, true); // time_boot_ms
  view.setFloat32(4, rollRad, true);
  view.setFloat32(8, pitchRad, true);
  view.setFloat32(12, yawRad, true);
  view.setFloat32(16, 0.0, true); // rollspeed
  view.setFloat32(20, 0.0, true); // pitchspeed
  view.setFloat32(24, 0.0, true); // yawspeed
  return buildMavlink2Frame(30, payload, 1, 1, 2);
}

function buildGlobalPositionFrame(latDeg: number, lonDeg: number, relAltM: number): Uint8Array {
  const payload = new Uint8Array(28);
  const view = new DataView(payload.buffer);
  view.setUint32(0, Date.now() & 0xFFFFFFFF, true);
  view.setInt32(4, Math.round(latDeg * 1e7), true);
  view.setInt32(8, Math.round(lonDeg * 1e7), true);
  view.setInt32(12, Math.round((relAltM + 900) * 1000), true); // alt (AMSL)
  view.setInt32(16, Math.round(relAltM * 1000), true);         // relative_alt
  view.setInt16(20, 0, true);                                  // vx
  view.setInt16(22, 0, true);                                  // vy
  view.setInt16(24, 0, true);                                  // vz
  view.setUint16(26, 9000, true);                              // hdg (90 deg * 100)
  return buildMavlink2Frame(33, payload, 1, 1, 3);
}

async function runTests() {
  console.log('\n======================================================================');
  console.log('🛸 TEST SUITE: MAVLink Transport Connectivity & Watchdog Verification');
  console.log('======================================================================\n');

  // Track all packets sent through usbHostService
  let sentPackets: Uint8Array[] = [];
  let shouldSendSucceed = true;

  // Mock usbHostService.sendBytes
  usbHostService.sendBytes = async (packet: Uint8Array): Promise<boolean> => {
    if (!shouldSendSucceed) return false;
    sentPackets.push(new Uint8Array(packet));
    return true;
  };

  // Mock transport readiness flag
  let mockTransportReady = false;
  let mockTransportConnected = false;

  (usbHostService as any).isReady = () => mockTransportReady;
  (usbHostService as any).isConnected = () => mockTransportConnected;

  // --------------------------------------------------------------------------
  console.log('▶ SCENARIO 1: Transport Disconnected');
  // --------------------------------------------------------------------------
  mockTransportReady = false;
  mockTransportConnected = false;
  await mavlinkService.cleanupMavlinkConnection();
  sentPackets = [];

  assert(usbHostService.isReady() === false, 'Transport isReady() returns false when disconnected');
  assert(usbHostService.isConnected() === false, 'Transport isConnected() returns false when disconnected');
  assert(mavlinkService.getConnectionState().isConnected === false, 'MAVLink connectionState.isConnected is false');

  // Attempting to send COMMAND_LONG (e.g. CMD_511) when disconnected
  const txResultCmdLong = await mavlinkService.sendMavlinkCommandLong(511, 33, 1000000);
  assert(txResultCmdLong === false, 'sendMavlinkCommandLong suppressed when transport is disconnected (returns false)');
  assert(sentPackets.length === 0, 'No binary packets dispatched through transport bridge when disconnected');

  // Attempting to send COMMAND_INT when disconnected
  const txResultCmdInt = await mavlinkService.sendMavlinkCommandInt(75);
  assert(txResultCmdInt === false, 'sendMavlinkCommandInt suppressed when transport is disconnected (returns false)');
  assert(sentPackets.length === 0, 'Zero packets dispatched for COMMAND_INT when disconnected');

  // Calling requestMavlinkDataStreams when disconnected
  mavlinkService.requestMavlinkDataStreams();
  assert(sentPackets.length === 0, 'requestMavlinkDataStreams suppresses packet sending when disconnected');

  // Calling checkHeartbeatWatchdog when disconnected
  (mavlinkService as any).checkHeartbeatWatchdog();
  assert(sentPackets.length === 0, 'checkHeartbeatWatchdog suppresses packet sending when disconnected');

  // --------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 2: Transport Connected But No Flight Controller Heartbeat');
  // --------------------------------------------------------------------------
  mockTransportReady = true;
  mockTransportConnected = true;
  sentPackets = [];

  // Transport bridge opened (e.g. WebSocket open / SERIAL_OPEN)
  (mavlinkService as any).handleUsbHostStateChange(
    'USB_CONNECTED',
    'Serial port opened at 57600 baud',
    { productName: 'Pixhawk 2.4.8', vendorId: 0x26AC, productId: 0x0011 }
  );

  // Verify: Drone must NOT be marked connected merely because transport is open
  const connStateScenario2 = mavlinkService.getConnectionState();
  assert(connStateScenario2.isConnected === false, 'Drone is NOT marked as connected prior to Pixhawk heartbeat');
  assert(connStateScenario2.phase === 'SERIAL_OPEN', 'Connection phase is SERIAL_OPEN awaiting heartbeat');
  assert(mavlinkService.getTelemetry().pixhawkConnected === false, 'Telemetry pixhawkConnected is strictly false');

  // Heartbeat watchdog must NOT be active or sending packets
  (mavlinkService as any).checkHeartbeatWatchdog();
  assert(sentPackets.filter(p => p.length === 45).length === 0, 'No 45-byte COMMAND_LONG stream requests sent before FC heartbeat');

  // Explicit requestMavlinkDataStreams must also guard against sending before FC connection
  mavlinkService.requestMavlinkDataStreams();
  assert(sentPackets.filter(p => p.length === 45).length === 0, 'requestMavlinkDataStreams blocked before FC heartbeat');

  // GCS heartbeat is allowed to establish link
  const gcsHeartbeatSent = await mavlinkService.sendGcsHeartbeat();
  assert(gcsHeartbeatSent === true, 'sendGcsHeartbeat succeeds over ready transport to solicit FC response');
  assert(sentPackets.length > 0 && sentPackets[0][5] === 0, 'GCS Heartbeat packet (msgId 0) dispatched to FC');

  // --------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 3: Valid Pixhawk Heartbeat Received');
  // --------------------------------------------------------------------------
  sentPackets = [];
  const validHeartbeat = buildHeartbeatFrame(1, 1, false);

  // Parse valid FC heartbeat frame
  mavlinkService.parseMavlinkStream(validHeartbeat);

  // Wait for async requestMavlinkDataStreams loop to dispatch packets
  await new Promise(r => setTimeout(r, 100));

  const connStateScenario3 = mavlinkService.getConnectionState();
  assert(connStateScenario3.isConnected === true, 'MAVLink connectionState.isConnected is now true');
  assert(connStateScenario3.phase === 'PIXHAWK_CONNECTED', 'Connection phase updated to PIXHAWK_CONNECTED');
  assert(mavlinkService.getTelemetry().pixhawkConnected === true, 'Telemetry pixhawkConnected is now true');
  assert(connStateScenario3.systemId === 1, 'Target System ID identified as 1');
  assert(connStateScenario3.componentId === 1, 'Target Component ID identified as 1');
  assert(connStateScenario3.autopilotType === 'MAV_AUTOPILOT_ARDUPILOT', 'Autopilot identified as MAV_AUTOPILOT_ARDUPILOT');

  // Verify watchdog is now active
  assert((mavlinkService as any).heartbeatWatchdogTimer !== null, 'Heartbeat watchdog timer is successfully started');

  // Verify stream requests were dispatched upon receiving valid heartbeat
  const streamPackets = sentPackets.filter(p => p.length === 45); // COMMAND_LONG MAVLink 2 frames
  assert(streamPackets.length > 0, `MAVLink data stream requests dispatched upon valid heartbeat (${streamPackets.length} CMD_LONG packets)`);

  // Verify packet framing: 45 bytes, magic 0xFD, msgId 76 (COMMAND_LONG)
  const firstCmdLong = streamPackets[0];
  assert(firstCmdLong[0] === 0xFD, 'MAVLink 2 magic byte verified (0xFD)');
  assert(firstCmdLong[1] === 33, 'COMMAND_LONG payload length verified (33 bytes)');
  const msgIdParsed = firstCmdLong[7] | (firstCmdLong[8] << 8) | (firstCmdLong[9] << 16);
  assert(msgIdParsed === 76, 'MAVLink Message ID verified as 76 (COMMAND_LONG)');
  assert(firstCmdLong.length === 45, 'Total packet size verified as 45 bytes (10 header + 33 payload + 2 CRC)');

  // --------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 4: Normal Telemetry Streaming');
  // --------------------------------------------------------------------------
  // Feed Attitude frame (roll = 0.1 rad (~5.7°), pitch = -0.05 rad (~-2.9°), yaw = 1.57 rad (~90°))
  const attitudeFrame = buildAttitudeFrame(0.1, -0.05, 1.57);
  mavlinkService.parseMavlinkStream(attitudeFrame);

  const telemAttitude = mavlinkService.getTelemetry();
  assert(Math.abs((telemAttitude.roll ?? 0) - 5.73) < 0.1, `Roll angle parsed correctly: ${(telemAttitude.roll ?? 0).toFixed(1)}°`);
  assert(Math.abs((telemAttitude.pitch ?? 0) - (-2.86)) < 0.1, `Pitch angle parsed correctly: ${(telemAttitude.pitch ?? 0).toFixed(1)}°`);
  assert(Math.abs(telemAttitude.heading - 90) < 1.0, `Heading parsed correctly: ${telemAttitude.heading}°`);

  // Feed Global Position frame (lat = 12.9716, lon = 77.5946, alt = 15m)
  const globalPosFrame = buildGlobalPositionFrame(12.9716, 77.5946, 15.0);
  mavlinkService.parseMavlinkStream(globalPosFrame);

  const telemPos = mavlinkService.getTelemetry();
  assert(Math.abs(telemPos.latitude - 12.9716) < 0.0001, `Latitude parsed correctly: ${telemPos.latitude.toFixed(6)}`);
  assert(Math.abs(telemPos.longitude - 77.5946) < 0.0001, `Longitude parsed correctly: ${telemPos.longitude.toFixed(6)}`);
  assert(Math.abs(telemPos.altitude - 15.0) < 0.1, `Altitude parsed correctly: ${telemPos.altitude.toFixed(1)}m`);

  // --------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 5: Temporary Transport Interruption & Reconnection');
  // --------------------------------------------------------------------------
  sentPackets = [];

  // Transport drops
  mockTransportReady = false;
  mockTransportConnected = false;
  (mavlinkService as any).handleUsbHostStateChange(
    'CONNECTION_LOST',
    'WebSocket or physical cable disconnected'
  );

  assert(mavlinkService.getConnectionState().isConnected === false, 'MAVLink marked disconnected on link drop');
  assert(mavlinkService.getTelemetry().pixhawkConnected === false, 'Telemetry pixhawkConnected set to false');
  assert((mavlinkService as any).heartbeatWatchdogTimer === null, 'Heartbeat watchdog stopped on disconnect');
  assert((mavlinkService as any).isStreamRequestInFlight === false, 'In-flight stream requests cleanly cleared');

  // Verify that during interruption, watchdog invocation produces zero packet transmission
  (mavlinkService as any).checkHeartbeatWatchdog();
  assert(sentPackets.length === 0, 'No packets sent by watchdog during transport interruption');

  // Reconnection occurs
  mockTransportReady = true;
  mockTransportConnected = true;
  (mavlinkService as any).handleUsbHostStateChange(
    'USB_CONNECTED',
    'Transport bridge re-established'
  );

  // Reconnection phase: SERIAL_OPEN before any FC packets
  assert(mavlinkService.getConnectionState().phase === 'SERIAL_OPEN', 'Post-reconnect phase is SERIAL_OPEN');
  assert(mavlinkService.getConnectionState().isConnected === false, 'FC not marked connected until new heartbeat');

  // Feed heartbeat again
  sentPackets = [];
  (mavlinkService as any).lastStreamRequestTime = 0; // Reset throttle for test
  mavlinkService.parseMavlinkStream(validHeartbeat);
  await new Promise(r => setTimeout(r, 100));

  assert(mavlinkService.getConnectionState().isConnected === true, 'Successfully recovered connection on new heartbeat');
  assert((mavlinkService as any).heartbeatWatchdogTimer !== null, 'Heartbeat watchdog successfully restarted');
  assert(sentPackets.filter(p => p.length === 45).length > 0, 'Stream requests resumed cleanly after reconnection');

  // --------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 6: Repeated Watchdog Callbacks (No Command Flooding)');
  // --------------------------------------------------------------------------
  sentPackets = [];
  const initialSentCount = (mavlinkService.getConnectionState() as any).bytesSent || 0;

  // Fire checkHeartbeatWatchdog 10 times in immediate succession
  for (let i = 0; i < 10; i++) {
    (mavlinkService as any).checkHeartbeatWatchdog();
  }

  // With fresh GPS data (< 5000ms old), watchdog must NOT trigger stream requests repeatedly
  assert(sentPackets.length === 0, 'Repeated watchdog callbacks do NOT flood commands when telemetry is healthy');

  // Simulate stale GPS age (> 5000ms) and test in-flight locking
  (mavlinkService as any).telemetry.gps.lastUpdated = Date.now() - 6000;
  (mavlinkService as any).lastStreamRequestTime = 0; // Stale

  sentPackets = [];
  (mavlinkService as any).checkHeartbeatWatchdog();
  const packetsFirstTrigger = sentPackets.length;
  assert(packetsFirstTrigger > 0, 'Watchdog triggered stream refresh for stale GPS');

  // Second immediate watchdog call while stream request is in flight or throttled
  sentPackets = [];
  (mavlinkService as any).checkHeartbeatWatchdog();
  assert(sentPackets.length === 0, 'Immediate subsequent watchdog call suppressed by throttle / in-flight guard');

  // --------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 7: Failed Packet Transmission Followed by Successful Recovery');
  // --------------------------------------------------------------------------
  // Cancel any lingering stream requests before scenario 7 test
  (mavlinkService as any).cancelPendingStreamRequests();
  await new Promise(r => setTimeout(r, 50));

  // Simulate bridge failure (e.g. transport buffer full, socket closing)
  shouldSendSucceed = false;

  const failedTx = await mavlinkService.sendMavlinkCommandLong(511, 33, 1000000);
  assert(failedTx === false, 'sendMavlinkCommandLong handles transport failure gracefully (returns false, no throw)');

  // Transport recovers
  shouldSendSucceed = true;
  sentPackets = [];

  const recoveredTx = await mavlinkService.sendMavlinkCommandLong(511, 33, 1000000);
  assert(recoveredTx === true, 'sendMavlinkCommandLong succeeds after transport bridge recovers');
  assert(sentPackets.some(p => p.length === 45), 'Recovered 45-byte MAVLink packet sent successfully');

  // Clean shutdown
  await mavlinkService.cleanupMavlinkConnection();

  console.log('\n======================================================================');
  console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
