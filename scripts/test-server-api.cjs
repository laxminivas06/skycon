/**
 * Comprehensive Automated Test Suite: Node.js Relay Server & Vision API
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'backend', 'server.js');
const TEST_PORT = 5001;

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    if (dataString) {
      options.headers['Content-Length'] = Buffer.byteLength(dataString);
    }

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          const parsed = responseData ? JSON.parse(responseData) : null;
          resolve({ status: res.statusCode, data: parsed, raw: responseData });
        } catch {
          resolve({ status: res.statusCode, raw: responseData });
        }
      });
    });

    req.on('error', reject);
    if (dataString) {
      req.write(dataString);
    }
    req.end();
  });
}

async function runTests() {
  console.log('[TEST] Starting Node.js Relay Server on port', TEST_PORT);
  const serverProcess = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('Server running') || s.includes('LISTENING')) {
      // server ready
    }
  });

  serverProcess.stderr.on('data', (d) => {
    console.error('[SERVER ERROR]', d.toString());
  });

  // Wait for server to bind port
  await new Promise(r => setTimeout(r, 2000));

  try {
    // 1. Health check
    console.log('[TEST 5.1] Testing GET /health...');
    const health = await makeRequest('GET', '/health');
    console.log(' -> Status:', health.status, 'Response:', health.data);
    if (health.status !== 200 || !health.data?.status) {
      throw new Error(`Health check failed: ${JSON.stringify(health)}`);
    }
    console.log(' ✓ PASS: Health check verified');

    // 2. Plan Spiral Route endpoint
    console.log('[TEST 5.2] Testing POST /api/vision/plan-spiral (Rectangle)...');
    const planReq = {
      boundaryType: 'RECTANGLE',
      altitude: 5,
      speed: 4,
      width: 30,
      height: 20,
      center: { lat: 13.0827, lng: 80.2707 }
    };
    const planRes = await makeRequest('POST', '/api/vision/plan-spiral', planReq);
    console.log(' -> Status:', planRes.status, 'Waypoints count:', planRes.data?.waypoints?.length, 'Feasible:', planRes.data?.isFeasible);
    if (planRes.status !== 200 || !planRes.data?.waypoints || planRes.data.waypoints.length === 0) {
      throw new Error(`Plan spiral failed: ${JSON.stringify(planRes)}`);
    }
    console.log(' ✓ PASS: Rectangular spiral route successfully computed with lane spacing:', planRes.data.laneSpacing, 'm');

    // 3. Post Heatmap
    console.log('[TEST 5.3] Testing POST /api/vision/heatmap...');
    const heatmapPayload = {
      serverTimestamp: Date.now(),
      gridWidth: 32,
      gridHeight: 24,
      classificationGrid: Array.from({ length: 24 }, () => Array(32).fill(0)),
      confidenceGrid: Array.from({ length: 24 }, () => Array(32).fill(0.95)),
      activeObjectsCount: 1,
      droneLat: 13.0827,
      droneLon: 80.2707,
      droneAlt: 5.0
    };
    // Mark target box cell at (12, 16) as Tier 3 (QR)
    heatmapPayload.classificationGrid[12][16] = 3;

    const postHeatmap = await makeRequest('POST', '/api/vision/heatmap', { heatmap: heatmapPayload });
    console.log(' -> Status:', postHeatmap.status, 'Response:', postHeatmap.data);
    if (postHeatmap.status !== 200 || !postHeatmap.data?.success) {
      throw new Error(`Post heatmap failed: ${JSON.stringify(postHeatmap)}`);
    }
    console.log(' ✓ PASS: Live Heatmap matrix ingested');

    // 4. Get Heatmap
    console.log('[TEST 5.4] Testing GET /api/vision/heatmap...');
    const getHeatmap = await makeRequest('GET', '/api/vision/heatmap');
    console.log(' -> Status:', getHeatmap.status, 'Grid dimensions:', getHeatmap.data?.heatmap?.gridWidth, 'x', getHeatmap.data?.heatmap?.gridHeight);
    if (getHeatmap.status !== 200 || getHeatmap.data?.heatmap?.gridWidth !== 32) {
      throw new Error(`Get heatmap failed: ${JSON.stringify(getHeatmap)}`);
    }
    console.log(' ✓ PASS: Heatmap retrieval verified');

    // 5. Post Objects
    console.log('[TEST 5.5] Testing POST /api/vision/objects...');
    const testObjects = [
      {
        object_id: 'OBJ_001',
        category: 'QR_CANDIDATE',
        shape: 'QR_PATTERN',
        priority: 1,
        confidence: 0.98,
        lat: 13.0827,
        lon: 80.2707,
        status: 'VERIFIED',
        decoded_payload: 'CACHE:42',
        two_digit_code: '42'
      }
    ];
    const postObjects = await makeRequest('POST', '/api/vision/objects', { objects: testObjects });
    console.log(' -> Status:', postObjects.status, 'Response:', postObjects.data);
    if (postObjects.status !== 200 || !postObjects.data?.success) {
      throw new Error(`Post objects failed: ${JSON.stringify(postObjects)}`);
    }
    console.log(' ✓ PASS: Object registry update ingested');

    // 6. Get Objects
    console.log('[TEST 5.6] Testing GET /api/vision/objects...');
    const getObjects = await makeRequest('GET', '/api/vision/objects');
    console.log(' -> Status:', getObjects.status, 'Objects count:', getObjects.data?.objects?.length, 'First Object Code:', getObjects.data?.objects?.[0]?.two_digit_code);
    if (getObjects.status !== 200 || getObjects.data?.objects?.[0]?.two_digit_code !== '42') {
      throw new Error(`Get objects failed: ${JSON.stringify(getObjects)}`);
    }
    console.log(' ✓ PASS: Target Object verification confirmed (Code 42 extracted)');

    console.log('\n========================================');
    console.log('ALL NODE.JS RELAY SERVER TESTS PASSED ✓');
    console.log('========================================\n');
  } finally {
    serverProcess.kill('SIGTERM');
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
