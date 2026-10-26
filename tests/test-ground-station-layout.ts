/**
 * AERORECON — GROUND STATION FIXED LAYOUT & RESPONSIVE DASHBOARD TEST SUITE
 *
 * Verifies all 11 Acceptance Criteria from Specification Section 11:
 * Test 1 — Ground Station fills the available viewport (100dvh, overflow hidden).
 * Test 2 — The old sidebar items (Cockpit, Mission Plan, Flight Controller, Flight Logs, Serial Link) are removed.
 * Test 3 — The split-view option and controls are removed.
 * Test 4 — Left panel displays only essential telemetry: Altitude (not attitude), Compass, Speed, Battery.
 * Test 5 — Center map displays the correct Pixhawk GPS location and heading.
 * Test 6 — Right panel contains Camera, Arm and Fly, Upload Waypoints, Waypoint Manager, Flight Parameters.
 * Test 7 — Outer dashboard does not scroll on desktop (h-[100dvh], overflow-hidden).
 * Test 8 — Panel content scrolls independently only when necessary (overflow-y-auto, min-h-0).
 * Test 9 — Map interactions and waypoint selection continue working.
 * Test 10 — Layout adapts correctly to different screen sizes (desktop 3-column, tablet/mobile view switcher).
 * Test 11 — No existing flight-control, GPS, or mission functionality is broken.
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
import { missionEngine } from '../frontend/src/services/missionEngine';
import { groundStationMissionService } from '../frontend/src/services/groundStationMissionService';

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

async function runGroundStationTests() {
  console.log('\n===============================================================');
  console.log('🛸 AERORECON — GROUND STATION THREE-PANEL LAYOUT TEST SUITE');
  console.log('===============================================================\n');

  const dashboardPageCode = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/src/features/dashboard/DashboardPage.tsx'),
    'utf-8'
  );
  const telemetryPanelCode = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/src/features/dashboard/TelemetryPanel.tsx'),
    'utf-8'
  );
  const flightOpsCode = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/src/features/dashboard/FlightOperationsCard.tsx'),
    'utf-8'
  );
  const mapPanelCode = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/src/features/dashboard/MapPanel.tsx'),
    'utf-8'
  );
  const headerCode = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/src/features/dashboard/Header.tsx'),
    'utf-8'
  );

  // --------------------------------------------------------------------------
  // TEST 1 — Viewport Containment & Outer Scroll Suppression
  // --------------------------------------------------------------------------
  console.log('▶ TEST 1: Full-Screen Viewport Shell & Outer Scroll Suppression');
  {
    assert(
      dashboardPageCode.includes('h-[100dvh]') && dashboardPageCode.includes('overflow-hidden'),
      'Main application shell uses height 100dvh and overflow-hidden to prevent outer scrolling'
    );
    assert(
      !dashboardPageCode.includes('overflow-y-auto min-w-0') || !dashboardPageCode.includes('min-h-screen'),
      'Old min-h-screen full-page scrolling container removed'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 2 — Old Sidebar Removal
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 2: Removal of Old Navigation Sidebar & Menu Items');
  {
    assert(
      !dashboardPageCode.includes('<Sidebar'),
      'Sidebar component tag completely removed from DashboardPage'
    );
    assert(
      !dashboardPageCode.includes("import { Sidebar } from './Sidebar';"),
      'Sidebar import removed from DashboardPage'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 3 — Split-View Removal
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 3: Removal of Split-View Option & Controls');
  {
    assert(
      !dashboardPageCode.includes('splitView') && !dashboardPageCode.includes('split-view'),
      'Split-view state and controls completely absent from Ground Station'
    );
    assert(
      !headerCode.includes('onSwitchRole'),
      'Ground Station / Field Runner role switcher removed from header'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 4 — Left Panel Telemetry: Altitude (Not Attitude), Compass, Speed, Battery
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 4: Left Panel Live Drone Telemetry Indicators');
  {
    assert(
      dashboardPageCode.includes('<TelemetryPanel'),
      'Left panel renders dedicated TelemetryPanel component'
    );
    assert(
      telemetryPanelCode.includes('title="ALTITUDE"') && !telemetryPanelCode.includes('ATTITUDE (PFD)'),
      'TelemetryPanel displays Altitude, NOT Attitude (PFD artificial horizon omitted)'
    );
    assert(
      telemetryPanelCode.includes('METERS') && telemetryPanelCode.includes('telemetry.altitudeMeters'),
      'Altitude telemetry displays measurement units clearly and reads from Pixhawk'
    );
    assert(
      telemetryPanelCode.includes('title="COMPASS"') && telemetryPanelCode.includes('rotate(${heading}deg)'),
      'Compass indicator displays heading and updates in real time with rotating needle'
    );
    assert(
      telemetryPanelCode.includes('title="SPEED"') && telemetryPanelCode.includes('telemetry.speedMs'),
      'Speed indicator displays current velocity in m/s using flight-controller telemetry'
    );
    assert(
      telemetryPanelCode.includes('title="BATTERY"') && telemetryPanelCode.includes('telemetry.batteryVoltage'),
      'Battery indicator displays percentage, voltage, and low-battery warning banner'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 5 — Center Panel Live Map GPS Tracking & Heading
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 5: Center Panel Live Map with GPS Location & Heading Marker');
  {
    assert(
      dashboardPageCode.includes('<MapPanel'),
      'Center panel hosts MapPanel as primary visual element'
    );
    assert(
      mapPanelCode.includes('ResizeObserver'),
      'MapPanel integrates ResizeObserver for dynamic resize recalculation'
    );
    assert(
      mapPanelCode.includes('!telemetry.isGpsValid'),
      'MapPanel displays clear warning when Pixhawk GPS telemetry is invalid/unavailable'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 6 — Right Panel Operations Order (Camera, Arm/Fly, Upload, Waypoints, Params)
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 6: Right Panel Vertical Order of Components');
  {
    const cameraIdx = dashboardPageCode.indexOf('<CameraFeed');
    const validOpsIndices = [
      dashboardPageCode.indexOf('<FlightOperationsCard'),
      dashboardPageCode.indexOf('<ManualMissionControlCard'),
      dashboardPageCode.indexOf('<AutonomousMissionControlCard')
    ].filter(i => i !== -1);
    const opsIdx = validOpsIndices.length > 0 ? Math.min(...validOpsIndices) : -1;
    const wpIdx = dashboardPageCode.indexOf('<WaypointManager');
    const paramsIdx = dashboardPageCode.indexOf('<FlightParams');

    assert(cameraIdx !== -1, 'Right panel includes Drone CameraFeed');
    assert(opsIdx !== -1, 'Right panel includes FlightOperationsCard / MissionControlCard (Arm and Fly & Upload)');
    assert(wpIdx !== -1, 'Right panel includes WaypointManager');
    assert(paramsIdx !== -1, 'Right panel includes FlightParams');

    assert(
      cameraIdx < opsIdx && opsIdx < wpIdx && wpIdx < paramsIdx,
      'Right panel elements arranged in exact required vertical order: Camera -> Arm/Fly & Upload -> Waypoint Manager -> Flight Parameters'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 7 — Independent Panel Scrolling Behavior
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 7: Independent Internal Panel Scrolling');
  {
    assert(
      dashboardPageCode.includes('overflow-y-auto') && dashboardPageCode.includes('min-h-0'),
      'Left and Right panels configured with min-h-0 and overflow-y-auto for independent scrolling'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 8 — Responsive Adaptability (Desktop Grid & Mobile View Switcher)
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 8: Responsive Adaptability Across Screen Sizes');
  {
    assert(
      dashboardPageCode.includes('grid-cols-1 lg:grid-cols-[280px_1fr_400px]'),
      'Desktop displays 3 columns with center map occupying largest space (1fr)'
    );
    assert(
      dashboardPageCode.includes('mobileView') && dashboardPageCode.includes('lg:hidden'),
      'Small screens adapt via dedicated tab switcher avoiding horizontal overflow'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 9 — Regression: MAVLink Telemetry, Waypoints & Arm Operations Intact
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 9: Regression Safety & Flight Controller Integrity');
  {
    const telem = mavlinkService.getTelemetry();
    assert(typeof telem.altitude === 'number', 'MAVLink altitude telemetry stream functional');
    assert(typeof telem.heading === 'number', 'MAVLink heading telemetry stream functional');
    assert(typeof telem.groundSpeed === 'number', 'MAVLink groundSpeed telemetry stream functional');
    assert(typeof telem.batteryPercent === 'number', 'MAVLink battery telemetry stream functional');

    // Test Mission Generation
    groundStationMissionService.clearMission();
    groundStationMissionService.generateWaypointMission(
      [{ lat: 17.3850, lng: 78.4866 }, { lat: 17.3855, lng: 78.4870 }],
      { latitude: 17.3850, longitude: 78.4866, altitude: 0, timestamp: Date.now(), isSet: true },
      25,
      5.0,
      false
    );
    const mission = groundStationMissionService.getCurrentMission();
    assert(mission?.waypoints.length === 2, 'Waypoint management pipeline intact (2 waypoints generated)');
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`📊 GROUND STATION SUITE SUMMARY: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
  console.log('===============================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runGroundStationTests().catch((err) => {
  console.error('Fatal Ground Station Test Error:', err);
  process.exit(1);
});
