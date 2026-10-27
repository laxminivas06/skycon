/**
 * Geofence Coordination Service
 * Manages autonomous geofence boundaries (Circle, Rectangle, Arena, Polygon),
 * altitude ceilings/floors, breach failsafe actions (RTL, LOITER, LAND),
 * real-time telemetry breach monitoring, and MAVLink / Pixhawk synchronization.
 */

import { mavlinkService } from './mavlinkService';
import { audioService } from './audioService';
import { LatLngPoint } from '../types/mission';

export type GeofenceShape = 'ARENA_RECTANGLE' | 'CIRCLE' | 'CUSTOM_POLYGON';
export type GeofenceBreachAction = 'RTL' | 'LOITER' | 'LAND' | 'POSHOLD';
export type GeofenceAnchor = 'HOME' | 'DRONE' | 'CUSTOM';
export type GeofenceLockStatus = 'ACTIVE_ARMED_LOCKED' | 'BREACHED' | 'BYPASSED_OFF';

export interface GeofenceConfig {
  enabled: boolean;
  shape: GeofenceShape;
  radiusMeters: number;          // for CIRCLE
  widthMeters: number;           // for ARENA_RECTANGLE (East-West)
  heightMeters: number;          // for ARENA_RECTANGLE (North-South)
  maxAltitudeMeters: number;     // Ceiling AGL
  minAltitudeMeters: number;     // Floor AGL
  breachAction: GeofenceBreachAction;
  anchorType: GeofenceAnchor;
  customAnchor: LatLngPoint | null;
  customVertices: LatLngPoint[];
}

export interface GeofenceState extends GeofenceConfig {
  isBreached: boolean;
  breachReason: string | null;
  distanceToBoundaryMeters: number | null;
  currentAltitudeMeters: number;
  lastBreachTimestamp: number | null;
  effectiveAnchor: LatLngPoint | null;
  geofenceStatus: GeofenceLockStatus;
}

const STORAGE_KEY = 'cade_geofence_config_v2';

// Standard SAE India ADDC Rule 3.3 Defaults: 50m x 50m Arena, 25m Ceiling, RTL Action
const DEFAULT_CONFIG: GeofenceConfig = {
  enabled: true,
  shape: 'ARENA_RECTANGLE',
  radiusMeters: 50,
  widthMeters: 50,
  heightMeters: 50,
  maxAltitudeMeters: 25.0,
  minAltitudeMeters: 1.5,
  breachAction: 'RTL',
  anchorType: 'HOME',
  customAnchor: null,
  customVertices: [],
};

/**
 * Deterministic even-odd ray-casting algorithm to test whether a GPS point
 * is strictly inside an arbitrary closed polygon.
 */
