import { LatLngPoint, SearchBoundaryConfig, DecodedQRData } from '../../types/mission';
import { BaseSearchAlgorithm, DEFAULT_CAMERA_PARAMS } from './BaseSearchAlgorithm';
import { GridSearch } from './GridSearch';
import { SpiralSearch } from './SpiralSearch';
import { PerimeterSearch } from './PerimeterSearch';
import { AdaptiveSearch } from './AdaptiveSearch';
import { TangentialSearch } from './TangentialSearch';
import {
  SearchAlgorithmId,
  SearchPathResult,
  SearchWaypoint,
  SearchEngineStatus,
  SearchEngineConfig,
  DetectedTargetRecord,
  CameraParameters,
  GroundFootprint
} from './types';
import { mavlinkService } from '../mavlinkService';
import { boxDetectionService } from '../boxDetectionService';
import { visionService } from '../visionService';
import { audioService } from '../audioService';

type SearchEngineStatusListener = (status: SearchEngineStatus) => void;

const DEFAULT_SEARCH_CONFIG: SearchEngineConfig = {
  searchAltitude: 10,
  searchBoundary: {
    type: 'RECTANGLE',
    coordinates: [
      { lat: 12.9722, lng: 77.5940 },
      { lat: 12.9722, lng: 77.5952 },
      { lat: 12.9712, lng: 77.5952 },
      { lat: 12.9712, lng: 77.5940 }
    ],
    widthMeters: 100,
    heightMeters: 80,
    areaSquareMeters: 8000,
    label: 'Standard Rectangle (100x80m)'
  },
  algorithm: 'GRID',
  flightSpeedMs: 3.0,
  desiredOverlapPercent: 25,
  cameraParams: { ...DEFAULT_CAMERA_PARAMS },
  inspectionHoverSeconds: 4,
  duplicateDistanceThresholdMeters: 4.0,
  maxInspectionAttempts: 2
};

export class SearchEngine {
  private config: SearchEngineConfig = { ...DEFAULT_SEARCH_CONFIG };
  private algorithms: Map<SearchAlgorithmId, BaseSearchAlgorithm> = new Map();
  private listeners: Set<SearchEngineStatusListener> = new Set();

  private activePath: SearchPathResult | null = null;
  private currentWaypointIndex: number = 0;
  private isRunning: boolean = false;
  private isSuspended: boolean = false;
  private state: SearchEngineStatus['state'] = 'STANDBY';

  // Target History for Duplicate Prevention
  private targetHistory: DetectedTargetRecord[] = [];
  private currentTarget: DetectedTargetRecord | null = null;

  // Timers & State Machine Watchdogs
  private pathFollowInterval: any = null;
  private inspectionTimer: any = null;
  private statusMessage: string = 'Search Engine in Standby';

  // Current Optical Ground Coverage Footprint
  private groundFootprint: GroundFootprint;

  constructor() {
    // Instantiate Modular Search Algorithms
    this.algorithms.set('GRID', new GridSearch());
    this.algorithms.set('SPIRAL', new SpiralSearch());
    this.algorithms.set('EXPANDING_SPIRAL', new SpiralSearch());
    this.algorithms.set('PERIMETER', new PerimeterSearch());
    this.algorithms.set('ADAPTIVE', new AdaptiveSearch());
    this.algorithms.set('SECTOR', new SpiralSearch());
    this.algorithms.set('CONTOUR', new PerimeterSearch());
    this.algorithms.set('TANGENTIAL', new TangentialSearch());

    const baseAlgo = this.algorithms.get('GRID')!;
    this.groundFootprint = baseAlgo.calculateGroundCoverage(
      this.config.searchAltitude,
      this.config.cameraParams,
      this.config.desiredOverlapPercent
    );

    if (typeof setTimeout !== 'undefined') {
      setTimeout(() => {
        this.initVisionAndDetectionHooks();
      }, 0);
    } else {
      this.initVisionAndDetectionHooks();
    }
  }

  /**
   * Subscribe to real-time search engine state and progress
   */
  public subscribe(fn: SearchEngineStatusListener): () => void {
    this.listeners.add(fn);
    fn(this.getStatus());
    return () => this.listeners.delete(fn);
  }

