import http from 'http';
import WebSocket from 'ws';
import { fork, ChildProcess } from 'child_process';
import path from 'path';

const PORT = 3099;
const SERVER_PATH = path.resolve(process.cwd(), 'backend/server.js');

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBackendSmokeTest() {
  console.log('\n===============================================================');
  console.log('🛸 SAE INDIA — BACKEND RELAY SMOKE & AUTH HARDENING TEST');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, name: string) {
    if (cond) {
      passed++;
      console.log(`  ✓ [PASS] ${name}`);
    } else {
      failed++;
      console.error(`  ✗ [FAIL] ${name}`);
    }
  }

  // 1. Spawn backend server with custom port
  const child = fork(SERVER_PATH, [], {
    env: { ...process.env, PORT: String(PORT), RELAY_TOKEN: 'saeindia_sec_99348a7b1c0e' },
    stdio: 'pipe'
  });

  try {
    // Wait for server to start listening
    await wait(1200);

    // 2. Test HTTP /health endpoint
    const healthRes = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 0, body: data });
          }
        });
      });
      req.on('error', reject);
    });

    assert(healthRes.status === 200, 'HTTP GET /health returns 200 OK');
    assert(healthRes.body.status === 'ok', 'Health payload status is ok');

    // 3. Test /connector without token (Must be rejected with 401)
    const connectorNoToken = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/connector`);
      ws.on('open', () => { ws.close(); resolve(false); });
      ws.on('unexpected-response', (req, res) => {
        resolve(res.statusCode === 401);
      });
      ws.on('error', () => { resolve(true); });
    });
    assert(connectorNoToken, 'WS /connector without token rejected with 401 Unauthorized (AUD-01)');

    // 4. Test /connector with valid token (Must succeed)
    const connectorWithToken = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/connector?token=saeindia_sec_99348a7b1c0e`);
      ws.on('open', () => { ws.close(); resolve(true); });
      ws.on('error', () => { resolve(false); });
    });
    assert(connectorWithToken, 'WS /connector with valid token connects successfully');

    // 5. Test /ws without token (Must be rejected with 401)
    const wsNoToken = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      ws.on('open', () => { ws.close(); resolve(false); });
      ws.on('unexpected-response', (req, res) => {
        resolve(res.statusCode === 401);
      });
      ws.on('error', () => { resolve(true); });
    });
    assert(wsNoToken, 'WS /ws without token rejected with 401 Unauthorized (AUD-01)');

    // 6. Test /ws with valid token (Must succeed)
    const wsWithToken = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=saeindia_sec_99348a7b1c0e`);
      ws.on('open', () => { ws.close(); resolve(true); });
      ws.on('error', () => { resolve(false); });
    });
    assert(wsWithToken, 'WS /ws with valid token connects successfully');

  } finally {
    child.kill('SIGTERM');
  }

  console.log('\n===============================================================');
  console.log(`📊 BACKEND SMOKE RESULTS: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
}

runBackendSmokeTest().catch(err => {
  console.error('Smoke test failure:', err);
  process.exit(1);
});