export function isPointInsideGeofence(lat: number, lon: number, polygon: LatLngPoint[]): boolean {
  if (!polygon || polygon.length < 3) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;

    const intersect = ((yi > lon) !== (yj > lon)) &&
      (lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculates the geometric centroid (average lat/lng) of a polygon.
 */
export function getPolygonCentroid(polygon: LatLngPoint[]): LatLngPoint {
  if (!polygon || polygon.length === 0) return { lat: 12.9715987, lng: 77.5945627 };
  let sumLat = 0;
  let sumLon = 0;
  for (const pt of polygon) {
    sumLat += pt.lat;
    sumLon += pt.lng;
  }
  return {
    lat: sumLat / polygon.length,
    lng: sumLon / polygon.length
  };
}

/**
 * Guaranteed interior anchor for convex and concave polygons alike.
 * If the arithmetic centroid is strictly inside the polygon, returns the centroid.
 * If the arithmetic centroid lies outside (concave L/U-shaped polygon),
 * tests candidate interior midpoints between vertices and picks the interior point
 * with the highest clearance from the perimeter.
 */
export function getSafeInteriorAnchor(polygon: LatLngPoint[]): LatLngPoint {
  if (!polygon || polygon.length === 0) return { lat: 12.9715987, lng: 77.5945627 };
  if (polygon.length < 3) return polygon[0];

  const centroid = getPolygonCentroid(polygon);
  let centroidMinDist = Infinity;
  for (const v of polygon) {
    const d = computeHaversine(centroid.lat, centroid.lng, v.lat, v.lng);
    if (d < centroidMinDist) centroidMinDist = d;
  }

  if (isPointInsideGeofence(centroid.lat, centroid.lng, polygon) && centroidMinDist >= 2.0) {
    return centroid;
  }

  // Centroid lies outside concave polygon or directly on a corner! Search for best interior point
  let bestInteriorPt: LatLngPoint | null = null;
  let maxClearance = -1;

  // 1. Test midpoints between all pairs of vertices
  const candidates: LatLngPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    for (let j = i + 1; j < polygon.length; j++) {
      candidates.push({
        lat: (polygon[i].lat + polygon[j].lat) / 2,
        lng: (polygon[i].lng + polygon[j].lng) / 2
      });
    }
  }

  // 2. Also test bounding box grid sampling
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const dLatStep = (maxLat - minLat) / 8;
  const dLngStep = (maxLng - minLng) / 8;
  for (let r = 1; r < 8; r++) {
    for (let c = 1; c < 8; c++) {
      candidates.push({
        lat: minLat + r * dLatStep,
        lng: minLng + c * dLngStep
      });
    }
  }

  // Evaluate candidate interior points
  for (const cand of candidates) {
    if (isPointInsideGeofence(cand.lat, cand.lng, polygon)) {
      let minDist = Infinity;
      for (const v of polygon) {
        const d = computeHaversine(cand.lat, cand.lng, v.lat, v.lng);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxClearance) {
        maxClearance = minDist;
        bestInteriorPt = cand;
      }
    }
  }

  if (bestInteriorPt) {
    return bestInteriorPt;
  }

  // Fallback: verified first vertex or midpoint
  return polygon[0];
}

/**
 * Clamps a waypoint inside a polygon by vectoring inward toward a guaranteed safe interior anchor
 * by a specified margin in meters if the point is outside or too close to the perimeter.
 */
export function clampWaypointToGeofence(wp: LatLngPoint, polygon: LatLngPoint[], marginMeters: number = 2.0): LatLngPoint {
  if (!polygon || polygon.length < 3) return wp;
  const anchor = getSafeInteriorAnchor(polygon);
  const inside = isPointInsideGeofence(wp.lat, wp.lng, polygon);

  let point = { ...wp };

  if (!inside) {
    // Binary search towards safe interior anchor to find boundary intersection
    let low = 0.0;
    let high = 1.0;
    let clamped = { ...anchor };

    for (let iter = 0; iter < 16; iter++) {
      const mid = (low + high) / 2;
      const testLat = wp.lat + (anchor.lat - wp.lat) * mid;
      const testLng = wp.lng + (anchor.lng - wp.lng) * mid;
      if (isPointInsideGeofence(testLat, testLng, polygon)) {
        clamped = { lat: testLat, lng: testLng };
        high = mid;
      } else {
        low = mid;
      }
    }
    point = clamped;
  }

  // Apply safety buffer inward toward safe interior anchor
  if (marginMeters > 0) {
    const distToCenter = computeHaversine(point.lat, point.lng, anchor.lat, anchor.lng);
    if (distToCenter > marginMeters) {
      const ratio = Math.min(1.0, marginMeters / distToCenter);
      point = {
        lat: point.lat + (anchor.lat - point.lat) * ratio,
        lng: point.lng + (anchor.lng - point.lng) * ratio,
      };
    } else {
      point = { ...anchor };
    }
  }

  return point;
}

// Geodesic destination helper using WGS-84 Earth radius
function computeDestination(lat: number, lon: number, distanceMeters: number, bearingDeg: number): LatLngPoint {
  const R = 6371000;
  const dByR = distanceMeters / R;
  const radBearing = (bearingDeg * Math.PI) / 180;
  const radLat = (lat * Math.PI) / 180;
  const radLon = (lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(radLat) * Math.cos(dByR) +
    Math.cos(radLat) * Math.sin(dByR) * Math.cos(radBearing)
  );
  const lon2 = radLon + Math.atan2(
    Math.sin(radBearing) * Math.sin(dByR) * Math.cos(radLat),
    Math.cos(dByR) - Math.sin(radLat) * Math.sin(lat2)
  );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lon2 * 180) / Math.PI,
  };
}

