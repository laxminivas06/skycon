import React, { useState, useEffect } from 'react';
import { Send, Play } from 'lucide-react';
import { Card } from '../../ui/Card';
import { groundStationMissionService } from '../../services/groundStationMissionService';
import { missionEngine } from '../../services/missionEngine';
import { mavlinkService } from '../../services/mavlinkService';
import { GroundStationMission } from '../../types/groundStationMap';

interface MissionStatusProps {
  onUploadWaypoints?: () => void;
  onArmAndFly?: () => void;
  className?: string;
  statusText?: string;
  waypointProgress?: string;
  progressPercent?: number;
  currentWp?: string;
  distanceToWp?: string;
  timeRemaining?: string;
  failsafeStatus?: string;
  isArmed?: boolean;
}

export const MissionStatus: React.FC<MissionStatusProps> = ({
  onUploadWaypoints,
  onArmAndFly,
  className = '',
  statusText,
  waypointProgress,
  progressPercent,
  currentWp,
  distanceToWp,
  timeRemaining,
  failsafeStatus = 'Enabled',
  isArmed = false,
}) => {
  const [mission, setMission] = useState<GroundStationMission | null>(() =>
    groundStationMissionService.getCurrentMission()
  );
  const [engineState, setEngineState] = useState<string>(missionEngine.getCurrentState());
  const [engineProgress, setEngineProgress] = useState<number>(0);
  const [distToNextWp, setDistToNextWp] = useState<string>('-');

  useEffect(() => {
    const unsubMission = groundStationMissionService.subscribe((m) => {
      setMission(m);
    });

    const unsubEngine = missionEngine.subscribeState((st) => {
      setEngineState(st);
      const telem = mavlinkService.getTelemetry();
      setEngineProgress(telem.searchProgress || 0);

      // Distance to next waypoint
      const curr = groundStationMissionService.getCurrentMission();
      if (curr && curr.waypoints.length > 0) {
        const nextWp = curr.waypoints[0];
        const lat = telem.latitude || 0;
        const lon = telem.longitude || 0;
        if (Math.abs(lat) > 0.001) {
          const d = Math.round(
            Math.sqrt(Math.pow((nextWp.lat - lat) * 111319, 2) + Math.pow((nextWp.lng - lon) * 111319, 2))
          );
          setDistToNextWp(`${d} m`);
        }
      }
    });

    return () => {
      unsubMission();
      unsubEngine();
    };
  }, []);

  const totalWaypoints = mission?.waypoints.length || 0;
  const displayStatus = statusText || (isArmed ? (engineState === 'IDLE' ? 'ARMED' : engineState) : 'Not Started');
  const displayWpProgress = waypointProgress || `${totalWaypoints > 0 ? '1' : '0'}/${totalWaypoints} Waypoints`;
  const displayProgress = progressPercent !== undefined ? progressPercent : engineProgress;

  return (
    <Card
      title="MISSION STATUS"
      action={
        <div className="flex items-center gap-2">
          {/* Status Pill */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] border border-[var(--uav-card-border)] bg-[#161B22] text-[10px] font-sans text-[var(--uav-text)]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isArmed ? 'bg-[#22C55E] animate-pulse' : 'bg-[var(--uav-muted)]'
              }`}
            />
            <span>{displayStatus}</span>
          </div>
          <span className="text-[10px] font-mono text-[var(--uav-muted)]">
            {displayWpProgress}
          </span>
        </div>
      }
      className={`h-[170px] shrink-0 select-none ${className}`}
      contentClassName="p-2.5 flex flex-col justify-between overflow-hidden"
    >
      {/* Progress Bar Row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-[#21262D] overflow-hidden">
          <div
            className="h-full bg-[var(--uav-primary-blue)] transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, displayProgress))}%` }}
          />
        </div>
        <span className="text-[10px] font-mono font-bold text-[var(--uav-muted)]">
          {displayProgress}%
        </span>
      </div>

      {/* 4 Status Rows (Clean 2x2 Grid) */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] font-sans">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[var(--uav-muted)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
            <span className="truncate">Current WP</span>
          </div>
          <span className="font-mono text-[var(--uav-text)] font-semibold">
            {currentWp || (totalWaypoints > 0 ? 'WP 1' : '-')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[var(--uav-muted)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
            <span className="truncate">Distance</span>
          </div>
          <span className="font-mono text-[var(--uav-text)] font-semibold">
            {distanceToWp || distToNextWp}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[var(--uav-muted)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--uav-icon-blue)]" />
            <span className="truncate">Est. Time</span>
          </div>
          <span className="font-mono text-[var(--uav-text)] font-semibold">
            {timeRemaining || (mission?.estimatedDuration ? `${Math.round(mission.estimatedDuration / 60)}m` : '-')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[var(--uav-muted)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--uav-icon-blue)]" />
            <span>Failsafe</span>
          </div>
          <span className="font-mono text-[#22C55E] font-semibold">{failsafeStatus}</span>
        </div>
      </div>

      {/* Two Action Buttons Side-by-Side */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <button
          type="button"
          onClick={onUploadWaypoints}
          className="py-1.5 px-2.5 rounded-[7px] bg-[#10B981] hover:bg-[#059669] text-emerald-950 font-sans font-bold text-[10.5px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-none"
        >
          <Send className="w-3.5 h-3.5" />
          <span>UPLOAD WAYPOINTS</span>
        </button>

        <button
          type="button"
          onClick={onArmAndFly}
          className="py-1.5 px-2.5 rounded-[7px] bg-[#059669] hover:bg-[#047857] text-white font-sans font-bold text-[10.5px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-none"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>ARM & FLY</span>
        </button>
      </div>
    </Card>
  );
};
