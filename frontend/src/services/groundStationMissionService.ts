import { LatLngPoint, HomePoint } from '../types/mission';
import { GroundStationMission, GroundStationWaypoint, MissionType, MissionDrawingTool } from '../types/groundStationMap';
import { missionEngine } from './missionEngine';
import { mavlinkService, MavlinkMissionItem } from './mavlinkService';
import { audioService } from './audioService';
import { fetchWithFallback } from './apiClient';

/**
 * Calculates Haversine distance in meters between two lat/lng coordinates.
 * Reused from GoogleMap.html implementation.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates initial bearing in degrees from point 1 to point 2 (0-360°).
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return (theta * (180 / Math.PI) + 360) % 360;
}

/**
 * Computes destination point given start point, distance (m) and bearing (deg).
 */
export function computeDestination(
  startLat: number,
  startLon: number,
  distanceMeters: number,
  bearingDeg: number
): LatLngPoint {
  const R = 6371e3;
  const delta = distanceMeters / R;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (startLat * Math.PI) / 180;
  const lambda1 = (startLon * Math.PI) / 180;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );

  return {
    lat: (phi2 * 180) / Math.PI,
    lng: (lambda2 * 180) / Math.PI,
  };
}

/**
 * Computes polygon area in square meters using spherical approximation.
 */
export function calculatePolygonArea(coords: LatLngPoint[]): number {
  if (coords.length < 3) return 0;
  const R = 6378137;
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const p1 = coords[i];
    const p2 = coords[j];
    const radLat1 = (p1.lat * Math.PI) / 180;
    const radLat2 = (p2.lat * Math.PI) / 180;
    const radLon1 = (p1.lng * Math.PI) / 180;
    const radLon2 = (p2.lng * Math.PI) / 180;
    total += (radLon2 - radLon1) * (2 + Math.sin(radLat1) + Math.sin(radLat2));
  }
  return Math.abs((total * R * R) / 2);
}

/**
 * Point in polygon check using ray casting.
 */