// Haversine distance in meters
function computeHaversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Point-in-polygon raycasting algorithm supporting both (pt, poly) and (lat, lon, poly)
export function isPointInPolygon(ptOrLat: LatLngPoint | number, polyOrLon: LatLngPoint[] | number, maybePoly?: LatLngPoint[]): boolean {
  let lat: number, lon: number, poly: LatLngPoint[];
  if (typeof ptOrLat === 'number') {
    lat = ptOrLat;
    lon = polyOrLon as number;
    poly = maybePoly || [];
  } else {
    lat = ptOrLat.lat;
    lon = ptOrLat.lng;
    poly = polyOrLon as LatLngPoint[];
  }
  return isPointInsideGeofence(lat, lon, poly);
}

class GeofenceService {
  private config: GeofenceConfig = { ...DEFAULT_CONFIG };
  private state: GeofenceState;
  private listeners: Set<(state: GeofenceState) => void> = new Set();
  private telemetryUnsubscribe: (() => void) | null = null;
  private breachAudioCooldown = 0;
  private autoFailsafeTriggered = false;

  // Debounce & Hysteresis State to prevent GPS jitter and packet flickering
  private consecutiveBreachCount = 0;
  private consecutiveClearCount = 0;
  private pendingBreachReason: string | null = null;
  private hasClimbedAboveFloor = false;

  constructor() {
    this.restoreConfig();
    this.state = {
      ...this.config,
      isBreached: false,
      breachReason: null,
      distanceToBoundaryMeters: null,
      currentAltitudeMeters: 0,
      lastBreachTimestamp: null,
      effectiveAnchor: null,
      geofenceStatus: this.config.enabled ? 'ACTIVE_ARMED_LOCKED' : 'BYPASSED_OFF',
    };
    this.initTelemetry();
  }

  private restoreConfig() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.config = { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  private persistConfig() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {}
  }

  private initTelemetry() {
    this.telemetryUnsubscribe = mavlinkService.subscribeTelemetry((telem) => {
      this.evaluateBreach(telem);
    });
  }

  public getEffectiveAnchor(): LatLngPoint | null {
    if (this.config.anchorType === 'CUSTOM' && this.config.customAnchor) {
      return this.config.customAnchor;
    }
    const home = mavlinkService.getHomePoint();
    if (this.config.anchorType === 'HOME' && home && home.isSet && Math.abs(home.latitude) > 0.001) {
      return { lat: home.latitude, lng: home.longitude };
    }
    const telem = mavlinkService.getTelemetry();
    if (telem && (telem.gps?.isLocked || (telem.gps?.satellites ?? 0) >= 4) && telem.latitude && Math.abs(telem.latitude) > 0.001) {
      return { lat: telem.latitude, lng: telem.longitude };
    }
    if (home && Math.abs(home.latitude) > 0.001) {
      return { lat: home.latitude, lng: home.longitude };
    }
    return null;
  }

  /**
   * Generates polygon vertices for map rendering and breach checks
   */
  public getBoundaryVertices(): LatLngPoint[] {
    if (this.config.shape === 'CUSTOM_POLYGON' && this.config.customVertices && this.config.customVertices.length >= 3) {
      return this.config.customVertices;
    }

    const anchor = this.getEffectiveAnchor();
    if (!anchor) return [];

    if (this.config.shape === 'ARENA_RECTANGLE') {
      const halfW = (this.config.widthMeters || 50) / 2;
      const halfH = (this.config.heightMeters || 50) / 2;
      const diag = Math.sqrt(halfW * halfW + halfH * halfH);
      const angle = (Math.atan2(halfW, halfH) * 180) / Math.PI;

      const p1 = computeDestination(anchor.lat, anchor.lng, diag, angle);
      const p2 = computeDestination(anchor.lat, anchor.lng, diag, 180 - angle);
      const p3 = computeDestination(anchor.lat, anchor.lng, diag, 180 + angle);
      const p4 = computeDestination(anchor.lat, anchor.lng, diag, 360 - angle);
      return [p1, p2, p3, p4];
    }

    if (this.config.shape === 'CIRCLE') {
      const radius = this.config.radiusMeters || 50;
      const segments = 32;
      const vertices: LatLngPoint[] = [];
      for (let i = 0; i < segments; i++) {
        const bearing = (i * 360) / segments;
        vertices.push(computeDestination(anchor.lat, anchor.lng, radius, bearing));
      }
      return vertices;
    }

    return [];
  }

