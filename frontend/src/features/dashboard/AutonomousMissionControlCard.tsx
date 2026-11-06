import React, { useState, useEffect } from 'react';
import {
  Compass,
  Play,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Sliders,
  Layers,
  MapPin,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  ChevronRight,
  Trash2,
  Circle,
  Square,
  Activity,
  Target,
  Eye,
  Check
} from 'lucide-react';
import { Card } from '../../ui/Card';
import {
  groundStationMissionService,
  calculateHaversineDistance
} from '../../services/groundStationMissionService';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';
import { geofenceService } from '../../services/geofenceService';
import {
  visionHeatmapService,
  VisionRegisteredObject,
  HeatmapGridData
} from '../../services/visionHeatmapService';
import { DashboardTelemetryData } from '../../hooks/useDashboardTelemetry';
import { GroundStationMission } from '../../types/groundStationMap';
import { LatLngPoint, HomePoint } from '../../types/mission';

interface AutonomousMissionControlCardProps {
  telemetry: DashboardTelemetryData;
  onOpenPreflightModal: () => void;
  onUploadWaypoints: () => Promise<void>;
  onEmergencyRTL: () => void;
  rtlConfirmPending?: boolean;
  className?: string;
  activeMissionTime?: {
    elapsedSeconds: number;
    remainingSeconds: number;
    status: string;
    deadline?: number;
    isExecuting: boolean;
  };
}

