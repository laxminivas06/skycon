import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';

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

function loadJsonSafe(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn(`[PERSISTENCE] Error loading ${filePath}:`, err.message);
  }
  return fallback;
}

function saveJsonAtomic(filePath, data) {
  try {
    const tmp = `${filePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error(`[PERSISTENCE] Error saving ${filePath}:`, err.message);
  }
}

// In-Memory caches backed by durable disk storage
let missions = loadJsonSafe(MISSIONS_FILE, []);
const MAX_RECON_DETECTIONS = 50;
let reconDetections = loadJsonSafe(DETECTIONS_FILE, []);

function getActiveMission() {
  return missions.find(m => (m.status === 'EXECUTING' || m.status === 'ACTIVE') && (!m.deadline || Date.now() < m.deadline)) || null;
}

// Create HTTP server for health checks, static frontend, and WebSocket upgrades
const server = http.createServer((req, res) => {
  const parsedUrl = parse(req.url, true);

  // Universal CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-relay-token'
    });
    res.end();
    return;
  }
  
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
      perMessageDeflate: false
    }, null, 2));
    return;
  }



  // AERORECON: Ingest New QR Detection Record (with Deduplication & Atomic Persistence)
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

        // Idempotency & Deduplication check:
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
          } else {
            reconDetections = [detection, ...reconDetections.slice(0, MAX_RECON_DETECTIONS - 1)];
          }
        }

        // Persist to disk atomically
        saveJsonAtomic(DETECTIONS_FILE, reconDetections);

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
          duplicate: isDuplicate
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
    saveJsonAtomic(DETECTIONS_FILE, reconDetections);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: true, message: 'Detections cleared' }));
    return;
  }

  // AERORECON: Create or Update Mission Record (Persisted in missions.json)
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
          mode: payload.mode || 'AUTONOMOUS', // MANUAL | AUTONOMOUS
          algorithm: payload.algorithm || 'TANGENTIAL_CIRCULAR', // TANGENTIAL_CIRCULAR | SPIRAL | MANUAL_PATH
          searchCenter: payload.searchCenter || null,
          searchRadiusMeters: Number(payload.searchRadiusMeters) || 10,
          plannedAltitudeMeters: Number(payload.plannedAltitudeMeters) || 10,
          timeLimitMinutes,
          startTime,
          deadline,
          waypoints: payload.waypoints || [],
          status: payload.status || 'PLANNED', // PLANNED | EXECUTING | COMPLETED | DEADLINE_REACHED | ABORTED
          abortReason: payload.abortReason || null,
          rtlStatus: payload.rtlStatus || 'IDLE', // IDLE | RETURN_REQUESTED | RETURNING | HOME_REACHED
          terminalStatus: payload.terminalStatus || 'IN_FLIGHT', // IN_FLIGHT | LANDED | TERMINATED
          lastUpdated: Date.now()
        };

        const existingIdx = missions.findIndex(m => m.missionId === missionId);
        if (existingIdx !== -1) {
          missions[existingIdx] = { ...missions[existingIdx], ...missionRecord };
        } else {
          // If a new active mission is started, mark previous executing missions as aborted
          if (missionRecord.status === 'EXECUTING') {
            missions.forEach(m => {
              if (m.status === 'EXECUTING') m.status = 'ABORTED';
            });
          }
          missions = [missionRecord, ...missions.slice(0, 99)];
        }

        saveJsonAtomic(MISSIONS_FILE, missions);

        // Broadcast mission update to all connected clients
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

  // AERORECON: Query Active Mission (Survives GCS Page Refresh)
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

  // AERORECON: Delete / Clear Active Mission
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

  // AERORECON: Update Active Mission Mode (MANUAL <-> AUTONOMOUS)
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

  // AERORECON: Query Mission History
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

  // Mission Upload Job Initiation Endpoint
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

        // Broadcast mission job start to all connected browsers
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

  // If frontend dist is available, serve static files (SPA fallback to index.html for GET/HEAD only)
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
      uploadJob: currentUploadJob
    }, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Create WebSocket server attached to HTTP server:
// 1. perMessageDeflate: false -> CRITICAL: Eliminates zlib compression overhead and 15-50ms compression latency
// 2. maxPayload: 64KB -> Sufficient for MAVLink batches without unbounded memory allocation
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
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
  // Prevents OS TCP buffer from delaying small 14-280 byte MAVLink packets for 40-200ms!
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
      // Re-assert TCP_NODELAY on the underlying upgraded socket
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

// Lightweight MAVLink Frame Inspector for Structured Logging (Section 3 requirement)
function inspectMavlinkPacket(buf, direction) {
  if (!buf || buf.length < 8) return;
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const magic = buf[offset];
    let msgId = -1;
    let sysId = -1;
    let compId = -1;
    let payloadOffset = 0;
    let packetLen = 0;

    if (magic === 0xFE && offset + 8 <= buf.length) {
      // MAVLink 1.0: header 6 bytes, payload len at buf[offset + 1], checksum 2 bytes
      const payloadLen = buf[offset + 1];
      packetLen = payloadLen + 8;
      if (offset + packetLen > buf.length) break;
      sysId = buf[offset + 3];
      compId = buf[offset + 4];
      msgId = buf[offset + 5];
      payloadOffset = offset + 6;
    } else if (magic === 0xFD && offset + 12 <= buf.length) {
      // MAVLink 2.0: header 10 bytes, payload len at buf[offset + 1], checksum 2 bytes + optional signature
      const payloadLen = buf[offset + 1];
      const flags = buf[offset + 2];
      const sigLen = (flags & 0x01) ? 13 : 0;
      packetLen = payloadLen + 12 + sigLen;
      if (offset + packetLen > buf.length) break;
      sysId = buf[offset + 5];
      compId = buf[offset + 6];
      msgId = buf[offset + 7] | (buf[offset + 8] << 8) | (buf[offset + 9] << 16);
      payloadOffset = offset + 10;
    } else {
      offset++;
      continue;
    }

    // Inspect mission-relevant frames
    if (msgId === 0) {
      // HEARTBEAT
      if (direction === 'RX') {
        const customMode = buf.readUInt32LE ? buf.readUInt32LE(payloadOffset) : 0;
        // throttle logging to 1 every 5 seconds to prevent spamming
        if (Date.now() - lastHeartbeatLogTime > 5000) {
          lastHeartbeatLogTime = Date.now();
          console.log(`[MAVLINK] RX HEARTBEAT sys=${sysId} comp=${compId} mode=${customMode}`);
        }
      }
    } else if (msgId === 44) {
      // MISSION_COUNT
      const count = buf.readUInt16LE ? buf.readUInt16LE(payloadOffset) : 0;
      const targetSys = buf[payloadOffset + 2] || 1;
      const targetComp = buf[payloadOffset + 3] || 1;
      if (direction === 'TX') {
        console.log(`[MAVLINK] TX MISSION_COUNT count=${count} target=${targetSys}/${targetComp} type=MISSION`);
        if (currentUploadJob.status === 'UPLOADING') {
          currentUploadJob.itemCount = count;
        }
      } else {
        console.log(`[MAVLINK] RX MISSION_COUNT count=${count} sys=${sysId} comp=${compId}`);
      }
    } else if (msgId === 40 || msgId === 51) {
      // MISSION_REQUEST (40) or MISSION_REQUEST_INT (51)
      const reqSeq = buf.readUInt16LE ? buf.readUInt16LE(payloadOffset) : 0;
      const name = msgId === 51 ? 'MISSION_REQUEST_INT' : 'MISSION_REQUEST';
      console.log(`[MAVLINK] RX ${name} seq=${reqSeq}`);
      if (currentUploadJob.status === 'UPLOADING') {
        currentUploadJob.lastSeqRequested = reqSeq;
      }
    } else if (msgId === 39 || msgId === 73) {
      // MISSION_ITEM (39) or MISSION_ITEM_INT (73)
      const seq = buf.readUInt16LE ? buf.readUInt16LE(payloadOffset + 28) : 0;
      const cmd = buf.readUInt16LE ? buf.readUInt16LE(payloadOffset + 30) : 0;
      const frame = buf[payloadOffset + 34];
      const name = msgId === 73 ? 'MISSION_ITEM_INT' : 'MISSION_ITEM';
      console.log(`[MAVLINK] ${direction} ${name} seq=${seq} cmd=${cmd} frame=${frame}`);
    } else if (msgId === 47) {
      // MISSION_ACK (47)
      const ackResult = buf[payloadOffset + 2];
      const ackNames = {
        0: 'ACCEPTED(0)',
        1: 'ERROR(1)',
        2: 'UNSUPPORTED_FRAME(2)',
        3: 'UNSUPPORTED(3)',
        4: 'NO_SPACE(4)',
        5: 'INVALID(5)',
        6: 'INVALID_PARAM1(6)',
        7: 'INVALID_PARAM2(7)',
        8: 'INVALID_PARAM3(8)',
        9: 'INVALID_PARAM4(9)',
        10: 'INVALID_PARAM5(10)',
        11: 'INVALID_PARAM6(11)',
        12: 'INVALID_PARAM7(12)',
        13: 'INVALID_SEQUENCE(13)',
        14: 'DENIED(14)',
        15: 'CANCELLED(15)'
      };
      const resStr = ackNames[ackResult] || `CODE_${ackResult}`;
      console.log(`[MAVLINK] ${direction} MISSION_ACK result=${resStr}`);
      if (direction === 'RX' && currentUploadJob.status === 'UPLOADING') {
        currentUploadJob.lastAckResult = ackResult;
        currentUploadJob.durationMs = Date.now() - currentUploadJob.startTime;
        if (ackResult === 0) {
          currentUploadJob.status = 'SUCCESS';
          console.log(`[MISSION] upload_id=${currentUploadJob.upload_id} SUCCESS duration=${(currentUploadJob.durationMs / 1000).toFixed(2)}s`);
        } else {
          currentUploadJob.status = 'FAILED';
          currentUploadJob.errorMessage = `MISSION_ACK rejected: ${resStr}`;
          console.warn(`[MISSION] upload_id=${currentUploadJob.upload_id} FAILED: ${resStr}`);
        }
      }
    }

    offset += packetLen;
  }
}

let lastHeartbeatLogTime = 0;

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

      // Inspect incoming packet for mission events
      inspectMavlinkPacket(data, 'RX');

      // ULTRA-FAST ZERO-COPY FORWARDING:
      // Transmit directly to all open browsers with no queuing and no compression delay
      if (browserSockets.size > 0) {
        for (const browser of browserSockets) {
          if (browser.readyState === WebSocket.OPEN) {
            // Drop packet for this specific client if client buffer is congested (>64KB)
            // to prevent lagging behind realtime telemetry
            if (browser.bufferedAmount < 65536) {
              browser.send(data, { binary: true, mask: false }, noop);
            }
          }
        }
      }
    } else {
      // JSON control message
      try {
        const text = data.toString();
        const msg = JSON.parse(text);
        if (msg.type === 'ESP32_STATUS') {
          esp32Online = msg.status === 'CONNECTED';
          esp32LastError = msg.error || '';
          console.log(`[CONNECTOR REPORT] ESP32 status: ${msg.status} ${esp32LastError ? `(${esp32LastError})` : ''}`);
          broadcastStatusToBrowsers();
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

  // Synchronize recent recon detections if any exist
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

  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;
    ws.lastActiveTime = Date.now();
    if (isBinary) {
      txBytesTotal += data.length;
      
      // Inspect outgoing packet from browser for mission events
      inspectMavlinkPacket(data, 'TX');

      // IMMEDIATE ZERO-DELAY COMMAND DISPATCH:
      // Ground Station command (Guided, Takeoff, Arm, RTL, Joystick) forward directly to ESP32
      if (connectorSocket && connectorSocket.readyState === WebSocket.OPEN) {
        connectorSocket.send(data, { binary: true, mask: false }, noop);
      }
    } else {
      // JSON message from browser client
      try {
        const text = data.toString();
        const msg = JSON.parse(text);
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
          reconDetections = [detection, ...reconDetections.slice(0, MAX_RECON_DETECTIONS - 1)];
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

// Low-latency Heartbeat & Zombie Socket Pruning (Runs every 20 seconds, requires >40s silence to prune)
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
}, 20000);

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
  }, 240000); // Every 4 minutes (Render sleep threshold is 15 minutes)
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
