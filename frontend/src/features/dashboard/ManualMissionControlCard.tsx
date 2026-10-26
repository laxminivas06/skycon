import React, { useState, useEffect } from 'react';
import {
  PenTool,
  Trash2,
  Send,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  MapPin,
  Clock,
  Layers,
  Circle,
  Square
} from 'lucide-react';
import { Card } from '../../ui/Card';
import { groundStationMissionService } from '../../services/groundStationMissionService';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';
import { DashboardTelemetryData } from '../../hooks/useDashboardTelemetry';
import { GroundStationMission, MissionDrawingTool } from '../../types/groundStationMap';

interface ManualMissionControlCardProps {
  telemetry: DashboardTelemetryData;
  onOpenPreflightModal: () => void;
  onUploadWaypoints: () => Promise<void>;
  onEmergencyRTL: () => void;
  rtlConfirmPending?: boolean;
  className?: string;
}

export const ManualMissionControlCard: React.FC<ManualMissionControlCardProps> = ({
  telemetry,
  onOpenPreflightModal,
  onUploadWaypoints,
  onEmergencyRTL,
  rtlConfirmPending = false,
  className = '',
}) => {
  const [mission, setMission] = useState<GroundStationMission | null>(() =>
    groundStationMissionService.getCurrentMission()
  );
  const [activeTool, setActiveTool] = useState<MissionDrawingTool>(() =>
    groundStationMissionService.getDrawingTool()
  );
  const [altitude, setAltitude] = useState<number>(10);
  const [speed, setSpeed] = useState<number>(4.0);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(10);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsubMission = groundStationMissionService.subscribe(setMission);
    const unsubTool = groundStationMissionService.subscribeDrawingTool(setActiveTool);
    return () => {
      unsubMission();
      unsubTool();
    };
  }, []);

  const totalWps = mission?.waypoints.length || 0;

  const handleToolSelect = (tool: MissionDrawingTool) => {
    const nextTool = activeTool === tool ? 'select' : tool;
    groundStationMissionService.setDrawingTool(nextTool);
    audioService.playBeep(700, 50);
  };

  const handleDeleteMission = async () => {
    setIsUploading(true);
    setUploadNotice('Deleting mission from GCS & Flight Controller...');
    try {
      const res = await groundStationMissionService.deleteMission();
      setUploadNotice(res.message);
    } catch {
      setUploadNotice('Mission cleared locally');
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadNotice(null), 3500);
    }
  };

  const handleUploadClick = async () => {
    if (!mission || mission.waypoints.length === 0) {
      setUploadNotice('No waypoints defined. Click map or select drawing tool first.');
      return;
    }
    setIsUploading(true);
    setUploadNotice(`Uploading ${totalWps} waypoints to Pixhawk...`);
    try {
      await onUploadWaypoints();
      setUploadNotice(`✓ Verified: ${totalWps} waypoints stored in Pixhawk memory`);
      setTimeout(() => setUploadNotice(null), 4000);
    } catch (err: any) {
      setUploadNotice(`Upload failed: ${err?.message || 'Check MAVLink link'}`);
      setTimeout(() => setUploadNotice(null), 4000);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card
      title="MANUAL MISSION PLANNING"
      action={
        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px] font-bold border border-emerald-500/40">
          MODE A • MANUAL
        </span>
      }
      className={`shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md select-none ${className}`}
      contentClassName="p-3 flex flex-col gap-2.5"
    >
      {/* Flight Mode & Waypoint Count Header Pill */}
      <div className="flex items-center justify-between text-xs font-mono bg-[#161B22] p-2 rounded-lg border border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-[10.5px]">MISSION STATUS:</span>
          <span className="font-bold text-white">
            {mission?.isUploaded ? 'UPLOADED & VERIFIED ✓' : totalWps > 0 ? 'DRAFT PLAN' : 'NO PATH'}
          </span>
        </div>
        <div className="text-[11px] font-bold text-emerald-400">
          {totalWps} {totalWps === 1 ? 'Waypoint' : 'Waypoints'}
        </div>
      </div>

      {uploadNotice && (
        <div className="px-2.5 py-1.5 rounded bg-sky-950/80 border border-sky-500/60 text-sky-200 text-[11px] font-mono flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{uploadNotice}</span>
        </div>
      )}

      {/* Drawing / Path Editing Tools */}
      <div className="bg-[#161B22] p-2 rounded-lg border border-slate-800 space-y-1.5">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
          Draw / Edit Path On Live Map:
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => handleToolSelect('point')}
            className={`py-1.5 px-2 rounded text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer border ${
              activeTool === 'point'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Click on the live map to pin individual waypoints"
          >
            <MapPin className="w-3 h-3" />
            <span>Waypoints</span>
          </button>
          <button
            type="button"
            onClick={() => handleToolSelect('draw')}
            className={`py-1.5 px-2 rounded text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer border ${
              activeTool === 'draw'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Click and drag to draw a continuous freehand flight path"
          >
            <PenTool className="w-3 h-3" />
            <span>Freehand</span>
          </button>
          <button
            type="button"
            onClick={() => handleToolSelect('circle')}
            className={`py-1.5 px-2 rounded text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer border ${
              activeTool === 'circle'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Click map to place circular search orbit"
          >
            <Circle className="w-3 h-3" />
            <span>Circle Path</span>
          </button>
        </div>
      </div>

      {/* Altitude & Time Limit Settings */}
      <div className="grid grid-cols-2 gap-2 bg-[#161B22] p-2 rounded-lg border border-slate-800">
        <div>
          <span className="text-[10px] text-slate-400 block font-mono">CRUISE ALTITUDE:</span>
          <div className="flex items-center gap-1 pt-1 font-mono">
            <input
              type="number"
              min={5}
              max={50}
              value={altitude}
              onChange={(e) => {
                const val = Math.max(5, Math.min(50, Number(e.target.value) || 10));
                setAltitude(val);
                groundStationMissionService.updateMissionAltitude(val);
              }}
              className="w-16 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-white font-bold text-xs"
            />
            <span className="text-slate-400 text-xs">m</span>
          </div>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 block font-mono">TIME LIMIT:</span>
          <div className="flex items-center gap-1 pt-1 font-mono">
            <select
              value={timeLimitMinutes}
              onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-white font-bold text-xs cursor-pointer"
            >
              <option value={5}>5 min</option>
              <option value={10}>10 min</option>
              <option value={15}>15 min</option>
              <option value={20}>20 min</option>
            </select>
          </div>
        </div>
      </div>

      {/* Primary Manual Mission Controls */}
      <div className="grid grid-cols-2 gap-2">
        {/* Delete Mission Button */}
        <button
          type="button"
          onClick={handleDeleteMission}
          disabled={totalWps === 0 && !mission}
          className="py-2 px-3 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-500/60 text-red-400 hover:text-white font-sans font-bold text-[11px] uppercase flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40"
          title="Clear path / Delete mission from GCS and wipe Pixhawk FC EEPROM (MISSION_CLEAR_ALL)"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>CLEAR PATH</span>
        </button>

        {/* Upload Mission Button */}
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={isUploading || totalWps === 0}
          className="py-2 px-3 rounded-lg bg-[#10B981] hover:bg-[#059669] text-emerald-950 font-sans font-bold text-[11px] uppercase flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer disabled:opacity-40 shadow-sm"
          title="Upload mission to Pixhawk and verify stored waypoints"
        >
          <Send className={`w-3.5 h-3.5 ${isUploading ? 'animate-bounce' : ''}`} />
          <span>{isUploading ? 'UPLOADING...' : 'UPLOAD MISSION'}</span>
        </button>
      </div>

      {/* Start Mission Button (Triggers Preflight Modal) */}
      <button
        type="button"
        onClick={onOpenPreflightModal}
        className="w-full py-2.5 px-3 rounded-lg font-sans font-black text-[11px] tracking-wider uppercase flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer shadow-md bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50"
        title="Verify flight readiness and confirm mission launch"
      >
        <Play className="w-3.5 h-3.5 fill-current" />
        <span>{totalWps > 0 ? 'START MISSION' : 'PREFLIGHT & LAUNCH'}</span>
      </button>

      {/* Emergency RTL Button */}
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
