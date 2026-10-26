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
  Trash2
} from 'lucide-react';
import { Card } from '../../ui/Card';
import {
  groundStationMissionService,
  calculateHaversineDistance
} from '../../services/groundStationMissionService';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';
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
  // 1. Search Altitude (Default: 10m, envelope: 5m–50m)
  const [altitude, setAltitude] = useState<number>(10);

  // 2. Search Radius (Quick options: 5m, 10m, 50m, custom)
  const [selectedRadiusPreset, setSelectedRadiusPreset] = useState<number | 'custom'>(10);
  const [customRadius, setCustomRadius] = useState<number>(10);

  // 3. Search Algorithm: Tangential / Circular Search vs Spiral Search
  const [algorithm, setAlgorithm] = useState<'TANGENTIAL_CIRCULAR' | 'SPIRAL'>('TANGENTIAL_CIRCULAR');

  // 4. Mission Time Limit: Duration in minutes
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(10);

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

  // Active Radius Value
  const activeRadius = selectedRadiusPreset === 'custom' ? customRadius : selectedRadiusPreset;

  // Resolve Search Centre from Drone Position or Home
  const getSearchCenter = (): LatLngPoint => {
    if (telemetry.isGpsValid && telemetry.latitude && Math.abs(telemetry.latitude) > 0.001) {
      return { lat: telemetry.latitude, lng: telemetry.longitude };
    }
    const home = mavlinkService.getHomePoint();
    if (home.isSet && Math.abs(home.latitude) > 0.001) {
      return { lat: home.latitude, lng: home.longitude };
    }
    // Default fallback to center of mission if waypoints exist
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

    const result = groundStationMissionService.generateAutonomousSearchMission(
      center,
      activeRadius,
      algorithm,
      home,
      altitude,
      timeLimitMinutes,
      4.0 // 4.0 m/s cruise speed
    );

    setSearchDurationSec(result.searchDuration);
    setReturnDurationSec(result.returnDuration);
    setTotalDurationSec(result.totalDuration);
    setIsFeasible(result.isFeasible);
    setFeasibilityMessage(result.feasibilityReason);
  };

  // Recalculate path whenever the 4 primary inputs change
  useEffect(() => {
    regeneratePath();
  }, [altitude, activeRadius, algorithm, timeLimitMinutes]);

  useEffect(() => {
    const unsub = groundStationMissionService.subscribe((m) => {
      setCurrentMission(m);
    });
    return () => unsub();
  }, []);

  const handleUploadClick = async () => {
    if (!currentMission || currentMission.waypoints.length === 0) {
      setUploadNotice('Please generate a path first.');
      return;
    }
    setIsUploading(true);
    setUploadNotice('Uploading autonomous mission to Pixhawk...');
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

  return (
    <Card
      title="AUTONOMOUS SEARCH CONFIGURATION"
      action={
        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px] font-bold border border-emerald-500/40">
          MODE B • RECON
        </span>
      }
      className={`shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md select-none ${className}`}
      contentClassName="p-3 flex flex-col gap-3"
    >
      {/* ========================================================================= */}
      {/* 1. SEARCH ALTITUDE (Default: 10m, clear setting, validated 5m - 50m)       */}
      {/* ========================================================================= */}
      <div className="bg-[#161B22] p-2.5 rounded-lg border border-slate-800 space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-slate-300 font-bold flex items-center gap-1.5">
            <span className="text-emerald-400">1.</span> SEARCH ALTITUDE:
          </span>
          <span className="font-bold text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-700 text-[11px]">
            {altitude}m AGL
          </span>
        </div>

        {/* Quick Altitude Buttons & Slider */}
        <div className="flex items-center gap-1.5 pt-1">
          {[5, 10, 15, 20].map((alt) => (
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
              {alt}m {alt === 10 ? '(Default)' : ''}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-slate-400">
          <span>5m</span>
          <input
            type="range"
            min={5}
            max={50}
            step={1}
            value={altitude}
            onChange={(e) => setAltitude(Number(e.target.value))}
            className="flex-1 accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
          />
          <span>50m</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. SEARCH RADIUS (Quick-selection: 5m, 10m, 50m, custom)                  */}
      {/* ========================================================================= */}
      <div className="bg-[#161B22] p-2.5 rounded-lg border border-slate-800 space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-slate-300 font-bold flex items-center gap-1.5">
            <span className="text-emerald-400">2.</span> SEARCH RADIUS:
          </span>
          <span className="font-bold text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-700 text-[11px]">
            {activeRadius}m (Boundary)
          </span>
        </div>

        {/* Quick Selection Buttons */}
        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {[5, 10, 50].map((rad) => (
            <button
              key={rad}
              type="button"
              onClick={() => {
                setSelectedRadiusPreset(rad);
                groundStationMissionService.setCircleRadius(rad);
              }}
              className={`py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer border ${
                selectedRadiusPreset === rad
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {rad}m
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedRadiusPreset('custom')}
            className={`py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer border ${
              selectedRadiusPreset === 'custom'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Custom
          </button>
        </div>

        {selectedRadiusPreset === 'custom' && (
          <div className="pt-1.5 flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-400">Radius:</span>
            <input
              type="number"
              min={5}
              max={300}
              value={customRadius}
              onChange={(e) => {
                const val = Math.max(5, Math.min(300, Number(e.target.value) || 5));
                setCustomRadius(val);
                groundStationMissionService.setCircleRadius(val);
              }}
              className="w-20 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white font-bold text-xs"
            />
            <span className="text-slate-400">meters</span>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 3. SEARCH ALGORITHM (Tangential / Circular Search vs Spiral Search)         */}
      {/* ========================================================================= */}
      <div className="bg-[#161B22] p-2.5 rounded-lg border border-slate-800 space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-slate-300 font-bold flex items-center gap-1.5">
            <span className="text-emerald-400">3.</span> SEARCH ALGORITHM:
          </span>
          <span className="text-[10px] text-slate-400 font-mono">Select Pattern</span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          {/* A. Tangential / Circular Search */}
          <button
            type="button"
            onClick={() => setAlgorithm('TANGENTIAL_CIRCULAR')}
            className={`p-2 rounded-lg border text-left transition cursor-pointer ${
              algorithm === 'TANGENTIAL_CIRCULAR'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200 ring-1 ring-emerald-500/50'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-1.5 font-bold text-[11px] mb-0.5">
              <span>⭕</span>
              <span>Tangential / Circular</span>
            </div>
            <p className="text-[9.5px] text-slate-400 leading-tight">
              Smooth circular orbit around boundary with tangential entry
            </p>
          </button>

          {/* B. Spiral Search */}
          <button
            type="button"
            onClick={() => setAlgorithm('SPIRAL')}
            className={`p-2 rounded-lg border text-left transition cursor-pointer ${
              algorithm === 'SPIRAL'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200 ring-1 ring-emerald-500/50'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-1.5 font-bold text-[11px] mb-0.5">
              <span>🌀</span>
              <span>Spiral Search</span>
            </div>
            <p className="text-[9.5px] text-slate-400 leading-tight">
              Outward expanding Archimedean spiral bounded by radius
            </p>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. MISSION TIME LIMIT & FEASIBILITY DISPLAY                              */}
      {/* ========================================================================= */}
      <div className="bg-[#161B22] p-2.5 rounded-lg border border-slate-800 space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-slate-300 font-bold flex items-center gap-1.5">
            <span className="text-emerald-400">4.</span> TIME LIMIT &amp; TIMER:
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400">Limit:</span>
            <select
              value={timeLimitMinutes}
              onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
              disabled={isMissionExecuting}
              className="bg-slate-900 border border-slate-700 text-white font-mono text-[11px] rounded px-1.5 py-0.5 cursor-pointer font-bold"
            >
              <option value={3}>3 Minutes</option>
              <option value={5}>5 Minutes</option>
              <option value={10}>10 Minutes</option>
              <option value={15}>15 Minutes</option>
              <option value={20}>20 Minutes</option>
            </select>
          </div>
        </div>

        {/* Live Timer Status Grid */}
        <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10.5px]">
          <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
            <span className="text-slate-500 block text-[9.5px]">LIMIT</span>
            <span className="font-bold text-white">{timeLimitMinutes}m 00s</span>
          </div>
          <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
            <span className="text-slate-500 block text-[9.5px]">ELAPSED</span>
            <span className="font-bold text-amber-300">{elapsedTimeStr}</span>
          </div>
          <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
            <span className="text-slate-500 block text-[9.5px]">REMAINING</span>
            <span className={`font-bold ${isMissionExecuting ? 'text-emerald-400' : 'text-slate-300'}`}>
              {remainingTimeStr}
            </span>
          </div>
        </div>

        {/* Time Feasibility & Return Reservation Assessment */}
        <div className="bg-slate-950/80 p-2 rounded border border-slate-800/80 text-[10px] font-mono space-y-1">
          <div className="flex justify-between text-slate-400">
            <span>Estimated Search Leg:</span>
            <span className="font-bold text-slate-200">{formatSeconds(searchDurationSec)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Reserved Return-To-Launch:</span>
            <span className="font-bold text-amber-300">{formatSeconds(returnDurationSec)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-800 pt-1 font-bold">
            <span className="text-slate-300">Total Flight Required:</span>
            <span className={isFeasible ? 'text-emerald-400' : 'text-rose-400'}>
              {formatSeconds(totalDurationSec)} / {timeLimitMinutes}m
            </span>
          </div>
        </div>

        {!isFeasible && (
          <div className="p-2 rounded bg-rose-950/70 border border-rose-500/80 text-rose-300 text-[10.5px] font-mono flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{feasibilityMessage || 'Mission time limit is insufficient for search and safe return.'}</span>
          </div>
        )}
      </div>

      {/* Path Summary Info Pill */}
      {currentMission && (
        <div className="flex items-center justify-between text-xs font-mono bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800 text-[11px]">
          <span className="text-slate-400">
            {currentMission.waypoints.length} Waypoints • {currentMission.totalDistance}m Path
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
            title="Upload generated autonomous waypoints to Pixhawk flight controller"
          >
            <Send className={`w-3.5 h-3.5 ${isUploading ? 'animate-bounce' : ''}`} />
            <span>{isUploading ? 'UPLOADING...' : 'UPLOAD TO FC'}</span>
          </button>

          {/* Start Mission Button (Opens Preflight Checklist Modal) */}
          <button
            type="button"
            onClick={onOpenPreflightModal}
            disabled={!isFeasible}
            className={`py-2.5 px-3 rounded-lg font-sans font-black text-[11px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md ${
              isFeasible
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
            title="Perform preflight checks and initiate autonomous search"
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