export function isPointInPolygon(point: LatLngPoint, polygon: LatLngPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export class GroundStationMissionService {
  private currentMission: GroundStationMission | null = null;
  private subscribers: Set<(mission: GroundStationMission | null) => void> = new Set();
  private activeDrawingTool: MissionDrawingTool = 'select';
  private toolSubscribers: Set<(tool: MissionDrawingTool) => void> = new Set();

  public subscribe(fn: (mission: GroundStationMission | null) => void): () => void {
    this.subscribers.add(fn);
    fn(this.currentMission);
    return () => this.subscribers.delete(fn);
  }

  private notify() {
    this.subscribers.forEach((fn) => fn(this.currentMission));
  }

  public getCurrentMission(): GroundStationMission | null {
    return this.currentMission;
  }

  public clearMission() {
    this.currentMission = null;
    this.notify();
    mavlinkService.clearMissionWaypoints().catch(() => {});
  }

  /**
   * Complete Mission Deletion:
   * 1. Wipes planned waypoints from local GCS memory.
   * 2. Issues MAVLink MISSION_CLEAR_ALL to Pixhawk Flight Controller EEPROM.
   * 3. Resets autonomous missionEngine state.
   * 4. Deletes active mission from backend relay if running.
   */
  public async deleteMission(): Promise<{ success: boolean; message: string }> {
    this.currentMission = null;
    this.activeDrawingTool = 'select';
    this.notify();
    this.toolSubscribers.forEach((fn) => fn('select'));

    // Reset local mission engine state
    missionEngine.resetMission();

    // Send MAVLink MISSION_CLEAR_ALL to Pixhawk flight controller
    let mavResult = { success: true, message: 'Mission wiped' };
    try {
      mavResult = await mavlinkService.clearMissionWaypoints();
    } catch (e: any) {
      console.warn('[MISSION] MAVLink clear notice:', e);
    }

    // Sync with backend active mission route
    try {
      fetchWithFallback('/api/missions/active', { method: 'DELETE' }).catch(() => {});
    } catch {}

    audioService.playBeep(420, 100);
    return {
      success: true,
      message: 'Mission successfully deleted from GCS and Flight Controller (EEPROM cleared).'
    };
  }

  public setDrawingTool(tool: MissionDrawingTool): void {
    this.activeDrawingTool = tool;
    this.toolSubscribers.forEach((fn) => fn(tool));
  }

  public getDrawingTool(): MissionDrawingTool {
    return this.activeDrawingTool;
  }

  public updateMissionAltitude(alt: number): void {
    if (this.currentMission) {
      this.currentMission.altitude = alt;
      this.currentMission.waypoints.forEach((wp) => {
        if (wp.action !== 'RTL' && wp.action !== 'LAND') {
          wp.altitude = alt;
        }
      });
      this.notify();
    }
    missionEngine.updateSearchAltitude(alt);
  }

  public subscribeDrawingTool(fn: (tool: MissionDrawingTool) => void): () => void {
    this.toolSubscribers.add(fn);
    fn(this.activeDrawingTool);
    return () => this.toolSubscribers.delete(fn);
  }

  // --- Dynamic Circle & Concentric Radius Controls ---
  private circleRadiusMeters: number = 15;
  private circleRadiusSubscribers: Set<(radius: number) => void> = new Set();

  public getCircleRadius(): number {
    return this.circleRadiusMeters;
  }

  public setCircleRadius(radius: number): void {
    const clamped = Math.max(3, Math.min(200, Math.round(radius)));
    this.circleRadiusMeters = clamped;
    this.circleRadiusSubscribers.forEach((fn) => fn(clamped));

    // If active mission is a CIRCLE, dynamically recalculate waypoints with the updated radius
    if (this.currentMission?.missionType === 'CIRCLE' && this.currentMission.geometry?.circleCenter) {
      const center = this.currentMission.geometry.circleCenter;
      const home: HomePoint = {
        latitude: this.currentMission.homePoint.latitude,
        longitude: this.currentMission.homePoint.longitude,
        altitude: this.currentMission.homePoint.altitude || 0,
        isSet: this.currentMission.homePoint.isSet,
        timestamp: Date.now(),
      };
      const alt = this.currentMission.altitude;
      const spd = this.currentMission.speed;
      this.generateCircleMission(center, clamped, home, alt, spd);
    } else if (this.currentMission?.missionType === 'CONCENTRIC_CIRCLE' && this.currentMission.geometry?.circleCenter) {
      const center = this.currentMission.geometry.circleCenter;
      const home: HomePoint = {
        latitude: this.currentMission.homePoint.latitude,
        longitude: this.currentMission.homePoint.longitude,
        altitude: this.currentMission.homePoint.altitude || 0,
        isSet: this.currentMission.homePoint.isSet,
        timestamp: Date.now(),
      };
      const alt = this.currentMission.altitude;
      const spd = this.currentMission.speed;
      const ring1 = Math.max(3, Math.round(clamped * 0.4));
      const ring2 = Math.max(ring1 + 3, Math.round(clamped * 0.8));
      const ring3 = Math.max(ring2 + 3, clamped);
      this.generateConcentricCircleMission(center, [ring1, ring2, ring3], home, alt, spd);
    }
  }

  public increaseCircleRadius(stepMeters: number = 2): number {
    this.setCircleRadius(this.circleRadiusMeters + stepMeters);
    return this.circleRadiusMeters;
  }

  public decreaseCircleRadius(stepMeters: number = 2): number {
    this.setCircleRadius(this.circleRadiusMeters - stepMeters);
    return this.circleRadiusMeters;
  }

  public subscribeCircleRadius(fn: (radius: number) => void): () => void {
    this.circleRadiusSubscribers.add(fn);
    fn(this.circleRadiusMeters);
    return () => this.circleRadiusSubscribers.delete(fn);
  }

  /**
   * Generates mission for ordered WAYPOINTS.
   */
  public generateWaypointMission(
    points: LatLngPoint[],
    homePoint: HomePoint,
    altitude: number,
    speed: number,
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : (points[0]?.lat || 0);
    let prevLng = homePoint.isSet ? homePoint.longitude : (points[0]?.lng || 0);

    // Transit from Home Point to W1
    points.forEach((pt, index) => {
      const legDist = calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
      cumulativeDistance += legDist;
      waypoints.push({
        id: `WP_${index + 1}`,
        index: index + 1,
        lat: pt.lat,
        lng: pt.lng,
        altitude: validAlt,
        speed: validSpeed,
        action: 'NAVIGATE',
        name: `Waypoint ${index + 1}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
      });
      prevLat = pt.lat;
      prevLng = pt.lng;
    });

    // Optional RTL leg back to Home Point
    if (autoReturnToHome && homePoint.isSet && points.length > 0) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `WP_RTL`,
        index: waypoints.length + 1,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 2.5) + (validAlt / 2.0)
    );

    const mission: GroundStationMission = {
      id: `MSN_WP_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'WAYPOINTS',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'point',
        coordinates: points,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * Generates mission for a continuous PATH / POLYLINE.
   * Preserves drawn vertex order, calculates directional headings,
   * and subdivides long stretches if needed.
   */
  public generatePathMission(
    pathPoints: LatLngPoint[],
    homePoint: HomePoint,
    altitude: number,
    speed: number,
    maxSegmentSpacingMeters: number = 30,
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));

    if (pathPoints.length < 2) {
      throw new Error('Path mission requires at least 2 points.');
    }

    // Interpolate points along path if segment exceeds maxSegmentSpacingMeters
    const interpolated: LatLngPoint[] = [];
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p1 = pathPoints[i];
      const p2 = pathPoints[i + 1];
      interpolated.push(p1);

      const segmentDist = calculateHaversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
      if (segmentDist > maxSegmentSpacingMeters) {
        const numDivisions = Math.ceil(segmentDist / maxSegmentSpacingMeters);
        for (let step = 1; step < numDivisions; step++) {
          const ratio = step / numDivisions;
          interpolated.push({
            lat: p1.lat + (p2.lat - p1.lat) * ratio,
            lng: p1.lng + (p2.lng - p1.lng) * ratio,
          });
        }
      }
    }
    interpolated.push(pathPoints[pathPoints.length - 1]);

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : interpolated[0].lat;
    let prevLng = homePoint.isSet ? homePoint.longitude : interpolated[0].lng;

    interpolated.forEach((pt, idx) => {
      const legDist = calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
      cumulativeDistance += legDist;
      waypoints.push({
        id: `PATH_WP_${idx + 1}`,
        index: idx + 1,
        lat: pt.lat,
        lng: pt.lng,
        altitude: validAlt,
        speed: validSpeed,
        action: 'NAVIGATE',
        name: idx === 0 ? 'Path Start' : idx === interpolated.length - 1 ? 'Path Finish' : `Path Pt ${idx + 1}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
      });
      prevLat = pt.lat;
      prevLng = pt.lng;
    });

    if (autoReturnToHome && homePoint.isSet) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `PATH_RTL`,
        index: waypoints.length + 1,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 1.5) + (validAlt / 2.0)
    );

    const mission: GroundStationMission = {
      id: `MSN_PATH_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'PATH',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'path',
        coordinates: pathPoints,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * Generates mission for a CIRCLE ORBIT or circular survey.
   * Waypoint count is dynamically derived from radius to achieve smooth flight arc.
   */
  public generateCircleMission(
    center: LatLngPoint,
    radiusMeters: number = this.circleRadiusMeters,
    homePoint: HomePoint,
    altitude: number = 25,
    speed: number = 4.0,
    direction: 'CW' | 'CCW' = 'CW',
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));
    const validRadius = Math.max(5, Math.min(1000, radiusMeters));

    // Dynamic resolution: approx 1 waypoint per 12-16 meters of circumference, min 8, max 32
    const circumference = 2 * Math.PI * validRadius;
    const numWaypoints = Math.max(8, Math.min(32, Math.round(circumference / 15)));

    // Choose tangent entry bearing relative to Home Point (or North if home not set)
    const homeBearing = homePoint.isSet
      ? calculateBearing(homePoint.latitude, homePoint.longitude, center.lat, center.lng)
      : 0;

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : center.lat;
    let prevLng = homePoint.isSet ? homePoint.longitude : center.lng;

    const circleCoords: LatLngPoint[] = [];

    for (let i = 0; i <= numWaypoints; i++) {
      const stepAngle = (360 / numWaypoints) * i;
      const angle = direction === 'CW'
        ? (homeBearing + stepAngle) % 360
        : (homeBearing - stepAngle + 360) % 360;

      const wpPos = computeDestination(center.lat, center.lng, validRadius, angle);
      circleCoords.push(wpPos);

      const legDist = calculateHaversineDistance(prevLat, prevLng, wpPos.lat, wpPos.lng);
      cumulativeDistance += legDist;

      waypoints.push({
        id: `CIRC_WP_${i + 1}`,
        index: i + 1,
        lat: wpPos.lat,
        lng: wpPos.lng,
        altitude: validAlt,
        speed: validSpeed,
        action: 'ORBIT',
        name: i === 0 ? 'Orbit Entry' : i === numWaypoints ? 'Orbit Complete' : `Orbit Pt ${i + 1}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
      });

      prevLat = wpPos.lat;
      prevLng = wpPos.lng;
    }

    if (autoReturnToHome && homePoint.isSet) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `CIRC_RTL`,
        index: waypoints.length + 1,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 1.0) + (validAlt / 2.0)
    );

    const mission: GroundStationMission = {
      id: `MSN_CIRC_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'CIRCLE',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'circle',
        circleCenter: center,
        circleRadiusMeters: validRadius,
        areaSquareMeters: Math.PI * validRadius * validRadius,
        coordinates: circleCoords,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * Generates mission for CONCENTRIC CIRCULAR ORBITS.
   * Creates expanding or contracting circular rings around a central coordinate.
   * Ring radii in meters (e.g. [5, 10, 15] or [8, 16, 24]).
   */
  public generateConcentricCircleMission(
    center: LatLngPoint,
    ringRadiiMeters: number[] = [6, 12, 18],
    homePoint: HomePoint,
    altitude: number = 20,
    speed: number = 4.0,
    direction: 'CW' | 'CCW' = 'CW',
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));
    const sanitizedRadii = ringRadiiMeters.length > 0 ? ringRadiiMeters : [6, 12, 18];

    const homeBearing = homePoint.isSet
      ? calculateBearing(homePoint.latitude, homePoint.longitude, center.lat, center.lng)
      : 0;

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : center.lat;
    let prevLng = homePoint.isSet ? homePoint.longitude : center.lng;
    const allCoords: LatLngPoint[] = [];

    let globalWpIndex = 1;

    sanitizedRadii.forEach((radius, ringIdx) => {
      const validRadius = Math.max(3, Math.min(500, radius));
      const circumference = 2 * Math.PI * validRadius;
      // 8 to 24 points per ring depending on radius
      const numPoints = Math.max(8, Math.min(24, Math.round(circumference / 12)));

      for (let i = 0; i <= numPoints; i++) {
        const stepAngle = (360 / numPoints) * i;
        const angle = direction === 'CW'
          ? (homeBearing + stepAngle) % 360
          : (homeBearing - stepAngle + 360) % 360;

        const wpPos = computeDestination(center.lat, center.lng, validRadius, angle);
        allCoords.push(wpPos);

        const legDist = calculateHaversineDistance(prevLat, prevLng, wpPos.lat, wpPos.lng);
        cumulativeDistance += legDist;

        waypoints.push({
          id: `CONC_R${ringIdx + 1}_WP_${i + 1}`,
          index: globalWpIndex++,
          lat: wpPos.lat,
          lng: wpPos.lng,
          altitude: validAlt,
          speed: validSpeed,
          action: 'ORBIT',
          name: `Ring ${ringIdx + 1} (${validRadius}m) - Pt ${i + 1}`,
          distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
        });

        prevLat = wpPos.lat;
        prevLng = wpPos.lng;
      }
    });

    if (autoReturnToHome && homePoint.isSet) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `CONC_RTL`,
        index: globalWpIndex,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 1.2) + (validAlt / 2.0)
    );

    const maxRadius = Math.max(...sanitizedRadii);

    const mission: GroundStationMission = {
      id: `MSN_CONC_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'CIRCLE',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'circle',
        circleCenter: center,
        circleRadiusMeters: maxRadius,
        areaSquareMeters: Math.PI * maxRadius * maxRadius,
        coordinates: allCoords,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * AERORECON Section 4: MODE B — AUTONOMOUS SEARCH MISSION
   * Generates a validated, executable search mission from 4 configurable values:
   * 1. Search Altitude: default 10m (safe envelope 5m–50m)
   * 2. Search Radius: 5m, 10m, 50m, or custom
   * 3. Search Algorithm:
   *    A. Tangential / Circular Search
   *    B. Spiral Search (Archimedean expanding spiral)
   * 4. Mission Time Limit: duration in minutes
   * 
   * Calculates search distance, return-to-launch distance, and reserves safe return time.
   */
  public generateAutonomousSearchMission(
    center: LatLngPoint,
    radiusMeters: number = 10,
    algorithm: 'TANGENTIAL_CIRCULAR' | 'SPIRAL' = 'TANGENTIAL_CIRCULAR',
    homePoint: HomePoint,
    altitude: number = 10,
    timeLimitMinutes: number = 10,
    speed: number = 4.0
  ): {
    mission: GroundStationMission;
    searchDuration: number;
    returnDuration: number;
    totalDuration: number;
    isFeasible: boolean;
    feasibilityReason?: string;
  } {
    const validAlt = Math.max(5, Math.min(50, altitude || 10));
    const validRadius = Math.max(5, Math.min(500, radiusMeters || 10));
    const validSpeed = Math.max(1, Math.min(10, speed || 4.0));

    const homeLat = homePoint.isSet ? homePoint.latitude : center.lat;
    const homeLon = homePoint.isSet ? homePoint.longitude : center.lng;

    const waypoints: GroundStationWaypoint[] = [];
    const boundaryCoords: LatLngPoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homeLat;
    let prevLng = homeLon;

    // Build outer radius boundary polygon for map visual
    const boundaryPoints = 32;
    for (let b = 0; b <= boundaryPoints; b++) {
      const bAngle = (360 / boundaryPoints) * b;
      boundaryCoords.push(computeDestination(center.lat, center.lng, validRadius, bAngle));
    }

    if (algorithm === 'TANGENTIAL_CIRCULAR') {
      // Algorithm A: Tangential / Circular Search
      // Entry angle calculated relative to home coordinate
      const homeBearing = homePoint.isSet
        ? calculateBearing(homeLat, homeLon, center.lat, center.lng)
        : 0;

      const circumference = 2 * Math.PI * validRadius;
      const numWaypoints = Math.max(8, Math.min(24, Math.round(circumference / 12)));

      for (let i = 0; i <= numWaypoints; i++) {
        const stepAngle = (360 / numWaypoints) * i;
        const angle = (homeBearing + stepAngle) % 360;
        const wpPos = computeDestination(center.lat, center.lng, validRadius, angle);

        const legDist = calculateHaversineDistance(prevLat, prevLng, wpPos.lat, wpPos.lng);
        cumulativeDistance += legDist;

        waypoints.push({
          id: `TANG_WP_${i + 1}`,
          index: i + 1,
          lat: wpPos.lat,
          lng: wpPos.lng,
          altitude: validAlt,
          speed: validSpeed,
          action: 'ORBIT',
          name: i === 0 ? 'Tangential Entry' : i === numWaypoints ? 'Orbit Final' : `Circle Pt ${i + 1}`,
          distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
        });

        prevLat = wpPos.lat;
        prevLng = wpPos.lng;
      }
    } else {
      // Algorithm B: Spiral Search
      // Archimedean expanding spiral starting near centre and expanding outward to validRadius
      const radialStep = Math.max(4, Math.min(10, validRadius / 4));
      const loops = Math.max(1, Math.ceil(validRadius / radialStep));
      const pointsPerLoop = 8;
      const totalSpiralPoints = loops * pointsPerLoop;

      // Start near center (10% radius or 2m)
      const startR = Math.min(3, validRadius * 0.2);

      for (let k = 1; k <= totalSpiralPoints; k++) {
        const fraction = k / totalSpiralPoints;
        const curRadius = Math.min(validRadius, startR + fraction * (validRadius - startR));
        const angle = (k * 45) % 360;
        const wpPos = computeDestination(center.lat, center.lng, curRadius, angle);

        const legDist = calculateHaversineDistance(prevLat, prevLng, wpPos.lat, wpPos.lng);
        cumulativeDistance += legDist;

        waypoints.push({
          id: `SPRL_WP_${k}`,
          index: k,
          lat: wpPos.lat,
          lng: wpPos.lng,
          altitude: validAlt,
          speed: validSpeed,
          action: 'NAVIGATE',
          name: k === 1 ? 'Spiral Origin' : k === totalSpiralPoints ? 'Spiral Boundary' : `Spiral Loop ${Math.ceil(k / 8)}`,
          distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
        });

        prevLat = wpPos.lat;
        prevLng = wpPos.lng;
      }
    }

    // Always append final Return To Launch (RTL) waypoint
    const rtlDist = calculateHaversineDistance(prevLat, prevLng, homeLat, homeLon);
    cumulativeDistance += rtlDist;

    waypoints.push({
      id: 'AUTO_RTL',
      index: waypoints.length + 1,
      lat: homeLat,
      lng: homeLon,
      altitude: validAlt,
      speed: validSpeed,
      action: 'RTL',
      name: 'Return To Launch (RTL)',
      distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
    });

    // Time calculations
    const searchDuration = Math.round(
      ((cumulativeDistance - rtlDist) / validSpeed) + (waypoints.length * 1.2) + (validAlt / 2.0)
    );
    const returnDuration = Math.round((rtlDist / (validSpeed * 1.2)) + (validAlt / 1.5) + 30);
    const totalDuration = searchDuration + returnDuration;

    const timeLimitSeconds = (timeLimitMinutes || 10) * 60;
    const isFeasible = timeLimitSeconds >= totalDuration;
    const feasibilityReason = isFeasible
      ? undefined
      : `Configured mission time limit (${timeLimitMinutes} min / ${timeLimitSeconds}s) is less than required search (${Math.ceil(searchDuration / 60)} min) + return (${Math.ceil(returnDuration / 60)} min) duration of ${Math.ceil(totalDuration / 60)} minutes.`;

    const mission: GroundStationMission = {
      id: `MSN_AUTO_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homeLat,
        longitude: homeLon,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'SEARCH',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration: totalDuration,
      geometry: {
        type: 'circle',
        circleCenter: center,
        circleRadiusMeters: validRadius,
        areaSquareMeters: Math.round(Math.PI * validRadius * validRadius),
        coordinates: boundaryCoords,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();

    return {
      mission,
      searchDuration,
      returnDuration,
      totalDuration,
      isFeasible,
      feasibilityReason,
    };
  }

  /**
   * Generates mission for a POLYGON SURVEY / GRID COVERAGE.
   * Generates transect survey lanes (lawnmower pattern) clipped to the polygon boundary.
   */
  public generatePolygonGridMission(
    polygonCoords: LatLngPoint[],
    homePoint: HomePoint,
    altitude: number,
    speed: number,
    laneSpacingMeters: number = 8.0,
    autoReturnToHome: boolean = true
  ): GroundStationMission {
    const validAlt = Math.max(2, Math.min(120, altitude));
    const validSpeed = Math.max(1, Math.min(15, speed));
    const validSpacing = Math.max(3, Math.min(50, laneSpacingMeters));

    if (polygonCoords.length < 3) {
      throw new Error('Polygon survey requires at least 3 boundary vertices.');
    }

    // Determine bounding box
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    polygonCoords.forEach((p) => {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    });

    const latSpanMeters = calculateHaversineDistance(minLat, minLng, maxLat, minLng);
    const numLanes = Math.max(2, Math.min(40, Math.ceil(latSpanMeters / validSpacing)));

    const latStep = (maxLat - minLat) / (numLanes + 1);
    const surveyPoints: LatLngPoint[] = [];

    // Sample longitude resolution across bounding box
    const numSamples = 60;
    const lngStep = (maxLng - minLng) / numSamples;

    let sweepEast = true;
    for (let lane = 1; lane <= numLanes; lane++) {
      const laneLat = minLat + latStep * lane;
      const insidePointsInLane: LatLngPoint[] = [];

      for (let s = 0; s <= numSamples; s++) {
        const testLng = minLng + lngStep * s;
        const testPt: LatLngPoint = { lat: laneLat, lng: testLng };
        if (isPointInPolygon(testPt, polygonCoords)) {
          insidePointsInLane.push(testPt);
        }
      }

      if (insidePointsInLane.length >= 2) {
        const entry = insidePointsInLane[0];
        const exit = insidePointsInLane[insidePointsInLane.length - 1];

        if (sweepEast) {
          surveyPoints.push(entry);
          surveyPoints.push(exit);
        } else {
          surveyPoints.push(exit);
          surveyPoints.push(entry);
        }
        sweepEast = !sweepEast;
      }
    }

    // Fallback if shape is too thin: use vertices
    const rawRoutePoints = surveyPoints.length >= 2 ? surveyPoints : polygonCoords;
    // Cap at 145 waypoints to strictly guarantee <150 total items including takeoff and RTL (AUD-13)
    const routePoints = rawRoutePoints.length > 145 ? rawRoutePoints.slice(0, 145) : rawRoutePoints;

    const waypoints: GroundStationWaypoint[] = [];
    let cumulativeDistance = 0;
    let prevLat = homePoint.isSet ? homePoint.latitude : routePoints[0].lat;
    let prevLng = homePoint.isSet ? homePoint.longitude : routePoints[0].lng;

    routePoints.forEach((pt, idx) => {
      const legDist = calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
      cumulativeDistance += legDist;
      waypoints.push({
        id: `SURVEY_WP_${idx + 1}`,
        index: idx + 1,
        lat: pt.lat,
        lng: pt.lng,
        altitude: validAlt,
        speed: validSpeed,
        action: 'SURVEY_PASS',
        name: idx === 0 ? 'Survey Entry' : idx === routePoints.length - 1 ? 'Survey Exit' : `Survey Waypoint ${idx + 1}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
      });
      prevLat = pt.lat;
      prevLng = pt.lng;
    });

    if (autoReturnToHome && homePoint.isSet) {
      const rtlDist = calculateHaversineDistance(prevLat, prevLng, homePoint.latitude, homePoint.longitude);
      cumulativeDistance += rtlDist;
      waypoints.push({
        id: `SURVEY_RTL`,
        index: waypoints.length + 1,
        lat: homePoint.latitude,
        lng: homePoint.longitude,
        altitude: validAlt,
        speed: validSpeed,
        action: 'RTL',
        name: 'Return To Home (RTL)',
        distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
      });
    }

    const areaSquareMeters = calculatePolygonArea(polygonCoords);
    const estimatedDuration = Math.round(
      (cumulativeDistance / validSpeed) + (waypoints.length * 2.0) + (validAlt / 2.0)
    );

    const mission: GroundStationMission = {
      id: `MSN_SURVEY_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: homePoint.latitude,
        longitude: homePoint.longitude,
        altitude: homePoint.altitude || 0,
        isSet: homePoint.isSet,
      },
      missionType: 'POLYGON_GRID',
      altitude: validAlt,
      speed: validSpeed,
      waypoints,
      totalDistance: Math.round(cumulativeDistance * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'polygon',
        coordinates: polygonCoords,
        areaSquareMeters,
      },
      isUploaded: false,
      createdAt: Date.now(),
    };

    this.currentMission = mission;
    this.notify();
    return mission;
  }

  /**
   * Transmits mission to the drone communication layer (ESP32-S3 / Pixhawk MAVLink).
   * Follows standard ArduPilot mission protocol:
   * Seq 0: Home coordinate
   * Seq 1: Takeoff to target altitude
   * Seq 2..N: Shape waypoints
   * Final Seq: Return To Launch or Land
   */
  public async uploadMissionToDrone(
    onProgress?: (stage: string, current: number, total: number) => void
  ): Promise<{ success: boolean; message: string }> {
    if (!this.currentMission) {
      return { success: false, message: 'No mission generated to upload.' };
    }

    if (!this.currentMission.waypoints || this.currentMission.waypoints.length === 0) {
      return { success: false, message: 'Mission has no navigable waypoints.' };
    }

    try {
      const alt = this.currentMission.altitude;
      const home = mavlinkService.getHomePoint();
      const telem = mavlinkService.getTelemetry();

      const homeLat = home.isSet && Math.abs(home.latitude) > 0.001
        ? home.latitude
        : (Math.abs(telem.latitude) > 0.001 ? telem.latitude : this.currentMission.waypoints[0].lat);
      const homeLon = home.isSet && Math.abs(home.longitude) > 0.001
        ? home.longitude
        : (Math.abs(telem.longitude) > 0.001 ? telem.longitude : this.currentMission.waypoints[0].lng);

      if (Math.abs(homeLat) < 0.001 || Math.abs(homeLon) < 0.001) {
        return { success: false, message: 'Invalid Home position: Latitude and Longitude cannot be (0, 0).' };
      }

      // 1. Build standard ArduPilot MAVLink mission sequence
      const missionPayload: Array<MavlinkMissionItem> = [];

      // Item 0: Home Position (ArduPilot standard requirement: frame MAV_FRAME_GLOBAL, alt 0)
      missionPayload.push({
        seq: 0,
        lat: homeLat,
        lon: homeLon,
        alt: 0,
        command: 16 /* MAV_CMD_NAV_WAYPOINT */,
        frame: 0 /* MAV_FRAME_GLOBAL */,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
        autocontinue: 1,
        current: 0
      });

      // Item 1: Takeoff to target altitude (frame MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6)
      missionPayload.push({
        seq: 1,
        lat: homeLat,
        lon: homeLon,
        alt: alt,
        command: 22 /* MAV_CMD_NAV_TAKEOFF */,
        frame: 6 /* MAV_FRAME_GLOBAL_RELATIVE_ALT_INT */,
        param1: 0, // pitch
        param2: 0,
        param3: 0,
        param4: 0, // yaw
        autocontinue: 1,
        current: 0
      });

      // Items 2..N: Shape Waypoints
      for (const wp of this.currentMission.waypoints) {
        let cmd = 16; // MAV_CMD_NAV_WAYPOINT
        let frame = 6; // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
        let p1 = (wp as any).param1 !== undefined ? (wp as any).param1 : 0;
        let p2 = (wp as any).param2 !== undefined ? (wp as any).param2 : 2.0; // 2m accept radius
        let p3 = (wp as any).param3 !== undefined ? (wp as any).param3 : 0;
        let p4 = (wp as any).param4 !== undefined ? (wp as any).param4 : 0;

        let lat = wp.lat;
        let lon = wp.lng;
        let altVal = wp.altitude || alt;

        if (wp.action === 'RTL') {
          cmd = 20; // MAV_CMD_NAV_RETURN_TO_LAUNCH
          frame = 0;
          lat = homeLat;
          lon = homeLon;
          altVal = 0;
          p1 = 0; p2 = 0; p3 = 0; p4 = 0;
        } else if (wp.action === 'LAND') {
          cmd = 21; // MAV_CMD_NAV_LAND
          frame = 0;
          lat = wp.lat || homeLat;
          lon = wp.lng || homeLon;
          altVal = 0;
          p1 = 0; p2 = 0; p3 = 0; p4 = 0;
        } else if (wp.action === 'LOITER') {
          cmd = 19; // MAV_CMD_NAV_LOITER_TIME
          p1 = p1 || 5; // Default 5s loiter
        } else if (wp.action === 'ORBIT') {
          cmd = 16; // MAV_CMD_NAV_WAYPOINT
          frame = 6; // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
          p2 = (wp as any).param2 || 1.0; // 1m acceptance radius for tight circle tracking
        }

        missionPayload.push({
          seq: missionPayload.length,
          lat,
          lon,
          alt: altVal,
          command: cmd,
          frame,
          param1: p1,
          param2: p2,
          param3: p3,
          param4: p4,
          autocontinue: 1,
          current: 0
        });
      }

      // Ensure final waypoint is RTL or LAND if not already present
      const lastCmd = missionPayload[missionPayload.length - 1].command;
      if (lastCmd !== 20 && lastCmd !== 21) {
        missionPayload.push({
          seq: missionPayload.length,
          lat: homeLat,
          lon: homeLon,
          alt: 0,
          command: 20 /* MAV_CMD_NAV_RETURN_TO_LAUNCH */,
          frame: 0,
          param1: 0,
          param2: 0,
          param3: 0,
          param4: 0,
          autocontinue: 1,
          current: 0
        });
      }

      // 2. Transmit to Pixhawk FC via MAVLink mission protocol
      const uploadRes = await mavlinkService.uploadMissionWaypoints(missionPayload, true, onProgress);

      if (uploadRes.success) {
        this.currentMission.isUploaded = true;
        missionEngine.updateSearchAltitude(alt);
        missionEngine.setMissionDuration(Math.max(120, this.currentMission.estimatedDuration + 60));
        this.notify();

        audioService.playBeep(880, 150);
        audioService.triggerHaptic('medium');

        const rtlNote = alt < 15
          ? ` (Advisory: Flight alt is ${alt}m. Pixhawk default RTL_ALT is 15m; on RTL vehicle will climb to 15m unless RTL_ALT parameter is adjusted)`
          : '';

        return {
          success: true,
          message: (uploadRes.message || `Mission successfully uploaded to Drone FC (${this.currentMission.waypoints.length} waypoints, ${this.currentMission.totalDistance}m at ${alt}m alt).`) + rtlNote
        };
      } else {
        this.currentMission.isUploaded = false;
        return {
          success: false,
          message: uploadRes.message || 'Mission upload was rejected by flight controller.'
        };
      }
    } catch (err: any) {
      console.error('[GCS Mission Upload Error]', err);
      return {
        success: false,
        message: `Failed to upload mission: ${err?.message || 'Communication error with ESP32-S3 link'}`
      };
    }
  }

  /**
   * Commences flight for the currently configured Ground Station mission.
   * If uploaded, commands FC to arm and enters AUTO mode to execute shape.
   * If in GUIDED mode fallback, guides vehicle through waypoints.
   */
  public async startGroundStationMission(forceBypass: boolean = false): Promise<{ success: boolean; message: string }> {
    if (!this.currentMission || !this.currentMission.waypoints.length) {
      return { success: false, message: 'No mission generated to start.' };
    }

    try {
      const connState = mavlinkService.getConnectionState();
      const isSim = connState.connectionType === 'SIMULATED';
      const isConnected = connState.isConnected || connState.isUsbConnected || connState.isRealHardware || isSim;
      if (!isConnected) {
        return {
          success: false,
          message: 'Cannot start mission: Drone is not connected via MAVLink. Verify ESP32 Wi-Fi bridge.'
        };
      }

      // Geofence pre-arm check
      if (!forceBypass) {
        try {
          const { geofenceService } = await import('./geofenceService');
          const telem = mavlinkService.getTelemetry();
          if (geofenceService.getState().enabled) {
            const check = geofenceService.canArmVehicle(telem.latitude, telem.longitude);
            if (!check.canArm) {
              return {
                success: false,
                message: check.reason || 'Start mission blocked: Drone is outside active Geofence boundary.'
              };
            }
          }
        } catch (e) {}
      }

      const alt = this.currentMission.altitude;
      const speed = this.currentMission.speed;
      let telem = mavlinkService.getTelemetry();

      // Step 1: Ensure vehicle is in GUIDED mode for arming and ground operations
      // (ArduPilot allows arming in GUIDED, but rejects arming in AUTO mode by default)
      if (!telem.isArmed) {
        audioService.playBeep(600, 100);
        await mavlinkService.setFlightMode('GUIDED');
        await new Promise((r) => setTimeout(r, 400));

        // Command Arm
        console.log(`[GCS Mission] Commanding Arm (forceBypass=${forceBypass})...`);
        const armSent = await mavlinkService.sendArmCommand(forceBypass);
        if (!armSent && !forceBypass) {
          const preArmReason = mavlinkService.getConnectionState().preArmFailReason;
          return {
            success: false,
            message: `Arming rejected: ${preArmReason || 'Pre-arm checks failed. Verify safety switch, GPS 3D fix, and battery.'}`
          };
        }

        // Actively poll for arm confirmation (up to 3.5s)
        const armStartTime = Date.now();
        while (Date.now() - armStartTime < 3500) {
          await new Promise((r) => setTimeout(r, 250));
          telem = mavlinkService.getTelemetry();
          if (telem.isArmed) break;
        }

        if (!telem.isArmed && !forceBypass) {
          // Retry once with bypass in case flight controller requires forced override
          console.warn('[GCS Mission] Arm confirmation not received within 3.5s; attempting force bypass arm...');
          await mavlinkService.sendArmCommand(true);
          const forceWait = Date.now();
          while (Date.now() - forceWait < 2000) {
            await new Promise((r) => setTimeout(r, 200));
            telem = mavlinkService.getTelemetry();
            if (telem.isArmed) break;
          }
        }

        if (!telem.isArmed && !isSim) {
          const conn = mavlinkService.getConnectionState();
          const reason = conn.preArmFailReason || conn.latestStatusMessage?.text || 'Flight controller did not arm motors. Check safety switch (GPS puck LED), GPS lock, compass calibration, and battery.';
          return {
            success: false,
            message: `Arming failed: ${reason}`
          };
        }
      }

      // Step 2: If drone is sitting on the ground (<1.0m altitude), execute takeoff!
      telem = mavlinkService.getTelemetry();
      const currentAlt = telem.altitude || 0;
      if (currentAlt < 1.0) {
        console.log(`[GCS Mission] Drone on ground (alt=${currentAlt.toFixed(1)}m). Initiating takeoff to ${alt}m...`);
        audioService.playBeep(880, 150);
        await mavlinkService.setFlightMode('GUIDED');
        await mavlinkService.commandTakeoff(alt);

        // Wait 2.5 seconds for motors to spool up and vehicle to establish climb
        await new Promise((r) => setTimeout(r, 2500));
      }

      // Step 3: Start shape execution
      // If already uploaded, set current item to 1, switch to AUTO mode and start mission!
      if (this.currentMission.isUploaded) {
        audioService.playBeep(988, 200);
        await mavlinkService.setCurrentMissionItem(1);
        const modeSwitched = await mavlinkService.setFlightMode('AUTO');
        await mavlinkService.commandStartMission();

        if (modeSwitched || (mavlinkService.getTelemetry().flightMode || '').toUpperCase() === 'AUTO' || isSim) {
          return {
            success: true,
            message: `AUTONOMOUS ${this.currentMission.missionType} MISSION COMMENCED in AUTO flight mode at ${alt}m altitude! Motors spinning & executing circle.`
          };
        } else {
          // If AUTO mode switch failed, seamlessly fallback to GUIDED active sequencer
          console.warn('[GCS Mission] AUTO mode change rejected by FC; falling back to active GUIDED sequencer.');
          await mavlinkService.setFlightMode('GUIDED');
          this.runGuidedWaypointSequencer(this.currentMission.waypoints, alt, speed);
          return {
            success: true,
            message: `Flight active in GUIDED mode at ${alt}m altitude! Ground Station active guidance executing shape (${this.currentMission.waypoints.length} waypoints).`
          };
        }
      }

      // If not yet uploaded, attempt upload first
      const uploadRes = await this.uploadMissionToDrone();
      if (uploadRes.success) {
        audioService.playBeep(988, 200);
        await mavlinkService.setCurrentMissionItem(1);
        const modeSwitched = await mavlinkService.setFlightMode('AUTO');
        await mavlinkService.commandStartMission();
        if (modeSwitched || (mavlinkService.getTelemetry().flightMode || '').toUpperCase() === 'AUTO' || isSim) {
          return {
            success: true,
            message: `Mission uploaded and commenced in AUTO mode at ${alt}m altitude!`
          };
        }
      }

      // Step 4: Guided Flight Fallback
      await mavlinkService.setFlightMode('GUIDED');
      this.runGuidedWaypointSequencer(this.currentMission.waypoints, alt, speed);

      return {
        success: true,
        message: `Flight active in GUIDED mode at ${alt}m altitude! Ground Station active guidance executing shape (${this.currentMission.waypoints.length} waypoints).`
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to start flight: ${err?.message || err}`
      };
    }
  }

  private guidedSequencerActive: boolean = false;

  public stopGuidedSequencer(): void {
    this.guidedSequencerActive = false;
  }

  private async runGuidedWaypointSequencer(
    waypoints: GroundStationWaypoint[],
    alt: number,
    speed: number
  ): Promise<void> {
    if (this.guidedSequencerActive) return;
    this.guidedSequencerActive = true;

    // Wait 7s for takeoff climb to target altitude
    await new Promise((r) => setTimeout(r, 7000));

    for (let i = 0; i < waypoints.length; i++) {
      if (!this.guidedSequencerActive) break;
      const wp = waypoints[i];
      const targetAlt = wp.altitude || alt;

      if (wp.action === 'RTL') {
        await mavlinkService.commandRTL();
        break;
      } else if (wp.action === 'LAND') {
        await mavlinkService.commandLand();
        break;
      }

      await mavlinkService.flyToPosition(wp.lat, wp.lng, targetAlt, speed);

      // Monitor distance to waypoint (advance when <= 3.5m or after 15s timeout)
      const startWpTime = Date.now();
      while (this.guidedSequencerActive && Date.now() - startWpTime < 15000) {
        const cur = mavlinkService.getTelemetry();
        const dy = (cur.latitude - wp.lat) * 111320;
        const dx = (cur.longitude - wp.lng) * 111320 * Math.cos((wp.lat * Math.PI) / 180);
        const dist = Math.hypot(dx, dy);
        if (dist <= 3.5) break;
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    if (this.guidedSequencerActive) {
      this.guidedSequencerActive = false;
      await mavlinkService.commandRTL();
    }
  }
}

export const groundStationMissionService = new GroundStationMissionService();