  public getStatus(): SearchEngineStatus {
    const totalWps = this.activePath?.waypoints.length || 0;
    const progressPercent =
      totalWps > 0
        ? Math.min(100, Math.round(((this.currentWaypointIndex + 1) / totalWps) * 100))
        : 0;

    const currentWp = this.activePath?.waypoints[this.currentWaypointIndex];
    const currentLane = currentWp?.laneIndex ?? 0;
    const totalLanes = this.activePath?.laneCount || 1;

    const camState = visionService.getCameraState();

    return {
      state: this.state,
      algorithm: this.config.algorithm,
      activeWaypointIndex: this.currentWaypointIndex,
      totalWaypoints: totalWps,
      currentLane: currentLane + 1,
      totalLanes,
      progressPercent,
      distanceCoveredMeters: Math.round((this.activePath?.totalDistanceMeters || 0) * (progressPercent / 100)),
      remainingDistanceMeters: Math.round((this.activePath?.totalDistanceMeters || 0) * ((100 - progressPercent) / 100)),
      objectDetectionActive: this.state === 'SEARCHING' || this.state === 'TARGET_DETECTED' || this.state === 'INSPECTING_TARGET',
      qrScannerActive: this.state === 'QR_ACTIVE' || this.state === 'QR_CONFIRMED',
      activeZoomLevel: camState.currentZoom,
      currentTarget: this.currentTarget,
      targetHistory: [...this.targetHistory],
      isSuspendedForInspection: this.isSuspended,
      groundFootprint: this.groundFootprint,
      statusMessage: this.statusMessage
    };
  }

  public getConfig(): SearchEngineConfig {
    return { ...this.config };
  }

  public updateConfig(partial: Partial<SearchEngineConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
      cameraParams: {
        ...this.config.cameraParams,
        ...(partial.cameraParams || {})
      },
      searchBoundary: {
        ...this.config.searchBoundary,
        ...(partial.searchBoundary || {})
      }
    };

    const algo = this.getAlgorithm(this.config.algorithm);
    this.groundFootprint = algo.calculateGroundCoverage(
      this.config.searchAltitude,
      this.config.cameraParams,
      this.config.desiredOverlapPercent
    );

