import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Search,
  Layers,
  LocateFixed,
  MapPin,
  Ruler,
  Plus,
  Minus,
  Check,
  Shield,
  X,
  Navigation,
  Target,
  Home,
  Pencil,
  Circle as CircleIcon,
  Disc,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Segmented } from '../../ui/Segmented';
import { DashboardTelemetryData } from '../../hooks/useDashboardTelemetry';
import {
  groundStationMissionService,
  computeDestination,
  calculateHaversineDistance,
  calculateBearing,
} from '../../services/groundStationMissionService';
import { missionEngine } from '../../services/missionEngine';
import { mavlinkService } from '../../services/mavlinkService';
import { GroundStationMission, MissionDrawingTool } from '../../types/groundStationMap';
import { LatLngPoint, HomePoint } from '../../types/mission';
import { audioService } from '../../services/audioService';
import { reconDetectionService } from '../../services/reconDetectionService';
import { TargetLocation, QRDetectionRecord } from '../../types/recon';
import { geofenceService } from '../../services/geofenceService';
import { GeofenceControlModal } from '../../components/GroundStation/GeofenceControlModal';

interface MapPanelProps {
  telemetry: DashboardTelemetryData;
  className?: string;
  onWaypointAdded?: (lat: number, lon: number) => void;
}

const TILE_SERVERS = {
  Map: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  Street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  Satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  Topo: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  Dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

// Resamples continuous cursor drawing points into clean, spaced waypoints
function resampleDrawnPoints(points: L.LatLng[], minSpacingMeters: number = 7.0): LatLngPoint[] {
  if (points.length < 2) return points.map((p) => ({ lat: p.lat, lng: p.lng }));

  const result: LatLngPoint[] = [{ lat: points[0].lat, lng: points[0].lng }];
  let lastLat = points[0].lat;
  let lastLng = points[0].lng;

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const dist = calculateHaversineDistance(lastLat, lastLng, pt.lat, pt.lng);
    if (dist >= minSpacingMeters) {
      result.push({ lat: pt.lat, lng: pt.lng });
      lastLat = pt.lat;
      lastLng = pt.lng;
    }
  }

  const last = points[points.length - 1];
  const lastDist = calculateHaversineDistance(lastLat, lastLng, last.lat, last.lng);
  if (lastDist > 2.0) {
    result.push({ lat: last.lat, lng: last.lng });
  }

  return result;
}

