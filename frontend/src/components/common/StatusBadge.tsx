import React from 'react';
import { MissionState } from '../../types/mission';
import { 
  Activity, 
  AlertOctagon, 
  CheckCircle2, 
  Clock, 
  Compass, 
  Home, 
  PlaneTakeoff, 
  QrCode, 
  Radio, 
  RotateCcw, 
  Search, 
  Send, 
  ShieldAlert, 
  Sparkles,
  Check
} from 'lucide-react';

interface StatusBadgeProps {
  state: MissionState;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  state,
  className = '',
  size = 'md'
}) => {
  const getBadgeConfig = (s: MissionState) => {
    switch (s) {
      case 'IDLE':
        return {
          label: 'IDLE (READY FOR HOME POINT)',
          color: 'bg-slate-800 text-slate-300 border-slate-700',
          icon: Clock,
          glow: ''
        };
      case 'HOME_SET':
        return {
          label: 'HOME POINT SET & LOCKED',
          color: 'bg-sky-950/50 text-sky-400 border-sky-500/40',
          icon: Home,
          glow: 'hud-border'
        };
      case 'READY':
        return {
          label: 'READY FOR MISSION',
          color: 'bg-emerald-950/50 text-emerald-400 border-emerald-500/40',
          icon: CheckCircle2,
          glow: 'hud-border-success'
        };
      case 'STARTING':
        return {
          label: 'STARTING SEQUENCE',
          color: 'bg-sky-950/60 text-sky-300 border-sky-500/50',
          icon: Sparkles,
          glow: 'animate-pulse'
        };
      case 'TAKEOFF':
      case 'CLIMBING_TO_ALTITUDE':
        return {
          label: 'TAKEOFF & CLIMBING AUTOMATICALLY',
          color: 'bg-indigo-950/60 text-indigo-300 border-indigo-500/50',
          icon: PlaneTakeoff,
          glow: 'animate-pulse'
        };
      case 'ALTITUDE_STABILIZING':
        return {
          label: 'ALTITUDE STABILIZING (HOLDING 2S)',
          color: 'bg-cyan-950/60 text-cyan-300 border-cyan-500/50',
          icon: Compass,
          glow: 'animate-pulse'
        };
      case 'ALTITUDE_UPDATING':
        return {
          label: 'ADJUSTING TARGET ALTITUDE',
          color: 'bg-amber-950/60 text-amber-300 border-amber-500/50',
          icon: Compass,
          glow: 'animate-pulse'
        };
      case 'SEARCHING':
        return {
          label: 'AUTONOMOUS SEARCH IN PROGRESS',
          color: 'bg-blue-950/60 text-blue-300 border-blue-500/50',
          icon: Search,
          glow: 'hud-border animate-pulse'
        };
      case 'QR_DETECTED':
        return {
          label: 'QR DETECTED (ACQUIRING)',
          color: 'bg-amber-950/60 text-amber-300 border-amber-500/60',
          icon: QrCode,
          glow: 'hud-border-warning animate-pulse'
        };
      case 'QR_SCANNING':
        return {
          label: 'AIRBORNE QR SCANNING',
          color: 'bg-amber-950/70 text-amber-200 border-amber-400',
          icon: QrCode,
          glow: 'hud-border-warning animate-pulse'
        };
      case 'QR_DECODED':
        return {
          label: 'QR CODE DECODED & VALIDATED',
          color: 'bg-emerald-950/70 text-emerald-300 border-emerald-400',
          icon: Check,
          glow: 'hud-border-success'
        };
      case 'SEND_TO_RUNNER':
        return {
          label: 'SENDING CODE DIRECTLY TO RUNNER',
          color: 'bg-sky-950/70 text-sky-200 border-sky-400',
          icon: Send,
          glow: 'animate-pulse'
        };
      case 'WAIT_FOR_RUNNER_ACK':
        return {
          label: 'AIRBORNE HOLD: WAITING FOR RUNNER ACK',
          color: 'bg-amber-950/70 text-amber-300 border-amber-500/60',
          icon: Radio,
          glow: 'hud-border-warning animate-pulse'
        };
      case 'RUNNER_CONFIRMED':
        return {
          label: 'RUNNER ACK RECEIVED ✓',
          color: 'bg-emerald-950/80 text-emerald-300 border-emerald-400',
          icon: CheckCircle2,
          glow: 'hud-border-success'
        };
      case 'RTL':
        return {
          label: 'RTL COMMAND INITIATED',
          color: 'bg-amber-950/70 text-amber-300 border-amber-500/50',
          icon: RotateCcw,
          glow: 'animate-pulse'
        };
      case 'RETURNING_HOME':
        return {
          label: 'RETURNING TO HOME POINT',
          color: 'bg-sky-950/70 text-sky-300 border-sky-500/50',
          icon: Home,
          glow: 'hud-border'
        };
      case 'LANDING':
        return {
          label: 'AUTO LANDING AT HOME POINT',
          color: 'bg-indigo-950/70 text-indigo-300 border-indigo-500/50',
          icon: PlaneTakeoff,
          glow: 'animate-pulse'
        };
      case 'MISSION_COMPLETE':
        return {
          label: 'MISSION COMPLETE ✓',
          color: 'bg-emerald-900/80 text-emerald-200 border-emerald-400 font-extrabold',
          icon: CheckCircle2,
          glow: 'hud-border-success shadow-lg shadow-emerald-500/20'
        };
      case 'CONNECTION_LOST':
        return {
          label: 'SAFETY: CONNECTION LOST',
          color: 'bg-rose-950/80 text-rose-300 border-rose-500',
          icon: AlertOctagon,
          glow: 'hud-border-danger animate-pulse'
        };
      case 'GPS_ERROR':
        return {
          label: 'SAFETY: GPS ERROR / FIX LOST',
          color: 'bg-rose-950/80 text-rose-300 border-rose-500',
          icon: ShieldAlert,
          glow: 'hud-border-danger animate-pulse'
        };
      case 'LOW_BATTERY':
        return {
          label: 'SAFETY: LOW BATTERY (<20%)',
          color: 'bg-rose-950/80 text-rose-300 border-rose-500',
          icon: AlertOctagon,
          glow: 'hud-border-danger animate-pulse'
        };
      case 'MISSION_TIMEOUT':
        return {
          label: 'SAFETY: 3-MIN MISSION TIMEOUT (RTL)',
          color: 'bg-rose-950/90 text-rose-200 border-rose-500',
          icon: Clock,
          glow: 'hud-border-danger animate-pulse'
        };
      case 'EMERGENCY_RTL':
        return {
          label: 'EMERGENCY RTL ACTIVE',
          color: 'bg-rose-950/90 text-rose-200 border-rose-500 font-extrabold',
          icon: ShieldAlert,
          glow: 'hud-border-danger animate-pulse'
        };
      default:
        return {
          label: s,
          color: 'bg-slate-800 text-slate-300 border-slate-700',
          icon: Activity,
          glow: ''
        };
    }
  };

  const config = getBadgeConfig(state);
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-[11px] px-2 py-0.5 space-x-1',
    md: 'text-xs sm:text-sm px-3 py-1.5 space-x-2',
    lg: 'text-sm sm:text-base px-4 py-2 space-x-2.5 font-extrabold'
  }[size];

  return (
    <div
      className={`inline-flex items-center rounded-lg border font-mono tracking-wider ${config.color} ${config.glow} ${sizeClasses} ${className}`}
    >
      <Icon className={size === 'lg' ? 'w-5 h-5' : size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
      <span>{config.label}</span>
    </div>
  );
};
