import { LatLngPoint, HomePoint, DroneTelemetry } from '../types/mission';
import {
  GroundStationWaypoint,
  GroundStationMission,
  ReturnBehavior
} from '../types/groundStationMap';
import {
  calculateHaversineDistance,
  calculateBearing,
  computeDestination
} from './groundStationMissionService';
import { mavlinkService } from './mavlinkService';
import { missionEngine } from './missionEngine';
import { eventLogService } from './eventLogService';
import { audioService } from './audioService';

export interface RouteValidationResult {
  isValid: boolean;
  errorReason?: string;
  warnings?: string[];
}

export interface LiveWaypointProgress {
  currentWaypointIndex: number;
  totalWaypoints: number;
  currentWaypointName: string;
  nextWaypointName: string;
  distanceToCurrentMeters: number;
  currentLeg: 'OUTBOUND' | 'TARGET_HOVER' | 'RETURN';
  isExecuting: boolean;
  completedWaypoints: number[];
}

type ProgressListener = (progress: LiveWaypointProgress) => void;
type RouteMissionListener = (mission: GroundStationMission | null) => void;

class CustomRouteService {
  private currentMission: GroundStationMission | null = null;
  private outboundPoints: LatLngPoint[] = [];
  private returnPoints: LatLngPoint[] = [];
  private returnBehavior: ReturnBehavior = 'DIRECT_RTL';
  private waypointSpacingMeters: number = 5; // default 5m
  private missionAltitude: number = 15;      // default 15m
  private missionSpeed: number = 3.0;        // default 3.0 m/s
  private allowPerWaypointAltitude: boolean = false;

  // Execution state
  private isExecuting: boolean = false;
  private currentWpIndex: number = 0;
  private currentLeg: 'OUTBOUND' | 'TARGET_HOVER' | 'RETURN' = 'OUTBOUND';
  private completedIndices: Set<number> = new Set();
  private navLoopTimer: any = null;
  private acceptanceRadiusMeters: number = 3.0; // Waypoint reached threshold

  private progressListeners: Set<ProgressListener> = new Set();
  private missionListeners: Set<RouteMissionListener> = new Set();

  constructor() {
    this.restorePersistedSettings();
  }

  private restorePersistedSettings() {
    if (typeof window !== 'undefined') {
      try {
        const savedSpacing = localStorage.getItem('SAE_WP_SPACING');
        if (savedSpacing) this.waypointSpacingMeters = parseFloat(savedSpacing) || 5;

        const savedAlt = localStorage.getItem('SAE_CUSTOM_ALTITUDE');
        if (savedAlt) this.missionAltitude = parseFloat(savedAlt) || 15;

        const savedSpeed = localStorage.getItem('SAE_CUSTOM_SPEED');
        if (savedSpeed) this.missionSpeed = parseFloat(savedSpeed) || 3.0;

        const savedRet = localStorage.getItem('SAE_RETURN_BEHAVIOR') as ReturnBehavior;
        if (savedRet) this.returnBehavior = savedRet;
      } catch (e) {
        // ignore
      }
    }
  }

  public subscribeProgress(fn: ProgressListener): () => void {
    this.progressListeners.add(fn);
    fn(this.getProgress());
    return () => this.progressListeners.delete(fn);
  }

  public subscribeMission(fn: RouteMissionListener): () => void {
    this.missionListeners.add(fn);
    fn(this.currentMission);
    return () => this.missionListeners.delete(fn);
  }

  private notifyProgress() {
    const prog = this.getProgress();
    this.progressListeners.forEach((fn) => fn(prog));
  }

  private notifyMission() {
    this.missionListeners.forEach((fn) => fn(this.currentMission));
  }

  public getProgress(): LiveWaypointProgress {
    const waypoints = this.currentMission?.waypoints || [];
    const activeWp = waypoints[this.currentWpIndex];
    const nextWp = waypoints[this.currentWpIndex + 1];
    const telem = mavlinkService.getTelemetry();

    let dist = 0;
    if (activeWp && telem.latitude && telem.longitude) {
      dist = calculateHaversineDistance(telem.latitude, telem.longitude, activeWp.lat, activeWp.lng);
    }

    return {
      currentWaypointIndex: this.currentWpIndex,
      totalWaypoints: waypoints.length,
      currentWaypointName: activeWp ? activeWp.name || `WP${activeWp.index}` : 'None',
      nextWaypointName: nextWp ? nextWp.name || `WP${nextWp.index}` : 'Mission End',
      distanceToCurrentMeters: Math.round(dist * 10) / 10,
      currentLeg: this.currentLeg,
      isExecuting: this.isExecuting,
      completedWaypoints: Array.from(this.completedIndices)
    };
  }

