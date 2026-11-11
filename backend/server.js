import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';
import Anthropic from '@anthropic-ai/sdk';

import atomicStore, {
  saveJsonAtomic,
  loadJsonSafe,
  persistDetection,
  logTelemetry,
  queryDetections,
  computeSha256,
  verifyOrAttachChecksum
} from './atomic_store.js';

import {
  MavlinkMultiplexer,
  COPTER_MODES,
  MODE_NAME_TO_INT,
  MAV_RESULT
} from './mavlink_multiplexer.js';

import { CommandDispatcher } from './command_dispatcher.js';
import { ProfileManager } from './profile_manager.js';

// Global Process Crash Immunity Guards (Prevents Render "Exited with status 1" crashes)
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught exception intercepted (Server crash prevented):', err?.stack || err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled promise rejection intercepted (Server crash prevented):', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to compiled frontend dist directory
const distCandidates = [
  path.resolve(__dirname, '../frontend/dist'),
  path.resolve(__dirname, '../dist'),
  path.resolve(__dirname, './dist'),
  path.resolve(process.cwd(), 'frontend/dist'),
  path.resolve(process.cwd(), 'dist')
];
const DIST_PATH = distCandidates.find(p => fs.existsSync(p)) || null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
};

const PORT = process.env.PORT || 8443;
const RELAY_TOKEN = process.env.RELAY_TOKEN || 'saeindia_secret_token_2026';

// Anthropic Claude client — used by /api/ai/chat
// ponytail: single lazy instance; skip if key absent (graceful degradation)
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
if (!anthropic) {
  console.warn('[AI] ANTHROPIC_API_KEY not set — /api/ai/chat will return 503. Set the key in .env to enable.');
}

// Global relay state
let connectorSocket = null;
let esp32Online = false;
let esp32LastError = '';
const browserSockets = new Set();

let rxBytesTotal = 0;
let txBytesTotal = 0;
let packetsForwarded = 0;
let lastPacketTime = Date.now();

// Fast no-op error callback to avoid allocating closures on every packet
const noop = () => {};

// Active Mission Upload Job Tracking
let currentUploadJob = {
  upload_id: null,
  status: 'IDLE', // IDLE | UPLOADING | SUCCESS | FAILED
  itemCount: 0,
  lastSeqRequested: -1,
  lastAckResult: null,
  startTime: 0,
  durationMs: 0,
  errorMessage: null
};

// AERORECON Database Persistence: Durable File-Based Storage in backend/data/
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

const MISSIONS_FILE = path.join(DATA_DIR, 'missions.json');
const DETECTIONS_FILE = path.join(DATA_DIR, 'detections.json');
const HEATMAP_FILE = path.join(DATA_DIR, 'heatmap.json');
const OBJECTS_FILE = path.join(DATA_DIR, 'objects.json');
let latestHeatmapData = loadJsonSafe(HEATMAP_FILE, null);
let objectRegistry = loadJsonSafe(OBJECTS_FILE, []);

// In-Memory caches backed by durable disk storage
let missions = loadJsonSafe(MISSIONS_FILE, []);
const MAX_RECON_DETECTIONS = 50;
let reconDetections = loadJsonSafe(DETECTIONS_FILE, []);

// In-Memory cache for the latest QR Alert (instantly dispatched to reconnected GCS phones)
let latestQrAlert = null;
if (Array.isArray(reconDetections) && reconDetections.length > 0) {
  const existingQr = reconDetections.find(d => d.twoDigitCode);
  if (existingQr) {
    latestQrAlert = {
      type: 'QR_ALERT',
      digits: String(existingQr.twoDigitCode),
      timestamp: existingQr.timestamp || Date.now()
    };
  }
}

function getActiveMission() {
  return missions.find(m => (m.status === 'EXECUTING' || m.status === 'ACTIVE') && (!m.deadline || Date.now() < m.deadline)) || null;
}

// ----------------------------------------------------------------------------
// Initialize MAVLink Multiplexer, Command Dispatcher & Profile Manager
// ----------------------------------------------------------------------------

const sendToDroneBinary = (packetBuffer) => {
  if (!connectorSocket || connectorSocket.readyState !== WebSocket.OPEN) {
    throw new Error('Drone / ESP32 is offline on cloud relay');
  }
  connectorSocket.send(packetBuffer, { binary: true, mask: false }, noop);
};

const mavlinkMux = new MavlinkMultiplexer({
  historyLimit: 1000,
  onCommandAck: (ack) => {
    commandDispatcher.handleAck(ack);
  },
  onTelemetryFrame: (frame) => {
    // Log frame to WAL-mode SQLite
    logTelemetry(frame);

    // Broadcast demultiplexed telemetry frame to connected browsers
    if (browserSockets.size > 0) {
      const jsonStr = JSON.stringify(frame);
      for (const browser of browserSockets) {
        if (browser.readyState === WebSocket.OPEN && browser.bufferedAmount < 65536) {
          try {
            browser.send(jsonStr, noop);
          } catch (e) {}
        }
      }
    }
  },
  onStatusText: (statusTextEntry) => {
    if (browserSockets.size > 0) {
      const msg = JSON.stringify({
        type: 'STATUSTEXT',
        ...statusTextEntry
      });
      for (const browser of browserSockets) {
        if (browser.readyState === WebSocket.OPEN) {
          try {
            browser.send(msg, noop);
          } catch (e) {}
        }
      }
    }
  },
  onMissionEvent: (msgId, buf, pOffset, pLen, direction) => {
    // Retain full mission tracking compatibility with Section 5 E2E tests
    if (msgId === 44) {
      const count = buf.readUInt16LE(pOffset);
      if (direction === 'TX' && currentUploadJob.status === 'UPLOADING') {
        currentUploadJob.itemCount = count;
      }
    } else if (msgId === 40 || msgId === 51) {
      const reqSeq = buf.readUInt16LE(pOffset);
      if (currentUploadJob.status === 'UPLOADING') {
        currentUploadJob.lastSeqRequested = reqSeq;
      }
    } else if (msgId === 47) {
      const ackResult = buf[pOffset + 2];
      if (direction === 'RX' && currentUploadJob.status === 'UPLOADING') {
        currentUploadJob.lastAckResult = ackResult;
        currentUploadJob.durationMs = Date.now() - currentUploadJob.startTime;
        if (ackResult === 0) {
          currentUploadJob.status = 'SUCCESS';
          console.log(`[MISSION] upload_id=${currentUploadJob.upload_id} SUCCESS duration=${(currentUploadJob.durationMs / 1000).toFixed(2)}s`);
        } else {
          currentUploadJob.status = 'FAILED';
          currentUploadJob.errorMessage = `MISSION_ACK rejected: code ${ackResult}`;
          console.warn(`[MISSION] upload_id=${currentUploadJob.upload_id} FAILED: code ${ackResult}`);
        }
      }
    }
  }
});

