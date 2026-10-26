import React, { useState, useEffect, useRef } from 'react';
import { Settings, Trash2, Download, Upload } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Segmented } from '../../ui/Segmented';
import { groundStationMissionService } from '../../services/groundStationMissionService';
import { GroundStationMission, GroundStationWaypoint } from '../../types/groundStationMap';
import { audioService } from '../../services/audioService';

interface WaypointManagerProps {
  className?: string;
  onClearAll?: () => void;
  onLoadKml?: () => void;
  onSaveKml?: () => void;
}

const exportWaypointsToKml = (wps: GroundStationWaypoint[]): string => {
  const placemarks = wps
    .map(
      (w, idx) => `
    <Placemark>
      <name>Waypoint ${idx + 1}</name>
      <Point>
        <coordinates>${w.lng},${w.lat},${w.altitude}</coordinates>
      </Point>
    </Placemark>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>SAE Autonomous Drone Mission</name>
    ${placemarks}
  </Document>
</kml>`;
};

const parseKmlPoints = (text: string): Array<{ lat: number; lng: number; altitude: number }> => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'text/xml');
  const coordEls = xml.querySelectorAll('coordinates');
  const pts: Array<{ lat: number; lng: number; altitude: number }> = [];

  coordEls.forEach((el) => {
    const raw = el.textContent?.trim() || '';
    raw.split(/\s+/).forEach((coord) => {
      const parts = coord.split(',').map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        pts.push({ lng: parts[0], lat: parts[1], altitude: parts[2] || 30 });
      }
    });
  });

  return pts;
};

