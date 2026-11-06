const WebSocket = require('ws');

const ws = new WebSocket('wss://dronebackend-ppgp.onrender.com?token=saeindia_secret_token_2026');

console.log('Connecting to wss://dronebackend-ppgp.onrender.com ...');

const MAVLINK_CRC_EXTRAS = {
  0: 50,   // HEARTBEAT
  1: 124,  // SYS_STATUS
  2: 137,  // SYSTEM_TIME
  4: 237,  // PING
  11: 89,  // SET_MODE
  20: 214, // PARAM_REQUEST_READ
  21: 159, // PARAM_REQUEST_LIST
  22: 220, // PARAM_VALUE
  23: 168, // PARAM_SET
  24: 24,  // GPS_RAW_INT
  29: 115, // SCALED_PRESSURE
  30: 39,  // ATTITUDE
  32: 185, // LOCAL_POSITION_NED
  33: 104, // GLOBAL_POSITION_INT
  36: 222, // SERVO_OUTPUT_RAW
  39: 254, // MISSION_ITEM
  40: 230, // MISSION_REQUEST
  42: 28,  // MISSION_SET_CURRENT
  43: 132, // MISSION_REQUEST_LIST
  44: 221, // MISSION_COUNT
  45: 232, // MISSION_CLEAR_ALL
  46: 11,  // MISSION_ITEM_REACHED
  47: 153, // MISSION_ACK
  51: 196, // MISSION_REQUEST_INT
  62: 183, // NAV_CONTROLLER_OUTPUT
  65: 118, // RC_CHANNELS
  66: 148, // REQUEST_DATA_STREAM
  73: 38,  // MISSION_ITEM_INT
  74: 20,  // VFR_HUD
  75: 158, // COMMAND_INT
  76: 152, // COMMAND_LONG
  77: 143, // COMMAND_ACK
  124: 87, // GPS2_RAW
  125: 203, // POWER_STATUS
  147: 154, // BATTERY_STATUS
  163: 187, // AHRS2
  168: 21,  // WIND
  242: 104, // HOME_POSITION
  253: 83  // STATUSTEXT
};

function calculateMavlinkCrc(buffer, msgId) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    let b = buffer[i] ^ (crc & 0xFF);
    b ^= (b << 4) & 0xFF;
    crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
  }
  const extraCrc = MAVLINK_CRC_EXTRAS[msgId] ?? 152;
  let b = extraCrc ^ (crc & 0xFF);
  b ^= (b << 4) & 0xFF;
  crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
  return crc & 0xFFFF;
}

let sendSeq = 0;
function buildMavlink2Frame(msgId, payload) {
  sendSeq = (sendSeq + 1) % 256;
  const len = payload.length;
  const frame = new Uint8Array(10 + len + 2);
  frame[0] = 0xFD;
  frame[1] = len;
  frame[2] = 0;
  frame[3] = 0;
  frame[4] = sendSeq;
  frame[5] = 255;
  frame[6] = 190;
  frame[7] = msgId & 0xFF;
  frame[8] = (msgId >> 8) & 0xFF;
  frame[9] = (msgId >> 16) & 0xFF;
  frame.set(payload, 10);
  const crc = calculateMavlinkCrc(frame.subarray(1, 10 + len), msgId);
  frame[10 + len] = crc & 0xFF;
  frame[10 + len + 1] = (crc >> 8) & 0xFF;
  return frame;
}

const COMMAND_ACK_RESULTS = {
  0: 'ACCEPTED (Command executed or accepted)',
  1: 'TEMPORARILY_REJECTED (Busy or transient lock)',
  2: 'DENIED (Pre-arm checks failed or safety active)',
  3: 'UNSUPPORTED (Autopilot does not implement this command)',
  4: 'FAILED (Action attempted but failed)',
  5: 'IN_PROGRESS (Command in execution)',
  6: 'CANCELLED (Command cancelled by system)'
};

const COMMAND_NAMES = {
  400: 'MAV_CMD_COMPONENT_ARM_DISARM',
  176: 'MAV_CMD_DO_SET_MODE',
  20: 'MAV_CMD_NAV_RETURN_TO_LAUNCH',
  21: 'MAV_CMD_NAV_LAND',
  22: 'MAV_CMD_NAV_TAKEOFF',
  300: 'MAV_CMD_MISSION_START'
};

