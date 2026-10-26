import React, { useEffect, useRef } from 'react';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { missionEngine } from '../../services/missionEngine';
import { searchEngine } from '../../services/searchEngine';
import { Compass, Crosshair, MapPin, Maximize2, Shield, Radio } from 'lucide-react';

interface TacticalMapProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  className?: string;
}

export const TacticalMap: React.FC<TacticalMapProps> = ({
  telemetry,
  homePoint,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const breadcrumbsRef = useRef<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      // Dark tactical grid background
      ctx.fillStyle = '#0a0f1d';
      ctx.fillRect(0, 0, width, height);

      // Draw Grid Lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      const gridSize = 30;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw Range Rings (25m, 50m, 75m, 100m)
      const rings = [45, 90, 135, 180];
      rings.forEach((r, idx) => {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`${(idx + 1) * 25}m`, centerX + r + 3, centerY - 2);
      });

      // Draw Search Boundary and Path Waypoints
      const mCfg = missionEngine.getMissionConfig();
      const sAlgo = searchEngine.getAlgorithm(mCfg.searchAlgorithm);
      const footprint = sAlgo.calculateGroundCoverage(
        mCfg.searchAltitude || 10,
        { fovHorizontalDeg: 70, fovVerticalDeg: 52, aspectRatio: 16 / 9 },
        mCfg.desiredOverlapPercent || 25
      );

      const searchBoxWidth = 140;
      const searchBoxHeight = 110;
      const searchBoxX = centerX - 30;
      const searchBoxY = centerY - 120;

      ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(searchBoxX, searchBoxY, searchBoxWidth, searchBoxHeight);
      ctx.setLineDash([]);

      // Draw Dynamic Search Lanes based on calculated effective spacing
      const numLines = Math.max(3, Math.min(8, Math.round(searchBoxHeight / (footprint.effectiveLaneSpacingMeters * 2.2))));
      const lineStep = searchBoxHeight / (numLines + 1);

      ctx.strokeStyle = mCfg.searchAlgorithm === 'ADAPTIVE'
        ? 'rgba(16, 185, 129, 0.35)'
        : mCfg.searchAlgorithm === 'SPIRAL'
        ? 'rgba(56, 189, 248, 0.35)'
        : mCfg.searchAlgorithm === 'PERIMETER'
        ? 'rgba(236, 72, 153, 0.35)'
        : 'rgba(234, 179, 8, 0.3)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);

      if (mCfg.searchAlgorithm === 'SPIRAL') {
        ctx.beginPath();
        let r = 2;
        const spCenter = { x: searchBoxX + searchBoxWidth / 2, y: searchBoxY + searchBoxHeight / 2 };
        for (let a = 0; a < 6 * Math.PI; a += 0.2) {
          r += 0.8;
          const sx = spCenter.x + Math.cos(a) * r;
          const sy = spCenter.y + Math.sin(a) * r;
          if (a === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      } else if (mCfg.searchAlgorithm === 'PERIMETER') {
        for (let ring = 1; ring <= 3; ring++) {
          const inset = ring * 12;
          ctx.strokeRect(searchBoxX + inset, searchBoxY + inset, searchBoxWidth - inset * 2, searchBoxHeight - inset * 2);
        }
      } else {
        for (let i = 1; i <= numLines; i++) {
          const lineY = searchBoxY + lineStep * i;
          ctx.beginPath();
          ctx.moveTo(searchBoxX + 4, lineY);
          ctx.lineTo(searchBoxX + searchBoxWidth - 4, lineY);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(234, 179, 8, 0.9)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(
        `SEARCH ENGINE: ${mCfg.searchBoundary.type} [${mCfg.searchAlgorithm}] Alt: ${mCfg.searchAltitude}m (${footprint.widthMeters.toFixed(1)}m FOV)`,
        searchBoxX + 2,
        searchBoxY - 6
      );

      // Home Point Coordinate (Mapped to Center)
      const homeX = centerX;
      const homeY = centerY + 40;

      // Draw Home Point Marker
      if (homePoint.isSet) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(homeX, homeY, 9, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.arc(homeX, homeY, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText('HOME POINT (LOCKED ✓)', homeX + 12, homeY + 4);
      }

      // Calculate relative Drone Position on Canvas
      // Scale: 1 meter = 2.2 pixels
      const latDiff = (telemetry.latitude - (homePoint.isSet ? homePoint.latitude : telemetry.latitude)) * 111320;
      const lonDiff = (telemetry.longitude - (homePoint.isSet ? homePoint.longitude : telemetry.longitude)) * 111320 * Math.cos(telemetry.latitude * Math.PI / 180);

      const droneX = homeX + lonDiff * 2.2;
      const droneY = homeY - latDiff * 2.2;

      // Record Breadcrumb
      if (telemetry.isArmed && (breadcrumbsRef.current.length === 0 || 
          Math.hypot(droneX - breadcrumbsRef.current[breadcrumbsRef.current.length - 1].x, 
                     droneY - breadcrumbsRef.current[breadcrumbsRef.current.length - 1].y) > 4)) {
        breadcrumbsRef.current.push({ x: droneX, y: droneY });
        if (breadcrumbsRef.current.length > 250) breadcrumbsRef.current.shift();
      }

      // Draw Flight Path Breadcrumbs
      if (breadcrumbsRef.current.length > 1) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(breadcrumbsRef.current[0].x, breadcrumbsRef.current[0].y);
        for (let i = 1; i < breadcrumbsRef.current.length; i++) {
          ctx.lineTo(breadcrumbsRef.current[i].x, breadcrumbsRef.current[i].y);
        }
        ctx.stroke();
      }

      // Draw Runner Location (Approx 12m from Home Point)
      const runnerX = homeX + 35;
      const runnerY = homeY + 20;

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(runnerX, runnerY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#34d399';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText('RUNNER (12m)', runnerX + 8, runnerY + 3);

      // Draw Drone Icon & Heading Vector
      ctx.save();
      ctx.translate(droneX, droneY);
      ctx.rotate((telemetry.heading * Math.PI) / 180);

      // Heading projection line
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -35);
      ctx.stroke();
      ctx.setLineDash([]);

      // Quadcopter body
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();

      // Arms
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      ctx.lineTo(10, 10);
      ctx.moveTo(10, -10);
      ctx.lineTo(-10, 10);
      ctx.stroke();

      // Rotors
      ctx.fillStyle = telemetry.isArmed ? 'rgba(56, 189, 248, 0.8)' : 'rgba(148, 163, 184, 0.5)';
      [[-10, -10], [10, -10], [10, 10], [-10, 10]].forEach(([rx, ry]) => {
        ctx.beginPath();
        ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      // Drone HUD text
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(`DRONE (Alt: ${telemetry.altitude.toFixed(1)}m)`, droneX + 14, droneY - 6);

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [telemetry, homePoint]);

  return (
    <div className={`relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 hud-border ${className}`}>
      {/* Top Map Header HUD */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-10 pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-md px-2.5 py-1 rounded border border-slate-700 font-mono text-[11px] text-slate-300 flex items-center space-x-2">
          <Crosshair className="w-3.5 h-3.5 text-sky-400 animate-spin" style={{ animationDuration: '8s' }} />
          <span>TACTICAL MISSION MAP</span>
        </div>
        <div className="bg-slate-900/90 backdrop-blur-md px-2.5 py-1 rounded border border-slate-700 font-mono text-[11px] text-slate-300">
          Scale: 1:200 (Field Mode)
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={480}
        height={340}
        className="w-full h-full object-cover block"
      />

      {/* Bottom Map Info Footer */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between z-10 font-mono text-[10px] text-slate-400 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded border border-slate-800">
        <span>Lat: {telemetry.latitude.toFixed(6)}°</span>
        <span>Lon: {telemetry.longitude.toFixed(6)}°</span>
        <span>Dist to Home: <strong className="text-sky-400">{telemetry.distanceToHome}m</strong></span>
      </div>
    </div>
  );
};
