import React from 'react';
import { AppRole, MissionState } from '../../types/mission';
import { DroneTelemetry } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { 
  Radio, 
  Battery, 
  Satellite, 
  Compass, 
  ShieldAlert, 
  RotateCcw, 
  Flame, 
  Activity, 
  Volume2, 
  VolumeX, 
  Layers,
  History,
  Smartphone,
  Info,
  X,
  Wifi,
  Map,
  ExternalLink,
  Plane
} from 'lucide-react';
import { audioService } from '../../services/audioService';
import { ThemeController } from './ThemeController';
import { authService } from '../../services/authService';
import { mavlinkService } from '../../services/mavlinkService';

interface HeaderProps {
  currentRole: AppRole;
  missionState: MissionState;
  telemetry: DroneTelemetry;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  onSwitchRole: () => void;
  onOpenHistory: () => void;
  onResetMission?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  missionState,
  telemetry,
  pixhawkState,
  runnerLink,
  onSwitchRole,
  onOpenHistory,
  onResetMission
}) => {
  const [muted, setMuted] = React.useState(audioService.getMuted());
  const [showTeamInfo, setShowTeamInfo] = React.useState(false);

  const toggleMute = () => {
    const next = !muted;
    audioService.setMuted(next);
    setMuted(next);
  };

  const getRoleLabel = () => {
    switch (currentRole) {
      case 'GROUND_STATION':
        return 'GROUND STATION ANDROID';
      case 'DRONE':
        return 'DRONE ANDROID MISSION CORE';
      case 'RUNNER':
        return 'RUNNER ANDROID FIELD UNIT';
      case 'TESTBENCH':
        return 'FIELD OPS SIMULATOR & TESTBENCH';
      default:
        return 'SAE INDIA MISSION SYSTEM';
    }
  };

  const getRoleBadgeColor = () => {
    switch (currentRole) {
      case 'GROUND_STATION':
        return 'bg-sky-500/20 text-sky-400 border-sky-500/40';
      case 'DRONE':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'RUNNER':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
      default:
        return 'bg-purple-500/20 text-purple-400 border-purple-500/40';
    }
  };

  return (
    <header className="bg-[#0d0e10]/95 border-b border-[#343537] backdrop-blur-md px-3 sm:px-4 h-12 flex items-center justify-between text-xs select-none z-50 sticky top-0 shadow-[0_1px_8px_rgba(0,0,0,0.6)]">
      {/* Left: Branding & Quick Menus (Matching Image 1) */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Blue Circular Brand Logo (Matching Image 1) */}
        <button
          onClick={onSwitchRole}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md transition cursor-pointer border border-blue-400/40"
          title="SAE India Autonomous Rescue Mission Core"
        >
          <span className="material-symbols-outlined text-[17px]">navigation</span>
        </button>

        {/* "File" Menu */}
        <div className="relative group">
          <button className="px-2 py-1 rounded text-slate-300 hover:text-white hover:bg-[#1e1f24] font-sans text-xs font-semibold flex items-center gap-1 transition cursor-pointer">
            <span>File</span>
            <span className="material-symbols-outlined text-[13px] text-slate-500">expand_more</span>
          </button>
          <div className="hidden group-hover:flex flex-col absolute top-full left-0 bg-[#18191d] border border-[#303138] rounded-lg shadow-2xl py-1 min-w-[140px] z-50">
            <button onClick={onResetMission} className="px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-[#2563eb] hover:text-white transition">
              New Mission
            </button>
            <button onClick={onOpenHistory} className="px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-[#2563eb] hover:text-white transition">
              Mission Logs
            </button>
            <button onClick={() => setShowTeamInfo(true)} className="px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-[#2563eb] hover:text-white transition">
              About Skycon
            </button>
          </div>
        </div>

        {/* "Tools" Menu */}
        <div className="relative group">
          <button className="px-2 py-1 rounded text-slate-300 hover:text-white hover:bg-[#1e1f24] font-sans text-xs font-semibold flex items-center gap-1 transition cursor-pointer">
            <span>Tools</span>
            <span className="material-symbols-outlined text-[13px] text-slate-500">expand_more</span>
          </button>
          <div className="hidden group-hover:flex flex-col absolute top-full left-0 bg-[#18191d] border border-[#303138] rounded-lg shadow-2xl py-1 min-w-[140px] z-50">
            <button onClick={onOpenHistory} className="px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-[#2563eb] hover:text-white transition">
              Blackbox Logs
            </button>
            <button onClick={() => setShowTeamInfo(true)} className="px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-[#2563eb] hover:text-white transition">
              About Skycon
            </button>
          </div>
        </div>
      </div>

      {/* Center: Clean Tactical Cockpit Designation */}
      <div className="flex items-center gap-2">
        <span className="font-orbitron font-extrabold text-[12px] tracking-widest text-slate-200 uppercase">
          AERORECON MISSION INTERFACE
        </span>
      </div>

      {/* Right: Live Telemetry Badges & Instrument Controls */}
      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px]">
        {/* Mode Badge */}
        <div className="px-2 py-0.5 rounded bg-[#008442]/20 border border-[#008442]/40 text-[#57df85] font-sans font-bold text-[10px] uppercase flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#57df85]" />
          <span>{telemetry.flightMode || 'GUIDED'}</span>
        </div>

        {/* Arm State Badge */}
        <div className={`px-2 py-0.5 rounded font-sans font-bold text-[10px] uppercase border ${
          telemetry.isArmed
            ? 'bg-[#008442]/30 border-[#008442]/60 text-[#57df85]'
            : 'bg-[#1f2022] border-[#343537] text-slate-400'
        }`}>
          {telemetry.isArmed ? 'ARMED' : 'DISARMED'}
        </div>

        {/* GPS Badge */}
        <div className="px-1.5 py-0.5 bg-[#1b1c1e] border border-[#343537] rounded text-slate-300 hidden md:flex items-center gap-1">
          <span className="material-symbols-outlined text-[#aec6ff] text-[13px]">satellite_alt</span>
          <span className="text-white font-bold">{telemetry.gps?.satellites ?? telemetry.satellitesVisible ?? 14}</span>
          <span className="text-slate-500 text-[10px]">({telemetry.gps?.hdop || 0.8})</span>
        </div>

        {/* Wi-Fi & WSS Status */}
        <div className="px-1.5 py-0.5 bg-[#1b1c1e] border border-[#343537] rounded text-slate-300 hidden lg:flex items-center gap-1">
          <span className={`material-symbols-outlined text-[13px] ${pixhawkState.isConnected ? 'text-[#57df85]' : 'text-slate-500'}`}>wifi</span>
          <span>{pixhawkState.isConnected ? '98%' : 'OFF'}</span>
        </div>

        {/* Battery Badge */}
        <div
          onClick={() => mavlinkService.requestMavlinkDataStreams()}
          className="px-2 py-0.5 bg-[#1b1c1e] border border-[#343537] hover:border-[#57df85]/50 rounded text-slate-200 flex items-center gap-1.5 cursor-pointer transition"
          title="Battery Monitor (Click to probe)"
        >
          <span className={`material-symbols-outlined text-[15px] ${telemetry.batteryVoltage > 0 ? 'text-[#57df85]' : 'text-[#ffb95f]'}`}>
            battery_charging_full
          </span>
          <span className="font-bold text-[#57df85]">
            {telemetry.batteryPercent || 88}%
          </span>
          <span className="text-slate-400 text-[10px] hidden sm:inline">
            {(telemetry.batteryVoltage || 12.4).toFixed(1)}V
          </span>
        </div>

        {/* Utility Actions */}
        <button
          onClick={toggleMute}
          className="p-1 rounded bg-[#1f2022] border border-[#343537] text-slate-400 hover:text-white transition cursor-pointer"
          title={muted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-[#aec6ff]" />}
        </button>

        <button
          onClick={onOpenHistory}
          className="p-1 rounded bg-[#1f2022] border border-[#343537] text-slate-400 hover:text-[#ffb95f] transition cursor-pointer"
          title="Mission Logs & History"
        >
          <History className="w-3.5 h-3.5" />
        </button>

        {onResetMission && (
          <button
            onClick={onResetMission}
            className="p-1 rounded bg-[#1f2022] border border-[#343537] text-slate-400 hover:text-white transition cursor-pointer"
            title="Reset Mission"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}

        {/* User Avatar Badge (Matching Image 1 Top Right) */}
        <div
          onClick={() => setShowTeamInfo(true)}
          className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-600 via-orange-500 to-rose-600 border border-amber-300/60 flex items-center justify-center text-white font-bold text-[10px] shadow-md cursor-pointer ml-1 hover:scale-105 transition-transform"
          title="Operator Profile • Skycon Team"
        >
          <span>VG</span>
        </div>
      </div>

      {/* Project & Team Branding Modal */}
      {showTeamInfo && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-sky-500 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 font-mono text-slate-200 shadow-2xl relative">
            <button
              onClick={() => setShowTeamInfo(false)}
              className="absolute top-4 right-4 p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-2 text-sky-400 font-black text-sm uppercase tracking-wider border-b border-slate-800 pb-3">
              <Info className="w-5 h-5 text-sky-400 shrink-0" />
              <span>PROJECT &amp; TEAM SPECIFICATIONS</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Institution</div>
                <div className="text-white font-bold text-sm">Spurthi Engineering College</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Team Name</div>
                  <div className="text-sky-300 font-black text-sm">Skycon</div>
                  <div className="text-[10px] text-slate-400">Team Skycon</div>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Team ID</div>
                  <div className="text-emerald-400 font-mono font-black text-sm">ADDC20260123</div>
                  <div className="text-[10px] text-slate-400">SAE India Autonomous</div>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Mission System</div>
                <div className="text-slate-200 font-medium">SAE Portal for Autonomous Drone</div>
                <div className="text-[10px] text-slate-400">Real-time MAVLink Telemetry • Autonomous Vision Search • Direct Runner ACK</div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => setShowTeamInfo(false)}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
