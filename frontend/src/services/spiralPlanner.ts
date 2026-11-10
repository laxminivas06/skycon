/**
 * Archimedean Spiral Mission Planner (Requirement R4)
 * Baseline Specification: Technical Project Report Rev 2.4.0-PROD
 *
 * Implements exact Archimedean spiral search trajectory calculations:
 * 1. Optical ground footprint:
 *    W_footprint = 2 * H * tan(HFOV / 2)
 *    H_footprint = 2 * H * tan(VFOV / 2)
 *    at nominal cruise altitude H = 5.0 m (PILOT_TKOFF_ALT = 500)
 *    and default camera HFOV = 68.0°, VFOV = 54.0°.
 *
 * 2. Effective lane spacing & spiral pitch constant:
 *    effectiveWidth = W_footprint * (1 - Overlap) (default Overlap = 0.25)
 *    b = (W_footprint * (1 - Overlap)) / (2 * pi)
 *
 * 3. Continuous trajectory equation:
 *    r(theta) = a + b * theta
 *    clamped to R_max = R_zone - FENCE_MARGIN (default 20.0m - 2.0m = 18.0m)
 *
 * 4. Polar to WGS84 Geodetic mapping around seed GPS (Lat0, Lon0).
 *
 * 5. MAVLink MISSION_ITEM_INT (msg #73) mission serialization:
 *    - Seq 0: Home position (cmd 16, frame 0, current 1)
 *    - Seq 1: Takeoff to 5.0m (cmd 22, frame 3, param7 = 5.0m)
 *    - Seq 2..N: Spiral search waypoints (cmd 16, frame 3, acceptance radius 1.5m, lat/lon * 1e7)
 *    - Seq N+1: RTL (cmd 20, frame 3, alt 15.0m matching RTL_ALT = 1500)
 */

import { MavlinkMissionItem } from './mavlinkService';

export interface SpiralPlannerConfig {
  /** Center seed latitude in decimal degrees */
  seedLat: number;
  /** Center seed longitude in decimal degrees */
  seedLon: number;
  /** Flight cruise altitude above ground level in meters (default 5.0m per PILOT_TKOFF_ALT = 500) */
  altitudeMeters?: number;
  /** Camera horizontal field of view in degrees (default 68.0°) */
  hfovDeg?: number;
  /** Camera vertical field of view in degrees (default 54.0°) */
  vfovDeg?: number;
  /** Optical lane overlap fraction between 0.0 and 0.8 (default 0.25 for 25% overlap) */
  overlap?: number;
  /** Search zone outer radius in meters (default 20.0m matching field geofence) */
  zoneRadiusMeters?: number;
  /** Geofence safety margin buffer in meters (default 2.0m per FENCE_MARGIN = 2.0) */
  fenceMarginMeters?: number;
  /** Initial radial offset from center seed in meters (default 0.5m) */
  initialRadiusMeters?: number;
  /** Angular step increment in radians (default pi / 6 = 30° for 12 waypoints per full revolution) */
  angularStepRad?: number;
  /** Waypoint acceptance radius in meters (default 1.5m matching WPNAV_RADIUS = 150 cm) */
  acceptanceRadiusMeters?: number;
  /** RTL altitude in meters (default 15.0m matching RTL_ALT = 1500 cm) */
  rtlAltitudeMeters?: number;
  /** Direction of spiral expansion: 'CW' (clockwise) or 'CCW' (counter-clockwise) (default 'CW') */
  direction?: 'CW' | 'CCW';
}

export interface SpiralFootprintDerivation {
  altitudeMeters: number;
  hfovDeg: number;
  vfovDeg: number;
  overlap: number;
  widthFootprintMeters: number;
  heightFootprintMeters: number;
  effectiveLaneSpacingMeters: number;
  pitchConstantB: number;
  maxRadiusMeters: number;
  totalRevolutions: number;
  waypointCount: number;
}

