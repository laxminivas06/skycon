import React, { useState } from 'react';
import { Battery, BatteryCharging, BatteryWarning, Zap, HelpCircle, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { mavlinkService } from '../../services/mavlinkService';

interface BatteryMonitorCardProps {
  batteryPercent: number;
  batteryVoltage: number;
  batteryCurrent?: number;
  batteryCellCount?: number;
  compact?: boolean;
}

export const BatteryMonitorCard: React.FC<BatteryMonitorCardProps> = ({
  batteryPercent,
  batteryVoltage,
  batteryCurrent = 0,
  batteryCellCount,
  compact = false
}) => {
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);

  const hasSignal = batteryVoltage > 0;

  // Determine cell count (prioritize flight controller telemetry, default 3S for this drone)
  let cellCount = batteryCellCount && batteryCellCount > 0 ? batteryCellCount : 3;
  if (!batteryCellCount) {
    if (batteryVoltage > 20.0) cellCount = 6;
    else if (batteryVoltage > 13.2) cellCount = 4;
    else if (batteryVoltage > 6.0) cellCount = 3;
    else if (batteryVoltage > 0) cellCount = 2;
  }

  const cellVolt = hasSignal ? +(batteryVoltage / cellCount).toFixed(2) : 0;
  const powerWatts = hasSignal && batteryCurrent > 0 ? +(batteryVoltage * batteryCurrent).toFixed(1) : 0;

  // Low & critical failsafe state based on percentage AND per-cell voltage for 3S LiPo
  // 3S LiPo: Critical < 10.5V (3.50V/cell) or < 15%, Low < 11.1V (3.70V/cell) or < 20%
  const isCritical = (batteryPercent > 0 && batteryPercent < 15) || (hasSignal && cellVolt > 0 && cellVolt < 3.50);
  const isLow = !isCritical && ((batteryPercent > 0 && batteryPercent < 20) || (hasSignal && cellVolt > 0 && cellVolt < 3.70));

  const handleRequestStream = async () => {
    setIsRefreshing(true);
    await mavlinkService.requestMavlinkDataStreams();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const getStatusColor = () => {
    if (!hasSignal) return 'text-slate-500 border-slate-800 bg-slate-950/80';
    if (isCritical) return 'text-rose-400 border-rose-500/80 bg-rose-950/80';
    if (isLow) return 'text-amber-400 border-amber-500/80 bg-amber-950/80';
    return 'text-emerald-400 border-emerald-500/50 bg-emerald-950/60';
  };

  if (compact) {
    return (
      <div className={`p-2 rounded-xl border flex items-center justify-between font-mono ${getStatusColor()}`}>
        <div className="flex items-center space-x-1.5">
          <Battery className={`w-3.5 h-3.5 ${hasSignal ? (isCritical ? 'text-rose-400 animate-pulse' : 'text-emerald-400') : 'text-slate-500'}`} />
          <span className="text-[10px] uppercase font-bold text-slate-400">BATTERY</span>
        </div>
        <div className="text-right">
          <span className="text-xs font-black">
            {hasSignal ? `${batteryVoltage.toFixed(1)}V (${batteryPercent}%)` : 'NO SIGNAL'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-3.5 sm:p-4 shadow-xl font-mono text-slate-100 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className={`p-1.5 rounded-lg border ${
            hasSignal 
              ? (isCritical ? 'bg-rose-950 border-rose-500 text-rose-400 animate-pulse' : 'bg-emerald-950 border-emerald-500/40 text-emerald-400') 
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}>
            <Battery className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-200">
              DRONE BATTERY MONITOR
            </div>
            <div className="text-[10px] text-slate-400">
              {hasSignal ? `${cellCount}S LiPo Telemetry (${cellVolt}V/cell)` : 'MAVLink SYS_STATUS / BATTERY_STATUS'}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={handleRequestStream}
            disabled={isRefreshing}
            title="Probe FC telemetry stream for battery data"
            className="p-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer text-[10px] flex items-center space-x-1"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-sky-400' : ''}`} />
            <span className="hidden sm:inline">POLL</span>
          </button>
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            title="Mission Planner Battery Setup Help"
            className="p-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
          </button>
        </div>
      </div>

      {/* Main Metrics Deck */}
      <div className="grid grid-cols-3 gap-2">
        {/* Voltage */}
        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
          <div className="text-[9px] uppercase font-bold text-slate-400 flex items-center justify-between">
            <span>VOLTAGE</span>
            <Zap className="w-3 h-3 text-amber-400" />
          </div>
          <div className="text-base sm:text-lg font-black text-amber-300 mt-0.5">
            {hasSignal ? `${batteryVoltage.toFixed(2)} V` : '--.- V'}
          </div>
        </div>

        {/* Current Draw */}
        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
          <div className="text-[9px] uppercase font-bold text-slate-400">CURRENT</div>
          <div className="text-base sm:text-lg font-black text-sky-300 mt-0.5">
            {hasSignal && batteryCurrent > 0 ? `${batteryCurrent.toFixed(1)} A` : '0.0 A'}
          </div>
        </div>

        {/* State of Charge */}
        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
          <div className="text-[9px] uppercase font-bold text-slate-400">PERCENT</div>
          <div className={`text-base sm:text-lg font-black mt-0.5 ${
            !hasSignal ? 'text-slate-500' : isCritical ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-emerald-400'
          }`}>
            {hasSignal ? `${batteryPercent} %` : '-- %'}
          </div>
        </div>
      </div>

      {/* Progress Bar Gauge */}
      {hasSignal ? (
        <div className="space-y-1">
          <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                isCritical ? 'bg-rose-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, batteryPercent))}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>Cell Avg: <strong className="text-slate-200">{cellVolt}V</strong></span>
            {powerWatts > 0 && <span>Power: <strong className="text-slate-200">{powerWatts}W</strong></span>}
            <span className={isCritical ? 'text-rose-400 font-bold' : isLow ? 'text-amber-400' : 'text-emerald-400'}>
              {isCritical ? 'CRITICAL LOW' : isLow ? 'LOW RESERVE' : 'VOLTAGE HEALTHY'}
            </span>
          </div>
        </div>
      ) : (
        <div className="p-3 bg-amber-950/40 border border-amber-600/40 rounded-xl space-y-2.5 text-[11px] text-amber-200">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="leading-snug">
              <span className="font-bold text-amber-300">
                {mavlinkService.getConnectionState().isConnected
                  ? 'Pixhawk Connected — No Battery Stream Received: '
                  : 'Pixhawk Disconnected (No Telemetry): '}
              </span>
              {mavlinkService.getConnectionState().isConnected
                ? 'ArduPilot requires BATT_MONITOR=4 and SR1_EXT_STAT=4 configured in Mission Planner.'
                : 'Connect your ESP32 Wi-Fi bridge or USB cable, or launch Simulator mode to test 3S battery UI.'}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1 border-t border-amber-900/40">
            {mavlinkService.getConnectionState().isConnected ? (
              <button
                type="button"
                onClick={handleRequestStream}
                disabled={isRefreshing}
                className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] flex items-center space-x-1 cursor-pointer transition shadow"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>PROBE FC BATTERY STREAM</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => mavlinkService.switchToSimulationMode()}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center space-x-1 cursor-pointer transition shadow"
              >
                <Zap className="w-3 h-3" />
                <span>START SIMULATOR (3S 12.6V DEMO)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowHelp(!showHelp)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[10px] flex items-center space-x-1 cursor-pointer transition"
            >
              <HelpCircle className="w-3 h-3 text-sky-400" />
              <span>SETUP GUIDE</span>
            </button>
          </div>
        </div>
      )}

      {/* Helpful Instructions for Mission Planner */}
      {showHelp && (
        <div className="p-3 bg-black/60 border border-sky-500/40 rounded-xl space-y-2 text-[10px] text-slate-300 animate-in fade-in">
          <div className="font-bold text-sky-300 flex items-center justify-between">
            <span>HOW TO ENABLE BATTERY SIGNALS IN MISSION PLANNER:</span>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <ol className="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed font-mono">
            <li>Plug your drone into your PC via USB or telemetry radio and connect in Mission Planner.</li>
            <li>Go to <strong>Initial Setup &gt; Optional Hardware &gt; Battery Monitor</strong>.</li>
            <li>Set <strong>Monitor:</strong> <code className="text-amber-300 bg-slate-900 px-1 py-0.2 rounded">4: Analog Voltage and Current</code>.</li>
            <li>Set <strong>Sensor:</strong> <code className="text-amber-300 bg-slate-900 px-1 py-0.2 rounded">0: Other</code> (or 9: Holybro Power Module).</li>
            <li>Set <strong>APM Ver:</strong> <code className="text-amber-300 bg-slate-900 px-1 py-0.2 rounded">4: Pixhawk</code>.</li>
            <li>In <strong>Config &gt; Full Parameter Tree</strong>, ensure <code className="text-amber-300 bg-slate-900 px-1 py-0.2 rounded">BATT_MONITOR = 4</code> and <code className="text-amber-300 bg-slate-900 px-1 py-0.2 rounded">SR1_EXT_STAT = 4</code> (streams battery telemetry at 4 Hz).</li>
          </ol>
        </div>
      )}
    </div>
  );
};
