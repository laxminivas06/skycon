import React, { useState } from 'react';
import { DroneTelemetry } from '../../types/mission';

interface TrafficViewRadarProps {
  telemetry: DroneTelemetry;
  className?: string;
  onClose?: () => void;
}

export const TrafficViewRadar: React.FC<TrafficViewRadarProps> = ({
  telemetry,
  className = '',
  onClose
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  const heading = telemetry.heading || 0;
  const alt = telemetry.altitude || 0;

  // Relative positions for airspace traffic dots around drone (matching Image 1)
  const trafficNodes = [
    { id: 'T1', x: 75, y: 35, color: '#22d3ee', alt: 25, speed: 4.8 }, // Cyan
    { id: 'T2', x: 65, y: 55, color: '#22d3ee', alt: 20, speed: 4.6 }, // Cyan
    { id: 'T3', x: 105, y: 40, color: '#38bdf8', alt: 30, speed: 5.2 }, // Sky
    { id: 'T4', x: 120, y: 50, color: '#38bdf8', alt: 28, speed: 4.1 }, // Sky
    { id: 'T5', x: 90, y: 70, color: '#fb923c', alt: 20, speed: 3.5 }, // Orange
    { id: 'T6', x: 100, y: 80, color: '#fb923c', alt: 22, speed: 3.9 }, // Orange
    { id: 'T7', x: 45, y: 70, color: '#4ade80', alt: 18, speed: 4.0 }, // Green
    { id: 'T8', x: 60, y: 80, color: '#f87171', alt: 15, speed: 6.0 } // Red / Alert
  ];

  return (
    <div
      className={`bg-[#18191c]/95 backdrop-blur-md rounded-xl border border-[#343537]/80 shadow-2xl overflow-hidden select-none text-slate-200 transition-all ${
        isCollapsed ? 'w-48 h-9' : 'w-56 h-48'
      } ${className}`}
    >
      {/* Header Strip */}
      <div className="px-2.5 py-1.5 bg-[#1f2022] border-b border-[#343537]/80 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#38bdf8] animate-pulse" />
          <span className="font-sans text-[10px] uppercase font-bold tracking-wider text-slate-200">
            TRAFFIC VIEW
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[9px] text-[#38bdf8] font-semibold">
            {trafficNodes.length} NODES
          </span>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#292a2c] text-xs font-bold transition-colors cursor-pointer"
            title={isCollapsed ? 'Expand Radar' : 'Collapse Radar'}
          >
            {isCollapsed ? '+' : '−'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#292a2c] text-xs transition-colors cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-2 relative flex flex-col items-center justify-center h-[calc(100%-36px)] bg-[#121316]">
          {/* Radar Screen Canvas */}
          <div className="w-full h-full relative rounded-lg bg-[#0e0f12] border border-[#2a2b2e] overflow-hidden flex items-center justify-center">
            {/* Concentric Range Rings */}
            <div className="absolute w-36 h-36 rounded-full border border-slate-700/30 pointer-events-none" />
            <div className="absolute w-24 h-24 rounded-full border border-slate-700/40 pointer-events-none" />
            <div className="absolute w-12 h-12 rounded-full border border-slate-700/50 pointer-events-none" />

            {/* Crosshair Grids */}
            <div className="absolute w-full h-px bg-slate-700/30 pointer-events-none" />
            <div className="absolute h-full w-px bg-slate-700/30 pointer-events-none" />

            {/* Sweep Animation Line */}
            <div
              className="absolute w-20 h-20 origin-bottom-right pointer-events-none"
              style={{
                top: 0,
                left: 0,
                background: 'conic-gradient(from 0deg, transparent 0deg, rgba(56, 189, 248, 0.15) 60deg, transparent 65deg)',
                animation: 'spin 4s linear infinite'
              }}
            />

            {/* Traffic Nodes (Airspace situational awareness) */}
            {trafficNodes.map((node) => (
              <div
                key={node.id}
                className="absolute w-2 h-2 rounded-full shadow-md group cursor-pointer hover:scale-150 transition-transform"
                style={{
                  left: `${(node.x / 160) * 100}%`,
                  top: `${(node.y / 120) * 100}%`,
                  backgroundColor: node.color,
                  boxShadow: `0 0 6px ${node.color}`
                }}
                title={`${node.id}: Alt ${node.alt}m, Speed ${node.speed} m/s`}
              >
                {/* Node hover tag */}
                <div className="hidden group-hover:flex absolute -top-5 left-1/2 -translate-x-1/2 bg-black/90 px-1 py-0.5 rounded text-[8px] font-mono text-white whitespace-nowrap z-20 border border-slate-700 pointer-events-none">
                  {node.id} • {node.alt}m
                </div>
              </div>
            ))}

            {/* Center UAV / Drone Icon */}
            <div
              className="relative z-10 w-4 h-4 rounded-full bg-[#2563eb] border-2 border-white flex items-center justify-center shadow-lg transition-transform"
              style={{ transform: `rotate(${heading}deg)` }}
              title={`Vehicle 1 (You) • Alt ${alt.toFixed(1)}m`}
            >
              {/* Heading arrow */}
              <div className="w-0 h-0 border-x-3 border-x-transparent border-b-4 border-b-white -mt-2" />
            </div>

            {/* Range tags */}
            <div className="absolute bottom-1 right-1 font-mono text-[8px] text-slate-500 pointer-events-none">
              R: 500m
            </div>
            <div className="absolute top-1 left-1 font-mono text-[8px] text-emerald-400 pointer-events-none">
              SEC: CLR
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
