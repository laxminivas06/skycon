import React from 'react';
import { Scan, Clock } from 'lucide-react';
import { DecodedQRData } from '../../types/mission';

export type SystemDetectionStatus =
  | 'SYSTEM_READY'
  | 'DETECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'MISSION_ACTIVE';

interface GroundStationOperationsBarProps {
  isScannerOn: boolean;
  onToggleScanner: (on: boolean) => void;
  detectionStatus: SystemDetectionStatus;
  elapsedSeconds: number;
  isMissionActive: boolean;
  decodedQR?: DecodedQRData | null;
  boxDetected?: boolean;
}

export const GroundStationOperationsBar: React.FC<GroundStationOperationsBarProps> = ({
  isScannerOn,
  onToggleScanner,
  detectionStatus,
  elapsedSeconds,
  isMissionActive,
  decodedQR,
  boxDetected
}) => {
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Status Badge Configuration
  const getStatusBadge = () => {
    switch (detectionStatus) {
      case 'MISSION_ACTIVE':
        return {
          label: 'MISSION ACTIVE',
          classes: 'bg-amber-950/80 border-amber-500/80 text-amber-300 animate-pulse',
          dot: 'bg-amber-400 animate-ping'
        };
      case 'DETECTING':
        return {
          label: 'DETECTING',
          classes: 'bg-sky-950/80 border-sky-400/80 text-sky-300 animate-pulse',
          dot: 'bg-sky-400 animate-ping'
        };
      case 'SYSTEM_READY':
        return {
          label: 'SYSTEM READY',
          classes: 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300',
          dot: 'bg-emerald-400'
        };
      case 'CONNECTED':
        return {
          label: 'CONNECTED',
          classes: 'bg-blue-950/80 border-blue-500/60 text-blue-300',
          dot: 'bg-blue-400'
        };
      case 'DISCONNECTED':
      default:
        return {
          label: 'DISCONNECTED',
          classes: 'bg-rose-950/80 border-rose-500/80 text-rose-300',
          dot: 'bg-rose-400'
        };
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-3 sm:p-4 shadow-xl font-mono select-none">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left Section: Scanner Option */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center space-x-2 bg-slate-950/80 border border-slate-800 p-1.5 sm:p-2 rounded-lg">
            <div className="flex items-center space-x-1.5">
              <Scan className={`w-3.5 h-3.5 ${isScannerOn ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className="text-[11px] font-bold uppercase text-slate-300">
                Target Scanner:
              </span>
            </div>

            <button
              type="button"
              onClick={() => onToggleScanner(!isScannerOn)}
              className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider transition cursor-pointer flex items-center space-x-1 border ${
                isScannerOn
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/80 shadow-md shadow-emerald-600/30'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isScannerOn ? 'bg-white' : 'bg-slate-500'}`} />
              <span>{isScannerOn ? 'ON' : 'OFF'}</span>
            </button>

            {/* Target Found Badges */}
            {isScannerOn && (decodedQR?.code || boxDetected) && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 text-[9px] font-black tracking-wider animate-pulse">
                {decodedQR?.code ? `QR: [${decodedQR.code}]` : 'TARGET FOUND'}
              </span>
            )}
          </div>
        </div>

        {/* Right Section: Automatic Detection Status + Simple Mission Timer */}
        <div className="flex items-center space-x-2 sm:space-x-3 self-end sm:self-auto">
          {/* Automatic Detection Status Pill */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400 hidden xs:inline">
              Status:
            </span>
            <div
              className={`px-3 py-1.5 rounded-lg border text-xs font-black tracking-wider flex items-center space-x-2 shadow-sm ${statusBadge.classes}`}
            >
              <span className={`w-2 h-2 rounded-full ${statusBadge.dot}`} />
              <span>{statusBadge.label}</span>
            </div>
          </div>

          {/* Simple Mission / System Timer */}
          <div className="flex items-center space-x-1.5 bg-slate-950/90 border border-slate-800 px-3 py-1.5 rounded-lg">
            <Clock className={`w-3.5 h-3.5 ${isMissionActive ? 'text-amber-400 animate-spin' : 'text-slate-400'}`} />
            <div className="flex flex-col">
              <span className="text-[9px] uppercase font-bold text-slate-400 leading-none">
                Timer
              </span>
              <span className="text-xs font-black text-amber-300 tracking-wider">
                {formatTime(elapsedSeconds)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroundStationOperationsBar;
