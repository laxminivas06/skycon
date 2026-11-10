/**
 * =====================================================================================
 * S500-AeroRecon Quadcopter System — Opaque-Box Mock Pixhawk Telemetry Generator
 * Baseline: Technical Project Report Rev 2.4.0-PROD / ArduCopter V4.7.2
 * =====================================================================================
 * 
 * Provides:
 * 1. Strict MAVLink v2 binary packet serializer with accurate CRC-16/X.25 & CRC-EXTRA.
 * 2. Zero-copy / streaming packet parser for telemetry inspection and verification.
 * 3. Preconfigured builders for all 7 critical system message IDs:
 *    - #0 HEARTBEAT
 *    - #1 SYS_STATUS (with battery voltage and sag monitoring)
 *    - #24 GPS_RAW_INT (with 3D fix and HDOP)
 *    - #30 ATTITUDE (roll, pitch, yaw)
 *    - #33 GLOBAL_POSITION_INT (lat, lon, alt MSL/AGL, velocities)
 *    - #76 COMMAND_LONG / #77 COMMAND_ACK
 *    - #253 STATUSTEXT (pre-arm warnings, QR alerts)
 *    - #44, #51, #73, #47 MISSION Protocol (waypoints, count, ack)
 * 4. Fault injection engines: CRC corruption, noise injection, packet fragmentation.
 * 5. MockPixhawkAutopilot: State machine simulating ArduCopter 4.7.2 flight controller.
 */

export const MAVLINK2_STX = 0xFD;
export const MAVLINK1_STX = 0xFE;

// Official ArduPilot / MAVLink v2 CRC-EXTRA dictionary
export const MAVLINK_CRC_EXTRAS: Record<number, number> = {
  0: 50,      // HEARTBEAT
  1: 124,     // SYS_STATUS
  24: 24,     // GPS_RAW_INT
  30: 39,     // ATTITUDE
  33: 104,    // GLOBAL_POSITION_INT
  39: 254,    // MISSION_ITEM
  40: 230,    // MISSION_REQUEST
  44: 221,    // MISSION_COUNT
  47: 153,    // MISSION_ACK
  51: 196,    // MISSION_REQUEST_INT
  73: 38,     // MISSION_ITEM_INT
  76: 152,    // COMMAND_LONG
  77: 143,    // COMMAND_ACK
  253: 83,    // STATUSTEXT
};

// ArduCopter Custom Flight Modes
export enum ArduCopterFlightMode {
  STABILIZE = 0,
  ACRO = 1,
  ALT_HOLD = 2,
  AUTO = 3,
  GUIDED = 4,
  LOITER = 5,
  RTL = 6,
  CIRCLE = 7,
  LAND = 9,
  BRAKE = 17
}

// MAVLink Command Codes
export enum MavCmd {
  NAV_WAYPOINT = 16,
  NAV_RETURN_TO_LAUNCH = 20,
  NAV_TAKEOFF = 22,
  DO_SET_MODE = 176,
  COMPONENT_ARM_DISARM = 400
}

// MAVLink Command Results
export enum MavResult {
  ACCEPTED = 0,
  TEMPORARILY_REJECTED = 1,
  DENIED = 2,
  UNSUPPORTED = 3,
  FAILED = 4,
  IN_PROGRESS = 5
}

/**
 * Computes standard MAVLink CRC-16/X.25 over frame buffer + CRC_EXTRA
 */
export function calculateMavlinkCrc(buffer: Uint8Array | Buffer, len: number, msgId: number): number {
  let crc = 0xFFFF;
  // CRC starts at byte 1 (length byte) up to 10 + len - 1
  for (let i = 1; i < 10 + len; i++) {
    let b = buffer[i] ^ (crc & 0xFF);
    b ^= (b << 4) & 0xFF;
    crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
    crc &= 0xFFFF;
  }
  const extraCrc = MAVLINK_CRC_EXTRAS[msgId] ?? 0;
  let b = extraCrc ^ (crc & 0xFF);
  b ^= (b << 4) & 0xFF;
  crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
  return crc & 0xFFFF;
}

