/**
 * 60 FPS HTML5 Canvas Artificial Horizon (PFD) HUD (Requirement R4)
 * Baseline Specification: Technical Project Report Rev 2.4.0-PROD
 *
 * Implements a high-performance Primary Flight Display (PFD) driven by requestAnimationFrame:
 * 1. Artificial Horizon:
 *    - Rotates by roll angle phi (radians)
 *    - Translates vertically by pitch angle theta (k_pitch = 4.0 px/deg)
 *    - Crisp aviation sky blue (#1e40af to #38bdf8) and tactical terrain green (#14532d to #166534)
 *    - Crisp 2px white horizon centerline
 *
 * 2. Dynamic Pitch Ladders:
 *    - Major rungs every 10° with numeric degree labels on left and right flanks
 *    - Major rungs feature downward tick ends for positive pitch (sky) and dashed rungs with upward tick ends for negative pitch (ground)
 *    - Minor rungs every 5° without numeric labels
 *
 * 3. Circular Roll Angle Arc Scale:
 *    - Circular scale from -60° to +60° with white tick marks at 0°, ±10°, ±20°, ±30°, ±45°, ±60°
 *    - Dynamic roll pointer triangle rotating with bank angle phi
 *    - Fixed top sky pointer / zero reference index
 *
 * 4. Fixed Central Aircraft Reticle:
 *    - High-visibility amber (#f59e0b) central circle with horizontal wing bars and downward wingtips
 *
 * 5. Moving Top Compass Ribbon:
 *    - Horizontal tape along top edge displaying magnetic heading 000° to 359°
 *    - Moving scale with tick marks every 5°, numbers every 10°, and cardinal labels (N, NE, E, SE, S, SW, W, NW)
 *    - Centered yellow lubber line / digital heading box
 *
 * 6. Vertical Speed Indicator (VSI Tape):
 *    - Right tape displaying vertical speed vz from -5.0 m/s to +5.0 m/s
 *    - Instantaneous climb/sink chevrons and indicator bar
 *
 * 7. Airspeed & Altitude Tapes:
 *    - Left tape displaying speed (m/s)
 *    - Right tape displaying altitude (m AGL)
 *
 * 8. Flashing 5000 ms Heartbeat Watchdog Alert Banner:
 *    - Triggered when telemetry silence exceeds 5000 ms:
 *      "⚠️ CRITICAL LINK LOST (>5000ms) — MAVLINK RTL FAILSAFE ARMED ⚠️"
 *    - Flashing at 2 Hz
 */

import React, { useEffect, useRef } from 'react';
import { DroneTelemetry } from '../../types/mission';

export interface CanvasArtificialHorizonHUDProps {
  telemetry: DroneTelemetry;
  lastHeartbeatTime?: number;
  width?: number;
  height?: number;
  pitchDeg?: number;
  rollDeg?: number;
  headingDeg?: number;
  verticalSpeedMps?: number;
  altitudeMeters?: number;
  groundSpeedMps?: number;
  isArmed?: boolean;
  flightMode?: string;
  className?: string;
}

const K_PITCH = 4.0; // 4.0 px per degree of pitch
const WATCHDOG_TIMEOUT_MS = 5000; // 5000 ms silence failsafe threshold

