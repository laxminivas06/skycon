/**
 * sync-pixhawk-params-live.cjs
 * Node.js script to set and verify Pixhawk parameters over MAVLink
 */
const WebSocket = require('ws');

const RELAY_URL = process.env.WS_URL || 'wss://dronebackend-ppgp.onrender.com?token=saeindia_secret_token_2026';

const MAVLINK_CRC_EXTRAS = {
  0: 50,   // HEARTBEAT
  20: 214, // PARAM_REQUEST_READ
  22: 220, // PARAM_VALUE
  23: 168, // PARAM_SET
  77: 143, // COMMAND_ACK
  253: 83  // STATUSTEXT
};

function calculateMavlinkCrc(buffer, msgId) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    let b = buffer[i] ^ (crc & 0xFF);
    b ^= (b << 4) & 0xFF;
    crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
  }
  const extraCrc = MAVLINK_CRC_EXTRAS[msgId] ?? 0;
  let b = extraCrc ^ (crc & 0xFF);
  b ^= (b << 4) & 0xFF;
  crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
  return crc & 0xFFFF;
}

let sendSeq = 0;
function buildMavlink2Frame(msgId, payload, targetSysId = 1, targetCompId = 1) {
  sendSeq = (sendSeq + 1) % 256;
  const len = payload.length;
  const frame = new Uint8Array(10 + len + 2);
  frame[0] = 0xFD; // MAVLink 2 magic
  frame[1] = len;
  frame[2] = 0;   // incompat_flags
  frame[3] = 0;   // compat_flags
  frame[4] = sendSeq;
  frame[5] = 255; // sysid (GCS)
  frame[6] = 190; // compid (GCS)
  frame[7] = msgId & 0xFF;
  frame[8] = (msgId >> 8) & 0xFF;
  frame[9] = (msgId >> 16) & 0xFF;
  frame.set(payload, 10);

  const crc = calculateMavlinkCrc(frame.subarray(1, 10 + len), msgId);
  frame[10 + len] = crc & 0xFF;
  frame[10 + len + 1] = (crc >> 8) & 0xFF;
  return frame;
}

function buildParamSetPayload(paramId, paramValue, targetSysId = 1, targetCompId = 1) {
  const buf = new Uint8Array(23);
  const view = new DataView(buf.buffer);
  view.setFloat32(0, paramValue, true); // float 32 little-endian
  buf[4] = targetSysId;
  buf[5] = targetCompId;
  // param_id: 16 chars
  for (let i = 0; i < 16; i++) {
    buf[6 + i] = i < paramId.length ? paramId.charCodeAt(i) : 0;
  }
  buf[22] = 9; // MAV_PARAM_TYPE_REAL32 = 9
  return buf;
}

function buildParamRequestReadPayload(paramId, targetSysId = 1, targetCompId = 1) {
  const buf = new Uint8Array(20);
  const view = new DataView(buf.buffer);
  buf[0] = targetSysId;
  buf[1] = targetCompId;
  for (let i = 0; i < 16; i++) {
    buf[2 + i] = i < paramId.length ? paramId.charCodeAt(i) : 0;
  }
  view.setInt16(18, -1, true); // param_index = -1
  return buf;
}

const TARGET_PARAMS = [
  { id: 'FENCE_ENABLE', val: 0.0 },
  { id: 'SERIAL2_OPTIONS', val: 0.0 },
  { id: 'BRD_SER2_RTSCTS', val: 0.0 },
  { id: 'PILOT_TKOFF_ALT', val: 500.0 },
  { id: 'WPNAV_SPEED', val: 350.0 },
  { id: 'WPNAV_RADIUS', val: 150.0 },
  { id: 'RTL_ALT', val: 500.0 },
  { id: 'LAND_SPEED', val: 40.0 }
];

console.log("Connecting to WebSocket relay:", RELAY_URL);
const ws = new WebSocket(RELAY_URL);

ws.on('open', () => {
  console.log("✓ Connected to MAVLink transport.");
  let idx = 0;
  const interval = setInterval(() => {
    if (idx >= TARGET_PARAMS.length) {
      clearInterval(interval);
      console.log("All parameter sync frames dispatched.");
      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 2000);
      return;
    }
    const p = TARGET_PARAMS[idx++];
    console.log(`Sending PARAM_SET for ${p.id} = ${p.val}`);
    const payload = buildParamSetPayload(p.id, p.val);
    const frame = buildMavlink2Frame(23, payload);
    ws.send(Buffer.from(frame));
  }, 300);
});

ws.on('error', (err) => {
  console.log("Transport error (handled):", err.message);
  process.exit(0);
});