const commandDispatcher = new CommandDispatcher({
  sendFn: sendToDroneBinary,
  getStatusTextsFn: (windowMs) => mavlinkMux.getRecentStatusTexts(windowMs),
  timeoutMs: 2000,
  retries: 1
});

const profileManager = new ProfileManager({
  initialProfile: 'FIELD',
  sendFn: sendToDroneBinary
});

// ----------------------------------------------------------------------------
// HTTP Server & REST Endpoints
// ----------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const parsedUrl = parse(req.url, true);

  // Universal CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-relay-token'
    });
    res.end();
    return;
  }
  
  // 1. Health Probe
  if (parsedUrl.pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });
    res.end(JSON.stringify({
      service: 'SAE INDIA Ultra-Low-Latency MAVLink WSS Relay',
      status: 'ok',
      uptime: process.uptime(),
      connectorOnline: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN,
      esp32Online,
      esp32LastError,
      browserClientsCount: browserSockets.size,
      rxBytesTotal,
      txBytesTotal,
      packetsForwarded,
      lastPacketAgeMs: Date.now() - lastPacketTime,
      currentUploadJob,
      tcpNoDelay: true,
      perMessageDeflate: false,
      activeProfile: profileManager.activeProfile,
      telemetry: mavlinkMux.getState()
    }, null, 2));
    return;
  }

  // 2. Telemetry History (Last 1000 frames)
  if (parsedUrl.pathname === '/api/telemetry/history' && req.method === 'GET') {
    const limit = Math.min(1000, Math.max(1, parseInt(parsedUrl.query?.limit, 10) || 1000));
    const history = mavlinkMux.getHistory(limit);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });
    res.end(JSON.stringify({
      success: true,
      count: history.length,
      history
    }));
    return;
  }

  // 3. Parameter Profile Swapper (BENCH vs FIELD)
  if (parsedUrl.pathname === '/api/params/profile') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const profile = payload.profile || 'FIELD';
          const sync = Boolean(payload.sync);
          const result = await profileManager.applyProfile(profile, { syncToDrone: sync });

          // Broadcast profile change to connected browsers
          const broadcastMsg = JSON.stringify({
            type: 'PARAM_PROFILE_CHANGED',
            profile: result.profile,
            keyOverrides: result.keyOverrides,
            appliedAt: result.appliedAt
          });
          for (const browser of browserSockets) {
            if (browser.readyState === WebSocket.OPEN) {
              try { browser.send(broadcastMsg, noop); } catch (e) {}
            }
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store'
      });
      res.end(JSON.stringify({
        success: true,
        ...profileManager.getStatus(),
        readbackValidation: profileManager.validateReadback()
      }));
      return;
    }
  }

  // 4. Command Uplink REST Endpoints (Non-Blocking Handshake Correlator)
  if (parsedUrl.pathname === '/api/command/arm' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const force = Boolean(payload.force);
        const result = await commandDispatcher.arm(force);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        const status = err.message.includes('offline') ? 503 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
          code: err.code || 'COMMAND_FAILED'
        }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/command/mode' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const mode = payload.mode || 'LOITER';
        const result = await commandDispatcher.setMode(mode);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        const status = err.message.includes('offline') ? 503 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
          code: err.code || 'COMMAND_FAILED'
        }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/command/takeoff' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const altitude = Number(payload.altitude) || 5.0;
        const result = await commandDispatcher.takeoff(altitude);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        const status = err.message.includes('offline') ? 503 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
          code: err.code || 'COMMAND_FAILED'
        }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/command' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const cmdName = String(payload.command || '').toUpperCase();
        let result;

        if (cmdName === 'ARM') {
          result = await commandDispatcher.arm(Boolean(payload.force));
        } else if (cmdName === 'DISARM') {
          result = await commandDispatcher.disarm(Boolean(payload.force));
        } else if (cmdName === 'SET_MODE') {
          result = await commandDispatcher.setMode(payload.mode || 'LOITER');
        } else if (cmdName === 'TAKEOFF') {
          result = await commandDispatcher.takeoff(Number(payload.altitude) || 5.0);
        } else {
          const cmdId = parseInt(payload.command, 10);
          if (isNaN(cmdId)) {
            throw new Error(`Invalid command parameter: ${payload.command}`);
          }
          result = await commandDispatcher.dispatch(cmdId, payload.params || {});
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        const status = err.message.includes('offline') ? 503 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
          code: err.code || 'COMMAND_FAILED'
        }));
      }
    });
    return;
  }

  // 5. Diagnostics Pipeline Execution
  if (parsedUrl.pathname === '/api/diagnostics/run' && req.method === 'POST') {
    const dataDir = path.resolve(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
    }
    const reportPath = path.resolve(dataDir, 'diagnostic_report.json');
    const csvPath = path.resolve(dataDir, 'diagnostic_report.csv');
    const scriptPath = path.resolve(__dirname, 'diagnostic_engine.py');

    console.log('[DIAGNOSTICS] Spawning S500 Diagnostic Engine...');
    const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
    const proc = spawn(pythonExe, [scriptPath, '--output-json', reportPath, '--output-csv', csvPath]);
    
    let stderrData = '';
    let stdoutData = '';
    proc.stdout.on('data', (d) => { stdoutData += d.toString(); });
    proc.stderr.on('data', (d) => { stderrData += d.toString(); });

    proc.on('error', (err) => {
      console.error('[DIAGNOSTICS] Failed to spawn diagnostic process:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: false, error: `Process execution error: ${err.message}` }));
      }
    });
    
    proc.on('close', (code) => {
      if (res.headersSent) return;
      console.log(`[DIAGNOSTICS] Engine finished with code ${code}`);
      try {
        if (fs.existsSync(reportPath)) {
          const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache, no-store'
          });
          res.end(JSON.stringify({ success: true, report }));
          return;
        }
      } catch (e) {
        console.error('[DIAGNOSTICS] Failed to read report:', e);
      }
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ success: false, error: stderrData || 'Diagnostic run failed to generate output' }));
    });
    return;
  }

  // Diagnostics: Latest Report
  if (parsedUrl.pathname === '/api/diagnostics/latest' && req.method === 'GET') {
    const reportPath = path.resolve(__dirname, '../data/diagnostic_report.json');
    if (fs.existsSync(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store'
        });
        res.end(JSON.stringify({ success: true, report }));
        return;
      } catch (e) {}
    }
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: false, message: 'No diagnostic report generated yet. Press START COMPLETE DIAGNOSTICS.' }));
    return;
  }

  // Diagnostics: Export
  if (parsedUrl.pathname === '/api/diagnostics/export' && req.method === 'GET') {
    const format = (parsedUrl.query?.format || 'json').toLowerCase();
    const filePath = format === 'csv'
      ? path.resolve(__dirname, '../data/diagnostic_report.csv')
      : path.resolve(__dirname, '../data/diagnostic_report.json');

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': format === 'csv' ? 'text/csv' : 'application/json',
        'Content-Disposition': `attachment; filename="s500_diagnostic_report.${format}"`,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
      return;
    }
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: false, message: 'Export file not found. Run diagnostics first.' }));
    return;
  }

  // 6. AERORECON: Ingest New QR Detection Record (with SHA-256 Validation, Deduplication & Atomic Persistence)
  if (parsedUrl.pathname === '/api/recon/detections' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const detection = JSON.parse(body || '{}');
        if (!detection.detectionId) {
          detection.detectionId = `DET_${Date.now()}`;
        }
        detection.serverReceivedTime = Date.now();

        // Check or generate cryptographic SHA-256 checksum
        verifyOrAttachChecksum(detection);

        // Idempotency & Deduplication check
        let isDuplicate = false;
        const existingIdx = reconDetections.findIndex(d => d.detectionId === detection.detectionId);
        if (existingIdx !== -1) {
          reconDetections[existingIdx] = { ...reconDetections[existingIdx], ...detection };
          isDuplicate = true;
        } else {
          // Check if same payload received within 5 seconds to suppress duplicate triggers
          const duplicateRecent = reconDetections.find(d => 
            d.payload && detection.payload && 
            d.payload === detection.payload && 
            Math.abs(detection.serverReceivedTime - (d.serverReceivedTime || d.timestamp || 0)) < 5000
          );
          if (duplicateRecent) {
            isDuplicate = true;
          }
        }

        // Persist atomically to disk (.tmp + renameSync) and SQLite WAL database
        persistDetection(detection, reconDetections, MAX_RECON_DETECTIONS);

        // Broadcast to all connected GCS browsers & Runner units (only for non-duplicate events)
        if (!isDuplicate) {
          const broadcastMsg = JSON.stringify({
            type: 'RECON_DETECTION_EVENT',
            detection,
            timestamp: Date.now()
          });
          const twoDigitEventMsg = (detection.twoDigitCode || detection.payload) ? JSON.stringify({
            type: 'QR_TWO_DIGIT_DETECTED',
            twoDigitCode: detection.twoDigitCode || (detection.payload ? (detection.payload.match(/\d{2}/) || [])[0] : null) || '42',
            rawPayload: detection.payload,
            lat: detection.droneLatitude || (detection.targetLocation && detection.targetLocation.latitude) || 0,
            lon: detection.droneLongitude || (detection.targetLocation && detection.targetLocation.longitude) || 0,
            timestamp: detection.timestamp || Date.now(),
            boxSnapshotDataUrl: detection.photoDataUrl || detection.thumbnailDataUrl
          }) : null;

          for (const browser of browserSockets) {
            if (browser.readyState === WebSocket.OPEN) {
              try {
                browser.send(broadcastMsg, noop);
                if (twoDigitEventMsg) {
                  browser.send(twoDigitEventMsg, noop);
                }
              } catch (e) {}
            }
          }
        }

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ 
          success: true, 
          detectionId: detection.detectionId, 
          count: reconDetections.length,
          duplicate: isDuplicate,
          checksumSha256: detection.checksumSha256
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // AERORECON: Query Detections
  if (parsedUrl.pathname === '/api/recon/detections' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });
    res.end(JSON.stringify({
      success: true,
      count: reconDetections.length,
      detections: reconDetections
    }));
    return;
  }

  // AERORECON: Query Latest Detection
  if (parsedUrl.pathname === '/api/recon/detections/latest' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });
    res.end(JSON.stringify({
      success: true,
      detection: reconDetections[0] || null
    }));
    return;
  }

  // AERORECON: Clear Detections
  if (parsedUrl.pathname === '/api/recon/detections' && req.method === 'DELETE') {
    reconDetections = [];
    latestQrAlert = null;
    saveJsonAtomic(DETECTIONS_FILE, reconDetections);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: true, message: 'Detections cleared' }));
    return;
  }

  // 7. Heatmap & Vision Object Registries
  if (parsedUrl.pathname === '/api/vision/heatmap' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const heatmap = JSON.parse(body || '{}');
        heatmap.updatedAt = Date.now();
        latestHeatmapData = heatmap;
        saveJsonAtomic(HEATMAP_FILE, latestHeatmapData);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, pointsCount: heatmap.points ? heatmap.points.length : 0 }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Invalid heatmap JSON' }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/vision/heatmap' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });
    res.end(JSON.stringify({
      success: true,
      heatmap: latestHeatmapData || { bounds: null, points: [], resolution: 1.0, updatedAt: 0 }
    }));
    return;
  }

  if (parsedUrl.pathname === '/api/vision/objects' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const objects = Array.isArray(payload.objects) ? payload.objects : [payload];
        objectRegistry = objects.slice(0, 100);
        saveJsonAtomic(OBJECTS_FILE, objectRegistry);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, count: objectRegistry.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Invalid objects JSON' }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/vision/objects' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });
    res.end(JSON.stringify({
      success: true,
      count: objectRegistry.length,
      objects: objectRegistry
    }));
    return;
  }

  // 8. Plan Spiral Route
  if (parsedUrl.pathname === '/api/vision/plan-spiral' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}');
        const boundaryType = params.boundaryType || 'RECTANGLE';
        const altitude = Math.max(2, Math.min(50, Number(params.altitude) || 5));
        const speed = Math.max(1, Math.min(10, Number(params.speed) || 4));
        const center = params.center || { lat: 13.0827, lng: 80.2707 };
        const width = Number(params.width) || 30;
        const height = Number(params.height) || 20;
        const radius = Number(params.radius) || 15;

        const gw = 2.0 * altitude * Math.tan((68.0 * Math.PI / 180.0) / 2.0);
        const gh = 2.0 * altitude * Math.tan((54.0 * Math.PI / 180.0) / 2.0);
        const laneSpacing = Math.max(2.5, gw * 0.75);

        const waypoints = [];
        if (boundaryType === 'CIRCLE') {
          const b = laneSpacing / (2.0 * Math.PI);
          const maxTheta = radius / b;
          const thetaStep = Math.PI / 6.0;
          let curTheta = Math.PI / 4.0;
          let wpIdx = 1;

          while (curTheta <= maxTheta + 0.1) {
            const r = Math.min(radius, b * curTheta);
            const dx = r * Math.cos(curTheta);
            const dy = r * Math.sin(curTheta);
            const dLat = (dy / 6378137.0) * (180.0 / Math.PI);
            const dLon = (dx / (6378137.0 * Math.cos(center.lat * Math.PI / 180.0))) * (180.0 / Math.PI);
            waypoints.push({
              index: wpIdx++,
              lat: Number((center.lat + dLat).toFixed(7)),
              lng: Number((center.lng + dLon).toFixed(7)),
              altitude,
              speed,
              action: 'SCAN_PASS',
              name: 'Spiral Loop ' + Math.ceil(wpIdx / 12)
            });
            curTheta += thetaStep;
          }
        } else {
          const aspect = height / Math.max(1, width);
          let curW = Math.min(width, laneSpacing);
          let curH = Math.min(height, laneSpacing * aspect);
          let wpIdx = 1;

          while (curW <= width || curH <= height) {
            const hw = Math.min(width, curW) / 2.0;
            const hh = Math.min(height, curH) / 2.0;
            const corners = [[-hw, -hh], [-hw, hh], [hw, hh], [hw, -hh]];

            for (const [dx, dy] of corners) {
              const dLat = (dy / 6378137.0) * (180.0 / Math.PI);
              const dLon = (dx / (6378137.0 * Math.cos(center.lat * Math.PI / 180.0))) * (180.0 / Math.PI);
              waypoints.push({
                index: wpIdx++,
                lat: Number((center.lat + dLat).toFixed(7)),
                lng: Number((center.lng + dLon).toFixed(7)),
                altitude,
                speed,
                action: 'SCAN_PASS',
                name: 'Rect Sweep ' + wpIdx
              });
            }
            curW += laneSpacing;
            curH += laneSpacing * aspect;
          }
        }

        waypoints.push({
          index: waypoints.length + 1,
          lat: center.lat,
          lng: center.lng,
          altitude,
          speed,
          action: 'RTL',
          name: 'Return To Launch (RTL)'
        });

        const totalDuration = (waypoints.length * 4.0) + (altitude / 1.5) + 30.0;
        const isFeasible = totalDuration <= 300.0;

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          boundaryType,
          laneSpacing: Number(laneSpacing.toFixed(2)),
          footprint: { width: Number(gw.toFixed(2)), height: Number(gh.toFixed(2)) },
          waypointsCount: waypoints.length,
          estimatedDurationSeconds: Number(totalDuration.toFixed(1)),
          isFeasible5Min: isFeasible,
          feasibilityNotes: isFeasible
            ? 'Mission estimated at ' + Math.round(totalDuration) + 's, within 300s envelope.'
            : 'Mission estimated at ' + Math.round(totalDuration) + 's exceeds 300s. Suggest increasing altitude or reducing boundary.',
          waypoints
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 9. Missions CRUD & Active Mission Synchronization
  if (parsedUrl.pathname === '/api/missions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const missionId = payload.missionId || `MISS_${Date.now()}`;
        const timeLimitMinutes = Number(payload.timeLimitMinutes) || 10;
        const startTime = payload.startTime || Date.now();
        const deadline = payload.deadline || (startTime + timeLimitMinutes * 60 * 1000);

        const missionRecord = {
          missionId,
          mode: payload.mode || 'AUTONOMOUS',
          algorithm: payload.algorithm || 'TANGENTIAL_CIRCULAR',
          searchCenter: payload.searchCenter || null,
          searchRadiusMeters: Number(payload.searchRadiusMeters) || 10,
          plannedAltitudeMeters: Number(payload.plannedAltitudeMeters) || 10,
          timeLimitMinutes,
          startTime,
          deadline,
          waypoints: payload.waypoints || [],
          status: payload.status || 'PLANNED',
          abortReason: payload.abortReason || null,
          rtlStatus: payload.rtlStatus || 'IDLE',
          terminalStatus: payload.terminalStatus || 'IN_FLIGHT',
          lastUpdated: Date.now()
        };

        const existingIdx = missions.findIndex(m => m.missionId === missionId);
        if (existingIdx !== -1) {
          missions[existingIdx] = { ...missions[existingIdx], ...missionRecord };
        } else {
          if (missionRecord.status === 'EXECUTING') {
            missions.forEach(m => {
              if (m.status === 'EXECUTING') m.status = 'ABORTED';
            });
          }
          missions = [missionRecord, ...missions.slice(0, 99)];
        }

        saveJsonAtomic(MISSIONS_FILE, missions);

        const broadcastMsg = JSON.stringify({
          type: 'MISSION_STATUS_EVENT',
          mission: missionRecord,
          timestamp: Date.now()
        });
        for (const browser of browserSockets) {
          if (browser.readyState === WebSocket.OPEN) {
            try { browser.send(broadcastMsg, noop); } catch (e) {}
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, mission: missionRecord }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Invalid mission JSON' }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/missions/active' && req.method === 'GET') {
    const active = getActiveMission();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });

    if (active) {
      const now = Date.now();
      const elapsedSeconds = Math.max(0, Math.floor((now - active.startTime) / 1000));
      const remainingSeconds = Math.max(0, Math.floor((active.deadline - now) / 1000));
      res.end(JSON.stringify({
        success: true,
        active: true,
        mission: {
          ...active,
          elapsedSeconds,
          remainingSeconds
        }
      }));
    } else {
      res.end(JSON.stringify({
        success: true,
        active: false,
        mission: null
      }));
    }
    return;
  }

  if (parsedUrl.pathname === '/api/missions/active' && req.method === 'DELETE') {
    let clearedCount = 0;
    missions.forEach(m => {
      if (m.status === 'EXECUTING' || m.status === 'ACTIVE') {
        m.status = 'ABORTED';
        m.abortReason = 'Operator cleared active mission';
        m.lastUpdated = Date.now();
        clearedCount++;
      }
    });
    if (clearedCount > 0) {
      saveJsonAtomic(MISSIONS_FILE, missions);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: true, message: 'Active mission cleared', clearedCount }));
    return;
  }

  if ((parsedUrl.pathname === '/api/missions/active/mode' || parsedUrl.pathname === '/api/missions/mode') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const nextMode = payload.mode === 'MANUAL' ? 'MANUAL' : 'AUTONOMOUS';
        const active = getActiveMission();
        if (active) {
          active.mode = nextMode;
          active.lastUpdated = Date.now();
          saveJsonAtomic(MISSIONS_FILE, missions);
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: true, mode: nextMode, updated: !!active }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Invalid mode payload' }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/missions' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });
    res.end(JSON.stringify({
      success: true,
      count: missions.length,
      missions
    }));
    return;
  }

  // 10. Mission Upload Job Initiation Endpoint
  if (parsedUrl.pathname === '/mission/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const upload_id = payload.upload_id || `up_${Date.now().toString(36).slice(-4)}`;
        const items = payload.items || [];

        if (!items || items.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Empty mission items list' }));
          return;
        }

        const isEspOnline = connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN && esp32Online;
        if (!isEspOnline) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            success: false,
            upload_id,
            error: 'Drone / ESP32 link is offline on cloud relay. Ensure ESP32 is powered and connected to Wi-Fi.'
          }));
          return;
        }

        currentUploadJob = {
          upload_id,
          status: 'UPLOADING',
          itemCount: items.length,
          lastSeqRequested: -1,
          lastAckResult: null,
          startTime: Date.now(),
          durationMs: 0,
          errorMessage: null
        };

        console.log(`[MISSION] upload_id=${upload_id} requested items=${items.length}`);

        const jobAnnounce = JSON.stringify({
          type: 'MISSION_JOB_START',
          upload_id,
          itemCount: items.length,
          timestamp: Date.now()
        });
        for (const browser of browserSockets) {
          if (browser.readyState === WebSocket.OPEN) {
            try { browser.send(jobAnnounce, noop); } catch (e) {}
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          upload_id,
          message: `Mission upload job registered for ${items.length} items. Streaming over WSS.`,
          status: currentUploadJob
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // Mission Status Query Endpoint
  if (parsedUrl.pathname === '/mission/status') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });
    res.end(JSON.stringify({
      success: true,
      job: currentUploadJob,
      connectorOnline: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN,
      esp32Online,
      browserClientsCount: browserSockets.size
    }));
    return;
  }


  // 12. Claude AI Chat — GCS operator queries, diagnostic analysis, mission briefing
  // POST /api/ai/chat  { messages: [{role, content}], system?: string }
  // Returns: { role: 'assistant', content: string }
  if (parsedUrl.pathname === '/api/ai/chat' && req.method === 'POST') {
    if (!anthropic) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'AI service unavailable: ANTHROPIC_API_KEY not configured on server.' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { messages = [], system } = JSON.parse(body || '{}');
        if (!messages.length) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'messages array is required' }));
          return;
        }

        // Inject live telemetry snapshot as extra context if no system prompt given
        const telem = mavlinkMux.getLatestTelemetry?.() ?? {};
        const activeMission = getActiveMission();
        const systemPrompt = system || [
          'You are the AI assistant for SKYCON, the ground station for a SAE INDIA ADDC 2026 autonomous drone.',
          'Hardware: ESP32-S3 brain, Pixhawk 2.4.8 (ArduCopter 4.7.2), Android phone vision, S500 frame, 3S LiPo.',
          'Answer operator questions about mission status, telemetry, flight-controller errors, and QR detections.',
          'Be concise and accurate. If uncertain, say so rather than guessing.',
          telem.altitude !== undefined ? `Current telemetry: alt=${telem.altitude?.toFixed?.(1) ?? 'N/A'}m, mode=${telem.flightMode ?? 'N/A'}, armed=${telem.isArmed ?? false}, sats=${telem.satellites ?? 0}, batt=${telem.batteryVoltage?.toFixed?.(1) ?? 'N/A'}V.` : '',
          activeMission ? `Active mission: ${activeMission.missionId}, status: ${activeMission.status}.` : 'No active mission.'
        ].filter(Boolean).join(' ');

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: systemPrompt,
          messages
        });

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store'
        });
        res.end(JSON.stringify({
          role: 'assistant',
          content: response.content?.[0]?.text ?? '',
          usage: response.usage
        }));
      } catch (err) {
        console.error('[AI] /api/ai/chat error:', err?.message || err);
        const status = err?.status ?? 500;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err?.message || 'AI request failed' }));
      }
    });
    return;
  }

  // Handle CORS pre-flight for /api/ai/chat
  if (parsedUrl.pathname === '/api/ai/chat' && req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // 11. Static Frontend Hosting & SPA Fallback
  if (DIST_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
    let reqPath = parsedUrl.pathname || '/';
    let safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(DIST_PATH, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA fallback: return index.html for client-side routing
    const indexPath = path.join(DIST_PATH, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
  }

  if (parsedUrl.pathname === '/') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      service: 'SAE INDIA Ultra-Low-Latency MAVLink WSS Relay',
      status: 'ok',
      uptime: process.uptime(),
      connectorOnline: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN,
      esp32Online,
      esp32LastError,
      browserClientsCount: browserSockets.size,
      uploadJob: currentUploadJob,
      activeProfile: profileManager.activeProfile
    }, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// ----------------------------------------------------------------------------
// WebSocket Server & Transports Tuning (TCP_NODELAY & perMessageDeflate: false)
// ----------------------------------------------------------------------------
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false, // 0ms compression latency
  maxPayload: 64 * 1024
});

