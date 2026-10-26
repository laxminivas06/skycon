import React, { useState } from 'react';
import { AppRole } from '../../types/mission';
import { authService, ROLE_CREDENTIALS } from '../../services/authService';
import { 
  Laptop, 
  Plane, 
  Smartphone, 
  KeyRound, 
  Lock, 
  User,
  Eye, 
  EyeOff, 
  AlertCircle,
  Loader2
} from 'lucide-react';
import { ThemeController } from '../common/ThemeController';

interface LoginScreenProps {
  onLoginSuccess: (role: AppRole) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  // Initial state: No interface selected yet; presents exactly 3 primary buttons
  const [selectedRole, setSelectedRole] = useState<AppRole | null>(null);
  const [callsign, setCallsign] = useState('');
  const [passkey, setPasskey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectInterface = (role: AppRole) => {
    setSelectedRole(role);
    setErrorMsg(null);
    setPasskey('');
    // Initialize default callsign for convenience if available in service, but NEVER display credentials on initial screen
    const creds = ROLE_CREDENTIALS[role as keyof typeof ROLE_CREDENTIALS];
    setCallsign(creds ? creds.defaultCallsign : '');
  };

  const handleBackToSelection = () => {
    setSelectedRole(null);
    setErrorMsg(null);
    setPasskey('');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;
    setErrorMsg(null);
    setIsLoading(true);

    try {
      // Brief visual processing feedback for user responsiveness
      await new Promise((res) => setTimeout(res, 200));
      const result = authService.login(selectedRole, callsign, passkey);
      if (result.success) {
        onLoginSuccess(selectedRole);
      } else {
        setErrorMsg(result.error || 'Authentication failed. Please verify credentials.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Authentication error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const interfaces = [
    {
      id: 'GROUND_STATION' as AppRole,
      title: 'GROUND STATION',
      badge: 'GCS CONTROLLER & MISSION PLANNER',
      desc: 'Supervise live flight telemetry, plan autonomous & manual missions, execute waypoint routes, and monitor Pixhawk telemetry.',
      icon: Laptop,
      accent: 'emerald'
    },
    {
      id: 'DRONE' as AppRole,
      title: 'DRONE CORE',
      badge: 'UAV OPTICAL RECON INTELLIGENCE',
      desc: 'Mobile optical sensor unit for real-time QR detection, native-resolution image capture, and automatic return-to-launch.',
      icon: Plane,
      accent: 'amber'
    },
    {
      id: 'RUNNER' as AppRole,
      title: 'RUNNER UNIT',
      badge: 'FIELD RECON & TARGET RETRIEVAL',
      desc: 'Tactical field unit receiving real-time decoded QR payloads, Pixhawk GPS coordinates, and reconnaissance intelligence.',
      icon: Smartphone,
      accent: 'sky'
    }
  ];

  return (
    <div className="h-[100dvh] w-full bg-[var(--uav-bg)] text-[var(--uav-text)] flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden select-none">
      {/* Subtle Aerospace Ambient Radial Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Top Right Theme Controller */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeController showLabels />
      </div>

      {/* Central Login / Selection Card (Ground Station Design System) */}
      <div className={`relative z-10 w-full ${selectedRole ? 'max-w-md' : 'max-w-xl'} rounded-[12px] border border-[var(--uav-card-border)] bg-[var(--uav-card)] shadow-2xl p-6 sm:p-8 flex flex-col gap-6 backdrop-blur-md transition-all duration-200`}>
        {/* AERORECON Brand Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="flex items-center gap-2.5">
            {/* Custom Quadcopter Glyph matching Ground Station */}
            <div className="w-10 h-10 rounded-[8px] bg-[#11161D] border border-[#262C36] flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 9V5" />
                <path d="M12 19v-4" />
                <path d="M9 12H5" />
                <path d="M19 12h-4" />
                <circle cx="5" cy="5" r="2" />
                <circle cx="19" cy="5" r="2" />
                <circle cx="5" cy="19" r="2" />
                <circle cx="19" cy="19" r="2" />
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-orbitron font-black text-2xl tracking-[0.14em] text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-200 to-amber-300 leading-none">
                AERORECON
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-mono font-bold text-emerald-300 tracking-wider">
                PORTAL
              </span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-[var(--uav-muted)] tracking-wider">
            SAE INDIA ADDC 2026 • AUTONOMOUS RESCUE &amp; MISSION SYSTEM
          </span>
        </div>

        {/* STEP 1: INITIAL VIEW — EXACTLY THREE PRIMARY INTERFACE BUTTONS (NO CREDENTIALS SHOWN) */}
        {!selectedRole && (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-sm font-orbitron font-bold text-white tracking-wider uppercase">
                SELECT OPERATIONAL INTERFACE
              </h2>
              <p className="text-xs text-[var(--uav-muted)] mt-1 font-sans">
                Choose an interface to initialize connection and enter the operational console
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {interfaces.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectInterface(item.id)}
                    className="group relative p-4 rounded-[10px] border border-[var(--uav-card-border)] bg-[#090D12] hover:bg-[#111822] hover:border-emerald-500/60 transition-all duration-150 flex items-center justify-between text-left cursor-pointer shadow-sm active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-[8px] bg-[#161B22] border border-slate-800 group-hover:border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 transition">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-orbitron font-black text-[14px] tracking-wide text-white group-hover:text-emerald-300 transition">
                            {item.title}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-[#161B22] border border-slate-800 text-slate-400">
                            {item.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--uav-muted)] mt-1 leading-snug line-clamp-2">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                    <div className="pl-3 text-[var(--uav-muted)] group-hover:text-emerald-400 font-mono text-xs transition">
                      →
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2: INTERFACE AUTHENTICATION FORM (OPENED ONLY UPON INTERFACE SELECTION) */}
        {selectedRole && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--uav-card-border)]">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-[6px] bg-[#090D12] border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xs">
                  {selectedRole === 'GROUND_STATION' ? '💻' : selectedRole === 'DRONE' ? '✈️' : '📱'}
                </div>
                <div>
                  <h3 className="font-orbitron font-bold text-xs text-white uppercase tracking-wider">
                    {interfaces.find((i) => i.id === selectedRole)?.title} ENTRY
                  </h3>
                  <span className="text-[10px] font-mono text-[var(--uav-muted)]">
                    Role-Based Access Authentication
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBackToSelection}
                className="px-2.5 py-1 rounded-[6px] bg-[#090D12] hover:bg-[#161B22] border border-[var(--uav-card-border)] text-[10px] font-mono text-[var(--uav-muted)] hover:text-white transition cursor-pointer"
              >
                ← Back
              </button>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {errorMsg && (
                <div
                  role="alert"
                  className="p-3 bg-[#3b1212] border border-[#7f1d1d] rounded-[8px] text-xs text-rose-300 flex items-center gap-2 animate-in fade-in"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Callsign / Username Field */}
              <div>
                <label
                  htmlFor="operator-callsign"
                  className="block text-[11px] font-semibold text-[var(--uav-muted)] uppercase tracking-[0.06em] mb-1.5 font-mono"
                >
                  Operator Callsign
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--uav-muted)]">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    id="operator-callsign"
                    type="text"
                    value={callsign}
                    onChange={(e) => setCallsign(e.target.value)}
                    className="w-full bg-[#090D12] border border-[var(--uav-card-border)] rounded-[8px] pl-9 pr-3.5 py-2.5 text-sm text-[var(--uav-text)] font-mono placeholder:text-[var(--uav-muted)]/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition"
                    placeholder="Enter operator callsign..."
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              {/* Passkey / Password Field */}
              <div>
                <label
                  htmlFor="operator-passkey"
                  className="block text-[11px] font-semibold text-[var(--uav-muted)] uppercase tracking-[0.06em] mb-1.5 font-mono"
                >
                  Security Passkey
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--uav-muted)]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="operator-passkey"
                    type={showPassword ? 'text' : 'password'}
                    value={passkey}
                    onChange={(e) => setPasskey(e.target.value)}
                    className="w-full bg-[#090D12] border border-[var(--uav-card-border)] rounded-[8px] pl-9 pr-10 py-2.5 text-sm text-[var(--uav-text)] font-mono placeholder:text-[var(--uav-muted)]/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition"
                    placeholder="Enter security passkey..."
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--uav-muted)] hover:text-[var(--uav-text)] transition cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button with Loading State */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-[8px] bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs uppercase tracking-[0.08em] shadow-lg shadow-emerald-950/50 transition cursor-pointer flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>AUTHENTICATING...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>AUTHENTICATE &amp; ENTER</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Footer Organization & Team Identity */}
        <div className="pt-3 border-t border-[var(--uav-card-border)] text-center space-y-0.5 text-[10px] font-mono text-[var(--uav-muted)]">
          <div className="text-[var(--uav-text)] font-semibold">
            Spurthi Engineering College • Team Skycon
          </div>
          <div>
            Team ID: <span className="text-emerald-400 font-bold">ADDC20260123</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
