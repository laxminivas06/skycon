import { LatLngPoint, SearchBoundaryConfig } from '../../types/mission';
import { BaseSearchAlgorithm, DEFAULT_CAMERA_PARAMS } from './BaseSearchAlgorithm';
import {
  CameraParameters,
  SearchPathResult,
  SearchWaypoint,
  SearchAlgorithmId
} from './types';

export class GridSearch extends BaseSearchAlgorithm {
  public readonly id: SearchAlgorithmId = 'GRID';
  public readonly name = 'Lawn-Mower / Grid Search';
  public readonly description = 'Parallel serpentine search lanes dynamically calculated from camera FOV and altitude';

  public generateSearchPath(
    boundary: SearchBoundaryConfig,
    altitudeMeters: number,
    flightSpeedMs: number = 3.0,
    cameraParams: CameraParameters = DEFAULT_CAMERA_PARAMS,
    overlapPercent: number = 25
  ): SearchPathResult {
    const coords = boundary.coordinates;
    if (!coords || coords.length < 3) {
      return this.getFallbackEmptyPath(boundary, altitudeMeters);
    }

    const groundFootprint = this.calculateGroundCoverage(
      altitudeMeters,
      cameraParams,
      overlapPercent
    );
    const laneSpacing = groundFootprint.effectiveLaneSpacingMeters;

    const ref = coords[0];
    const localPoly = coords.map((c) => BaseSearchAlgorithm.latLngToMeters(ref, c));

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    localPoly.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const width = maxX - minX;
    const height = maxY - minY;

    // Determine principal scan axis (sweep along shorter dimension for efficiency)
    const sweepAlongY = height >= width;

    const waypoints: SearchWaypoint[] = [];
    let wpCounter = 1;
    let laneIndex = 0;
    let totalDist = 0;

    if (sweepAlongY) {
      // Parallel horizontal passes spaced along Y
      const numLanes = Math.max(2, Math.ceil(height / laneSpacing));
      const actualSpacing = height / (numLanes + 1);

      for (let i = 1; i <= numLanes; i++) {
        const y = minY + i * actualSpacing;
        const isLeftToRight = laneIndex % 2 === 0;

        // Find intersection of y line with polygon segments
        const xIntersections: number[] = [];
        for (let j = 0; j < localPoly.length; j++) {
          const k = (j + 1) % localPoly.length;
          const p1 = localPoly[j];
          const p2 = localPoly[k];

          if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
            const xInt = p1.x + ((y - p1.y) * (p2.x - p1.x)) / (p2.y - p1.y);
            xIntersections.push(xInt);
          }
        }

        xIntersections.sort((a, b) => a - b);

        let startX = minX + groundFootprint.widthMeters * 0.25;
        let endX = maxX - groundFootprint.widthMeters * 0.25;

        if (xIntersections.length >= 2) {
          startX = xIntersections[0] + 1.0;
          endX = xIntersections[xIntersections.length - 1] - 1.0;
        }

        if (startX >= endX) {
          startX = minX + 2.0;
          endX = maxX - 2.0;
        }

        const pStartLocal = isLeftToRight ? { x: startX, y } : { x: endX, y };
        const pEndLocal = isLeftToRight ? { x: endX, y } : { x: startX, y };

        const pStartGps = BaseSearchAlgorithm.metersToLatLng(ref, pStartLocal.x, pStartLocal.y);
        const pEndGps = BaseSearchAlgorithm.metersToLatLng(ref, pEndLocal.x, pEndLocal.y);

        // Turn / Transit Waypoint into Lane
        waypoints.push({
          id: `WP_GRID_${wpCounter++}`,
          lat: pStartGps.lat,
          lng: pStartGps.lng,
          altitudeMeters,
          speedMs: flightSpeedMs,
          action: laneIndex === 0 ? 'TRANSIT' : 'TURN',
          laneIndex
        });

        // Scan Pass Waypoint
        waypoints.push({
          id: `WP_GRID_${wpCounter++}`,
          lat: pEndGps.lat,
          lng: pEndGps.lng,
          altitudeMeters,
          speedMs: flightSpeedMs,
          action: 'SCAN_PASS',
          laneIndex
        });

        laneIndex++;
      }
    } else {
      // Parallel vertical passes spaced along X
      const numLanes = Math.max(2, Math.ceil(width / laneSpacing));
      const actualSpacing = width / (numLanes + 1);

      for (let i = 1; i <= numLanes; i++) {
        const x = minX + i * actualSpacing;
        const isBottomToTop = laneIndex % 2 === 0;

        const yIntersections: number[] = [];
        for (let j = 0; j < localPoly.length; j++) {
          const k = (j + 1) % localPoly.length;
          const p1 = localPoly[j];
          const p2 = localPoly[k];

          if ((p1.x <= x && p2.x > x) || (p2.x <= x && p1.x > x)) {
            const yInt = p1.y + ((x - p1.x) * (p2.y - p1.y)) / (p2.x - p1.x);
            yIntersections.push(yInt);
          }
        }

        yIntersections.sort((a, b) => a - b);

        let startY = minY + groundFootprint.heightMeters * 0.25;
        let endY = maxY - groundFootprint.heightMeters * 0.25;

        if (yIntersections.length >= 2) {
          startY = yIntersections[0] + 1.0;
          endY = yIntersections[yIntersections.length - 1] - 1.0;
        }

        if (startY >= endY) {
          startY = minY + 2.0;
          endY = maxY - 2.0;
        }

        const pStartLocal = isBottomToTop ? { x, y: startY } : { x, y: endY };
        const pEndLocal = isBottomToTop ? { x, y: endY } : { x, y: startY };

        const pStartGps = BaseSearchAlgorithm.metersToLatLng(ref, pStartLocal.x, pStartLocal.y);
        const pEndGps = BaseSearchAlgorithm.metersToLatLng(ref, pEndLocal.x, pEndLocal.y);

        waypoints.push({
          id: `WP_GRID_${wpCounter++}`,
          lat: pStartGps.lat,
          lng: pStartGps.lng,
          altitudeMeters,
          speedMs: flightSpeedMs,
          action: laneIndex === 0 ? 'TRANSIT' : 'TURN',
          laneIndex
        });

        waypoints.push({
          id: `WP_GRID_${wpCounter++}`,
          lat: pEndGps.lat,
          lng: pEndGps.lng,
          altitudeMeters,
          speedMs: flightSpeedMs,
          action: 'SCAN_PASS',
          laneIndex
        });

        laneIndex++;
      }
    }