    // If search is not actively running, regenerate path preview
    if (!this.isRunning) {
      this.generatePath();
    }
    this.notify();
  }

  public getAlgorithm(id: SearchAlgorithmId): BaseSearchAlgorithm {
    return this.algorithms.get(id) || this.algorithms.get('GRID')!;
  }

  /**
   * Generates or regenerates search path according to configured boundary, altitude, and algorithm
   */
  public generatePath(): SearchPathResult {
    const algo = this.getAlgorithm(this.config.algorithm);
    this.groundFootprint = algo.calculateGroundCoverage(
      this.config.searchAltitude,
      this.config.cameraParams,
      this.config.desiredOverlapPercent
    );

    const path = algo.generateSearchPath(
      this.config.searchBoundary,
      this.config.searchAltitude,
      this.config.flightSpeedMs,
      this.config.cameraParams,
      this.config.desiredOverlapPercent
    );

    this.activePath = path;
    this.notify();
    return path;
  }

  public getActivePath(): SearchPathResult | null {
    if (!this.activePath) {
      this.generatePath();
    }
    return this.activePath;
  }

  /**
   * Core Autonomous Search Engine Lifecycle:
   * Target Altitude Reached -> Start Search Engine -> Generate Search Path -> Follow Path -> Continuous Object Detection
   */
  public startSearch(altitudeMeters?: number): boolean {
    if (altitudeMeters) {
      this.config.searchAltitude = altitudeMeters;
    }

    this.isRunning = true;
    this.isSuspended = false;
    this.currentWaypointIndex = 0;
    this.currentTarget = null;
    this.state = 'GENERATING_PATH';
    this.statusMessage = `Generating optimal ${this.config.algorithm} search pattern at ${this.config.searchAltitude}m...`;
    this.notify();

    const path = this.generatePath();
    if (!path.waypoints || path.waypoints.length === 0) {
      this.state = 'STANDBY';
      this.statusMessage = 'Search Path generation failed: Invalid boundary';
      this.notify();
      return false;
    }

    // Set stage: Searching Active, Object Detection Active, QR Standby
    this.state = 'SEARCHING';
    this.statusMessage = `Autonomous ${path.algorithm} Search Active: Following ${path.waypoints.length} waypoints (${path.laneCount} lanes)`;
    audioService.playBeep(700, 100);
    this.notify();

    this.startPathFollowingLoop();
    return true;
  }

  public stopSearch(reason: string = 'Search Stopped'): void {
    this.isRunning = false;
    this.isSuspended = false;
    if (this.pathFollowInterval) clearInterval(this.pathFollowInterval);
    if (this.inspectionTimer) clearTimeout(this.inspectionTimer);

    this.state = 'STANDBY';
    this.statusMessage = reason;
    this.notify();
  }

  public pauseSearch(reason: string = 'Search Suspended'): void {
    this.isSuspended = true;
    this.statusMessage = reason;
    this.notify();
  }

  public resumeSearch(reason: string = 'Resuming Search Algorithm'): void {
    this.isSuspended = false;
    this.state = 'SEARCHING';
    this.statusMessage = reason;
    this.currentTarget = null;
    audioService.playBeep(880, 80);
    this.notify();
  }

  /**
   * Continuous Path Following Loop & Waypoint Navigation
   */
  private startPathFollowingLoop(): void {
    if (this.pathFollowInterval) clearInterval(this.pathFollowInterval);

    let lastCommandTime = 0;

    // Command first waypoint immediately
    if (this.activePath && this.activePath.waypoints.length > 0) {
      const initialWp = this.activePath.waypoints[0];
      mavlinkService.flyToPosition(initialWp.lat, initialWp.lng, this.config.searchAltitude, this.config.flightSpeedMs);
      lastCommandTime = Date.now();
    }

    this.pathFollowInterval = setInterval(() => {
      if (!this.isRunning || this.isSuspended) return;
      if (!this.activePath || !this.activePath.waypoints.length) return;

      const telemetry = mavlinkService.getTelemetry();
      const currentWp = this.activePath.waypoints[this.currentWaypointIndex];
      if (!currentWp) {
        this.onSearchPathCompleted();
        return;
      }

      // Periodically refresh position command to Pixhawk (every 2.5 seconds)
      if (Date.now() - lastCommandTime >= 2500) {
        lastCommandTime = Date.now();
        mavlinkService.flyToPosition(currentWp.lat, currentWp.lng, this.config.searchAltitude, this.config.flightSpeedMs);
      }

      // Check distance to current waypoint
      const currentPos: LatLngPoint = { lat: telemetry.latitude, lng: telemetry.longitude };
      const wpPos: LatLngPoint = { lat: currentWp.lat, lng: currentWp.lng };
      const dist = BaseSearchAlgorithm.getDistanceMeters(currentPos, wpPos);

      // Waypoint reached threshold (e.g. 2.8m)
      if (dist <= 2.8) {
        if (this.currentWaypointIndex < this.activePath.waypoints.length - 1) {
          this.currentWaypointIndex++;
          const nextWp = this.activePath.waypoints[this.currentWaypointIndex];
          this.statusMessage = `Progressing to Waypoint ${this.currentWaypointIndex + 1}/${this.activePath.waypoints.length} (Lane ${nextWp.laneIndex || 1})`;
          lastCommandTime = Date.now();
          mavlinkService.flyToPosition(nextWp.lat, nextWp.lng, this.config.searchAltitude, this.config.flightSpeedMs);
          this.notify();
        } else {
          this.onSearchPathCompleted();
        }
      }
    }, 500);
  }

  private onSearchPathCompleted(): void {
    this.isRunning = false;
    this.state = 'COMPLETED';
    this.statusMessage = 'Search Path Boundary Coverage 100% Completed';
    audioService.playBeep(988, 150);
    this.notify();
  }

  /**
   * Object Detection & Multi-Stage Inspection Pipeline
   */
  private initVisionAndDetectionHooks(): void {
    // 1. Subscribe to Box Detection Service for continuous object detection during search
    boxDetectionService.subscribeBox((box) => {
      if (!this.isRunning || this.isSuspended) return;

      // Only trigger if we are actively searching and an object is locked with high confidence (> 65%)
      if (box.isDetected && box.confidence >= 0.65 && (this.state === 'SEARCHING' || this.state === 'RESUMING_SEARCH')) {
        this.handlePotentialTargetDetected(box);
      }
    });

    // 2. Subscribe to QR scanner events for verified target confirmation
    visionService.subscribeQR((qrData) => {
      if (qrData && qrData.isValidTwoDigit) {
        this.handleQRConfirmed(qrData);
      }
    });
  }

  /**
   * Stage 1 -> Stage 2: Potential Target Detected
   */
  private handlePotentialTargetDetected(box: any): void {
    const telem = mavlinkService.getTelemetry();

    // Calculate approximate ground GPS coordinates of detected object based on pixel offset & altitude
    const h = telem.altitude || this.config.searchAltitude;
    const hFovRad = (this.config.cameraParams.fovHorizontalDeg * Math.PI) / 180;
    const vFovRad = (this.config.cameraParams.fovVerticalDeg * Math.PI) / 180;

    const groundWidth = 2 * h * Math.tan(hFovRad / 2);
    const groundHeight = 2 * h * Math.tan(vFovRad / 2);

    const dxMeters = (box.offsetXPercent / 100) * (groundWidth / 2);
    const dyMeters = -(box.offsetYPercent / 100) * (groundHeight / 2);

    const targetGps = BaseSearchAlgorithm.metersToLatLng(
      { lat: telem.latitude, lng: telem.longitude },
      dxMeters,
      dyMeters
    );

    // DUPLICATE PREVENTION: Check if target was already inspected recently within threshold
    const isDuplicate = this.targetHistory.some((prev) => {
      const d = BaseSearchAlgorithm.getDistanceMeters(prev.gpsPosition, targetGps);
      return d < this.config.duplicateDistanceThresholdMeters;
    });

    if (isDuplicate) {
      console.log('Target recognized as duplicate; continuing search.');
      return;
    }

    const targetRecord: DetectedTargetRecord = {
      id: `TGT_${Date.now()}`,
      timestamp: Date.now(),
      gpsPosition: {
        lat: targetGps.lat,
        lng: targetGps.lng,
        altitude: h
      },
      objectClass: 'CARDBOARD_BOX',
      confidence: +(box.confidence * 100).toFixed(0),
      qrCandidateDetected: false,
      inspectionStatus: 'INSPECTING',
      inspectionDurationMs: 0,
      distanceFromDroneMeters: Math.hypot(dxMeters, dyMeters)
    };

    this.currentTarget = targetRecord;
    this.targetHistory.push(targetRecord);

    // Temporarily suspend search and transition to inspection
    this.isSuspended = true;
    this.state = 'TARGET_DETECTED';
    this.statusMessage = `Target Object Detected (${targetRecord.confidence}% confidence). Temporarily suspending search path for inspection...`;
    audioService.playTargetLock();
    this.notify();

    // Command Pixhawk to position hold / guided hover over target
    mavlinkService.commandHold();

    // Transition to Stage 3: Target Inspection & QR Stage
    setTimeout(() => {
      this.initiateTargetInspection(targetRecord);
    }, 600);
  }

  /**
   * Stage 2 -> Stage 3: Target Inspection & QR Detection Stage
   */
  private initiateTargetInspection(target: DetectedTargetRecord): void {
    this.state = 'INSPECTING_TARGET';
    this.statusMessage = `Target Inspection Active: Aligning camera & activating QR Scanner at target GPS (${target.gpsPosition.lat.toFixed(5)}, ${target.gpsPosition.lng.toFixed(5)})`;
    this.notify();

    // Keep camera at 1.0x wide search; auto-zoom triggers specifically when QR is sighted
    this.state = 'QR_ACTIVE';
    this.notify();

    // Set inspection timeout: If no QR detected within inspectionHoverSeconds, resume search
    if (this.inspectionTimer) clearTimeout(this.inspectionTimer);
    this.inspectionTimer = setTimeout(() => {
      if (this.state === 'QR_ACTIVE' || this.state === 'INSPECTING_TARGET') {
        this.handleInspectionQRNotFound(target);
      }
    }, (this.config.inspectionHoverSeconds || 4) * 1000);
  }

  /**
   * Stage 3: QR NOT FOUND -> Resume Search
   */
  private handleInspectionQRNotFound(target: DetectedTargetRecord): void {
    target.inspectionStatus = 'REJECTED';
    target.inspectionDurationMs = Date.now() - target.timestamp;

    this.state = 'RESUMING_SEARCH';
    this.statusMessage = 'Target Inspection Complete: QR Not Confirmed. Returning to search path...';
    audioService.playBeep(440, 150);
    this.notify();

    // Reset zoom back to wide search mode (1.0x)
    visionService.setHardwareZoom(1.0);
    visionService.setAutoZoom(true);

    setTimeout(() => {
      // Seamlessly resume search from current waypoint without restarting
      this.resumeSearch(`Resuming ${this.config.algorithm} Search Pattern from Waypoint ${this.currentWaypointIndex + 1}`);
      mavlinkService.commandStartSearch();
    }, 1000);
  }

  /**
   * Stage 3 -> Stage 4: QR Confirmed
   */
  private handleQRConfirmed(qrData: DecodedQRData): void {
    if (this.inspectionTimer) clearTimeout(this.inspectionTimer);

    if (this.currentTarget) {
      this.currentTarget.inspectionStatus = 'CONFIRMED';
      this.currentTarget.qrCandidateDetected = true;
      this.currentTarget.qrDecodedText = qrData.code;
      this.currentTarget.inspectionDurationMs = Date.now() - this.currentTarget.timestamp;
    }

    this.state = 'QR_CONFIRMED';
    this.statusMessage = `QR Confirmed ✓ [${qrData.code}]. Target verified! Mission transitioning to runner transmission & RTL.`;
    audioService.playQrSuccess();
    this.notify();
  }

  private notify(): void {
    const status = this.getStatus();
    this.listeners.forEach((fn) => fn(status));
  }
}

export const searchEngine = new SearchEngine();
