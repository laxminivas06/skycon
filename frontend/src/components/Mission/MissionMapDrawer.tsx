import React, { useState, useEffect, useRef } from 'react';
import { 
  AutonomousMissionConfig, 
  SearchBoundaryConfig, 
  SearchBoundaryType, 
  LatLngPoint, 
  DroneTelemetry, 
  HomePoint 
} from '../../types/mission';
import { searchEngine } from '../../services/searchEngine';
import { 
  MapPin, 
  Compass, 
  Maximize2, 
  Square, 
  Circle, 
  Pentagon, 
  Edit3, 
  RefreshCw, 
  Check, 
  X, 
  Crosshair, 
  ShieldCheck, 
  ShieldAlert, 
  Layers,
  ArrowRight,
  Sparkles,
  Sliders
} from 'lucide-react';

interface MissionMapDrawerProps {
  config: AutonomousMissionConfig;
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  onSaveBoundary: (boundary: SearchBoundaryConfig) => void;
  onClose?: () => void;
  isInline?: boolean;
}

// Convert meters offset from reference lat/lon to GPS coordinates
function metersToLatLng(ref: LatLngPoint, dxMeters: number, dyMeters: number): LatLngPoint {
  const earthRadius = 6378137;
  const dLat = (dyMeters / earthRadius) * (180 / Math.PI);
  const dLon = (dxMeters / (earthRadius * Math.cos((ref.lat * Math.PI) / 180))) * (180 / Math.PI);
  return {
    lat: ref.lat + dLat,
    lng: ref.lng + dLon
  };
}

// Convert GPS coordinates to meters offset from reference point
function latLngToMeters(ref: LatLngPoint, target: LatLngPoint): { x: number; y: number } {
  const earthRadius = 6378137;
  const dLat = ((target.lat - ref.lat) * Math.PI) / 180;
  const dLon = ((target.lng - ref.lng) * Math.PI) / 180;
  const y = dLat * earthRadius;
  const x = dLon * earthRadius * Math.cos((ref.lat * Math.PI) / 180);
  return { x, y };
}

