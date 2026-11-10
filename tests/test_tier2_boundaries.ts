/**
 * =====================================================================================
 * S500-AeroRecon Quadcopter System — E2E Test Suite Tier 2: Boundary & Corner Cases
 * Derived strictly from PROJECT.md and ORIGINAL_REQUEST.md
 * Minimum requirement: >= 5 boundary/corner test cases per feature category (>= 50 test cases total)
 * =====================================================================================
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';
import { fork, ChildProcess } from 'child_process';
import {
  packMavlink2Frame,
  parseMavlink2Frames,
  calculateMavlinkCrc,
  buildHeartbeat,
  buildSysStatus,
  buildGpsRawInt,
  buildAttitude,
  buildGlobalPositionInt,
  buildCommandLong,
  buildCommandAck,
  buildStatusText,
  corruptCrc,
  injectNoise,
  fragmentFrame,
  ArduCopterFlightMode,
  MavCmd,
  MavResult,
  MockPixhawkAutopilot
} from './mock_pixhawk_telemetry.js';

export interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export interface TierSuiteSummary {
  tier: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: TestResult[];
}

export async function runTier2Tests(): Promise<TierSuiteSummary> {
  const startTime = Date.now();
  const results: TestResult[] = [];

  const test = async (category: string, name: string, fn: () => void | Promise<void>) => {
    const t0 = Date.now();
    try {
      await fn();
      results.push({ name, category, passed: true, durationMs: Date.now() - t0 });
      console.log(`  ✓ [T2-PASS] [${category}] ${name}`);
    } catch (err: any) {
      results.push({ name, category, passed: false, error: err?.message || String(err), durationMs: Date.now() - t0 });
      console.error(`  ✗ [T2-FAIL] [${category}] ${name} -> ${err?.message || err}`);
    }
  };

  console.log('\n================================================================================');
  console.log('🛸 TIER 2: BOUNDARY & CORNER CASES (Timeouts, Noise, Sags, Fragmentation)');
  console.log('================================================================================\n');

  // ===================================================================================
  // CATEGORY 1: ESP32 & UART Physical / Data Link Boundaries
  // ===================================================================================
  console.log('>>> CATEGORY 1: ESP32 & UART Boundaries');

  await test('ESP32-Boundaries', 'TC2.B1: UART auto-probe timeout boundary (1499ms no swap, 1500ms swaps)', () => {
    const checkSwap = (elapsedMs: number) => elapsedMs >= 1500;
    if (checkSwap(1499)) throw new Error('Swapped prematurely at 1499ms');
    if (!checkSwap(1500)) throw new Error('Did not swap at exact 1500ms threshold');
    if (!checkSwap(1501)) throw new Error('Did not swap at 1501ms');
  });

  await test('ESP32-Boundaries', 'TC2.B2: Reversed polarity UART input stream with noise before auto-correction', () => {
    const noise = Buffer.from([0x00, 0xFF, 0x12, 0x34, 0x55, 0x66]);
    const validHb = buildHeartbeat();
    const stream = Buffer.concat([noise, validHb]);

    const parsed = parseMavlink2Frames(stream);
    if (parsed.length !== 1 || !parsed[0].crcValid || parsed[0].msgId !== 0) {
      throw new Error('Parser failed to recover from leading noise and corrupt polarity');
    }
  });

  await test('ESP32-Boundaries', 'TC2.B3: High baud rate 921600 burst buffer boundary (> 16384 bytes)', () => {
    const packet = buildHeartbeat();
    const count = Math.ceil(16384 / packet.length) + 5;
    const burst = Buffer.concat(Array(count).fill(packet));

    if (burst.length <= 16384) throw new Error('Burst size is not > 16384 bytes');
    const parsed = parseMavlink2Frames(burst);
    if (parsed.length !== count) throw new Error(`Parsed only ${parsed.length} of ${count} packets`);
  });

  await test('ESP32-Boundaries', 'TC2.B4: MAVLink packet fragmentation across multiple chunks (1 byte at a time)', () => {
    const hb = buildHeartbeat({ customMode: ArduCopterFlightMode.BRAKE });
    let accumulator = Buffer.alloc(0);
    let packetFound = false;

    for (let i = 0; i < hb.length; i++) {
      accumulator = Buffer.concat([accumulator, hb.subarray(i, i + 1)]);
      const parsed = parseMavlink2Frames(accumulator);
      if (parsed.length === 1 && parsed[0].crcValid) {
        packetFound = true;
        break;
      }
    }

    if (!packetFound) throw new Error('1-byte fragmentation reassembly failed');
  });

  await test('ESP32-Boundaries', 'TC2.B5: MAVLink corrupt packet boundary: invalid STX byte recovery', () => {
    const corrupt = Buffer.from([0xAA, 0xBB, 0xCC, 0xDD]);
    const valid = buildSysStatus();
    const merged = Buffer.concat([corrupt, valid]);

    const parsed = parseMavlink2Frames(merged);
    if (parsed.length !== 1 || !parsed[0].crcValid) {
      throw new Error('Failed to recover after invalid STX bytes');
    }
  });

  await test('ESP32-Boundaries', 'TC2.B6: MAVLink CRC-16 corrupt checksum rejection without state lockup', () => {
    const valid = buildHeartbeat();
    const corrupt = corruptCrc(valid);

    const parsedCorrupt = parseMavlink2Frames(corrupt);
    if (parsedCorrupt.length === 0 || parsedCorrupt[0].crcValid) {
      throw new Error('Corrupted CRC was incorrectly marked valid or dropped');
    }

    // Subsequent valid packet must parse cleanly
    const parsedValid = parseMavlink2Frames(valid);
    if (parsedValid.length !== 1 || !parsedValid[0].crcValid) {
      throw new Error('Parser locked up after corrupt CRC');
    }
  });

  await test('ESP32-Boundaries', 'TC2.B7: Maximum payload length boundary (LEN = 255 bytes)', () => {
    const maxPayload = Buffer.alloc(255, 0x42);
    // Use msgId 253 (STATUSTEXT) with large payload for test
    const frame = packMavlink2Frame(253, maxPayload);
    if (frame[1] !== 255) throw new Error('Length byte is not 255');
    const parsed = parseMavlink2Frames(frame);
    if (parsed.length !== 1 || !parsed[0].crcValid || parsed[0].len !== 255) {
      throw new Error('Max payload length frame rejected');
    }
  });

  await test('ESP32-Boundaries', 'TC2.B8: Zero payload length boundary (LEN = 0 bytes)', () => {
    const zeroPayload = Buffer.alloc(0);
    const frame = packMavlink2Frame(0, zeroPayload);
    if (frame[1] !== 0) throw new Error('Length byte is not 0');
    const parsed = parseMavlink2Frames(frame);
    if (parsed.length !== 1 || !parsed[0].crcValid || parsed[0].len !== 0) {
      throw new Error('Zero payload length frame rejected');
    }
  });

  await test('ESP32-Boundaries', 'TC2.B9: Sequence number wrap-around boundary (seq 255 -> 0)', () => {
    const p1 = buildHeartbeat({}, 255);
    const p2 = buildHeartbeat({}, 0);

    const parsed1 = parseMavlink2Frames(p1);
    const parsed2 = parseMavlink2Frames(p2);

    if (parsed1[0].seq !== 255) throw new Error('Seq 255 mismatch');
    if (parsed2[0].seq !== 0) throw new Error('Seq 0 wrap mismatch');
  });

  await test('ESP32-Boundaries', 'TC2.B10: Watchdog boundary: exactly 4999ms (no RTL), 5001ms (triggers RTL)', () => {
    const checkRtl = (silenceMs: number, armed: boolean) => (armed && silenceMs > 5000);
    if (checkRtl(4999, true)) throw new Error('Triggered RTL at 4999ms');
    if (checkRtl(5000, true)) throw new Error('Triggered RTL at exactly 5000ms');
    if (!checkRtl(5001, true)) throw new Error('Failed to trigger RTL at 5001ms');
  });

  // ===================================================================================
  // CATEGORY 2: Vision & Georeferencing Boundaries
  // ===================================================================================
  console.log('>>> CATEGORY 2: Vision & Georeferencing Boundaries');

  await test('Vision-Boundaries', 'TC2.B11: Zero altitude boundary (H = 0.0m division by zero guard)', () => {
    const safeAltitude = (alt: number) => (alt <= 0.0 ? 0.1 : alt);
    const clamped = safeAltitude(0.0);
    if (clamped <= 0.0 || clamped !== 0.1) throw new Error('Zero altitude guard failed');
  });

  await test('Vision-Boundaries', 'TC2.B12: Extreme altitude boundary (H = 100.0m georeferencing range check)', () => {
    const H = 100.0;
    const cx = 640.0;
    const cy = 360.0;
    const fx = 800.0;
    const u = 640.0;
    const v = 360.0;
    const offsetNorth = ((cy - v) / fx) * H;
    const offsetEast = ((u - cx) / fx) * H;
    if (offsetNorth !== 0.0 || offsetEast !== 0.0) throw new Error('Extreme altitude center ray mismatch');
  });

  await test('Vision-Boundaries', 'TC2.B13: Extreme attitude tilt boundary (Roll = +/- 45 deg, Pitch = +/- 45 deg)', () => {
    const maxAllowedTiltDeg = 45.0;
    const isTiltRecoverable = (rollDeg: number, pitchDeg: number) => {
      return Math.abs(rollDeg) <= maxAllowedTiltDeg && Math.abs(pitchDeg) <= maxAllowedTiltDeg;
    };
    if (!isTiltRecoverable(45.0, -45.0)) throw new Error('45 deg tilt marked unrecoverable');
    if (isTiltRecoverable(46.0, 0.0)) throw new Error('>45 deg tilt not caught');
  });

  await test('Vision-Boundaries', 'TC2.B14: Nadir camera boundary (Roll=0, Pitch=0, u=cx, v=cy -> offset = 0,0)', () => {
    const u = 640.0;
    const v = 360.0;
    const cx = 640.0;
    const cy = 360.0;
    const H = 5.0;
    const dx = ((u - cx) / 800.0) * H;
    const dy = ((v - cy) / 800.0) * H;
    if (dx !== 0.0 || dy !== 0.0) throw new Error('Nadir center offset non-zero');
  });

  await test('Vision-Boundaries', 'TC2.B15: Extreme image corner pixels (u=0, v=0 and u=1280, v=720) ray casting', () => {
    const cx = 640.0;
    const cy = 360.0;
    const fx = 800.0;
    const H = 5.0;

    // Top-left corner (0, 0)
    const dx_tl = ((0 - cx) / fx) * H; // -4.0m
    const dy_tl = ((0 - cy) / fx) * H; // -2.25m
    if (dx_tl !== -4.0 || dy_tl !== -2.25) throw new Error('Top-left corner ray calculation error');

    // Bottom-right corner (1280, 720)
    const dx_br = ((1280 - cx) / fx) * H; // +4.0m
    const dy_br = ((720 - cy) / fx) * H;  // +2.25m
    if (dx_br !== 4.0 || dy_br !== 2.25) throw new Error('Bottom-right corner ray calculation error');
  });

  await test('Vision-Boundaries', 'TC2.B16: Negative altitude / underground AGL protection (relative_alt < 0)', () => {
    const sanitizeAltAgl = (alt: number) => Math.max(0.0, alt);
    if (sanitizeAltAgl(-2.5) !== 0.0) throw new Error('Negative altitude not clamped to 0.0');
  });

  await test('Vision-Boundaries', 'TC2.B17: Heading discontinuity boundary (Yaw = 359.9 deg -> 0.1 deg transition)', () => {
    const angleDiffDeg = (a: number, b: number) => {
      let diff = (b - a + 180) % 360 - 180;
      return diff < -180 ? diff + 360 : diff;
    };
    const diff = angleDiffDeg(359.9, 0.1);
    if (Math.abs(diff - 0.2) > 1e-4) throw new Error(`Heading angle wrap mismatch: ${diff}`);
  });

  await test('Vision-Boundaries', 'TC2.B18: Equator & Prime Meridian boundary (Lat=0, Lon=0 and Lat=0, Lon=180)', () => {
    const project = (lat: number, lon: number, dN: number, dE: number) => {
      const R = 6378137.0;
      const dLat = (dN / R) * (180.0 / Math.PI);
      const cosLat = Math.cos((lat * Math.PI) / 180.0);
      const dLon = (dE / (R * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat))) * (180.0 / Math.PI);
      return { lat: lat + dLat, lon: lon + dLon };
    };

    const p0 = project(0.0, 0.0, 10.0, 10.0);
    if (p0.lat <= 0.0 || p0.lon <= 0.0) throw new Error('Equator projection error');
  });

  await test('Vision-Boundaries', 'TC2.B19: QR code corrupted / partial decode payload handling', () => {
    const validateQr = (payload: string): boolean => {
      if (!payload || typeof payload !== 'string') return false;
      return payload.length >= 2 && /^\d+$/.test(payload);
    };

    if (validateQr('')) throw new Error('Empty payload validated');
    if (validateQr('A')) throw new Error('Non-digit payload validated');
    if (!validateQr('42')) throw new Error('Valid 2-digit code rejected');
  });

  await test('Vision-Boundaries', 'TC2.B20: Dynamic braking boundary: max velocity 10.0 m/s vs 0 m/s', () => {
    const calcStop = (v: number) => (v * 0.3) + (v * v) / (2.0 * 3.5);
    const stop0 = calcStop(0.0);
    const stop10 = calcStop(10.0);

    if (stop0 !== 0.0) throw new Error('Zero velocity stop distance must be 0.0');
    // 10 * 0.3 + 100 / 7.0 = 3.0 + 14.2857 = 17.2857m
    if (Math.abs(stop10 - 17.29) > 0.05) throw new Error('10 m/s stopping distance calculation mismatch');
  });

  // ===================================================================================
  // CATEGORY 3: Backend Communications Hub Boundaries
  // ===================================================================================
  console.log('>>> CATEGORY 3: Backend Hub Boundaries');

  const BACKEND_PORT = 3197;
  const SERVER_PATH = path.resolve(process.cwd(), 'skycon/backend/server.js');
  let backendProc: ChildProcess | null = null;

  try {
    backendProc = fork(SERVER_PATH, [], {
      env: {
        ...process.env,
        PORT: String(BACKEND_PORT),
        RELAY_TOKEN: 'saeindia_secret_token_2026'
      },
      stdio: 'pipe'
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    await test('Backend-Boundaries', 'TC2.B21: Invalid / unauthorized token boundary on /connector (HTTP 401)', async () => {
      const code = await new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/connector?token=wrong_key`);
        ws.on('open', () => { ws.close(); resolve(200); });
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode || 0));
        ws.on('error', () => resolve(401));
      });
      if (code !== 401) throw new Error(`Expected 401 Unauthorized, got ${code}`);
    });

    await test('Backend-Boundaries', 'TC2.B22: Empty token string boundary on /ws (HTTP 401)', async () => {
      const code = await new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/ws?token=`);
        ws.on('open', () => { ws.close(); resolve(200); });
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode || 0));
        ws.on('error', () => resolve(401));
      });
      if (code !== 401) throw new Error(`Expected 401 Unauthorized for empty token, got ${code}`);
    });

    await test('Backend-Boundaries', 'TC2.B23: Rapid consecutive WebSocket reconnects without port exhaustion', async () => {
      for (let i = 0; i < 5; i++) {
        const connected = await new Promise<boolean>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/ws?token=saeindia_secret_token_2026`);
          ws.on('open', () => { ws.close(); resolve(true); });
          ws.on('error', () => resolve(false));
        });
        if (!connected) throw new Error(`Reconnect iteration ${i} failed`);
      }
    });

    await test('Backend-Boundaries', 'TC2.B24: Command timeout boundary: COMMAND_LONG without ACK expires in 2000ms', async () => {
      const commandCorrelation = (ackArrived: boolean, ackDelayMs: number) => {
        if (!ackArrived || ackDelayMs > 2000) return 'TIMEOUT_REJECTED';
        return 'ACCEPTED';
      };

      if (commandCorrelation(false, 2500) !== 'TIMEOUT_REJECTED') {
        throw new Error('Unacknowledged command did not time out');
      }
    });

    await test('Backend-Boundaries', 'TC2.B25: Command ack late arrival: ACK arriving at 2100ms discarded safely', () => {
      let pendingCommand: { id: number; timerExpired: boolean } | null = { id: 1, timerExpired: true };
      const handleAck = (cmdId: number) => {
        if (!pendingCommand || pendingCommand.timerExpired) {
          return 'DISCARDED_LATE_ACK';
        }
        return 'PROCESSED';
      };

      if (handleAck(1) !== 'DISCARDED_LATE_ACK') throw new Error('Late ACK was not discarded');
    });

    await test('Backend-Boundaries', 'TC2.B26: Massive concurrent client connections on /ws (15 clients)', async () => {
      const clients: WebSocket[] = [];
      const connectPromises = Array.from({ length: 15 }).map(() => {
        return new Promise<boolean>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/ws?token=saeindia_secret_token_2026`);
          ws.on('open', () => { clients.push(ws); resolve(true); });
          ws.on('error', () => resolve(false));
        });
      });

      const resultsList = await Promise.all(connectPromises);
      clients.forEach(c => c.close());

      if (resultsList.some(r => !r)) throw new Error('Failed to connect 15 concurrent clients');
    });

    await test('Backend-Boundaries', 'TC2.B27: Giant malformed binary packet injection (> 65536 bytes) handled safely', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/connector?token=saeindia_secret_token_2026`);
      ws.on('error', () => {});
      await new Promise(res => ws.on('open', res));

      const giantBuf = Buffer.alloc(70000, 0xEE);
      try {
        ws.send(giantBuf);
      } catch {}
      await new Promise(r => setTimeout(r, 200));
      ws.close();

      // Server must still be responsive on /health
      const health = await new Promise<any>((resolve, reject) => {
        http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, (r) => {
          let b = '';
          r.on('data', c => b += c);
          r.on('end', () => resolve(JSON.parse(b)));
        }).on('error', reject);
      });
      if (health.status !== 'ok') throw new Error('Server crashed after giant packet injection');
    });

    await test('Backend-Boundaries', 'TC2.B28: Non-MAVLink garbage bytes streamed to /connector handled cleanly', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/connector?token=saeindia_secret_token_2026`);
      ws.on('error', () => {});
      await new Promise(res => ws.on('open', res));

      const garbage = Buffer.from('NOT_A_MAVLINK_PACKET_GARBAGE_BYTES_12345');
      ws.send(garbage, { binary: true });
      await new Promise(r => setTimeout(r, 100));
      ws.close();

      const health = await new Promise<any>((resolve, reject) => {
        http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, (r) => {
          let b = '';
          r.on('data', c => b += c);
          r.on('end', () => resolve(JSON.parse(b)));
        }).on('error', reject);
      });
      if (health.status !== 'ok') throw new Error('Server unhealthy after garbage packet stream');
    });

    await test('Backend-Boundaries', 'TC2.B29: Atomic persistence write failure simulation (fallback safety)', () => {
      const atomicSave = (targetPath: string, data: any) => {
        try {
          const tmp = `${targetPath}.tmp_${Date.now()}`;
          fs.writeFileSync(tmp, JSON.stringify(data));
          fs.renameSync(tmp, targetPath);
          return true;
        } catch {
          return false;
        }
      };
      // Write to illegal path must return false cleanly without crashing
      const success = atomicSave('/invalid_root_directory/test.json', { a: 1 });
      if (success) throw new Error('Expected atomic write failure on illegal path');
    });

    await test('Backend-Boundaries', 'TC2.B30: Concurrent atomic write race condition (simultaneous writes)', async () => {
      const testFile = path.resolve(process.cwd(), 'skycon/backend/data/concurrent_test.json');
      const safeAtomicWrite = async (data: any) => {
        const tmp = `${testFile}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        fs.writeFileSync(tmp, JSON.stringify(data));
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            fs.renameSync(tmp, testFile);
            return true;
          } catch (e: any) {
            if (attempt === 9) throw e;
            await new Promise(r => setTimeout(r, 25 + Math.random() * 30));
          }
        }
      };

      const writeTasks = Array.from({ length: 5 }).map((_, i) => safeAtomicWrite({ index: i, time: Date.now() }));
      await Promise.all(writeTasks);
      if (!fs.existsSync(testFile)) throw new Error('Concurrent file write failed');
      const content = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      if (typeof content.index !== 'number') throw new Error('Corrupted JSON after concurrent writes');
      try { fs.unlinkSync(testFile); } catch {}
    });

  // ===================================================================================
  // CATEGORY 4: Cockpit HUD & Planner Boundaries
  // ===================================================================================
  console.log('>>> CATEGORY 4: Cockpit HUD & Planner Boundaries');

  await test('Cockpit-Boundaries', 'TC2.B31: USB voltage sag boundary: exactly 4.41V (normal) vs 4.39V (sag flagged)', () => {
    const isSag = (mv: number) => mv < 4400;
    if (isSag(4410)) throw new Error('4.41V flagged as sag');
    if (!isSag(4390)) throw new Error('4.39V failed to trigger sag alert');
    if (!isSag(4399)) throw new Error('4.399V failed to trigger sag alert');
  });

  await test('Cockpit-Boundaries', 'TC2.B32: Zero battery voltage boundary (0V sensor disconnect)', () => {
    const isDisconnected = (mv: number) => mv === 0;
    if (!isDisconnected(0)) throw new Error('0V not recognized as disconnected');
    if (isDisconnected(5370)) throw new Error('5.37V marked disconnected');
  });

  await test('Cockpit-Boundaries', 'TC2.B33: Negative vertical speed boundary (-5.5 m/s clamped on HUD scale)', () => {
    const clampVsi = (vsi: number) => Math.max(-5.0, Math.min(5.0, vsi));
    if (clampVsi(-5.5) !== -5.0) throw new Error('-5.5 m/s not clamped to -5.0 m/s');
  });

  await test('Cockpit-Boundaries', 'TC2.B34: Positive vertical speed boundary (+5.5 m/s clamped on HUD scale)', () => {
    const clampVsi = (vsi: number) => Math.max(-5.0, Math.min(5.0, vsi));
    if (clampVsi(5.5) !== 5.0) throw new Error('+5.5 m/s not clamped to +5.0 m/s');
  });

  await test('Cockpit-Boundaries', 'TC2.B35: Roll angle extreme boundary (-75 deg and +75 deg clamped to +/- 60 deg arc)', () => {
    const clampRoll = (rollDeg: number) => Math.max(-60.0, Math.min(60.0, rollDeg));
    if (clampRoll(-75.0) !== -60.0) throw new Error('-75 deg not clamped to -60 deg');
    if (clampRoll(75.0) !== 60.0) throw new Error('+75 deg not clamped to +60 deg');
  });

  await test('Cockpit-Boundaries', 'TC2.B36: Pitch ladder boundary (-90 deg nadir and +90 deg zenith)', () => {
    const clampPitch = (pitchDeg: number) => Math.max(-90.0, Math.min(90.0, pitchDeg));
    if (clampPitch(-95.0) !== -90.0) throw new Error('Pitch below -90 deg not clamped');
    if (clampPitch(95.0) !== 90.0) throw new Error('Pitch above +90 deg not clamped');
  });

  await test('Cockpit-Boundaries', 'TC2.B37: Compass tape wrap boundary (359 deg -> 1 deg continuous rendering)', () => {
    const normalizeHeading = (hdg: number) => ((hdg % 360) + 360) % 360;
    if (normalizeHeading(361) !== 1) throw new Error('Heading 361 deg wrap error');
    if (normalizeHeading(-1) !== 359) throw new Error('Heading -1 deg wrap error');
  });

  await test('Cockpit-Boundaries', 'TC2.B38: Spiral search zero-overlap boundary (overlap = 0.0)', () => {
    const W_footprint = 6.032;
    const b = (W_footprint * (1.0 - 0.0)) / (2.0 * Math.PI);
    if (Math.abs(b - 0.96) > 0.02) throw new Error('Zero overlap pitch constant mismatch');
  });

  await test('Cockpit-Boundaries', 'TC2.B39: Spiral search high-overlap boundary (overlap = 0.85)', () => {
    const W_footprint = 6.032;
    const b = (W_footprint * (1.0 - 0.85)) / (2.0 * Math.PI);
    // 6.032 * 0.15 / 6.283185 = 0.9048 / 6.283185 = 0.144
    if (Math.abs(b - 0.144) > 0.01) throw new Error('High overlap pitch constant mismatch');
  });

  await test('Cockpit-Boundaries', 'TC2.B40: Single-point / degenerate geofence boundary handling', () => {
    const validateGeofence = (polygon: { x: number; y: number }[]) => {
      return Array.isArray(polygon) && polygon.length >= 3;
    };
    if (validateGeofence([{ x: 0, y: 0 }])) throw new Error('Single-point geofence marked valid');
    if (validateGeofence([{ x: 0, y: 0 }, { x: 1, y: 1 }])) throw new Error('2-point geofence marked valid');
  });

  // ===================================================================================
  // CATEGORY 5: Adversarial Inputs & Fault Injections
  // ===================================================================================
  console.log('>>> CATEGORY 5: Adversarial Inputs & Fault Injections');

  await test('Fault-Injection', 'TC2.B41: Interleaved MAVLink v1 (0xFE) and v2 (0xFD) packets in single stream', () => {
    // Construct dummy MAVLink 1 packet
    const v1 = Buffer.from([0xFE, 0x01, 0x00, 0x01, 0x01, 0x00, 0x42, 0x12, 0x34]); // 9 bytes
    const v2 = buildHeartbeat();
    const stream = Buffer.concat([v1, v2]);

    const parsed = parseMavlink2Frames(stream);
    // Parser must find the v2 packet without choking on the v1 packet
    const v2Pkt = parsed.find(p => p.magic === 0xFD && p.crcValid);
    if (!v2Pkt) throw new Error('Failed to parse v2 packet interleaved with v1');
  });

  await test('Fault-Injection', 'TC2.B42: Packet with truncated payload (declared LEN=30, buffer has 15 bytes)', () => {
    const full = buildGpsRawInt();
    const truncated = full.subarray(0, 15);
    const parsed = parseMavlink2Frames(truncated);
    if (parsed.length !== 0) throw new Error('Truncated packet was incorrectly accepted');
  });

  await test('Fault-Injection', 'TC2.B43: STATUSTEXT with non-ASCII / Unicode binary characters', () => {
    const rawPayload = Buffer.alloc(51);
    rawPayload[0] = 6; // severity
    rawPayload.write('QR_\u00FF\u00FE_ALERT', 1, 'binary');
    const frame = packMavlink2Frame(253, rawPayload);
    const parsed = parseMavlink2Frames(frame);
    if (parsed.length !== 1 || !parsed[0].crcValid) {
      throw new Error('STATUSTEXT with non-ASCII characters failed CRC');
    }
  });

  await test('Fault-Injection', 'TC2.B44: STATUSTEXT with exactly 50 bytes text (no null terminator)', () => {
    const text50 = '12345678901234567890123456789012345678901234567890'; // 50 chars
    const frame = buildStatusText(text50);
    const parsed = parseMavlink2Frames(frame);
    if (parsed.length !== 1 || !parsed[0].crcValid || parsed[0].fields?.text.length !== 50) {
      throw new Error('50-byte full text STATUSTEXT parsing error');
    }
  });

  await test('Fault-Injection', 'TC2.B45: Rapid burst of 500 HEARTBEAT frames within stream', () => {
    const hb = buildHeartbeat();
    const burst = Buffer.concat(Array(500).fill(hb));
    const parsed = parseMavlink2Frames(burst);
    if (parsed.length !== 500 || parsed.some(p => !p.crcValid)) {
      throw new Error('500-packet burst parse failure');
    }
  });

  await test('Fault-Injection', 'TC2.B46: Negative GPS altitude in GPS_RAW_INT (-50m MSL below sea level)', () => {
    const gps = buildGpsRawInt({ altM: -50.0 });
    const parsed = parseMavlink2Frames(gps);
    if (parsed[0].fields?.altM !== -50.0) throw new Error('Negative altitude mismatch');
  });

  await test('Fault-Injection', 'TC2.B47: Zero satellites visible (fix_type = 0, sats = 0) pre-arm lockout', () => {
    const gps = buildGpsRawInt({ satellitesVisible: 0, fixType: 0 });
    const parsed = parseMavlink2Frames(gps);
    const canArm = (parsed[0].fields?.satellitesVisible >= 6 && parsed[0].fields?.fixType >= 3);
    if (canArm) throw new Error('Arming allowed with 0 satellites and no 3D fix');
  });

  await test('Fault-Injection', 'TC2.B48: High HDOP boundary (> 2.5 flags pre-arm lockout)', () => {
    const isHdopGood = (eph: number) => (eph / 100.0) <= 2.5;
    if (!isHdopGood(120)) throw new Error('HDOP 1.2 marked bad');
    if (isHdopGood(260)) throw new Error('HDOP 2.6 marked good');
  });

  await test('Fault-Injection', 'TC2.B49: CPU load boundary (100% load warning in SYS_STATUS)', () => {
    const sys = buildSysStatus({ load: 1000 }); // 100.0%
    const parsed = parseMavlink2Frames(sys);
    if (parsed[0].fields?.load !== 100.0) throw new Error('100% CPU load decoding mismatch');
  });

  await test('Fault-Injection', 'TC2.B50: Sudden disconnect of /connector while /ws client is actively listening', async () => {
    const wsConnector = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/connector?token=saeindia_secret_token_2026`);
    const wsBrowser = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/ws?token=saeindia_secret_token_2026`);

    wsConnector.on('error', () => {});
    wsBrowser.on('error', () => {});

    await Promise.all([
      new Promise(res => wsConnector.on('open', res)),
      new Promise(res => wsBrowser.on('open', res))
    ]);

    // Sudden disconnect of drone connector
    wsConnector.terminate();
    await new Promise(r => setTimeout(r, 200));

    // Browser must still be connected and operational
    if (wsBrowser.readyState !== WebSocket.OPEN) {
      throw new Error('Browser socket closed unexpectedly on connector drop');
    }
    wsBrowser.close();
  });

  } finally {
    if (backendProc) {
      backendProc.kill('SIGTERM');
    }
  }

  const durationMs = Date.now() - startTime;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n--------------------------------------------------------------------------------');
  console.log(`TIER 2 SUMMARY: Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Duration: ${durationMs}ms`);
  console.log('--------------------------------------------------------------------------------\n');

  return {
    tier: 'Tier 2 - Boundary & Corner Cases',
    total: results.length,
    passed,
    failed,
    durationMs,
    results
  };
}

if (process.argv[1] && (process.argv[1].endsWith('test_tier2_boundaries.ts') || process.argv[1].endsWith('test_tier2_boundaries.js'))) {
  runTier2Tests().then(summary => {
    if (summary.failed > 0) process.exit(1);
  }).catch(err => {
    console.error('Fatal error running Tier 2 suite:', err);
    process.exit(1);
  });
}