let rxBuffer = Buffer.alloc(0);
let pixhawkSysId = 1;
let pixhawkCompId = 1;
let heartbeatReceived = false;

ws.on('open', () => {
  console.log('Connected to Render backend WSS relay!');
});

ws.on('message', (data) => {
  const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
  rxBuffer = Buffer.concat([rxBuffer, chunk]);

  let offset = 0;
  while (offset < rxBuffer.length) {
    const magic = rxBuffer[offset];
    if (magic !== 0xFE && magic !== 0xFD) {
      offset++;
      continue;
    }

    const remaining = rxBuffer.length - offset;

    if (magic === 0xFE) {
      if (remaining < 6) break;
      const payloadLen = rxBuffer[offset + 1];
      const packetLen = 6 + payloadLen + 2;
      if (remaining < packetLen) break;

      const msgId = rxBuffer[offset + 5];
      if (MAVLINK_CRC_EXTRAS[msgId] !== undefined) {
        const rxCrc = rxBuffer.readUInt16LE(offset + 6 + payloadLen);
        const calcCrc = calculateMavlinkCrc(rxBuffer.slice(offset + 1, offset + 6 + payloadLen), msgId);
        if (rxCrc !== calcCrc) {
          offset++;
          continue;
        }
      } else {
        offset++;
        continue;
      }

      const sysId = rxBuffer[offset + 3];
      const compId = rxBuffer[offset + 4];
      const payload = rxBuffer.slice(offset + 6, offset + 6 + payloadLen);
      handleMessage(msgId, payload, sysId, compId, 'MAVLink 1');
      offset += packetLen;
      continue;
    }

    if (magic === 0xFD) {
      if (remaining < 10) break;
      const payloadLen = rxBuffer[offset + 1];
      const incompatFlags = rxBuffer[offset + 2];
      const signatureLen = (incompatFlags & 0x01) ? 13 : 0;
      const packetLen = 10 + payloadLen + 2 + signatureLen;
      if (remaining < packetLen) break;

      const msgId = rxBuffer[offset + 7] | (rxBuffer[offset + 8] << 8) | (rxBuffer[offset + 9] << 16);
      if (MAVLINK_CRC_EXTRAS[msgId] !== undefined) {
        const rxCrc = rxBuffer.readUInt16LE(offset + 10 + payloadLen);
        const calcCrc = calculateMavlinkCrc(rxBuffer.slice(offset + 1, offset + 10 + payloadLen), msgId);
        if (rxCrc !== calcCrc) {
          offset++;
          continue;
        }
      } else {
        offset++;
        continue;
      }

      const sysId = rxBuffer[offset + 5];
      const compId = rxBuffer[offset + 6];
      const payload = rxBuffer.slice(offset + 10, offset + 10 + payloadLen);
      handleMessage(msgId, payload, sysId, compId, 'MAVLink 2');
      offset += packetLen;
      continue;
    }
  }

  if (offset > 0) {
    rxBuffer = rxBuffer.slice(offset);
  }
});