export interface SpiralWaypoint {
  seq: number;
  lat: number;
  lon: number;
  altMeters: number;
  radiusMeters: number;
  thetaRad: number;
  thetaDeg: number;
  localEastMeters: number;
  localNorthMeters: number;
  command: number;
  commandName: string;
}

/**
 * Standard MAVLink MISSION_ITEM_INT (Message #73) wire-compatible structure
 */
export interface MavlinkMissionItemInt {
  seq: number;
  command: number;
  frame: number;
  current: number;
  autocontinue: number;
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  x: number; // Latitude scaled * 1e7 as int32
  y: number; // Longitude scaled * 1e7 as int32
  z: number; // Altitude in meters (float)
  mission_type?: number;
}

export interface SpiralMissionPlan {
  derivation: SpiralFootprintDerivation;
  waypoints: SpiralWaypoint[];
  mavlinkItems: MavlinkMissionItem[];
  missionItemInts: MavlinkMissionItemInt[];
  totalDistanceMeters: number;
  estimatedFlightTimeSeconds: number;
}

// WGS84 Constants
const WGS84_A = 6378137.0; // Semi-major axis in meters

/**
 * Computes optical ground footprint width:
 * W_footprint = 2 * H * tan(HFOV / 2)
 */
export function calculateFootprintWidth(altitudeMeters: number, hfovDeg: number): number {
  const hfovRad = (hfovDeg * Math.PI) / 180.0;
  return 2.0 * altitudeMeters * Math.tan(hfovRad / 2.0);
}

/**
 * Computes optical ground footprint height:
 * H_footprint = 2 * H * tan(VFOV / 2)
 */
export function calculateFootprintHeight(altitudeMeters: number, vfovDeg: number): number {
  const vfovRad = (vfovDeg * Math.PI) / 180.0;
  return 2.0 * altitudeMeters * Math.tan(vfovRad / 2.0);
}

/**
 * Computes the Archimedean spiral pitch constant:
 * b = (W_footprint * (1 - Overlap)) / (2 * pi)
 */
export function calculateSpiralPitchConstant(footprintWidthMeters: number, overlap: number = 0.25): number {
  const effectiveSpacing = footprintWidthMeters * (1.0 - overlap);
  return effectiveSpacing / (2.0 * Math.PI);
}

/**
 * Converts local Cartesian metric offset (East, North) to WGS84 coordinates relative to a seed point.
 */
export function localOffsetToWgs84(
  seedLat: number,
  seedLon: number,
  eastMeters: number,
  northMeters: number
): { lat: number; lon: number } {
  const dLat = (northMeters / WGS84_A) * (180.0 / Math.PI);
  const latRad = (seedLat * Math.PI) / 180.0;
  const dLon = (eastMeters / (WGS84_A * Math.cos(latRad))) * (180.0 / Math.PI);

  return {
    lat: +(seedLat + dLat).toFixed(7),
    lon: +(seedLon + dLon).toFixed(7)
  };
}

/**
 * Converts WGS84 coordinates to local Cartesian metric offset (East, North) relative to a seed point.
 */
export function wgs84ToLocalOffset(
  seedLat: number,
  seedLon: number,
  targetLat: number,
  targetLon: number
): { eastMeters: number; northMeters: number } {
  const latRad = (seedLat * Math.PI) / 180.0;
  const northMeters = ((targetLat - seedLat) * Math.PI / 180.0) * WGS84_A;
  const eastMeters = ((targetLon - seedLon) * Math.PI / 180.0) * WGS84_A * Math.cos(latRad);

  return {
    eastMeters: +eastMeters.toFixed(3),
    northMeters: +northMeters.toFixed(3)
  };
}

/**
 * Generates the complete Archimedean spiral search plan according to Requirement R4.
 */
