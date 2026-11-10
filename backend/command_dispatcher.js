/**
 * S500-AeroRecon Communications Hub — Non-Blocking Async Command Correlator & Dispatcher
 * 
 * Provides an asynchronous correlation engine for MAVLink COMMAND_LONG (#76) vs COMMAND_ACK (#77):
 * - Standard arming (param2=0.0) and Force-Arm bypass (param2=21196.0)
 * - Mode switching (STABILIZE, ALT_HOLD, LOITER, GUIDED, AUTO, BRAKE, RTL)
 * - 5.0m autonomous takeoff (PILOT_TKOFF_ALT=500)
 * - 2000 ms retry/timeout promise correlating dispatched COMMAND_LONG with autopilot COMMAND_ACK
 */

import { MODE_NAME_TO_INT, MAV_RESULT, calculateMavlinkCrc, CRC_EXTRA } from './mavlink_multiplexer.js';

export class CommandDispatcher {
  constructor(options = {}) {
    this.sendFn = options.sendFn || null; // Function (buf) => void
    this.getStatusTextsFn = options.getStatusTextsFn || null; // Function (windowMs) => []
    this.defaultTimeoutMs = options.timeoutMs || 2000;
    this.defaultRetries = typeof options.retries === 'number' ? options.retries : 1;
    this.seq = 0;
    this.systemId = options.systemId || 255;
    this.componentId = options.componentId || 190;
    this.targetSystem = options.targetSystem || 1;
    this.targetComponent = options.targetComponent || 1;

    // In-flight command map: commandId => InFlightEntry
    this.inFlight = new Map();
  }

  /**
   * Set or update transport sender
   */
  setSender(sendFn) {
    this.sendFn = sendFn;
  }

  /**
   * Build MAVLink v2 COMMAND_LONG (#76) binary packet
   */
  buildMavlink2CommandLong(commandId, params = {}) {
    const p1 = params.param1 || 0.0;
    const p2 = params.param2 || 0.0;
    const p3 = params.param3 || 0.0;
    const p4 = params.param4 || 0.0;
    const p5 = params.param5 || 0.0;
    const p6 = params.param6 || 0.0;
    const p7 = params.param7 || 0.0;

    const payload = Buffer.alloc(33);
    payload.writeFloatLE(p1, 0);
    payload.writeFloatLE(p2, 4);
    payload.writeFloatLE(p3, 8);
    payload.writeFloatLE(p4, 12);
    payload.writeFloatLE(p5, 16);
    payload.writeFloatLE(p6, 20);
    payload.writeFloatLE(p7, 24);
    payload.writeUInt16LE(commandId, 28);
    payload[30] = this.targetSystem;
    payload[31] = this.targetComponent;
    payload[32] = 0; // confirmation

    const payloadLen = 33;
    const packet = Buffer.alloc(10 + payloadLen + 2);

    this.seq = (this.seq + 1) & 0xFF;

    // Header MAVLink v2
    packet[0] = 0xFD; // magic
    packet[1] = payloadLen;
    packet[2] = 0; // incompat_flags
    packet[3] = 0; // compat_flags
    packet[4] = this.seq;
    packet[5] = this.systemId;
    packet[6] = this.componentId;
    packet[7] = 76; // MSG_ID = 76 (COMMAND_LONG)
    packet[8] = 0;
    packet[9] = 0;

    payload.copy(packet, 10);

    // Calculate CRC with CRC_EXTRA for COMMAND_LONG = 152
    const crc = calculateMavlinkCrc(packet, 1, 9 + payloadLen, CRC_EXTRA[76]);
    packet.writeUInt16LE(crc, 10 + payloadLen);

    return packet;
  }