  /**
   * Calculates true metric distance to the perimeter edge.
   * Positive distance = inside boundary; Negative distance = outside boundary.
   */
  private computeHorizontalDistance(dronePt: LatLngPoint, anchor: LatLngPoint): { isBreached: boolean; distToEdge: number } {
    if (this.config.shape === 'CIRCLE') {
      const distFromCenter = computeHaversine(anchor.lat, anchor.lng, dronePt.lat, dronePt.lng);
      const radius = this.config.radiusMeters || 50;
      const distToEdge = +(radius - distFromCenter).toFixed(1);
      return {
        isBreached: distFromCenter > radius,
        distToEdge,
      };
    }

    if (this.config.shape === 'ARENA_RECTANGLE') {
      const radLat = (anchor.lat * Math.PI) / 180;
      const dx = (dronePt.lng - anchor.lng) * 111320 * Math.cos(radLat);
      const dy = (dronePt.lat - anchor.lat) * 111320;
      const hw = (this.config.widthMeters || 50) / 2;
      const hh = (this.config.heightMeters || 50) / 2;

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx <= hw && absDy <= hh) {
        // Drone is strictly inside rectangle: distance to closest edge
        const distToEdge = +(Math.min(hw - absDx, hh - absDy)).toFixed(1);
        return { isBreached: false, distToEdge };
      } else {
        // Drone is outside rectangle: true Euclidean distance outside
        const ox = Math.max(0, absDx - hw);
        const oy = Math.max(0, absDy - hh);
        const distOutside = Math.hypot(ox, oy);
        return { isBreached: true, distToEdge: +(-distOutside).toFixed(1) };
      }
    }

    if (this.config.shape === 'CUSTOM_POLYGON' && this.config.customVertices.length >= 3) {
      const inside = isPointInPolygon(dronePt, this.config.customVertices);
      const distFromCenter = computeHaversine(anchor.lat, anchor.lng, dronePt.lat, dronePt.lng);
      const approxRadius = 50;
      return {
        isBreached: !inside,
        distToEdge: inside ? +(approxRadius - distFromCenter).toFixed(1) : +(-distFromCenter).toFixed(1),
      };
    }

