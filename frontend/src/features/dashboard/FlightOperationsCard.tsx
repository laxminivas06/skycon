import React, { useState, useEffect } from 'react';
import { Send, Play, Power, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { Card } from '../../ui/Card';
import { groundStationMissionService } from '../../services/groundStationMissionService';
import { missionEngine } from '../../services/missionEngine';
import { mavlinkService } from '../../services/mavlinkService';
import { GroundStationMission } from '../../types/groundStationMap';

interface FlightOperationsCardProps {
  isArmed: boolean;
  flightMode: string;
  onArmAndFly: () => void;
  onToggleArm: () => void;
  onUploadWaypoints: () => void;
  onEmergencyRTL: () => void;
  rtlConfirmPending?: boolean;
  className?: string;
}

export const FlightOperationsCard: React.FC<FlightOperationsCardProps> = ({
  isArmed,
  flightMode,
  onArmAndFly,
  onToggleArm,
  onUploadWaypoints,
  onEmergencyRTL,
  rtlConfirmPending = false,
  className = '',
}) => {
  const [mission, setMission] = useState<GroundStationMission | null>(() =>
    groundStationMissionService.getCurrentMission()
  );
  const [engineState, setEngineState] = useState<string>(missionEngine.getCurrentState());
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsubMission = groundStationMissionService.subscribe((m) => {
      setMission(m);
    });
    const unsubEngine = missionEngine.subscribeState((st) => {
      setEngineState(st);
    });
    return () => {
      unsubMission();
      unsubEngine();
    };
  }, []);

  const totalWps = mission?.waypoints.length || 0;

  const handleUploadClick = async () => {
    setIsUploading(true);
    setUploadNotice('Transmitting waypoint plan to Pixhawk...');
    try {
      await onUploadWaypoints();
      setUploadNotice(`✓ Successfully uploaded ${totalWps} waypoints`);
      setTimeout(() => setUploadNotice(null), 3500);
    } catch (err: any) {
      setUploadNotice(`Upload failed: ${err?.message || 'Check MAVLink link'}`);
      setTimeout(() => setUploadNotice(null), 4000);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card
      title="FLIGHT CONTROLS & OPERATIONS"
      action={
        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          <span
            className={`w-2 h-2 rounded-full ${
              isArmed ? 'bg-red-500 animate-pulse' : 'bg-emerald-400'
            }`}
          />
          <span className="font-bold text-white uppercase">{flightMode || 'GUIDED'}</span>
        </div>
      }
      className={`shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md select-none ${className}`}
      contentClassName="p-3 flex flex-col gap-2.5"
    >
      {/* Flight Mode & Telemetry Header Pill */}
      <div className="flex items-center justify-between text-xs font-mono bg-[#161B22] p-2 rounded-lg border border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-[10.5px]">MISSION STATUS:</span>
          <span className={`font-bold ${isArmed ? 'text-amber-400' : 'text-slate-300'}`}>
            {isArmed ? (engineState === 'IDLE' ? 'ARMED & READY' : engineState) : 'STANDBY'}
          </span>
        </div>
        <div className="text-[11px] font-bold text-emerald-400">
          {totalWps} {totalWps === 1 ? 'Waypoint' : 'Waypoints'}
        </div>
      </div>

      {uploadNotice && (
        <div className="px-2.5 py-1.5 rounded bg-sky-950/80 border border-sky-500/60 text-sky-200 text-[11px] font-mono flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{uploadNotice}</span>
        </div>
      )}

      {/* 2 Primary Action Controls: Arm & Fly and Upload Waypoints */}
      <div className="grid grid-cols-2 gap-2">
        {/* Upload Waypoints Button */}
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={isUploading}
          className="py-2.5 px-3 rounded-lg bg-[#10B981] hover:bg-[#059669] text-emerald-950 font-sans font-bold text-[11px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md disabled:opacity-50"
          title="Upload planned waypoints to Pixhawk flight controller memory"
        >
          <Send className={`w-3.5 h-3.5 ${isUploading ? 'animate-bounce' : ''}`} />
          <span>{isUploading ? 'UPLOADING...' : 'UPLOAD WAYPOINTS'}</span>
        </button>

        {/* Arm and Fly Button */}
        <button
          type="button"
          onClick={onArmAndFly}
          className={`py-2.5 px-3 rounded-lg font-sans font-black text-[11px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md ${
            isArmed
              ? 'bg-[#059669] hover:bg-[#047857] text-white shadow-emerald-900/40 ring-1 ring-emerald-400'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50'
          }`}
          title={isArmed ? 'Vehicle is armed. Click to initiate autonomous mission.' : 'Arm vehicle motors and begin flight.'}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>ARM &amp; FLY</span>
        </button>
      </div>

      {/* Secondary Quick Action Row: Disarm & Emergency RTL */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
        {/* Disarm Toggle */}
        <button
          type="button"
          onClick={onToggleArm}
          className={`py-1.5 px-2.5 rounded-lg border text-[10.5px] font-mono font-bold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer ${
            isArmed
              ? 'bg-rose-950/60 border-rose-500/80 text-rose-300 hover:bg-rose-900/80'
              : 'bg-[#161B22] border-slate-800 text-slate-400 hover:text-white hover:bg-[#21262D]'
          }`}
          title={isArmed ? 'Disarm vehicle motors immediately' : 'Arm motors'}
        >
          <Power className="w-3 h-3" />
          <span>{isArmed ? 'DISARM MOTORS' : 'ARM MOTORS'}</span>
        </button>

        {/* Emergency RTL Button */}
        <button
          type="button"
          onClick={onEmergencyRTL}
          className={`py-1.5 px-2.5 rounded-lg border text-[10.5px] font-mono font-bold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer ${
            rtlConfirmPending
              ? 'bg-red-600 border-white text-white animate-pulse shadow-lg'
              : 'bg-red-950/70 border-red-700/80 text-red-300 hover:bg-red-900/80'
          }`}
          title={rtlConfirmPending ? 'Click again to confirm emergency RTL' : 'Command immediate emergency Return-to-Launch'}
        >
          <RotateCcw className="w-3 h-3" />
          <span>{rtlConfirmPending ? 'CONFIRM RTL' : 'EMERGENCY RTL'}</span>
        </button>
      </div>
    </Card>
  );
};