/**
 * Serializes a generic MAVLink 2.0 binary frame
 */
export function packMavlink2Frame(
  msgId: number,
  payload: Buffer,
  sysId = 1,
  compId = 1,
  seq = 0,
  incompatFlags = 0,
  compatFlags = 0
): Buffer {
  const len = payload.length;
  const frame = Buffer.alloc(10 + len + 2);
  frame[0] = MAVLINK2_STX;
  frame[1] = len;
  frame[2] = incompatFlags;
  frame[3] = compatFlags;
  frame[4] = seq & 0xFF;
  frame[5] = sysId & 0xFF;
  frame[6] = compId & 0xFF;
  frame[7] = msgId & 0xFF;
  frame[8] = (msgId >> 8) & 0xFF;
  frame[9] = (msgId >> 16) & 0xFF;
  payload.copy(frame, 10);

  const crc = calculateMavlinkCrc(frame, len, msgId);
  frame.writeUInt16LE(crc, 10 + len);
  return frame;
}

/**
 * Message Builders for Core Telemetry Packets
 */

export interface HeartbeatOptions {
  customMode?: number;
  type?: number;           // 2 = MAV_TYPE_QUADROTOR
  autopilot?: number;      // 3 = MAV_AUTOPILOT_ARDUPILOTMEGA
  baseMode?: number;       // 128 = Armed, 209 = Custom mode enabled + armed
  systemStatus?: number;   // 4 = MAV_STATE_ACTIVE
  mavlinkVersion?: number; // 3
}

export function buildHeartbeat(opts: HeartbeatOptions = {}, seq = 0, sysId = 1, compId = 1): Buffer {
  const payload = Buffer.alloc(9);
  payload.writeUInt32LE(opts.customMode ?? ArduCopterFlightMode.LOITER, 0);
  payload.writeUInt8(opts.type ?? 2, 4);
  payload.writeUInt8(opts.autopilot ?? 3, 5);
  payload.writeUInt8(opts.baseMode ?? 209, 6);
  payload.writeUInt8(opts.systemStatus ?? 4, 7);
  payload.writeUInt8(opts.mavlinkVersion ?? 3, 8);
  return packMavlink2Frame(0, payload, sysId, compId, seq);
}

export interface SysStatusOptions {
  voltageBatteryMv?: number; // e.g. 5370 (5.37V clean) or 4350 (<4.4V sag)
  currentBatteryCa?: number; // e.g. 1250 cA (12.5A)
  batteryRemaining?: number; // 0..100%
  dropRateComm?: number;
  errorsComm?: number;
  load?: number;             // 10 * % (e.g. 152 = 15.2%)
}

export function buildSysStatus(opts: SysStatusOptions = {}, seq = 0, sysId = 1, compId = 1): Buffer {
  const payload = Buffer.alloc(31);
  payload.writeUInt32LE(0x000F, 0);                      // onboard_control_sensors_present
  payload.writeUInt32LE(0x000F, 4);                      // onboard_control_sensors_enabled
  payload.writeUInt32LE(0x000F, 8);                      // onboard_control_sensors_health
  payload.writeUInt16LE(opts.load ?? 150, 12);           // load (15.0%)
  payload.writeUInt16LE(opts.voltageBatteryMv ?? 5370, 14); // voltage_battery in mV
  payload.writeInt16LE(opts.currentBatteryCa ?? 1250, 16);  // current_battery in cA
  payload.writeUInt16LE(opts.dropRateComm ?? 0, 18);
  payload.writeUInt16LE(opts.errorsComm ?? 0, 20);
  payload.writeUInt16LE(0, 22);                          // errors_count1
  payload.writeUInt16LE(0, 24);                          // errors_count2
  payload.writeUInt16LE(0, 26);                          // errors_count3
  payload.writeUInt16LE(0, 28);                          // errors_count4
  payload.writeInt8(opts.batteryRemaining ?? 88, 30);    // battery_remaining in %
  return packMavlink2Frame(1, payload, sysId, compId, seq);
}

