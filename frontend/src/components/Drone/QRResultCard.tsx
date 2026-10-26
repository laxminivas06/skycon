import React from 'react';
import { DecodedQRData, MissionState } from '../../types/mission';
import { RunnerLinkState } from '../../types/runner';
import { 
  CheckCircle2, 
  Clock, 
  Send, 
  ShieldCheck, 
  Sparkles, 
  AlertTriangle,
  RotateCcw,
  Radio,
  ArrowRight,
  Image as ImageIcon
} from 'lucide-react';

interface QRResultCardProps {
  decodedQR: DecodedQRData | null;
  missionState: MissionState;
  runnerLink: RunnerLinkState;
  runnerAckReceived: boolean;
  runnerAckLatencyMs?: number;
  className?: string;
}

export const QRResultCard: React.FC<QRResultCardProps> = ({
  decodedQR,
  missionState,
  runnerLink,
  runnerAckReceived,
  runnerAckLatencyMs,
  className = ''
}) => {
  const isWaitingForAck = missionState === 'WAIT_FOR_RUNNER_ACK' || missionState === 'SEND_TO_RUNNER';

  return (
    <div className={`bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 hud-border font-mono flex flex-col justify-between ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span className="text-xs sm:text-sm font-extrabold uppercase text-slate-200">
            DRONE VISION & QR DECODER
          </span>
        </div>
        <span className="text-[10px] text-slate-400">SAE 2-DIGIT PROTOCOL</span>
      </div>

      {/* Main Result Display Box */}
      {decodedQR ? (
        <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 space-y-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase font-semibold">QR STATUS:</span>
            {decodedQR.isValidTwoDigit ? (
              <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>VALID 2-DIGIT CODE</span>
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-400 text-xs font-bold flex items-center space-x-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>INVALID FORMAT (REJECTED)</span>
              </span>
            )}
          </div>

          {/* Large Code Value & Captured Snapshot */}
          <div className="flex items-center gap-3 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
            {decodedQR.photoSnapshotUrl && (
              <div className="w-20 h-20 rounded-lg overflow-hidden border border-emerald-500/50 shrink-0 relative bg-black">
                <img
                  src={decodedQR.photoSnapshotUrl}
                  alt="Target QR Snapshot"
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 inset-x-0 bg-emerald-950/90 text-[8px] text-emerald-300 font-bold text-center py-0.5">
                  SAVED ✓
                </div>
              </div>
            )}

            <div className="flex-1 text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
                DECODED RESCUE CODE
              </div>
              <div className="text-4xl sm:text-5xl font-black text-emerald-400 tracking-widest font-mono leading-none">
                {decodedQR.code}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Airborne Scan • Conf: {Math.round(decodedQR.confidence * 100)}%
              </div>
            </div>
          </div>

          {/* Runner Wireless Handshake Progress */}
          <div className="space-y-2 pt-1 border-t border-slate-800/60 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Direct Runner Link:</span>
              <span className="text-sky-400 font-bold">{runnerLink.channel}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Handshake State:</span>
              {runnerAckReceived ? (
                <span className="text-emerald-400 font-bold flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>RUNNER RECEIVED ✓ ({runnerAckLatencyMs || 120}ms)</span>
                </span>
              ) : isWaitingForAck ? (
                <span className="text-amber-400 font-bold flex items-center space-x-1 animate-pulse">
                  <Clock className="w-3.5 h-3.5" />
                  <span>WAITING FOR RUNNER ACK...</span>
                </span>
              ) : (
                <span className="text-slate-400">READY TO SEND</span>
              )}
            </div>

            {runnerAckReceived && (
              <div className="p-2 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold flex items-center space-x-1.5">
                <RotateCcw className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>ACK CONFIRMED — DRONE EXECUTING RTL TO HOME POINT</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-slate-950/60 p-6 rounded-xl border border-slate-800/80 text-center text-slate-400 space-y-2 mb-3">
          <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center mx-auto text-sky-400">
            <Clock className="w-5 h-5 animate-pulse" />
          </div>
          <div className="text-sm font-bold text-slate-300">SEARCHING FOR QR CODE...</div>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Snapping photos every 10 seconds. Frames without QR codes are automatically purged from memory.
          </p>
        </div>
      )}

      {/* Memory & Airborne Rule Reminder */}
      <div className="text-[10px] text-slate-400 bg-slate-950/40 p-2 rounded border border-slate-800/50 flex items-center space-x-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        <span>
          <strong>Storage Safety:</strong> Non-target photos auto-deleted immediately to prevent browser memory bloat.
        </span>
      </div>
    </div>
  );
};