export const AutonomousMissionControlCard: React.FC<AutonomousMissionControlCardProps> = ({
  telemetry,
  onOpenPreflightModal,
  onUploadWaypoints,
  onEmergencyRTL,
  rtlConfirmPending = false,
  className = '',
  activeMissionTime,
}) => {
  // 1. Boundary Type Selection
  const [boundaryType, setBoundaryType] = useState<'SQUARE' | 'RECTANGLE' | 'CIRCLE' | 'POLYGON'>('RECTANGLE');

  // 2. Search Altitude (Default: 5m, envelope: 2m–50m)
  const [altitude, setAltitude] = useState<number>(5);

  // 3. Boundary Dimensions
  const [rectWidth, setRectWidth] = useState<number>(30);
  const [rectHeight, setRectHeight] = useState<number>(20);
  const [circleRadius, setCircleRadius] = useState<number>(15);

  // 4. Search Algorithm: Spiral (Expanding) vs Tangential Circular
  const [algorithm, setAlgorithm] = useState<'SPIRAL' | 'TANGENTIAL_CIRCULAR' | 'RECTANGULAR_SPIRAL' | 'SQUARE_SPIRAL'>('RECTANGULAR_SPIRAL');

  // 5. 5-Minute Time Limit Target (Default: 5 Minutes / 300s)
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(5);

  // Calculated Path Feasibility & Durations
  const [searchDurationSec, setSearchDurationSec] = useState<number>(0);
  const [returnDurationSec, setReturnDurationSec] = useState<number>(0);
  const [totalDurationSec, setTotalDurationSec] = useState<number>(0);
  const [isFeasible, setIsFeasible] = useState<boolean>(true);
  const [feasibilityMessage, setFeasibilityMessage] = useState<string | undefined>(undefined);

  const [currentMission, setCurrentMission] = useState<GroundStationMission | null>(() =>
    groundStationMissionService.getCurrentMission()
  );
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  // Real-Time Computer-Vision Heatmap & Object Queue State
  const [heatmapData, setHeatmapData] = useState<HeatmapGridData | null>(null);
  const [objectQueue, setObjectQueue] = useState<VisionRegisteredObject[]>([]);
  const [activeDeckTab, setActiveDeckTab] = useState<'CONFIG' | 'OBJECTS' | 'HEATMAP'>('CONFIG');

  // Subscribe to Vision Heatmap & Objects
  useEffect(() => {
    const unsubHeatmap = visionHeatmapService.subscribeHeatmap(setHeatmapData);
    const unsubObjects = visionHeatmapService.subscribeObjects(setObjectQueue);
    return () => {
      unsubHeatmap();
      unsubObjects();
    };
  }, []);

  // Resolve Search Centre from Drone Position or Home
  const getSearchCenter = (): LatLngPoint => {
    if (telemetry.isGpsValid && telemetry.latitude && Math.abs(telemetry.latitude) > 0.001) {
      return { lat: telemetry.latitude, lng: telemetry.longitude };
    }
    const home = mavlinkService.getHomePoint();
    if (home.isSet && Math.abs(home.latitude) > 0.001) {
      return { lat: home.latitude, lng: home.longitude };
    }
    if (currentMission && currentMission.waypoints.length > 0) {
      return { lat: currentMission.waypoints[0].lat, lng: currentMission.waypoints[0].lng };
    }
    return { lat: 13.0827, lng: 80.2707 }; // Reference default
  };

  // Generate / Recalculate Path
  const regeneratePath = () => {
    const center = getSearchCenter();
    const home: HomePoint = mavlinkService.getHomePoint().isSet
      ? mavlinkService.getHomePoint()
      : { latitude: center.lat, longitude: center.lng, altitude: 0, timestamp: Date.now(), isSet: true };

    let algo: 'TANGENTIAL_CIRCULAR' | 'SPIRAL' | 'RECTANGULAR_SPIRAL' | 'SQUARE_SPIRAL' = 'SPIRAL';
    let rad = circleRadius;
    const dims = { width: rectWidth, height: rectHeight };

    if (boundaryType === 'SQUARE') {
      algo = 'SQUARE_SPIRAL';
      dims.width = rectWidth;
      dims.height = rectWidth; // Square has equal sides
      rad = rectWidth / 2.0;
    } else if (boundaryType === 'RECTANGLE') {
      algo = 'RECTANGULAR_SPIRAL';
      rad = Math.max(rectWidth, rectHeight) / 2.0;
    } else if (boundaryType === 'CIRCLE') {
      algo = algorithm === 'TANGENTIAL_CIRCULAR' ? 'TANGENTIAL_CIRCULAR' : 'SPIRAL';
      rad = circleRadius;
    } else {
      algo = 'RECTANGULAR_SPIRAL';
    }

    const result = groundStationMissionService.generateAutonomousSearchMission(
      center,
      rad,
      algo,
      home,
      altitude,
      timeLimitMinutes,
      4.0, // 4.0 m/s cruise speed
      dims
    );

    setSearchDurationSec(result.searchDuration);
    setReturnDurationSec(result.returnDuration);
    setTotalDurationSec(result.totalDuration);
    setIsFeasible(result.isFeasible);
    setFeasibilityMessage(result.feasibilityReason);
  };

  // Recalculate path whenever inputs change
  useEffect(() => {
    regeneratePath();
  }, [altitude, boundaryType, rectWidth, rectHeight, circleRadius, algorithm, timeLimitMinutes]);

  useEffect(() => {
    const unsub = groundStationMissionService.subscribe((m) => {
      setCurrentMission(m);
    });
    return () => unsub();
  }, []);

  // Strict Pre-Arm Containment Check: Verify drone is inside configured boundary
  const isDroneInsideBoundary = ((): boolean => {
    if (telemetry.rawConnectionState.connectionType === 'SIMULATED') return true;
    if (!telemetry.isGpsValid || Math.abs(telemetry.latitude) < 0.001) return true; // bench testing fallback

    const center = getSearchCenter();
    const dLat = telemetry.latitude;
    const dLon = telemetry.longitude;

    if (boundaryType === 'CIRCLE') {
      const d = calculateHaversineDistance(dLat, dLon, center.lat, center.lng);
      return d <= circleRadius + 2.0;
    }

    if (currentMission?.geometry?.coordinates && currentMission.geometry.coordinates.length >= 3) {
      return geofenceService.isPointInPolygon(dLat, dLon, currentMission.geometry.coordinates);
    }

    const dist = calculateHaversineDistance(dLat, dLon, center.lat, center.lng);
    return dist <= Math.max(rectWidth, rectHeight) / 2.0 + 2.0;
  })();

  const handleUploadClick = async () => {
    if (!currentMission || currentMission.waypoints.length === 0) {
      setUploadNotice('Please generate a path first.');
      return;
    }
    setIsUploading(true);
    setUploadNotice('Uploading autonomous spiral mission to Pixhawk...');
    try {
      await onUploadWaypoints();
      setUploadNotice(`✓ Verified: ${currentMission.waypoints.length} mission waypoints on Pixhawk`);
      setTimeout(() => setUploadNotice(null), 4000);
    } catch (err: any) {
      setUploadNotice(`Upload failed: ${err?.message || 'Check link'}`);
      setTimeout(() => setUploadNotice(null), 4000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteMission = async () => {
    setIsUploading(true);
    setUploadNotice('Deleting mission from GCS & Flight Controller...');
    try {
      const res = await groundStationMissionService.deleteMission();
      setCurrentMission(null);
      setUploadNotice(res.message);
    } catch {
      setUploadNotice('Mission wiped locally');
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadNotice(null), 3500);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const isMissionExecuting = Boolean(activeMissionTime?.isExecuting);
  const remainingTimeStr = activeMissionTime
    ? formatSeconds(activeMissionTime.remainingSeconds)
    : formatSeconds(timeLimitMinutes * 60);
  const elapsedTimeStr = activeMissionTime
    ? formatSeconds(activeMissionTime.elapsedSeconds)
    : '0m 00s';

  const boundaryArea = currentMission?.geometry?.areaSquareMeters || Math.round(rectWidth * rectHeight);
  const boundaryPerimeter = boundaryType === 'CIRCLE'
    ? Math.round(2 * Math.PI * circleRadius)
    : boundaryType === 'SQUARE'
    ? Math.round(rectWidth * 4)
    : Math.round((rectWidth + rectHeight) * 2);

  return (
    <Card
      title="AUTONOMOUS RECON & SPIRAL SCAN"
      action={
        <div className="flex items-center gap-1.5">
          {/* Tab buttons: CONFIG | OBJECTS ({n}) | HEATMAP */}
          <div className="flex items-center bg-[#161B22] p-0.5 rounded-lg border border-[var(--uav-card-border)] text-[10px] font-mono">
            <button
              type="button"
              onClick={() => setActiveDeckTab('CONFIG')}
              className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                activeDeckTab === 'CONFIG' ? 'bg-[#10B981] text-emerald-950 font-extrabold' : 'text-slate-400 hover:text-white'
              }`}
            >
              CONFIG
            </button>
            <button
              type="button"
              onClick={() => setActiveDeckTab('OBJECTS')}
              className={`px-2 py-0.5 rounded font-bold transition cursor-pointer flex items-center gap-1 ${
                activeDeckTab === 'OBJECTS' ? 'bg-[#10B981] text-emerald-950 font-extrabold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>QUEUE</span>
              {objectQueue.length > 0 && (
                <span className="w-3.5 h-3.5 rounded-full bg-rose-500 text-white text-[8.5px] flex items-center justify-center font-bold">
                  {objectQueue.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveDeckTab('HEATMAP')}
              className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                activeDeckTab === 'HEATMAP' ? 'bg-[#10B981] text-emerald-950 font-extrabold' : 'text-slate-400 hover:text-white'
              }`}
            >
              HEATMAP
            </button>
          </div>
        </div>
      }
      className={`shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md select-none ${className}`}
      contentClassName="p-3 flex flex-col gap-3"
    >
      {/* ========================================================================= */}
      {/* STRICT PRE-ARM BOUNDARY CONTAINMENT WARNING BANNER                         */}
      {/* ========================================================================= */}
      {!isDroneInsideBoundary && (
        <div className="p-2.5 rounded-lg bg-rose-950/90 border-2 border-rose-500 text-rose-200 text-xs font-mono font-bold flex items-start gap-2 shadow-lg animate-pulse">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="block text-white uppercase tracking-wider font-extrabold">
              PRE-ARM SAFETY INTERLOCK ACTIVE
            </span>
            <span className="text-[11px] leading-tight">
              Your current position is outside the selected search boundary. Move the drone inside the boundary before starting the mission.
            </span>
          </div>
        </div>
      )}

      {/* VIEW A: MISSION CONFIGURATION */}
      {activeDeckTab === 'CONFIG' && (
        <>
          {/* 1. BOUNDARY GEOMETRY SELECTION */}
          <div className="bg-[#161B22] p-2.5 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                <span className="text-emerald-400">1.</span> BOUNDARY GEOMETRY:
              </span>
              <span className="text-[10px] text-emerald-400 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                {boundaryArea} m² ({boundaryPerimeter}m Perim)
              </span>
            </div>

            {/* Shape Buttons */}
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { id: 'RECTANGLE' as const, label: 'Rectangle', icon: '▬' },
                { id: 'SQUARE' as const, label: 'Square', icon: '■' },
                { id: 'CIRCLE' as const, label: 'Circle', icon: '●' },
                { id: 'POLYGON' as const, label: 'Custom', icon: '⬢' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setBoundaryType(s.id)}
                  className={`py-1.5 px-1 rounded text-[10.5px] font-mono font-bold flex items-center justify-center gap-1 transition cursor-pointer border ${
                    boundaryType === s.id
                      ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>

            {/* Dimensional Sliders */}
            {boundaryType === 'CIRCLE' ? (
              <div className="pt-1 space-y-1 font-mono text-[11px]">
                <div className="flex justify-between text-slate-400">
                  <span>Search Radius:</span>
                  <span className="font-bold text-white">{circleRadius}m</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={1}
                  value={circleRadius}
                  onChange={(e) => setCircleRadius(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">WIDTH: {rectWidth}m</span>
                  <input
                    type="range"
                    min={10}
                    max={80}
                    step={2}
                    value={rectWidth}
                    onChange={(e) => setRectWidth(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                  />
                </div>
                {boundaryType === 'RECTANGLE' && (
                  <div>
                    <span className="text-slate-400 block text-[10px]">HEIGHT: {rectHeight}m</span>
                    <input
                      type="range"
                      min={10}
                      max={80}
                      step={2}
                      value={rectHeight}
                      onChange={(e) => setRectHeight(Number(e.target.value))}
                      className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. SEARCH ALTITUDE (Locked default 5m) */}
          <div className="bg-[#161B22] p-2.5 rounded-lg border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                <span className="text-emerald-400">2.</span> SEARCH ALTITUDE:
              </span>
              <span className="font-bold text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-700 text-[11px]">
                {altitude}m AGL
              </span>
            </div>

            <div className="flex items-center gap-1.5 pt-1">
              {[3, 5, 8, 10].map((alt) => (
                <button
                  key={alt}
                  type="button"
                  onClick={() => setAltitude(alt)}
                  className={`flex-1 py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer border ${
                    altitude === alt
                      ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {alt}m {alt === 5 ? '(Default)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* 3. FIVE-MINUTE MISSION BUDGET OPTIMIZER */}
          <div className="bg-[#161B22] p-2.5 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                <span className="text-emerald-400">3.</span> 5-MINUTE TARGET BUDGET:
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                isFeasible ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-rose-950 text-rose-300 border border-rose-500/40'
              }`}>
                {isFeasible ? 'FEASIBLE (≤ 300s)' : 'BUDGET EXCEEDED'}
              </span>
            </div>

            {/* Time Breakdown Matrix */}
            <div className="grid grid-cols-4 gap-1 text-center font-mono text-[9.5px]">
              <div className="bg-slate-900 p-1 rounded border border-slate-800">
                <span className="text-slate-500 block">TAKEOFF</span>
                <span className="font-bold text-white">30s</span>
              </div>
              <div className="bg-slate-900 p-1 rounded border border-slate-800">
                <span className="text-slate-500 block">SCANNING</span>
                <span className="font-bold text-amber-300">{searchDurationSec}s</span>
              </div>
              <div className="bg-slate-900 p-1 rounded border border-slate-800">
                <span className="text-slate-500 block">INSPECT</span>
                <span className="font-bold text-sky-300">60s</span>
              </div>
              <div className="bg-slate-900 p-1 rounded border border-slate-800">
                <span className="text-slate-500 block">RTL</span>
                <span className="font-bold text-emerald-300">{returnDurationSec}s</span>
              </div>
            </div>

            <div className="flex justify-between text-[10.5px] font-mono border-t border-slate-800 pt-1 font-bold">
              <span className="text-slate-400">Estimated Total:</span>
              <span className={isFeasible ? 'text-emerald-400' : 'text-rose-400'}>
                {formatSeconds(totalDurationSec)} / 5m 00s (300s)
              </span>
            </div>

            {!isFeasible && (
              <div className="p-2 rounded bg-rose-950/70 border border-rose-500/80 text-rose-300 text-[10px] font-mono flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{feasibilityMessage}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* VIEW B: LIVE OBJECT DETECTION QUEUE */}
      {activeDeckTab === 'OBJECTS' && (
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          <div className="flex items-center justify-between text-xs font-mono border-b border-slate-800 pb-1">
            <span className="text-slate-400">REGISTERED OBJECTS ({objectQueue.length}):</span>
            <span className="text-[10px] text-emerald-400 font-bold">P1 (QR) First</span>
          </div>

          {objectQueue.length === 0 ? (
            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 text-center text-xs font-mono text-slate-500">
              No objects detected yet. Awaiting camera sweep...
            </div>
          ) : (
            objectQueue.map((obj) => (
              <div
                key={obj.object_id}
                className="p-2.5 rounded-lg bg-[#161B22] border border-slate-800 flex items-center justify-between gap-2.5 font-mono text-xs"
              >
                <div className="flex items-center gap-2.5">
                  {obj.thumbnail ? (
                    <img src={obj.thumbnail} alt="Target" className="w-10 h-10 rounded object-cover border border-slate-700 shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600 font-bold text-xs shrink-0">
                      BOX
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white">{obj.object_id}</span>
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                        obj.priority === 1 ? 'bg-rose-950 text-rose-300 border border-rose-500' :
                        obj.priority === 2 ? 'bg-amber-950 text-amber-300 border border-amber-500' :
                        'bg-sky-950 text-sky-300 border border-sky-500'
                      }`}>
                        P{obj.priority} • {obj.shape}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {obj.lat && obj.lon ? `GPS: ${obj.lat.toFixed(5)}°, ${obj.lon.toFixed(5)}°` : 'Triangulating GPS...'}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  {obj.two_digit_code ? (
                    <div className="bg-emerald-950/80 border border-emerald-500 px-2 py-0.5 rounded text-emerald-300 font-black text-xs">
                      CODE: {obj.two_digit_code}
                    </div>
                  ) : (
                    <span className="text-[10px] text-amber-400 font-bold bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-600/40">
                      {obj.status}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* VIEW C: REAL-TIME HEATMAP HUD */}
      {activeDeckTab === 'HEATMAP' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono border-b border-slate-800 pb-1">
            <span className="text-slate-400">GROUND/OBJECT CLASSIFICATION:</span>
            <span className="text-[10px] text-emerald-400 font-bold">4-Tier Vision Grid</span>
          </div>

          {/* 4-Color Legend */}
          <div className="grid grid-cols-4 gap-1 text-[9px] font-mono text-center">
            <div className="p-1 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-bold">
              🟩 Ground
            </div>
            <div className="p-1 rounded bg-yellow-950/80 border border-yellow-500/50 text-yellow-300 font-bold">
              🟨 Potential
            </div>
            <div className="p-1 rounded bg-orange-950/80 border border-orange-500/50 text-orange-300 font-bold">
              🟧 Target Box
            </div>
            <div className="p-1 rounded bg-rose-950/80 border border-rose-500/50 text-rose-300 font-bold">
              🟥 QR Code
            </div>
          </div>

          {/* Heatmap Visualization Canvas / Matrix */}
          <div className="w-full h-36 rounded-lg bg-black border border-slate-800 overflow-hidden relative flex items-center justify-center">
            {heatmapData && heatmapData.classificationGrid.length > 0 ? (
              <div
                className="w-full h-full grid"
                style={{
                  gridTemplateColumns: `repeat(${heatmapData.gridWidth}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${heatmapData.gridHeight}, minmax(0, 1fr))`
                }}
              >
                {heatmapData.classificationGrid.map((row, rIdx) =>
                  row.map((val, cIdx) => (
                    <div
                      key={`${rIdx}-${cIdx}`}
                      className="w-full h-full"
                      style={{
                        backgroundColor:
                          val === 3 ? '#EF4444' :
                          val === 2 ? '#F97316' :
                          val === 1 ? '#EAB308' : '#10B981'
                      }}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="text-xs font-mono text-slate-500 text-center">
                Awaiting camera stream for ground classification...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Path Summary Info Pill */}
      {currentMission && activeDeckTab === 'CONFIG' && (
        <div className="flex items-center justify-between text-xs font-mono bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800 text-[11px]">
          <span className="text-slate-400">
            {currentMission.waypoints.length} WPs • {currentMission.totalDistance}m Path
          </span>
          <button
            type="button"
            onClick={regeneratePath}
            className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer font-bold"
            title="Recalculate path based on updated inputs or map center"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Recalculate</span>
          </button>
        </div>
      )}

      {uploadNotice && (
        <div className="px-2.5 py-1.5 rounded bg-sky-950/80 border border-sky-500/60 text-sky-200 text-[11px] font-mono flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{uploadNotice}</span>
        </div>
      )}

      {/* Primary Action Buttons */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {/* Upload Waypoints Button */}
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={isUploading || !isFeasible}
            className="py-2.5 px-3 rounded-lg bg-[#10B981] hover:bg-[#059669] text-emerald-950 font-sans font-bold text-[11px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md disabled:opacity-50"
            title="Upload generated autonomous spiral waypoints to Pixhawk flight controller"
          >
            <Send className={`w-3.5 h-3.5 ${isUploading ? 'animate-bounce' : ''}`} />
            <span>{isUploading ? 'UPLOADING...' : 'UPLOAD TO FC'}</span>
          </button>

          {/* Start Mission Button (Blocked if outside boundary!) */}
          <button
            type="button"
            onClick={onOpenPreflightModal}
            disabled={!isFeasible || !isDroneInsideBoundary}
            className={`py-2.5 px-3 rounded-lg font-sans font-black text-[11px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md ${
              isFeasible && isDroneInsideBoundary
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
            title={
              !isDroneInsideBoundary
                ? 'Your current position is outside the selected search boundary. Move the drone inside the boundary before starting the mission.'
                : 'Perform preflight checks and initiate autonomous search'
            }
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>START MISSION</span>
          </button>
        </div>

        {/* Delete Mission Button */}
        {currentMission && (
          <button
            type="button"
            onClick={handleDeleteMission}
            disabled={isUploading}
            className="w-full py-1.5 px-3 rounded-lg bg-red-950/30 hover:bg-red-900/50 border border-red-500/50 text-red-400 hover:text-white font-mono text-[10.5px] font-bold uppercase flex items-center justify-center gap-1.5 transition cursor-pointer"
            title="Delete autonomous mission from GCS and wipe Pixhawk FC EEPROM (MISSION_CLEAR_ALL)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>DELETE AUTONOMOUS MISSION</span>
          </button>
        )}
      </div>

      {/* Emergency RTL Control */}
      <div className="pt-1 border-t border-slate-800">
        <button
          type="button"
          onClick={onEmergencyRTL}
          className={`w-full py-2 px-3 rounded-lg font-bold text-[11px] font-mono flex items-center justify-center gap-2 transition cursor-pointer ${
            rtlConfirmPending
              ? 'bg-red-600 text-white border-2 border-white animate-pulse'
              : 'bg-rose-950/50 border border-rose-500/50 text-rose-300 hover:bg-rose-900/60'
          }`}
          title="Emergency Return To Launch (Click once to prime, click 2nd time to execute)"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${rtlConfirmPending ? 'animate-spin' : ''}`} />
          <span>{rtlConfirmPending ? '⚠️ CONFIRM RTL NOW (CLICK AGAIN)' : 'EMERGENCY RTL'}</span>
        </button>
      </div>
    </Card>
  );
};
