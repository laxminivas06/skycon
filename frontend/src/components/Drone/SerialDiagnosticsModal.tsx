import React, { useState, useEffect } from 'react';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { DroneTelemetry } from '../../types/mission';
import { mavlinkService } from '../../services/mavlinkService';
import { runnerCommService } from '../../services/runnerCommService';
import { ConnectionStatusDeck } from '../common/ConnectionStatusDeck';
import { PixhawkConnectionCard } from './PixhawkConnectionCard';
import {
  Usb,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Cpu,
  RefreshCw,
  PowerOff,
  Sliders,
  HelpCircle,
  Radio,
  RotateCcw,
  Terminal,
  Search,
  KeyRound,
  X,
  Zap,
  Wifi,
  Globe,
  Server,
  Lock,
  Network,
  ShieldAlert
} from 'lucide-react';

interface SerialDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionState: PixhawkConnectionState;
  runnerLink?: RunnerLinkState;
  telemetry?: DroneTelemetry;
  videoState?: 'LIVE' | 'CONNECTING' | 'DISCONNECTED';
}

export const SerialDiagnosticsModal: React.FC<SerialDiagnosticsModalProps> = ({
  isOpen,
  onClose,
  connectionState,
  runnerLink,
  telemetry,
  videoState = 'DISCONNECTED'
}) => {
  const [selectedBaud, setSelectedBaud] = useState<number>(connectionState.baudRate || 57600);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isActionInProgress, setIsActionInProgress] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'hardware' | 'stream' | 'troubleshooting' | 'logs'>('hardware');

  // Reactive state for runner and telemetry so the top status bar always lives
  const [liveRunnerLink, setLiveRunnerLink] = useState<RunnerLinkState>(
    runnerLink || runnerCommService.getState()
  );
  const [liveTelemetry, setLiveTelemetry] = useState<DroneTelemetry>(
    telemetry || mavlinkService.getTelemetry()
  );

  useEffect(() => {
    if (runnerLink) {
      setLiveRunnerLink(runnerLink);
    } else {
      const unsub = runnerCommService.subscribeState((st) => setLiveRunnerLink(st));
      return () => {
        unsub();
      };
    }
  }, [runnerLink]);

  useEffect(() => {
    if (telemetry) {
      setLiveTelemetry(telemetry);
    } else {
      const unsub = mavlinkService.subscribeTelemetry((t) => setLiveTelemetry(t));
      return () => {
        unsub();
      };
    }
  }, [telemetry]);

  if (!isOpen) return null;

  const diag = connectionState.diagnostics;
  const phase = connectionState.phase;
  const isConnected = connectionState.isConnected;
  const isUsbConnected = connectionState.isUsbConnected;
  const isEsp32 = connectionState.connectionType === 'ESP32_WEBSOCKET';

  const pageProtocol = typeof window !== 'undefined' ? window.location.protocol.replace(':', '').toUpperCase() : 'HTTP';
  const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';

  const lastHeartbeatAge = connectionState.lastHeartbeat > 0
    ? Math.floor((Date.now() - connectionState.lastHeartbeat) / 1000)
    : null;

  const handleScanDevices = async () => {
    setIsScanning(true);
    try {
      await mavlinkService.scanUsbDevices();
    } finally {
      setIsScanning(false);
    }
  };

  const handleRequestPermission = async () => {
    setIsActionInProgress(true);
    try {
      await mavlinkService.requestUsbPermission();
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleConnect = async () => {
    setIsActionInProgress(true);
    try {
      if (isEsp32 || activeTab === 'hardware') {
        await mavlinkService.connectEsp32();
      } else {
        await mavlinkService.connectHardware(selectedBaud);
      }
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleDisconnect = async () => {
    setIsActionInProgress(true);
    try {
      await mavlinkService.disconnect();
    } finally {
      setIsActionInProgress(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 font-mono select-none overflow-y-auto">
      <div className="bg-[#0D1117] border-2 border-[#21262D] rounded-2xl max-w-5xl w-full p-3.5 sm:p-5 space-y-3 text-slate-200 shadow-2xl relative my-auto max-h-[94vh] flex flex-col">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[#21262D] shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black uppercase text-white tracking-wider flex items-center space-x-2">
                <span>SERIAL LINK &amp; HARDWARE CONNECTIVITY HUB</span>
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400">
                ESP32-S3 Wi-Fi SSID, Cloud WSS Relay, USB OTG, MAVLink packets &amp; live telemetry
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#161B22] border border-[#21262D] hover:bg-[#21262D] text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* System Connection Status Deck (Always Visible at Top of Modal) */}
        <div className="shrink-0">
          <ConnectionStatusDeck
            pixhawkState={connectionState}
            runnerLink={liveRunnerLink}
            telemetry={liveTelemetry}
            videoState={videoState}
            className="!bg-[#161B22]/90 !border-[#21262D]"
          />
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-1.5 border-b border-[#21262D] pb-2 text-xs shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('hardware')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 whitespace-nowrap ${
              activeTab === 'hardware'
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/50'
                : 'bg-[#161B22] text-slate-400 hover:text-white border border-[#21262D]'
            }`}
          >
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span>Hardware &amp; Wi-Fi Link</span>
          </button>

          <button
            onClick={() => setActiveTab('stream')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 whitespace-nowrap ${
              activeTab === 'stream'
                ? 'bg-sky-600/20 text-sky-300 border border-sky-500/50'
                : 'bg-[#161B22] text-slate-400 hover:text-white border border-[#21262D]'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <span>Live Stream &amp; ARM Path</span>
          </button>

          <button
            onClick={() => setActiveTab('troubleshooting')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 whitespace-nowrap ${
              activeTab === 'troubleshooting'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/50'
                : 'bg-[#161B22] text-slate-400 hover:text-white border border-[#21262D]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
            <span>OTG &amp; Wiring Checklist</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 whitespace-nowrap ${
              activeTab === 'logs'
                ? 'bg-amber-600/20 text-amber-300 border border-amber-500/50'
                : 'bg-[#161B22] text-slate-400 hover:text-white border border-[#21262D]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-amber-400" />
            <span>Live Developer Logs</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-black/50 text-amber-300 border border-amber-500/30">
              {connectionState.diagnosticsLogs.length}
            </span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="space-y-4 overflow-y-auto pr-1 flex-1">
          
          {/* TAB 1: HARDWARE & WI-FI CONNECTIVITY HUB */}
          {activeTab === 'hardware' && (
            <div className="space-y-3">
              <PixhawkConnectionCard
                connectionState={connectionState}
                embedded={true}
                className="!bg-[#161B22]/90 !border-[#21262D] !shadow-none"
              />
            </div>
          )}

          {/* TAB 2: LIVE STREAM & ARM PATH DIAGNOSTICS */}
          {activeTab === 'stream' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                
                {/* 1. Connection Channel */}
                <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#21262D]">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Channel Type</div>
                  <div className="font-bold text-sky-300 mt-1">
                    {connectionState.connectionType}
                  </div>
                </div>

                {/* 2. Link State */}
                <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#21262D]">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Link State</div>
                  <div className="font-bold mt-1">
                    {isUsbConnected ? (
                      <span className="text-emerald-400">OPEN ({connectionState.bytesReceived} B rx)</span>
                    ) : (
                      <span className="text-slate-400">CLOSED</span>
                    )}
                  </div>
                </div>

                {/* 3. MAVLink State */}
                <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#21262D]">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">MAVLink State</div>
                  <div className="font-bold mt-1">
                    {isConnected ? (
                      <span className="text-emerald-400">CONNECTED ({diag.totalPacketsReceived} pkts)</span>
                    ) : (
                      <span className="text-amber-400">{phase}</span>
                    )}
                  </div>
                </div>

                {/* 4. Heartbeat Status */}
                <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#21262D]">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Heartbeat</div>
                  <div className="font-bold mt-1">
                    {lastHeartbeatAge !== null ? (
                      <span className={lastHeartbeatAge < 4 ? 'text-emerald-400' : 'text-amber-400'}>
                        {lastHeartbeatAge}s ago ({connectionState.heartbeatHz || 1.0} Hz)
                      </span>
                    ) : (
                      <span className="text-slate-500">None</span>
                    )}
                  </div>
                </div>

                {/* 5. System ID / Comp ID */}
                <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#21262D]">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">SysID / CompID</div>
                  <div className="font-bold text-emerald-400 mt-1">
                    Sys: {connectionState.systemId ?? 1} | Comp: {connectionState.componentId ?? 1}
                  </div>
                </div>

                {/* 6. Autopilot Type */}
                <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#21262D]">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Autopilot</div>
                  <div className="font-bold text-purple-300 mt-1 truncate">
                    {connectionState.autopilotType || 'ArduPilot'}
                  </div>
                </div>

                {/* 7. Last MAVLink Message */}
                <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#21262D] col-span-2">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Last MAVLink Message</div>
                  <div className="font-bold text-sky-300 mt-1 truncate">
                    {diag.lastMavlinkMessageName ? `${diag.lastMavlinkMessageName} (msg ${diag.lastMavlinkMessageId})` : 'Waiting for packets...'}
                  </div>
                </div>
              </div>

              {/* End-to-End ARM Transmission Path Diagnostics Matrix */}
              <div className="p-3 bg-[#161B22] rounded-xl border border-[#21262D] space-y-2.5">
                <div className="flex items-center justify-between pb-1.5 border-b border-[#21262D] text-[11px]">
                  <span className="font-black text-amber-400 uppercase flex items-center space-x-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    <span>ARM COMMAND TRANSMISSION PATH &amp; ACK DIAGNOSIS</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                    connectionState.vehicleState === 'ARMED'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50'
                      : 'bg-[#0D1117] text-slate-400 border border-[#21262D]'
                  }`}>
                    VEHICLE: {connectionState.vehicleState || 'DISARMED'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
                  {/* 1. ARM Button */}
                  <div className="p-2 bg-[#0D1117] rounded-lg border border-[#21262D]">
                    <div className="text-[9px] text-slate-500 uppercase font-bold">ARM Button</div>
                    <div className={`font-bold mt-0.5 ${connectionState.lastArmButtonClickTime ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {connectionState.lastArmButtonClickTime ? 'CLICKED' : 'IDLE'}
                    </div>
                  </div>

                  {/* 2. MAVLink Packet */}
                  <div className="p-2 bg-[#0D1117] rounded-lg border border-[#21262D]">
                    <div className="text-[9px] text-slate-500 uppercase font-bold">MAVLink Packet</div>
                    <div className={`font-bold mt-0.5 ${connectionState.lastArmPacketState === 'CREATED' ? 'text-emerald-400' : connectionState.lastArmPacketState === 'FAILED' ? 'text-rose-400' : 'text-slate-400'}`}>
                      {connectionState.lastArmPacketState === 'CREATED' ? `CREATED (${connectionState.lastArmPacketLength || 41}B)` : connectionState.lastArmPacketState === 'FAILED' ? 'FAILED' : 'NONE'}
                    </div>
                  </div>

                  {/* 3. WebSocket Link */}
                  <div className="p-2 bg-[#0D1117] rounded-lg border border-[#21262D]">
                    <div className="text-[9px] text-slate-500 uppercase font-bold">WebSocket Link</div>
                    <div className={`font-bold mt-0.5 ${isUsbConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isUsbConnected ? 'OPEN' : 'CLOSED'}
                    </div>
                  </div>

                  {/* 4. Browser TX */}
                  <div className="p-2 bg-[#0D1117] rounded-lg border border-[#21262D]">
                    <div className="text-[9px] text-slate-500 uppercase font-bold">Browser TX</div>
                    <div className="font-bold text-sky-400 mt-0.5">
                      {connectionState.bytesSent} B
                    </div>
                  </div>

                  {/* 5. ESP32 WS RX */}
                  <div className="p-2 bg-[#0D1117] rounded-lg border border-[#21262D]">
                    <div className="text-[9px] text-slate-500 uppercase font-bold">ESP32 WS RX</div>
                    <div className="font-bold text-purple-400 mt-0.5">
                      {connectionState.bytesReceived} B
                    </div>
                  </div>

                  {/* 6. Last ACK Status */}
                  <div className="p-2 bg-[#0D1117] rounded-lg border border-[#21262D]">
                    <div className="text-[9px] text-slate-500 uppercase font-bold">Last ACK (Cmd 400)</div>
                    <div className={`font-bold mt-0.5 truncate ${
                      connectionState.lastArmCommandAck
                        ? connectionState.lastArmCommandAck.result === 0 ? 'text-emerald-400' : 'text-rose-400'
                        : 'text-slate-400'
                    }`}>
                      {connectionState.lastArmCommandAck ? `${connectionState.lastArmCommandAck.resultName}` : 'NONE'}
                    </div>
                  </div>
                </div>

                {/* Packet Hex Dump & PreArm details if available */}
                {connectionState.lastArmPacketHex && (
                  <div className="p-2 bg-[#0D1117] rounded-lg border border-[#21262D] font-mono text-[10px] space-y-1">
                    <div className="text-slate-400 flex items-center justify-between">
                      <span><strong>MAVLink COMMAND_LONG Binary Hex:</strong></span>
                      <span className="text-emerald-400">cmd=400, p1=1.0, p2=0.0, sys=1, comp=1</span>
                    </div>
                    <div className="text-emerald-300 break-all select-all">
                      {connectionState.lastArmPacketHex}
                    </div>
                  </div>
                )}

                {connectionState.preArmFailReason && (
                  <div className="p-2 bg-rose-950/60 border border-rose-500/50 rounded-lg text-[11px] text-rose-200 flex items-start space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-rose-300">Pixhawk Pre-Arm Status:</strong>{' '}
                      <span>{connectionState.preArmFailReason}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Console Log Messages */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-300 uppercase flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Terminal className="w-4 h-4 text-sky-400" />
                    <span>Flight Controller STATUSTEXT Messages ({connectionState.statusHistory.length})</span>
                  </div>
                </div>
                <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#21262D] max-h-36 overflow-y-auto text-[11px] space-y-1 font-mono">
                  {connectionState.statusHistory.length === 0 ? (
                    <div className="text-slate-500 italic">No console messages received yet. Connect Pixhawk to stream console log.</div>
                  ) : (
                    connectionState.statusHistory.map((msg) => (
                      <div key={msg.id} className="flex items-start space-x-2 leading-tight">
                        <span className={msg.severityLevel <= 3 ? 'text-rose-400 font-bold' : msg.severityLevel === 4 ? 'text-amber-400' : 'text-sky-400'}>
                          [{new Date(msg.timestamp).toLocaleTimeString()}]
                        </span>
                        <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                          msg.severityLevel <= 3 ? 'bg-rose-950 text-rose-300' : msg.severityLevel === 4 ? 'bg-amber-950 text-amber-300' : 'bg-[#0D1117] text-slate-300'
                        }`}>
                          {msg.severity}
                        </span>
                        <span className="text-slate-200">
                          {msg.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {/* TAB 3: OTG & WIRING CHECKLIST */}
          {activeTab === 'troubleshooting' && (
            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-[#161B22] rounded-xl border border-[#21262D] space-y-2">
                <div className="font-bold text-amber-400 uppercase flex items-center space-x-2">
                  <Zap className="w-4 h-4" />
                  <span>Pixhawk Power Condition &amp; Host Limitation</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Pixhawk flight controllers with GPS and telemetry radios require adequate current. Ensure Pixhawk is powered by its LiPo battery module when connecting to ESP32 or phone USB.
                </p>
              </div>

              <div className="p-3.5 bg-[#161B22] rounded-xl border border-[#21262D] space-y-2.5">
                <div className="font-bold text-sky-400 uppercase flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Hardware Connection Checklist</span>
                </div>
                <ol className="space-y-1.5 text-[11px] text-slate-200 list-decimal list-inside">
                  <li><strong>Check TELEM2 wiring:</strong> TX➔RX, RX➔TX, GND➔GND, 5V➔5V.</li>
                  <li><strong>Verify Baud Rate:</strong> Ensure Pixhawk parameter <code>SERIAL2_BAUD = 57</code> (57600 baud).</li>
                  <li><strong>Verify Protocol:</strong> Ensure Pixhawk parameter <code>SERIAL2_PROTOCOL = 2</code> (MAVLink2).</li>
                  <li><strong>Verify Wi-Fi Network:</strong> Phone/PC must be connected to the same Wi-Fi SSID network as the ESP32 (e.g. <code>drone123</code>).</li>
                  <li><strong>Verify Relay Status:</strong> On HTTPS origins (Netlify), ensure WSS relay mode is enabled.</li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 4: LIVE DEVELOPER LOGS */}
          {activeTab === 'logs' && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-300 uppercase flex items-center justify-between">
                <span>Real-Time Driver &amp; Parser Logs</span>
                <span className="text-[10px] text-slate-500">Auto-scrolling</span>
              </div>
              <div className="bg-[#161B22] p-3 rounded-xl border border-[#21262D] max-h-72 overflow-y-auto space-y-1 text-[11px] font-mono">
                {connectionState.diagnosticsLogs.length === 0 ? (
                  <div className="text-slate-500 italic">No diagnostic events logged yet.</div>
                ) : (
                  connectionState.diagnosticsLogs.map((log) => (
                    <div key={log.id} className="flex items-start space-x-2 leading-tight">
                      <span className="text-slate-500 shrink-0">
                        [{new Date(log.timestamp).toLocaleTimeString()}]
                      </span>
                      <span className={`px-1 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                        log.tag === 'USB'
                          ? 'bg-sky-950 text-sky-300'
                          : log.tag === 'MAVLINK'
                          ? 'bg-purple-950 text-purple-300'
                          : log.tag === 'ERROR'
                          ? 'bg-rose-950 text-rose-300'
                          : 'bg-[#0D1117] text-slate-300'
                      }`}>
                        [{log.tag}]
                      </span>
                      <span className={
                        log.level === 'error'
                          ? 'text-rose-300 font-bold'
                          : log.level === 'warn'
                          ? 'text-amber-300'
                          : log.level === 'success'
                          ? 'text-emerald-300'
                          : 'text-slate-300'
                      }>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Action Buttons Footer */}
        <div className="pt-2.5 border-t border-[#21262D] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-[11px] text-slate-400 font-bold uppercase">Baud Rate:</span>
            <select
              value={selectedBaud}
              onChange={(e) => setSelectedBaud(Number(e.target.value))}
              className="bg-[#161B22] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#21262D] cursor-pointer"
            >
              <option value={57600}>57600 (Default TELEM2 / SiK Radio)</option>
              <option value={115200}>115200 (Pixhawk USB / UART)</option>
              <option value={921600}>921600 (High-Speed Companion)</option>
              <option value={38400}>38400 (Legacy Telemetry)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isActionInProgress}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase transition flex items-center space-x-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>Quick Connect</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                disabled={isActionInProgress}
                className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-600 text-rose-300 rounded-xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-3.5 py-1.5 bg-[#161B22] hover:bg-[#21262D] border border-[#21262D] text-white rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
