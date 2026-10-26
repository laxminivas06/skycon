import React from 'react';
import { RunnerLinkState, RunnerAckPayload } from '../../types/runner';
import { Radio, Wifi, CheckCircle2, ArrowLeftRight, Clock, ShieldCheck } from 'lucide-react';

interface AckProtocolCardProps {
  runnerLink: RunnerLinkState;
  receivedCode?: string;
  ackSent: boolean;
  className?: string;
}

export const AckProtocolCard: React.FC<AckProtocolCardProps> = ({
  runnerLink,
  receivedCode,
  ackSent,
  className = ''
}) => {
  return (
    <div className={`bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 hud-border font-mono ${className}`}>
      <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
        <div className="flex items-center space-x-2">
          <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
          <span className="text-xs sm:text-sm font-extrabold uppercase text-slate-200">
            P2P WIRELESS ACKNOWLEDGEMENT PROTOCOL
          </span>
        </div>
        <span className="text-[10px] text-emerald-400 font-bold">DIRECT LINK</span>
      </div>

      {/* Protocol Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase">Channel</div>
          <div className="font-bold text-sky-400 truncate">DIRECT_LINK</div>
        </div>

        <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase">Signal RSSI</div>
          <div className="font-bold text-slate-200">{runnerLink.signalStrengthDbm} dBm</div>
        </div>

        <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase">Packets RX/TX</div>
          <div className="font-bold text-slate-200">{runnerLink.packetsReceived} / {runnerLink.packetsSent}</div>
        </div>

        <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase">Auto-ACK State</div>
          <div className="font-bold text-emerald-400">
            {ackSent ? 'DISPATCHED ✓' : 'STANDBY'}
          </div>
        </div>
      </div>

      {/* Handshake Flow Banner */}
      <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
        <div className="flex items-center justify-between">
          <span>Drone → Runner (QR Payload):</span>
          <span className={receivedCode ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
            {receivedCode ? `CODE [${receivedCode}] RECEIVED ✓` : 'AWAITING DISPATCH'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Runner → Drone (Instant Auto-ACK):</span>
          <span className={ackSent ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
            {ackSent ? 'ACK CONFIRMED & SENT ✓' : 'READY TO RESPOND'}
          </span>
        </div>
      </div>
    </div>
  );
};