export function planArchimedeanSpiral(config: SpiralPlannerConfig): SpiralMissionPlan {
  const seedLat = config.seedLat;
  const seedLon = config.seedLon;
  const altitude = config.altitudeMeters ?? 5.0; // PILOT_TKOFF_ALT = 500
  const hfov = config.hfovDeg ?? 68.0;
  const vfov = config.vfovDeg ?? 54.0;
  const overlap = config.overlap ?? 0.25;
  const zoneRadius = config.zoneRadiusMeters ?? 20.0;
  const fenceMargin = config.fenceMarginMeters ?? 2.0; // FENCE_MARGIN = 2.0
  const a = config.initialRadiusMeters ?? 0.5;
  const angularStep = config.angularStepRad ?? (Math.PI / 6.0); // 30° step
  const acceptanceRadius = config.acceptanceRadiusMeters ?? 1.5; // WPNAV_RADIUS = 150 cm
  const rtlAlt = config.rtlAltitudeMeters ?? 15.0; // RTL_ALT = 1500 cm
  const directionSign = config.direction === 'CCW' ? 1.0 : -1.0;

  // 1. Optical footprint derivation
  const wFootprint = calculateFootprintWidth(altitude, hfov);
  const hFootprint = calculateFootprintHeight(altitude, vfov);
  const effectiveLaneSpacing = wFootprint * (1.0 - overlap);
  const b = calculateSpiralPitchConstant(wFootprint, overlap);

  // 2. Trajectory boundaries
  const maxRadius = Math.max(a, zoneRadius - fenceMargin); // 18.0m default
  const thetaMax = (maxRadius - a) / b;
  const totalRevolutions = +(thetaMax / (2.0 * Math.PI)).toFixed(2);

  // 3. Generate waypoints
  const waypoints: SpiralWaypoint[] = [];
  let seqCounter = 0;

  // Seq 0: Home / Center Position (MAV_CMD_NAV_WAYPOINT = 16)
  waypoints.push({
    seq: seqCounter++,
    lat: seedLat,
    lon: seedLon,
    altMeters: 0.0,
    radiusMeters: 0.0,
    thetaRad: 0.0,
    thetaDeg: 0.0,
    localEastMeters: 0.0,
    localNorthMeters: 0.0,
    command: 16,
    commandName: 'MAV_CMD_NAV_WAYPOINT (Home)'
  });

  // Seq 1: Vertical Takeoff to Cruise Altitude (MAV_CMD_NAV_TAKEOFF = 22)
  waypoints.push({
    seq: seqCounter++,
    lat: seedLat,
    lon: seedLon,
    altMeters: altitude,
    radiusMeters: 0.0,
    thetaRad: 0.0,
    thetaDeg: 0.0,
    localEastMeters: 0.0,
    localNorthMeters: 0.0,
    command: 22,
    commandName: 'MAV_CMD_NAV_TAKEOFF'
  });

  // Seq 2..N: Archimedean Spiral Search Waypoints
  let theta = 0.0;
  while (true) {
    const rawR = a + b * theta;
    const clampedR = Math.min(rawR, maxRadius);

    // Polar to local Cartesian
    // Direction determines angle progression: standard CW starts East and heads South/West
    const effectiveAngle = directionSign * theta;
    const east = +(clampedR * Math.cos(effectiveAngle)).toFixed(3);
    const north = +(clampedR * Math.sin(effectiveAngle)).toFixed(3);

    const coords = localOffsetToWgs84(seedLat, seedLon, east, north);

    waypoints.push({
      seq: seqCounter++,
      lat: coords.lat,
      lon: coords.lon,
      altMeters: altitude,
      radiusMeters: +clampedR.toFixed(3),
      thetaRad: +theta.toFixed(4),
      thetaDeg: +((theta * 180.0) / Math.PI).toFixed(1),
      localEastMeters: east,
      localNorthMeters: north,
      command: 16,
      commandName: 'MAV_CMD_NAV_WAYPOINT'
    });

    if (rawR >= maxRadius) {
      break;
    }

    theta += angularStep;
  }

  // Seq N+1: Return To Launch (MAV_CMD_NAV_RETURN_TO_LAUNCH = 20)
  waypoints.push({
    seq: seqCounter++,
    lat: seedLat,
    lon: seedLon,
    altMeters: rtlAlt,
    radiusMeters: 0.0,
    thetaRad: 0.0,
    thetaDeg: 0.0,
    localEastMeters: 0.0,
    localNorthMeters: 0.0,
    command: 20,
    commandName: 'MAV_CMD_NAV_RETURN_TO_LAUNCH'
  });

  // 4. Calculate total flight path distance
  let totalDistanceMeters = 0.0;
  for (let i = 2; i < waypoints.length - 1; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dx = curr.localEastMeters - prev.localEastMeters;
    const dy = curr.localNorthMeters - prev.localNorthMeters;
    totalDistanceMeters += Math.sqrt(dx * dx + dy * dy);
  }
  // Add takeoff vertical climb and final return leg
  totalDistanceMeters += altitude;
  const lastSpiral = waypoints[waypoints.length - 2];
  totalDistanceMeters += Math.sqrt(lastSpiral.localEastMeters ** 2 + lastSpiral.localNorthMeters ** 2);

  // Default WPNAV_SPEED = 400 (4.0 m/s)
  const estimatedFlightTimeSeconds = +(totalDistanceMeters / 4.0).toFixed(1);

  // 5. Serialize into MavlinkMissionItem[] for mavlinkService
  const mavlinkItems: MavlinkMissionItem[] = waypoints.map((wp, idx) => {
    if (idx === 0) {
      // Seq 0: Home Position
      return {
        seq: 0,
        lat: wp.lat,
        lon: wp.lon,
        alt: 0.0,
        command: 16, // MAV_CMD_NAV_WAYPOINT
        frame: 0,    // MAV_FRAME_GLOBAL
        current: 1,  // Current home
        autocontinue: 1,
        param1: 0.0,
        param2: 0.0,
        param3: 0.0,
        param4: 0.0,
        mission_type: 0
      };
    } else if (idx === 1) {
      // Seq 1: Takeoff
      return {
        seq: 1,
        lat: wp.lat,
        lon: wp.lon,
        alt: altitude,
        command: 22, // MAV_CMD_NAV_TAKEOFF
        frame: 3,    // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
        current: 0,
        autocontinue: 1,
        param1: 0.0,
        param2: 0.0,
        param3: 0.0,
        param4: 0.0,
        mission_type: 0
      };
    } else if (idx === waypoints.length - 1) {
      // Seq N+1: Return to Launch
      return {
        seq: idx,
        lat: wp.lat,
        lon: wp.lon,
        alt: rtlAlt,
        command: 20, // MAV_CMD_NAV_RETURN_TO_LAUNCH
        frame: 3,    // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
        current: 0,
        autocontinue: 1,
        param1: 0.0,
        param2: 0.0,
        param3: 0.0,
        param4: 0.0,
        mission_type: 0
      };
    } else {
      // Seq 2..N: Spiral Waypoints
      return {
        seq: idx,
        lat: wp.lat,
        lon: wp.lon,
        alt: altitude,
        command: 16, // MAV_CMD_NAV_WAYPOINT
        frame: 3,    // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
        current: 0,
        autocontinue: 1,
        param1: 0.0,              // Hold time (sec)
        param2: acceptanceRadius, // Acceptance radius (1.5m matching WPNAV_RADIUS = 150)
        param3: 0.0,              // Pass through radius
        param4: 0.0,              // Yaw heading
        mission_type: 0
      };
    }
  });

  // 6. Serialize into wire-level MavlinkMissionItemInt structures
  const missionItemInts: MavlinkMissionItemInt[] = mavlinkItems.map((item, idx) => ({
    seq: item.seq ?? idx,
    command: item.command ?? 16,
    frame: item.frame ?? 3,
    current: item.current ?? 0,
    autocontinue: item.autocontinue ?? 1,
    param1: item.param1 ?? 0.0,
    param2: item.param2 ?? (item.command === 16 && idx > 1 ? acceptanceRadius : 0.0),
    param3: item.param3 ?? 0.0,
    param4: item.param4 ?? 0.0,
    x: Math.round(item.lat * 1e7),
    y: Math.round(item.lon * 1e7),
    z: item.alt,
    mission_type: item.mission_type ?? 0
  }));

  const derivation: SpiralFootprintDerivation = {
    altitudeMeters: altitude,
    hfovDeg: hfov,
    vfovDeg: vfov,
    overlap,
    widthFootprintMeters: +wFootprint.toFixed(3),
    heightFootprintMeters: +hFootprint.toFixed(3),
    effectiveLaneSpacingMeters: +effectiveLaneSpacing.toFixed(3),
    pitchConstantB: +b.toFixed(4),
    maxRadiusMeters: +maxRadius.toFixed(2),
    totalRevolutions,
    waypointCount: waypoints.length
  };

  return {
    derivation,
    waypoints,
    mavlinkItems,
    missionItemInts,
    totalDistanceMeters: +totalDistanceMeters.toFixed(1),
    estimatedFlightTimeSeconds
  };
}