export interface GpsRawIntOptions {
  latDeg?: number;
  lonDeg?: number;
  altM?: number;
  satellitesVisible?: number;
  fixType?: number;       // 3 = 3D Fix
  eph?: number;           // HDOP * 100
  epv?: number;           // VDOP * 100
  velCmS?: number;
  cogCdeg?: number;
}

export function buildGpsRawInt(opts: GpsRawIntOptions = {}, seq = 0, sysId = 1, compId = 1): Buffer {
  const payload = Buffer.alloc(30);
  payload.writeBigUInt64LE(BigInt(Date.now() * 1000), 0); // time_usec
  payload.writeInt32LE(Math.round((opts.latDeg ?? 13.0827) * 1e7), 8);
  payload.writeInt32LE(Math.round((opts.lonDeg ?? 80.2707) * 1e7), 12);
  payload.writeInt32LE(Math.round((opts.altM ?? 5.0) * 1000), 16); // mm MSL
  payload.writeUInt16LE(opts.eph ?? 80, 20);              // HDOP 0.8
  payload.writeUInt16LE(opts.epv ?? 100, 22);
  payload.writeUInt16LE(opts.velCmS ?? 0, 24);
  payload.writeUInt16LE(opts.cogCdeg ?? 9000, 26);
  payload.writeUInt8(opts.fixType ?? 3, 28);
  payload.writeUInt8(opts.satellitesVisible ?? 14, 29);
  return packMavlink2Frame(24, payload, sysId, compId, seq);
}

export interface AttitudeOptions {
  timeBootMs?: number;
  rollRad?: number;
  pitchRad?: number;
  yawRad?: number;
  rollspeed?: number;
  pitchspeed?: number;
  yawspeed?: number;
}

export function buildAttitude(opts: AttitudeOptions = {}, seq = 0, sysId = 1, compId = 1): Buffer {
  const payload = Buffer.alloc(28);
  const timeMs = opts.timeBootMs ?? ((Date.now() % 0x100000000) >>> 0);
  payload.writeUInt32LE(timeMs, 0);
  payload.writeFloatLE(opts.rollRad ?? 0.02, 4);
  payload.writeFloatLE(opts.pitchRad ?? -0.05, 8);
  payload.writeFloatLE(opts.yawRad ?? 1.57, 12);
  payload.writeFloatLE(opts.rollspeed ?? 0.0, 16);
  payload.writeFloatLE(opts.pitchspeed ?? 0.0, 20);
  payload.writeFloatLE(opts.yawspeed ?? 0.0, 24);
  return packMavlink2Frame(30, payload, sysId, compId, seq);
}

export interface GlobalPositionIntOptions {
  timeBootMs?: number;
  latDeg?: number;
  lonDeg?: number;
  altMslM?: number;
  altAglM?: number;       // relative_alt
  vxCmS?: number;
  vyCmS?: number;
  vzCmS?: number;
  hdgCdeg?: number;
}

export function buildGlobalPositionInt(opts: GlobalPositionIntOptions = {}, seq = 0, sysId = 1, compId = 1): Buffer {
  const payload = Buffer.alloc(28);
  const timeMs = opts.timeBootMs ?? ((Date.now() % 0x100000000) >>> 0);
  payload.writeUInt32LE(timeMs, 0);
  payload.writeInt32LE(Math.round((opts.latDeg ?? 13.0827) * 1e7), 4);
  payload.writeInt32LE(Math.round((opts.lonDeg ?? 80.2707) * 1e7), 8);
  payload.writeInt32LE(Math.round((opts.altMslM ?? 542.5) * 1000), 12);
  payload.writeInt32LE(Math.round((opts.altAglM ?? 5.0) * 1000), 16);
  payload.writeInt16LE(opts.vxCmS ?? 0, 20);
  payload.writeInt16LE(opts.vyCmS ?? 0, 22);
  payload.writeInt16LE(opts.vzCmS ?? 10, 24); // 0.1 m/s climb
  payload.writeUInt16LE(opts.hdgCdeg ?? 9000, 26);
  return packMavlink2Frame(33, payload, sysId, compId, seq);
}