    // Calculate total distance
    for (let i = 0; i < waypoints.length - 1; i++) {
      totalDist += BaseSearchAlgorithm.getDistanceMeters(waypoints[i], waypoints[i + 1]);
    }

    const estimatedTimeSeconds = totalDist / Math.max(1.0, flightSpeedMs) + waypoints.length * 1.5;
    const boundaryArea = BaseSearchAlgorithm.calculatePolygonAreaMeters(coords);

    return {
      algorithm: 'GRID',
      waypoints,
      totalDistanceMeters: Math.round(totalDist),
      estimatedTimeSeconds: Math.round(estimatedTimeSeconds),
      laneCount: laneIndex,
      laneSpacingMeters: +laneSpacing.toFixed(1),
      groundFootprint,
      boundaryAreaMeters: Math.round(boundaryArea),
      coverageEfficiencyPercent: 96
    };
  }

  private getFallbackEmptyPath(boundary: SearchBoundaryConfig, alt: number): SearchPathResult {
    const gf = this.calculateGroundCoverage(alt);
    return {
      algorithm: 'GRID',
      waypoints: [],
      totalDistanceMeters: 0,
      estimatedTimeSeconds: 0,
      laneCount: 0,
      laneSpacingMeters: gf.effectiveLaneSpacingMeters,
      groundFootprint: gf,
      boundaryAreaMeters: 0,
      coverageEfficiencyPercent: 0
    };
  }
}