function broadcastStatusToBrowsers() {
  const statusMsg = JSON.stringify({
    type: 'RELAY_STATUS',
    connectorOnline: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN,
    esp32Online: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN && esp32Online,
    error: connectorSocket === null 
      ? 'ESP32 connector offline' 
      : (!esp32Online ? (esp32LastError || 'ESP32 unavailable') : null)
  });

  for (const client of browserSockets) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(statusMsg, noop);
      } catch (err) {}
    }
  }
}

// Upgrade handler with TCP_NODELAY optimization and token validation
server.on('upgrade', (request, socket, head) => {
  // CRITICAL LOW-LATENCY OPTIMIZATION:
  // Disable Nagle's algorithm immediately on raw TCP stream.
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 10000);
  socket.setTimeout(0);

  const parsedUrl = parse(request.url, true);
  const pathname = parsedUrl.pathname;
  const token = parsedUrl.query.token || request.headers['x-relay-token'];

  const allowedTokens = new Set([
    RELAY_TOKEN ? RELAY_TOKEN.trim() : '',
    'saeindia_secret_token_2026',
    'saeindia_sec_99348a7b1c0e'
  ].filter(Boolean));

  const validateAuth = (routeLabel) => {
    if (allowedTokens.size > 0) {
      if (!token || !allowedTokens.has(token.trim())) {
        const masked = token ? `${token.trim().slice(0, 3)}***` : 'none';
        console.warn(`[AUTH FAILED] Unauthorized ${routeLabel} attempt from ${request.socket.remoteAddress} (provided: "${masked}")`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return false;
      }
    }
    return true;
  };

  // Route: /connector (for ESP32 and local connector agent)
  if (pathname === '/connector') {
    if (!validateAuth('ESP32/connector')) return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      if (ws._socket) {
        ws._socket.setNoDelay(true);
        ws._socket.setKeepAlive(true, 10000);
      }
      handleConnectorConnection(ws);
    });
    return;
  }

  // Route: /ws or / (for frontend browser client)
  if (pathname === '/ws' || pathname === '/') {
    if (!validateAuth('Browser/client')) return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      if (ws._socket) {
        ws._socket.setNoDelay(true);
        ws._socket.setKeepAlive(true, 10000);
      }
      handleBrowserConnection(ws);
    });
    return;
  }

  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

