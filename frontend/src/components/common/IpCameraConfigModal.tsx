import React, { useState, useEffect } from 'react';
import {
  X,
  Smartphone,
  Wifi,
  Settings,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Power,
  Sliders,
  ExternalLink,
  ShieldCheck,
  Radio,
  Zap
} from 'lucide-react';
import {
  ipCameraService,
  IpCameraConfig,
  IpCameraPreset
} from '../../services/ipCameraService';

interface IpCameraConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: () => void;
}

export const IpCameraConfigModal: React.FC<IpCameraConfigModalProps> = ({
  isOpen,
  onClose,
  onConnected
}) => {
  const [config, setConfig] = useState<IpCameraConfig>(() => ipCameraService.getConfig());
  const [ipInput, setIpInput] = useState(config.ip || '192.168.1.5');
  const [portInput, setPortInput] = useState(String(config.port || 8080));
  const [pathInput, setPathInput] = useState(config.path || '/video');
  const [selectedPreset, setSelectedPreset] = useState<IpCameraPreset>(config.preset || 'IP_WEBCAM_ANDROID');
  const [useProxy, setUseProxy] = useState<boolean>(config.useProxy !== false);
  const [customUrlInput, setCustomUrlInput] = useState(config.fullUrl || '');
  const [isManualUrlMode, setIsManualUrlMode] = useState<boolean>(config.preset === 'CUSTOM');

  // Test Connection State
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const current = ipCameraService.getConfig();
      setConfig(current);
      setIpInput(current.ip || '192.168.1.5');
      setPortInput(String(current.port || 8080));
      setPathInput(current.path || '/video');
      setSelectedPreset(current.preset || 'IP_WEBCAM_ANDROID');
      setUseProxy(current.useProxy !== false);
      setCustomUrlInput(current.fullUrl || '');
      setIsManualUrlMode(current.preset === 'CUSTOM');
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Real-time URL preview calculation
  const computedUrl = isManualUrlMode
    ? customUrlInput.trim()
    : ipCameraService.buildUrl(ipInput, parseInt(portInput, 10) || 8080, pathInput);

  const handleSelectPreset = (preset: IpCameraPreset) => {
    setSelectedPreset(preset);
    setTestResult(null);
    if (preset === 'CUSTOM') {
      setIsManualUrlMode(true);
      return;
    }

    setIsManualUrlMode(false);
    let port = 8080;
    let path = '/video';

    if (preset === 'IP_WEBCAM_ANDROID') {
      port = 8080;
      path = '/video';
    } else if (preset === 'DROIDCAM') {
      port = 4747;
      path = '/video';
    } else if (preset === 'ESP32_CAM') {
      port = 81;
      path = '/stream';
    }

    setPortInput(String(port));
    setPathInput(path);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const portNum = parseInt(portInput, 10) || 8080;
      const targetUrl = isManualUrlMode
        ? customUrlInput.trim()
        : ipCameraService.buildUrl(ipInput, portNum, pathInput);

      const res = await ipCameraService.testConnection(targetUrl);
      setTestResult(res);
    } catch (e: any) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: e?.message || 'Connection test failed'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAndConnect = () => {
    const portNum = parseInt(portInput, 10) || 8080;
    const finalUrl = isManualUrlMode
      ? customUrlInput.trim()
      : ipCameraService.buildUrl(ipInput, portNum, pathInput);

    let snapshotPath = '/shot.jpg';
    if (selectedPreset === 'DROIDCAM') snapshotPath = '/cam/1/frame.jpg';
    if (selectedPreset === 'ESP32_CAM') snapshotPath = '/capture';

    const newConfig: IpCameraConfig = {
      preset: selectedPreset,
      ip: ipInput.trim(),
      port: portNum,
      path: pathInput.trim(),
      snapshotPath,
      fullUrl: finalUrl,
      useProxy
    };

    ipCameraService.setConfig(newConfig);
    ipCameraService.setSourceMode('PHONE_IP_CAM');
    ipCameraService.setIpCameraEnabled(true);
    ipCameraService.setScannerEnabled(true);

    if (onConnected) onConnected();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none font-mono">
      <div className="relative w-full max-w-lg bg-[#0d1424] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-4 py-3.5 bg-[#080d19] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950/60 border border-amber-500/50 flex items-center justify-center text-amber-400">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-orbitron font-extrabold text-sm text-white uppercase tracking-wider">
                PHONE IP CAMERA CONFIG
              </h3>
              <p className="text-[10px] text-slate-400">
                Connect your Android or iOS phone camera for live video & QR scanning
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
          {/* Quick Presets */}
          <div>
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">
              Select Camera Device Preset
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSelectPreset('IP_WEBCAM_ANDROID')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col gap-1 ${
                  selectedPreset === 'IP_WEBCAM_ANDROID'
                    ? 'bg-amber-950/60 border-amber-500 text-amber-200 shadow-lg shadow-amber-950/50'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-white">Android IP Webcam</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">
                    RECOMMENDED
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">Port 8080 • /video • PTZ Zoom</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPreset('DROIDCAM')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col gap-1 ${
                  selectedPreset === 'DROIDCAM'
                    ? 'bg-sky-950/60 border-sky-500 text-sky-200 shadow-lg shadow-sky-950/50'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-white">DroidCam</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-bold">
                    PORT 4747
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">Port 4747 • /video</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPreset('ESP32_CAM')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col gap-1 ${
                  selectedPreset === 'ESP32_CAM'
                    ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 shadow-lg shadow-emerald-950/50'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-white">ESP32-CAM</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                    PORT 81
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">Port 81 • /stream</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPreset('CUSTOM')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col gap-1 ${
                  selectedPreset === 'CUSTOM'
                    ? 'bg-indigo-950/60 border-indigo-500 text-indigo-200 shadow-lg shadow-indigo-950/50'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-white">Custom URL</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-bold">
                    DIRECT
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">Custom RTSP / HTTP MJPEG</span>
              </button>
            </div>
          </div>

          {/* Connection Inputs */}
          {!isManualUrlMode ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Phone Wi-Fi IP Address
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={ipInput}
                    onChange={(e) => {
                      setIpInput(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="192.168.1.5"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
                    IPv4
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={portInput}
                  onChange={(e) => {
                    setPortInput(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="8080"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  MJPEG Stream Path
                </label>
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => {
                    setPathInput(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="/video"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                Full Stream URL (HTTP / MJPEG)
              </label>
              <input
                type="url"
                value={customUrlInput}
                onChange={(e) => {
                  setCustomUrlInput(e.target.value);
                  setTestResult(null);
                }}
                placeholder="http://192.168.1.5:8080/video"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {/* Computed URL Box */}
          <div className="p-3 rounded-xl bg-black/60 border border-slate-800 text-[10px] space-y-1">
            <div className="flex items-center justify-between text-slate-400 font-bold uppercase">
              <span>Stream Endpoint:</span>
              <span className="text-amber-400 font-normal">HTTP MJPEG</span>
            </div>
            <div className="text-emerald-400 font-bold break-all font-mono">
              {computedUrl || 'http://192.168.1.5:8080/video'}
            </div>
          </div>

          {/* Zero-CORS Proxy Checkbox */}
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-start gap-2.5">
            <input
              type="checkbox"
              id="useProxyCheck"
              checked={useProxy}
              onChange={(e) => setUseProxy(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
            />
            <label htmlFor="useProxyCheck" className="cursor-pointer text-slate-300">
              <span className="font-bold text-white block">
                Enable Zero-CORS Stream & Snapshot Proxy (Recommended)
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Routes stream frames through the local Vite dev relay (<code className="text-sky-300">/api/ipcam/proxy</code>) so canvas reading and QR decoding are never blocked by cross-origin security restrictions.
              </span>
            </label>
          </div>

          {/* Connection Test Result Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-[11px] flex items-center justify-between gap-2 ${
                testResult.ok
                  ? 'bg-emerald-950/70 border-emerald-500 text-emerald-200'
                  : 'bg-rose-950/70 border-rose-500 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <div className="truncate">
                  {testResult.ok ? (
                    <span>Phone Camera Reachable! Latency: <strong>{testResult.latencyMs}ms</strong></span>
                  ) : (
                    <span>Failed: {testResult.error || 'Connection refused. Check phone server.'}</span>
                  )}
                </div>
              </div>
              <span className="text-[9px] uppercase font-bold shrink-0">
                {testResult.ok ? 'READY' : 'CHECK WI-FI'}
              </span>
            </div>
          )}

          {/* Quick 3-Step Setup Guide */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-slate-400 space-y-1.5">
            <span className="font-bold text-slate-300 uppercase block">Phone Setup Guide (Android):</span>
            <div className="space-y-1">
              <div>1. Install & open <strong>IP Webcam</strong> by Pavel Khlebovich from Play Store.</div>
              <div>2. Scroll to the bottom and tap <strong>"Start server"</strong>.</div>
              <div>3. Note the IPv4 address on the phone screen (e.g. <span className="text-amber-400">192.168.1.xxx:8080</span>) and enter it above.</div>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-4 py-3 bg-[#080d19] border-t border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 border border-slate-700 text-slate-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isTesting ? 'animate-spin' : ''}`} />
            <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-xs font-bold transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSaveAndConnect}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-black text-xs uppercase tracking-wider transition flex items-center gap-1.5 shadow-lg shadow-amber-600/30 cursor-pointer"
            >
              <Power className="w-3.5 h-3.5" />
              <span>Connect Camera</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IpCameraConfigModal;