// Point-in-polygon check
function isPointInPolygon(pt: { x: number; y: number }, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export const MissionMapDrawer: React.FC<MissionMapDrawerProps> = ({
  config,
  telemetry,
  homePoint,
  onSaveBoundary,
  onClose,
  isInline = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [boundaryType, setBoundaryType] = useState<SearchBoundaryType>(config.searchBoundary.type || 'RECTANGLE');
  const [coordinates, setCoordinates] = useState<LatLngPoint[]>(config.searchBoundary.coordinates || []);
  const [circleRadius, setCircleRadius] = useState<number>(config.searchBoundary.circleRadiusMeters || 35);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [mapScale, setMapScale] = useState<number>(2.0); // pixels per meter
  const [mapOffset, setMapOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mapMode, setMapMode] = useState<'TACTICAL_DARK' | 'SATELLITE'>('TACTICAL_DARK');

  const refPoint: LatLngPoint = homePoint.isSet && homePoint.latitude !== 0
    ? { lat: homePoint.latitude, lng: homePoint.longitude }
    : { lat: telemetry.latitude || 12.9715987, lng: telemetry.longitude || 77.5945627 };

  // Generate default shapes relative to reference point
  const generatePreset = (type: SearchBoundaryType) => {
    setBoundaryType(type);
    if (type === 'RECTANGLE') {
      const w = 80;
      const h = 60;
      const p1 = metersToLatLng(refPoint, -w / 2, 20 + h);
      const p2 = metersToLatLng(refPoint, w / 2, 20 + h);
      const p3 = metersToLatLng(refPoint, w / 2, 20);
      const p4 = metersToLatLng(refPoint, -w / 2, 20);
      setCoordinates([p1, p2, p3, p4]);
    } else if (type === 'SQUARE') {
      const s = 60;
      const p1 = metersToLatLng(refPoint, -s / 2, 20 + s);
      const p2 = metersToLatLng(refPoint, s / 2, 20 + s);
      const p3 = metersToLatLng(refPoint, s / 2, 20);
      const p4 = metersToLatLng(refPoint, -s / 2, 20);
      setCoordinates([p1, p2, p3, p4]);
    } else if (type === 'CIRCLE') {
      const r = 35;
      setCircleRadius(r);
      const center = metersToLatLng(refPoint, 0, 50);
      const pts: LatLngPoint[] = [];
      const numPts = 16;
      for (let i = 0; i < numPts; i++) {
        const theta = (i / numPts) * 2 * Math.PI;
        pts.push(metersToLatLng(center, Math.cos(theta) * r, Math.sin(theta) * r));
      }
      setCoordinates(pts);
    } else if (type === 'POLYGON' || type === 'CUSTOM') {
      const p1 = metersToLatLng(refPoint, -40, 70);
      const p2 = metersToLatLng(refPoint, 20, 80);
      const p3 = metersToLatLng(refPoint, 50, 40);
      const p4 = metersToLatLng(refPoint, 30, 15);
      const p5 = metersToLatLng(refPoint, -30, 20);
      setCoordinates([p1, p2, p3, p4, p5]);
    }
  };

  // Initialize coordinates if empty
  useEffect(() => {
    if (!coordinates || coordinates.length === 0) {
      generatePreset(boundaryType);
    }
  }, []);

  // Calculate polygon area in m²
  const calculateAreaSquareMeters = (): number => {
    if (!coordinates || coordinates.length < 3) return 0;
    const meterPts = coordinates.map((c) => latLngToMeters(refPoint, c));
    let area = 0;
    for (let i = 0; i < meterPts.length; i++) {
      const j = (i + 1) % meterPts.length;
      area += meterPts[i].x * meterPts[j].y;
      area -= meterPts[j].x * meterPts[i].y;
    }
    return Math.abs(area / 2);
  };

  // Check if drone is currently inside configured search area
  const droneMeters = latLngToMeters(refPoint, {
    lat: telemetry.latitude || refPoint.lat,
    lng: telemetry.longitude || refPoint.lng
  });
  const boundaryMeters = coordinates.map((c) => latLngToMeters(refPoint, c));
  const isDroneInsideArea = boundaryMeters.length >= 3 ? isPointInPolygon(droneMeters, boundaryMeters) : false;

  // Render tactical map and boundary canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2 + mapOffset.x;
      const centerY = height / 2 + mapOffset.y;

      // Background styling
      if (mapMode === 'SATELLITE') {
        // Satellite Terrain Gradient Fallback
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, '#101d18');
        grad.addColorStop(0.5, '#172720');
        grad.addColorStop(1, '#0e1815');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      } else {
        // High-Contrast Tactical Cyber-Dark
        ctx.fillStyle = '#080d19';
        ctx.fillRect(0, 0, width, height);
      }

      // Draw Tactical Grid
      ctx.strokeStyle = mapMode === 'SATELLITE' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = 1;
      const gridPixels = 20 * mapScale; // every 20 meters
      if (gridPixels > 10) {
        for (let x = (centerX % gridPixels); x < width; x += gridPixels) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = (centerY % gridPixels); y < height; y += gridPixels) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
      }

      // Draw Distance Concentric Rings from Home (25m, 50m, 75m, 100m, 150m)
      const distances = [25, 50, 75, 100, 150];
      distances.forEach((d) => {
        const r = d * mapScale;
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`${d}m`, centerX + r + 3, centerY - 2);
      });

      // Transform boundary coordinates to canvas pixels
      const screenBoundary = boundaryMeters.map((m) => ({
        x: centerX + m.x * mapScale,
        y: centerY - m.y * mapScale // Invert Y for standard Cartesian
      }));

      // Render Search Boundary Polygon
      if (screenBoundary.length >= 3) {
        // Fill Area
        ctx.fillStyle = isDroneInsideArea ? 'rgba(234, 179, 8, 0.12)' : 'rgba(234, 179, 8, 0.08)';
        ctx.beginPath();
        ctx.moveTo(screenBoundary[0].x, screenBoundary[0].y);
        for (let i = 1; i < screenBoundary.length; i++) {
          ctx.lineTo(screenBoundary[i].x, screenBoundary[i].y);
        }
        ctx.closePath();
        ctx.fill();

        // Stroke Outline (Glowing Amber)
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Render Computed Search Pattern Preview (Grid, Spiral, Perimeter, Adaptive)
        try {
          const algo = searchEngine.getAlgorithm(config.searchAlgorithm);
          const activeBoundary: SearchBoundaryConfig = {
            type: boundaryType,
            coordinates,
            circleRadiusMeters: circleRadius,
            circleCenter: refPoint
          };
          const pathRes = algo.generateSearchPath(
            activeBoundary,
            config.searchAltitude || 10,
            config.flightSpeedMs || 3.0,
            { fovHorizontalDeg: 70, fovVerticalDeg: 52, aspectRatio: 16 / 9 },
            config.desiredOverlapPercent || 25
          );

          if (pathRes.waypoints && pathRes.waypoints.length > 1) {
            ctx.strokeStyle = config.searchAlgorithm === 'ADAPTIVE' 
              ? 'rgba(16, 185, 129, 0.6)' 
              : config.searchAlgorithm === 'SPIRAL' 
              ? 'rgba(56, 189, 248, 0.6)' 
              : config.searchAlgorithm === 'PERIMETER'
              ? 'rgba(236, 72, 153, 0.6)'
              : 'rgba(250, 204, 21, 0.6)';
            ctx.lineWidth = 1.6;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();

            pathRes.waypoints.forEach((wp, idx) => {
              const localPt = latLngToMeters(refPoint, { lat: wp.lat, lng: wp.lng });
              const sx = centerX + localPt.x * mapScale;
              const sy = centerY - localPt.y * mapScale;
              if (idx === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            });
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw small waypoint nodes along flight path
            pathRes.waypoints.forEach((wp, idx) => {
              const localPt = latLngToMeters(refPoint, { lat: wp.lat, lng: wp.lng });
              const sx = centerX + localPt.x * mapScale;
              const sy = centerY - localPt.y * mapScale;
              ctx.fillStyle = idx === 0 ? '#10b981' : idx === pathRes.waypoints.length - 1 ? '#f43f5e' : '#eab308';
              ctx.beginPath();
              ctx.arc(sx, sy, idx === 0 || idx === pathRes.waypoints.length - 1 ? 3.5 : 2, 0, Math.PI * 2);
              ctx.fill();
            });
          }
        } catch (e) {
          // Fallback if geometric generation encounters singular boundary
        }

        // Render Boundary Vertex Handles for dragging / fine adjustment
        screenBoundary.forEach((pt, idx) => {
          ctx.fillStyle = selectedVertex === idx ? '#38bdf8' : '#fbbf24';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, selectedVertex === idx ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#020617';
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      }

      // Render Home Reference Point (Blue Diamond)
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - 8);
      ctx.lineTo(centerX + 8, centerY);
      ctx.lineTo(centerX, centerY + 8);
      ctx.lineTo(centerX - 8, centerY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText('HOME (0,0)', centerX + 10, centerY + 12);

      // Render Live Drone Position & Heading Vector
      const droneScreenX = centerX + droneMeters.x * mapScale;
      const droneScreenY = centerY - droneMeters.y * mapScale;

      ctx.save();
      ctx.translate(droneScreenX, droneScreenY);
      const headingRad = ((telemetry.heading || 0) * Math.PI) / 180;
      ctx.rotate(headingRad);

      // Drone Heading Arrow (Emerald / Pulsing Cyan)
      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#064e3b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(7, 8);
      ctx.lineTo(0, 4);
      ctx.lineTo(-7, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Drone Status Tag
      ctx.fillStyle = '#10b981';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(`UAV: ${telemetry.altitude.toFixed(1)}m`, droneScreenX + 9, droneScreenY - 6);

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [boundaryMeters, mapScale, mapOffset, selectedVertex, telemetry, config, mapMode, isDroneInsideArea]);

  // Handle Canvas Mouse / Touch Dragging & Vertex Selection
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const centerX = canvas.width / 2 + mapOffset.x;
    const centerY = canvas.height / 2 + mapOffset.y;

    // Check if clicked close to a vertex
    const screenBoundary = boundaryMeters.map((m) => ({
      x: centerX + m.x * mapScale,
      y: centerY - m.y * mapScale
    }));

    for (let i = 0; i < screenBoundary.length; i++) {
      const dist = Math.hypot(clickX - screenBoundary[i].x, clickY - screenBoundary[i].y);
      if (dist < 18) {
        setSelectedVertex(i);
        return;
      }
    }

    // Otherwise, drag/pan the map
    setIsDragging(true);
    setDragStart({ x: clickX - mapOffset.x, y: clickY - mapOffset.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const currX = e.clientX - rect.left;
    const currY = e.clientY - rect.top;

    if (selectedVertex !== null) {
      const centerX = canvas.width / 2 + mapOffset.x;
      const centerY = canvas.height / 2 + mapOffset.y;
      const newMetersX = (currX - centerX) / mapScale;
      const newMetersY = -(currY - centerY) / mapScale;

      const newLatLng = metersToLatLng(refPoint, newMetersX, newMetersY);
      const updated = [...coordinates];
      updated[selectedVertex] = newLatLng;
      setCoordinates(updated);
    } else if (isDragging) {
      setMapOffset({
        x: currX - dragStart.x,
        y: currY - dragStart.y
      });
    }
  };

  const handlePointerUp = () => {
    setSelectedVertex(null);
    setIsDragging(false);
  };

  const handleSave = () => {
    const area = calculateAreaSquareMeters();
    const updatedBoundary: SearchBoundaryConfig = {
      type: boundaryType,
      coordinates,
      circleRadiusMeters: boundaryType === 'CIRCLE' ? circleRadius : undefined,
      areaSquareMeters: area,
      label: `${boundaryType} (~${Math.round(area)} m²)`
    };
    onSaveBoundary(updatedBoundary);
    if (onClose) onClose();
  };

  const areaM2 = Math.round(calculateAreaSquareMeters());

  return (
    <div className={`flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden font-mono ${isInline ? 'w-full' : 'shadow-2xl'}`}>
      {/* Top Header & Shape Selection Bar */}
      <div className="p-3 sm:p-4 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center space-x-2">
          <MapPin className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-black uppercase text-amber-300 tracking-wider">
            SEARCH BOUNDARY PLANNER (GOOGLE MAPS REFERENCE)
          </span>
        </div>

        {/* Boundary Shape Selectors */}
        <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => generatePreset('RECTANGLE')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition flex items-center space-x-1 ${
              boundaryType === 'RECTANGLE'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Square className="w-3 h-3" />
            <span>Rectangle</span>
          </button>
          <button
            type="button"
            onClick={() => generatePreset('SQUARE')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition flex items-center space-x-1 ${
              boundaryType === 'SQUARE'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Square className="w-3 h-3" />
            <span>Square</span>
          </button>
          <button
            type="button"
            onClick={() => generatePreset('CIRCLE')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition flex items-center space-x-1 ${
              boundaryType === 'CIRCLE'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Circle className="w-3 h-3" />
            <span>Circle</span>
          </button>
          <button
            type="button"
            onClick={() => generatePreset('POLYGON')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition flex items-center space-x-1 ${
              boundaryType === 'POLYGON'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Pentagon className="w-3 h-3" />
            <span>Polygon</span>
          </button>
          <button
            type="button"
            onClick={() => generatePreset('CUSTOM')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition flex items-center space-x-1 ${
              boundaryType === 'CUSTOM'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Edit3 className="w-3 h-3" />
            <span>Custom</span>
          </button>
        </div>
      </div>

      {/* Map Drawing Surface with Overlay Controls */}
      <div className="relative w-full h-[320px] sm:h-[400px] bg-slate-950">
        <canvas
          ref={canvasRef}
          width={800}
          height={400}
          className="w-full h-full cursor-crosshair touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />

        {/* Live Status Overlay Badges */}
        <div className="absolute top-2.5 left-2.5 flex flex-col gap-1.5 pointer-events-none">
          <div className="px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700 backdrop-blur text-[10px] text-amber-300 font-bold flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span>AREA: ~{areaM2} m² ({coordinates.length} Vertices)</span>
          </div>

          <div className={`px-2.5 py-1 rounded border backdrop-blur text-[10px] font-bold flex items-center space-x-1.5 ${
            isDroneInsideArea
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
          }`}>
            {isDroneInsideArea ? (
              <>
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>UAV WITHIN SEARCH BOUNDARY</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3 h-3 text-rose-400" />
                <span>UAV OUTSIDE BOUNDARY (GEOFENCE ALERT)</span>
              </>
            )}
          </div>
        </div>

        {/* Bottom Right Map Zoom & Reset Tools */}
        <div className="absolute bottom-2.5 right-2.5 flex items-center space-x-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setMapScale((s) => Math.min(5.0, +(s + 0.5).toFixed(1)))}
            className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-black flex items-center justify-center cursor-pointer"
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setMapScale((s) => Math.max(0.8, +(s - 0.5).toFixed(1)))}
            className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-black flex items-center justify-center cursor-pointer"
            title="Zoom Out"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => {
              setMapScale(2.0);
              setMapOffset({ x: 0, y: 0 });
            }}
            className="px-2 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold flex items-center space-x-1 cursor-pointer"
            title="Center Map"
          >
            <Crosshair className="w-3 h-3 text-sky-400" />
            <span>Center</span>
          </button>
          <button
            type="button"
            onClick={() => setMapMode(m => m === 'TACTICAL_DARK' ? 'SATELLITE' : 'TACTICAL_DARK')}
            className={`px-2 h-7 rounded text-[10px] font-bold flex items-center space-x-1 border cursor-pointer ${
              mapMode === 'SATELLITE' ? 'bg-emerald-950 border-emerald-500/50 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-300'
            }`}
            title="Toggle Map Style"
          >
            <Layers className="w-3 h-3 text-emerald-400" />
            <span>{mapMode === 'SATELLITE' ? 'Satellite' : 'Vector'}</span>
          </button>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-3 sm:p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
        <span className="text-[11px] text-slate-400 hidden sm:inline">
          Drag vertices to resize • Click + drag background to pan • Lawnmower pattern auto-adjusts
        </span>

        <div className="flex items-center space-x-2 ml-auto">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase transition cursor-pointer"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-xs font-black uppercase tracking-wider transition flex items-center space-x-1.5 shadow-md shadow-amber-600/30 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>APPLY SEARCH BOUNDARY</span>
          </button>
        </div>
      </div>
    </div>
  );
};