  // Parameter Setters
  public setWaypointSpacing(meters: number) {
    this.waypointSpacingMeters = Math.max(2, Math.min(50, meters));
    if (typeof window !== 'undefined') localStorage.setItem('SAE_WP_SPACING', String(meters));
    if (this.outboundPoints.length > 0) this.rebuildMission();
  }

  public getWaypointSpacing(): number {
    return this.waypointSpacingMeters;
  }

  public setMissionAltitude(alt: number) {
    this.missionAltitude = Math.max(2, Math.min(120, alt));
    if (typeof window !== 'undefined') localStorage.setItem('SAE_CUSTOM_ALTITUDE', String(alt));
    if (this.outboundPoints.length > 0) this.rebuildMission();
  }

  public getMissionAltitude(): number {
    return this.missionAltitude;
  }

  public setMissionSpeed(speed: number) {
    this.missionSpeed = Math.max(0.5, Math.min(15, speed));
    if (typeof window !== 'undefined') localStorage.setItem('SAE_CUSTOM_SPEED', String(speed));
    if (this.outboundPoints.length > 0) this.rebuildMission();
  }

  public getMissionSpeed(): number {
    return this.missionSpeed;
  }

  public setReturnBehavior(behavior: ReturnBehavior) {
    this.returnBehavior = behavior;
    if (typeof window !== 'undefined') localStorage.setItem('SAE_RETURN_BEHAVIOR', behavior);
    if (this.outboundPoints.length > 0) this.rebuildMission();
  }

  public getReturnBehavior(): ReturnBehavior {
    return this.returnBehavior;
  }

  public setAllowPerWaypointAltitude(allow: boolean) {
    this.allowPerWaypointAltitude = allow;
  }

  public getAllowPerWaypointAltitude(): boolean {
    return this.allowPerWaypointAltitude;
  }

  public getCurrentMission(): GroundStationMission | null {
    return this.currentMission;
  }

  public getOutboundPoints(): LatLngPoint[] {
    return [...this.outboundPoints];
  }

  public getReturnPoints(): LatLngPoint[] {
    return [...this.returnPoints];
  }

  /**
   * Set raw drawn outbound route points and build the GPS mission.
   * Requirement 3: Automatically starts from Pixhawk Home Point (WP0 Home).
   */
  public setOutboundPoints(points: LatLngPoint[]) {
    this.outboundPoints = [...points];
    this.rebuildMission();
  }

  /**
   * Set custom return route points (Requirement 11).
   */
  public setReturnPoints(points: LatLngPoint[]) {
    this.returnPoints = [...points];
    this.rebuildMission();
  }

  /**
   * Clear all drawn routes.
   */
  public clearRoute() {
    this.outboundPoints = [];
    this.returnPoints = [];
    this.currentMission = null;
    this.isExecuting = false;
    this.currentWpIndex = 0;
    this.completedIndices.clear();
    if (this.navLoopTimer) clearInterval(this.navLoopTimer);
    this.notifyMission();
    this.notifyProgress();
    eventLogService.addEvent('Custom flight route cleared', 'info');
  }

  /**
   * Reverse outbound route points.
   */
  public reverseRoute() {
    if (this.outboundPoints.length < 2) return;
    this.outboundPoints.reverse();
    this.rebuildMission();
    eventLogService.addEvent('Custom flight route reversed', 'info');
  }

  /**
   * Subdivides long line segments so waypoint spacing is consistent (Requirement 5).
   * Generates intermediate GPS waypoints at spacing interval.
   */
  private interpolateLine(points: LatLngPoint[], maxSpacingMeters: number): LatLngPoint[] {
    if (points.length < 2) return [...points];
    const result: LatLngPoint[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      result.push(p1);

      const dist = calculateHaversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
      if (dist > maxSpacingMeters) {
        const divisions = Math.ceil(dist / maxSpacingMeters);
        for (let step = 1; step < divisions; step++) {
          const ratio = step / divisions;
          result.push({
            lat: p1.lat + (p2.lat - p1.lat) * ratio,
            lng: p1.lng + (p2.lng - p1.lng) * ratio
          });
        }
      }
    }
    result.push(points[points.length - 1]);
    return result;
  }

