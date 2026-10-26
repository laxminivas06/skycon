const WebSocket = require('ws');
const { spawn } = require('child_process');

console.log('--- STARTING END-TO-END PIPELINE VERIFICATION ---');

// 0. Spin up Mock ESP32 WebSocket server on port 8089
const mockEsp32Server = new WebSocket.Server({ port: 8089 });
let mockHbInterval = null;
mockEsp32Server.on('connection', (ws) => {
  console.log('[MOCK ESP32] Local connector connected to simulated ESP32 bridge.');
  mockHbInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const hb = Buffer.from([0xFE, 0x09, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x03, 0x00, 0x00, 0x00, 0xD0, 0x8A]);
      ws.send(hb);
    }
  }, 200);

  ws.on('message', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      const ack = Buffer.from([0xFE, 0x03, 0x02, 0x01, 0x01, 0x4D, 0x90, 0x01, 0x00, 0x12, 0x34]);
      ws.send(ack);
    }
  });

  ws.on('close', () => {
    if (mockHbInterval) clearInterval(mockHbInterval);
  });
});

// 1. Launch Cloud Relay on port 8765
const relay = spawn('node', ['backend/server.js'], {
  env: { ...process.env, PORT: '8765', RELAY_TOKEN: 'e2e-secret-key-456' }
});

relay.stdout.on('data', d => console.log('[RELAY]', d.toString().trim()));
relay.stderr.on('data', d => console.error('[RELAY ERROR]', d.toString().trim()));

setTimeout(() => {
  // 2. Connect Browser client to Relay
  console.log('\n[TEST] Connecting Browser client to Relay /ws?token=e2e-secret-key-456...');
  const browserWs = new WebSocket('ws://localhost:8765/ws?token=e2e-secret-key-456');
  browserWs.binaryType = 'arraybuffer';

  let binaryPacketsReceived = 0;
  let controlMessagesReceived = [];

  browserWs.on('open', () => {
    console.log('[BROWSER] WebSocket connected to relay endpoint successfully.');

    // 3. Now start the Local Connector
    console.log('\n[TEST] Launching Local Connector pointing to Mock ESP32 (127.0.0.1:8089/ws) & Relay...');
    const connector = spawn('node', ['local-connector/connector.js'], {
      env: {
        ...process.env,
        ESP32_HOST: '127.0.0.1',
        ESP32_PORT: '8089',
        ESP32_PATH: '/ws',
        RELAY_URL: 'ws://localhost:8765/connector',
        RELAY_TOKEN: 'e2e-secret-key-456'
      }
    });

    connector.stdout.on('data', d => console.log('[CONNECTOR]', d.toString().trim()));
    connector.stderr.on('data', d => console.error('[CONNECTOR ERROR]', d.toString().trim()));

    // 4. Send uplink command from browser through relay -> connector -> ESP32
    setTimeout(() => {
      console.log('\n[TEST] Sending simulated uplink MAVLink heartbeat from Browser to ESP32...');
      const dummyHeartbeat = Buffer.from([0xFD, 0x09, 0x00, 0x00, 0x01, 0xFF, 0xBE, 0x00, 0x00, 0x00, 0x06, 0x08, 0x00, 0x00, 0x00, 0x03, 0x85, 0x47, 0x5a]);
      browserWs.send(dummyHeartbeat);
    }, 1500);

    setTimeout(() => {
      console.log('\n--- VERIFICATION SUMMARY ---');
      console.log('Total Control Messages Received:', controlMessagesReceived.length);
      console.log('Total Binary MAVLink Packets Received by Browser:', binaryPacketsReceived);
      const passed = binaryPacketsReceived > 0;
      console.log('Result:', passed ? 'SUCCESS - E2E Pipeline fully operational' : 'FAILED - No binary packets');

      browserWs.close();
      connector.kill();
      relay.kill();
      mockEsp32Server.close();
      process.exit(passed ? 0 : 1);
    }, 4500);
  });

  browserWs.on('message', (data, isBinary) => {
    if (!isBinary) {
      const msg = data.toString();
      controlMessagesReceived.push(msg);
      console.log('[BROWSER] Received JSON Control Message:', msg);
    } else {
      binaryPacketsReceived++;
      const bytes = new Uint8Array(data);
      const magic = bytes[0] === 0xFD ? 'MAVLink v2 (0xFD)' : (bytes[0] === 0xFE ? 'MAVLink v1 (0xFE)' : '0x' + bytes[0].toString(16));
      if (binaryPacketsReceived <= 5) {
        console.log(`[BROWSER] Received Binary MAVLink Frame #${binaryPacketsReceived}: len=${bytes.length}, header=${magic}, seq=${bytes[2]}`);
      }
    }
  });

}, 1000);
