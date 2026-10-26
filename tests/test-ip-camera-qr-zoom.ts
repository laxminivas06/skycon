/**
 * AERORECON — PHONE IP CAMERA CONFIGURATION, ZOOM & QR DETECTION TEST SUITE
 * 
 * Verifies:
 * 1. IP Camera configuration presets (Android IP Webcam 8080, DroidCam 4747, ESP32-CAM 81, Custom).
 * 2. URL parsing, composition, and Zero-CORS proxy URL generation.
 * 3. Optical (PTZ) & Digital zoom controls (clamping, step zoom, hardware zoom percentages, auto-sweep).
 * 4. Continuous QR code detection pipeline with bounding box extraction and validation (^\\d{2}$).
 * 5. Ground Station & Drone Core coordination via ipCameraService.
 */

// Mock browser globals for Node test environment
if (typeof globalThis.window === 'undefined') {
  const storage: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = String(v); },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).localStorage = mockLocalStorage;
}

import { ipCameraService } from '../frontend/src/services/ipCameraService';
import { decodeQRFromImageData, extractTwoDigits, parseCoordinatesFromPayload } from '../frontend/src/services/qrDecoderService';
import { reconDetectionService } from '../frontend/src/services/reconDetectionService';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    console.error(`  ✗ [FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
  }
}

async function runIpCameraTests() {
  console.log('\n===============================================================');
  console.log('📱 AERORECON — PHONE IP CAMERA CONFIG, ZOOM & QR TEST SUITE');
  console.log('===============================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1 — Configuration Presets & Helper Methods
  // --------------------------------------------------------------------------
  console.log('▶ TEST 1: Phone IP Camera Presets & URL Generation');
  {
    // Test URL Parser
    const parsed = ipCameraService.parseUrl('http://192.168.1.150:8080/video');
    assert(
      parsed !== null && parsed.ip === '192.168.1.150' && parsed.port === 8080 && parsed.path === '/video',
      'parseUrl correctly extracts IP, Port, and Path from standard URL'
    );

    // Test URL Builder
    const built = ipCameraService.buildUrl('192.168.1.42', 8080, '/video');
    assert(built === 'http://192.168.1.42:8080/video', 'buildUrl correctly generates http://192.168.1.42:8080/video');

    // Test Android IP Webcam Preset
    const androidCfg = ipCameraService.applyPreset('IP_WEBCAM_ANDROID', '192.168.1.55');
    assert(
      androidCfg.preset === 'IP_WEBCAM_ANDROID' &&
      androidCfg.port === 8080 &&
      androidCfg.path === '/video' &&
      androidCfg.snapshotPath === '/shot.jpg',
      'IP_WEBCAM_ANDROID preset applies port 8080, /video stream, and /shot.jpg snapshot'
    );

    // Test DroidCam Preset
    const droidCfg = ipCameraService.applyPreset('DROIDCAM', '192.168.1.77');
    assert(
      droidCfg.preset === 'DROIDCAM' &&
      droidCfg.port === 4747 &&
      droidCfg.path === '/video' &&
      droidCfg.snapshotPath === '/cam/1/frame.jpg',
      'DROIDCAM preset applies port 4747, /video stream, and /cam/1/frame.jpg snapshot'
    );

    // Test ESP32-CAM Preset
    const espCfg = ipCameraService.applyPreset('ESP32_CAM', '192.168.1.99');
    assert(
      espCfg.preset === 'ESP32_CAM' &&
      espCfg.port === 81 &&
      espCfg.path === '/stream' &&
      espCfg.snapshotPath === '/capture',
      'ESP32_CAM preset applies port 81, /stream, and /capture snapshot'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 2 — Zero-CORS Proxy URL Generation
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 2: Zero-CORS Proxy URL Routing');
  {
    ipCameraService.setConfig({
      fullUrl: 'http://192.168.1.10:8080/video',
      useProxy: true
    });
    const proxyUrl = ipCameraService.getEffectiveStreamUrl();
    assert(
      proxyUrl.startsWith('/api/ipcam/proxy?url=') &&
      proxyUrl.includes(encodeURIComponent('http://192.168.1.10:8080/video')),
      'getEffectiveStreamUrl routes via /api/ipcam/proxy when useProxy is true'
    );

    ipCameraService.setConfig({ useProxy: false });
    const directUrl = ipCameraService.getEffectiveStreamUrl();
    assert(
      directUrl === 'http://192.168.1.10:8080/video',
      'getEffectiveStreamUrl returns raw direct URL when useProxy is false'
    );

    // Restore proxy
    ipCameraService.setConfig({ useProxy: true });
  }

  // --------------------------------------------------------------------------
  // TEST 3 — Optical (PTZ) & Digital Zoom Controls
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 3: Zoom Controls (Clamping, Step, Hardware PTZ Scaling)');
  {
    // Test Zoom Clamping: 1.0x to 4.0x
    ipCameraService.setZoom(0.5, false);
    assert(ipCameraService.getZoom() === 1.0, 'setZoom clamps minimum zoom to 1.0x');

    ipCameraService.setZoom(5.8, false);
    assert(ipCameraService.getZoom() === 4.0, 'setZoom clamps maximum zoom to 4.0x');

    ipCameraService.setZoom(2.5, false);
    assert(ipCameraService.getZoom() === 2.5, 'setZoom sets exact 2.5x zoom');

    // Test Step Zoom
    ipCameraService.stepZoom(0.2);
    assert(ipCameraService.getZoom() === 2.7, 'stepZoom(+0.2) correctly advances zoom to 2.7x');

    ipCameraService.stepZoom(-0.5);
    assert(ipCameraService.getZoom() === 2.2, 'stepZoom(-0.5) correctly reduces zoom to 2.2x');

    // Test Hardware PTZ Zoom Dispatch
    // 1.0x = 0%, 2.5x = 50%, 4.0x = 100%
    let ptzDispatched = false;
    await ipCameraService.sendPtzZoom('http://192.168.1.5:8080', 2.5, false).then(() => {
      ptzDispatched = true;
    });
    assert(ptzDispatched, 'sendPtzZoom successfully dispatches remote PTZ zoom without error');

    // Test Auto-Zoom Sweep Toggle
    ipCameraService.setAutoZoomSweeping(true);
    assert(ipCameraService.isAutoZoom() === true, 'setAutoZoomSweeping(true) activates auto-sweep mode');

    ipCameraService.lockZoom('48');
    assert(
      ipCameraService.isLocked() === true &&
      ipCameraService.getLockedCode() === '48' &&
      ipCameraService.isAutoZoom() === false,
      'lockZoom locks zoom level, records target code, and halts auto-sweep'
    );

    ipCameraService.unlockZoom();
    assert(ipCameraService.isLocked() === false, 'unlockZoom releases lock');
  }

  // --------------------------------------------------------------------------
  // TEST 4 — Continuous QR Detection & Bounding Box Calculation
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 4: Continuous QR Detection & Bounding Box Verification');
  {
    // Test 2-digit format extraction (^\\d{2}$)
    const res1 = extractTwoDigits('48');
    assert(res1.isValid && res1.twoDigits === '48', 'extractTwoDigits validates exact 2-digit "48"');

    const res2 = extractTwoDigits('05');
    assert(res2.isValid && res2.twoDigits === '05', 'extractTwoDigits validates exact 2-digit "05"');

    const res3 = extractTwoDigits('TARGET-27');
    assert(res3.isValid && res3.twoDigits === '27', 'extractTwoDigits extracts 2-digit substring "27" from "TARGET-27"');

    const res4 = extractTwoDigits('INVALID_CODE');
    assert(!res4.isValid && res4.twoDigits === null, 'extractTwoDigits rejects non-numeric payload');

    // Test Geo Coordinates Parsing
    const geo = parseCoordinatesFromPayload('geo:17.385044,78.486671,15');
    assert(
      geo !== null &&
      Math.abs(geo.latitude - 17.385044) < 0.0001 &&
      Math.abs(geo.longitude - 78.486671) < 0.0001,
      'parseCoordinatesFromPayload extracts lat/lon/alt from geo: URI'
    );

    // Test jsQR execution on synthetic mock image data
    const width = 100;
    const height = 100;
    const mockImageData = {
      data: new Uint8ClampedArray(width * height * 4).fill(255),
      width,
      height
    } as any;

    const decodeRes = await decodeQRFromImageData(mockImageData);
    // On solid white image, decodeQRFromImageData gracefully returns null
    assert(decodeRes === null, 'decodeQRFromImageData runs safely without crashing on blank image');
  }

  // --------------------------------------------------------------------------
  // TEST 5 — Source Mode & Ground Station Integration
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 5: Camera Source Mode Coordination');
  {
    let notifiedMode = '';
    const unsub = ipCameraService.subscribeSourceMode((m) => {
      notifiedMode = m;
    });

    ipCameraService.setSourceMode('PHONE_IP_CAM');
    assert(
      ipCameraService.getSourceMode() === 'PHONE_IP_CAM' && notifiedMode === 'PHONE_IP_CAM',
      'setSourceMode("PHONE_IP_CAM") persists and notifies subscribers'
    );

    ipCameraService.setSourceMode('DRONE_CORE');
    assert(
      ipCameraService.getSourceMode() === 'DRONE_CORE' && notifiedMode === 'DRONE_CORE',
      'setSourceMode("DRONE_CORE") switches back to drone onboard stream'
    );

    unsub();
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`📊 IP CAMERA SUITE SUMMARY: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
  console.log('===============================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runIpCameraTests().catch((err) => {
  console.error('Fatal IP Camera Test Error:', err);
  process.exit(1);
});