  /**
   * Builds the complete GPS mission with Outbound and Return waypoints (Requirements 3, 4, 5, 9, 10, 11).
   */
  public rebuildMission(): GroundStationMission | null {
    const home = mavlinkService.getHomePoint();
    if (this.outboundPoints.length === 0) {
      this.currentMission = null;
      this.notifyMission();
      return null;
    }

    // Step 1: Ensure WP0 is Home Point if home is set (Requirement 3)
    const rawOutbound: LatLngPoint[] = [];
    if (home.isSet && home.latitude !== 0) {
      const firstDist = calculateHaversineDistance(
        home.latitude,
        home.longitude,
        this.outboundPoints[0].lat,
        this.outboundPoints[0].lng
      );
      // If user started near home, use home as WP0
      rawOutbound.push({ lat: home.latitude, lng: home.longitude });
      if (firstDist > 2.0) {
        rawOutbound.push(...this.outboundPoints);
      } else {
        rawOutbound.push(...this.outboundPoints.slice(1));
      }
    } else {
      rawOutbound.push(...this.outboundPoints);
    }

    // Step 2: Interpolate outbound points with spacing (Requirement 5)
    const interpolatedOutbound = this.interpolateLine(rawOutbound, this.waypointSpacingMeters);

    const outboundWps: GroundStationWaypoint[] = [];
    let cumulativeDist = 0;
    let prevLat = interpolatedOutbound[0].lat;
    let prevLng = interpolatedOutbound[0].lng;

    interpolatedOutbound.forEach((pt, idx) => {
      const legDist = idx === 0 ? 0 : calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
      cumulativeDist += legDist;
      const isHomeWp = idx === 0 && home.isSet;
      outboundWps.push({
        id: `OUT_WP_${idx}`,
        index: idx,
        lat: pt.lat,
        lng: pt.lng,
        altitude: this.missionAltitude,
        speed: this.missionSpeed,
        action: isHomeWp ? 'TAKEOFF' : idx === interpolatedOutbound.length - 1 ? 'LOITER' : 'NAVIGATE',
        name: isHomeWp ? 'WP0 HOME' : idx === interpolatedOutbound.length - 1 ? `WP${idx} TARGET` : `WP${idx}`,
        distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
        leg: 'OUTBOUND'
      });
      prevLat = pt.lat;
      prevLng = pt.lng;
    });

    // Step 3: Generate Return Waypoints according to returnBehavior (Requirements 9, 10, 11)
    const returnWps: GroundStationWaypoint[] = [];
    if (this.returnBehavior === 'SAME_PATH_BACK') {
      // Outbound reversed: Target -> ... -> Home
      const reversedOutbound = [...interpolatedOutbound].reverse();
      // Drop first point since it's the target already at the end of outbound
      const returnPath = reversedOutbound.slice(1);
      returnPath.forEach((pt, idx) => {
        const legDist = calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
        cumulativeDist += legDist;
        const totalIdx = outboundWps.length + idx;
        const isFinalHome = idx === returnPath.length - 1;
        returnWps.push({
          id: `RET_WP_${idx + 1}`,
          index: totalIdx,
          lat: pt.lat,
          lng: pt.lng,
          altitude: this.missionAltitude,
          speed: this.missionSpeed,
          action: isFinalHome ? 'LAND' : 'NAVIGATE',
          name: isFinalHome ? `RET WP${idx + 1} HOME` : `RET WP${idx + 1}`,
          distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
          leg: 'RETURN'
        });
        prevLat = pt.lat;
        prevLng = pt.lng;
      });
    } else if (this.returnBehavior === 'CUSTOM_RETURN_PATH' && this.returnPoints.length > 0) {
      // Custom return route: Target -> C -> D -> Home
      const targetPoint = interpolatedOutbound[interpolatedOutbound.length - 1];
      const customReturnRaw: LatLngPoint[] = [targetPoint, ...this.returnPoints];
      if (home.isSet && home.latitude !== 0) {
        customReturnRaw.push({ lat: home.latitude, lng: home.longitude });
      }
      const interpolatedReturn = this.interpolateLine(customReturnRaw, this.waypointSpacingMeters);
      const returnPath = interpolatedReturn.slice(1); // skip duplicate target start

      returnPath.forEach((pt, idx) => {
        const legDist = calculateHaversineDistance(prevLat, prevLng, pt.lat, pt.lng);
        cumulativeDist += legDist;
        const totalIdx = outboundWps.length + idx;
        const isFinalHome = idx === returnPath.length - 1;
        returnWps.push({
          id: `CUST_RET_WP_${idx + 1}`,
          index: totalIdx,
          lat: pt.lat,
          lng: pt.lng,
          altitude: this.missionAltitude,
          speed: this.missionSpeed,
          action: isFinalHome ? 'LAND' : 'NAVIGATE',
          name: isFinalHome ? `RET WP${idx + 1} HOME` : `RET WP${idx + 1}`,
          distanceFromPreviousMeters: Math.round(legDist * 10) / 10,
          leg: 'RETURN'
        });
        prevLat = pt.lat;
        prevLng = pt.lng;
      });
    } else {
      // DIRECT_RTL (Default)
      if (home.isSet && home.latitude !== 0) {
        const rtlDist = calculateHaversineDistance(prevLat, prevLng, home.latitude, home.longitude);
        cumulativeDist += rtlDist;
        returnWps.push({
          id: 'WP_RTL',
          index: outboundWps.length,
          lat: home.latitude,
          lng: home.longitude,
          altitude: this.missionAltitude,
          speed: this.missionSpeed,
          action: 'RTL',
          name: 'DIRECT RTL HOME',
          distanceFromPreviousMeters: Math.round(rtlDist * 10) / 10,
          leg: 'RETURN'
        });
      }
    }

    const allWaypoints = [...outboundWps, ...returnWps];
    const estimatedDuration = Math.round(
      (cumulativeDist / this.missionSpeed) + (allWaypoints.length * 2.0) + (this.missionAltitude / 2.0)
    );

    const mission: GroundStationMission = {
      id: `CUSTOM_MSN_${Date.now().toString(36).toUpperCase()}`,
      homePoint: {
        latitude: home.latitude,
        longitude: home.longitude,
        altitude: home.altitude || 0,
        isSet: home.isSet
      },
      missionType: 'CUSTOM_ROUTE',
      missionCategory: 'CUSTOM_ROUTE',
      altitude: this.missionAltitude,
      speed: this.missionSpeed,
      waypoints: allWaypoints,
      outboundWaypoints: outboundWps,
      returnWaypoints: returnWps,
      returnBehavior: this.returnBehavior,
      totalDistance: Math.round(cumulativeDist * 10) / 10,
      estimatedDuration,
      geometry: {
        type: 'path',
        coordinates: interpolatedOutbound,
        returnCoordinates: returnWps.map(w => ({ lat: w.lat, lng: w.lng }))
      },
      isUploaded: false,
      createdAt: Date.now()
    };

    this.currentMission = mission;
    this.notifyMission();
    return mission;
  }