export interface CommandLongOptions {
  command: number;
  targetSys?: number;
  targetComp?: number;
  confirmation?: number;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
  param5?: number;
  param6?: number;
  param7?: number;
}

export function buildCommandLong(opts: CommandLongOptions, seq = 0, sysId = 255, compId = 190): Buffer {
  const payload = Buffer.alloc(33);
  payload.writeFloatLE(opts.param1 ?? 0.0, 0);
  payload.writeFloatLE(opts.param2 ?? 0.0, 4);
  payload.writeFloatLE(opts.param3 ?? 0.0, 8);
  payload.writeFloatLE(opts.param4 ?? 0.0, 12);
  payload.writeFloatLE(opts.param5 ?? 0.0, 16);
  payload.writeFloatLE(opts.param6 ?? 0.0, 20);
  payload.writeFloatLE(opts.param7 ?? 0.0, 24);
  payload.writeUInt16LE(opts.command, 28);
  payload.writeUInt8(opts.targetSys ?? 1, 30);
  payload.writeUInt8(opts.targetComp ?? 1, 31);
  payload.writeUInt8(opts.confirmation ?? 0, 32);
  return packMavlink2Frame(76, payload, sysId, compId, seq);
}

export interface CommandAckOptions {
  command: number;
  result: number;
  progress?: number;
  resultParam2?: number;
  targetSys?: number;
  targetComp?: number;
}

export function buildCommandAck(opts: CommandAckOptions, seq = 0, sysId = 1, compId = 1): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUInt16LE(opts.command, 0);
  payload.writeUInt8(opts.result, 2);
  payload.writeUInt8(opts.progress ?? 0, 3);
  payload.writeInt32LE(opts.resultParam2 ?? 0, 4);
  payload.writeUInt8(opts.targetSys ?? 255, 8);
  payload.writeUInt8(opts.targetComp ?? 190, 9);
  return packMavlink2Frame(77, payload, sysId, compId, seq);
}

export function buildStatusText(text: string, severity = 6, seq = 0, sysId = 1, compId = 1): Buffer {
  const payload = Buffer.alloc(51);
  payload.writeUInt8(severity, 0);
  const truncated = text.slice(0, 50);
  payload.write(truncated, 1, truncated.length, 'ascii');
  return packMavlink2Frame(253, payload, sysId, compId, seq);
}

export function buildMissionCount(count: number, targetSys = 1, targetComp = 1, missionType = 0, seq = 0): Buffer {
  const payload = Buffer.alloc(5);
  payload.writeUInt16LE(count, 0);
  payload.writeUInt8(targetSys, 2);
  payload.writeUInt8(targetComp, 3);
  payload.writeUInt8(missionType, 4);
  return packMavlink2Frame(44, payload, 255, 190, seq);
}

export function buildMissionRequestInt(seqReq: number, targetSys = 1, targetComp = 1, missionType = 0, seq = 0): Buffer {
  const payload = Buffer.alloc(5);
  payload.writeUInt16LE(seqReq, 0);
  payload.writeUInt8(targetSys, 2);
  payload.writeUInt8(targetComp, 3);
  payload.writeUInt8(missionType, 4);
  return packMavlink2Frame(51, payload, 1, 1, seq);
}

export interface MissionItemIntOptions {
  seq: number;
  command: number;
  latDeg: number;
  lonDeg: number;
  altM: number;
  frame?: number;        // 6 = MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
  current?: number;
  autocontinue?: number;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
}

export function buildMissionItemInt(opts: MissionItemIntOptions, seq = 0): Buffer {
  const payload = Buffer.alloc(37);
  payload.writeFloatLE(opts.param1 ?? 0.0, 0);
  payload.writeFloatLE(opts.param2 ?? 0.0, 4);
  payload.writeFloatLE(opts.param3 ?? 0.0, 8);
  payload.writeFloatLE(opts.param4 ?? 0.0, 12);
  payload.writeInt32LE(Math.round(opts.latDeg * 1e7), 16);
  payload.writeInt32LE(Math.round(opts.lonDeg * 1e7), 20);
  payload.writeFloatLE(opts.altM, 24);
  payload.writeUInt16LE(opts.seq, 28);
  payload.writeUInt16LE(opts.command, 30);
  payload.writeUInt8(1, 32);                             // target_system
  payload.writeUInt8(1, 33);                             // target_component
  payload.writeUInt8(opts.frame ?? 6, 34);               // frame
  payload.writeUInt8(opts.current ?? 0, 35);
  payload.writeUInt8(opts.autocontinue ?? 1, 36);
  return packMavlink2Frame(73, payload, 255, 190, seq);
}

