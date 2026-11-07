/**
 * ===============================================================================
 * SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
 * SYSTEM ALERT & OPERATOR NOTICE SERVICE
 * ===============================================================================
 * Centralized aggregator for all real-time drone errors, Pixhawk STATUSTEXT,
 * pre-flight validation failures, boundary breaches, and telemetry failsafes.
 * Dispatches active alerts to the top-level GlobalErrorHUD.
 */

export type AlertSeverity = 'CRITICAL' | 'ERROR' | 'WARNING' | 'NOTICE';

export interface SystemAlertItem {
  id: string;
  title: string;
  message: string;
  actionHint?: string;
  severity: AlertSeverity;
  timestamp: number;
  source: 'PIXHAWK' | 'GCS_MISSION' | 'GEOFENCE' | 'BATTERY' | 'VISION' | 'COMMUNICATION';
  dismissed?: boolean;
}

type AlertListener = (alerts: SystemAlertItem[], activeAlert: SystemAlertItem | null) => void;

class SystemAlertService {
  private alerts: SystemAlertItem[] = [];
  private activeAlert: SystemAlertItem | null = null;
  private listeners: Set<AlertListener> = new Set();
  private maxHistory: number = 20;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('sae:operator_alert', (e: Event) => {
        const custom = e as CustomEvent;
        if (custom.detail) {
          this.pushAlert({
            title: custom.detail.title || 'SYSTEM NOTICE',
            message: custom.detail.message || String(custom.detail),
            severity: custom.detail.severity || 'ERROR',
            source: custom.detail.source || 'GCS_MISSION',
            actionHint: custom.detail.actionHint
          });
        }
      });
    }
  }

  public pushAlert(item: {
    title: string;
    message: string;
    severity?: AlertSeverity;
    source?: SystemAlertItem['source'];
    actionHint?: string;
  }) {
    if (!item.message) return;

    // Deduplicate identical alerts within 3 seconds
    const existing = this.alerts.find(
      (a) => a.message === item.message && Date.now() - a.timestamp < 3000
    );
    if (existing) {
      existing.timestamp = Date.now();
      this.activeAlert = existing;
      this.notify();
      return;
    }

    const newAlert: SystemAlertItem = {
      id: `ALT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      title: item.title,
      message: item.message,
      actionHint: item.actionHint || this.deriveActionHint(item.message),
      severity: item.severity || 'ERROR',
      source: item.source || 'GCS_MISSION',
      timestamp: Date.now(),
      dismissed: false
    };

    this.alerts = [newAlert, ...this.alerts.slice(0, this.maxHistory - 1)];
    this.activeAlert = newAlert;
    this.notify();

    // Broadcast DOM event for external listeners
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('sae:alert_pushed', { detail: newAlert }));
      } catch {}
    }
  }

  private deriveActionHint(message: string): string | undefined {
    const lower = message.toLowerCase();
    if (lower.includes('outside the selected search boundary') || lower.includes('outside the boundary')) {
      return 'Action: Move drone inside the configured search boundary on the map before arming.';
    }
    if (lower.includes('low battery') || lower.includes('voltage') || lower.includes('batt')) {
      return 'Action: Replace or recharge LiPo battery. Check safe minimum threshold (10.5V for 3S).';
    }
    if (lower.includes('rc') || lower.includes('radio') || lower.includes('throttle')) {
      return 'Action: Power ON RC transmitter and center throttle stick, or enable GCS override.';
    }
    if (lower.includes('compass') || lower.includes('mag')) {
      return 'Action: Move drone away from metal structures and calibrate compass in Mission Planner.';
    }
    if (lower.includes('gps') || lower.includes('satellite') || lower.includes('fix')) {
      return 'Action: Move to open sky with clear view of satellites. 3D fix requires >= 6 satellites.';
    }
    if (lower.includes('heartbeat') || lower.includes('connection lost') || lower.includes('disconnected')) {
      return 'Action: Verify Pixhawk USB / TELEM cable and check telemetry baud rate.';
    }
    if (lower.includes('safety switch')) {
      return 'Action: Press safety switch on drone for 2 seconds until solid red LED.';
    }
    return undefined;
  }

  public dismissActive() {
    if (this.activeAlert) {
      this.activeAlert.dismissed = true;
      // Show next un-dismissed alert if available
      const next = this.alerts.find((a) => !a.dismissed);
      this.activeAlert = next || null;
      this.notify();
    }
  }

  public clearAll() {
    this.alerts.forEach((a) => (a.dismissed = true));
    this.activeAlert = null;
    this.notify();
  }

  public getActiveAlert(): SystemAlertItem | null {
    return this.activeAlert;
  }

  public getAllAlerts(): SystemAlertItem[] {
    return [...this.alerts];
  }

  public subscribe(listener: AlertListener): () => void {
    this.listeners.add(listener);
    listener(this.alerts, this.activeAlert);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const active = this.activeAlert && !this.activeAlert.dismissed ? this.activeAlert : null;
    this.listeners.forEach((listener) => {
      try {
        listener(this.alerts, active);
      } catch {}
    });
  }
}

export const systemAlertService = new SystemAlertService();
