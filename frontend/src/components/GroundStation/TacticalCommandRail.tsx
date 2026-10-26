import React, { useState } from 'react';

interface TacticalCommandRailProps {
  isArmed: boolean;
  flightMode: string;
  onTakeoff: () => void;
  onLoiter: () => void;
  onLand: () => void;
  onEmergencyRTL: () => void;
  onCenterDrone?: () => void;
  onClearDrawings?: () => void;
  onUploadMission?: () => void;
  onDownloadMission?: () => void;
  onDeleteMission?: () => void;
  onOpenGeofence?: () => void;
  onOpenSettings?: () => void;
  onTogglePlayMission?: () => void;
  className?: string;
}

export const TacticalCommandRail: React.FC<TacticalCommandRailProps> = ({
  isArmed,
  flightMode,
  onTakeoff,
  onLoiter,
  onLand,
  onEmergencyRTL,
  onCenterDrone,
  onClearDrawings,
  onUploadMission,
  onDownloadMission,
  onDeleteMission,
  onOpenGeofence,
  onOpenSettings,
  onTogglePlayMission,
  className = ''
}) => {
  const [activeTool, setActiveTool] = useState<'select' | 'crosshair' | 'draw'>('select');

  return (
    <aside
      className={`flex flex-col w-10 bg-[#18191d]/95 backdrop-blur-md rounded-xl shadow-2xl border border-[#303138] p-1 gap-1 z-30 select-none ${className}`}
    >
      {/* 1. SELECTION BOX TOOL */}
      <button
        onClick={() => setActiveTool('select')}
        className={`flex items-center justify-center h-8 w-full rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm ${
          activeTool === 'select'
            ? 'bg-[#2563eb] text-white shadow-md shadow-blue-600/40'
            : 'bg-[#1e1f24] hover:bg-[#282a30] text-slate-300'
        }`}
        title="Tactical Box Selection Tool"
      >
        <span className="material-symbols-outlined text-[17px]">crop_square</span>
      </button>

      {/* 2. TRASH / CLEAR DRAWINGS */}
      <button
        onClick={onClearDrawings}
        className="flex items-center justify-center h-8 w-full rounded-lg bg-[#1e1f24] hover:bg-[#282a30] text-slate-400 hover:text-rose-400 transition-all active:scale-95 cursor-pointer shadow-sm"
        title="Clear Selected Drawings"
      >
        <span className="material-symbols-outlined text-[17px]">delete</span>
      </button>

      {/* 3. CROSSHAIR / LOCATE DRONE */}
      <button
        onClick={() => {
          setActiveTool('crosshair');
          onCenterDrone?.();
        }}
        className={`flex items-center justify-center h-8 w-full rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm ${
          activeTool === 'crosshair'
            ? 'bg-[#2563eb] text-white shadow-md'
            : 'bg-[#1e1f24] hover:bg-[#282a30] text-slate-400 hover:text-[#38bdf8]'
        }`}
        title="Center / Lock onto Drone"
      >
        <span className="material-symbols-outlined text-[17px]">my_location</span>
      </button>

      {/* 4. GEOFENCE AIRSPACE CONTROL */}
      <button
        onClick={onOpenGeofence}
        className="flex items-center justify-center h-8 w-full rounded-lg bg-[#1e1f24] hover:bg-amber-950/60 text-amber-400 hover:text-amber-200 transition-all active:scale-95 cursor-pointer shadow-sm"
        title="Autonomous Geofence & Boundary Settings (ADDC Rule 3.3)"
      >
        <span className="material-symbols-outlined text-[17px]">shield</span>
      </button>

      {/* 5. UPLOAD MISSION / WAYPOINTS */}
      <button
        onClick={onUploadMission}
        className="flex items-center justify-center h-8 w-full rounded-lg bg-[#1e1f24] hover:bg-[#282a30] text-slate-400 hover:text-[#38bdf8] transition-all active:scale-95 cursor-pointer shadow-sm"
        title="Upload Mission to Drone (FC)"
      >
        <span className="material-symbols-outlined text-[17px]">upload</span>
      </button>

      {/* 6. DOWNLOAD MISSION FROM DRONE */}
      <button
        onClick={onDownloadMission}
        className="flex items-center justify-center h-8 w-full rounded-lg bg-[#1e1f24] hover:bg-[#282a30] text-slate-400 hover:text-[#38bdf8] transition-all active:scale-95 cursor-pointer shadow-sm"
        title="Download Mission from Drone (FC)"
      >
        <span className="material-symbols-outlined text-[17px]">download</span>
      </button>

      {/* 7. DELETE / WIPE MISSION */}
      <button
        onClick={onDeleteMission}
        className="flex items-center justify-center h-8 w-full rounded-lg bg-[#1e1f24] hover:bg-red-950/70 text-slate-400 hover:text-red-400 transition-all active:scale-95 cursor-pointer shadow-sm"
        title="Delete Mission from GCS & Flight Controller (MISSION_CLEAR_ALL)"
      >
        <span className="material-symbols-outlined text-[17px]">delete_forever</span>
      </button>

      {/* 7. SLIDERS / PARAMETERS */}
      <button
        onClick={onOpenSettings}
        className="flex items-center justify-center h-8 w-full rounded-lg bg-[#1e1f24] hover:bg-[#282a30] text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer shadow-sm"
        title="Configure Search & Drone Parameters"
      >
        <span className="material-symbols-outlined text-[17px]">tune</span>
      </button>

      {/* 8. PLAY / EXECUTE MISSION */}
      <button
        onClick={onTogglePlayMission}
        className="flex items-center justify-center h-8 w-full rounded-lg bg-[#1e1f24] hover:bg-[#282a30] text-slate-400 hover:text-[#22c55e] transition-all active:scale-95 cursor-pointer shadow-sm"
        title="Start / Resume Mission Execution"
      >
        <span className="material-symbols-outlined text-[17px]">play_arrow</span>
      </button>

      <div className="w-full h-px bg-[#2d2e34] my-0.5" />

      {/* 9. TAKEOFF COMMAND */}
      <button
        onClick={onTakeoff}
        className="flex flex-col items-center justify-center h-8.5 w-full rounded-lg bg-[#1e1f24] hover:bg-[#2563eb] text-[#38bdf8] hover:text-white transition-all active:scale-95 cursor-pointer shadow-sm"
        title="Initiate Autonomous Takeoff (5.0m)"
      >
        <span className="material-symbols-outlined text-[16px]">flight_takeoff</span>
        <span className="text-[7px] font-bold uppercase">TKOF</span>
      </button>

      {/* 10. LOITER / PAUSE */}
      <button
        onClick={onLoiter}
        className={`flex flex-col items-center justify-center h-8.5 w-full rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm ${
          flightMode === 'LOITER'
            ? 'bg-[#f59e0b] text-white'
            : 'bg-[#1e1f24] hover:bg-[#282a30] text-[#f59e0b]'
        }`}
        title="Loiter / Brake and Hold Position"
      >
        <span className="material-symbols-outlined text-[16px]">pause</span>
        <span className="text-[7px] font-bold uppercase">HOLD</span>
      </button>

      {/* 11. LAND */}
      <button
        onClick={onLand}
        className={`flex flex-col items-center justify-center h-8.5 w-full rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm ${
          flightMode === 'LAND'
            ? 'bg-white text-slate-900 font-bold'
            : 'bg-[#1e1f24] hover:bg-[#282a30] text-slate-300'
        }`}
        title="Precision Land"
      >
        <span className="material-symbols-outlined text-[16px]">flight_land</span>
        <span className="text-[7px] font-bold uppercase">LAND</span>
      </button>

      {/* 12. EMERGENCY RTL */}
      <button
        onClick={onEmergencyRTL}
        className="flex flex-col items-center justify-center h-8.5 w-full rounded-lg bg-[#b91c1c]/40 hover:bg-[#b91c1c] text-[#fca5a5] hover:text-white border border-[#b91c1c] transition-all active:scale-95 cursor-pointer shadow-md"
        title="Emergency Return To Launch (RTL)"
      >
        <span className="material-symbols-outlined text-[16px]">u_turn_left</span>
        <span className="text-[7px] font-bold uppercase">RTL</span>
      </button>
    </aside>
  );
};