function handleMessage(msgId, payload, sysId, compId, ver) {
  if (msgId === 0) {
    const customMode = payload.readUInt32LE(0);
    const baseMode = payload[6];
    const systemStatus = payload[7];
    const isArmed = (baseMode & 128) !== 0;

    if (!heartbeatReceived) {
      heartbeatReceived = true;
      pixhawkSysId = sysId;
      pixhawkCompId = compId;
      console.log(`\n=========================================================`);
      console.log(`[AUTOPILOT DETECTED] sys=${sysId} comp=${compId} | Armed=${isArmed} | CustomMode=${customMode} | SysStatus=${systemStatus}`);
      console.log(`=========================================================`);

      // Trigger test sequence
      setTimeout(runDiagnosticCommands, 1000);
    }
  } else if (msgId === 253) { // STATUSTEXT
    const sev = payload[0];
    let end = payload.indexOf(0, 1);
    if (end === -1) end = payload.length;
    const text = payload.slice(1, end).toString('utf8');
    const sevNames = ['EMERGENCY', 'ALERT', 'CRITICAL', 'ERROR', 'WARNING', 'NOTICE', 'INFO', 'DEBUG'];
    console.log(`🔴 [STATUSTEXT sev=${sev} (${sevNames[sev] || sev})] "${text}"`);
  } else if (msgId === 77) { // COMMAND_ACK
    const cmd = payload.readUInt16LE(0);
    const result = payload[2];
    const cmdName = COMMAND_NAMES[cmd] || `CMD_${cmd}`;
    const resultName = COMMAND_ACK_RESULTS[result] || `RESULT_${result}`;
    console.log(`\n⚡ [COMMAND_ACK] Command=${cmdName} (${cmd}) --> Result=${resultName} (code ${result})`);
  } else if (msgId === 47) { // MISSION_ACK
    const type = payload[2];
    const missionTypes = {
      0: 'ACCEPTED', 1: 'ERROR', 2: 'UNSUPPORTED_FRAME', 3: 'UNSUPPORTED',
      4: 'NO_SPACE', 5: 'INVALID', 13: 'INVALID_SEQUENCE', 14: 'DENIED', 15: 'CANCELLED'
    };
    console.log(`\n📋 [MISSION_ACK] Result=${missionTypes[type] || type} (code ${type})`);
  } else if (msgId === 1) { // SYS_STATUS
    const sensorsPresent = payload.readUInt32LE(0);
    const sensorsEnabled = payload.readUInt32LE(4);
    const sensorsHealth = payload.readUInt32LE(8);
    const load = payload.readUInt16LE(12) / 10;
    const voltage = payload.readUInt16LE(14) / 1000;
    const current = payload.readInt16LE(16) / 100;
    const dropRate = payload.readUInt16LE(20) / 100;
    console.log(`[SYS_STATUS] Battery: ${voltage.toFixed(2)}V, Current: ${current.toFixed(1)}A, Load: ${load.toFixed(1)}%, DropRate: ${dropRate}%`);
  } else if (msgId === 24) { // GPS_RAW_INT
    const fix = payload[28];
    const sats = payload[29];
    const eph = payload.readUInt16LE(30) / 100; // HDOP
    const lat = payload.readInt32LE(8) / 1e7;
    const lon = payload.readInt32LE(12) / 1e7;
    console.log(`[GPS] Fix=${fix} (3=3D), Sats=${sats}, HDOP=${eph}m, Pos=(${lat.toFixed(6)}, ${lon.toFixed(6)})`);
  }
}

function sendCommandLong(command, p1, p2, p3, p4, p5, p6, p7) {
  const payload = new Uint8Array(33);
  const view = new DataView(payload.buffer);
  view.setFloat32(0, p1 || 0, true);
  view.setFloat32(4, p2 || 0, true);
  view.setFloat32(8, p3 || 0, true);
  view.setFloat32(12, p4 || 0, true);
  view.setFloat32(16, p5 || 0, true);
  view.setFloat32(20, p6 || 0, true);
  view.setFloat32(24, p7 || 0, true);
  view.setUint16(28, command, true);
  view.setUint8(30, pixhawkSysId);
  view.setUint8(31, pixhawkCompId);
  view.setUint8(32, 0); // confirmation

  const frame = buildMavlink2Frame(76 /* COMMAND_LONG */, payload);
  ws.send(frame, { binary: true });
}

function runDiagnosticCommands() {
  console.log('\n=========================================================');
  console.log('🧪 RUNNING COMMAND REJECTION PROBE...');
  console.log('=========================================================');

  // Test 1: Query Arming (ARM with p1=1)
  console.log('👉 [PROBE 1] Sending MAV_CMD_COMPONENT_ARM_DISARM (p1=1: ARM)...');
  sendCommandLong(400, 1, 0, 0, 0, 0, 0, 0);

  // Test 2: Try switching mode to GUIDED (mode 4) after 3s
  setTimeout(() => {
    console.log('\n👉 [PROBE 2] Sending MAV_CMD_DO_SET_MODE to GUIDED (mode 4)...');
    sendCommandLong(176, 1 /* MAV_MODE_FLAG_CUSTOM_MODE_ENABLED */, 4 /* GUIDED */, 0, 0, 0, 0, 0);
  }, 3000);

  // Test 3: Try switching mode to AUTO (mode 3) after 6s
  setTimeout(() => {
    console.log('\n👉 [PROBE 3] Sending MAV_CMD_DO_SET_MODE to AUTO (mode 3)...');
    sendCommandLong(176, 1, 3 /* AUTO */, 0, 0, 0, 0, 0);
  }, 6000);
}

setTimeout(() => {
  console.log('\nProbe finished after 12s.');
  ws.close();
  process.exit(0);
}, 12000);

