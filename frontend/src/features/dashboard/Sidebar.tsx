import React from 'react';
import {
  LayoutDashboard,
  Compass,
  Crosshair,
  FileText,
  SlidersHorizontal,
  AlertTriangle,
  Gamepad2,
  Power,
} from 'lucide-react';

interface SidebarProps {
  activeNav?: string;
  onNavChange?: (nav: string) => void;
  onEmergencyRTL: () => void;
  rtlConfirmPending?: boolean;
  onToggleRC?: () => void;
  rcOverrideEnabled?: boolean;
  isArmed?: boolean;
  onToggleArm?: () => void;
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeNav = 'Dashboard',
  onNavChange,
  onEmergencyRTL,
  rtlConfirmPending = false,
  onToggleRC,
  rcOverrideEnabled = false,
  isArmed = false,
  onToggleArm,
  className = '',
}) => {
  const navItems = [
    { id: 'Dashboard', label: 'Cockpit', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'Mission', label: 'Mission Plan', icon: <Compass className="w-4 h-4" /> },
    { id: 'Flight Control', label: 'Flight Control', icon: <Crosshair className="w-4 h-4" /> },
    { id: 'Logs', label: 'Flight Logs', icon: <FileText className="w-4 h-4" /> },
    { id: 'Diagnostics', label: 'Serial Link', icon: <SlidersHorizontal className="w-4 h-4" /> },
  ];

  return (
    <aside
      className={`w-[185px] flex flex-col justify-between py-2 border-r border-[var(--uav-card-border)] bg-[var(--uav-header)] select-none shrink-0 overflow-y-auto overflow-x-hidden scrollbar-none ${className}`}
    >
      {/* Navigation List */}
      <nav aria-label="Sidebar Navigation" className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = item.id === activeNav;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavChange?.(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-[12px] font-sans font-medium transition-all text-left cursor-pointer ${
                isActive
                  ? 'bg-[#1C212B] text-emerald-400 border-l-[3px] border-emerald-500 font-semibold'
                  : 'text-[var(--uav-muted)] hover:text-[var(--uav-text)] hover:bg-[#21262D] border-l-[3px] border-transparent'
              }`}
            >
              <span className={isActive ? 'text-emerald-400' : 'text-[var(--uav-muted)]'}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Pinned Bottom Controls: ARM/DISARM, RC Manual Control Switch & EMERGENCY RTL Button */}
      <div className="p-2 flex flex-col gap-2">
        {/* ARM / DISARM Button (Placed directly ABOVE the RC ON button) */}
        <button
          type="button"
          onClick={onToggleArm}
          className={`w-full py-2 px-2.5 rounded-[8px] flex items-center justify-between border transition-all active:scale-95 cursor-pointer ${
            isArmed
              ? 'bg-[#220d0d] border-red-500/80 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.35)] hover:bg-[#2d1212]'
              : 'bg-[#161B22] border-[var(--uav-card-border)] text-slate-300 hover:text-emerald-300 hover:border-emerald-500/50 hover:bg-[#0c2419]/60'
          }`}
          title={
            isArmed
              ? 'Vehicle is ARMED (Motors live & spinning). Click to DISARM vehicle.'
              : 'Vehicle is DISARMED (Motors safe). Click to ARM vehicle.'
          }
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded flex items-center justify-center ${
                isArmed ? 'bg-red-500/20 text-red-400' : 'bg-[#21262D] text-slate-400'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
            </div>
            <div className="flex flex-col text-left leading-none">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                {isArmed ? 'Motors Live' : 'Motors Standby'}
              </span>
              <span className="text-[12px] font-bold font-orbitron text-white">
                {isArmed ? 'DISARM' : 'ARM'}
              </span>
            </div>
          </div>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1 ${
              isArmed
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-[#21262D] text-emerald-400 border border-emerald-500/30'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isArmed ? 'bg-white' : 'bg-emerald-400'
              }`}
            />
            {isArmed ? 'ARMED' : 'DISARMED'}
          </span>
        </button>
        {/* RC Manual Control Override Toggle Button (Right above EMERGENCY RTL) */}
        <button
          type="button"
          onClick={onToggleRC}
          className={`w-full py-2 px-2.5 rounded-[8px] flex items-center justify-between border transition-all active:scale-95 cursor-pointer ${
            rcOverrideEnabled
              ? 'bg-[#0c2419] border-emerald-500/80 text-emerald-300 shadow-[0_0_12px_rgba(34,197,94,0.3)] hover:bg-[#123826]'
              : 'bg-[#161B22] border-[var(--uav-card-border)] text-slate-300 hover:text-white hover:bg-[#21262D]'
          }`}
          title={
            rcOverrideEnabled
              ? 'RC Manual Control: ON (Click to disable RC override)'
              : 'RC Manual Control: OFF (Click to enable RC override)'
          }
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded flex items-center justify-center ${
                rcOverrideEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#21262D] text-slate-400'
              }`}
            >
              <Gamepad2 className="w-3.5 h-3.5" />
            </div>
            <div className="flex flex-col text-left leading-none">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                {rcOverrideEnabled ? 'Manual Link' : 'Auto GCS'}
              </span>
              <span className="text-[12px] font-bold font-orbitron text-white">
                RC OVERRIDE
              </span>
            </div>
          </div>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase flex items-center gap-1 ${
              rcOverrideEnabled
                ? 'bg-emerald-600 text-white animate-pulse'
                : 'bg-[#21262D] text-slate-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                rcOverrideEnabled ? 'bg-white' : 'bg-slate-500'
              }`}
            />
            {rcOverrideEnabled ? 'ON' : 'OFF'}
          </span>
        </button>

        {/* Pinned Bottom EMERGENCY RTL Button (2-Click Direct Execution Pattern) */}
        <button
          type="button"
          onClick={onEmergencyRTL}
          className={`w-full py-2.5 px-3 rounded-[8px] flex items-center justify-center gap-2.5 transition active:scale-95 cursor-pointer ${
            rtlConfirmPending
              ? 'bg-red-600 border-2 border-white animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.8)] text-white'
              : 'bg-[var(--uav-red-dark)] border border-[var(--uav-red)] hover:bg-red-950 text-white'
          }`}
          title={
            rtlConfirmPending
              ? 'CLICK AGAIN TO RETURN TO LAUNCH NOW'
              : 'Emergency Return To Launch (Click once to prime, click 2nd time to execute)'
          }
        >
          <AlertTriangle
            className={`w-5 h-5 shrink-0 ${
              rtlConfirmPending ? 'text-white animate-bounce' : 'text-red-400'
            }`}
          />
          <div className="flex flex-col text-left leading-tight">
            <span
              className={`text-[9px] font-bold tracking-wider uppercase ${
                rtlConfirmPending ? 'text-amber-200' : 'text-red-300'
              }`}
            >
              {rtlConfirmPending ? 'CLICK AGAIN' : 'EMERGENCY'}
            </span>
            <span className="text-[13px] font-black tracking-wider uppercase text-white font-orbitron">
              {rtlConfirmPending ? 'CONFIRM RTL' : 'RTL'}
            </span>
          </div>
        </button>
      </div>
    </aside>
  );
};
