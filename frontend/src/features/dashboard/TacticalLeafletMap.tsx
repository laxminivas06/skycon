/**
 * Tactical Leaflet Vector Map (Requirement R4)
 * Baseline Specification: Technical Project Report Rev 2.4.0-PROD
 *
 * Implements an interactive geospatial mission map with:
 * 1. Live Drone Position Marker:
 *    - HTML L.divIcon with a 60px pulsating halo
 *    - Dynamic SVG heading beam oriented to headingDeg
 * 2. Historical Breadcrumb Trail:
 *    - Continuous polyline tracking coordinates (up to 1000 points, sampled at 5 Hz)
 *    - Styled in cyan (#38bdf8) with dashed flight trace
 * 3. Polygon Geofence Boundary Visualizer:
 *    - Uses committed Pixhawk parameters (FENCE_ALT_MAX = 20.0m, FENCE_MARGIN = 2.0m)
 *    - Outer hard boundary rendered in solid crimson (#ef4444)
 *    - Inner warning margin buffer rendered in dashed amber (#f59e0b)
 * 4. Pinned QR Target Markers:
 *    - Plotted at sub-meter georeferenced coordinates
 *    - Interactive inspection popup with decoded payload, two-digit code, coordinates, and snapshot thumbnail
 * 5. Waypoint Mission Polyline:
 *    - Displays planned Archimedean spiral trajectory in emerald green (#22c55e)
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DroneTelemetry } from '../../types/mission';
import { reconDetectionService } from '../../services/reconDetectionService';
import { QRDetectionRecord } from '../../types/recon';
import { geofenceService } from '../../services/geofenceService';
import { MapPin, Navigation, Crosshair, Layers, ShieldAlert } from 'lucide-react';

export interface TacticalTargetPin {
  id: string;
  code: string;
  payload: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  photoUrl?: string;
  confidence?: number;
}

export interface TacticalWaypoint {
  seq: number;
  lat: number;
  lon: number;
  alt: number;
  command?: number;
}

export interface TacticalLeafletMapProps {
  telemetry: DroneTelemetry;
  breadcrumbs?: Array<{ lat: number; lng: number; alt?: number; timestamp?: number }>;
  waypoints?: TacticalWaypoint[];
  targets?: TacticalTargetPin[];
  geofenceRadiusMeters?: number; // default 20.0m
  geofenceMarginMeters?: number; // default 2.0m per FENCE_MARGIN = 2.0
  geofencePolygon?: Array<{ lat: number; lng: number }>;
  centerLat?: number;
  centerLon?: number;
  zoom?: number;
  className?: string;
  onTargetSelect?: (target: TacticalTargetPin) => void;
  onMapClick?: (lat: number, lon: number) => void;
}

const TILE_LAYERS = {
  Satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  Dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  Street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
};

export const TacticalLeafletMap: React.FC<TacticalLeafletMapProps> = ({
  telemetry,
  breadcrumbs: initialBreadcrumbs,
  waypoints = [],
  targets: propTargets,
  geofenceRadiusMeters = 20.0,
  geofenceMarginMeters = 2.0,
  geofencePolygon: customGeofencePolygon,
  centerLat,
  centerLon,
  zoom = 18,
  className = '',
  onTargetSelect,
  onMapClick
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Layers
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const breadcrumbPolylineRef = useRef<L.Polyline | null>(null);
  const missionPolylineRef = useRef<L.Polyline | null>(null);
  const waypointsLayerRef = useRef<L.LayerGroup | null>(null);
  const geofenceOuterLayerRef = useRef<L.Polygon | null>(null);
  const geofenceInnerLayerRef = useRef<L.Polygon | null>(null);
  const targetsLayerRef = useRef<L.LayerGroup | null>(null);

  const [activeLayer, setActiveLayer] = useState<'Satellite' | 'Dark' | 'Street'>('Satellite');
  const [internalBreadcrumbs, setInternalBreadcrumbs] = useState<Array<[number, number]>>([]);
  const [detectedTargets, setDetectedTargets] = useState<TacticalTargetPin[]>([]);

  // 1. Subscribe to Live QR Detections from Recon Detection Service
  useEffect(() => {
    if (propTargets && propTargets.length > 0) {
      setDetectedTargets(propTargets);
      return;
    }

    const unsub = reconDetectionService.subscribeDetections((records: QRDetectionRecord[]) => {
      const pins: TacticalTargetPin[] = records
        .filter((r) => r.targetLocation !== null)
        .map((r) => ({
          id: r.detectionId,
          code: r.twoDigitCode || 'QR',
          payload: r.payload || '',
          latitude: r.targetLocation!.latitude,
          longitude: r.targetLocation!.longitude,
          timestamp: r.timestamp,
          photoUrl: r.thumbnailDataUrl || r.photoDataUrl,
          confidence: undefined
        }));
      setDetectedTargets(pins);
    });

    return () => unsub();
  }, [propTargets]);

  // 2. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialLat = centerLat || telemetry.latitude || 13.0827;
    const initialLon = centerLon || telemetry.longitude || 80.2707;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom,
      zoomControl: false,
      attributionControl: false
    });
    mapRef.current = map;

    // Base Tile Layer
    const tileLayer = L.tileLayer(TILE_LAYERS[activeLayer], {
      maxZoom: 22,
      maxNativeZoom: 19
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // Breadcrumb Polyline in Cyan (#38bdf8), 3px dashed line
    const breadcrumbs = L.polyline([], {
      color: '#38bdf8',
      weight: 3,
      opacity: 0.85,
      dashArray: '4, 6',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    breadcrumbPolylineRef.current = breadcrumbs;

    // Mission Waypoint Polyline in Emerald (#22c55e)
    const missionLine = L.polyline([], {
      color: '#22c55e',
      weight: 2.5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    missionPolylineRef.current = missionLine;

    // Layer Groups
    waypointsLayerRef.current = L.layerGroup().addTo(map);
    targetsLayerRef.current = L.layerGroup().addTo(map);

    // Live Drone Marker with Pulsating Halo and Dynamic Heading Beam
    const droneHeading = telemetry.heading || 0;
    const droneIcon = L.divIcon({
      className: 'tactical-drone-marker',
      html: `
        <div style="position: relative; width: 64px; height: 64px; margin-left: -32px; margin-top: -32px; display: flex; align-items: center; justify-content: center; pointer-events: none;">
          <!-- Pulsating Halo -->
          <div style="position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(56, 189, 248, 0.7); background: rgba(56, 189, 248, 0.2); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <!-- Dynamic Heading Beam (SVG Conical Ray) -->
          <div id="tactical-heading-beam" style="position: absolute; top: 0px; left: 50%; transform: translateX(-50%) rotate(${droneHeading}deg); transform-origin: 50% 32px; width: 0; height: 0; border-left: 14px solid transparent; border-right: 14px solid transparent; border-top: 42px solid rgba(56, 189, 248, 0.6); pointer-events: none; filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.8));"></div>
          <!-- Vehicle Center Core -->
          <div style="width: 22px; height: 22px; border-radius: 50%; background: #0284c7; border: 2.5px solid #ffffff; box-shadow: 0 0 12px rgba(56, 189, 248, 0.9); display: flex; align-items: center; justify-content: center; position: absolute; z-index: 10;">
            <div style="width: 6px; height: 6px; border-radius: 50%; background: #ffffff;"></div>
          </div>
        </div>
      `,
      iconSize: [64, 64],
      iconAnchor: [32, 32]
    });

    const marker = L.marker([initialLat, initialLon], {
      icon: droneIcon,
      zIndexOffset: 1000
    }).addTo(map);
    droneMarkerRef.current = marker;

    // Handle Map Clicks
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    });

    // Invalidate map size on window resize
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 3. Switch Tile Layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tileLayerRef.current) return;

    tileLayerRef.current.setUrl(TILE_LAYERS[activeLayer]);
  }, [activeLayer]);

  // 4. Update Drone Position & Dynamic Heading Beam
  useEffect(() => {
    const map = mapRef.current;
    const marker = droneMarkerRef.current;
    if (!map || !marker) return;

    const lat = telemetry.latitude;
    const lon = telemetry.longitude;

    if (lat && lon && Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001) {
      marker.setLatLng([lat, lon]);

      const heading = Math.round(((telemetry.heading || 0) % 360 + 360) % 360);
      const beamEl = document.getElementById('tactical-heading-beam');
      if (beamEl) {
        beamEl.style.transform = `translateX(-50%) rotate(${heading}deg)`;
      }

      // Append to historical breadcrumb trail (capped at 1000 points)
      setInternalBreadcrumbs((prev) => {
        const next = [...prev, [lat, lon] as [number, number]];
        if (next.length > 1000) {
          return next.slice(next.length - 1000);
        }
        return next;
      });
    }
  }, [telemetry.latitude, telemetry.longitude, telemetry.heading]);

  // 5. Update Breadcrumb Polyline
  useEffect(() => {
    if (!breadcrumbPolylineRef.current) return;
    const points = initialBreadcrumbs
      ? initialBreadcrumbs.map((b) => [b.lat, b.lng] as [number, number])
      : internalBreadcrumbs;
    breadcrumbPolylineRef.current.setLatLngs(points);
  }, [internalBreadcrumbs, initialBreadcrumbs]);

  // 6. Render Geofence (Outer Hard Boundary in Crimson, Inner Warning in Amber)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const centerLatVal = centerLat || telemetry.latitude || 13.0827;
    const centerLonVal = centerLon || telemetry.longitude || 80.2707;

    // Helper: generate circular polygon coordinates
    const generateCircleCoords = (lat: number, lon: number, radiusM: number, numPoints = 36) => {
      const coords: [number, number][] = [];
      const latRad = (lat * Math.PI) / 180.0;
      for (let i = 0; i <= numPoints; i++) {
        const angle = (i * 2.0 * Math.PI) / numPoints;
        const dNorth = radiusM * Math.cos(angle);
        const dEast = radiusM * Math.sin(angle);
        const dLat = (dNorth / 6378137.0) * (180.0 / Math.PI);
        const dLon = (dEast / (6378137.0 * Math.cos(latRad))) * (180.0 / Math.PI);
        coords.push([lat + dLat, lon + dLon]);
      }
      return coords;
    };

    if (customGeofencePolygon && customGeofencePolygon.length >= 3) {
      // Custom Polygon Geofence
      const outerCoords = customGeofencePolygon.map((p) => [p.lat, p.lng] as [number, number]);

      if (geofenceOuterLayerRef.current) {
        geofenceOuterLayerRef.current.setLatLngs(outerCoords);
      } else {
        geofenceOuterLayerRef.current = L.polygon(outerCoords, {
          color: '#ef4444', // Crimson outer hard boundary
          weight: 2.5,
          opacity: 0.9,
          fillColor: '#ef4444',
          fillOpacity: 0.1
        }).addTo(map);
      }
    } else {
      // Circular Geofence using FENCE_ALT_MAX / FENCE_MARGIN parameters
      const outerCoords = generateCircleCoords(centerLatVal, centerLonVal, geofenceRadiusMeters);
      const innerRadius = Math.max(2.0, geofenceRadiusMeters - geofenceMarginMeters);
      const innerCoords = generateCircleCoords(centerLatVal, centerLonVal, innerRadius);

      // 1. Outer Hard Boundary (Crimson #ef4444)
      if (geofenceOuterLayerRef.current) {
        geofenceOuterLayerRef.current.setLatLngs(outerCoords);
      } else {
        geofenceOuterLayerRef.current = L.polygon(outerCoords, {
          color: '#ef4444',
          weight: 2.5,
          opacity: 0.95,
          fillColor: '#ef4444',
          fillOpacity: 0.08
        }).addTo(map);
      }

      // 2. Inner Warning Margin Buffer (Dashed Amber #f59e0b)
      if (geofenceInnerLayerRef.current) {
        geofenceInnerLayerRef.current.setLatLngs(innerCoords);
      } else {
        geofenceInnerLayerRef.current = L.polygon(innerCoords, {
          color: '#f59e0b',
          weight: 2.0,
          dashArray: '6, 6',
          opacity: 0.9,
          fillColor: '#f59e0b',
          fillOpacity: 0.05
        }).addTo(map);
      }
    }
  }, [centerLat, centerLon, telemetry.latitude, telemetry.longitude, geofenceRadiusMeters, geofenceMarginMeters, customGeofencePolygon]);

  // 7. Render Waypoints & Mission Polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !missionPolylineRef.current || !waypointsLayerRef.current) return;

    waypointsLayerRef.current.clearLayers();

    if (waypoints.length > 0) {
      const latlngs = waypoints.map((w) => [w.lat, w.lon] as [number, number]);
      missionPolylineRef.current.setLatLngs(latlngs);

      waypoints.forEach((wp) => {
        const isTakeoff = wp.command === 22;
        const isRtl = wp.command === 20;

        const wpMarker = L.circleMarker([wp.lat, wp.lon], {
          radius: wp.seq === 0 ? 6 : 4,
          fillColor: isTakeoff ? '#f59e0b' : isRtl ? '#a855f7' : '#22c55e',
          color: '#ffffff',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.9
        });

        wpMarker.bindTooltip(`WP #${wp.seq} (${wp.alt}m)`, {
          direction: 'top',
          offset: [0, -6],
          className: 'bg-slate-900 text-white font-mono text-[9px] px-1 py-0.5 rounded border border-slate-700'
        });

        waypointsLayerRef.current?.addLayer(wpMarker);
      });
    } else {
      missionPolylineRef.current.setLatLngs([]);
    }
  }, [waypoints]);

  // 8. Render Pinned QR Target Markers with Interactive Inspection Popups
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !targetsLayerRef.current) return;

    targetsLayerRef.current.clearLayers();

    detectedTargets.forEach((target) => {
      const targetIcon = L.divIcon({
        className: 'qr-target-pin',
        html: `
          <div style="position: relative; width: 36px; height: 36px; margin-left: -18px; margin-top: -36px; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <!-- Outer Badge -->
            <div style="background: #ef4444; color: #ffffff; border: 2px solid #ffffff; border-radius: 8px; padding: 2px 6px; font-family: monospace; font-size: 11px; font-weight: 900; box-shadow: 0 4px 10px rgba(0,0,0,0.6); display: flex; align-items: center; gap: 3px;">
              <span>🎯</span>
              <span>${target.code || 'QR'}</span>
            </div>
            <!-- Pointer Pin Arrow -->
            <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid #ef4444; margin-top: -1px;"></div>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 36]
      });

      const targetMarker = L.marker([target.latitude, target.longitude], {
        icon: targetIcon,
        zIndexOffset: 500
      });

      // Inspection Popup Content
      const popupHtml = `
        <div style="font-family: monospace; background: #0f172a; color: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #334155; width: 220px;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #334155; padding-bottom: 4px; margin-bottom: 6px;">
            <span style="font-size: 11px; font-weight: 800; color: #38bdf8;">TARGET DETECTED</span>
            <span style="background: #ef4444; color: #fff; font-size: 10px; font-weight: 900; padding: 1px 4px; border-radius: 4px;">#${target.code}</span>
          </div>

          <div style="font-size: 10px; line-height: 1.4; color: #94a3b8; margin-bottom: 6px;">
            <div><strong>PAYLOAD:</strong> <span style="color: #ffffff;">${target.payload}</span></div>
            <div><strong>LAT:</strong> ${target.latitude.toFixed(7)}</div>
            <div><strong>LON:</strong> ${target.longitude.toFixed(7)}</div>
            <div><strong>TIME:</strong> ${new Date(target.timestamp).toLocaleTimeString()}</div>
            ${target.confidence ? `<div><strong>CONF:</strong> ${(target.confidence * 100).toFixed(0)}%</div>` : ''}
          </div>

          ${target.photoUrl ? `
            <div style="margin-top: 6px; border-radius: 4px; overflow: hidden; border: 1px solid #334155;">
              <img src="${target.photoUrl}" alt="Target Snapshot" style="width: 100%; height: 90px; object-fit: cover;" />
            </div>
          ` : ''}
        </div>
      `;

      targetMarker.bindPopup(popupHtml, {
        className: 'tactical-target-leaflet-popup',
        maxWidth: 240
      });

      targetMarker.on('click', () => {
        if (onTargetSelect) {
          onTargetSelect(target);
        }
      });

      targetsLayerRef.current?.addLayer(targetMarker);
    });
  }, [detectedTargets, onTargetSelect]);

  // Center on Drone action
  const handleCenterDrone = () => {
    const map = mapRef.current;
    if (!map) return;
    if (telemetry.latitude && telemetry.longitude && Math.abs(telemetry.latitude) > 0.001) {
      map.panTo([telemetry.latitude, telemetry.longitude], { animate: true });
    }
  };

  return (
    <div className={`relative w-full h-full min-h-[300px] rounded-xl overflow-hidden border border-slate-800 bg-slate-950 ${className}`}>
      {/* Map Backing Div */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Top Floating Controls */}
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-2 py-1 rounded-lg border border-slate-700 shadow-xl text-xs font-mono text-slate-200">
        <span className="text-[10px] uppercase font-bold text-slate-400">Layer:</span>
        {(['Satellite', 'Dark', 'Street'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setActiveLayer(l)}
            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
              activeLayer === l ? 'bg-sky-600 text-white' : 'hover:bg-slate-800 text-slate-400'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Recenter on Drone Button */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
        <button
          onClick={handleCenterDrone}
          title="Center on Drone Position"
          className="w-8 h-8 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-sky-400 flex items-center justify-center shadow-xl transition-colors cursor-pointer"
        >
          <Crosshair className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom Floating Telemetry & Geofence Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-2 bg-slate-900/95 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 shadow-xl text-[10px] font-mono text-slate-300">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span>DRONE</span>
        </div>
        <div className="w-px h-3 bg-slate-700" />
        <div className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-sky-400 border-b border-dashed border-sky-400" />
          <span>TRAIL</span>
        </div>
        <div className="w-px h-3 bg-slate-700" />
        <div className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-red-500" />
          <span>HARD FENCE (20m)</span>
        </div>
        <div className="w-px h-3 bg-slate-700" />
        <div className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-amber-400 border-b border-dashed border-amber-400" />
          <span>MARGIN (2m)</span>
        </div>
        {detectedTargets.length > 0 && (
          <>
            <div className="w-px h-3 bg-slate-700" />
            <div className="flex items-center gap-1 text-red-400 font-bold">
              <span>🎯 {detectedTargets.length} TARGET{detectedTargets.length > 1 ? 'S' : ''}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