  /**
   * Dispatches a command and returns a promise that resolves upon COMMAND_ACK
   */
  dispatch(commandId, params = {}, options = {}) {
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    const maxRetries = typeof options.retries === 'number' ? options.retries : this.defaultRetries;

    if (!this.sendFn) {
      return Promise.reject(new Error('No transport sender configured for command dispatch'));
    }

    const packet = this.buildMavlink2CommandLong(commandId, params);

    return new Promise((resolve, reject) => {
      const now = Date.now();
      const inFlightEntry = {
        commandId,
        params,
        packet,
        sentTimestamp: now,
        retriesRemaining: maxRetries,
        timeoutMs,
        resolve,
        reject,
        timer: null
      };

      const setupTimeout = () => {
        inFlightEntry.timer = setTimeout(() => {
          if (inFlightEntry.retriesRemaining > 0) {
            inFlightEntry.retriesRemaining--;
            console.warn(`[CMD_DISPATCH] Command ${commandId} timeout, retrying (${inFlightEntry.retriesRemaining} retries left)...`);
            try {
              this.sendFn(packet);
            } catch (err) {
              console.error('[CMD_DISPATCH] Retry send failed:', err.message);
            }
            setupTimeout();
          } else {
            this.inFlight.delete(commandId);
            const err = new Error(`COMMAND_LONG #${commandId} timed out after ${timeoutMs}ms with no COMMAND_ACK`);
            err.code = 'MAV_RESULT_TIMEOUT';
            err.command = commandId;
            reject(err);
          }
        }, timeoutMs);
      };

      // Register in flight map (cancelling prior pending for same command if any)
      const existing = this.inFlight.get(commandId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new Error(`Superseded by new command #${commandId}`));
      }

      this.inFlight.set(commandId, inFlightEntry);
      setupTimeout();

      // Transmit packet
      try {
        this.sendFn(packet);
      } catch (err) {
        clearTimeout(inFlightEntry.timer);
        this.inFlight.delete(commandId);
        reject(err);
      }
    });
  }

  /**
   * Correlates an incoming COMMAND_ACK (#77) with pending in-flight commands
   */
  handleAck(ack) {
    if (!ack || typeof ack.command !== 'number') return false;

    const entry = this.inFlight.get(ack.command);
    if (!entry) return false;

    const rttMs = Date.now() - entry.sentTimestamp;
    const resultCode = ack.result;
    const resultName = ack.resultName || MAV_RESULT[resultCode] || `RESULT_${resultCode}`;

    if (resultCode === 0) {
      // MAV_RESULT_ACCEPTED
      clearTimeout(entry.timer);
      this.inFlight.delete(ack.command);
      entry.resolve({
        success: true,
        command: ack.command,
        result: resultName,
        code: resultCode,
        rttMs,
        progress: ack.progress || 0
      });
      return true;
    }

    if (resultCode === 1 && entry.retriesRemaining > 0) {
      // MAV_RESULT_TEMPORARILY_REJECTED
      console.warn(`[CMD_DISPATCH] Command #${ack.command} TEMPORARILY_REJECTED, retrying...`);
      clearTimeout(entry.timer);
      entry.retriesRemaining--;
      try {
        this.sendFn(entry.packet);
      } catch (e) {}
      entry.timer = setTimeout(() => {
        this.inFlight.delete(ack.command);
        entry.reject(new Error(`Command #${ack.command} rejected: ${resultName}`));
      }, entry.timeoutMs);
      return true;
    }

    // Command Failed, Denied, or Cancelled
    clearTimeout(entry.timer);
    this.inFlight.delete(ack.command);

    let errorDetail = '';
    if (this.getStatusTextsFn) {
      const recent = this.getStatusTextsFn(2500);
      if (recent.length > 0) {
        errorDetail = `: "${recent[recent.length - 1].text}"`;
      }
    }

    const error = new Error(`Command #${ack.command} rejected by autopilot with ${resultName} (${resultCode})${errorDetail}`);
    error.code = resultName;
    error.resultCode = resultCode;
    error.command = ack.command;
    error.rttMs = rttMs;
    entry.reject(error);
    return true;
  }

  // --------------------------------------------------------------------------
  // Convenience Operational Methods
  // --------------------------------------------------------------------------

  /**
   * Arm drone (standard arm or force-arm bypass with magic constant 21196.0)
   */
  arm(force = false) {
    const param2 = force ? 21196.0 : 0.0;
    return this.dispatch(400, {
      param1: 1.0,
      param2
    });
  }

  /**
   * Disarm drone
   */
  disarm(force = false) {
    const param2 = force ? 21196.0 : 0.0;
    return this.dispatch(400, {
      param1: 0.0,
      param2
    });
  }

  /**
   * Switch flight mode (STABILIZE, ALT_HOLD, LOITER, GUIDED, AUTO, BRAKE, RTL)
   */
  setMode(modeNameOrNumber) {
    let modeNumber;
    if (typeof modeNameOrNumber === 'string') {
      const upper = modeNameOrNumber.toUpperCase().trim();
      if (typeof MODE_NAME_TO_INT[upper] === 'number') {
        modeNumber = MODE_NAME_TO_INT[upper];
      } else {
        return Promise.reject(new Error(`Unknown flight mode: "${modeNameOrNumber}"`));
      }
    } else {
      modeNumber = Number(modeNameOrNumber);
    }

    return this.dispatch(176, {
      param1: 1.0, // MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
      param2: modeNumber
    });
  }

  /**
   * Autonomous Takeoff to specified altitude (default 5.0m matching PILOT_TKOFF_ALT=500)
   */
  takeoff(altitudeMeters = 5.0) {
    return this.dispatch(22, {
      param1: 0.0,
      param7: altitudeMeters
    });
  }

  /**
   * Clear all pending in-flight commands (e.g. on disconnect)
   */
  clearAll(reason = 'Transport disconnected') {
    for (const [cmdId, entry] of this.inFlight.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`Command #${cmdId} cancelled: ${reason}`));
    }
    this.inFlight.clear();
  }
}

export default CommandDispatcher;
