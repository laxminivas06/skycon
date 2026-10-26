import assert from 'assert';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

// Minimal mock server mirroring backend/server.js camera relay routing logic
function createTestServer() {
  const server = http.createServer((_req: any, res: any) => {
    res.writeHead(200);
    res.end('OK');
  });
  const wss = new WebSocketServer({ server });

  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', (raw) => {
      // Forward text JSON payloads across all other connected clients
      try {
        const text = raw.toString();
        if (text.startsWith('{')) {
          const parsed = JSON.parse(text);
          if (
            parsed.type === 'CAMERA_STREAM_SIGNAL' ||
            parsed.type === 'CAMERA_FRAME_DATA' ||
            parsed.type === 'CAMERA_STATUS_UPDATE' ||
            parsed.type === 'CAMERA_HEARTBEAT'
          ) {
            for (const client of clients) {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(text);
              }
            }
          }
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  return { server, wss };
}

async function runCameraStreamingTests() {
  console.log('===============================================================');
  console.log('📹 SAE INDIA — DIRECT DRONE-CORE CAMERA STREAMING PIPELINE TEST');
  console.log('===============================================================\n');

  const { server, wss } = createTestServer();

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as any).port;
  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    // 1. Connect Drone Core Client
    const droneClient = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => droneClient.on('open', resolve));
    console.log('  ✓ [PASS] Drone Core client connected to relay server');

    // 2. Connect Ground Station (GCS) Client
    const gcsClient = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => gcsClient.on('open', resolve));
    console.log('  ✓ [PASS] Ground Station client connected to relay server');

    // 3. Test CAMERA_STATUS_UPDATE (Camera Turned ON on Drone Core)
    const statusPromise = new Promise<any>((resolve) => {
      gcsClient.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    droneClient.send(
      JSON.stringify({
        type: 'CAMERA_STATUS_UPDATE',
        senderRole: 'DRONE',
        timestamp: Date.now(),
        isCameraActive: true,
        status: 'LIVE_FEED_CONNECTED',
        message: 'Drone Core Camera Active & Capturing'
      })
    );

    const receivedStatus = await statusPromise;
    assert.strictEqual(receivedStatus.type, 'CAMERA_STATUS_UPDATE');
    assert.strictEqual(receivedStatus.isCameraActive, true);
    assert.strictEqual(receivedStatus.status, 'LIVE_FEED_CONNECTED');
    console.log('  ✓ [PASS] Drone Core Camera ON event correctly received by Ground Station');

    // 4. Test High-Speed Live Frame Data Transmission
    const framePromise = new Promise<any>((resolve) => {
      gcsClient.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    const testFrameBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD...testframe';
    droneClient.send(
      JSON.stringify({
        type: 'CAMERA_FRAME_DATA',
        senderRole: 'DRONE',
        timestamp: Date.now(),
        frameData: testFrameBase64,
        frameIndex: 1
      })
    );

    const receivedFrame = await framePromise;
    assert.strictEqual(receivedFrame.type, 'CAMERA_FRAME_DATA');
    assert.strictEqual(receivedFrame.frameData, testFrameBase64);
    assert.strictEqual(receivedFrame.frameIndex, 1);
    console.log('  ✓ [PASS] Direct live frame data forwarded to Ground Station with zero IP config');

    // 5. Test WebRTC Signaling (SDP Offer / Answer Exchange)
    const signalPromise = new Promise<any>((resolve) => {
      gcsClient.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    droneClient.send(
      JSON.stringify({
        type: 'CAMERA_STREAM_SIGNAL',
        senderRole: 'DRONE',
        timestamp: Date.now(),
        signalData: {
          sdp: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' }
        }
      })
    );

    const receivedSignal = await signalPromise;
    assert.strictEqual(receivedSignal.type, 'CAMERA_STREAM_SIGNAL');
    assert.strictEqual(receivedSignal.signalData.sdp.type, 'offer');
    console.log('  ✓ [PASS] WebRTC SDP offer signal transmitted from Drone Core to Ground Station');

    // 6. Test CAMERA_STATUS_UPDATE (Camera Turned OFF on Drone Core)
    const cameraOffPromise = new Promise<any>((resolve) => {
      gcsClient.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    droneClient.send(
      JSON.stringify({
        type: 'CAMERA_STATUS_UPDATE',
        senderRole: 'DRONE',
        timestamp: Date.now(),
        isCameraActive: false,
        status: 'CAMERA_OFFLINE',
        message: 'Drone Core Camera Turned Off'
      })
    );

    const receivedOff = await cameraOffPromise;
    assert.strictEqual(receivedOff.type, 'CAMERA_STATUS_UPDATE');
    assert.strictEqual(receivedOff.isCameraActive, false);
    assert.strictEqual(receivedOff.status, 'CAMERA_OFFLINE');
    console.log('  ✓ [PASS] Drone Core Camera OFF event correctly received by Ground Station');

    // Cleanup
    droneClient.close();
    gcsClient.close();
    server.close();

    console.log('\n===============================================================');
    console.log('📊 DRONE CORE CAMERA STREAMING: ALL 6 TESTS PASSED (0 FAILED)');
    console.log('===============================================================\n');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

runCameraStreamingTests();
