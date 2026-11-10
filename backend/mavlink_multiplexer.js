/**
 * S500-AeroRecon Communications Hub — MAVLink v2 Binary Multiplexer & Demultiplexer
 * 
 * Provides zero-copy binary unpacking for high-rate MAVLink v2 (and v1) packets:
 * - HEARTBEAT (#0): Armed state (base_mode & 0x80), flight mode string & integer
 * - SYS_STATUS (#1): Voltage in mV, USB power rail sag check (<4400 mV), CPU load
 * - GPS_RAW_INT (#24): Lat/Lon, HDOP, fix type, satellites visible
 * - ATTITUDE (#30): Roll, pitch, yaw radians and angular velocities
 * - GLOBAL_POSITION_INT (#33): Lat/Lon, relative alt AGL, MSL alt, vertical speed Vz, heading
 * - STATUSTEXT (#253): Severity, ASCII message, buffer for error correlation
 * - COMMAND_ACK (#77): Command ID, MAV_RESULT code, progress
 * 
 * Maintains a 1000-frame circular buffer for /api/telemetry/history and broadcasts
 * structured JSON telemetry to connected GCS browsers.
 */

// ArduCopter flight mode mapping
export const COPTER_MODES = {
  0: 'STABILIZE',
  1: 'ACRO',
  2: 'ALT_HOLD',
  3: 'AUTO',
  4: 'GUIDED',
  5: 'LOITER',
  6: 'RTL',
  7: 'CIRCLE',
  9: 'LAND',
  11: 'DRIFT',
  13: 'SPORT',
  14: 'FLIP',
  15: 'AUTOTUNE',
  16: 'POSHOLD',
  17: 'BRAKE',
  18: 'THROW',
  19: 'AVOID_ADSB',
  20: 'GUIDED_NOGPS',
  21: 'SMART_RTL',
  22: 'FLOWHOLD',
  23: 'FOLLOW',
  24: 'ZIGZAG',
  25: 'SYSTEMID',
  26: 'AUTOROTATE',
  27: 'AUTO_RTL'
};

// Inverted map for mode names -> numeric mode
export const MODE_NAME_TO_INT = Object.entries(COPTER_MODES).reduce((acc, [k, v]) => {
  acc[v] = Number(k);
  return acc;
}, {});

// MAV_RESULT enumeration
export const MAV_RESULT = {
  0: 'MAV_RESULT_ACCEPTED',
  1: 'MAV_RESULT_TEMPORARILY_REJECTED',
  2: 'MAV_RESULT_DENIED',
  3: 'MAV_RESULT_UNSUPPORTED',
  4: 'MAV_RESULT_FAILED',
  5: 'MAV_RESULT_IN_PROGRESS',
  6: 'MAV_RESULT_CANCELLED'
};

// MAVLink CRC-EXTRA table for known messages
export const CRC_EXTRA = {
  0: 50,     // HEARTBEAT
  1: 124,    // SYS_STATUS
  20: 214,   // PARAM_REQUEST_READ
  21: 159,   // PARAM_REQUEST_LIST
  22: 220,   // PARAM_VALUE
  23: 168,   // PARAM_SET
  24: 24,    // GPS_RAW_INT
  30: 39,    // ATTITUDE
  33: 104,   // GLOBAL_POSITION_INT
  39: 254,   // MISSION_ITEM
  40: 230,   // MISSION_REQUEST
  44: 221,   // MISSION_COUNT
  47: 153,   // MISSION_ACK
  51: 196,   // MISSION_REQUEST_INT
  73: 38,    // MISSION_ITEM_INT
  76: 152,   // COMMAND_LONG
  77: 143,   // COMMAND_ACK
  253: 83    // STATUSTEXT
};

/**
 * X.25 CRC-16 implementation matching MAVLink specification
 */
export function calculateMavlinkCrc(buffer, start, length, extra) {
  let crc = 0xFFFF;
  for (let i = start; i < start + length; i++) {
    let tmp = (buffer[i] ^ (crc & 0xFF)) & 0xFF;
    tmp = (tmp ^ (tmp << 4)) & 0xFF;
    crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF;
  }
  if (typeof extra === 'number') {
    let tmp = (extra ^ (crc & 0xFF)) & 0xFF;
    tmp = (tmp ^ (tmp << 4)) & 0xFF;
    crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF;
  }
  return crc;
}

/**
 * Circular Buffer of fixed capacity for high-throughput frame caching
 */
export class CircularBuffer {
  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  toArray(limit = null) {
    const count = limit ? Math.min(limit, this.size) : this.size;
    const result = new Array(count);
    let startIdx = (this.head - count + this.capacity) % this.capacity;
    for (let i = 0; i < count; i++) {
      result[i] = this.buffer[(startIdx + i) % this.capacity];
    }
    return result;
  }

