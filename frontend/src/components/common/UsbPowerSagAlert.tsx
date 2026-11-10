/**
 * USB Power Rail Sag Detector (Requirement R4)
 * Baseline Specification: Technical Project Report Rev 2.4.0-PROD
 *
 * Evaluates SYS_STATUS (#1) battery voltage:
 * - Nominal LiPo rail stepping through ArduPilot Power Module: 5.37V ± 0.05V (5370 mV).
 * - When powered via Micro-USB, internal diode drops cause peripheral voltage (VDD_5V_PERIPH)
 *   to sag below 4.40V (4400 mV).
 * - Under 4.4V, peripheral brownouts are imminent on u-blox NEO-M8N GPS, external compass,
 *   and TELEM2 ESP32-S3 radio transceiver.
 *
 * Flags critical warning when SYS_STATUS.voltage_battery < 4400 mV (< 4.4V).
 */

import React from 'react';
import { AlertTriangle, Zap, ShieldAlert } from 'lucide-react';

export interface UsbPowerSagAlertProps {
  /** Battery voltage in millivolts directly from SYS_STATUS (offset 14) */
  voltageMv?: number;
  /** Battery voltage in Volts (e.g. from telemetry.batteryVoltage) */
  voltageV?: number;
  /** Whether to show a compact badge when power is healthy (default false) */
  showHealthyBadge?: boolean;
  className?: string;
}

export const UsbPowerSagAlert: React.FC<UsbPowerSagAlertProps> = ({
  voltageMv,
  voltageV,
  showHealthyBadge = false,
  className = ''
}) => {
  // Normalize voltage to millivolts
  let effectiveMv = 0;
  if (voltageMv !== undefined && voltageMv > 0) {
    effectiveMv = voltageMv;
  } else if (voltageV !== undefined && voltageV > 0) {
    effectiveMv = Math.round(voltageV * 1000);
  }

  // 65535 indicates voltage is unmonitored or uncalibrated
  const isUnmonitored = effectiveMv === 0 || effectiveMv >= 65000;
  const isUsbSag = !isUnmonitored && effectiveMv < 4400; // Under 4.4V (<4400 mV)
  const measuredV = (effectiveMv / 1000).toFixed(2);

  if (isUsbSag) {
    return (
      <div
        className={`p-3 rounded-xl border border-rose-500/80 bg-rose-950/80 text-rose-200 shadow-2xl backdrop-blur-md flex items-start gap-2.5 animate-pulse ${className}`}
        role="alert"
      >
        <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 font-mono text-[11px] leading-relaxed">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <span className="font-sans font-black text-xs uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              CRITICAL: USB POWER RAIL SAG DETECTED ({measuredV}V &lt; 4.40V)
            </span>
            <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-400 text-white font-black text-[10px]">
              BROWNOUT RISK
            </span>
          </div>
          <p className="text-slate-200">
            Pixhawk 2.4.8 is currently operating on <strong>Micro-USB bus power ({measuredV}V)</strong> instead of the calibrated <strong>5.37V nominal LiPo rail</strong>.
          </p>
          <p className="mt-1 text-amber-300 font-semibold">
            ⚠️ Peripheral brownouts imminent on <strong>u-blox GPS</strong> and <strong>TELEM2 ESP32-S3 radio</strong>. Connect main 3S/4S LiPo battery via the Power Module immediately before arming!
          </p>
        </div>
      </div>
    );
  }

  if (showHealthyBadge && !isUnmonitored) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] ${className}`}>
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span>POWER RAIL NOMINAL: {measuredV}V (&ge; 4.40V)</span>
      </div>
    );
  }

  return null;
};

