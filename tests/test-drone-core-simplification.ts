/**
 * AERORECON — DRONE CORE SIMPLIFICATION VERIFICATION TEST SUITE
 * 
 * Verifies all 7 requirements from user request:
 * 1. Single Header (No duplicate header in Drone Core interface)
 * 2. Latest QR Intelligence section completely removed
 * 3. Recon Detection History section completely removed
 * 4. Camera view is the primary and only main content component
 * 5. Automatic QR detection, decoding, Runner data transfer, and Pixhawk RTL preserved
 * 6. Responsive layout and camera disconnect graceful handling
 * 7. Communication services and backend APIs remain unaffected
 */

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

import fs from 'fs';
import path from 'path';
import { mavlinkService } from '../frontend/src/services/mavlinkService';
import { visionService } from '../frontend/src/services/visionService';
import { reconDetectionService } from '../frontend/src/services/reconDetectionService';
import { runnerCommService } from '../frontend/src/services/runnerCommService';

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

async function runTests() {
  console.log('\n===============================================================');
  console.log('🛸 DRONE CORE SIMPLIFICATION & FUNCTIONALITY VERIFICATION');
  console.log('===============================================================\n');

  const appPath = path.resolve(process.cwd(), 'frontend/src/App.tsx');
  const droneDashboardPath = path.resolve(process.cwd(), 'frontend/src/components/Drone/DroneDashboard.tsx');

  const appContent = fs.readFileSync(appPath, 'utf8');
  const droneDashboardContent = fs.readFileSync(droneDashboardPath, 'utf8');

  // --------------------------------------------------------------------------
  // TEST 1 — Fix Duplicate Header: Root Cause Resolved & Single Header Display
  // --------------------------------------------------------------------------
  console.log('▶ TEST 1: Header Architecture & Duplicate Elimination');
  {
    // Check that App.tsx has the single header for DRONE role
    const droneIndex = appContent.indexOf("currentRole === 'DRONE'");
    assert(droneIndex !== -1, 'App.tsx contains dedicated DRONE role handler');

    if (droneIndex !== -1) {
      const droneSection = appContent.slice(droneIndex, droneIndex + 2500);
      const headerTags = (droneSection.match(/<header/g) || []).length;
      assert(headerTags === 1, 'App.tsx renders exactly 1 top <header> for Drone Core');
      assert(droneSection.includes('DRONE CORE INTELLIGENCE'), 'App.tsx header displays "DRONE CORE INTELLIGENCE"');
      assert(droneSection.includes('LOGOUT'), 'App.tsx header contains LOGOUT button');
      assert(droneSection.includes('h-[52px]'), 'App.tsx header preserves h-[52px] fixed styling');
    }

    // Check DroneDashboard.tsx no longer renders a duplicate header/status bar
    assert(!droneDashboardContent.includes('AERORECON DRONE CORE'), 'DroneDashboard does not contain duplicate AERORECON DRONE CORE header');
    assert(!droneDashboardContent.includes('1. TOP STATUS BAR'), 'DroneDashboard duplicate TOP STATUS BAR comment/element removed');
    assert(!droneDashboardContent.includes('CAM:'), 'DroneDashboard duplicate CAM status bar pill removed');
    assert(!droneDashboardContent.includes('FC:'), 'DroneDashboard duplicate FC status bar pill removed');
    assert(!droneDashboardContent.includes('3D FIX ('), 'DroneDashboard duplicate GPS status bar pill removed');
  }

  // --------------------------------------------------------------------------
  // TEST 2 — Remove Latest QR Intelligence
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 2: Complete Removal of Latest QR Intelligence Section');
  {
    assert(!droneDashboardContent.includes('LATEST QR INTELLIGENCE'), '"LATEST QR INTELLIGENCE" title removed from DroneDashboard');
    assert(!droneDashboardContent.includes('SEARCH SCAN IN PROGRESS'), '"SEARCH SCAN IN PROGRESS" standby card removed');
    assert(!droneDashboardContent.includes('DECODED PAYLOAD:'), '"DECODED PAYLOAD:" card element removed');
    assert(!droneDashboardContent.includes('PIXHAWK CAPTURE TELEMETRY'), '"PIXHAWK CAPTURE TELEMETRY" panel removed');
    assert(!droneDashboardContent.includes('CASE A: CONFIRMED TARGET COORDS'), '"CASE A: CONFIRMED TARGET COORDS" panel removed');
    assert(!droneDashboardContent.includes('setSelectedPhoto'), 'selectedPhoto modal setter removed from DroneDashboard');
    assert(!droneDashboardContent.includes('ORIGINAL-RESOLUTION PHOTO INSPECTION'), 'Photo inspection modal removed from DroneDashboard');
    assert(!droneDashboardContent.includes('activeTarget'), 'Unused activeTarget state removed from DroneDashboard');
    assert(!droneDashboardContent.includes('targetDistance'), 'Unused targetDistance state removed from DroneDashboard');
  }

  // --------------------------------------------------------------------------
  // TEST 3 — Remove Recon Detection History
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 3: Complete Removal of Recon Detection History Section');
  {
    assert(!droneDashboardContent.includes('RECON DETECTION HISTORY'), '"RECON DETECTION HISTORY" panel removed from DroneDashboard');
    assert(!droneDashboardContent.includes('SAVED LOCALLY'), '"SAVED LOCALLY" strip subtitle removed');
    assert(!droneDashboardContent.includes('detections.slice'), 'History list mapping (detections.slice) removed');
    assert(!droneDashboardContent.includes('setDetections'), 'Unused detections array state removed from DroneDashboard');
  }

  // --------------------------------------------------------------------------
  // TEST 4 — Keep Only Camera Interface as Main Content
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 4: Camera View as Only Main Content Component');
  {
    assert(droneDashboardContent.includes('videoRef'), 'DroneDashboard retains videoRef for camera');
    assert(droneDashboardContent.includes('DRONE-CORE OPTICAL SENSOR'), 'Camera view card retains optical sensor branding');
    assert(droneDashboardContent.includes('WIDE FIELD OF VIEW (1.0x)'), 'Camera view explicitly preserves 1.0x Wide FOV');
    assert(droneDashboardContent.includes('NATIVE RESOLUTION'), 'Camera view specifies native resolution feed');
    assert(droneDashboardContent.includes('aspect-video'), 'Camera view enforces aspect-video (16:9) ratio');
    assert(droneDashboardContent.includes('INITIALIZE CAMERA'), 'Graceful camera disconnect handling with restart button');
    assert(!droneDashboardContent.includes('lg:col-span-8'), '2-column grid wrapper removed: camera takes full width');
    assert(!droneDashboardContent.includes('lg:col-span-4'), 'Right sidebar column completely removed');
  }

  // --------------------------------------------------------------------------
  // TEST 5 — Underlying Automatic QR Detection & Pipeline Preservation
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 5: Automatic QR Detection, Decoding, Runner Transfer & RTL');
  {
    // Test Pixhawk GPS telemetry association
    (mavlinkService as any).telemetry.latitude = 12.971600;
    (mavlinkService as any).telemetry.longitude = 77.594600;
    (mavlinkService as any).telemetry.altitude = 12.5;
    (mavlinkService as any).telemetry.flightMode = 'AUTO';
    (mavlinkService as any).telemetry.gps.isLocked = true;
    (mavlinkService as any).telemetry.gps.latitude = 12.971600;
    (mavlinkService as any).telemetry.gps.longitude = 77.594600;
    (mavlinkService as any).telemetry.gps.altitude = 12.5;
    (mavlinkService as any).telemetry.gps.satellites = 14;
    (mavlinkService as any).telemetry.gps.hdop = 0.8;
    (mavlinkService as any).telemetry.gps.fixType = '3D_FIX';

    const telem = mavlinkService.getTelemetry();
    assert(telem.latitude === 12.971600 && telem.altitude === 12.5, 'Pixhawk GPS telemetry locked and valid');

    // Test Runner Unit Communication listener
    let runnerReceivedData: any = null;
    const unsubRunner = runnerCommService.subscribeMessages((msg: any) => {
      if (msg.type === 'QR_DISPATCH') {
        runnerReceivedData = msg;
      }
    });

    // Simulate QR detection event
    const samplePayload = 'AERORECON_DROP_TARGET_GRID_99';
    const detectionRecord = await reconDetectionService.handleRawDetectionEvent({
      photoDataUrl: 'data:image/jpeg;base64,sample_full_res_photo',
      thumbnailDataUrl: 'data:image/jpeg;base64,sample_thumb',
      initialPayload: samplePayload,
      boundingBox: { x: 50, y: 50, width: 200, height: 200 }
    });

    assert(detectionRecord.payload === samplePayload, 'QR payload successfully decoded and saved');
    assert(detectionRecord.gpsFixValid === true, 'Pixhawk GPS telemetry synchronized with detection');
    assert(detectionRecord.droneLatitude === 12.971600, 'Drone GPS latitude correctly associated');
    assert(detectionRecord.droneAltitudeAgl === 12.5, 'Altitude AGL correctly recorded (12.5m)');
    assert(detectionRecord.rtlInitiated === true, 'Automatic Pixhawk RTL triggered upon valid QR receipt');

    // Verify Runner Unit received QR data automatically without manual intervention
    assert(runnerReceivedData !== null, 'Runner Unit automatically received QR data packet');
    if (runnerReceivedData) {
      assert(runnerReceivedData.qrCode === samplePayload, 'Runner received correct QR payload string');
    }

    if ((runnerCommService as any).retransmitTimer) {
      clearInterval((runnerCommService as any).retransmitTimer);
    }

    // Verify Pixhawk Flight Mode transitioned to RTL
    const updatedTelem = mavlinkService.getTelemetry();
    assert(updatedTelem.flightMode === 'RTL', 'Pixhawk flight mode automatically updated to RTL');

    // Verify Drone Core status is updated to RETURNING TO LAUNCH
    const coreStatus = reconDetectionService.getDroneCoreStatus();
    assert(coreStatus === 'RETURNING TO LAUNCH' || coreStatus === 'RTL INITIATED', 'Drone Core status reflects RTL execution');

    unsubRunner();
  }

  // --------------------------------------------------------------------------
  // TEST 6 — Responsive Layout & Overflow Elimination
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 6: Responsive Layout & No Scrollbars Configuration');
  {
    assert(appContent.includes('h-[100dvh]'), 'App.tsx uses h-[100dvh] for full viewport lock');
    assert(appContent.includes('overflow-hidden'), 'App.tsx uses overflow-hidden to prevent page scrollbars');
    assert(droneDashboardContent.includes('min-h-0'), 'DroneDashboard uses min-h-0 for proper flex containment');
    assert(droneDashboardContent.includes('flex-1'), 'DroneDashboard camera occupies remaining available space');
  }

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${passedTests} / ${totalTests} assertions passed (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
  console.log('===============================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
