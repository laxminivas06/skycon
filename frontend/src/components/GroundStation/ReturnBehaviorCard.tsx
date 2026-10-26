import React from 'react';
import { ReturnBehavior } from '../../types/groundStationMap';
import { customRouteService } from '../../services/customRouteService';
import {
  RotateCcw,
  Navigation,
  ArrowLeftRight,
  Pencil,
  PlaneLanding,
  ShieldCheck,
  CheckCircle2,
  Info
} from 'lucide-react';

interface ReturnBehaviorCardProps {
  returnBehavior: ReturnBehavior;
  onChangeReturnBehavior: (behavior: ReturnBehavior) => void;
  onStartDrawReturnRoute?: () => void;
  hasCustomReturnPoints?: boolean;
  isMissionActive?: boolean;
  className?: string;
}

export const ReturnBehaviorCard: React.FC<ReturnBehaviorCardProps> = ({
  returnBehavior,
  onChangeReturnBehavior,
  onStartDrawReturnRoute,
  hasCustomReturnPoints = false,
  isMissionActive = false,
  className = ''
}) => {
  const options: Array<{
    id: ReturnBehavior;
    label: string;
    sublabel: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'DIRECT_RTL',
      label: 'Direct RTL (Recommended)',
      sublabel: 'Standard Pixhawk Return-To-Launch straight back to Home reference',
      icon: <Navigation className="w-4 h-4 text-sky-400" />
    },
    {
      id: 'SAME_PATH_BACK',
      label: 'Same Path Back',
      sublabel: 'Reverses outbound GPS waypoints (Target → WP3 → WP2 → WP1 → Home)',
      icon: <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
    },
    {
      id: 'CUSTOM_RETURN_PATH',
      label: 'Custom Return Path',
      sublabel: 'Draw an independent return route on Google Maps (Target → C → D → Home)',
      icon: <Pencil className="w-4 h-4 text-amber-400" />
    },
    {
      id: 'LAND_AT_HOME',
      label: 'Land at Home',
      sublabel: 'Returns to Home location and executes autonomous touchdown descent',
      icon: <PlaneLanding className="w-4 h-4 text-purple-400" />
    }
  ];

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-lg font-mono select-none ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-sky-950/80 border border-sky-500/40 text-sky-400">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs sm:text-sm font-black tracking-wider text-slate-100 uppercase">
              RETURN BEHAVIOR / RETURN PATH
            </span>
            <div className="text-[10px] text-slate-400">
              Autonomous Post-Target Navigation Strategy
            </div>
          </div>
        </div>

        <span className="text-[11px] font-extrabold text-sky-300 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-500/40 self-start sm:self-auto">
          Active: {options.find((o) => o.id === returnBehavior)?.label.split(' ')[0] || 'DIRECT RTL'}
        </span>
      </div>

      {/* Options Radio List */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {options.map((opt) => {
          const isSelected = returnBehavior === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => {
                if (!isMissionActive) onChangeReturnBehavior(opt.id);
              }}
              className={`p-3 rounded-lg border transition cursor-pointer flex items-start space-x-2.5 ${
                isSelected
                  ? 'bg-sky-950/50 border-sky-500 shadow-md shadow-sky-950/40 text-white'
                  : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              } ${isMissionActive ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="mt-0.5 shrink-0">
                <input
                  type="radio"
                  name="returnBehaviorOption"
                  checked={isSelected}
                  disabled={isMissionActive}
                  onChange={() => onChangeReturnBehavior(opt.id)}
                  className="w-4 h-4 text-sky-500 accent-sky-500 cursor-pointer"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                  <span>{opt.label}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                  {opt.sublabel}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom Return Path Interactive Button & Notification */}
      {returnBehavior === 'CUSTOM_RETURN_PATH' && (
        <div className="mt-3 p-3 bg-amber-950/20 border border-amber-500/30 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-in fade-in">
          <div className="flex items-start space-x-2 text-xs text-amber-300">
            <Info className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <div>
              <span className="font-bold">Custom Return Path enabled:</span>
              <p className="text-[11px] text-amber-400/80 mt-0.5">
                Draw a distinct return route starting from the final target waypoint and concluding at Home.
              </p>
            </div>
          </div>

          {onStartDrawReturnRoute && (
            <button
              type="button"
              disabled={isMissionActive}
              onClick={onStartDrawReturnRoute}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center space-x-1.5 transition shadow-sm shadow-amber-600/30 cursor-pointer self-start sm:self-auto shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{hasCustomReturnPoints ? 'REDRAW RETURN ROUTE' : 'DRAW RETURN ROUTE'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