export const WaypointManager: React.FC<WaypointManagerProps> = ({
  className = '',
  onClearAll,
  onLoadKml,
  onSaveKml,
}) => {
  const [activeTab, setActiveTab] = useState<'Waypoints' | 'Patterns'>('Waypoints');
  const [waypoints, setWaypoints] = useState<GroundStationWaypoint[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = groundStationMissionService.subscribe((mission: GroundStationMission | null) => {
      setWaypoints(mission?.waypoints || []);
    });
    return () => unsub();
  }, []);

  const handleDeleteMission = async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      audioService.playBeep(450, 60);
      setTimeout(() => setDeleteConfirm(false), 4000);
      return;
    }
    setDeleteConfirm(false);
    await groundStationMissionService.deleteMission();
    onClearAll?.();
  };

  const handleDeleteWaypoint = (index: number) => {
    const curr = groundStationMissionService.getCurrentMission();
    if (!curr) return;
    const filtered = curr.waypoints.filter((_, idx) => idx !== index);
    if (filtered.length === 0) {
      groundStationMissionService.clearMission();
    } else {
      groundStationMissionService.generateWaypointMission(
        filtered.map((w) => ({ lat: w.lat, lng: w.lng })),
        { latitude: filtered[0].lat, longitude: filtered[0].lng, altitude: 0, timestamp: Date.now(), isSet: true },
        filtered[0].altitude || 30,
        filtered[0].speed || 5
      );
    }
    audioService.playBeep(600, 50);
  };

  const handleSaveKml = () => {
    const curr = groundStationMissionService.getCurrentMission();
    if (!curr || curr.waypoints.length === 0) {
      alert('No waypoints to export. Add waypoints first.');
      return;
    }
    const kml = exportWaypointsToKml(curr.waypoints);
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sae_mission_${Date.now()}.kml`;
    a.click();
    URL.revokeObjectURL(url);
    audioService.playBeep(880, 80);
    onSaveKml?.();
  };

  const handleLoadKmlClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        try {
          const pts = parseKmlPoints(text);
          if (pts.length === 0) {
            alert('No valid coordinates found in KML file.');
            return;
          }
          groundStationMissionService.generateWaypointMission(
            pts.map((p) => ({ lat: p.lat, lng: p.lng })),
            { latitude: pts[0].lat, longitude: pts[0].lng, altitude: 0, timestamp: Date.now(), isSet: true },
            pts[0].altitude || 30,
            5.0
          );
          audioService.playBeep(880, 100);
          onLoadKml?.();
        } catch (err: any) {
          alert('Failed to parse KML file: ' + err.message);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <Card
      title="WAYPOINT MANAGER"
      action={
        <button
          type="button"
          title="Waypoint Settings"
          aria-label="Waypoint Settings"
          className="text-[var(--uav-muted)] hover:text-white transition cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      }
      className={`h-[205px] w-full shrink-0 select-none ${className}`}
      contentClassName="p-2 flex flex-col justify-between overflow-hidden"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".kml,.xml"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Top Controls Row */}
      <div className="flex items-center justify-between">
        <Segmented
          size="sm"
          value={activeTab}
          onChange={(t) => setActiveTab(t as any)}
          options={[
            { id: 'Waypoints', label: 'Waypoints' },
            { id: 'Patterns', label: 'Patterns' },
          ]}
        />
        <span className="text-[11px] font-mono text-[var(--uav-muted)]">
          Total: {waypoints.length} WPs
        </span>
      </div>

      {/* Active Tab View */}
      {activeTab === 'Waypoints' && (
        <div className="flex-1 flex flex-col my-1 rounded-[6px] border border-[var(--uav-card-border)] bg-[#11161D] overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[30px_1fr_1fr_60px_45px] px-2 py-1 bg-[#161B22] text-[10px] font-semibold uppercase text-[var(--uav-muted)] border-b border-[var(--uav-card-border)] text-left">
            <span>#</span>
            <span>Latitude</span>
            <span>Longitude</span>
            <span>Alt (m)</span>
            <span className="text-right">Action</span>
          </div>

          {/* Table Body */}
          <div className="flex-1 overflow-y-auto font-mono text-[11px] divide-y divide-[#262C36]/50 scrollbar-thin scrollbar-thumb-[#262C36]">
            {waypoints.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-3 text-center text-[var(--uav-muted)] text-[11px]">
                <span className="font-semibold text-slate-300">No waypoints added</span>
                <span className="text-[10px]">Click on map or select a pattern to add waypoints</span>
              </div>
            ) : (
              waypoints.map((wp, idx) => (
                <div
                  key={wp.id || idx}
                  className="grid grid-cols-[30px_1fr_1fr_60px_45px] px-2 py-1 items-center hover:bg-[#161B22] text-[var(--uav-text)] text-left"
                >
                  <span className="font-bold text-[var(--uav-primary-blue)]">{idx + 1}</span>
                  <span className="truncate">{wp.lat.toFixed(5)}°</span>
                  <span className="truncate">{wp.lng.toFixed(5)}°</span>
                  <span>{wp.altitude}m</span>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleDeleteWaypoint(idx)}
                      className="text-red-400/80 hover:text-red-400 p-0.5 transition cursor-pointer"
                      title={`Delete Waypoint ${idx + 1}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'Patterns' && (
        <div className="flex-1 flex flex-col justify-between my-1 p-2 rounded-[6px] border border-[var(--uav-card-border)] bg-[#11161D] text-[11px] font-sans">
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex flex-col">
              <span className="text-[var(--uav-muted)]">Grid Spacing:</span>
              <span className="font-mono font-bold text-white">6.0 m</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[var(--uav-muted)]">Orbit Radius:</span>
              <span className="font-mono font-bold text-white">15.0 m</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[var(--uav-muted)]">Search Alt:</span>
              <span className="font-mono font-bold text-white">20.0 m</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[var(--uav-muted)]">Spiral Loops:</span>
              <span className="font-mono font-bold text-white">4 Loops</span>
            </div>
          </div>
          <div className="text-[10px] text-[var(--uav-muted)] pt-1 border-t border-[var(--uav-card-border)]">
            Select bottom "Mission Patterns" cards (Grid, Spiral, Circle) to generate flight trajectories
          </div>
        </div>
      )}

      {/* Bottom Button Bar */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--uav-card-border)]">
        <button
          type="button"
          onClick={handleDeleteMission}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-[6px] border text-[11px] font-sans font-bold transition cursor-pointer shadow-sm active:scale-95 ${
            deleteConfirm
              ? 'bg-red-600 text-white border-white animate-pulse'
              : 'border-red-500/70 bg-red-950/40 text-red-400 hover:bg-red-900/60 hover:text-white'
          }`}
          title="Delete mission from GCS and wipe Pixhawk FC EEPROM (MISSION_CLEAR_ALL)"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{deleteConfirm ? 'CONFIRM DELETE?' : 'Delete Mission'}</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleLoadKmlClick}
            className="flex items-center gap-1 px-2.5 py-1 rounded-[6px] border border-[var(--uav-card-border)] bg-[#161B22] hover:bg-[#21262D] text-[var(--uav-text)] text-[11px] font-sans font-medium transition cursor-pointer"
          >
            <Upload className="w-3 h-3 text-[var(--uav-muted)]" />
            <span>Load (KML)</span>
          </button>
          <button
            type="button"
            onClick={handleSaveKml}
            disabled={waypoints.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-[#10B981] hover:bg-[#059669] disabled:opacity-40 disabled:pointer-events-none text-emerald-950 text-[11px] font-sans font-bold transition cursor-pointer"
          >
            <Download className="w-3 h-3" />
            <span>Save (KML)</span>
          </button>
        </div>
      </div>
    </Card>
  );
};