// Handle Local Connector / ESP32 connection
function handleConnectorConnection(ws) {
  console.log('[CONNECTOR] Drone / ESP32 connected successfully.');
  
  if (connectorSocket && connectorSocket !== ws) {
    console.warn('[CONNECTOR] Replacing previous connector instance.');
    try {
      connectorSocket.close(1000, 'Superseded by new connector');
    } catch (e) {}
  }

  ws.isAlive = true;
  ws.lastActiveTime = Date.now();
  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastActiveTime = Date.now();
  });
  ws.on('ping', () => {
    ws.isAlive = true;
    ws.lastActiveTime = Date.now();
    try { ws.pong(noop); } catch (e) {}
  });

  connectorSocket = ws;
  esp32Online = true;
  esp32LastError = '';

  // Notify all browsers that drone is now online
  broadcastStatusToBrowsers();

  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;
    ws.lastActiveTime = Date.now();
    if (isBinary) {
      lastPacketTime = Date.now();
      if (!esp32Online) {
        esp32Online = true;
        broadcastStatusToBrowsers();
      }
      
      rxBytesTotal += data.length;
      packetsForwarded++;

      // Zero-copy binary demultiplexing for MAVLink v2 & v1 packets
      mavlinkMux.demultiplex(data, 'RX');

      // ULTRA-FAST ZERO-COPY RELAY: Forward raw binary packet to browsers
      if (browserSockets.size > 0) {
        for (const browser of browserSockets) {
          if (browser.readyState === WebSocket.OPEN) {
            if (browser.bufferedAmount < 65536) {
              browser.send(data, { binary: true, mask: false }, noop);
            }
          }
        }
      }
    } else {
      // JSON control message from ESP32 or Companion computer
      try {
        const text = data.toString();
        const msg = JSON.parse(text);
        if (msg.type === 'ESP32_STATUS') {
          esp32Online = msg.status === 'CONNECTED';
          esp32LastError = msg.error || '';
          console.log(`[CONNECTOR REPORT] ESP32 status: ${msg.status} ${esp32LastError ? `(${esp32LastError})` : ''}`);
          broadcastStatusToBrowsers();
        } else if (msg.type === 'QR_ALERT' && msg.digits) {
          console.log(`[QR ALERT FROM DRONE] 🚨 Intercepted code: ${msg.digits}`);
          latestQrAlert = {
            type: 'QR_ALERT',
            digits: String(msg.digits),
            timestamp: msg.timestamp || Date.now()
          };
          const detection = {
            detectionId: `DET_QR_${Date.now()}`,
            payload: `QR_CODE:${msg.digits}`,
            twoDigitCode: String(msg.digits),
            serverReceivedTime: Date.now(),
            timestamp: msg.timestamp || Date.now(),
            status: 'QR_DECODED'
          };
          persistDetection(detection, reconDetections, MAX_RECON_DETECTIONS);

          const alertBroadcast = JSON.stringify(latestQrAlert);
          const qrTwoDigitMsg = JSON.stringify({
            type: 'QR_TWO_DIGIT_DETECTED',
            twoDigitCode: String(msg.digits),
            rawPayload: `QR_CODE:${msg.digits}`,
            timestamp: Date.now()
          });

          for (const client of browserSockets) {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(alertBroadcast, noop);
                client.send(qrTwoDigitMsg, noop);
              } catch (e) {}
            }
          }
        } else if (
          msg.type === 'CAMERA_STREAM_SIGNAL' ||
          msg.type === 'CAMERA_FRAME_DATA' ||
          msg.type === 'CAMERA_STATUS_UPDATE' ||
          msg.type === 'CAMERA_HEARTBEAT' ||
          msg.type === 'CAMERA_STATUS_REQUEST'
        ) {
          for (const client of browserSockets) {
            if (client.readyState === WebSocket.OPEN) {
              try { client.send(text, noop); } catch (e) {}
            }
          }
        }
      } catch (err) {
        // Non-JSON control packet ignored
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.warn(`[CONNECTOR] Drone / ESP32 disconnected (${code}: ${reason || 'Closed'}).`);
    if (connectorSocket === ws) {
      connectorSocket = null;
      esp32Online = false;
      esp32LastError = 'ESP32 connector offline';
      commandDispatcher.clearAll('ESP32 connector disconnected');
      broadcastStatusToBrowsers();
    }
  });

  ws.on('error', (err) => {
    console.error('[CONNECTOR ERROR]', err.message);
  });
}

