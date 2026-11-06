/**
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
 * MODULE 3: Ground Operative QR Code HUD Emergency Banner
 * High-Contrast 72px Tactical Display for Whistle-Blow & Field Reconnaissance
 * =====================================================================================
 */

import React, { useState, useEffect } from 'react';
import { audioService } from '../../services/audioService';
import { CheckCircle2, QrCode, AlertCircle, Copy, Check } from 'lucide-react';

export interface QrAlertData {
  digits: string;
  timestamp: number;
  source?: string;
}

export const QrAlertHUD: React.FC = () => {
  const [qrAlert, setQrAlert] = useState<QrAlertData | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [pulseActive, setPulseActive] = useState<boolean>(false);

  useEffect(() => {
    // 1. Listen for real-time QR Alert events dispatched by the WebSocket transport
    const handleQrEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      const detail = customEvent.detail;
      if (detail && (detail.type === 'QR_ALERT' || detail.type === 'QR_TWO_DIGIT_DETECTED')) {
        const digits = detail.digits || detail.twoDigitCode || '';
        if (digits) {
          const alertObj: QrAlertData = {
            digits: String(digits),
            timestamp: detail.timestamp || Date.now(),
            source: 'PIXHAWK TELEM2 ➔ ESP32-S3 ➔ WSS'
          };
          setQrAlert(alertObj);
          setPulseActive(true);

          // Trigger audible alert chime & mobile haptic vibration
          audioService.playQrSuccess();
          audioService.triggerHaptic('success');

          // Keep pulse animation for 5 seconds
          const pulseTimer = setTimeout(() => {
            setPulseActive(false);
          }, 5000);
          return () => clearTimeout(pulseTimer);
        }
      }
    };

    window.addEventListener('sae:qr_alert', handleQrEvent);

    // 2. Poll initial /api/recon/detections or check cached storage on mount
    fetch('/api/recon/detections')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const firstWithCode = data.find((d: any) => d.twoDigitCode);
          if (firstWithCode && !qrAlert) {
            setQrAlert({
              digits: String(firstWithCode.twoDigitCode),
              timestamp: firstWithCode.timestamp || Date.now(),
              source: 'PERSISTED CACHE'
            });
          }
        }
      })
      .catch(() => {});

    return () => {
      window.removeEventListener('sae:qr_alert', handleQrEvent);
    };
  }, []);

  const handleCopy = () => {
    if (qrAlert?.digits) {
      navigator.clipboard.writeText(qrAlert.digits);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const digitsFormatted = qrAlert?.digits
    ? (qrAlert.digits.length >= 2 ? `${qrAlert.digits[0]} ${qrAlert.digits[1]}` : qrAlert.digits)
    : null;

  return (
    <div
      className={`w-full transition-all duration-300 z-50 shadow-2xl border-b select-none ${
        digitsFormatted
          ? pulseActive
            ? 'bg-gradient-to-r from-emerald-500 via-green-400 to-emerald-500 text-slate-950 border-emerald-300 animate-pulse'
            : 'bg-emerald-500 text-slate-950 border-emerald-400'
          : 'bg-slate-900/90 backdrop-blur-md text-slate-300 border-slate-800'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 py-2 sm:py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Tactical Label */}
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-xl flex items-center justify-center ${
              digitsFormatted ? 'bg-slate-950 text-emerald-400 shadow-md' : 'bg-slate-800 text-slate-400'
            }`}
          >
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-extrabold tracking-widest opacity-80">
                ADDC 2026 Target Cache
              </span>
              {digitsFormatted && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-950 text-emerald-300 uppercase">
                  <CheckCircle2 className="w-3 h-3" /> VERIFIED
                </span>
              )}
            </div>
            <div className="text-xs font-mono font-medium opacity-90">
              {digitsFormatted
                ? `Received ${new Date(qrAlert?.timestamp || Date.now()).toLocaleTimeString()} | ${qrAlert?.source || 'RELAY'}`
                : 'Awaiting autonomous QR intercept during lawnmower sweep...'}
            </div>
          </div>
        </div>

        {/* Center / Right: Huge 72px Target Display */}
        <div className="flex items-center gap-4 ml-auto">
          {digitsFormatted ? (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-[11px] font-mono font-black tracking-widest uppercase block leading-none opacity-80">
                  CACHE CODE
                </span>
                <span className="text-xs font-bold text-slate-900">RUNNER CODE READY</span>
              </div>
              <div
                className="px-6 py-1 rounded-2xl bg-slate-950 text-emerald-400 font-mono font-black tracking-wider shadow-inner flex items-center justify-center"
                style={{ fontSize: '72px', lineHeight: '1.0' }}
              >
                {digitsFormatted}
              </div>
              <button
                onClick={handleCopy}
                title="Copy Digits"
                className="p-3 rounded-xl bg-slate-950/80 hover:bg-slate-950 text-emerald-400 transition-colors shadow-md flex items-center justify-center"
              >
                {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 font-mono">
              <AlertCircle className="w-4 h-4 text-amber-400 animate-spin" />
              <span className="text-sm font-bold text-slate-300 tracking-wider">
                CACHE CODE: <span className="text-amber-400">PENDING SCAN</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

