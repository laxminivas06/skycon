import { AppRole } from '../types/mission';

export interface UserSession {
  role: AppRole;
  callsign: string;
  stationId: string;
  token: string;
  loginTime: number;
}

export const ROLE_CREDENTIALS = {
  GROUND_STATION: {
    role: 'GROUND_STATION' as AppRole,
    title: 'Ground Station Android',
    defaultCallsign: 'GCS_ALPHA_01',
    passkey: 'gcs2026',
    stationId: 'STA_GCS_MAIN',
    badge: 'MISSION CONTROLLER'
  },
  DRONE: {
    role: 'DRONE' as AppRole,
    title: 'Drone Android Mission Core',
    defaultCallsign: 'DRONE_UAV_01',
    passkey: 'drone2026',
    stationId: 'STA_DRONE_VISION',
    badge: 'ONBOARD AVIONICS'
  },
  RUNNER: {
    role: 'RUNNER' as AppRole,
    title: 'Runner Android Field Unit',
    defaultCallsign: 'RUNNER_FIELD_01',
    passkey: 'runner2026',
    stationId: 'STA_RUNNER_DIRECT',
    badge: 'GROUND RUNNER'
  },
  MANUAL: {
    role: 'MANUAL' as AppRole,
    title: 'Manual Control Operator',
    defaultCallsign: 'MANUAL_OPS_01',
    passkey: 'manual2026',
    stationId: 'STA_MANUAL_OPS',
    badge: 'MANUAL OVERRIDE'
  }
};

const SESSION_STORAGE_KEY = 'SAE_ACTIVE_USER_SESSION';

class AuthService {
  private currentSession: UserSession | null = null;
  private listeners: Set<(session: UserSession | null) => void> = new Set();

  constructor() {
    this.restoreSession();
  }

  private restoreSession() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        this.currentSession = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to restore auth session', e);
    }
  }

  public subscribeSession(fn: (session: UserSession | null) => void) {
    this.listeners.add(fn);
    fn(this.currentSession);
    return () => this.listeners.delete(fn);
  }

  public getSession(): UserSession | null {
    return this.currentSession;
  }

  public login(role: AppRole, callsign: string, passkey: string): { success: boolean; error?: string } {
    if (role === 'SELECT' || role === 'TESTBENCH') {
      const session: UserSession = {
        role,
        callsign: 'TEST_BENCH_ADMIN',
        stationId: 'STA_COMMAND_BENCH',
        token: `TKN_${Date.now()}`,
        loginTime: Date.now()
      };
      this.saveSession(session);
      return { success: true };
    }

    const config = ROLE_CREDENTIALS[role as keyof typeof ROLE_CREDENTIALS];
    if (!config) {
      return { success: false, error: 'Invalid role selected' };
    }

    if (passkey.trim() !== config.passkey) {
      return { success: false, error: `Invalid passkey for ${config.title}. Default is "${config.passkey}"` };
    }

    const session: UserSession = {
      role,
      callsign: callsign.trim() || config.defaultCallsign,
      stationId: config.stationId,
      token: `TKN_${role}_${Date.now()}`,
      loginTime: Date.now()
    };

    this.saveSession(session);
    return { success: true };
  }

  public quickLogin(role: AppRole) {
    if (role === 'TESTBENCH' || role === 'SELECT') {
      this.login(role, 'TEST_ADMIN', '');
      return;
    }
    const config = ROLE_CREDENTIALS[role as keyof typeof ROLE_CREDENTIALS];
    if (config) {
      this.login(role, config.defaultCallsign, config.passkey);
    }
  }

  public switchRole(role: AppRole) {
    // Instant role switch without passkey - for in-app mode switching
    const config = ROLE_CREDENTIALS[role as keyof typeof ROLE_CREDENTIALS];
    const session: UserSession = {
      role,
      callsign: config ? config.defaultCallsign : role,
      stationId: config ? config.stationId : `STA_${role}`,
      token: `TKN_${role}_${Date.now()}`,
      loginTime: Date.now()
    };
    this.saveSession(session);
  }

  public logout() {
    this.currentSession = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    this.notify();
  }

  private saveSession(session: UserSession) {
    this.currentSession = session;
    if (typeof window !== 'undefined') {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
    this.notify();
  }

  private notify() {
    this.listeners.forEach((fn) => fn(this.currentSession));
  }
}

export const authService = new AuthService();