  clear() {
    this.head = 0;
    this.size = 0;
    this.buffer.fill(null);
  }
}

/**
 * High-Throughput MAVLink Multiplexer & Demultiplexer
 */
export class MavlinkMultiplexer {
  constructor(options = {}) {
    this.historyBuffer = new CircularBuffer(options.historyLimit || 1000);
    this.recentStatusTexts = [];
    this.statusTextRetentionMs = options.statusTextRetentionMs || 10000;

    // Callbacks
    this.onAckCallback = options.onCommandAck || null;
    this.onTelemetryCallback = options.onTelemetryFrame || null;
    this.onStatusTextCallback = options.onStatusText || null;
    this.onMissionEventCallback = options.onMissionEvent || null;

    // Current consolidated drone telemetry state
    this.state = {
      timestamp: Date.now(),
      lastHeartbeatTime: 0,
      armed: false,
      flightMode: 'UNKNOWN',
      customModeInt: 0,
      baseMode: 0,
      systemStatus: 0,
      attitude: {
        roll: 0.0,
        pitch: 0.0,
        yaw: 0.0,
        rollspeed: 0.0,
        pitchspeed: 0.0,
        yawspeed: 0.0
      },
      position: {
        lat: 0.0,
        lon: 0.0,
        altAgl: 0.0,
        altMsl: 0.0,
        vx: 0.0,
        vy: 0.0,
        vz: 0.0,
        headingDeg: 0.0
      },
      health: {
        voltageBatteryMv: 0,
        currentBatteryA: 0.0,
        batteryRemaining: -1,
        usbPowerSag: false,
        cpuLoad: 0.0,
        satellites: 0,
        hdop: 99.9,
        vdop: 99.9,
        fixType: 0,
        groundSpeed: 0.0
      }
    };
  }

  /**
   * Returns copy of the consolidated telemetry state
   */
  getState() {
    return {
      type: 'TELEMETRY_FRAME',
      timestamp: this.state.timestamp,
      armed: this.state.armed,
      flightMode: this.state.flightMode,
      attitude: { ...this.state.attitude },
      position: { ...this.state.position },
      health: { ...this.state.health }
    };
  }

  /**
   * Returns recent telemetry frames from the circular buffer
   */
  getHistory(limit = 1000) {
    return this.historyBuffer.toArray(limit);
  }

  /**
   * Returns recent STATUSTEXT messages received within the time window
   */
  getRecentStatusTexts(windowMs = 3000) {
    const cutoff = Date.now() - windowMs;
    return this.recentStatusTexts.filter(s => s.timestamp >= cutoff);
  }

  /**
   * Main demultiplexer entry point:
   * Inspects and decodes zero-copy binary buffer for MAVLink v1 / v2 frames
   */
  demultiplex(buffer, direction = 'RX') {
    if (!buffer || buffer.length < 8) return [];
    const events = [];
    let offset = 0;
    const bufLen = buffer.length;

    while (offset + 8 <= bufLen) {
      const magic = buffer[offset];
      let msgId = -1;
      let sysId = -1;
      let compId = -1;
      let payloadLen = 0;
      let payloadOffset = 0;
      let packetLen = 0;
      let isV2 = false;

      if (magic === 0xFE && offset + 8 <= bufLen) {
        // MAVLink 1.0 (Header = 6 bytes)
        payloadLen = buffer[offset + 1];
        packetLen = payloadLen + 8;
        if (offset + packetLen > bufLen) break;
        sysId = buffer[offset + 3];
        compId = buffer[offset + 4];
        msgId = buffer[offset + 5];
        payloadOffset = offset + 6;
      } else if (magic === 0xFD && offset + 12 <= bufLen) {
        // MAVLink 2.0 (Header = 10 bytes)
        isV2 = true;
        payloadLen = buffer[offset + 1];
        const incompatFlags = buffer[offset + 2];
        const signatureLen = (incompatFlags & 0x01) ? 13 : 0;
        packetLen = payloadLen + 12 + signatureLen;
        if (offset + packetLen > bufLen) break;
        sysId = buffer[offset + 5];
        compId = buffer[offset + 6];
        msgId = buffer[offset + 7] | (buffer[offset + 8] << 8) | (buffer[offset + 9] << 16);
        payloadOffset = offset + 10;
      } else {
        offset++;
        continue;
      }

      // Process parsed packet
      const event = this.decodeMessage(buffer, payloadOffset, payloadLen, msgId, sysId, compId, isV2, direction);
      if (event) {
        events.push(event);
      }

      offset += packetLen;
    }

    return events;
  }

