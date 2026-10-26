import React, { useState } from 'react';
import { PixhawkConnectionState } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import { Radio, Usb, Activity, Cpu, Terminal, AlertTriangle, Info, CheckCircle2, Sliders } from 'lucide-react';
import { SerialDiagnosticsModal } from './SerialDiagnosticsModal';

interface PixhawkMonitorProps {
  connectionState: PixhawkConnectionState;
  className?: string;
}

export const PixhawkMonitor: React.FC<PixhawkMonitorProps> = ({
  connectionState,
  className = ''
}) => {
  const [connecting, setConnecting] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const handleConnectSerial = async () => {
    setConnecting(true);
    await mavlinkService.connectHardware();
    setConnecting(false);
  };

  return (
    <>
      <div className={`bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 hud-border font-mono ${className}`}>
        <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-sky-400" />
            <span className="text-xs sm:text-sm font-extrabold uppercase text-slate-200">
              PIXHAWK / MAVLINK SUBSYSTEM
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowDiagnostics(true)}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-xs transition cursor-pointer"
              title="Serial Diagnostics"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
            {(() => {
              const hasHeartbeat = (connectionState.lastHeartbeat || 0) > 0 && (Date.now() - (connectionState.lastHeartbeat || 0) < 10000);
              const isConnected = connectionState.isConnected && hasHeartbeat;
              const isConnecting = connectionState.isUsbConnected && !hasHeartbeat;
              return (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  isConnected 
                    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400' 
                    : isConnecting
                    ? 'bg-amber-950/60 border-amber-500/40 text-amber-400'
                    : 'bg-rose-950/60 border-rose-500/40 text-rose-400'
                }`}>
                  {isConnected ? 'MAVLink: CONNECTED ✓' : isConnecting ? 'MAVLink: CONNECTING' : 'DISCONNECTED'}
                </span>
              );
            })()}
          </div>
        </div>

        {/* Connection Info Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase">Interface</div>
            <div className="font-bold text-slate-200 truncate">{connectionState.connectionType}</div>
          </div>

          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase">Port / Baud</div>
            <div className="font-bold text-slate-200 truncate">{connectionState.baudRate} bps</div>
          </div>

          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase">RX / TX Data</div>
            <div className="font-bold text-sky-400">
              {(connectionState.bytesReceived / 1024).toFixed(1)} KB
            </div>
          </div>

          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase">Hardware</div>
            <div className="font-bold text-emerald-400 text-[10px] truncate">
              {connectionState.diagnostics?.productName || 'Pixhawk 2.4.8'}
            </div>
          </div>
        </div>

        {/* Live Message History Console */}
        <div className="mb-3 space-y-1">
          <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center space-x-1">
            <Terminal className="w-3 h-3 text-sky-400" />
            <span>Flight Controller Message Log:</span>
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800 max-h-24 overflow-y-auto text-[10px] space-y-1">
            {connectionState.statusHistory.length === 0 ? (
              <div className="text-slate-600 italic">No messages yet. Connect to Pixhawk to receive log.</div>
            ) : (
              connectionState.statusHistory.slice(0, 5).map((msg) => (
                <div key={msg.id} className="flex items-start space-x-1.5 leading-tight">
                  <span className={msg.severityLevel <= 3 ? 'text-rose-400' : msg.severityLevel === 4 ? 'text-amber-400' : 'text-sky-400'}>
                    [{new Date(msg.timestamp).toLocaleTimeString().split(' ')[0]}]
                  </span>
                  <span className={msg.severityLevel <= 3 ? 'text-rose-300 font-bold' : msg.severityLevel === 4 ? 'text-amber-300' : 'text-slate-300'}>
                    {msg.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Action Strip */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
          <div className="text-[10px] text-slate-400 flex items-center space-x-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Heartbeat: {connectionState.lastHeartbeat ? `${Math.max(0, Math.round((Date.now() - connectionState.lastHeartbeat) / 1000))}s ago (${connectionState.heartbeatHz || 1.0} Hz)` : 'None'}</span>
          </div>

          {!connectionState.isConnected && (
            <button
              onClick={handleConnectSerial}
              disabled={connecting}
              className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
              title="Connect Physical Pixhawk via USB OTG"
            >
              <Usb className="w-3.5 h-3.5" />
              <span>{connecting ? 'Connecting...' : 'Connect USB'}</span>
            </button>
          )}
        </div>
      </div>

      <SerialDiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        connectionState={connectionState}
      />
    </>
  );
};