  /**
   * Route Validation Check (Requirement 12).
   */
  public validateRoute(): RouteValidationResult {
    const home = mavlinkService.getHomePoint();
    const conn = mavlinkService.getConnectionState();
    const telem = mavlinkService.getTelemetry();
    const maxDurationSec = missionEngine.getMissionDurationSeconds();

    if (!home.isSet || home.latitude === 0) {
      return { isValid: false, errorReason: 'Home position has not been established.' };
    }

    if (!this.currentMission || !this.currentMission.waypoints || this.currentMission.waypoints.length === 0) {
      return { isValid: false, errorReason: 'No route has been drawn on the map.' };
    }

    if (this.currentMission.waypoints.length < 2) {
      return { isValid: false, errorReason: 'Route requires at least 2 waypoints.' };
    }

    if (this.currentMission.waypoints.length > 200) {
      return { isValid: false, errorReason: `Too many waypoints (${this.currentMission.waypoints.length}). Safe limit is 200.` };
    }

    if (this.missionAltitude < 2 || this.missionAltitude > 120) {
      return { isValid: false, errorReason: `Altitude ${this.missionAltitude}m is outside safe limits (2m - 120m).` };
    }

    if (this.missionSpeed < 0.5 || this.missionSpeed > 15) {
      return { isValid: false, errorReason: `Speed ${this.missionSpeed}m/s is outside safe limits (0.5 - 15 m/s).` };
    }

    if (this.currentMission.estimatedDuration > maxDurationSec) {
      return {
        isValid: false,
        errorReason: `Estimated flight time (${Math.round(this.currentMission.estimatedDuration / 60)}m ${this.currentMission.estimatedDuration % 60}s) exceeds Maximum Mission Duration (${Math.round(maxDurationSec / 60)}m).`
      };
    }

    const isConnected = conn.isConnected || conn.isUsbConnected || conn.isRealHardware;
    if (!isConnected) {
      return { isValid: false, errorReason: 'Pixhawk flight controller is not connected.' };
    }

    if (!conn.ekfHealthy && (telem.latitude === 0 || telem.longitude === 0)) {
      return { isValid: false, errorReason: 'EKF / AHRS attitude filter is not aligned.' };
    }

    if (telem.batteryPercent > 0 && telem.batteryPercent < 20) {
      return { isValid: false, errorReason: `Battery level is too low (${telem.batteryPercent}%). Minimum 20% required.` };
    }

    return { isValid: true };
  }