  /**
   * Zero-copy decoder for individual MAVLink messages
   */
  decodeMessage(buf, pOffset, pLen, msgId, sysId, compId, isV2, direction) {
    const now = Date.now();
    let stateChanged = false;
    let resultEvent = null;

    switch (msgId) {
      // ----------------------------------------------------------------------
      // HEARTBEAT (ID #0)
      // ----------------------------------------------------------------------
      case 0: {
        if (pLen >= 9) {
          const customMode = buf.readUInt32LE(pOffset);
          const baseMode = buf[pOffset + 6];
          const systemStatus = buf[pOffset + 7];

          this.state.timestamp = now;
          this.state.lastHeartbeatTime = now;
          this.state.baseMode = baseMode;
          this.state.customModeInt = customMode;
          this.state.systemStatus = systemStatus;
          this.state.armed = (baseMode & 0x80) !== 0;
          this.state.flightMode = COPTER_MODES[customMode] || `MODE_${customMode}`;

          stateChanged = true;
          resultEvent = { type: 'HEARTBEAT', armed: this.state.armed, mode: this.state.flightMode, customMode };
        }
        break;
      }

      // ----------------------------------------------------------------------
      // SYS_STATUS (ID #1)
      // ----------------------------------------------------------------------
      case 1: {
        if (pLen >= 31) {
          const loadRaw = buf.readUInt16LE(pOffset + 12);
          const voltageBatteryMv = buf.readUInt16LE(pOffset + 14);
          const currentBatteryRaw = buf.readInt16LE(pOffset + 16);
          const batteryRemaining = buf.readInt8(pOffset + 18);

          this.state.health.cpuLoad = +(loadRaw / 10.0).toFixed(1);
          this.state.health.voltageBatteryMv = voltageBatteryMv;
          this.state.health.currentBatteryA = +(currentBatteryRaw / 100.0).toFixed(2);
          this.state.health.batteryRemaining = batteryRemaining;

          // Critical USB Rail Sag detection (<4.40V = 4400 mV)
          this.state.health.usbPowerSag = (voltageBatteryMv > 0 && voltageBatteryMv < 4400);

          stateChanged = true;
          resultEvent = {
            type: 'SYS_STATUS',
            voltageMv: voltageBatteryMv,
            usbPowerSag: this.state.health.usbPowerSag,
            cpuLoad: this.state.health.cpuLoad,
            batteryRemaining
          };
        }
        break;
      }

      // ----------------------------------------------------------------------
      // GPS_RAW_INT (ID #24)
      // ----------------------------------------------------------------------
      case 24: {
        if (pLen >= 30) {
          const lat = buf.readInt32LE(pOffset + 8) / 1e7;
          const lon = buf.readInt32LE(pOffset + 12) / 1e7;
          const altMsl = buf.readInt32LE(pOffset + 16) / 1000.0;
          const eph = buf.readUInt16LE(pOffset + 20) / 100.0; // HDOP in meters
          const epv = buf.readUInt16LE(pOffset + 22) / 100.0; // VDOP in meters
          const vel = buf.readUInt16LE(pOffset + 24) / 100.0; // m/s
          const fixType = buf[pOffset + 28];
          const satellites = buf[pOffset + 29];

          this.state.health.satellites = satellites;
          this.state.health.hdop = +eph.toFixed(2);
          this.state.health.vdop = +epv.toFixed(2);
          this.state.health.fixType = fixType;
          this.state.health.groundSpeed = +vel.toFixed(2);

          // If position not yet set from GLOBAL_POSITION_INT, seed with GPS_RAW_INT
          if (this.state.position.lat === 0 && this.state.position.lon === 0 && (lat !== 0 || lon !== 0)) {
            this.state.position.lat = +lat.toFixed(7);
            this.state.position.lon = +lon.toFixed(7);
            this.state.position.altMsl = +altMsl.toFixed(2);
          }

          stateChanged = true;
          resultEvent = { type: 'GPS_RAW_INT', lat, lon, satellites, hdop: eph, fixType };
        }
        break;
      }

      // ----------------------------------------------------------------------
      // ATTITUDE (ID #30)
      // ----------------------------------------------------------------------
      case 30: {
        if (pLen >= 28) {
          const roll = buf.readFloatLE(pOffset + 4);
          const pitch = buf.readFloatLE(pOffset + 8);
          const yaw = buf.readFloatLE(pOffset + 12);
          const rollspeed = buf.readFloatLE(pOffset + 16);
          const pitchspeed = buf.readFloatLE(pOffset + 20);
          const yawspeed = buf.readFloatLE(pOffset + 24);

          this.state.attitude = {
            roll: +roll.toFixed(4),
            pitch: +pitch.toFixed(4),
            yaw: +yaw.toFixed(4),
            rollspeed: +rollspeed.toFixed(4),
            pitchspeed: +pitchspeed.toFixed(4),
            yawspeed: +yawspeed.toFixed(4)
          };

          stateChanged = true;
          resultEvent = { type: 'ATTITUDE', roll, pitch, yaw };
        }
        break;
      }

      // ----------------------------------------------------------------------
      // GLOBAL_POSITION_INT (ID #33)
      // ----------------------------------------------------------------------
      case 33: {
        if (pLen >= 28) {
          const lat = buf.readInt32LE(pOffset + 4) / 1e7;
          const lon = buf.readInt32LE(pOffset + 8) / 1e7;
          const altMsl = buf.readInt32LE(pOffset + 12) / 1000.0;
          const altAgl = buf.readInt32LE(pOffset + 16) / 1000.0;
          const vx = buf.readInt16LE(pOffset + 20) / 100.0;
          const vy = buf.readInt16LE(pOffset + 22) / 100.0;
          const vz = buf.readInt16LE(pOffset + 24) / 100.0; // positive down
          const hdg = buf.readUInt16LE(pOffset + 26) / 100.0; // 0-359.99 deg

          this.state.position = {
            lat: +lat.toFixed(7),
            lon: +lon.toFixed(7),
            altAgl: +altAgl.toFixed(2),
            altMsl: +altMsl.toFixed(2),
            vx: +vx.toFixed(2),
            vy: +vy.toFixed(2),
            vz: +(-vz).toFixed(2), // Invert Vz so positive represents climb
            headingDeg: +hdg.toFixed(1)
          };

          stateChanged = true;
          resultEvent = { type: 'GLOBAL_POSITION_INT', lat, lon, altAgl, altMsl, vz: -vz, headingDeg: hdg };
        }
        break;
      }

      // ----------------------------------------------------------------------
      // STATUSTEXT (ID #253)
      // ----------------------------------------------------------------------
      case 253: {
        if (pLen >= 1) {
          const severity = buf[pOffset];
          const textLen = Math.min(pLen - 1, 50);
          let rawStr = '';
          for (let i = 0; i < textLen; i++) {
            const ch = buf[pOffset + 1 + i];
            if (ch === 0) break;
            rawStr += String.fromCharCode(ch);
          }
          const text = rawStr.trim();

          const entry = {
            severity,
            text,
            timestamp: now
          };

          this.recentStatusTexts.push(entry);
          // Prune aged entries
          const cutoff = now - this.statusTextRetentionMs;
          if (this.recentStatusTexts.length > 50) {
            this.recentStatusTexts = this.recentStatusTexts.filter(e => e.timestamp >= cutoff);
          }

          if (this.onStatusTextCallback) {
            this.onStatusTextCallback(entry);
          }

          resultEvent = { type: 'STATUSTEXT', severity, text };
        }
        break;
      }

      // ----------------------------------------------------------------------
      // COMMAND_ACK (ID #77)
      // ----------------------------------------------------------------------
      case 77: {
        if (pLen >= 2) {
          const command = buf.readUInt16LE(pOffset);
          const result = buf[pOffset + 2];
          const progress = pLen >= 4 ? buf[pOffset + 3] : 0;
          const resultParam2 = pLen >= 8 ? buf.readInt32LE(pOffset + 4) : 0;

          const ackPayload = {
            command,
            result,
            resultName: MAV_RESULT[result] || `MAV_RESULT_${result}`,
            progress,
            resultParam2,
            timestamp: now
          };

          if (this.onAckCallback) {
            this.onAckCallback(ackPayload);
          }

          resultEvent = { type: 'COMMAND_ACK', ...ackPayload };
        }
        break;
      }

      // ----------------------------------------------------------------------
      // MISSION PROTOCOL MESSAGES (IDs #39, #40, #44, #47, #51, #73)
      // ----------------------------------------------------------------------
      case 39:
      case 40:
      case 44:
      case 47:
      case 51:
      case 73: {
        if (this.onMissionEventCallback) {
          this.onMissionEventCallback(msgId, buf, pOffset, pLen, direction);
        }
        resultEvent = { type: 'MISSION_EVENT', msgId, direction };
        break;
      }
    }

    if (stateChanged) {
      this.state.timestamp = now;
      const snapshot = this.getState();
      this.historyBuffer.push(snapshot);

      if (this.onTelemetryCallback) {
        this.onTelemetryCallback(snapshot);
      }
    }

    return resultEvent;
  }
}

export default MavlinkMultiplexer;
