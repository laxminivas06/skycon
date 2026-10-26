import React from 'react';
import { PreFlightChecklist as ChecklistType } from '../../types/mission';
import { CheckCircle2, XCircle, AlertCircle, ShieldCheck } from 'lucide-react';

interface PreFlightChecklistProps {
  checklist: ChecklistType;
  isReady: boolean;
  className?: string;
}

export const PreFlightChecklist: React.FC<PreFlightChecklistProps> = ({
  checklist,
  isReady,
  className = ''
}) => {
  const items = [
    { label: 'Drone Connected', valid: checklist.droneConnected },
    { label: 'Pixhawk FC Connected', valid: checklist.pixhawkConnected },
    { label: 'MAVLink Telemetry Stream', valid: checklist.mavlinkAvailable },
    { label: 'GPS 3D/RTK Lock (≥6 Sats)', valid: checklist.gpsAvailable },
    { label: 'Home Point Configured', valid: checklist.homePointValid },
    { label: 'Battery Sufficient (≥25%)', valid: checklist.batterySufficient },
    { label: 'Drone Camera Available', valid: checklist.cameraAvailable },
    { label: 'Vision QR Engine Ready', valid: checklist.qrScannerAvailable },
    { label: 'Runner Wireless Link Available', valid: checklist.runnerConnectionAvailable },
    { label: '3-Minute Mission Timer Ready', valid: checklist.missionTimerReady },
  ];

  return (
    <div className={`bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 hud-border font-mono ${className}`}>
      <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-sky-400" />
          <span className="text-xs sm:text-sm font-extrabold uppercase text-slate-200">
            PRE-FLIGHT VALIDATION CHECKLIST
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          {items.filter((i) => i.valid).length}/{items.length} PASSED
        </span>
      </div>

      {/* Grid of Checklist Items */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs mb-3">
        {items.map((item, idx) => (
          <div
            key={idx}
            className={`flex items-center justify-between px-2.5 py-1.5 rounded border transition ${
              item.valid
                ? 'bg-emerald-950/20 border-emerald-500/20 text-slate-200'
                : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
            }`}
          >
            <span className="text-[11px] truncate pr-2">{item.label}</span>
            {item.valid ? (
              <span className="text-emerald-400 font-bold flex items-center space-x-0.5 text-[10px] shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>OK</span>
              </span>
            ) : (
              <span className="text-rose-400 font-bold flex items-center space-x-0.5 text-[10px] shrink-0">
                <XCircle className="w-3.5 h-3.5" />
                <span>FAIL</span>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Ready Banner */}
      <div
        className={`p-2.5 rounded-lg border text-center font-extrabold text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center space-x-2 ${
          isReady
            ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 hud-border-success'
            : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
        }`}
      >
        {isReady ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>READY FOR MISSION</span>
          </>
        ) : (
          <>
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span>PRE-FLIGHT CHECKS INCOMPLETE</span>
          </>
        )}
      </div>
    </div>
  );
};