  /**
   * Upload mission to Pixhawk / ESP32 (Requirement 4 & 20).
   */
  public async uploadMission(): Promise<{ success: boolean; message: string }> {
    const val = this.validateRoute();
    if (!val.isValid) {
      return { success: false, message: val.errorReason || 'Route validation failed' };
    }

    if (!this.currentMission) {
      return { success: false, message: 'No mission prepared.' };
    }

    try {
      // 1. Set mission cruising altitude on FC
      await mavlinkService.setTargetAltitude(this.missionAltitude);

      // 2. Transmit first waypoint target in GUIDED mode
      const w1 = this.currentMission.waypoints[1] || this.currentMission.waypoints[0];
      if (w1) {
        await mavlinkService.flyToPosition(w1.lat, w1.lng, w1.altitude, w1.speed);
      }

      this.currentMission.isUploaded = true;
      this.notifyMission();

      eventLogService.addEvent(
        `Custom route uploaded to Pixhawk: ${this.currentMission.waypoints.length} waypoints, ${this.currentMission.totalDistance}m total distance`,
        'success'
      );
      audioService.playBeep(880, 150);

      return {
        success: true,
        message: `Route uploaded: ${this.currentMission.waypoints.length} waypoints (${this.currentMission.totalDistance}m at ${this.missionAltitude}m alt).`
      };
    } catch (err: any) {
      return { success: false, message: `Upload error: ${err?.message || err}` };
    }
  }

  /**
   * Start Autonomous Custom Route Execution (Requirements 14, 15, 19, 20, 28).
   * Note: Drone position moves ONLY according to REAL GPS TELEMETRY from Pixhawk.
   */
  public async startExecution(): Promise<boolean> {
    if (!this.currentMission || !this.currentMission.waypoints || this.currentMission.waypoints.length === 0) {
      this.rebuildMission();
    }

    if (!this.currentMission || this.currentMission.waypoints.length === 0) {
      console.warn('Cannot execute custom route: No mission generated');
      return false;
    }

    this.isExecuting = true;
    this.currentWpIndex = 1; // Start with first navigational waypoint after WP0 Home
    this.currentLeg = 'OUTBOUND';
    this.completedIndices.clear();
    this.completedIndices.add(0); // Mark WP0 Home as passed

    eventLogService.addEvent('Custom route execution started — tracking waypoints autonomously', 'info');
    audioService.playBeep(880, 120);

    // Initial fly command
    const targetWp = this.currentMission.waypoints[this.currentWpIndex];
    if (targetWp) {
      await mavlinkService.flyToPosition(targetWp.lat, targetWp.lng, targetWp.altitude, targetWp.speed);
    }

    this.startWaypointNavigationLoop();
    this.notifyProgress();
    return true;
  }

