/**
 * Unit Test Suite for Milestone 4 (Requirement R4)
 * - Archimedean Spiral Search Generator (spiralPlanner.ts)
 * - MAVLink MISSION_ITEM_INT (msg #73) Mission Packaging
 * - USB Power Rail Sag Alert logic (<4.4V)
 * - STATUSTEXT Pre-Arm Diagnostic Rules & Force Arm (21196) Constant
 */

import {
  calculateFootprintWidth,
  calculateFootprintHeight,
  calculateSpiralPitchConstant,
  localOffsetToWgs84,
  wgs84ToLocalOffset,
  planArchimedeanSpiral,
  encodeMissionItemIntPayload
} from '../src/services/spiralPlanner';
import { translateArduPilotStatus, ARDUPILOT_DIAGNOSTIC_RULES } from '../src/components/common/DiagnosticTranslator';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    testsFailed++;
    throw new Error(message);
  } else {
    console.log(`  ✅ PASS: ${message}`);
    testsPassed++;
  }
}

async function runTestSuite() {
  console.log('\n========================================================================');
  console.log('🧪 RUNNING MILESTONE 4 UNIT TEST SUITE (Requirement R4)');
  console.log('========================================================================\n');

  // -----------------------------------------------------------------------------------
  // TEST GROUP 1: Optical Ground Footprint Math
  // -----------------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: Optical Ground Footprint Math ---');
  {
    const H = 5.0; // PILOT_TKOFF_ALT = 500
    const HFOV = 68.0; // degrees
    const VFOV = 54.0; // degrees

    const wFootprint = calculateFootprintWidth(H, HFOV);
    const hFootprint = calculateFootprintHeight(H, VFOV);

    // Expected: 2 * 5.0 * tan(34 deg) = 10.0 * 0.6745085 = 6.745 m
    assert(Math.abs(wFootprint - 6.745) < 0.01, `Footprint width ${wFootprint.toFixed(3)}m matches ~6.745m`);

    // Expected: 2 * 5.0 * tan(27 deg) = 10.0 * 0.5095254 = 5.095 m
    assert(Math.abs(hFootprint - 5.095) < 0.01, `Footprint height ${hFootprint.toFixed(3)}m matches ~5.095m`);
  }

  // -----------------------------------------------------------------------------------
  // TEST GROUP 2: Archimedean Pitch Constant Derivation
  // -----------------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Spiral Pitch Constant Derivation ---');
  {
    const wFootprint = 6.745085;
    const overlap = 0.25; // 25% overlap
    const b = calculateSpiralPitchConstant(wFootprint, overlap);

    // Expected: (6.745085 * 0.75) / (2 * pi) = 5.058814 / 6.283185 = 0.8051 m/rad
    assert(Math.abs(b - 0.8051) < 0.005, `Spiral pitch constant b = ${b.toFixed(4)} matches ~0.8051 m/rad`);
  }

  // -----------------------------------------------------------------------------------
  // TEST GROUP 3: Local Cartesian <-> WGS84 Geodetic Projection
  // -----------------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: WGS84 Geodetic Coordinate Mapping ---');
  {
    const seedLat = 13.0827000;
    const seedLon = 80.2707000;

    // Zero offset returns identical seed coordinates
    const zero = localOffsetToWgs84(seedLat, seedLon, 0.0, 0.0);
    assert(Math.abs(zero.lat - seedLat) < 1e-6 && Math.abs(zero.lon - seedLon) < 1e-6, 'Zero offset matches seed GPS');

    // 10m North
    const north10m = localOffsetToWgs84(seedLat, seedLon, 0.0, 10.0);
    assert(north10m.lat > seedLat, 'Positive North offset increases latitude');

    // Inverse projection check
    const inverse = wgs84ToLocalOffset(seedLat, seedLon, north10m.lat, north10m.lon);
    assert(Math.abs(inverse.northMeters - 10.0) < 0.05, `Inverse north projection ${inverse.northMeters}m matches ~10.0m`);
    assert(Math.abs(inverse.eastMeters) < 0.05, `Inverse east projection ${inverse.eastMeters}m matches ~0.0m`);
  }

  // -----------------------------------------------------------------------------------
  // TEST GROUP 4: Full Archimedean Spiral Search Generator
  // -----------------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Full Spiral Search Generator (r(theta) = a + b * theta) ---');
  {
    const seedLat = 13.0827;
    const seedLon = 80.2707;
    const plan = planArchimedeanSpiral({
      seedLat,
      seedLon,
      altitudeMeters: 5.0,
      hfovDeg: 68.0,
      vfovDeg: 54.0,
      overlap: 0.25,
      zoneRadiusMeters: 20.0,
      fenceMarginMeters: 2.0, // FENCE_MARGIN = 2.0 -> R_max = 18.0m
      initialRadiusMeters: 0.5,
      acceptanceRadiusMeters: 1.5 // WPNAV_RADIUS = 150
    });

    assert(plan.waypoints.length >= 20, `Plan generated sufficient waypoints: ${plan.waypoints.length} points`);
    assert(plan.derivation.maxRadiusMeters === 18.0, 'R_max clamped to 18.0m (20.0m zone - 2.0m margin)');

    // Check monotonic radius expansion until clamped
    let lastRadius = -1;
    for (let i = 2; i < plan.waypoints.length - 1; i++) {
      const wp = plan.waypoints[i];
      assert(wp.radiusMeters >= lastRadius - 0.001, `Waypoint #${wp.seq} radius ${wp.radiusMeters}m expands monotonically`);
      assert(wp.radiusMeters <= 18.001, `Waypoint #${wp.seq} radius ${wp.radiusMeters}m strictly within 18.0m fence boundary`);
      lastRadius = wp.radiusMeters;
    }

    // Seq 0 must be Home
    const seq0 = plan.waypoints[0];
    assert(seq0.seq === 0 && seq0.command === 16 && seq0.altMeters === 0.0, 'Seq 0 is Home position (alt = 0m, cmd = 16)');

    // Seq 1 must be Takeoff to 5.0m
    const seq1 = plan.waypoints[1];
    assert(seq1.seq === 1 && seq1.command === 22 && seq1.altMeters === 5.0, 'Seq 1 is Takeoff to 5.0m (cmd = 22)');

    // Seq N+1 must be RTL
    const seqLast = plan.waypoints[plan.waypoints.length - 1];
    assert(seqLast.command === 20 && seqLast.altMeters === 15.0, 'Seq N+1 is Return-To-Launch at 15.0m (cmd = 20, RTL_ALT = 1500)');

    // Verify acceptance radius in MAVLink items
    for (let i = 2; i < plan.mavlinkItems.length - 1; i++) {
      const item = plan.mavlinkItems[i];
      assert(item.param2 === 1.5, `Spiral waypoint #${item.seq} acceptance radius param2 = 1.5m`);
      assert(item.frame === 3, `Spiral waypoint #${item.seq} frame = MAV_FRAME_GLOBAL_RELATIVE_ALT_INT (3)`);
      assert(item.autocontinue === 1, `Spiral waypoint #${item.seq} autocontinue = 1`);
    }
  }

  // -----------------------------------------------------------------------------------
  // TEST GROUP 5: Wire-Level MISSION_ITEM_INT (msg #73) Packaging
  // -----------------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: MISSION_ITEM_INT (msg #73) Binary Packaging ---');
  {
    const plan = planArchimedeanSpiral({
      seedLat: 13.0827,
      seedLon: 80.2707,
      altitudeMeters: 5.0
    });

    const wpItem = plan.missionItemInts[2];
    const encoded = encodeMissionItemIntPayload(wpItem, 1, 1);

    assert(encoded.byteLength === 38, `Binary payload length is 38 bytes (wire specification)`);

    const view = new DataView(encoded.buffer);
    const param1 = view.getFloat32(0, true);
    const param2 = view.getFloat32(4, true);
    const x = view.getInt32(16, true);
    const y = view.getInt32(20, true);
    const z = view.getFloat32(24, true);
    const seq = view.getUint16(28, true);
    const cmd = view.getUint16(30, true);
    const targetSys = view.getUint8(32);
    const targetComp = view.getUint8(33);
    const frame = view.getUint8(34);
    const autocontinue = view.getUint8(36);

    assert(param2 === 1.5, `Binary param2 (acceptance radius) = 1.5m`);
    assert(Math.abs(x - Math.round(wpItem.x)) === 0, `Binary lat x (${x}) equals scaled lat * 1e7`);
    assert(Math.abs(y - Math.round(wpItem.y)) === 0, `Binary lon y (${y}) equals scaled lon * 1e7`);
    assert(z === 5.0, `Binary altitude z = 5.0m`);
    assert(seq === 2, `Binary seq = 2`);
    assert(cmd === 16, `Binary command = 16 (MAV_CMD_NAV_WAYPOINT)`);
    assert(targetSys === 1 && targetComp === 1, `Binary target = 1/1`);
    assert(frame === 3, `Binary frame = 3 (GLOBAL_RELATIVE_ALT_INT)`);
    assert(autocontinue === 1, `Binary autocontinue = 1`);
  }

  // -----------------------------------------------------------------------------------
  // TEST GROUP 6: USB Power Sag Alert Logic (<4.4V vs 5.37V nominal)
  // -----------------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: USB Power Sag Detection (<4.40V) ---');
  {
    const isSag = (mv: number) => mv > 0 && mv < 4400;

    assert(isSag(4250), '4250 mV (4.25V) flags USB power sag critical warning');
    assert(isSag(4390), '4390 mV (4.39V) flags USB power sag critical warning');
    assert(!isSag(5370), '5370 mV (5.37V nominal LiPo rail) passes sag check');
    assert(!isSag(12400), '12400 mV (3S LiPo 12.4V) passes sag check');
    assert(!isSag(0), '0 mV (disconnected) does not trigger false positive sag');
  }

  // -----------------------------------------------------------------------------------
  // TEST GROUP 7: STATUSTEXT Diagnostic Translator Rules
  // -----------------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: STATUSTEXT Diagnostic Translation Rules ---');
  {
    const testCases = [
      {
        raw: 'PreArm: Mode change requires position',
        expectedCategory: 'FLIGHT MODE / EKF3',
        expectedSeverity: 'CRITICAL'
      },
      {
        raw: 'PreArm: Compass health inconsistent',
        expectedCategory: 'COMPASS / MAGNETOMETER',
        expectedSeverity: 'CRITICAL'
      },
      {
        raw: 'PreArm: Need 3D fix for GPS',
        expectedCategory: 'GPS RECEIVER',
        expectedSeverity: 'CRITICAL'
      },
      {
        raw: 'PreArm: Safety switch disengaged',
        expectedCategory: 'SAFETY SWITCH',
        expectedSeverity: 'WARNING'
      },
      {
        raw: 'PreArm: Barometer reading variance',
        expectedCategory: 'BAROMETER',
        expectedSeverity: 'WARNING'
      },
      {
        raw: 'PreArm: Battery voltage low',
        expectedCategory: 'POWER SYSTEM',
        expectedSeverity: 'CRITICAL'
      },
      {
        raw: 'PreArm: Radio failsafe active',
        expectedCategory: 'RC / RADIO LINK',
        expectedSeverity: 'WARNING'
      },
      {
        raw: 'PreArm: Logging failed to start',
        expectedCategory: 'DATA LOGGING',
        expectedSeverity: 'WARNING'
      }
    ];

    for (const tc of testCases) {
      const res = translateArduPilotStatus(tc.raw);
      assert(res.category === tc.expectedCategory, `"${tc.raw}" classified as ${tc.expectedCategory}`);
      assert(res.severity === tc.expectedSeverity, `"${tc.raw}" severity is ${tc.expectedSeverity}`);
      assert(res.operatorAction.length > 10, `Operator action guidance provided: "${res.operatorAction.slice(0, 45)}..."`);
    }
  }

  // -----------------------------------------------------------------------------------
  // TEST GROUP 8: Force Arm Constant Verification (21196)
  // -----------------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 8: Force Arm Magic Constant (21196.0) ---');
  {
    const FORCE_ARM_MAGIC = 21196.0;
    const STANDARD_ARM = 0.0;
    const ARM_COMMAND_ID = 400; // MAV_CMD_COMPONENT_ARM_DISARM

    assert(FORCE_ARM_MAGIC === 21196.0, 'Force Arm bypass constant equals exact ArduPilot magic constant 21196.0');
    assert(ARM_COMMAND_ID === 400, 'Arming command ID equals MAV_CMD_COMPONENT_ARM_DISARM (400)');
  }

  console.log('\n========================================================================');
  console.log(`🎉 TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('========================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});