/**
 * Encodes a MAVLink MISSION_ITEM_INT (Message #73) wire-format binary payload (38 bytes, Little Endian).
 *
 * Wire payload offset layout:
 * - 0..3:   param1 (float)
 * - 4..7:   param2 (float)
 * - 8..11:  param3 (float)
 * - 12..15: param4 (float)
 * - 16..19: x (int32, lat * 1e7)
 * - 20..23: y (int32, lon * 1e7)
 * - 24..27: z (float, alt in meters)
 * - 28..29: seq (uint16)
 * - 30..31: command (uint16)
 * - 32:     target_system (uint8)
 * - 33:     target_component (uint8)
 * - 34:     frame (uint8)
 * - 35:     current (uint8)
 * - 36:     autocontinue (uint8)
 * - 37:     mission_type (uint8, optional in v1, standard in v2)
 */
export function encodeMissionItemIntPayload(
  item: MavlinkMissionItemInt,
  targetSysId: number = 1,
  targetCompId: number = 1
): Uint8Array {
  const buffer = new ArrayBuffer(38);
  const view = new DataView(buffer);

  view.setFloat32(0, item.param1, true);
  view.setFloat32(4, item.param2, true);
  view.setFloat32(8, item.param3, true);
  view.setFloat32(12, item.param4, true);
  view.setInt32(16, item.x, true);
  view.setInt32(20, item.y, true);
  view.setFloat32(24, item.z, true);
  view.setUint16(28, item.seq, true);
  view.setUint16(30, item.command, true);
  view.setUint8(32, targetSysId);
  view.setUint8(33, targetCompId);
  view.setUint8(34, item.frame);
  view.setUint8(35, item.current);
  view.setUint8(36, item.autocontinue);
  view.setUint8(37, item.mission_type ?? 0);

  return new Uint8Array(buffer);
}

/**
 * Uploads an Archimedean spiral mission to the flight controller using the provided MAVLink service instance.
 */
export async function uploadArchimedeanSpiralMission(
  config: SpiralPlannerConfig,
  mavlinkSvc: { uploadMissionWaypoints: (items: MavlinkMissionItem[], retry?: boolean, onProgress?: (s: string, c: number, t: number) => void) => Promise<{ success: boolean; message: string }> },
  onProgress?: (stage: string, current: number, total: number) => void
): Promise<{ success: boolean; message: string; plan: SpiralMissionPlan }> {
  const plan = planArchimedeanSpiral(config);
  const result = await mavlinkSvc.uploadMissionWaypoints(plan.mavlinkItems, true, onProgress);
  return {
    success: result.success,
    message: result.message,
    plan
  };
}

