import { MissionLogEntry } from '../types/mission';

const STORAGE_KEY = 'SAE_MISSION_HISTORY_LOGS';
const MISSION_COUNTER_KEY = 'SAE_MISSION_COUNTER';

class StorageService {
  public getMissionLogs(): MissionLogEntry[] {
    if (typeof window === 'undefined') return [];
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed: MissionLogEntry[] = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, 5);
        }
      }
    } catch (e) {
      console.warn('Failed to parse mission logs', e);
    }
    return [];
  }

  public saveMissionLog(entry: MissionLogEntry) {
    if (typeof window === 'undefined') return;
    try {
      const current = this.getMissionLogs();
      // Keep strictly the 5 most recent missions (auto-purging older records beyond 5)
      const updated = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 5);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save mission log', e);
    }
  }

  public deleteMissionLog(id: string): MissionLogEntry[] {
    if (typeof window === 'undefined') return [];
    try {
      const current = this.getMissionLogs();
      const updated = current.filter((item) => item.id !== id).slice(0, 5);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.warn('Failed to delete mission log', e);
      return this.getMissionLogs();
    }
  }

  public clearLogs() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  public getNextMissionNumber(): number {
    if (typeof window === 'undefined') return 1;
    const logs = this.getMissionLogs();
    if (logs.length === 0) return 1;
    const maxNum = Math.max(...logs.map((l) => l.missionNumber || 0));
    return maxNum + 1;
  }

  public exportLogsAsJSON(): string {
    const logs = this.getMissionLogs();
    return JSON.stringify(logs, null, 2);
  }

  public exportLogsAsCSV(): string {
    const logs = this.getMissionLogs();
    const headers = [
      'MissionID',
      'MissionNumber',
      'Date',
      'DurationSec',
      'QRResult',
      'RunnerAck',
      'RunnerLatencyMs',
      'RTLStatus',
      'LandingStatus',
      'CompletionStatus',
      'HomeLat',
      'HomeLon',
      'WaypointsCount',
      'FlightPathPoints'
    ];

    const rows = logs.map((log) => [
      log.id,
      log.missionNumber,
      new Date(log.startTime).toISOString(),
      log.durationSeconds,
      log.qrResult || 'N/A',
      log.runnerAckReceived ? 'TRUE' : 'FALSE',
      log.runnerAckLatencyMs || 0,
      log.rtlStatus,
      log.landingStatus,
      log.completionStatus,
      log.homePoint?.latitude || 0,
      log.homePoint?.longitude || 0,
      log.waypoints?.length || 0,
      log.flightPath?.length || 0
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  public downloadFile(content: string, filename: string, contentType: string) {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const storageService = new StorageService();
