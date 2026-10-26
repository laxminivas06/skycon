import React from 'react';
import { AppRole } from '../../types/mission';
import { Laptop, Plane, Smartphone, Sliders } from 'lucide-react';

interface ModeSelectorBarProps {
  currentRole: AppRole;
  onSelectRole: (role: AppRole) => void;
}

const MODES: { id: AppRole; label: string; short: string; icon: React.ReactNode; color: string; activeColor: string }[] = [
  {
    id: 'GROUND_STATION',
    label: 'Ground Station',
    short: 'Ground',
    icon: <Laptop className="w-4 h-4" />,
    color: 'text-slate-400 hover:text-sky-300 hover:bg-sky-950/40 border-transparent',
    activeColor: 'text-sky-300 bg-sky-950/60 border-sky-500/60 shadow-sky-500/10'
  },
  {
    id: 'DRONE',
    label: 'Drone Android',
    short: 'Drone',
    icon: <Plane className="w-4 h-4" />,
    color: 'text-slate-400 hover:text-amber-300 hover:bg-amber-950/40 border-transparent',
    activeColor: 'text-amber-300 bg-amber-950/60 border-amber-500/60 shadow-amber-500/10'
  },
  {
    id: 'RUNNER',
    label: 'Runner Android',
    short: 'Runner',
    icon: <Smartphone className="w-4 h-4" />,
    color: 'text-slate-400 hover:text-emerald-300 hover:bg-emerald-950/40 border-transparent',
    activeColor: 'text-emerald-300 bg-emerald-950/60 border-emerald-500/60 shadow-emerald-500/10'
  },
  {
    id: 'MANUAL',
    label: 'Manual Control',
    short: 'Manual',
    icon: <Sliders className="w-4 h-4" />,
    color: 'text-slate-400 hover:text-amber-300 hover:bg-rose-950/40 border-transparent',
    activeColor: 'text-amber-300 bg-rose-950/60 border-rose-500/60 shadow-rose-500/10'
  }
];

export const ModeSelectorBar: React.FC<ModeSelectorBarProps> = ({ currentRole, onSelectRole }) => {
  return (
    <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-xl p-1 gap-1">
      {MODES.map((mode) => {
        const isActive = currentRole === mode.id;
        return (
          <button
            key={mode.id}
            onClick={() => onSelectRole(mode.id)}
            className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-black uppercase tracking-wide transition-all cursor-pointer shadow ${
              isActive ? mode.activeColor : mode.color
            }`}
            title={mode.label}
          >
            {mode.icon}
            <span className="hidden sm:inline">{mode.short}</span>
          </button>
        );
      })}
    </div>
  );
};
