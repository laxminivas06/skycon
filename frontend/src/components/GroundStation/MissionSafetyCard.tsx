import React, { useState } from 'react';
import { missionEngine } from '../../services/missionEngine';
import { ShieldAlert, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';

interface MissionSafetyCardProps {
  isMissionActive: boolean;
  className?: string;
}

export const MissionSafetyCard: React.FC<MissionSafetyCardProps> = ({
  isMissionActive,
  className = ''
}) => {
  const currentDurationSec = missionEngine.getMissionDurationSeconds();
  const [selectedSec, setSelectedSec] = useState<number>(currentDurationSec);
  const [isCustom, setIsCustom] = useState<boolean>(![60, 120, 180, 300, 600].includes(currentDurationSec));
  const [customMinStr, setCustomMinStr] = useState<string>(
    String(Math.round(currentDurationSec / 60) || 5)
  );

  const presets = [
    { label: '1 min', sec: 60 },
    { label: '2 min', sec: 120 },
    { label: '3 min', sec: 180 },
    { label: '5 min', sec: 300 },
    { label: '10 min', sec: 600 }
  ];

  const handleSelectPreset = (sec: number) => {
    if (isMissionActive) return;
    setSelectedSec(sec);
    setIsCustom(false);
    missionEngine.setMissionDuration(sec);
  };

  const handleCustomChange = (val: string) => {
    setCustomMinStr(val);
    const m = parseFloat(val);
    if (!isNaN(m) && m > 0) {
      const s = Math.round(m * 60);
      setSelectedSec(s);
      missionEngine.setMissionDuration(s);
    }
  };

  const currentMins = Math.round(selectedSec / 60);

  return (
    <div className={`bg-slate-900/95 border border-amber-500/40 rounded-xl p-4 shadow-lg font-mono select-none ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-amber-950/80 border border-amber-500/50 text-amber-400">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs sm:text-sm font-black tracking-wider text-slate-100 uppercase">
              MISSION SAFETY
            </span>
            <span className="ml-2 text-[10px] text-amber-400 font-bold">
              FAILSAFE TIMEOUT
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 self-start sm:self-auto">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-300 font-bold">
            Limit: <span className="text-amber-400 font-extrabold">{currentMins} min</span> ({selectedSec}s)
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label className="text-xs font-bold text-slate-300">
            Maximum Mission Duration:
          </label>

          {/* Preset Buttons */}
          <div className="flex items-center space-x-1.5 flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.sec}
                type="button"
                disabled={isMissionActive}
                onClick={() => handleSelectPreset(p.sec)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer border ${
                  !isCustom && selectedSec === p.sec
                    ? 'bg-amber-600 text-white border-amber-400 shadow-md shadow-amber-600/30'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
                } ${isMissionActive ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {p.label}
              </button>
            ))}

            <button
              type="button"
              disabled={isMissionActive}
              onClick={() => setIsCustom(true)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer border ${
                isCustom
                  ? 'bg-amber-600 text-white border-amber-400 shadow-md shadow-amber-600/30'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
              } ${isMissionActive ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Custom
            </button>
          </div>
        </div>

        {/* Custom Input */}
        {isCustom && (
          <div className="flex items-center space-x-2 pt-1">
            <span className="text-xs text-slate-400">Custom Duration:</span>
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              disabled={isMissionActive}
              value={customMinStr}
              onChange={(e) => handleCustomChange(e.target.value)}
              className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-amber-300 font-bold text-center"
            />
            <span className="text-xs text-slate-400">minutes</span>
          </div>
        )}

        {/* Safety Explanation per Req 3 */}
        <div className="pt-2 flex items-start space-x-2 text-xs text-amber-300/90 bg-amber-950/20 p-2.5 rounded-lg border border-amber-500/20">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="leading-relaxed">
            “If the mission exceeds this time, automatically initiate RTL.”
          </p>
        </div>
      </div>
    </div>
  );
};
