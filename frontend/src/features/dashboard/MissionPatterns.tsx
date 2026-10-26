import React, { useState, useEffect } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Pause,
  AlignJustify,
  Circle,
  LayoutGrid,
  Scan,
  RotateCw,
  Disc,
  PenTool,
  Minus,
  Plus,
} from 'lucide-react';
import { Card } from '../../ui/Card';
import { groundStationMissionService, computeDestination } from '../../services/groundStationMissionService';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';
import { LatLngPoint, HomePoint } from '../../types/mission';

interface MissionPatternsProps {
  className?: string;
  onSelectPattern?: (patternId: string) => void;
}

export const MissionPatterns: React.FC<MissionPatternsProps> = ({
  className = '',
  onSelectPattern,
}) => {
  const [circleRadius, setCircleRadius] = useState<number>(() =>
    groundStationMissionService.getCircleRadius()
  );

  useEffect(() => {
    return groundStationMissionService.subscribeCircleRadius((r) => setCircleRadius(r));
  }, []);

  const getCenterPoint = (): { center: LatLngPoint | null; home: HomePoint } => {
    const telem = mavlinkService.getTelemetry();
    const home = mavlinkService.getHomePoint();
    const hasPixhawkGps = telem.gps.isLocked && Boolean(telem.latitude && Math.abs(telem.latitude) > 0.001);
    const hasHome = home.isSet && Math.abs(home.latitude) > 0.001;

    if (!hasPixhawkGps && !hasHome) {
      return { center: null, home };
    }

    const lat = hasPixhawkGps ? telem.latitude : home.latitude;
    const lon = hasPixhawkGps ? telem.longitude : home.longitude;

    return {
      center: { lat, lng: lon },
      home: home.isSet ? home : { latitude: lat, longitude: lon, altitude: 0, timestamp: Date.now(), isSet: true },
    };
  };

  const handlePatternClick = async (patternId: string) => {
    const { center, home } = getCenterPoint();

    audioService.playBeep(880, 80);

    if (patternId === 'Takeoff') {
      const telem = mavlinkService.getTelemetry();
      if (!telem.isArmed) {
        await mavlinkService.sendArmCommand(true);
      }
      await mavlinkService.commandTakeoff(5.0);
      return;
    }

    if (patternId === 'Land') {
      await mavlinkService.setFlightMode('LAND');
      return;
    }

    if (patternId === 'Hover') {
      await mavlinkService.setFlightMode('LOITER');
      return;
    }

    // All subsequent geometric flight patterns require a valid Pixhawk GPS center point
    if (!center) {
      audioService.playBeep(400, 150);
      alert('⚠️ Cannot generate mission pattern: Pixhawk GPS Signal Unavailable (No 3D Lock).');
      return;
    }

    switch (patternId) {

      case 'Line': {
        // Generate straight line route with 4 waypoints heading East
        const pts: LatLngPoint[] = [
          center,
          computeDestination(center.lat, center.lng, 10, 90),
          computeDestination(center.lat, center.lng, 25, 90),
          computeDestination(center.lat, center.lng, 40, 90),
        ];
        groundStationMissionService.generateWaypointMission(pts, home, 30, 5.0);
        break;
      }

      case 'Circle': {
        // Generate circular orbit mission using active configured radius
        groundStationMissionService.setDrawingTool('circle');
        groundStationMissionService.generateCircleMission(center, circleRadius, home, 25, 4.0, 'CW');
        break;
      }

      case 'Concentric': {
        // Generate 3 concentric rings scaled by active radius
        const r1 = Math.max(3, Math.round(circleRadius * 0.4));
        const r2 = Math.max(r1 + 3, Math.round(circleRadius * 0.8));
        const r3 = Math.max(r2 + 3, circleRadius);
        groundStationMissionService.setDrawingTool('concentric_circle');
        groundStationMissionService.generateConcentricCircleMission(center, [r1, r2, r3], home, 20, 4.0, 'CW');
        break;
      }

      case 'Draw': {
        // Activate Freehand Cursor Draw mode on the map
        groundStationMissionService.setDrawingTool('draw');
        break;
      }

      case 'Grid': {
        // Generate 4-corner box polygon grid search
        const p1 = computeDestination(center.lat, center.lng, 20, 315);
        const p2 = computeDestination(center.lat, center.lng, 20, 45);
        const p3 = computeDestination(center.lat, center.lng, 20, 135);
        const p4 = computeDestination(center.lat, center.lng, 20, 225);
        groundStationMissionService.generatePolygonGridMission([p1, p2, p3, p4], home, 20, 4.5, 6.0);
        break;
      }

      case 'Survey': {
        // Lawnmower transect sweep
        const p1 = computeDestination(center.lat, center.lng, 30, 330);
        const p2 = computeDestination(center.lat, center.lng, 30, 30);
        const p3 = computeDestination(center.lat, center.lng, 30, 150);
        const p4 = computeDestination(center.lat, center.lng, 30, 210);
        groundStationMissionService.generatePolygonGridMission([p1, p2, p3, p4], home, 25, 5.0, 8.0);
        break;
      }

      case 'Spiral': {
        // Archimedean expanding spiral waypoints (6 loops outward)
        const spiralPts: LatLngPoint[] = [center];
        const numPoints = 16;
        for (let i = 1; i <= numPoints; i++) {
          const angle = (i * 45) % 360;
          const dist = 4 + i * 2.2;
          spiralPts.push(computeDestination(center.lat, center.lng, dist, angle));
        }
        groundStationMissionService.generateWaypointMission(spiralPts, home, 20, 4.0);
        break;
      }
    }

    onSelectPattern?.(patternId);
  };

  const patterns = [
    {
      id: 'Takeoff',
      label: 'Takeoff',
      icon: <ArrowUp className="w-3.5 h-3.5 text-[#22C55E]" />,
      desc: 'Climb 5m',
    },
    {
      id: 'Land',
      label: 'Land',
      icon: <ArrowDown className="w-3.5 h-3.5 text-[#DC2626]" />,
      desc: 'Land Mode',
    },
    {
      id: 'Hover',
      label: 'Hover',
      icon: <Pause className="w-3.5 h-3.5 text-[var(--uav-primary-blue)]" />,
      desc: 'Loiter Hold',
    },
    {
      id: 'Line',
      label: 'Line',
      icon: <AlignJustify className="w-3.5 h-3.5 text-[var(--uav-icon-blue)]" />,
      desc: 'Transit Path',
    },
    {
      id: 'Circle',
      label: 'Circle',
      icon: <Circle className="w-3.5 h-3.5 text-[#22C55E]" />,
      desc: 'Single Orbit',
    },
    {
      id: 'Concentric',
      label: 'Concentric',
      icon: <Disc className="w-3.5 h-3.5 text-amber-400" />,
      desc: 'Concentric Rings',
    },
    {
      id: 'Draw',
      label: 'Draw',
      icon: <PenTool className="w-3.5 h-3.5 text-sky-400" />,
      desc: 'Cursor Draw',
    },
    {
      id: 'Grid',
      label: 'Grid',
      icon: <LayoutGrid className="w-3.5 h-3.5 text-[var(--uav-amber)]" />,
      desc: 'Search Grid',
    },
    {
      id: 'Survey',
      label: 'Survey',
      icon: <Scan className="w-3.5 h-3.5 text-[var(--uav-purple)]" />,
      desc: 'Area Sweep',
    },
    {
      id: 'Spiral',
      label: 'Spiral',
      icon: <RotateCw className="w-3.5 h-3.5 text-[var(--uav-icon-blue)]" />,
      desc: 'Expand Spiral',
    },
  ];

  return (
    <Card
      title="MISSION PATTERNS"
      collapsible
      action={
        <div className="flex items-center gap-1.5 bg-[#161B22] px-2 py-0.5 rounded-[5px] border border-[var(--uav-card-border)] text-[11px] font-mono shadow-sm">
          <span className="text-[10px] text-slate-400 font-sans uppercase font-bold">Radius:</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              groundStationMissionService.decreaseCircleRadius(2);
              audioService.playBeep(700, 30);
            }}
            className="w-4 h-4 flex items-center justify-center rounded bg-[#21262D] hover:bg-[#262C36] text-slate-200 hover:text-white font-bold cursor-pointer transition active:scale-90"
            title="Decrease Orbit Radius (-2m)"
          >
            <Minus className="w-2.5 h-2.5" />
          </button>
          <span className="text-emerald-400 font-bold min-w-[26px] text-center">{circleRadius}m</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              groundStationMissionService.increaseCircleRadius(2);
              audioService.playBeep(850, 30);
            }}
            className="w-4 h-4 flex items-center justify-center rounded bg-[#21262D] hover:bg-[#262C36] text-slate-200 hover:text-white font-bold cursor-pointer transition active:scale-90"
            title="Increase Orbit Radius (+2m)"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        </div>
      }
      className={`h-[205px] w-full shrink-0 select-none ${className}`}
      contentClassName="p-2 flex items-center justify-center overflow-hidden"
    >
      <div className="grid grid-cols-5 grid-rows-2 gap-1.5 w-full h-full">
        {patterns.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handlePatternClick(p.id)}
            className="flex flex-col items-center justify-center rounded-[7px] border border-[var(--uav-card-border)] bg-[#161B22] hover:bg-[#21262D] hover:border-[var(--uav-primary-blue)] transition cursor-pointer p-1 active:scale-95"
            title={`${p.label}: ${p.desc}`}
          >
            <div className="mb-0.5">{p.icon}</div>
            <span className="text-[10px] font-sans font-medium text-[var(--uav-text)] leading-tight text-center truncate w-full">
              {p.label}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
};
