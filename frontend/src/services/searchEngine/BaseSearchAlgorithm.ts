import { LatLngPoint, SearchBoundaryConfig } from '../../types/mission';
import {
  CameraParameters,
  GroundFootprint,
  SearchPathResult,
  SearchWaypoint,
  SearchAlgorithmId
} from './types';

export const DEFAULT_CAMERA_PARAMS: CameraParameters = {
  fovHorizontalDeg: 70.0,
  fovVerticalDeg: 52.0,
  aspectRatio: 16 / 9
};

export abstract class BaseSearchAlgorithm {
  public abstract readonly id: SearchAlgorithmId;
  public abstract readonly name: string;
  public abstract readonly description: string;

  /**
   * Calculate exact optical ground footprint for a given altitude and camera parameters.
   * Ground Width = 2 * Altitude * tan(HFOV / 2)
   * Ground Height = 2 * Altitude * tan(VFOV / 2)
   * Effective Lane Spacing = Ground Width * (1 - Overlap / 100)
   */
  public calculateGroundCoverage(
    altitudeMeters: number,
    cameraParams: CameraParameters = DEFAULT_CAMERA_PARAMS,
    overlapPercent: number = 25
  ): GroundFootprint {
    const clampedAlt = Math.max(1, altitudeMeters);
    const hFovRad = (cameraParams.fovHorizontalDeg * Math.PI) / 180;
    const vFovRad = (cameraParams.fovVerticalDeg * Math.PI) / 180;

    const widthMeters = 2 * clampedAlt * Math.tan(hFovRad / 2);
    const heightMeters = 2 * clampedAlt * Math.tan(vFovRad / 2);
    const areaSquareMeters = widthMeters * heightMeters;

    const clampedOverlap = Math.max(5, Math.min(60, overlapPercent));
    const effectiveLaneSpacingMeters = Math.max(1.5, widthMeters * (1 - clampedOverlap / 100));

    // Optional Ground Sample Distance (GSD) based on 1080p sensor
    const gsdCmPerPixel = (widthMeters / 1920) * 100;

    return {
      widthMeters,
      heightMeters,
      areaSquareMeters,
      effectiveLaneSpacingMeters,
      gsdCmPerPixel
    };
  }

  /**
   * Generate executable search waypoints inside the boundary
   */
  public abstract generateSearchPath(
    boundary: SearchBoundaryConfig,
    altitudeMeters: number,
    flightSpeedMs: number,
    cameraParams?: CameraParameters,
    overlapPercent?: number
  ): SearchPathResult;

  // --- GEOMETRIC & GPS HELPER UTILITIES ---

  public static metersToLatLng(ref: LatLngPoint, dxMeters: number, dyMeters: number): LatLngPoint {
    const earthRadius = 6378137;
    const dLat = (dyMeters / earthRadius) * (180 / Math.PI);
    const dLon = (dxMeters / (earthRadius * Math.cos((ref.lat * Math.PI) / 180))) * (180 / Math.PI);
    return {
      lat: ref.lat + dLat,
      lng: ref.lng + dLon
    };
  }

  public static latLngToMeters(ref: LatLngPoint, target: LatLngPoint): { x: number; y: number } {
    const earthRadius = 6378137;
    const dLat = ((target.lat - ref.lat) * Math.PI) / 180;
    const dLon = ((target.lng - ref.lng) * Math.PI) / 180;
    const y = dLat * earthRadius;
    const x = dLon * earthRadius * Math.cos((ref.lat * Math.PI) / 180);
    return { x, y };
  }

  public static getDistanceMeters(p1: LatLngPoint, p2: LatLngPoint): number {
    const m = BaseSearchAlgorithm.latLngToMeters(p1, p2);
    return Math.hypot(m.x, m.y);
  }

  public static isPointInPolygon(
    pt: { x: number; y: number },
    poly: Array<{ x: number; y: number }>
  ): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        yi = poly[i].y;
      const xj = poly[j].x,
        yj = poly[j].y;
      const intersect =
        yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  public static calculatePolygonAreaMeters(coords: LatLngPoint[]): number {
    if (!coords || coords.length < 3) return 0;
    const ref = coords[0];
    const pts = coords.map((c) => BaseSearchAlgorithm.latLngToMeters(ref, c));
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y;
      area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
  }

  public static getPolygonCentroid(coords: LatLngPoint[]): LatLngPoint {
    if (!coords || coords.length === 0) return { lat: 12.9715987, lng: 77.5945627 };
    let sumLat = 0;
    let sumLng = 0;
    coords.forEach((c) => {
      sumLat += c.lat;
      sumLng += c.lng;
    });
    return {
      lat: sumLat / coords.length,
      lng: sumLng / coords.length
    };
  }
}