export function buildMissionAck(result: number, targetSys = 1, targetComp = 1, missionType = 0, seq = 0): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt8(targetSys, 0);
  payload.writeUInt8(targetComp, 1);
  payload.writeUInt8(result, 2);
  payload.writeUInt8(missionType, 3);
  return packMavlink2Frame(47, payload, 1, 1, seq);
}

/**
 * Parsed MAVLink Packet Structure
 */
export interface ParsedMavlinkPacket {
  magic: number;
  len: number;
  incompatFlags: number;
  compatFlags: number;
  seq: number;
  sysId: number;
  compId: number;
  msgId: number;
  payload: Buffer;
  crc: number;
  crcValid: boolean;
  fields?: Record<string, any>;
}

/**
 * Robust stream parser capable of scanning MAVLink v2 frames from raw chunks
 */
export function parseMavlink2Frames(buf: Buffer): ParsedMavlinkPacket[] {
  const packets: ParsedMavlinkPacket[] = [];
  let offset = 0;

  while (offset + 12 <= buf.length) {
    if (buf[offset] !== MAVLINK2_STX) {
      offset++;
      continue;
    }

    const len = buf[offset + 1];
    const incompatFlags = buf[offset + 2];
    const sigLen = (incompatFlags & 0x01) ? 13 : 0;
    const packetLen = 10 + len + 2 + sigLen;

    if (offset + packetLen > buf.length) {
      // Could be false STX in noise; advance by 1 byte to resynchronize
      offset++;
      continue;
    }

    const compatFlags = buf[offset + 3];
    const seq = buf[offset + 4];
    const sysId = buf[offset + 5];
    const compId = buf[offset + 6];
    const msgId = buf[offset + 7] | (buf[offset + 8] << 8) | (buf[offset + 9] << 16);
    const payload = buf.subarray(offset + 10, offset + 10 + len);
    const receivedCrc = buf.readUInt16LE(offset + 10 + len);

    const calculatedCrc = calculateMavlinkCrc(buf.subarray(offset, offset + 10 + len), len, msgId);
    const crcValid = (receivedCrc === calculatedCrc);

    const packet: ParsedMavlinkPacket = {
      magic: MAVLINK2_STX,
      len,
      incompatFlags,
      compatFlags,
      seq,
      sysId,
      compId,
      msgId,
      payload,
      crc: receivedCrc,
      crcValid,
      fields: {}
    };

    if (!crcValid) {
      // False sync or corrupted frame; advance by 1 byte to allow resynchronization
      packets.push(packet);
      offset++;
      continue;
    }

    // Decode known fields
    if (crcValid) {
      if (msgId === 0 && len >= 9) {
        packet.fields = {
          customMode: payload.readUInt32LE(0),
          type: payload.readUInt8(4),
          autopilot: payload.readUInt8(5),
          baseMode: payload.readUInt8(6),
          systemStatus: payload.readUInt8(7),
          armed: Boolean(payload.readUInt8(6) & 128)
        };
      } else if (msgId === 1 && len >= 31) {
        packet.fields = {
          load: payload.readUInt16LE(12) / 10.0,
          voltageBatteryMv: payload.readUInt16LE(14),
          currentBatteryCa: payload.readInt16LE(16),
          batteryRemaining: payload.readInt8(30),
          usbPowerSag: payload.readUInt16LE(14) < 4400
        };
      } else if (msgId === 24 && len >= 30) {
        packet.fields = {
          lat: payload.readInt32LE(8) / 1e7,
          lon: payload.readInt32LE(12) / 1e7,
          altM: payload.readInt32LE(16) / 1000.0,
          eph: payload.readUInt16LE(20),
          epv: payload.readUInt16LE(22),
          fixType: payload.readUInt8(28),
          satellitesVisible: payload.readUInt8(29)
        };
      } else if (msgId === 30 && len >= 28) {
        packet.fields = {
          rollRad: payload.readFloatLE(4),
          pitchRad: payload.readFloatLE(8),
          yawRad: payload.readFloatLE(12),
          rollDeg: payload.readFloatLE(4) * (180 / Math.PI),
          pitchDeg: payload.readFloatLE(8) * (180 / Math.PI),
          yawDeg: payload.readFloatLE(12) * (180 / Math.PI)
        };
      } else if (msgId === 33 && len >= 28) {
        packet.fields = {
          lat: payload.readInt32LE(4) / 1e7,
          lon: payload.readInt32LE(8) / 1e7,
          altMslM: payload.readInt32LE(12) / 1000.0,
          altAglM: payload.readInt32LE(16) / 1000.0,
          vx: payload.readInt16LE(20) / 100.0,
          vy: payload.readInt16LE(22) / 100.0,
          vz: payload.readInt16LE(24) / 100.0,
          hdgDeg: payload.readUInt16LE(26) / 100.0
        };
      } else if (msgId === 76 && len >= 33) {
        packet.fields = {
          param1: payload.readFloatLE(0),
          param2: payload.readFloatLE(4),
          param3: payload.readFloatLE(8),
          param4: payload.readFloatLE(12),
          param5: payload.readFloatLE(16),
          param6: payload.readFloatLE(20),
          param7: payload.readFloatLE(24),
          command: payload.readUInt16LE(28),
          targetSys: payload.readUInt8(30),
          targetComp: payload.readUInt8(31)
        };
      } else if (msgId === 77 && len >= 10) {
        packet.fields = {
          command: payload.readUInt16LE(0),
          result: payload.readUInt8(2),
          progress: payload.readUInt8(3),
          resultParam2: payload.readInt32LE(4)
        };
      } else if (msgId === 253 && len >= 51) {
        const textBytes = payload.subarray(1, 51);
        const nullIdx = textBytes.indexOf(0);
        const text = textBytes.subarray(0, nullIdx >= 0 ? nullIdx : 50).toString('ascii');
        packet.fields = {
          severity: payload.readUInt8(0),
          text
        };
      }
    }

    packets.push(packet);
    offset += packetLen;
  }

  return packets;
}

