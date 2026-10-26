import React, { useState } from 'react';
import { DroneTelemetry } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';

interface VehicleFleetListProps {
  telemetry: DroneTelemetry;
  pixhawkState: PixhawkConnectionState;
  selectedVehicleId?: string;
  onSelectVehicle?: (id: string) => void;
  onPauseDrone?: () => void;
  onResumeDrone?: () => void;
  className?: string;
}

interface FleetVehicle {
  id: string;
  name: string;
  status: 'ACTIVE' | 'STANDBY' | 'SEARCHING' | 'RETURN' | 'OFFLINE';
  battery: number;
  alt: number;
  speed: number;
  signal: number;
  isMainUnit?: boolean;
}

export const VehicleFleetList: React.FC<VehicleFleetListProps> = ({
  telemetry,
  pixhawkState,
  selectedVehicleId = 'veh-1',
  onSelectVehicle,
  onPauseDrone,
  onResumeDrone,
  className = ''
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [activeVehId, setActiveVehId] = useState(selectedVehicleId);

  // Fleet list matching Image 1
  const vehicles: FleetVehicle[] = [
    {
      id: 'veh-1',
      name: 'Vehicle 1 (Rescue Core)',
      status: telemetry.isArmed ? 'ACTIVE' : 'STANDBY',
      battery: telemetry.batteryPercent || 88,
      alt: +(telemetry.altitude || 0).toFixed(1),
      speed: +(telemetry.groundSpeed || 0).toFixed(1),
      signal: 98,
      isMainUnit: true
    },
    { id: 'veh-2', name: 'Vehicle 2 (Perimeter)', status: 'STANDBY', battery: 94, alt: 20, speed: 4.6, signal: 92 },
    { id: 'veh-3', name: 'Vehicle 3 (Relay Node)', status: 'STANDBY', battery: 89, alt: 20, speed: 4.6, signal: 85 },
    { id: 'veh-4', name: 'Vehicle 4 (Search Alpha)', status: 'STANDBY', battery: 76, alt: 25, speed: 4.8, signal: 90 },
    {
      id: 'veh-5',
      name: 'Vehicle 5 (Visual Recon)',
      status: 'ACTIVE',
      battery: 100,
      alt: 20,
      speed: 4.6,
      signal: 99
    },
    { id: 'veh-6', name: 'Vehicle 6 (Runner Guard)', status: 'STANDBY', battery: 65, alt: 15, speed: 3.2, signal: 80 },
    { id: 'veh-7', name: 'Vehicle 7 (Survey Beta)', status: 'STANDBY', battery: 82, alt: 20, speed: 4.6, signal: 88 },
    { id: 'veh-8', name: 'Vehicle 8 (Escort)', status: 'STANDBY', battery: 91, alt: 20, speed: 4.6, signal: 95 }
  ];

  const filteredVehicles = vehicles.filter((v) => {
    if (searchQuery && !v.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterActive && v.status !== 'ACTIVE') return false;
    return true;
  });

  const handleSelect = (id: string) => {
    setActiveVehId(id);
    onSelectVehicle?.(id);
  };

  return (
    <div className={`bg-[#17181b] border-b border-[#2d2e33] flex flex-col select-none ${className}`}>
      {/* Top Search & Filter Bar */}
      <div className="p-2 border-b border-[#2a2b30] flex items-center gap-1.5 bg-[#1a1b1f]">
        <div className="flex-1 relative flex items-center bg-[#101114] rounded-md border border-[#34353a] px-2 py-1">
          <span className="material-symbols-outlined text-[14px] text-slate-400 mr-1.5">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent text-[11px] text-white placeholder-slate-500 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-white text-xs">
              ✕
            </button>
          )}
        </div>

        {/* Filter Button */}
        <button
          onClick={() => setFilterActive(!filterActive)}
          className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
            filterActive
              ? 'bg-[#2563eb] border-[#3b82f6] text-white'
              : 'bg-[#1e1f24] border-[#34353a] text-slate-400 hover:text-white'
          }`}
          title="Filter Active Units"
        >
          <span className="material-symbols-outlined text-[15px]">filter_alt</span>
        </button>

        {/* Add Vehicle Button */}
        <button
          className="p-1.5 rounded-md bg-[#1e1f24] hover:bg-[#282a30] border border-[#34353a] text-slate-300 hover:text-white transition-colors cursor-pointer"
          title="Add Vehicle to Swarm"
        >
          <span className="material-symbols-outlined text-[15px]">add_box</span>
        </button>
      </div>

      {/* Vehicle List Items (Image 1 Style) */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#222328] scrollbar-thin scrollbar-thumb-slate-700">
        {filteredVehicles.map((veh) => {
          const isSelected = activeVehId === veh.id;
          return (
            <div
              key={veh.id}
              onClick={() => handleSelect(veh.id)}
              className={`flex items-center justify-between px-2.5 py-1.5 cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-[#2563eb]/25 border-l-3 border-[#3b82f6] text-white shadow-sm'
                  : 'hover:bg-[#1f2025] text-slate-300'
              }`}
            >
              {/* Left Info: Chevron + Icon + Name */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="material-symbols-outlined text-[14px] text-slate-500">
                  {isSelected ? 'expand_more' : 'chevron_right'}
                </span>
                {/* Drone / Hexacopter Icon */}
                <span className={`material-symbols-outlined text-[16px] ${isSelected ? 'text-[#38bdf8]' : 'text-slate-400'}`}>
                  flight
                </span>
                <div className="flex flex-col min-w-0">
                  <span className={`font-sans text-[11px] font-semibold truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                    {veh.name}
                  </span>
                  {isSelected && (
                    <span className="font-mono text-[9px] text-[#38bdf8] flex items-center gap-1">
                      <span>ALT: {veh.alt}m</span>
                      <span>•</span>
                      <span>SPD: {veh.speed}m/s</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Right Quick Controls & Status Icons */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Status Indicator */}
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    veh.status === 'ACTIVE'
                      ? 'bg-[#22c55e] animate-pulse'
                      : 'bg-slate-500'
                  }`}
                  title={veh.status}
                />

                {/* Battery Pill */}
                <span className="font-mono text-[9px] text-slate-400">
                  {veh.battery}%
                </span>

                {/* Target Lock Icon */}
                <span className="material-symbols-outlined text-[14px] text-slate-500 hover:text-[#38bdf8]">
                  target
                </span>

                {/* Audio / Comm Icon */}
                <span className="material-symbols-outlined text-[14px] text-slate-500 hover:text-white">
                  volume_up
                </span>

                {/* Action Play/Pause for active unit */}
                {isSelected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (telemetry.flightMode === 'LOITER') {
                        onResumeDrone?.();
                      } else {
                        onPauseDrone?.();
                      }
                    }}
                    className="p-1 rounded bg-[#2a2b30] hover:bg-[#34353a] text-white cursor-pointer ml-0.5"
                    title={telemetry.flightMode === 'LOITER' ? 'Resume Flight' : 'Loiter / Hold'}
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {telemetry.flightMode === 'LOITER' ? 'play_arrow' : 'pause'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
