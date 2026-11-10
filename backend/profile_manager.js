/**
 * S500-AeroRecon Communications Hub — Parameter Profile Swapper & Manager
 * 
 * Manages rapid reconfiguration between:
 * 1. BENCH Profile (S500_BENCH_TESTING_SAFE.param):
 *    ARMING_CHECK=0, FENCE_ENABLE=0, FS_GCS_ENABLE=0, BATT_MONITOR=0
 *    Permits props-off indoor motor testing and ESP32 USB telemetry testing without GPS or battery lockouts.
 * 2. FIELD Profile (S500_AUTONOMOUS_PIXHAWK_TUNING.param):
 *    ARMING_CHECK=1, FENCE_ENABLE=1, PILOT_TKOFF_ALT=500, WPNAV_SPEED=400, WPNAV_RADIUS=150,
 *    LOIT_BRK_DELAY=0.3, LOIT_BRK_ACCEL=350, LOIT_BRK_JERK=1000
 *    Enforces all safety interlocks, geofence, and autonomous flight boundaries for competition flight.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateMavlinkCrc, CRC_EXTRA } from './mavlink_multiplexer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Candidate file locations for the parameter baselines
const candidatePaths = {
  BENCH: [
    path.resolve(__dirname, '../../S500_BENCH_TESTING_SAFE.param'),
    path.resolve(__dirname, '../S500_BENCH_TESTING_SAFE.param'),
    path.resolve(process.cwd(), 'S500_BENCH_TESTING_SAFE.param'),
    path.resolve(process.cwd(), '../S500_BENCH_TESTING_SAFE.param')
  ],
  FIELD: [
    path.resolve(__dirname, '../../S500_AUTONOMOUS_PIXHAWK_TUNING.param'),
    path.resolve(__dirname, '../S500_AUTONOMOUS_PIXHAWK_TUNING.param'),
    path.resolve(process.cwd(), 'S500_AUTONOMOUS_PIXHAWK_TUNING.param'),
    path.resolve(process.cwd(), '../S500_AUTONOMOUS_PIXHAWK_TUNING.param')
  ]
};

function findParamFile(profileName) {
  const candidates = candidatePaths[profileName] || [];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Parses ArduPilot .param file format
 */
export function parseParamFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Parameter file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const params = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/[, \t]+/);
    if (parts.length >= 2) {
      const name = parts[0].trim().toUpperCase();
      const val = parseFloat(parts[1].trim());
      if (name && !isNaN(val)) {
        params[name] = val;
      }
    }
  }

  return params;
}

export class ProfileManager {
  constructor(options = {}) {
    this.activeProfile = options.initialProfile || 'FIELD';
    this.profiles = {
      BENCH: {},
      FIELD: {}
    };
    this.paramFiles = {
      BENCH: findParamFile('BENCH'),
      FIELD: findParamFile('FIELD')
    };
    this.readbackCache = new Map(); // paramName => value
    this.lastAppliedTimestamp = 0;
    this.sendFn = options.sendFn || null;

    this.reloadProfiles();
  }

  setSender(sendFn) {
    this.sendFn = sendFn;
  }

  reloadProfiles() {
    this.paramFiles.BENCH = findParamFile('BENCH');
    this.paramFiles.FIELD = findParamFile('FIELD');

    if (this.paramFiles.BENCH) {
      try {
        this.profiles.BENCH = parseParamFile(this.paramFiles.BENCH);
      } catch (e) {
        console.warn('[PROFILE_MGR] Failed reading BENCH profile:', e.message);
      }
    }

    if (this.paramFiles.FIELD) {
      try {
        this.profiles.FIELD = parseParamFile(this.paramFiles.FIELD);
      } catch (e) {
        console.warn('[PROFILE_MGR] Failed reading FIELD profile:', e.message);
      }
    }
  }