export const CanvasArtificialHorizonHUD: React.FC<CanvasArtificialHorizonHUDProps> = ({
  telemetry,
  lastHeartbeatTime,
  width,
  height,
  pitchDeg,
  rollDeg,
  headingDeg,
  verticalSpeedMps,
  altitudeMeters,
  groundSpeedMps,
  isArmed,
  flightMode,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // Keep latest props in ref so RAF loop always reads freshest state without re-binding
  const stateRef = useRef({
    telemetry,
    lastHeartbeatTime,
    pitchDeg,
    rollDeg,
    headingDeg,
    verticalSpeedMps,
    altitudeMeters,
    groundSpeedMps,
    isArmed,
    flightMode
  });

  useEffect(() => {
    stateRef.current = {
      telemetry,
      lastHeartbeatTime,
      pitchDeg,
      rollDeg,
      headingDeg,
      verticalSpeedMps,
      altitudeMeters,
      groundSpeedMps,
      isArmed,
      flightMode
    };
  }, [
    telemetry,
    lastHeartbeatTime,
    pitchDeg,
    rollDeg,
    headingDeg,
    verticalSpeedMps,
    altitudeMeters,
    groundSpeedMps,
    isArmed,
    flightMode
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      const container = containerRef.current;
      const targetW = width || (container ? container.clientWidth : 320);
      const targetH = height || (container ? container.clientHeight : 260);

      const dpr = window.devicePixelRatio || 1;
      const displayW = Math.max(200, targetW);
      const displayH = Math.max(180, targetH);

      if (canvas.width !== Math.round(displayW * dpr) || canvas.height !== Math.round(displayH * dpr)) {
        canvas.width = Math.round(displayW * dpr);
        canvas.height = Math.round(displayH * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Extract telemetry values
      const s = stateRef.current;
      const tel = s.telemetry;
      const pitch = s.pitchDeg !== undefined ? s.pitchDeg : (tel?.pitch || 0);
      const roll = s.rollDeg !== undefined ? s.rollDeg : (tel?.roll || 0);
      const heading = Math.round(((s.headingDeg !== undefined ? s.headingDeg : (tel?.heading || 0)) % 360 + 360) % 360);
      const vSpeed = s.verticalSpeedMps !== undefined ? s.verticalSpeedMps : (tel?.verticalSpeed || 0);
      const alt = Math.max(0, s.altitudeMeters !== undefined ? s.altitudeMeters : (tel?.altitude || 0));
      const speed = Math.max(0, s.groundSpeedMps !== undefined ? s.groundSpeedMps : (tel?.groundSpeed || 0));
      const armed = s.isArmed !== undefined ? s.isArmed : Boolean(tel?.isArmed);
      const mode = s.flightMode || tel?.flightMode || 'DISARMED';

      const lastBeat = s.lastHeartbeatTime || tel?.timestamp || Date.now();
      const silenceMs = Date.now() - lastBeat;
      const isWatchdogTriggered = silenceMs > WATCHDOG_TIMEOUT_MS;

      const w = displayW;
      const h = displayH;
      const cx = w / 2;
      const cy = h / 2;

      // 1. Clear background
      ctx.fillStyle = '#0f1117';
      ctx.fillRect(0, 0, w, h);

      // Define Horizon viewport area (circular or rounded rectangle mask)
      const horizonRadius = Math.min(cx, cy) - 20;

      ctx.save();
      // Clip to horizon circle
      ctx.beginPath();
      ctx.arc(cx, cy, horizonRadius, 0, Math.PI * 2);
      ctx.clip();

      // 2. Horizon disk (Rotated & Translated)
      ctx.save();
      ctx.translate(cx, cy);
      const rollRad = (roll * Math.PI) / 180.0;
      ctx.rotate(-rollRad);
      const pitchOffset = pitch * K_PITCH;
      ctx.translate(0, pitchOffset);

      const diskSize = Math.max(w, h) * 2.5;

      // Sky Gradient
      const skyGrad = ctx.createLinearGradient(0, -diskSize, 0, 0);
      skyGrad.addColorStop(0, '#1e3a8a');
      skyGrad.addColorStop(1, '#38bdf8');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(-diskSize, -diskSize, diskSize * 2, diskSize);

      // Ground Gradient
      const groundGrad = ctx.createLinearGradient(0, 0, 0, diskSize);
      groundGrad.addColorStop(0, '#166534');
      groundGrad.addColorStop(1, '#14532d');
      ctx.fillStyle = groundGrad;
      ctx.fillRect(-diskSize, 0, diskSize * 2, diskSize);

      // Horizon line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(-diskSize, 0);
      ctx.lineTo(diskSize, 0);
      ctx.stroke();

      // 3. Dynamic Pitch Ladders
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let deg = -40; deg <= 40; deg += 5) {
        if (deg === 0) continue; // Skip 0° horizon line

        const y = -deg * K_PITCH;
        const isMajor = deg % 10 === 0;
        const halfWidth = isMajor ? 32 : 16;
        const tickLength = 5;

        if (deg > 0) {
          // Positive Pitch (Sky): Solid lines with downward ticks (toward horizon)
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = isMajor ? 2.0 : 1.2;
          ctx.beginPath();
          // Left side
          ctx.moveTo(-halfWidth, y + tickLength);
          ctx.lineTo(-halfWidth, y);
          ctx.lineTo(-8, y);
          // Right side
          ctx.moveTo(8, y);
          ctx.lineTo(halfWidth, y);
          ctx.lineTo(halfWidth, y + tickLength);
          ctx.stroke();

          if (isMajor) {
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`${deg}`, -halfWidth - 12, y);
            ctx.fillText(`${deg}`, halfWidth + 12, y);
          }
        } else {
          // Negative Pitch (Ground): Dashed lines with upward ticks (toward horizon)
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = isMajor ? 2.0 : 1.2;
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          // Left side
          ctx.moveTo(-halfWidth, y - tickLength);
          ctx.lineTo(-halfWidth, y);
          ctx.lineTo(-8, y);
          // Right side
          ctx.moveTo(8, y);
          ctx.lineTo(halfWidth, y);
          ctx.lineTo(halfWidth, y - tickLength);
          ctx.stroke();
          ctx.restore();

          if (isMajor) {
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`${Math.abs(deg)}`, -halfWidth - 12, y);
            ctx.fillText(`${Math.abs(deg)}`, halfWidth + 12, y);
          }
        }
      }

      ctx.restore(); // Restore rotated & translated context
      ctx.restore(); // Restore clip

      // Outer bezel ring for horizon circle
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.arc(cx, cy, horizonRadius, 0, Math.PI * 2);
      ctx.stroke();

      // 4. Circular Roll Angle Arc Scale (-60° to +60°)
      ctx.save();
      ctx.translate(cx, cy);
      const arcRadius = horizonRadius - 6;

      // Draw roll scale arc
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // Canvas 0 is right (3 o'clock). Top is -90° (-pi/2).
      // Arc from -60° to +60° relative to top: -150° to -30° in standard canvas radians
      ctx.arc(0, 0, arcRadius, -Math.PI / 2 - (Math.PI / 3), -Math.PI / 2 + (Math.PI / 3));
      ctx.stroke();

      // Tick marks on roll scale
      const rollTicks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
      rollTicks.forEach((deg) => {
        const rad = -Math.PI / 2 + (deg * Math.PI) / 180.0;
        const isMajor = Math.abs(deg) === 30 || Math.abs(deg) === 60 || deg === 0;
        const tickLen = isMajor ? 10 : 6;

        const x1 = arcRadius * Math.cos(rad);
        const y1 = arcRadius * Math.sin(rad);
        const x2 = (arcRadius - tickLen) * Math.cos(rad);
        const y2 = (arcRadius - tickLen) * Math.sin(rad);

        ctx.strokeStyle = deg === 0 ? '#f59e0b' : '#ffffff';
        ctx.lineWidth = isMajor ? 2.0 : 1.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      // Fixed top zero reference triangle
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(0, -arcRadius + 2);
      ctx.lineTo(-5, -arcRadius - 7);
      ctx.lineTo(5, -arcRadius - 7);
      ctx.closePath();
      ctx.fill();

      // Dynamic Roll Pointer Triangle (Rotating with roll)
      ctx.save();
      ctx.rotate(-rollRad);
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(0, -arcRadius + 2);
      ctx.lineTo(-5, -arcRadius + 11);
      ctx.lineTo(5, -arcRadius + 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.restore(); // Restore translate(cx, cy)

      // 5. Fixed Central Aircraft Reticle Symbol (Amber/Yellow)
      ctx.save();
      ctx.translate(cx, cy);

      // Amber color
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3.0;

      // Central dot
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Left wing bar
      ctx.beginPath();
      ctx.moveTo(-36, 0);
      ctx.lineTo(-12, 0);
      ctx.lineTo(-12, 6);
      ctx.stroke();

      // Right wing bar
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(36, 0);
      ctx.lineTo(36, 6);
      ctx.stroke();

      ctx.restore();

      // 6. Moving Top Compass Ribbon (000° to 359°)
      const ribbonH = 26;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(0, 0, w, ribbonH);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(0, 0, w, ribbonH);

      const pixelsPerDeg = 2.4;
      const compassRange = Math.ceil(w / (2 * pixelsPerDeg)) + 5;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, ribbonH);
      ctx.clip();

      for (let offset = -compassRange; offset <= compassRange; offset++) {
        const deg = (heading + offset + 360) % 360;
        const x = cx + offset * pixelsPerDeg;

        if (deg % 5 === 0) {
          const isMajor = deg % 10 === 0;
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = isMajor ? 1.5 : 1.0;
          ctx.beginPath();
          ctx.moveTo(x, ribbonH - (isMajor ? 8 : 4));
          ctx.lineTo(x, ribbonH);
          ctx.stroke();

          if (isMajor) {
            let label = `${Math.floor(deg / 10)}`;
            let isCardinal = false;
            let color = '#cbd5e1';

            if (deg === 0) {
              label = 'N';
              isCardinal = true;
              color = '#ef4444';
            } else if (deg === 45) {
              label = 'NE';
              isCardinal = true;
            } else if (deg === 90) {
              label = 'E';
              isCardinal = true;
            } else if (deg === 135) {
              label = 'SE';
              isCardinal = true;
            } else if (deg === 180) {
              label = 'S';
              isCardinal = true;
            } else if (deg === 225) {
              label = 'SW';
              isCardinal = true;
            } else if (deg === 270) {
              label = 'W';
              isCardinal = true;
            } else if (deg === 315) {
              label = 'NW';
              isCardinal = true;
            }

            ctx.font = isCardinal ? 'bold 10px sans-serif' : '9px monospace';
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(label, x, 3);
          }
        }
      }
      ctx.restore();

      // Compass Center Pointer & Digital Readout Box
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.5;
      const boxW = 38;
      const boxH = 16;
      ctx.fillRect(cx - boxW / 2, ribbonH - boxH / 2, boxW, boxH);
      ctx.strokeRect(cx - boxW / 2, ribbonH - boxH / 2, boxW, boxH);

      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#facc15';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${heading.toString().padStart(3, '0')}°`, cx, ribbonH);

      // 7. Left Tape: Ground Speed
      const tapeW = 34;
      const tapeH = 110;
      const tapeY = cy - tapeH / 2;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.0;
      ctx.fillRect(4, tapeY, tapeW, tapeH);
      ctx.strokeRect(4, tapeY, tapeW, tapeH);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GS m/s', 4 + tapeW / 2, tapeY + 10);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(speed.toFixed(1), 4 + tapeW / 2, cy);

      // 8. Right Tape: Altitude (AGL)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.0;
      ctx.fillRect(w - tapeW - 4, tapeY, tapeW, tapeH);
      ctx.strokeRect(w - tapeW - 4, tapeY, tapeW, tapeH);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ALT m', w - tapeW / 2 - 4, tapeY + 10);

      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(alt.toFixed(1), w - tapeW / 2 - 4, cy);

      // 9. Vertical Speed Indicator (VSI Tape)
      const vsiW = 12;
      const vsiH = 90;
      const vsiX = w - tapeW - vsiW - 8;
      const vsiY = cy - vsiH / 2;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.0;
      ctx.fillRect(vsiX, vsiY, vsiW, vsiH);
      ctx.strokeRect(vsiX, vsiY, vsiW, vsiH);

      // Center 0 m/s tick
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(vsiX, cy);
      ctx.lineTo(vsiX + vsiW, cy);
      ctx.stroke();

      // Climb / Sink indicator (-5.0 to +5.0 m/s)
      const clampedVz = Math.max(-5.0, Math.min(5.0, vSpeed));
      const vsiScale = (vsiH / 2) / 5.0; // pixels per m/s
      const barH = clampedVz * vsiScale;

      ctx.fillStyle = clampedVz >= 0 ? '#22c55e' : '#ef4444';
      if (clampedVz >= 0) {
        ctx.fillRect(vsiX + 2, cy - barH, vsiW - 4, barH);
      } else {
        ctx.fillRect(vsiX + 2, cy, vsiW - 4, -barH);
      }

      // Small readout
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'right';
      ctx.fillText(`${vSpeed >= 0 ? '+' : ''}${vSpeed.toFixed(1)}`, vsiX - 2, cy + 3);

      // 10. Bottom Tactical State Strip
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(0, h - 22, w, 22);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(0, h - 22, w, 22);

      // Mode Badge
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#a855f7';
      ctx.fillText(`MODE: ${mode}`, 8, h - 11);

      // Arm State Badge
      ctx.textAlign = 'right';
      ctx.fillStyle = armed ? '#22c55e' : '#ef4444';
      ctx.fillText(armed ? 'ARMED' : 'DISARMED', w - 8, h - 11);

      // Pitch / Roll Digital Readout
      ctx.textAlign = 'center';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px monospace';
      ctx.fillText(`P: ${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}°  R: ${roll >= 0 ? '+' : ''}${roll.toFixed(1)}°`, cx, h - 11);

      // 11. Flashing 5000 ms Heartbeat Watchdog Alert Banner Overlay
      if (isWatchdogTriggered) {
        // Flash at 2 Hz: 250ms ON, 250ms OFF
        const isFlashOn = Math.floor(Date.now() / 250) % 2 === 0;

        if (isFlashOn) {
          const bannerH = 34;
          const bannerY = cy - bannerH / 2;
          ctx.fillStyle = 'rgba(185, 28, 28, 0.95)'; // High-visibility red
          ctx.strokeStyle = '#fbbf24'; // Amber border
          ctx.lineWidth = 2.5;

          ctx.fillRect(10, bannerY, w - 20, bannerH);
          ctx.strokeRect(10, bannerY, w - 20, bannerH);

          ctx.font = 'bold 10.5px sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⚠️ CRITICAL LINK LOST (>5000ms) — MAVLINK RTL FAILSAFE ARMED ⚠️', cx, cy);
        }
      }

      ctx.restore(); // Restore root canvas context

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [width, height]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[220px] flex items-center justify-center overflow-hidden rounded-xl bg-slate-950 border border-slate-800 shadow-2xl ${className}`}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};