    return { isBreached: false, distToEdge: 0 };
  }

  private evaluateBreach(telem: any) {
    const currentAlt = telem.altitude || telem.altitudeMeters || 0;
    this.state.currentAltitudeMeters = currentAlt;
    const anchor = this.getEffectiveAnchor();
    this.state.effectiveAnchor = anchor;

    // Check GPS validity robustly (has coords and either locked or sufficient satellites)
    const hasCoord = Boolean(telem.latitude && Math.abs(telem.latitude) > 0.001);
    const isGpsLocked = Boolean(
      telem.gps?.isLocked ||
      (telem.gps?.satellites ?? 0) >= 4 ||
      telem.gps?.fixType?.includes('3D') ||
      telem.isGpsValid
    );
    const isGpsValid = hasCoord && isGpsLocked;

    if (!this.config.enabled || !anchor) {
      if (this.state.isBreached) {
        this.state.isBreached = false;
        this.state.breachReason = null;
        this.autoFailsafeTriggered = false;
        this.notify();
      }
      this.consecutiveBreachCount = 0;
      this.consecutiveClearCount = 0;
      return;
    }

    // If GPS packet is momentarily missing on a non-GPS telemetry frame, hold state without flapping
    if (!isGpsValid) {
      if (!telem.isArmed && this.state.isBreached) {
        this.state.isBreached = false;
        this.state.breachReason = null;
        this.autoFailsafeTriggered = false;
        this.notify();
      }
      return;
    }

    const dronePt: LatLngPoint = { lat: telem.latitude, lng: telem.longitude };
    const { isBreached: isHorizontalBreached, distToEdge } = this.computeHorizontalDistance(dronePt, anchor);
    this.state.distanceToBoundaryMeters = distToEdge;

    // Track airborne climb state for floor protection:
    // Floor breach MUST NOT trigger on the ground, during initial arming, or during initial takeoff climb!
    if (!telem.isArmed) {
      this.hasClimbedAboveFloor = false;
    } else if (currentAlt > (this.config.minAltitudeMeters + 0.8)) {
      this.hasClimbedAboveFloor = true;
    }

    // Floor breach applies ONLY when vehicle is confirmed airborne in cruise flight
    const isFloorBreached = Boolean(
      this.config.minAltitudeMeters > 0.5 &&
      telem.isArmed &&
      this.hasClimbedAboveFloor &&
      currentAlt < this.config.minAltitudeMeters &&
      currentAlt > 0.3
    );

    // Ceiling breach with 0.3m hysteresis to prevent oscillation near boundary
    const isCeilingBreached = this.state.isBreached && (this.state.breachReason?.includes('Ceiling') ?? false)
      ? currentAlt > (this.config.maxAltitudeMeters - 0.3)
      : currentAlt > this.config.maxAltitudeMeters;

    const rawBreach = isHorizontalBreached || isCeilingBreached || isFloorBreached;

    if (rawBreach) {
      this.consecutiveClearCount = 0;
      this.consecutiveBreachCount++;

      let reason = '';
      if (isHorizontalBreached) reason = 'Perimeter Boundary Breached';
      else if (isCeilingBreached) reason = `Altitude Ceiling Exceeded (${currentAlt.toFixed(1)}m > ${this.config.maxAltitudeMeters}m)`;
      else if (isFloorBreached) reason = `Floor Altitude Breached (${currentAlt.toFixed(1)}m < ${this.config.minAltitudeMeters}m)`;
      this.pendingBreachReason = reason;

      // Debounce: require 3 consecutive breach samples (~150-300ms) to confirm breach.
      // This eliminates instantaneous GPS coordinate jitter and baro spikes.
      if (this.consecutiveBreachCount >= 3) {
        const wasAlreadyBreached = this.state.isBreached;
        this.state.isBreached = true;
        this.state.breachReason = this.pendingBreachReason;
        this.state.lastBreachTimestamp = Date.now();

        // Trigger audible warning on confirmed breach or every 5 seconds
        if (Date.now() - this.breachAudioCooldown > 5000) {
          this.breachAudioCooldown = Date.now();
          audioService.playRtlAlert();
          audioService.triggerHaptic('warning');
        }

        // Execute autonomous failsafe action ONLY ONCE per breach event if airborne and armed
        if (telem.isArmed && !this.autoFailsafeTriggered && !wasAlreadyBreached) {
          this.autoFailsafeTriggered = true;
          this.executeBreachAction(this.config.breachAction);
        }
      }
    } else {
      this.consecutiveBreachCount = 0;
      this.consecutiveClearCount++;

      // Debounce recovery: require 3 consecutive clean samples before clearing breach state
      if (this.consecutiveClearCount >= 3) {
        if (this.state.isBreached) {
          this.state.isBreached = false;
          this.state.breachReason = null;
          this.autoFailsafeTriggered = false;
        }
      }
    }

    this.notify();
  }

  private async executeBreachAction(action: GeofenceBreachAction) {
    console.warn(`[GEOFENCE FAILSAFE] Executing breach response: ${action}`);
    try {
      if (action === 'RTL') {
        await mavlinkService.setFlightMode('RTL');
      } else if (action === 'LOITER') {
        await mavlinkService.setFlightMode('LOITER');
      } else if (action === 'LAND') {
        await mavlinkService.setFlightMode('LAND');
      } else if (action === 'POSHOLD') {
        await mavlinkService.setFlightMode('POSHOLD');
      }
    } catch (e) {
      console.error('[GEOFENCE] Failed to dispatch breach mode command', e);
    }
  }

  private computeLockStatus(): GeofenceLockStatus {
    if (!this.config.enabled) return 'BYPASSED_OFF';
    if (this.state.isBreached) return 'BREACHED';
    return 'ACTIVE_ARMED_LOCKED';
  }

  public setEnabled(enabled: boolean) {
    this.config.enabled = enabled;
    this.state.enabled = enabled;
    if (!enabled) {
      this.state.isBreached = false;
      this.state.breachReason = null;
      this.autoFailsafeTriggered = false;
      this.consecutiveBreachCount = 0;
      this.consecutiveClearCount = 0;
      this.hasClimbedAboveFloor = false;
    }
    this.persistConfig();
    this.notify();
    try {
      (mavlinkService as any).sendFenceEnable?.(enabled);
    } catch {}
  }

  public setCustomPolygon(vertices: LatLngPoint[]) {
    this.config.shape = 'CUSTOM_POLYGON';
    this.config.customVertices = [...vertices];
    this.state.shape = 'CUSTOM_POLYGON';
    this.state.customVertices = [...vertices];
    if (vertices.length >= 3) {
      const centroid = getPolygonCentroid(vertices);
      this.config.customAnchor = centroid;
      this.state.customAnchor = centroid;
      this.state.effectiveAnchor = centroid;
    }
    this.persistConfig();
    this.notify();
    try {
      (mavlinkService as any).uploadFencePolygon?.(vertices);
    } catch {}
  }

  public setPolygon(vertices: LatLngPoint[]) {
    this.setCustomPolygon(vertices);
  }

  public updateConfig(newConfig: Partial<GeofenceConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.state = { ...this.state, ...this.config };
    this.persistConfig();
    this.notify();
  }

  public resetToADDCDefaults() {
    this.config = { ...DEFAULT_CONFIG };
    this.state = {
      ...this.state,
      ...this.config,
      isBreached: false,
      breachReason: null,
      distanceToBoundaryMeters: null,
      geofenceStatus: 'ACTIVE_ARMED_LOCKED'
    };
    this.autoFailsafeTriggered = false;
    this.consecutiveBreachCount = 0;
    this.consecutiveClearCount = 0;
    this.hasClimbedAboveFloor = false;
    this.persistConfig();
    audioService.playBeep(880, 100);
    this.notify();
  }

  public clearGeofence() {
    this.config.enabled = false;
    this.state.enabled = false;
    this.state.isBreached = false;
    this.state.breachReason = null;
    this.autoFailsafeTriggered = false;
    this.consecutiveBreachCount = 0;
    this.consecutiveClearCount = 0;
    this.hasClimbedAboveFloor = false;
    this.persistConfig();
    audioService.playBeep(450, 80);
    this.notify();
  }

  /**
   * Sets a custom anchor point anywhere (e.g. cricket ground selected on map)
   */
  public setCustomAnchor(lat: number, lng: number) {
    this.config.anchorType = 'CUSTOM';
    this.config.customAnchor = { lat, lng };
    this.state.anchorType = 'CUSTOM';
    this.state.customAnchor = { lat, lng };
    this.state.effectiveAnchor = { lat, lng };
    this.consecutiveBreachCount = 0;
    this.consecutiveClearCount = 0;
    this.persistConfig();
    audioService.playBeep(880, 80);
    this.notify();
  }

  /**
   * Checks whether given coordinate is strictly inside the active geofence.
   * Supports an optional tolerance margin in meters (useful for pre-arm GPS noise).
   */
  public isInsideGeofence(lat: number, lng: number, marginMeters: number = 0): boolean {
    if (!this.config.enabled) return true;
    const anchor = this.getEffectiveAnchor();
    if (!anchor || Math.abs(lat) <= 0.001) return true;

    if (this.config.shape === 'CIRCLE') {
      const dist = computeHaversine(anchor.lat, anchor.lng, lat, lng);
      return dist <= ((this.config.radiusMeters || 50) + marginMeters);
    } else if (this.config.shape === 'ARENA_RECTANGLE') {
      const radLat = (anchor.lat * Math.PI) / 180;
      const dx = (lng - anchor.lng) * 111320 * Math.cos(radLat);
      const dy = (lat - anchor.lat) * 111320;
      const hw = (this.config.widthMeters || 50) / 2 + marginMeters;
      const hh = (this.config.heightMeters || 50) / 2 + marginMeters;
      return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
    } else {
      const vertices = this.getBoundaryVertices();
      if (vertices.length < 3) return true;
      return isPointInsideGeofence(lat, lng, vertices);
    }
  }

  /**
   * Strict Arming Interlock:
   * When geofenceEnabled === true, the drone MUST NOT be allowed to arm
   * if its current live GPS position is outside the drawn polygon or if 3D GPS fix < 6 sats.
   */
  public canArmVehicle(lat?: number, lng?: number): { canArm: boolean; reason?: string } {
    if (!this.config.enabled) return { canArm: true };
    const telem = mavlinkService.getTelemetry();
    const droneLat = lat ?? telem.latitude;
    const droneLng = lng ?? telem.longitude;

    // 1. Check satellite count and 3D fix
    const sats = telem.gps?.satellites ?? (telem as any).satellitesVisible ?? (telem as any).satellites ?? 0;
    const hasFix = Boolean(telem.gps?.isLocked || (telem as any).isGpsValid || sats >= 6);
    if (!hasFix || sats < 6) {
      return {
        canArm: false,
        reason: `ARM BLOCKED: GPS Fix insufficient (${sats} sats < 6) to verify Geofence containment.`
      };
    }

    // 2. Check position inside boundary
    if (droneLat && droneLng && Math.abs(droneLat) > 0.001) {
      const vertices = this.getBoundaryVertices();
      if (vertices.length >= 3) {
        const inside = isPointInsideGeofence(droneLat, droneLng, vertices);
        if (!inside) {
          const centroid = getPolygonCentroid(vertices);
          const distToCenter = computeHaversine(centroid.lat, centroid.lng, droneLat, droneLng);
          return {
            canArm: false,
            reason: `ARM BLOCKED: Drone is outside active Geofence boundary (${distToCenter.toFixed(0)}m from centroid).`
          };
        }
      }
    }
    return { canArm: true };
  }

  public isPointInsideGeofence(lat: number, lon: number, polygon: LatLngPoint[]): boolean {
    return isPointInsideGeofence(lat, lon, polygon);
  }

  public isPointInPolygon(lat: number, lon: number, polygon: LatLngPoint[]): boolean {
    return isPointInsideGeofence(lat, lon, polygon);
  }

  public getSafeInteriorAnchor(polygon: LatLngPoint[]): LatLngPoint {
    return getSafeInteriorAnchor(polygon);
  }

  public clampWaypointToGeofence(latOrPoint: number | LatLngPoint, lonOrPolygon: number | LatLngPoint[], polygonOrMargin?: LatLngPoint[] | number, maybeMargin: number = 2.0): LatLngPoint {
    if (typeof latOrPoint === 'object') {
      return clampWaypointToGeofence(latOrPoint, lonOrPolygon as LatLngPoint[], (polygonOrMargin as number) || 2.0);
    }
    return clampWaypointToGeofence({ lat: latOrPoint, lng: lonOrPolygon as number }, polygonOrMargin as LatLngPoint[], maybeMargin);
  }

  public getDistanceToPerimeter(lat: number, lng: number, polygon: LatLngPoint[]): number {
    if (!polygon || polygon.length === 0) return 0;
    let minDist = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const v = polygon[i];
      const d = computeHaversine(lat, lng, v.lat, v.lng);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  public getState(): GeofenceState {
    this.state.geofenceStatus = this.computeLockStatus();
    return { ...this.state };
  }

  public subscribe(fn: (state: GeofenceState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.state.geofenceStatus = this.computeLockStatus();
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }
}

export const geofenceService = new GeofenceService();
