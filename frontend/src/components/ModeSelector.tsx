import React from 'react';
import { AppRole } from '../types/mission';
import { 
  Laptop, 
  Plane, 
  Smartphone, 
  Layers, 
  ShieldCheck, 
  Compass, 
  Radio, 
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface ModeSelectorProps {
  onSelectRole: (role: AppRole) => void;
  currentRole: AppRole;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  onSelectRole,
  currentRole
}) => {
  const roles = [
    {
      id: 'GROUND_STATION' as AppRole,
      title: 'GROUND STATION ANDROID',
      subtitle: 'Mission Setup • Home Lock • Pre-flight • MAVLink Monitor • Emergency RTL',
      description: 'Coordinates the overall mission, arms aircraft, validates pre-flight status, monitors telemetry, and triggers emergency RTL.',
      icon: Laptop,
      badge: 'GCS CONTROLLER',
      accentColor: 'border-sky-500 hover:border-sky-400 bg-sky-950/20 hover:bg-sky-950/40 text-sky-400',
      btnColor: 'bg-sky-600 hover:bg-sky-500'
    },
    {
      id: 'DRONE' as AppRole,
      title: 'DRONE ANDROID',
      subtitle: 'Camera Vision • QR Decoder (^\d{2}$) • Direct Runner Link • Pixhawk RTL',
      description: 'Onboard drone intelligence device. Streams live camera, scans & validates 2-digit QR code, sends directly to Runner, and commands Pixhawk RTL upon ACK.',
      icon: Plane,
      badge: 'ONBOARD CORE',
      accentColor: 'border-amber-500 hover:border-amber-400 bg-amber-950/20 hover:bg-amber-950/40 text-amber-400',
      btnColor: 'bg-amber-600 hover:bg-amber-500'
    },
    {
      id: 'RUNNER' as AppRole,
      title: 'RUNNER ANDROID',
      subtitle: 'Zero-Touch Display • Instant Direct P2P Wireless • Auto-ACK Dispatch',
      description: 'Field runner unit located ~10-15m away. Receives 2-digit code directly from drone and automatically sends cryptographic confirmation ACK back.',
      icon: Smartphone,
      badge: 'FIELD RUNNER',
      accentColor: 'border-emerald-500 hover:border-emerald-400 bg-emerald-950/20 hover:bg-emerald-950/40 text-emerald-400',
      btnColor: 'bg-emerald-600 hover:bg-emerald-500'
    },
    {
      id: 'TESTBENCH' as AppRole,
      title: 'FIELD OPS COMMAND TESTBENCH',
      subtitle: 'Unified Multi-Device Live Simulation & Verification Bench',
      description: 'Run all 3 devices (Ground Station, Drone, Runner) side-by-side on one screen to simulate the entire end-to-end 24-step SAE INDIA mission sequence.',
      icon: Layers,
      badge: 'FULL SIMULATOR',
      accentColor: 'border-purple-500 hover:border-purple-400 bg-purple-950/20 hover:bg-purple-950/40 text-purple-400',
      btnColor: 'bg-purple-600 hover:bg-purple-500'
    }
  ];

  return (
    <div className="min-h-screen bg-sae-dark flex flex-col items-center justify-center p-4 sm:p-8 font-mono relative overflow-hidden">
      {/* Tactical Background Grid & Glows */}
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-4xl w-full space-y-6 text-center">
        {/* Title Header */}
        <div className="space-y-2">
          <div className="inline-flex items-center space-x-2 bg-slate-900 border border-slate-700 px-3 py-1 rounded-full text-xs text-sky-400 font-bold uppercase tracking-wider">
            <Radio className="w-3.5 h-3.5" />
            <span>SAE INDIA AUTONOMOUS MISSION SYSTEM</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-black text-white tracking-wide uppercase">
            SELECT APPLICATION MODE
          </h1>

          <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto">
            Choose the operational role for this Android device. The same application adapts its interface, telemetry pipeline, and wireless protocol for each role.
          </p>
        </div>

        {/* Role Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
          {roles.map((r) => {
            const Icon = r.icon;
            const isSelected = currentRole === r.id;

            return (
              <div
                key={r.id}
                onClick={() => onSelectRole(r.id)}
                className={`p-5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between backdrop-blur-md ${r.accentColor} ${
                  isSelected ? 'ring-2 ring-white/50 shadow-xl' : ''
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-700 text-white">
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                      {r.badge}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-lg font-black text-white tracking-wide">{r.title}</h2>
                    <p className="text-xs text-slate-400 mt-0.5 font-sans font-medium">{r.subtitle}</p>
                  </div>

                  <p className="text-xs text-slate-300/80 font-sans leading-relaxed">
                    {r.description}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400">SELECT THIS ROLE</span>
                  <button
                    className={`px-4 py-2 rounded-lg text-white font-black text-xs uppercase flex items-center space-x-1.5 transition ${r.btnColor}`}
                  >
                    <span>LAUNCH</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Competition Rules Reminder Strip */}
        <div className="p-3.5 bg-slate-900/90 rounded-xl border border-slate-800 text-xs text-slate-400 text-left flex items-start space-x-2.5 max-w-2xl mx-auto">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>Architectural Rule:</strong> Ground Station coordinates flight; Drone Android reads and transmits the 2-digit QR code directly to Runner Android without routing through Ground Station. Maximum mission window is 3 minutes.
          </span>
        </div>
      </div>
    </div>
  );
};
