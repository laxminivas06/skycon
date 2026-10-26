import { DroneTelemetry, HomePoint } from './mission';
import { PixhawkConnectionState } from './mavlink';

export type LoiterTestStep =
  | 'IDLE'
  | 'ARMING'
  | 'TAKEOFF_CLIMB'
  | 'LOITER_HOLD'
  | 'DESCENDING'
  | 'LANDING'
  | 'DISARMING'
  | 'COMPLETED'
  | 'ABORTED'
  | 'FAILED';

export interface LoiterTestConfig {
  missionName: '5M_LOITER_TEST';
  flightMode: 'LOITER';
  takeoffAltitude: number; // 5 m
  landingPosition: 'Home / Takeoff Position';
  missionType: 'Controlled test mission';
  loiterDurationSeconds: number; // Configurable duration (default 10s)
  altitudeTolerance: number; // ±0.5 m
}

export interface LoiterTestPrerequisite {
  id: string;
  label: string;
  passed: boolean;
  reason?: string;
}

export interface LoiterTestValidation {
  allPassed: boolean;
  prerequisites: LoiterTestPrerequisite[];
  blockingReason?: string;
}

export interface LoiterTestState {
  step: LoiterTestStep;
  stepMessage: string;
  isExecuting: boolean;
  currentAltitude: number;
  targetAltitude: number;
  remainingHoldSeconds: number;
  totalHoldSeconds: number;
  startTime?: number;
  error?: string;
}
