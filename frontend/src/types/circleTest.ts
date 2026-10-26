export type CircleTestStep =
  | 'IDLE'
  | 'ARMING'
  | 'TAKEOFF_CLIMB'
  | 'TRANSIT_TO_PERIMETER'
  | 'ORBITING'
  | 'RETURNING_TO_CENTER'
  | 'DESCENDING'
  | 'LANDING'
  | 'DISARMING'
  | 'COMPLETED'
  | 'ABORTED'
  | 'FAILED';

export interface CircleTestConfig {
  missionName: 'AUTONOMOUS_CIRCLE_TEST';
  circleDiameterMeters: number; // Configurable diameter in meters (e.g. 10m)
  targetAltitudeMeters: number; // Configurable altitude in meters (e.g. 5m)
  flightSpeedMps: number;       // Orbit velocity in m/s (default 2.0 m/s)
  laps: number;                 // Number of full 360-degree laps (default 1)
  direction: 'CW' | 'CCW';      // Clockwise vs Counter-Clockwise
  landingPosition: 'Home / Takeoff Position';
  altitudeTolerance: number;    // ±0.5 m
}

export interface CircleTestPrerequisite {
  id: string;
  label: string;
  passed: boolean;
  reason?: string;
}

export interface CircleTestValidation {
  allPassed: boolean;
  prerequisites: CircleTestPrerequisite[];
  blockingReason?: string;
}

export interface CircleTestState {
  step: CircleTestStep;
  stepMessage: string;
  isExecuting: boolean;
  currentAltitude: number;
  targetAltitude: number;
  circleDiameterMeters: number;
  circleRadiusMeters: number;
  currentAngleDeg: number;       // 0 to 360 deg
  currentLap: number;            // 1, 2, ...
  totalLaps: number;
  progressPercent: number;       // 0 - 100%
  flightSpeedMps: number;
  direction: 'CW' | 'CCW';
  startTime?: number;
  elapsedSeconds: number;
  error?: string;
}