export const MapPanel: React.FC<MapPanelProps> = ({
  telemetry,
  className = '',
  onWaypointAdded,
}) => {
  const [layer, setLayer] = useState<'Map' | 'Satellite' | 'Street' | 'Topo' | 'Dark'>('Satellite');
  const [isPinningWp, setIsPinningWp] = useState<boolean>(false);
  const [isMeasuring, setIsMeasuring] = useState<boolean>(false);
  const [showGeofence, setShowGeofence] = useState<boolean>(() => geofenceService.getState().enabled);
  const [isGeofenceModalOpen, setIsGeofenceModalOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [measureDistanceMeters, setMeasureDistanceMeters] = useState<number | null>(null);

  // Advanced Interactive Mission Tools
  const [isDrawingFreehand, setIsDrawingFreehand] = useState<boolean>(false);
  const [isPlacingCircle, setIsPlacingCircle] = useState<boolean>(false);
  const [isPlacingConcentric, setIsPlacingConcentric] = useState<boolean>(false);
  const [isPlacingGeofence, setIsPlacingGeofence] = useState<boolean>(false);
  const [circleRadius, setCircleRadius] = useState<number>(() =>
    groundStationMissionService.getCircleRadius()
  );

  useEffect(() => {
    return groundStationMissionService.subscribeCircleRadius((r) => setCircleRadius(r));
  }, []);

  // Drone Tracking & Map Follow Mode
  const [followMode, setFollowMode] = useState<'none' | 'drone'>('none');
  const [homePoint, setHomePoint] = useState<HomePoint>(mavlinkService.getHomePoint());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const activeTileLayerRef = useRef<L.TileLayer | null>(null);
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const homeMarkerRef = useRef<L.Marker | null>(null);
  const targetBoxMarkerRef = useRef<L.Marker | null>(null);
  const captureSiteMarkerRef = useRef<L.Marker | null>(null);
  const targetVectorLineRef = useRef<L.Polyline | null>(null);
  const breadcrumbsRef = useRef<L.Polyline | null>(null);
  const waypointsGroupRef = useRef<L.LayerGroup | null>(null);
  const missionPolylineRef = useRef<L.Polyline | null>(null);
  const geofencePolygonRef = useRef<L.Polygon | null>(null);
  const geofenceCenterMarkerRef = useRef<L.Marker | null>(null);
  const measurePointsRef = useRef<L.LatLng[]>([]);
  const measureLineRef = useRef<L.Polyline | null>(null);

  // Freehand drawing refs
  const freehandPolylineRef = useRef<L.Polyline | null>(null);
  const drawnPointsRef = useRef<L.LatLng[]>([]);
  const isMouseDownDrawingRef = useRef<boolean>(false);

  const isPinningWpRef = useRef<boolean>(isPinningWp);
  isPinningWpRef.current = isPinningWp;

  const isMeasuringRef = useRef<boolean>(isMeasuring);
  isMeasuringRef.current = isMeasuring;

  const isDrawingFreehandRef = useRef<boolean>(isDrawingFreehand);
  isDrawingFreehandRef.current = isDrawingFreehand;

  const isPlacingCircleRef = useRef<boolean>(isPlacingCircle);
  isPlacingCircleRef.current = isPlacingCircle;

  const isPlacingConcentricRef = useRef<boolean>(isPlacingConcentric);
  isPlacingConcentricRef.current = isPlacingConcentric;

  const isPlacingGeofenceRef = useRef<boolean>(isPlacingGeofence);
  isPlacingGeofenceRef.current = isPlacingGeofence;

  const hasAutoCenteredRef = useRef<boolean>(false);
  const lastGeofenceAnchorRef = useRef<{ lat: number; lon: number } | null>(null);

  const showTemporaryNotice = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // 1. Subscribe to Global Drawing Tool from MissionPatterns / Service
  useEffect(() => {
    const unsub = groundStationMissionService.subscribeDrawingTool((tool: MissionDrawingTool) => {
      if (tool === 'draw') {
        setIsDrawingFreehand(true);
        setIsPlacingCircle(false);
        setIsPlacingConcentric(false);
        setIsPinningWp(false);
        setIsMeasuring(false);
        showTemporaryNotice('✏️ Freehand Draw Mode Active: Drag cursor across map to sketch flight path');
        audioService.playBeep(920, 80);
      } else if (tool === 'circle') {
        setIsPlacingCircle(true);
        setIsPlacingConcentric(false);
        setIsDrawingFreehand(false);
        setIsPinningWp(false);
        setIsMeasuring(false);
        showTemporaryNotice('⭕ Click on map to place 15m Circle Orbit');
        audioService.playBeep(920, 80);
      } else if (tool === 'concentric_circle') {
        setIsPlacingConcentric(true);
        setIsPlacingCircle(false);
        setIsDrawingFreehand(false);
        setIsPinningWp(false);
        setIsMeasuring(false);
        showTemporaryNotice('🎯 Click on map to place Concentric Circular Rings (6m, 12m, 18m)');
        audioService.playBeep(920, 80);
      } else if (tool === 'point') {
        setIsPinningWp(true);
        setIsDrawingFreehand(false);
        setIsPlacingCircle(false);
        setIsPlacingConcentric(false);
      }
    });

    return () => unsub();
  }, []);

  // 2. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const droneHasCoord = Boolean(telemetry.isGpsValid && telemetry.latitude && Math.abs(telemetry.latitude) > 0.001);
    const initialLat = droneHasCoord ? telemetry.latitude : 17.3850;
    const initialLon = droneHasCoord ? telemetry.longitude : 78.4867;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: droneHasCoord ? 17 : 14,
      zoomControl: false,
      attributionControl: false,
    });

    const tileLayer = L.tileLayer(TILE_SERVERS[layer], {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
    }).addTo(map);
    activeTileLayerRef.current = tileLayer;

    // Breadcrumbs trail
    const breadcrumbs = L.polyline([], {
      color: '#38bdf8',
      weight: 3,
      opacity: 0.7,
      dashArray: '4, 4',
    }).addTo(map);
    breadcrumbsRef.current = breadcrumbs;

    // Layer groups for mission waypoints
    const wpGroup = L.layerGroup().addTo(map);
    waypointsGroupRef.current = wpGroup;

    const missionLine = L.polyline([], {
      color: '#22c55e',
      weight: 2.5,
      dashArray: '6, 6',
    }).addTo(map);
    missionPolylineRef.current = missionLine;

    // Custom Drone HTML Marker with heading beam
    const droneIcon = L.divIcon({
      className: 'drone-leaflet-icon',
      html: `
        <div style="position: relative; width: 60px; height: 60px; margin-left: -30px; margin-top: -30px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid rgba(34, 197, 94, 0.6); background: rgba(34, 197, 94, 0.15); animation: pulse 2s infinite;"></div>
          <div id="drone-heading-beam" style="position: absolute; top: 0px; left: 50%; transform: translateX(-50%) rotate(${telemetry.headingDeg}deg); transform-origin: 50% 30px; width: 0; height: 0; border-left: 12px solid transparent; border-right: 12px solid transparent; border-top: 35px solid rgba(56, 189, 248, 0.55); pointer-events: none;"></div>
          <div style="width: 24px; height: 24px; border-radius: 50%; background: #10b981; border: 2.5px solid #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; position: absolute; top: 18px; left: 18px;">
            <div style="width: 7px; height: 7px; border-radius: 50%; background: #ffffff;"></div>
          </div>
        </div>
      `,
      iconSize: [60, 60],
      iconAnchor: [30, 30],
    });

    const droneMarker = L.marker([initialLat, initialLon], {
      icon: droneIcon,
      zIndexOffset: 1000,
    }).bindTooltip('🛸 Autonomous Drone (Pixhawk FC)', { direction: 'top', offset: [0, -20] });
    droneMarkerRef.current = droneMarker;

    // Only add drone marker and geofence to the map if Pixhawk has a valid GPS lock
    if (droneHasCoord) {
      droneMarker.addTo(map);
      updateGeofence(map, initialLat, initialLon);
      hasAutoCenteredRef.current = true;
    }

    mapRef.current = map;

    // Freehand Drawing Listeners on Map
    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (!isDrawingFreehandRef.current) return;
      isMouseDownDrawingRef.current = true;
      map.dragging.disable();
      drawnPointsRef.current = [e.latlng];

      if (freehandPolylineRef.current) {
        map.removeLayer(freehandPolylineRef.current);
      }

      const poly = L.polyline([e.latlng], {
        color: '#06b6d4',
        weight: 3.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '2, 3',
      }).addTo(map);
      freehandPolylineRef.current = poly;
    });

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!isDrawingFreehandRef.current || !isMouseDownDrawingRef.current || !freehandPolylineRef.current) return;
      const last = drawnPointsRef.current[drawnPointsRef.current.length - 1];
      if (!last || last.distanceTo(e.latlng) >= 1.5) {
        drawnPointsRef.current.push(e.latlng);
        freehandPolylineRef.current.setLatLngs(drawnPointsRef.current);
      }
    });

    const handleMouseUpFinish = () => {
      if (!isDrawingFreehandRef.current || !isMouseDownDrawingRef.current) return;
      isMouseDownDrawingRef.current = false;
      map.dragging.enable();

      if (drawnPointsRef.current.length >= 2) {
        const resampled = resampleDrawnPoints(drawnPointsRef.current, 7.0);
        if (resampled.length >= 2) {
          const currentHome = mavlinkService.getHomePoint();
          groundStationMissionService.generatePathMission(resampled, currentHome, 25, 4.5);
          audioService.playBeep(1020, 100);
          showTemporaryNotice(`Freehand route saved! ${resampled.length} waypoints created ✓ Click 'UPLOAD WAYPOINTS' to sync.`);
        }
      }

      if (freehandPolylineRef.current) {
        map.removeLayer(freehandPolylineRef.current);
        freehandPolylineRef.current = null;
      }
      drawnPointsRef.current = [];
      setIsDrawingFreehand(false);
      groundStationMissionService.setDrawingTool('select');
    };

    map.on('mouseup', handleMouseUpFinish);
    window.addEventListener('mouseup', handleMouseUpFinish);

    // Handle map clicks for adding waypoints, circles, concentric circles, geofence, or measuring distance
    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;

      // 0. Geofence Placement Tool: Click map to place custom geofence center (e.g. Cricket Ground)
      if (isPlacingGeofenceRef.current) {
        geofenceService.setCustomAnchor(lat, lng);
        updateGeofence(map, lat, lng);
        audioService.playBeep(1100, 100);
        showTemporaryNotice(`🎯 Geofence placed at (${lat.toFixed(5)}, ${lng.toFixed(5)}) ✓ Drag center marker to adjust.`);
        setIsPlacingGeofence(false);
        return;
      }

      // 1. Measuring Tool
      if (isMeasuringRef.current) {
        measurePointsRef.current.push(e.latlng);
        if (measurePointsRef.current.length === 1) {
          if (measureLineRef.current) map.removeLayer(measureLineRef.current);
          measureLineRef.current = L.polyline([e.latlng], { color: '#f59e0b', weight: 3, dashArray: '3, 3' }).addTo(map);
          setMeasureDistanceMeters(0);
        } else if (measurePointsRef.current.length >= 2) {
          const p1 = measurePointsRef.current[0];
          const p2 = measurePointsRef.current[1];
          const d = p1.distanceTo(p2);
          if (measureLineRef.current) {
            measureLineRef.current.setLatLngs([p1, p2]);
          }
          setMeasureDistanceMeters(Math.round(d * 10) / 10);
          measurePointsRef.current = [];
          audioService.playBeep(700, 60);
        }
        return;
      }

      // 2. Interactive Circle Tool: Click map to place circle orbit with configured radius
      if (isPlacingCircleRef.current) {
        const currentHome = mavlinkService.getHomePoint();
        const currentRadius = groundStationMissionService.getCircleRadius();
        groundStationMissionService.generateCircleMission(
          { lat, lng },
          currentRadius,
          currentHome,
          25,
          4.0,
          'CW'
        );
        audioService.playBeep(980, 80);
        showTemporaryNotice(`${currentRadius}m Circle Orbit placed at (${lat.toFixed(5)}, ${lng.toFixed(5)}) ✓ Ready to upload.`);
        setIsPlacingCircle(false);
        groundStationMissionService.setDrawingTool('select');
        return;
      }

      // 3. Interactive Concentric Circles Tool: Click map to place 3 concentric rings scaled by radius
      if (isPlacingConcentricRef.current) {
        const currentHome = mavlinkService.getHomePoint();
        const baseRadius = groundStationMissionService.getCircleRadius();
        const r1 = Math.max(3, Math.round(baseRadius * 0.4));
        const r2 = Math.max(r1 + 3, Math.round(baseRadius * 0.8));
        const r3 = Math.max(r2 + 3, baseRadius);
        groundStationMissionService.generateConcentricCircleMission(
          { lat, lng },
          [r1, r2, r3],
          currentHome,
          20,
          4.0,
          'CW'
        );
        audioService.playBeep(980, 80);
        showTemporaryNotice(`3-Ring Concentric Circles (${r1}m, ${r2}m, ${r3}m) placed ✓ Ready to upload.`);
        setIsPlacingConcentric(false);
        groundStationMissionService.setDrawingTool('select');
        return;
      }

      // 4. Pin Waypoint Tool: Click map to add individual waypoints
      if (isPinningWpRef.current) {
        const curr = groundStationMissionService.getCurrentMission();
        const existingPts = curr ? curr.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })) : [];
        const newPts = [...existingPts, { lat, lng }];
        groundStationMissionService.generateWaypointMission(
          newPts,
          { latitude: initialLat, longitude: initialLon, altitude: 0, timestamp: Date.now(), isSet: true },
          30,
          5.0
        );
        onWaypointAdded?.(lat, lng);
        audioService.playBeep(880, 80);
        return;
      }
    });

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    const resizeObserver = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    });

    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('mouseup', handleMouseUpFinish);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Geofence around given anchor coordinates using geofenceService
  const updateGeofence = (map: L.Map, anchorLat: number, anchorLon: number) => {
    if (geofencePolygonRef.current && map.hasLayer(geofencePolygonRef.current)) {
      map.removeLayer(geofencePolygonRef.current);
      geofencePolygonRef.current = null;
    }
    if (geofenceCenterMarkerRef.current && map.hasLayer(geofenceCenterMarkerRef.current)) {
      map.removeLayer(geofenceCenterMarkerRef.current);
      geofenceCenterMarkerRef.current = null;
    }

    const state = geofenceService.getState();
    if (!state.enabled || !showGeofence) return;

    lastGeofenceAnchorRef.current = { lat: anchorLat, lon: anchorLon };
    const vertices = geofenceService.getBoundaryVertices();
    if (vertices.length < 3) return;

    const latLngs: L.LatLngExpression[] = vertices.map((v) => [v.lat, v.lng]);
    const isBreached = state.isBreached;

    const geofence = L.polygon(latLngs, {
      color: isBreached ? '#ef4444' : '#f59e0b',
      weight: isBreached ? 3 : 2,
      dashArray: '6, 6',
      fillColor: isBreached ? '#ef4444' : '#f59e0b',
      fillOpacity: isBreached ? 0.22 : 0.08,
    }).bindTooltip(
      isBreached
        ? `⚠️ GEOFENCE BREACH: ${state.breachReason || 'Perimeter Crossed'}`
        : `ADDC GEOFENCE (${state.widthMeters}m × ${state.heightMeters}m, Ceil: ${state.maxAltitudeMeters}m) [Drag 🎯 icon to relocate]`,
      { permanent: false, direction: 'center' }
    );

    geofence.addTo(map);
    geofencePolygonRef.current = geofence;

    // Draggable Geofence Center Anchor Marker
    const centerIcon = L.divIcon({
      className: 'geofence-center-marker',
      html: `
        <div style="position: relative; width: 34px; height: 34px; margin-left: -17px; margin-top: -17px; display: flex; align-items: center; justify-content: center; cursor: grab;">
          <div style="position: absolute; inset: 0; border-radius: 50%; border: 2px dashed #f59e0b; background: rgba(245, 158, 11, 0.25); animation: pulse 2.5s infinite;"></div>
          <div style="width: 24px; height: 24px; border-radius: 50%; background: #d97706; border: 2px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; font-size: 12px; color: #ffffff;">
            🎯
          </div>
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

    const centerMarker = L.marker([anchorLat, anchorLon], {
      icon: centerIcon,
      draggable: true,
      zIndexOffset: 860,
    }).bindTooltip('🎯 Geofence Center (Drag anywhere to relocate boundary)', { direction: 'top', offset: [0, -14] });

    centerMarker.on('dragend', (e: L.DragEndEvent) => {
      const newPos = (e.target as L.Marker).getLatLng();
      geofenceService.setCustomAnchor(newPos.lat, newPos.lng);
      updateGeofence(map, newPos.lat, newPos.lng);
      audioService.playBeep(1000, 80);
      showTemporaryNotice(`🎯 Geofence moved to (${newPos.lat.toFixed(5)}, ${newPos.lng.toFixed(5)}) ✓`);
    });

    centerMarker.addTo(map);
    geofenceCenterMarkerRef.current = centerMarker;
  };

  useEffect(() => {
    const unsub = geofenceService.subscribe((st) => {
      setShowGeofence(st.enabled);
      if (mapRef.current) {
        const anchor = geofenceService.getEffectiveAnchor();
        if (anchor) {
          updateGeofence(mapRef.current, anchor.lat, anchor.lng);
        }
      }
    });
    return () => unsub();
  }, [showGeofence]);

  // 3. Update Drone Marker & Heading dynamically (Strictly from Pixhawk GPS)
  useEffect(() => {
    const map = mapRef.current;
    const marker = droneMarkerRef.current;
    if (!map || !marker) return;

    const droneHasCoord = Boolean(
      telemetry.isGpsValid &&
      telemetry.latitude &&
      Math.abs(telemetry.latitude) > 0.001 &&
      Math.abs(telemetry.latitude) <= 90 &&
      Math.abs(telemetry.longitude) <= 180
    );

    if (droneHasCoord) {
      const lat = telemetry.latitude;
      const lon = telemetry.longitude;

      if (!map.hasLayer(marker)) {
        marker.addTo(map);
      }
      marker.setLatLng([lat, lon]);

      // Update heading beam rotation
      const beamEl = document.getElementById('drone-heading-beam');
      if (beamEl) {
        beamEl.style.transform = `translateX(-50%) rotate(${telemetry.headingDeg}deg)`;
      }

      // Auto-center on first valid Drone fix
      if (!hasAutoCenteredRef.current) {
        hasAutoCenteredRef.current = true;
        map.flyTo([lat, lon], 17, { duration: 1.2 });
        updateGeofence(map, lat, lon);
      }

      // Follow drone if followMode === 'drone'
      if (followMode === 'drone') {
        map.panTo([lat, lon], { animate: true, duration: 0.4 });
      }

      // Append to breadcrumb trail if moving
      if (breadcrumbsRef.current && (telemetry.speedMs > 0.2 || telemetry.isArmed)) {
        breadcrumbsRef.current.addLatLng([lat, lon]);
      }
    } else {
      // GPS signal unavailable or invalid -> remove drone marker from map to prevent showing inaccurate location
      if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    }
  }, [
    telemetry.latitude,
    telemetry.longitude,
    telemetry.headingDeg,
    telemetry.speedMs,
    telemetry.isArmed,
    telemetry.isGpsValid,
    followMode,
  ]);

  // 5. Update Home Point Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentHome = mavlinkService.getHomePoint();
    setHomePoint(currentHome);

    if (currentHome.isSet && Math.abs(currentHome.latitude) > 0.001) {
      if (!homeMarkerRef.current) {
        const homeIcon = L.divIcon({
          className: 'home-point-leaflet-icon',
          html: `
            <div style="position: relative; width: 36px; height: 36px; margin-left: -18px; margin-top: -18px; display: flex; align-items: center; justify-content: center;">
              <div style="position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid rgba(245, 158, 11, 0.6); background: rgba(245, 158, 11, 0.15); animation: pulse 2.5s infinite;"></div>
              <div style="width: 26px; height: 26px; border-radius: 50%; background: #D97706; border: 2.5px solid #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; font-weight: 900; font-family: monospace; font-size: 13px; color: #ffffff;">
                H
              </div>
            </div>
          `,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });

        const hm = L.marker([currentHome.latitude, currentHome.longitude], {
          icon: homeIcon,
          zIndexOffset: 900,
        }).bindTooltip(
          `🏠 Home Point: ${currentHome.latitude.toFixed(5)}, ${currentHome.longitude.toFixed(5)} (Alt: ${currentHome.altitude.toFixed(1)}m)`,
          { direction: 'top', offset: [0, -16] }
        ).addTo(map);

        homeMarkerRef.current = hm;
      } else {
        homeMarkerRef.current.setLatLng([currentHome.latitude, currentHome.longitude]);
        homeMarkerRef.current.setTooltipContent(
          `🏠 Home Point: ${currentHome.latitude.toFixed(5)}, ${currentHome.longitude.toFixed(5)} (Alt: ${currentHome.altitude.toFixed(1)}m)`
        );
      }

      // Ensure Geofence is anchored at Effective Point (Custom / Home)
      const effectiveAnchor = geofenceService.getEffectiveAnchor();
      if (effectiveAnchor) {
        updateGeofence(map, effectiveAnchor.lat, effectiveAnchor.lng);
      } else {
        updateGeofence(map, currentHome.latitude, currentHome.longitude);
      }
    }
  }, [telemetry.latitude, telemetry.longitude]);

  // 6. Toggle Geofence Layer Visibility
  useEffect(() => {
    const gf = geofencePolygonRef.current;
    const gfc = geofenceCenterMarkerRef.current;
    const map = mapRef.current;
    if (!map) return;
    if (showGeofence) {
      if (gf && !map.hasLayer(gf)) map.addLayer(gf);
      if (gfc && !map.hasLayer(gfc)) map.addLayer(gfc);
    } else {
      if (gf && map.hasLayer(gf)) map.removeLayer(gf);
      if (gfc && map.hasLayer(gfc)) map.removeLayer(gfc);
    }
  }, [showGeofence]);

  // 7. AERORECON: Target Location Marker (Case A) & QR Capture Site Marker
  useEffect(() => {
    const unsubTarget = reconDetectionService.subscribeActiveTarget((target, dist, bearing) => {
      const map = mapRef.current;
      if (!map) return;

      if (target && target.isValid) {
        const targetLat = target.latitude;
        const targetLng = target.longitude;

        if (!targetBoxMarkerRef.current) {
          const targetIcon = L.divIcon({
            className: 'target-box-icon',
            html: `
              <div style="position: relative; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;">
                <div style="position: absolute; inset: 0; border-radius: 50%; border: 2.5px solid #10B981; background: rgba(16, 185, 129, 0.25); animation: pulse 1.5s infinite;"></div>
                <div style="position: absolute; width: 14px; height: 14px; border-radius: 50%; background: #10B981;"></div>
                <div style="position: absolute; width: 2px; height: 38px; background: rgba(16, 185, 129, 0.6);"></div>
                <div style="position: absolute; width: 38px; height: 2px; background: rgba(16, 185, 129, 0.6);"></div>
              </div>
            `,
            iconSize: [38, 38],
            iconAnchor: [19, 19],
          });

          const m = L.marker([targetLat, targetLng], { icon: targetIcon })
            .bindTooltip(`🎯 CONFIRMED TARGET [${targetLat.toFixed(5)}, ${targetLng.toFixed(5)}]${dist !== null ? ` — ${dist}m` : ''}`, {
              permanent: true,
              direction: 'top',
              offset: [0, -20],
              className: 'target-tooltip'
            })
            .addTo(map);
          targetBoxMarkerRef.current = m;
        } else {
          targetBoxMarkerRef.current.setLatLng([targetLat, targetLng]);
          targetBoxMarkerRef.current.setTooltipContent(
            `🎯 CONFIRMED TARGET [${targetLat.toFixed(5)}, ${targetLng.toFixed(5)}]${dist !== null ? ` — ${dist}m` : ''}`
          );
        }

        // Draw dynamic vector tracking line from Drone -> Target
        if (telemetry.isGpsValid && telemetry.latitude && telemetry.longitude && Math.abs(telemetry.latitude) > 0.001) {
          const lineCoords: [number, number][] = [
            [telemetry.latitude, telemetry.longitude],
            [targetLat, targetLng]
          ];
          if (!targetVectorLineRef.current) {
            targetVectorLineRef.current = L.polyline(lineCoords, {
              color: '#10B981',
              weight: 2.5,
              dashArray: '6, 6',
              opacity: 0.85
            }).addTo(map);
          } else {
            targetVectorLineRef.current.setLatLngs(lineCoords);
          }
        }
      } else {
        if (targetBoxMarkerRef.current && map) {
          map.removeLayer(targetBoxMarkerRef.current);
          targetBoxMarkerRef.current = null;
        }
        if (targetVectorLineRef.current && map) {
          map.removeLayer(targetVectorLineRef.current);
          targetVectorLineRef.current = null;
        }
      }
    });

    const unsubDetections = reconDetectionService.subscribeDetections((detections, latest) => {
      const map = mapRef.current;
      if (!map) return;

      if (latest && latest.gpsFixValid && latest.droneLatitude && latest.droneLongitude) {
        if (!captureSiteMarkerRef.current) {
          const captureIcon = L.divIcon({
            className: 'capture-site-icon',
            html: `
              <div style="position: relative; width: 28px; height: 28px; border-radius: 6px; background: rgba(14, 165, 233, 0.85); border: 1.5px solid #38BDF8; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 8px rgba(56, 189, 248, 0.6);">
                <span style="font-size: 13px;">📷</span>
              </div>
            `,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

          captureSiteMarkerRef.current = L.marker([latest.droneLatitude, latest.droneLongitude], { icon: captureIcon })
            .bindTooltip(`📷 Photo Capture Site (${latest.detectionId})`, {
              permanent: false,
              direction: 'bottom',
              offset: [0, 16]
            })
            .addTo(map);
        } else {
          captureSiteMarkerRef.current.setLatLng([latest.droneLatitude, latest.droneLongitude]);
          captureSiteMarkerRef.current.setTooltipContent(`📷 Photo Capture Site (${latest.detectionId})`);
        }
      } else if (!latest && captureSiteMarkerRef.current && map) {
        map.removeLayer(captureSiteMarkerRef.current);
        captureSiteMarkerRef.current = null;
      }
    });

    return () => {
      unsubTarget();
      unsubDetections();
    };
  }, [telemetry.latitude, telemetry.longitude, telemetry.isGpsValid]);

  // 8. Switch Tile Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (activeTileLayerRef.current) {
      map.removeLayer(activeTileLayerRef.current);
    }
    const newLayer = L.tileLayer(TILE_SERVERS[layer], {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
    }).addTo(map);
    activeTileLayerRef.current = newLayer;
  }, [layer]);

  // 9. Subscribe to Mission Waypoints from groundStationMissionService
  useEffect(() => {
    const unsub = groundStationMissionService.subscribe((mission: GroundStationMission | null) => {
      const map = mapRef.current;
      const wpGroup = waypointsGroupRef.current;
      const polyline = missionPolylineRef.current;
      if (!map || !wpGroup || !polyline) return;

      wpGroup.clearLayers();

      if (!mission || mission.waypoints.length === 0) {
        polyline.setLatLngs([]);
        return;
      }

      const latlngs: L.LatLngExpression[] = [];

      mission.waypoints.forEach((wp, idx) => {
        const pt: L.LatLngExpression = [wp.lat, wp.lng];
        latlngs.push(pt);

        const wpIcon = L.divIcon({
          className: 'wp-leaflet-icon',
          html: `
            <div style="width: 22px; height: 22px; border-radius: 50%; background: #161B22; border: 2px solid #10B981; color: #ffffff; font-size: 10px; font-weight: bold; font-family: monospace; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.6);">
              ${idx + 1}
            </div>
          `,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

        const m = L.marker(pt, { icon: wpIcon }).bindTooltip(`WP ${idx + 1}: ${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)} (Alt: ${wp.altitude}m)`, {
          direction: 'top',
          offset: [0, -12],
        });
        wpGroup.addLayer(m);
      });

      polyline.setLatLngs(latlngs);
    });

    return () => unsub();
  }, []);

  // 10. Toolbar Actions
  const handleLocateDrone = () => {
    const map = mapRef.current;
    if (!map) return;
    const droneHasCoord = Boolean(
      telemetry.isGpsValid &&
      telemetry.latitude &&
      Math.abs(telemetry.latitude) > 0.001 &&
      Math.abs(telemetry.latitude) <= 90 &&
      Math.abs(telemetry.longitude) <= 180
    );
    if (!droneHasCoord) {
      showTemporaryNotice('⚠️ Pixhawk GPS Signal Unavailable (No Lock)');
      audioService.playBeep(400, 150);
      return;
    }
    map.flyTo([telemetry.latitude, telemetry.longitude], 18, { duration: 1.2 });
    audioService.playBeep(880, 50);
    showTemporaryNotice('Map centered on Pixhawk Drone GPS');
  };

  const handleToggleFollow = () => {
    setFollowMode((prev) => {
      const next: 'none' | 'drone' = prev === 'none' ? 'drone' : 'none';
      audioService.playBeep(next === 'none' ? 550 : 880, 60);
      if (next === 'drone') {
        showTemporaryNotice('Follow Mode: Autocenter on DRONE');
        handleLocateDrone();
      } else {
        showTemporaryNotice('Follow Mode: Disabled (Free Pan)');
      }
      return next;
    });
  };

  const handleZoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapRef.current?.zoomOut();
  };

  // Toggle Freehand Draw Mode
  const handleToggleFreehandDraw = () => {
    setIsDrawingFreehand((prev) => {
      const next = !prev;
      if (next) {
        setIsPlacingCircle(false);
        setIsPlacingConcentric(false);
        setIsPinningWp(false);
        setIsMeasuring(false);
        groundStationMissionService.setDrawingTool('draw');
        showTemporaryNotice('✏️ Freehand Draw Mode Active: Drag cursor across map to sketch flight path');
      } else {
        groundStationMissionService.setDrawingTool('select');
      }
      audioService.playBeep(next ? 880 : 500, 60);
      return next;
    });
  };

  // Toggle Interactive Circle Placement Mode
  const handleToggleCircleTool = () => {
    setIsPlacingCircle((prev) => {
      const next = !prev;
      if (next) {
        setIsDrawingFreehand(false);
        setIsPlacingConcentric(false);
        setIsPinningWp(false);
        setIsMeasuring(false);
        groundStationMissionService.setDrawingTool('circle');
        showTemporaryNotice('⭕ Circle Tool Active: Click map to place 15m orbit waypoints');
      } else {
        groundStationMissionService.setDrawingTool('select');
      }
      audioService.playBeep(next ? 880 : 500, 60);
      return next;
    });
  };

  // Toggle Interactive Concentric Circles Placement Mode
  const handleToggleConcentricTool = () => {
    setIsPlacingConcentric((prev) => {
      const next = !prev;
      if (next) {
        setIsDrawingFreehand(false);
        setIsPlacingCircle(false);
        setIsPinningWp(false);
        setIsMeasuring(false);
        groundStationMissionService.setDrawingTool('concentric_circle');
        showTemporaryNotice('🎯 Concentric Circles Active: Click map to place 3-ring orbits (6m, 12m, 18m)');
      } else {
        groundStationMissionService.setDrawingTool('select');
      }
      audioService.playBeep(next ? 880 : 500, 60);
      return next;
    });
  };

  // Toggle Individual Waypoint Pinning Mode
  const handleTogglePinning = () => {
    setIsPinningWp((prev) => {
      const next = !prev;
      if (next) {
        setIsDrawingFreehand(false);
        setIsPlacingCircle(false);
        setIsPlacingConcentric(false);
        setIsMeasuring(false);
        groundStationMissionService.setDrawingTool('point');
        showTemporaryNotice('📍 Pin Mode Active: Click map to add sequential waypoints');
      } else {
        groundStationMissionService.setDrawingTool('select');
      }
      audioService.playBeep(next ? 880 : 500, 60);
      return next;
    });
  };

  // Toggle Ruler Measuring Tool
  const handleToggleMeasuring = () => {
    setIsMeasuring((prev) => {
      const next = !prev;
      if (!next && measureLineRef.current && mapRef.current) {
        mapRef.current.removeLayer(measureLineRef.current);
        measureLineRef.current = null;
        setMeasureDistanceMeters(null);
        measurePointsRef.current = [];
      } else if (next) {
        setIsDrawingFreehand(false);
        setIsPlacingCircle(false);
        setIsPlacingConcentric(false);
        setIsPinningWp(false);
        groundStationMissionService.setDrawingTool('select');
      }
      return next;
    });
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !mapRef.current) return;

    // Direct Lat, Lon format check (e.g. "17.3850, 78.4867")
    const coordMatch = searchQuery.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[3]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        mapRef.current.flyTo([lat, lon], 17);
        audioService.playBeep(920, 70);
        return;
      }
    }

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`
      );
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        mapRef.current.flyTo([lat, lon], 16);
        audioService.playBeep(920, 70);
      }
    } catch (err) {
      console.warn('Geocoding search failed:', err);
    }
  };

  const droneHasValidCoords = Boolean(
    (telemetry.isGpsValid || telemetry.isGpsLocked) &&
    telemetry.latitude &&
    Math.abs(telemetry.latitude) > 0.001 &&
    Math.abs(telemetry.latitude) <= 90 &&
    Math.abs(telemetry.longitude) <= 180
  );

  const isAnyToolActive = isDrawingFreehand || isPlacingCircle || isPlacingConcentric || isPinningWp || isPlacingGeofence;

  return (
    <div
      className={`border border-[var(--uav-card-border)] bg-[#0D1117] h-full w-full min-h-0 flex-1 relative overflow-hidden select-none flex flex-col ${className}`}
    >
      {/* Top Notification / Active Tool Status Pill */}
      {statusMessage && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-lg bg-[#161B22]/95 border border-[var(--uav-primary-blue)] text-white text-[11px] font-sans font-medium shadow-2xl backdrop-blur-md flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <div className="w-2 h-2 rounded-full bg-[var(--uav-primary-blue)] animate-pulse" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Interactive Tool Active Floating Guide Banner */}
      {isAnyToolActive && !statusMessage && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-lg bg-[#161B22]/95 border border-cyan-500/60 text-white text-[11px] font-sans font-medium shadow-2xl backdrop-blur-md flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2">
          {isDrawingFreehand && (
            <>
              <Pencil className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span>Click &amp; drag cursor on map to sketch flight path</span>
            </>
          )}
          {isPlacingCircle && (
            <div className="flex items-center gap-2">
              <CircleIcon className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
              <span>Click map to place Orbit</span>
              <div className="flex items-center gap-1 bg-[#11161D] px-1.5 py-0.5 rounded border border-emerald-500/50 text-[10px] font-mono shadow-sm">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    groundStationMissionService.decreaseCircleRadius(2);
                    audioService.playBeep(700, 30);
                  }}
                  className="w-4 h-4 rounded bg-[#21262D] hover:bg-[#30363D] text-slate-200 hover:text-white flex items-center justify-center font-bold cursor-pointer transition active:scale-90"
                  title="Decrease Orbit Radius (-2m)"
                >
                  <Minus className="w-2.5 h-2.5" />
                </button>
                <span className="text-emerald-300 font-bold px-1 min-w-[28px] text-center">R: {circleRadius}m</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    groundStationMissionService.increaseCircleRadius(2);
                    audioService.playBeep(850, 30);
                  }}
                  className="w-4 h-4 rounded bg-[#21262D] hover:bg-[#30363D] text-slate-200 hover:text-white flex items-center justify-center font-bold cursor-pointer transition active:scale-90"
                  title="Increase Orbit Radius (+2m)"
                >
                  <Plus className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          )}
          {isPlacingConcentric && (
            <div className="flex items-center gap-2">
              <Disc className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />
              <span>Click map to place 3 Concentric Rings</span>
              <div className="flex items-center gap-1 bg-[#11161D] px-1.5 py-0.5 rounded border border-amber-500/50 text-[10px] font-mono shadow-sm">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    groundStationMissionService.decreaseCircleRadius(2);
                    audioService.playBeep(700, 30);
                  }}
                  className="w-4 h-4 rounded bg-[#21262D] hover:bg-[#30363D] text-slate-200 hover:text-white flex items-center justify-center font-bold cursor-pointer transition active:scale-90"
                  title="Decrease Outer Ring Radius (-2m)"
                >
                  <Minus className="w-2.5 h-2.5" />
                </button>
                <span className="text-amber-300 font-bold px-1 min-w-[28px] text-center">
                  R: {circleRadius}m ({Math.max(3, Math.round(circleRadius * 0.4))}m, {Math.max(6, Math.round(circleRadius * 0.8))}m, {circleRadius}m)
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    groundStationMissionService.increaseCircleRadius(2);
                    audioService.playBeep(850, 30);
                  }}
                  className="w-4 h-4 rounded bg-[#21262D] hover:bg-[#30363D] text-slate-200 hover:text-white flex items-center justify-center font-bold cursor-pointer transition active:scale-90"
                  title="Increase Outer Ring Radius (+2m)"
                >
                  <Plus className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          )}
          {isPinningWp && (
            <>
              <MapPin className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
              <span>Click on map to drop sequential flight waypoints</span>
            </>
          )}
          {isPlacingGeofence && (
            <>
              <Shield className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>Click anywhere on map (e.g. Cricket Ground) to set Geofence center</span>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setIsDrawingFreehand(false);
              setIsPlacingCircle(false);
              setIsPlacingConcentric(false);
              setIsPinningWp(false);
              setIsPlacingGeofence(false);
              groundStationMissionService.setDrawingTool('select');
              audioService.playBeep(520, 50);
            }}
            className="ml-2 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono cursor-pointer border border-slate-600 transition"
          >
            Done
          </button>
        </div>
      )}

      {/* Top Controls Bar */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex items-center justify-between gap-2 pointer-events-none flex-wrap sm:flex-nowrap">
        {/* Layer Switcher */}
        <div className="pointer-events-auto">
          <Segmented
            size="sm"
            value={layer}
            onChange={(l) => setLayer(l as any)}
            options={[
              { id: 'Map', label: 'Map' },
              { id: 'Satellite', label: 'Satellite' },
              { id: 'Street', label: 'Street' },
              { id: 'Topo', label: 'Topo' },
              { id: 'Dark', label: 'Dark' },
            ]}
          />
        </div>

        {/* Clear GPS Signal Warning / Status Pill */}
        {!(telemetry.isGpsValid || droneHasValidCoords) ? (
          <div className="pointer-events-auto px-3 py-1 rounded-full bg-rose-950/90 border border-rose-500/80 text-rose-200 text-[11px] font-sans font-semibold shadow-xl backdrop-blur-md flex items-center gap-2 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>⚠️ Pixhawk GPS Signal Unavailable</span>
          </div>
        ) : (
          <div className="pointer-events-auto px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-[10px] font-mono shadow-md backdrop-blur-md flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>PIXHAWK GPS {telemetry.gpsFixType.replace('_', ' ')} · {telemetry.satellites} SATS</span>
          </div>
        )}

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="pointer-events-auto flex items-center bg-[#11161D]/90 backdrop-blur-sm border border-[var(--uav-card-border)] rounded-[8px] px-2.5 py-1 w-56 text-[12px]">
          <Search className="w-3.5 h-3.5 text-[var(--uav-muted)] shrink-0 mr-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search location or Lat,Lon..."
            className="w-full bg-transparent text-[var(--uav-text)] placeholder-[var(--uav-muted)] focus:outline-none"
          />
        </form>
      </div>

      {/* Real Interactive Leaflet Map Container */}
      <div
        ref={mapContainerRef}
        className="w-full h-full relative z-0 bg-[#0D1117]"
        style={{
          cursor: isDrawingFreehand
            ? 'crosshair'
            : isPlacingCircle || isPlacingConcentric || isPlacingGeofence
            ? 'crosshair'
            : isPinningWp
            ? 'crosshair'
            : isMeasuring
            ? 'cell'
            : 'grab',
        }}
      />

      {/* Right Vertical Action Stack */}
      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1">
        <div className="flex flex-col bg-[#11161D]/90 backdrop-blur-sm border border-[var(--uav-card-border)] rounded-[8px] p-1 gap-1 shadow-xl">
          {/* Layer Toggle */}
          <button
            type="button"
            onClick={() => setLayer((prev) => (prev === 'Satellite' ? 'Map' : 'Satellite'))}
            className="w-7 h-7 rounded-[6px] hover:bg-[#21262D] flex items-center justify-center text-[var(--uav-muted)] hover:text-white transition cursor-pointer"
            title="Toggle Map Airspace Layers"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          {/* Locate Drone */}
          <button
            type="button"
            onClick={handleLocateDrone}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              droneHasValidCoords
                ? 'text-emerald-400 hover:bg-[#21262D] hover:text-emerald-300'
                : 'text-[var(--uav-muted)] opacity-50 hover:bg-[#21262D]'
            }`}
            title="Locate Drone (Center on Pixhawk GPS)"
          >
            <LocateFixed className="w-3.5 h-3.5" />
          </button>

          {/* Follow Drone Mode Toggle */}
          <button
            type="button"
            onClick={handleToggleFollow}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              followMode === 'drone'
                ? 'bg-emerald-600 text-white'
                : 'hover:bg-[#21262D] text-[var(--uav-muted)] hover:text-white'
            }`}
            title={followMode === 'drone' ? 'Following Drone (Click to unfreeze)' : 'Follow Drone (Autocenter on Pixhawk GPS)'}
          >
            <Target className="w-3.5 h-3.5" />
          </button>

          <div className="w-full h-[1px] bg-[var(--uav-card-border)] my-0.5" />

          {/* Freehand Draw Path Tool (Special feature requested by user) */}
          <button
            type="button"
            onClick={handleToggleFreehandDraw}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              isDrawingFreehand
                ? 'bg-emerald-600 text-white shadow-lg animate-pulse'
                : 'hover:bg-[#21262D] text-[var(--uav-muted)] hover:text-emerald-300'
            }`}
            title="Freehand Draw Path: Click & Drag cursor across map to sketch flight route"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>

          {/* Interactive Circle Orbit Tool */}
          <button
            type="button"
            onClick={handleToggleCircleTool}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              isPlacingCircle
                ? 'bg-emerald-600 text-white shadow-lg animate-pulse'
                : 'hover:bg-[#21262D] text-[var(--uav-muted)] hover:text-emerald-300'
            }`}
            title="Circle Mission: Click map to place 15m orbit waypoints"
          >
            <CircleIcon className="w-3.5 h-3.5" />
          </button>

          {/* Interactive Concentric Circles Tool */}
          <button
            type="button"
            onClick={handleToggleConcentricTool}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              isPlacingConcentric
                ? 'bg-amber-600 text-white shadow-lg animate-pulse'
                : 'hover:bg-[#21262D] text-[var(--uav-muted)] hover:text-amber-300'
            }`}
            title="Concentric Circles: Click map to place 3 concentric rings (6m, 12m, 18m)"
          >
            <Disc className="w-3.5 h-3.5" />
          </button>

          {/* Pin Individual Waypoint */}
          <button
            type="button"
            onClick={handleTogglePinning}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              isPinningWp
                ? 'bg-[#10B981] text-black font-bold'
                : 'hover:bg-[#21262D] text-[var(--uav-muted)] hover:text-white'
            }`}
            title="Pin Waypoint: Click on map to add waypoints sequentially"
          >
            <MapPin className="w-3.5 h-3.5" />
          </button>

          <div className="w-full h-[1px] bg-[var(--uav-card-border)] my-0.5" />

          {/* In-Place Vertical Altitude Climb at Current Drone Location */}
          <button
            type="button"
            onClick={async () => {
              await mavlinkService.nudgeVerticalAltitude(2);
              showTemporaryNotice('▲ In-Place Climb (+2m) commanded at drone location');
              audioService.playBeep(880, 60);
            }}
            className="w-7 h-7 rounded-[6px] hover:bg-emerald-950/60 text-emerald-400 hover:text-emerald-300 flex items-center justify-center transition cursor-pointer"
            title="Climb Up (+2m) in-place at current drone GPS location"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          {/* In-Place Vertical Altitude Descent at Current Drone Location */}
          <button
            type="button"
            onClick={async () => {
              await mavlinkService.nudgeVerticalAltitude(-2);
              showTemporaryNotice('▼ In-Place Descend (-2m) commanded at drone location');
              audioService.playBeep(660, 60);
            }}
            className="w-7 h-7 rounded-[6px] hover:bg-amber-950/60 text-amber-400 hover:text-amber-300 flex items-center justify-center transition cursor-pointer"
            title="Descend Down (-2m) in-place at current drone GPS location"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          <div className="w-full h-[1px] bg-[var(--uav-card-border)] my-0.5" />

          {/* Ruler Measure Distance Tool */}
          <button
            type="button"
            onClick={handleToggleMeasuring}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              isMeasuring ? 'bg-amber-600 text-white' : 'hover:bg-[#21262D] text-[var(--uav-muted)] hover:text-white'
            }`}
            title="Ruler Measure Distance (Click 2 points)"
          >
            <Ruler className="w-3.5 h-3.5" />
          </button>

          {/* Geofence Quick Reposition Tool */}
          <button
            type="button"
            onClick={() => {
              const next = !isPlacingGeofence;
              setIsPlacingGeofence(next);
              if (next) {
                showTemporaryNotice('🎯 Click anywhere on map (e.g. Cricket Ground) to position Geofence center');
                audioService.playBeep(920, 80);
              }
            }}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              isPlacingGeofence
                ? 'bg-amber-500 text-black font-bold shadow-lg animate-pulse'
                : 'hover:bg-[#21262D] text-[var(--uav-muted)] hover:text-amber-300'
            }`}
            title="Place Geofence on Map: Click to set center (e.g. Cricket Ground)"
          >
            <MapPin className="w-3.5 h-3.5 text-amber-400" />
          </button>

          {/* Geofence Modal Trigger */}
          <button
            type="button"
            onClick={() => setIsGeofenceModalOpen(true)}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition cursor-pointer ${
              showGeofence
                ? geofenceService.getState().isBreached
                  ? 'bg-rose-600 border border-rose-500 text-white animate-pulse'
                  : 'bg-amber-600/30 border border-amber-500/60 text-amber-300'
                : 'hover:bg-[#21262D] text-[var(--uav-muted)] hover:text-white'
            }`}
            title="Open Autonomous Geofence & Boundary Settings (ADDC Rule 3.3)"
          >
            <Shield className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Zoom In / Out */}
        <div className="flex flex-col bg-[#11161D]/90 backdrop-blur-sm border border-[var(--uav-card-border)] rounded-[8px] p-1 gap-1 mt-1">
          <button
            type="button"
            onClick={handleZoomIn}
            className="w-7 h-7 rounded-[6px] hover:bg-[#21262D] flex items-center justify-center text-[var(--uav-muted)] hover:text-white transition cursor-pointer"
            title="Zoom In"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="w-7 h-7 rounded-[6px] hover:bg-[#21262D] flex items-center justify-center text-[var(--uav-muted)] hover:text-white transition cursor-pointer"
            title="Zoom Out"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom Left Floating GPS Status Card & Scale Bar */}
      <div className="absolute left-2.5 bottom-2.5 z-20 flex flex-col gap-2 pointer-events-none">
        {/* GPS Status HUD */}
        <div className="w-64 rounded-[8px] border border-[var(--uav-card-border)] bg-[#0B1424]/95 backdrop-blur-sm p-2.5 text-[11px] font-sans flex flex-col gap-1.5 shadow-xl pointer-events-auto">
          {/* Header */}
          <div className="flex items-center justify-between pb-1.5 border-b border-[var(--uav-card-border)]">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${droneHasValidCoords ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              <span className="font-semibold text-white text-[11px]">Pixhawk FC GPS</span>
            </div>

            <span className="font-mono text-[9px] text-[var(--uav-muted)]">
              {followMode === 'drone' ? 'FOLLOWING DRONE' : 'FREE CAM'}
            </span>
          </div>

          {/* Drone FC View */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--uav-muted)]">Fix Status:</span>
              <span className={`font-bold ${droneHasValidCoords ? 'text-emerald-400' : 'text-rose-400'}`}>
                {droneHasValidCoords
                  ? `${telemetry.gpsFixType.replace('_', ' ')} (${telemetry.satellites} Sats)`
                  : 'Pixhawk GPS Unavailable'}
              </span>
            </div>
            <div className="grid grid-cols-2 text-[10px] text-[var(--uav-muted)]">
              <span>GPS Link</span>
              <span className={`text-right font-mono font-medium ${telemetry.isGpsLocked ? 'text-emerald-400' : 'text-rose-400'}`}>
                {telemetry.isGpsLocked ? 'CONNECTED ✓' : 'NO SIGNAL ✗'}
              </span>
              <span>Latitude</span>
              <span className="text-right text-[var(--uav-text)] font-mono font-medium">
                {droneHasValidCoords ? `${telemetry.latitude.toFixed(7)}°` : '--'}
              </span>
              <span>Longitude</span>
              <span className="text-right text-[var(--uav-text)] font-mono font-medium">
                {droneHasValidCoords ? `${telemetry.longitude.toFixed(7)}°` : '--'}
              </span>
              <span>GPS MSL Alt</span>
              <span className="text-right text-[var(--uav-text)] font-mono font-medium">
                {droneHasValidCoords ? `${(telemetry.gpsAltitudeMeters ?? telemetry.altitudeMeters).toFixed(1)} m` : '--'}
              </span>
              <span>Relative Alt</span>
              <span className="text-right text-[var(--uav-text)] font-mono font-medium">
                {telemetry.altitudeMeters.toFixed(1)} m
              </span>
              <span>Satellites</span>
              <span className="text-right text-[var(--uav-text)] font-mono font-medium">
                {telemetry.satellites} visible
              </span>
              <span>HDOP</span>
              <span className="text-right text-[var(--uav-text)] font-mono font-medium">
                {telemetry.hdop.toFixed(2)}
              </span>
              <span>Last Update</span>
              <span className="text-right text-[var(--uav-text)] font-mono font-medium">
                {telemetry.gpsAgeMs !== undefined
                  ? (telemetry.gpsAgeMs < 1000 ? '<1s ago' : `${(telemetry.gpsAgeMs / 1000).toFixed(1)}s ago`)
                  : 'Awaiting Fix'}
              </span>
            </div>

            {/* Action row for drone */}
            <div className="flex items-center justify-between pt-1 border-t border-[var(--uav-card-border)]/60 text-[10px]">
              <button
                type="button"
                onClick={handleLocateDrone}
                disabled={!droneHasValidCoords}
                className="px-2 py-0.5 rounded bg-[#21262D] hover:bg-[#262C36] text-slate-200 hover:text-white disabled:opacity-40 transition cursor-pointer font-medium"
              >
                Pan to Drone
              </button>
              <button
                type="button"
                onClick={handleToggleFollow}
                className={`px-2 py-0.5 rounded transition cursor-pointer font-medium ${
                  followMode === 'drone'
                    ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                    : 'bg-[#21262D] hover:bg-[#262C36] text-slate-200 hover:text-white'
                }`}
              >
                {followMode === 'drone' ? 'Stop Follow' : 'Follow Drone'}
              </button>
            </div>
          </div>
        </div>

        {/* Ruler Result or Scale Bar */}
        <div className="flex items-center gap-2">
          {measureDistanceMeters !== null ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-950/90 border border-amber-500/80 rounded text-[10px] font-mono text-amber-200 pointer-events-auto">
              <span>Distance: {measureDistanceMeters} m</span>
              <button
                type="button"
                onClick={() => {
                  setMeasureDistanceMeters(null);
                  if (measureLineRef.current && mapRef.current) {
                    mapRef.current.removeLayer(measureLineRef.current);
                    measureLineRef.current = null;
                  }
                }}
                className="text-amber-400 hover:text-white cursor-pointer ml-1"
                title="Clear measurement"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="px-1.5 py-0.5 bg-[#0B1424]/80 border border-[var(--uav-card-border)] rounded text-[9px] font-mono text-[var(--uav-text)]">
              100 m
            </div>
          )}
        </div>
      </div>

      {/* Standalone Geofence Modal */}
      <GeofenceControlModal
        isOpen={isGeofenceModalOpen}
        onClose={() => setIsGeofenceModalOpen(false)}
        onSelectOnMap={() => {
          setIsGeofenceModalOpen(false);
          setIsPlacingGeofence(true);
          showTemporaryNotice('📍 Click anywhere on map (e.g. Cricket Ground) to set Geofence center');
        }}
      />
    </div>
  );
};
