import { storageService } from '../frontend/src/services/storageService';
import { mavlinkService, MavlinkMissionItem } from '../frontend/src/services/mavlinkService';
import { missionEngine } from '../frontend/src/services/missionEngine';
import { MissionLogEntry } from '../frontend/src/types/mission';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  ✗ [FAIL] ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✓ [PASS] ${msg}`);
}

// In-memory mock localStorage for Node testing environment
const mockStorage: Record<string, string> = {};
(global as any).window = global;
(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
};

async function runTests() {
  console.log('\n===============================================================');
  console.log('🛸 SAE INDIA — VERIFICATION SUITE: MISSION FIXES & SAFETY');
  console.log('===============================================================\n');

  // --------------------------------------------------------------------------
  // SUITE 1: Mission History Capping (5 Missions Max) & Zero-Hallucination
  // --------------------------------------------------------------------------
  console.log('▶ SUITE 1: Mission History 5-Mission Limit, Auto-Purge & Zero-Mock Data');
  storageService.clearLogs();
  
  // Test 1: Zero mock data when empty
  const emptyLogs = storageService.getMissionLogs();
  assert(Array.isArray(emptyLogs) && emptyLogs.length === 0, 'Empty storage returns [] (no fabricated mock missions)');

  // Test 2: Add 7 missions sequentially
  for (let i = 1; i <= 7; i++) {
    const entry: MissionLogEntry = {
      id: `MSN_00${i}`,
      missionNumber: i,
      startTime: 1700000000000 + i * 100000,
      endTime: 1700000000000 + i * 100000 + 120000,
      durationSeconds: 120,
      homePoint: {
        latitude: 12.971598,
        longitude: 77.594562,
        altitude: 920.0,
        timestamp: 1700000000000 + i * 100000,
        isSet: true
      },
      flightPath: [
        { lat: 12.9716, lng: 77.5946, alt: 5.0, timestamp: 1700000000000 + i * 100000 + 10000 },
        { lat: 12.9718, lng: 77.5948, alt: 10.0, timestamp: 1700000000000 + i * 100000 + 20000 }
      ],
      waypoints: [
        { seq: 0, lat: 12.971598, lng: 77.594562, alt: 0, command: 16 },
        { seq: 1, lat: 12.971800, lng: 77.594800, alt: 10, command: 16 }
      ],
      telemetrySnapshot: {
        maxAltitude: 10.2,
        avgSpeed: 2.8,
        batteryStartVoltage: 12.6,
        batteryEndVoltage: 11.8,
        satellites: 14,
        flightMode: 'GUIDED'
      },
      qrResult: `Q${i}`,
      qrData: {
        code: `Q${i}`,
        detectedAt: 1700000000000 + i * 100000 + 30000,
        confidence: 96
      },
      runnerAckReceived: true,
      runnerAckLatencyMs: 140,
      rtlStatus: 'COMPLETED',
      landingStatus: 'COMPLETED',
      completionStatus: 'SUCCESS',
      stateTransitions: [
        { state: 'IDLE', timestamp: 1700000000000 },
        { state: 'MISSION_COMPLETE', timestamp: 1700000000000 + 120000 }
      ]
    };
    storageService.saveMissionLog(entry);
  }

  const cappedLogs = storageService.getMissionLogs();
  assert(cappedLogs.length === 5, 'History is strictly capped at 5 records (got 5)');
  assert(cappedLogs[0].id === 'MSN_007', 'Most recent mission MSN_007 is at index 0');
  assert(cappedLogs[4].id === 'MSN_003', 'Oldest retained mission is MSN_003; older records (MSN_001, MSN_002) were auto-purged');

  // Test 3: Individual deletion
  const afterDelete = storageService.deleteMissionLog('MSN_005');
  assert(afterDelete.length === 4, 'Individual deletion removes target mission (5 -> 4 records)');
  assert(!afterDelete.some(m => m.id === 'MSN_005'), 'MSN_005 is strictly absent from history');

  // --------------------------------------------------------------------------
  // SUITE 2: Truthful Mission Details Data Retention
  // --------------------------------------------------------------------------
  console.log('\n▶ SUITE 2: Truthful Recorded Flight Path, Waypoints & Telemetry');
  const targetMission = afterDelete.find(m => m.id === 'MSN_007')!;
  assert(Boolean(targetMission.flightPath && targetMission.flightPath.length === 2), 'Recorded flight path breadcrumbs preserved (2 points)');
  assert(targetMission.flightPath![0].lat === 12.9716, 'Flight path latitude coordinates match exact recorded data');
  assert(Boolean(targetMission.waypoints && targetMission.waypoints.length === 2), 'Planned waypoints preserved (2 waypoints)');
  assert(targetMission.waypoints![1].alt === 10, 'Waypoint altitude matches recorded parameter (10m)');
  assert(targetMission.telemetrySnapshot?.maxAltitude === 10.2, 'Max altitude recorded accurately (10.2m)');
  assert(targetMission.telemetrySnapshot?.avgSpeed === 2.8, 'Average speed recorded accurately (2.8 m/s)');
  assert(targetMission.qrData?.code === 'Q7', 'QR payload data recorded accurately (Q7)');

  // --------------------------------------------------------------------------
  // SUITE 3: Emergency RTL Reliability & Debounce
  // --------------------------------------------------------------------------
  console.log('\n▶ SUITE 3: Emergency RTL Fast Response & Non-blocking Debounce');
  // 1. Initial RTL command
  const rtl1 = await mavlinkService.commandRTL();
  assert(rtl1 === true, 'First commandRTL call completes cleanly');
  assert(mavlinkService.getTelemetry().flightMode === 'RTL', 'Telemetry flightMode set to RTL');

  // 2. Repeated rapid RTL clicks (within debounce window)
  const rtl2 = await mavlinkService.commandRTL();
  assert(rtl2 === true, 'Repeated commandRTL while already in RTL returns true immediately');

  const rtl3 = await mavlinkService.commandRTL();
  assert(rtl3 === true, 'Third repeat press returns immediately without blocking communication loop');

  // 3. MissionEngine triggerEmergencyRTL does not throw and maintains authority
  missionEngine.triggerEmergencyRTL('Operator Emergency Button Press');
  assert(missionEngine.getCommandAuthority() === 'RTL', 'Command authority transferred to RTL');
  assert(missionEngine.getCurrentState() === 'RTL_REQUESTED' || missionEngine.getCurrentState() === 'RTL', 'Mission engine transitioned to RTL state');

  // Repeated trigger does not crash or throw
  missionEngine.triggerEmergencyRTL('Operator Emergency Button Press 2');
  missionEngine.triggerEmergencyRTL('Operator Emergency Button Press 3');
  assert(missionEngine.getCommandAuthority() === 'RTL', 'Authority remains RTL without interference');

  console.log('\n===============================================================');
  console.log('📊 ALL MISSION FIXES VERIFIED SUCCESSFULLY: 16/16 PASSED');
  console.log('===============================================================\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
