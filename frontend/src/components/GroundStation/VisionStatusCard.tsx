import React from 'react';
import { DecodedQRData, TargetBoxDetection } from '../../types/mission';
import { RunnerLinkState } from '../../types/runner';
import { Smartphone, Camera, Box, QrCode, CheckCircle2, Clock } from 'lucide-react';

interface VisionStatusCardProps {
  runnerLink: RunnerLinkState;
  boxDetection?: TargetBoxDetection;
  decodedQR?: DecodedQRData | null;
  className?: string;
}

export const VisionStatusCard: React.FC<VisionStatusCardProps> = ({
  runnerLink,
  boxDetection,
  decodedQR,
  className = ''
}) => {
  const isPhoneConnected = Boolean(runnerLink && runnerLink.isConnected);
  const isCameraActive = isPhoneConnected; // Phone camera performs autonomous visual processing
  const isBoxDetected = Boolean(boxDetection?.isDetected);
  const isQrDetected = Boolean(decodedQR && decodedQR.code);

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-lg font-mono select-none ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <Camera className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-black tracking-wider text-slate-100 uppercase">
            VISION
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          Phone On-Device Detection (Zero ESP32 Frame Overhead)
        </span>
      </div>

      {/* Status Grid */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        {/* Phone */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <div className="flex items-center space-x-1.5 text-slate-400 text-[10px] uppercase font-bold mb-1">
            <Smartphone className="w-3 h-3 text-sky-400" />
            <span>Phone:</span>
          </div>
          <div className={`font-extrabold flex items-center space-x-1 ${
            isPhoneConnected ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            <span>{isPhoneConnected ? '✓ Connected' : 'Waiting...'}</span>
          </div>
        </div>

        {/* Camera */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <div className="flex items-center space-x-1.5 text-slate-400 text-[10px] uppercase font-bold mb-1">
            <Camera className="w-3 h-3 text-sky-400" />
            <span>Camera:</span>
          </div>
          <div className={`font-extrabold flex items-center space-x-1 ${
            isCameraActive ? 'text-emerald-400' : 'text-slate-400'
          }`}>
            <span>{isCameraActive ? '✓ Active' : 'Standby'}</span>
          </div>
        </div>

        {/* Box */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <div className="flex items-center space-x-1.5 text-slate-400 text-[10px] uppercase font-bold mb-1">
            <Box className="w-3 h-3 text-amber-400" />
            <span>Box:</span>
          </div>
          <div className={`font-extrabold flex items-center space-x-1 ${
            isBoxDetected ? 'text-emerald-400' : 'text-slate-400'
          }`}>
            <span>{isBoxDetected ? '✓ Detected' : 'Not Detected'}</span>
          </div>
        </div>

        {/* QR */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
          <div className="flex items-center space-x-1.5 text-slate-400 text-[10px] uppercase font-bold mb-1">
            <QrCode className="w-3 h-3 text-emerald-400" />
            <span>QR:</span>
          </div>
          <div className={`font-extrabold flex items-center space-x-1 ${
            isQrDetected ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            <span>{isQrDetected ? '✓ Detected' : 'Waiting'}</span>
          </div>
        </div>
      </div>

      {/* QR Decoded Data Row (When detected) */}
      {isQrDetected && decodedQR && (
        <div className="mt-2.5 p-2.5 bg-emerald-950/30 border border-emerald-500/40 rounded-lg flex items-center justify-between text-xs">
          <span className="text-slate-400 font-bold uppercase text-[10px]">
            Decoded QR Data:
          </span>
          <span className="text-sm font-black text-emerald-300 font-mono tracking-wider px-2 py-0.5 bg-slate-950 rounded border border-emerald-500/50">
            {decodedQR.code}
          </span>
        </div>
      )}
    </div>
  );
};