/**
 * Fault Injection Helpers
 */

export function corruptCrc(frame: Buffer): Buffer {
  const copy = Buffer.from(frame);
  const crcPos = copy.length - 2;
  copy[crcPos] = copy[crcPos] ^ 0xFF; // Invert lower CRC byte
  return copy;
}

export function injectNoise(frame: Buffer, noiseBytesCount = 5): Buffer {
  const noise = Buffer.alloc(noiseBytesCount);
  for (let i = 0; i < noiseBytesCount; i++) {
    noise[i] = Math.floor(Math.random() * 256);
  }
  return Buffer.concat([noise, frame]);
}

export function fragmentFrame(frame: Buffer, chunkSize = 7): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < frame.length; i += chunkSize) {
    chunks.push(frame.subarray(i, Math.min(i + chunkSize, frame.length)));
  }
  return chunks;
}

/**
 * Mock Autopilot State Machine
 */
export class MockPixhawkAutopilot {
  public sysId = 1;
  public compId = 1;
  public seq = 0;
  public armed = false;
  public currentMode = ArduCopterFlightMode.LOITER;
  public lat = 13.0827;
  public lon = 80.2707;
  public altAgl = 0.0;
  public altMsl = 537.5;
  public voltageBatteryMv = 5370;
  public rollRad = 0.0;
  public pitchRad = 0.0;
  public yawRad = 1.57; // East
  public lastCommandReceived: { command: number; params: number[] } | null = null;
  public lastAckSent: { command: number; result: number } | null = null;