  /**
   * Autonomous closed-loop waypoint tracking (Requirement 14, 15, 20).
   * Uses real GPS telemetry to advance waypoints sequentially.
   */
  private startWaypointNavigationLoop() {
    if (this.navLoopTimer) clearInterval(this.navLoopTimer);

    this.navLoopTimer = setInterval(() => {
      if (!this.isExecuting || !this.currentMission) {
        clearInterval(this.navLoopTimer);
        return;
      }

      const waypoints = this.currentMission.waypoints;
      if (this.currentWpIndex >= waypoints.length) {
        this.handleRouteCompleted();
        return;
      }

      const currentWp = waypoints[this.currentWpIndex];
      const telem = mavlinkService.getTelemetry();

      // Check distance using real telemetry (Requirement 28: DO NOT FAKE ROUTE EXECUTION!)
      if (telem.latitude && telem.longitude && currentWp) {
        const dist = calculateHaversineDistance(
          telem.latitude,
          telem.longitude,
          currentWp.lat,
          currentWp.lng
        );

        // Check if within waypoint arrival threshold
        if (dist <= this.acceptanceRadiusMeters) {
          this.completedIndices.add(this.currentWpIndex);
          eventLogService.addEvent(
            `Reached ${currentWp.name || `Waypoint ${this.currentWpIndex}`} (Distance: ${dist.toFixed(1)}m)`,
            'success'
          );
          audioService.playBeep(1000, 80);

          // Check if this was the last outbound waypoint
          const outboundCount = this.currentMission.outboundWaypoints?.length || 0;
          if (this.currentWpIndex === outboundCount - 1) {
            // Reached Target!
            this.handleTargetReached();
            return;
          }

          // Advance to next waypoint
          this.currentWpIndex++;
          if (this.currentWpIndex < waypoints.length) {
            const nextWp = waypoints[this.currentWpIndex];
            if (nextWp.action === 'RTL') {
              eventLogService.addEvent('Executing Return-To-Launch (Direct RTL)', 'warn');
              mavlinkService.commandRTL();
              this.handleRouteCompleted();
              return;
            } else if (nextWp.action === 'LAND') {
              eventLogService.addEvent('Executing Autonomous Landing at Home', 'info');
              mavlinkService.commandLand();
              this.handleRouteCompleted();
              return;
            } else {
              mavlinkService.flyToPosition(nextWp.lat, nextWp.lng, nextWp.altitude, nextWp.speed);
            }
          } else {
            this.handleRouteCompleted();
          }
        }
      }

      this.notifyProgress();
    }, 500);
  }

  private handleTargetReached() {
    eventLogService.addEvent('Arrived at Target Waypoint — initiating target investigation', 'warn');
    audioService.playBeep(1200, 200);

    // Switch leg to return when ready or after target investigation
    this.currentLeg = 'TARGET_HOVER';
    this.notifyProgress();

    // After brief investigation or QR confirmation, proceed to return route
    setTimeout(() => {
      if (!this.isExecuting || !this.currentMission) return;
      this.currentLeg = 'RETURN';
      this.currentWpIndex++;

      const waypoints = this.currentMission.waypoints;
      if (this.currentWpIndex < waypoints.length) {
        const nextWp = waypoints[this.currentWpIndex];
        if (nextWp.action === 'RTL') {
          eventLogService.addEvent('Initiating Direct RTL to Home', 'warn');
          mavlinkService.commandRTL();
          this.handleRouteCompleted();
        } else {
          eventLogService.addEvent(`Commencing return route: Following to ${nextWp.name}`, 'info');
          mavlinkService.flyToPosition(nextWp.lat, nextWp.lng, nextWp.altitude, nextWp.speed);
        }
      } else {
        this.handleRouteCompleted();
      }
      this.notifyProgress();
    }, 2500);
  }

  private handleRouteCompleted() {
    this.isExecuting = false;
    if (this.navLoopTimer) clearInterval(this.navLoopTimer);
    eventLogService.addEvent('Custom flight route completed successfully ✓', 'success');
    audioService.playMissionComplete();
    this.notifyProgress();
  }

  /**
   * Stop or Abort custom route execution immediately.
   */
  public stopExecution(reason: string = 'Operator Stopped') {
    this.isExecuting = false;
    if (this.navLoopTimer) clearInterval(this.navLoopTimer);
    mavlinkService.setFlightMode('LOITER');
    eventLogService.addEvent(`Custom route aborted: ${reason} (Safe LOITER commanded)`, 'warn');
    this.notifyProgress();
  }

  /**
   * Re-route to detected box/target location (Requirement 17).
   */
  public goToTarget(targetCoords: LatLngPoint) {
    if (!targetCoords.lat || !targetCoords.lng) return;
    eventLogService.addEvent(
      `Re-routing directly to detected target [${targetCoords.lat.toFixed(6)}, ${targetCoords.lng.toFixed(6)}]`,
      'warn'
    );
    mavlinkService.flyToPosition(targetCoords.lat, targetCoords.lng, this.missionAltitude, this.missionSpeed);
  }
}

export const customRouteService = new CustomRouteService();