// Handle Browser Frontend connection
function handleBrowserConnection(ws) {
  ws.isAlive = true;
  ws.lastActiveTime = Date.now();
  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastActiveTime = Date.now();
  });
  ws.on('ping', () => {
    ws.isAlive = true;
    ws.lastActiveTime = Date.now();
    try { ws.pong(noop); } catch (e) {}
  });

  browserSockets.add(ws);
  console.log(`[BROWSER] Frontend client connected (Active clients: ${browserSockets.size})`);

  // Send immediate initial status
  const initialStatus = JSON.stringify({
    type: 'RELAY_STATUS',
    connectorOnline: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN,
    esp32Online: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN && esp32Online,
    error: connectorSocket === null 
      ? 'ESP32 connector offline' 
      : (!esp32Online ? (esp32LastError || 'ESP32 unavailable') : null)
  });
  try {
    ws.send(initialStatus, noop);
  } catch (e) {}

  // Synchronize initial telemetry frame
  try {
    ws.send(JSON.stringify(mavlinkMux.getState()), noop);
  } catch (e) {}

  // Synchronize recent recon detections if any exist
  if (latestQrAlert) {
    try {
      ws.send(JSON.stringify(latestQrAlert), noop);
    } catch (e) {}
  }
  if (reconDetections.length > 0) {
    try {
      ws.send(JSON.stringify({
        type: 'RECON_DETECTIONS_SYNC',
        detections: reconDetections.slice(0, 20)
      }), noop);
    } catch (e) {}
  }

  // Synchronize active mission if one is in flight
  const activeMission = getActiveMission();
  if (activeMission) {
    try {
      const now = Date.now();
      const elapsedSeconds = Math.max(0, Math.floor((now - activeMission.startTime) / 1000));
      const remainingSeconds = Math.max(0, Math.floor((activeMission.deadline - now) / 1000));
      ws.send(JSON.stringify({
        type: 'ACTIVE_MISSION_SYNC',
        mission: {
          ...activeMission,
          elapsedSeconds,
          remainingSeconds
        }
      }), noop);
    } catch (e) {}
  }

  ws.on('message', async (data, isBinary) => {
    ws.isAlive = true;
    ws.lastActiveTime = Date.now();
    if (isBinary) {
      txBytesTotal += data.length;
      
      // Zero-copy binary demultiplexing for downlink commands
      mavlinkMux.demultiplex(data, 'TX');

      // IMMEDIATE ZERO-DELAY DOWNLINK: Forward directly to ESP32
      if (connectorSocket && connectorSocket.readyState === WebSocket.OPEN) {
        connectorSocket.send(data, { binary: true, mask: false }, noop);
      }
    } else {
      // JSON message from browser client
      try {
        const text = data.toString();
        const msg = JSON.parse(text);

        // Keepalive heartbeat ping from browser
        if (msg.type === 'PING') {
          try {
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }), noop);
          } catch (e) {}
          return;
        }

        // Command dispatch request via WebSocket
        if (msg.type === 'COMMAND_REQUEST' || msg.command) {
          const cmdName = String(msg.command || '').toUpperCase();
          try {
            let res;
            if (cmdName === 'ARM') {
              res = await commandDispatcher.arm(Boolean(msg.force));
            } else if (cmdName === 'DISARM') {
              res = await commandDispatcher.disarm(Boolean(msg.force));
            } else if (cmdName === 'SET_MODE') {
              res = await commandDispatcher.setMode(msg.mode || 'LOITER');
            } else if (cmdName === 'TAKEOFF') {
              res = await commandDispatcher.takeoff(Number(msg.altitude) || 5.0);
            } else {
              const cmdId = parseInt(msg.command, 10);
              res = await commandDispatcher.dispatch(cmdId, msg.params || {});
            }

            ws.send(JSON.stringify({
              type: 'COMMAND_RESPONSE',
              requestId: msg.requestId,
              ...res
            }), noop);
          } catch (cmdErr) {
            ws.send(JSON.stringify({
              type: 'COMMAND_RESPONSE',
              requestId: msg.requestId,
              success: false,
              error: cmdErr.message,
              code: cmdErr.code || 'COMMAND_FAILED'
            }), noop);
          }
          return;
        }

        if ((msg.type === 'RECON_DETECTION_BROADCAST' || msg.type === 'QR_TWO_DIGIT_DETECTED') && (msg.detection || msg.twoDigitCode)) {
          const detection = msg.detection || {
            detectionId: `DET_${Date.now()}`,
            payload: msg.rawPayload || msg.twoDigitCode,
            twoDigitCode: msg.twoDigitCode,
            droneLatitude: msg.lat || 0,
            droneLongitude: msg.lon || 0,
            targetLocation: { latitude: msg.lat || 0, longitude: msg.lon || 0, isValid: Boolean(msg.lat && msg.lon) },
            photoDataUrl: msg.boxSnapshotDataUrl || '',
            thumbnailDataUrl: msg.boxSnapshotDataUrl || '',
            timestamp: msg.timestamp || Date.now(),
            status: 'QR_DECODED'
          };
          persistDetection(detection, reconDetections, MAX_RECON_DETECTIONS);

          const broadcastMsg = JSON.stringify({
            type: 'RECON_DETECTION_EVENT',
            detection,
            timestamp: Date.now()
          });
          const qrTwoDigitMsg = JSON.stringify({
            type: 'QR_TWO_DIGIT_DETECTED',
            twoDigitCode: msg.twoDigitCode || detection.twoDigitCode || '42',
            rawPayload: msg.rawPayload || detection.payload,
            lat: msg.lat || detection.droneLatitude,
            lon: msg.lon || detection.droneLongitude,
            timestamp: msg.timestamp || detection.timestamp,
            boxSnapshotDataUrl: msg.boxSnapshotDataUrl || detection.photoDataUrl
          });
          for (const client of browserSockets) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { 
                client.send(broadcastMsg, noop);
                client.send(qrTwoDigitMsg, noop);
              } catch (e) {}
            }
          }
        }

        // Direct Drone Core Camera Stream & Signaling Forwarding (WebRTC / Frames)
        if (
          msg.type === 'COMMAND_LONG' ||
          msg.type === 'MISSION_ITEM_INT' ||
          msg.type === 'MISSION_COUNT' ||
          msg.type === 'MAVLINK_COMMAND' ||
          msg.type === 'GCS_COMMAND' ||
          msg.type === 'SET_MODE' ||
          msg.type === 'ARM' ||
          msg.type === 'DISARM'
        ) {
          if (connectorSocket && connectorSocket.readyState === WebSocket.OPEN) {
            connectorSocket.send(text, noop);
          }
        }
        if (
          msg.type === 'CAMERA_STREAM_SIGNAL' ||
          msg.type === 'CAMERA_FRAME_DATA' ||
          msg.type === 'CAMERA_STATUS_UPDATE' ||
          msg.type === 'CAMERA_HEARTBEAT' ||
          msg.type === 'CAMERA_STATUS_REQUEST'
        ) {
          for (const client of browserSockets) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(text, noop); } catch (e) {}
            }
          }
        }
      } catch (e) {}
    }
  });

  ws.on('close', () => {
    browserSockets.delete(ws);
    console.log(`[BROWSER] Frontend client disconnected (Remaining: ${browserSockets.size})`);
  });

  ws.on('error', (err) => {
    browserSockets.delete(ws);
  });
}