  public handleInboundFrame(frameBuf: Buffer): Buffer[] {
    const responses: Buffer[] = [];
    const packets = parseMavlink2Frames(frameBuf);

    for (const pkt of packets) {
      if (!pkt.crcValid) continue;

      if (pkt.msgId === 76 && pkt.fields) {
        // COMMAND_LONG
        const cmd = pkt.fields.command;
        const p1 = pkt.fields.param1;
        const p2 = pkt.fields.param2;
        this.lastCommandReceived = { command: cmd, params: [p1, p2] };

        if (cmd === MavCmd.COMPONENT_ARM_DISARM) {
          // p1 == 1.0 => ARM, p1 == 0.0 => DISARM
          // p2 == 21196.0 => Force Arm
          if (p1 === 1.0) {
            this.armed = true;
            const ack = buildCommandAck({ command: cmd, result: MavResult.ACCEPTED }, ++this.seq);
            this.lastAckSent = { command: cmd, result: MavResult.ACCEPTED };
            responses.push(ack);
          } else {
            this.armed = false;
            const ack = buildCommandAck({ command: cmd, result: MavResult.ACCEPTED }, ++this.seq);
            this.lastAckSent = { command: cmd, result: MavResult.ACCEPTED };
            responses.push(ack);
          }
        } else if (cmd === MavCmd.NAV_TAKEOFF) {
          // Autonomous takeoff (p7 = altitude in meters)
          const targetAlt = pkt.fields.param7 || 5.0;
          this.altAgl = targetAlt;
          this.altMsl = 537.5 + targetAlt;
          this.currentMode = ArduCopterFlightMode.GUIDED;
          const ack = buildCommandAck({ command: cmd, result: MavResult.ACCEPTED }, ++this.seq);
          this.lastAckSent = { command: cmd, result: MavResult.ACCEPTED };
          responses.push(ack);
        } else if (cmd === MavCmd.DO_SET_MODE) {
          // param1 = 1.0 (custom mode), param2 = custom mode number
          const newMode = Math.round(p2);
          this.currentMode = newMode;
          const ack = buildCommandAck({ command: cmd, result: MavResult.ACCEPTED }, ++this.seq);
          this.lastAckSent = { command: cmd, result: MavResult.ACCEPTED };
          responses.push(ack);
        } else if (cmd === MavCmd.NAV_RETURN_TO_LAUNCH) {
          this.currentMode = ArduCopterFlightMode.RTL;
          const ack = buildCommandAck({ command: cmd, result: MavResult.ACCEPTED }, ++this.seq);
          this.lastAckSent = { command: cmd, result: MavResult.ACCEPTED };
          responses.push(ack);
        } else {
          // Generic accepted
          const ack = buildCommandAck({ command: cmd, result: MavResult.ACCEPTED }, ++this.seq);
          this.lastAckSent = { command: cmd, result: MavResult.ACCEPTED };
          responses.push(ack);
        }
      }
    }

    return responses;
  }

  public generateFullTelemetryBurst(): Buffer {
    const baseMode = (this.armed ? 128 : 0) | 1;
    const hb = buildHeartbeat({
      customMode: this.currentMode,
      baseMode,
      systemStatus: this.armed ? 4 : 3
    }, ++this.seq, this.sysId, this.compId);

    const sys = buildSysStatus({
      voltageBatteryMv: this.voltageBatteryMv
    }, ++this.seq, this.sysId, this.compId);

    const gps = buildGpsRawInt({
      latDeg: this.lat,
      lonDeg: this.lon,
      altM: this.altAgl,
      satellitesVisible: 14,
      fixType: 3
    }, ++this.seq, this.sysId, this.compId);

    const att = buildAttitude({
      rollRad: this.rollRad,
      pitchRad: this.pitchRad,
      yawRad: this.yawRad
    }, ++this.seq, this.sysId, this.compId);

    const pos = buildGlobalPositionInt({
      latDeg: this.lat,
      lonDeg: this.lon,
      altMslM: this.altMsl,
      altAglM: this.altAgl
    }, ++this.seq, this.sysId, this.compId);

    return Buffer.concat([hb, sys, gps, att, pos]);
  }
}
