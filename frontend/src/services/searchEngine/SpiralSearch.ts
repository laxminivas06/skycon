import { LatLngPoint, SearchBoundaryConfig } from '../../types/mission';
import { BaseSearchAlgorithm, DEFAULT_CAMERA_PARAMS } from './BaseSearchAlgorithm';
import {
  CameraParameters,
  SearchPathResult,
  SearchWaypoint,
  SearchAlgorithmId
} from './types';

export class SpiralSearch extends BaseSearchAlgorithm {
  public readonly id: SearchAlgorithmId = 'SPIRAL';
  public readonly name = 'Spiral / Expanding Search';
  public readonly description = 'Continuous Archimedean expanding spiral optimized for circular/radial search zones';

  public generateSearchPath(
    boundary: SearchBoundaryConfig,
    altitudeMeters: number,
    flightSpeedMs: number = 3.0,
    cameraParams: CameraParameters = DEFAULT_CAMERA_PARAMS,
    overlapPercent: number = 25
  ): SearchPathResult {
    const coords = boundary.coordinates;
    const center: LatLngPoint =
      boundary.circleCenter ||
      (coords && coords.length > 0
        ? BaseSearchAlgorithm.getPolygonCentroid(coords)
        : { lat: 12.9715987, lng: 77.5945627 });

    const maxRadius = boundary.circleRadiusMeters || 40.0;
    const groundFootprint = this.calculateGroundCoverage(
      altitudeMeters,
      cameraParams,
      overlapPercent
    );
    const laneSpacing = groundFootprint.effectiveLaneSpacingMeters;

    const waypoints: SearchWaypoint[] = [];
    let wpCounter = 1;
    let totalDist = 0;

    // Start at center (Radius 0)
    waypoints.push({
      id: `WP_SPIRAL_${wpCounter++}`,
      lat: center.lat,
      lng: center.lng,
      altitudeMeters,
      speedMs: flightSpeedMs,
      action: 'TRANSIT',
      laneIndex: 0,
      radiusFromCenterMeters: 0
    });

    // Expanding Archimedean Spiral: r(theta) = b * theta
    // Radial separation per 360 deg turn = laneSpacing
    const b = laneSpacing / (2 * Math.PI);
    const maxTheta = maxRadius / b;

    // Discretize with angular steps preserving smooth flight without excessive waypoints
    const angularStep = Math.PI / 6; // 30 deg steps (12 waypoints per full revolution)
    let currentTheta = Math.PI / 4;
    let currentLane = 1;

    while (currentTheta <= maxTheta + 0.1) {
      const r = Math.min(maxRadius, b * currentTheta);
      const dx = r * Math.cos(currentTheta);
      const dy = r * Math.sin(currentTheta);

      const ptGps = BaseSearchAlgorithm.metersToLatLng(center, dx, dy);
      const lane = Math.floor(currentTheta / (2 * Math.PI)) + 1;

      waypoints.push({
        id: `WP_SPIRAL_${wpCounter++}`,
        lat: ptGps.lat,
        lng: ptGps.lng,
        altitudeMeters,
        speedMs: flightSpeedMs,
        action: 'SCAN_PASS',
        laneIndex: lane,
        radiusFromCenterMeters: +r.toFixed(1)
      });

      currentLane = Math.max(currentLane, lane);
      currentTheta += angularStep;
    }

    // Calculate total path distance
    for (let i = 0; i < waypoints.length - 1; i++) {
      totalDist += BaseSearchAlgorithm.getDistanceMeters(waypoints[i], waypoints[i + 1]);
    }

    const estimatedTimeSeconds = totalDist / Math.max(1.0, flightSpeedMs) + waypoints.length * 0.8;
    const boundaryArea = Math.PI * maxRadius * maxRadius;

    return {
      algorithm: 'SPIRAL',
      waypoints,
      totalDistanceMeters: Math.round(totalDist),
      estimatedTimeSeconds: Math.round(estimatedTimeSeconds),
      laneCount: currentLane,
      laneSpacingMeters: +laneSpacing.toFixed(1),
      groundFootprint,
      boundaryAreaMeters: Math.round(boundaryArea),
      coverageEfficiencyPercent: 94
    };
  }
}