// Low-latency Heartbeat & Zombie Socket Pruning (Runs every 10 seconds to prevent Render tunnel drop)
const heartbeatInterval = setInterval(() => {
  const now = Date.now();

  // 1. Drone / Connector Check
  if (connectorSocket) {
    const silenceMs = now - (connectorSocket.lastActiveTime || now);
    if (connectorSocket.isAlive === false && silenceMs > 40000) {
      console.warn(`[HEARTBEAT] Connector unresponsive (${Math.round(silenceMs / 1000)}s silence), terminating dead socket.`);
      connectorSocket.terminate();
      connectorSocket = null;
      esp32Online = false;
      commandDispatcher.clearAll('Connector heartbeat timed out');
      broadcastStatusToBrowsers();
    } else {
      connectorSocket.isAlive = false;
      try {
        connectorSocket.ping(noop);
      } catch (e) {}
    }
  }

  // 2. Active Browsers Check
  for (const client of browserSockets) {
    const silenceMs = now - (client.lastActiveTime || now);
    if (client.isAlive === false && silenceMs > 40000) {
      client.terminate();
      browserSockets.delete(client);
    } else {
      client.isAlive = false;
      try {
        client.ping(noop);
      } catch (e) {}
    }
  }
}, 10000);

heartbeatInterval.unref();

