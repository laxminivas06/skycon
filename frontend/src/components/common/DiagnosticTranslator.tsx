/**
 * STATUSTEXT Diagnostic Translator & Pre-Arm Advisor (Requirement R4)
 * Baseline Specification: Technical Project Report Rev 2.4.0-PROD
 *
 * Translates cryptic ArduPilot STATUSTEXT (#253) pre-arm errors into actionable operator guidance.
 * Provides a conditional "Force Arm (21196)" override button dispatching MAV_CMD_COMPONENT_ARM_DISARM (#400)
 * with param1 = 1.0 and magic constant param2 = 21196.0 to bypass pre-arm interlocks during bench testing.
 */

import React, { useState } from 'react';
import { PixhawkStatusMessage, MAVLinkCommandAck } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import {
  AlertTriangle,
  Info,
  CheckCircle2,
  HelpCircle,
  Zap,
  Terminal,
  ShieldAlert,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export interface DiagnosticRule {
  pattern: RegExp;
  category: string;
  rootCause: string;
  operatorAction: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
}

export const ARDUPILOT_DIAGNOSTIC_RULES: DiagnosticRule[] = [
  {
    pattern: /(mode change|requires position|ekf.*position)/i,
    category: 'FLIGHT MODE / EKF3',
    rootCause: 'Flight mode switch to LOITER, GUIDED, or AUTO attempted without 3D GPS fix or EKF3 convergence.',
    operatorAction: 'Switch to STABILIZE or ALT_HOLD to fly without GPS, or move outdoors and wait for ≥ 6 satellites and HDOP < 2.0.',
    severity: 'CRITICAL'
  },
  {
    pattern: /(compass|mag.*calibrat|mag.*health|mag.*variance|bad.*compass)/i,
    category: 'COMPASS / MAGNETOMETER',
    rootCause: 'External magnetometer electromagnetic interference or disconnected I2C cable.',
    operatorAction: 'Verify external compass 4-pin cable is plugged into Pixhawk I2C port (SERIAL4/5 has no I2C pins). Move drone away from indoor steel/electronics or perform compass calibration in Mission Planner.',
    severity: 'CRITICAL'
  },
  {
    pattern: /(gps|hdop|satellites|bad.*gps|need 3d|3d fix)/i,
    category: 'GPS RECEIVER',
    rootCause: 'Insufficient GPS satellite lock outdoors or u-blox protocol misconfiguration.',
    operatorAction: 'Wait 60s for u-blox NEO-M8N lock outdoors. If connected to Port 5, verify SERIAL4_PROTOCOL = 5 and SERIAL3_PROTOCOL = 0.',
    severity: 'CRITICAL'
  },
  {
    pattern: /(safety switch|switch disengaged)/i,
    category: 'SAFETY SWITCH',
    rootCause: 'Physical Pixhawk safety switch is not pressed.',
    operatorAction: 'Press and hold the physical red safety switch on the Pixhawk for 3 seconds until the LED turns solid red.',
    severity: 'WARNING'
  },
  {
    pattern: /(baro|barometer|alt.*variance)/i,
    category: 'BAROMETER',
    rootCause: 'Barometric pressure sensor fluctuating during boot calibration.',
    operatorAction: 'Keep vehicle completely stationary on level ground for 15–30 seconds after powering on before arming.',
    severity: 'WARNING'
  },
  {
    pattern: /(battery|voltage|low batt|failsafe.*batt)/i,
    category: 'POWER SYSTEM',
    rootCause: 'Battery voltage below BATT_ARM_VOLT or Power Module reading sag.',
    operatorAction: 'Connect a fully charged 3S/4S LiPo battery (>11.1V for 3S). If bench testing on USB power, connect Power Module.',
    severity: 'CRITICAL'
  },
  {
    pattern: /(rc.*failsafe|radio failsafe|throttle.*not centered|no rc receiver)/i,
    category: 'RC / RADIO LINK',
    rootCause: 'RC receiver signal absent or throttle stick not at zero.',
    operatorAction: 'Power ON the RC transmitter and center sticks. For autonomous bench testing without RC, set ARMING_CHECK = 0 and FS_THR_ENABLE = 0 in Mission Planner.',
    severity: 'WARNING'
  },
  {
    pattern: /(accel.*calibrat|ahrs.*not healthy|inertial.*sensor|accels inconsistent)/i,
    category: 'IMU / ACCELEROMETERS',
    rootCause: 'Accelerometer calibration required or drone moved during gyroscope boot calibration.',
    operatorAction: 'Place drone on a flat, level surface and keep completely still during initialization, or run 6-axis Accel Calibration.',
    severity: 'CRITICAL'
  },
  {
    pattern: /(logging|bad.*log|logging failed)/i,
    category: 'DATA LOGGING',
    rootCause: 'MicroSD card absent, unformatted, or corrupted.',
    operatorAction: 'Insert a formatted FAT32 MicroSD card into the Pixhawk slot, or set ARMING_CHECK = 0 in Mission Planner for bench testing.',
    severity: 'WARNING'
  },
  {
    pattern: /(fence.*breach|fence.*margin|geofence)/i,
    category: 'GEOFENCE',
    rootCause: 'Drone is outside or within 2.0m margin of the 20.0m geofence boundary.',
    operatorAction: 'Move vehicle inside containment boundary or increase FENCE_ALT_MAX / FENCE_RADIUS in Mission Planner.',
    severity: 'WARNING'
  }
];

export function translateArduPilotStatus(rawText: string): {
  rule: DiagnosticRule | null;
  category: string;
  rootCause: string;
  operatorAction: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
} {
  for (const rule of ARDUPILOT_DIAGNOSTIC_RULES) {
    if (rule.pattern.test(rawText)) {
      return {
        rule,
        category: rule.category,
        rootCause: rule.rootCause,
        operatorAction: rule.operatorAction,
        severity: rule.severity
      };
    }
  }

  // Fallback translation
  return {
    rule: null,
    category: 'AUTOPILOT DIAGNOSTIC',
    rootCause: 'Raw ArduPilot STATUSTEXT message from flight controller.',
    operatorAction: mavlinkService.explainPreArmFailure(rawText),
    severity: 'INFO'
  };
}

export interface DiagnosticTranslatorProps {
  statusMessages?: PixhawkStatusMessage[];
  latestMessage?: string;
  preArmFailReason?: string;
  isArmed?: boolean;
  onForceArm?: () => Promise<boolean> | void;
  className?: string;
}

export const DiagnosticTranslator: React.FC<DiagnosticTranslatorProps> = ({
  statusMessages = [],
  latestMessage,
  preArmFailReason,
  isArmed = false,
  onForceArm,
  className = ''
}) => {
  const [isArmingInFlight, setIsArmingInFlight] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  // Extract the most urgent message to diagnose
  const activeRaw = preArmFailReason || latestMessage || (statusMessages.length > 0 ? statusMessages[0].text : '');
  const translation = activeRaw ? translateArduPilotStatus(activeRaw) : null;

  // Handle Force Arm Execution (MAV_CMD_COMPONENT_ARM_DISARM #400 with param1 = 1.0, param2 = 21196.0)
  const handleExecuteForceArm = async () => {
    setShowConfirmModal(false);
    setIsArmingInFlight(true);
    setFeedback(null);

    try {
      if (onForceArm) {
        await onForceArm();
        setFeedback({ success: true, message: 'Force Arm command (21196) dispatched successfully.' });
      } else {
        const ok = await mavlinkService.armDrone(true);
        if (ok) {
          setFeedback({ success: true, message: 'Force Arm override (21196) ACCEPTED by Pixhawk.' });
        } else {
          setFeedback({ success: false, message: 'Force Arm override was rejected or timed out.' });
        }
      }
    } catch (e: any) {
      setFeedback({ success: false, message: e?.message || 'Failed to dispatch Force Arm command.' });
    } finally {
      setIsArmingInFlight(false);
    }
  };

  return (
    <div className={`p-3.5 rounded-xl border border-slate-800 bg-slate-900/90 text-slate-200 font-mono space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-purple-400" />
          <span className="font-sans text-xs uppercase font-extrabold tracking-wider text-white">
            STATUSTEXT DIAGNOSTIC TRANSLATOR
          </span>
        </div>
        {translation && (
          <span
            className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase ${
              translation.severity === 'CRITICAL'
                ? 'bg-rose-950 border-rose-500 text-rose-300'
                : translation.severity === 'WARNING'
                ? 'bg-amber-950 border-amber-500 text-amber-300'
                : 'bg-sky-950 border-sky-500 text-sky-300'
            }`}
          >
            {translation.category}
          </span>
        )}
      </div>

      {/* Translated Guidance Card */}
      {translation && activeRaw ? (
        <div className="space-y-2 text-[11px] leading-relaxed">
          {/* Raw STATUSTEXT banner */}
          <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
            <span className="text-[9px] uppercase font-bold text-slate-500 block">Raw ArduPilot Message:</span>
            <span className="text-amber-300 font-bold break-all">"{activeRaw}"</span>
          </div>

          {/* Root Cause Analysis */}
          <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
            <span className="text-[9px] uppercase font-bold text-sky-400 block">Root Hardware Cause:</span>
            <span className="text-slate-200">{translation.rootCause}</span>
          </div>

          {/* Actionable Operator Remediation */}
          <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-200">
            <span className="text-[9px] uppercase font-bold text-emerald-400 flex items-center gap-1 mb-0.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Operator Actionable Guidance:
            </span>
            <span className="text-slate-100 font-semibold">{translation.operatorAction}</span>
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-slate-500 p-2 text-center bg-slate-950 rounded-lg">
          No active pre-arm faults detected. Autopilot telemetry nominal.
        </div>
      )}

      {/* Conditional Force Arm (21196) Override Section */}
      {!isArmed && (
        <div className="pt-2 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="text-[10px] text-slate-400 leading-tight">
            <span className="font-bold text-amber-400">Bench Override:</span> Bypasses all sensor interlocks via ArduPilot magic constant <code className="text-white bg-slate-800 px-1 py-0.5 rounded">21196.0</code>.
          </div>

          <button
            onClick={() => setShowConfirmModal(true)}
            disabled={isArmingInFlight}
            className="w-full sm:w-auto px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-sans font-black text-xs uppercase tracking-wide flex items-center justify-center gap-1.5 shadow-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            title="Dispatch MAV_CMD_COMPONENT_ARM_DISARM with param2 = 21196.0"
          >
            <Zap className="w-3.5 h-3.5 fill-black" />
            <span>{isArmingInFlight ? 'DISPATCHING...' : 'FORCE ARM (21196)'}</span>
          </button>
        </div>
      )}

      {/* Execution Feedback */}
      {feedback && (
        <div
          className={`p-2 rounded-lg text-[10px] font-mono flex items-center gap-2 ${
            feedback.success ? 'bg-emerald-950 border border-emerald-500 text-emerald-300' : 'bg-rose-950 border border-rose-500 text-rose-300'
          }`}
        >
          {feedback.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Safety Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/80 rounded-2xl max-w-md w-full p-4.5 space-y-3.5 shadow-2xl font-mono text-slate-200">
            <div className="flex items-center gap-2.5 text-amber-400">
              <ShieldAlert className="w-6 h-6" />
              <h3 className="font-sans font-black text-sm uppercase text-white">
                CONFIRM FORCE ARM OVERRIDE (21196)
              </h3>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-300">
              You are about to transmit a <strong>MAV_CMD_COMPONENT_ARM_DISARM (#400)</strong> packet with magic constant <strong>param2 = 21196.0</strong>.
            </p>

            <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/60 text-rose-200 text-[10px] leading-relaxed">
              ⚠️ <strong>DANGER:</strong> This command completely circumvents ArduPilot pre-arm safety checks. Propellers will spin immediately even if GPS, compass, barometer, or battery checks are failing! Ensure all personnel and props are clear.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 cursor-pointer"
              >
                CANCEL
              </button>
              <button
                onClick={handleExecuteForceArm}
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-sans font-black text-xs uppercase cursor-pointer"
              >
                CONFIRM FORCE ARM (21196)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