  /**
   * Builds MAVLink v2 PARAM_SET (#23) binary frame
   */
  buildParamSetPacket(paramName, paramValue, seq = 0) {
    const payload = Buffer.alloc(23);
    payload.writeFloatLE(paramValue, 0);
    payload[4] = 1; // target_system
    payload[5] = 1; // target_component

    // Param ID (char[16]) null padded
    const cleanName = paramName.toUpperCase().slice(0, 16);
    payload.write(cleanName, 6, cleanName.length, 'ascii');

    // MAV_PARAM_TYPE_REAL32 = 9
    payload[22] = 9;

    const packet = Buffer.alloc(10 + 23 + 2);
    packet[0] = 0xFD; // MAVLink 2
    packet[1] = 23;   // payload length
    packet[2] = 0;
    packet[3] = 0;
    packet[4] = seq & 0xFF;
    packet[5] = 255;  // sysId
    packet[6] = 190;  // compId
    packet[7] = 23;   // msgId = 23 (PARAM_SET)
    packet[8] = 0;
    packet[9] = 0;

    payload.copy(packet, 10);

    const crc = calculateMavlinkCrc(packet, 1, 9 + 23, CRC_EXTRA[23]);
    packet.writeUInt16LE(crc, 10 + 23);

    return packet;
  }

  /**
   * Applies selected parameter profile ('BENCH' or 'FIELD')
   */
  async applyProfile(profileName, options = {}) {
    const upper = (profileName || '').toUpperCase().trim();
    if (upper !== 'BENCH' && upper !== 'FIELD') {
      throw new Error(`Invalid profile "${profileName}". Must be "BENCH" or "FIELD".`);
    }

    this.reloadProfiles();
    const params = this.profiles[upper];
    const paramCount = Object.keys(params).length;

    if (paramCount === 0) {
      throw new Error(`No parameters loaded for profile "${upper}". Check file existence.`);
    }

    this.activeProfile = upper;
    this.lastAppliedTimestamp = Date.now();

    // Key overrides to highlight
    const keyOverrides = {};
    const criticalKeys = [
      'ARMING_CHECK',
      'FENCE_ENABLE',
      'FS_GCS_ENABLE',
      'BATT_MONITOR',
      'PILOT_TKOFF_ALT',
      'RTL_ALT',
      'WPNAV_SPEED',
      'WPNAV_RADIUS',
      'LOIT_BRK_DELAY',
      'LOIT_BRK_ACCEL',
      'LOIT_BRK_JERK'
    ];

    for (const key of criticalKeys) {
      if (params[key] !== undefined) {
        keyOverrides[key] = params[key];
      }
    }

    // If transport sender provided and sync requested, stream parameters to Pixhawk
    let syncedCount = 0;
    if (options.syncToDrone && this.sendFn) {
      let seq = 0;
      for (const [pName, pVal] of Object.entries(params)) {
        const frame = this.buildParamSetPacket(pName, pVal, seq++);
        try {
          this.sendFn(frame);
          syncedCount++;
        } catch (e) {}
      }
    }

    return {
      success: true,
      profile: upper,
      sourceFile: this.paramFiles[upper],
      paramCount,
      keyOverrides,
      syncedToDrone: syncedCount > 0,
      syncedCount,
      appliedAt: this.lastAppliedTimestamp
    };
  }

  /**
   * Record parameter value received from autopilot for readback validation
   */
  recordParamValue(name, value) {
    if (name) {
      this.readbackCache.set(name.toUpperCase().trim(), value);
    }
  }

  /**
   * Validate readback of active profile against autopilot parameters
   */
  validateReadback() {
    const targetParams = this.profiles[this.activeProfile] || {};
    const mismatched = [];
    const matched = [];

    for (const [name, targetVal] of Object.entries(targetParams)) {
      if (this.readbackCache.has(name)) {
        const currentVal = this.readbackCache.get(name);
        if (Math.abs(currentVal - targetVal) < 0.001) {
          matched.push(name);
        } else {
          mismatched.push({ name, target: targetVal, current: currentVal });
        }
      }
    }

    return {
      profile: this.activeProfile,
      totalProfileParams: Object.keys(targetParams).length,
      cachedParamsCount: this.readbackCache.size,
      matchedCount: matched.length,
      mismatchedCount: mismatched.length,
      mismatched
    };
  }

  getStatus() {
    return {
      activeProfile: this.activeProfile,
      lastAppliedTimestamp: this.lastAppliedTimestamp,
      benchFile: this.paramFiles.BENCH,
      benchParamCount: Object.keys(this.profiles.BENCH).length,
      fieldFile: this.paramFiles.FIELD,
      fieldParamCount: Object.keys(this.profiles.FIELD).length
    };
  }
}

export default ProfileManager;