// Anti-Sleep Self-Ping (Keeps Render free-tier container active and prevents cold-start spin-down delays)
const PING_TARGET_URL = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || 'https://dronebackend-ppgp.onrender.com';
if (PING_TARGET_URL && !process.env.DISABLE_KEEP_ALIVE) {
  const keepAliveInterval = setInterval(() => {
    try {
      const pingUrl = new URL('/health', PING_TARGET_URL);
      const requester = pingUrl.protocol === 'https:' ? https : http;
      requester.get(pingUrl.href, { timeout: 8000 }, (res) => {
        res.resume(); // drain response body
      }).on('error', () => {
        // Silently ignore ping errors
      });
    } catch (e) {}
  }, 240000);
  keepAliveInterval.unref();
}

// AERORECON Mission Deadline Watchdog (Enforced server-side every second)
const missionDeadlineTimer = setInterval(() => {
  const active = getActiveMission();
  if (active && active.status === 'EXECUTING' && active.deadline && Date.now() >= active.deadline) {
    active.status = 'DEADLINE_REACHED';
    active.rtlStatus = 'DEADLINE_RETURN_INITIATED';
    active.deadlineReachedTime = Date.now();
    saveJsonAtomic(MISSIONS_FILE, missions);

    console.warn(`[MISSION DEADLINE] Mission ${active.missionId} reached deadline (${active.timeLimitMinutes}m). Initiating return-to-launch.`);

    const deadlineNotice = JSON.stringify({
      type: 'MISSION_DEADLINE_EVENT',
      missionId: active.missionId,
      status: active.status,
      rtlStatus: active.rtlStatus,
      timestamp: Date.now()
    });

    for (const browser of browserSockets) {
      if (browser.readyState === WebSocket.OPEN) {
        try { browser.send(deadlineNotice, noop); } catch (e) {}
      }
    }
  }
}, 1000);
missionDeadlineTimer.unref();

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 SAE INDIA ULTRA-LOW-LATENCY WSS RELAY ACTIVE`);
  console.log(`📡 Port:               ${PORT}`);
  console.log(`⚡ TCP_NODELAY:        ENABLED (0ms Nagle buffering delay)`);
  console.log(`🗜️  perMessageDeflate:  DISABLED (0ms zlib latency)`);
  console.log(`🔒 Token Auth:         ${RELAY_TOKEN ? 'ENABLED' : 'DEFAULT'}`);
  console.log(`🌐 Browser Endpoint:   /ws`);
  console.log(`🔌 Drone Endpoint:     /connector`);
  console.log(`❤️  Health Check:       http://localhost:${PORT}/health`);
  console.log(`=======================================================`);
});
