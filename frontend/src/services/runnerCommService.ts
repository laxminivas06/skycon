import { DroneQRDispatchPayload, RunnerAckPayload, RunnerLinkState } from '../types/runner';
import { audioService } from './audioService';

type RunnerMessageListener = (msg: DroneQRDispatchPayload | RunnerAckPayload) => void;
type RunnerStateListener = (state: RunnerLinkState) => void;

class RunnerCommService {
  private channel: BroadcastChannel | null = null;
  private messageListeners: Set<RunnerMessageListener> = new Set();
  private stateListeners: Set<RunnerStateListener> = new Set();

  private state: RunnerLinkState = {
    isConnected: true,
    channel: 'SAE_DRONE_RUNNER_DIRECT_LINK',
    peerId: 'RUNNER_DEVICE_' + Math.floor(1000 + Math.random() * 9000),
    signalStrengthDbm: -48,
    lastPingTime: Date.now(),
    packetsSent: 0,
    packetsReceived: 0
  };

  private retransmitTimer: any = null;
  private pendingPayload: DroneQRDispatchPayload | null = null;
  private ackCallback: ((ack: RunnerAckPayload) => void) | null = null;

  constructor() {
    this.initChannel();
    this.startHeartbeat();
  }

  private initChannel() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('SAE_DIRECT_P2P_LINK');
        this.channel.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };
      } catch (err) {
        console.warn('BroadcastChannel error, falling back to window storage sync', err);
      }
    }

    // Fallback: window storage event for cross-window / cross-iframe
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key === 'SAE_P2P_SYNC_PACKET' && event.newValue) {
          try {
            const data = JSON.parse(event.newValue);
            this.handleIncomingMessage(data);
          } catch (e) {
            // parse error
          }
        }
      });
    }
  }

  public subscribeMessages(fn: RunnerMessageListener) {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  public subscribeState(fn: RunnerStateListener) {
    this.stateListeners.add(fn);
    fn(this.getState());
    return () => this.stateListeners.delete(fn);
  }

  public getState(): RunnerLinkState {
    return { ...this.state };
  }

  public setSignalStrength(dbm: number) {
    this.state.signalStrengthDbm = dbm;
    this.state.isConnected = dbm > -85;
    this.notifyState();
  }

  // Drone Dispatches QR to Runner (Direct Local Link)
  public sendQRToRunner(
    qrCode: string,
    missionId: string = 'MISSION_RESCUE_01',
    altitudeMeters: number = 25,
    droneBattery: number = 88,
    extraMeta?: Partial<DroneQRDispatchPayload>,
    onAckReceived?: (ack: RunnerAckPayload) => void
  ): string {
    const messageId = extraMeta?.detectionId || `MSG_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const payload: DroneQRDispatchPayload = {
      type: 'QR_DISPATCH',
      missionId,
      messageId,
      detectionId: extraMeta?.detectionId || messageId,
      qrCode,
      timestamp: Date.now(),
      altitudeMeters,
      droneBatteryPercent: droneBattery,
      ...extraMeta
    };

    this.pendingPayload = payload;
    this.ackCallback = onAckReceived || null;

    // Send immediately
    this.broadcast(payload);
    this.state.packetsSent++;
    this.notifyState();

    // Start auto-retransmit every 600ms until ACK confirmed
    if (this.retransmitTimer) clearInterval(this.retransmitTimer);
    this.retransmitTimer = setInterval(() => {
      if (this.pendingPayload && this.pendingPayload.messageId === messageId) {
        this.broadcast(this.pendingPayload);
        this.state.packetsSent++;
        this.notifyState();
      } else {
        clearInterval(this.retransmitTimer);
      }
    }, 600);

    return messageId;
  }

  // Runner Dispatches Auto-ACK back to Drone
  public sendAckToDrone(
    qrCode: string,
    messageId: string,
    missionId: string,
    runnerBattery: number = 95
  ) {
    const ackPayload: RunnerAckPayload = {
      type: 'QR_ACK',
      missionId,
      messageId,
      received: true,
      qrCodeConfirmed: qrCode,
      runnerBatteryPercent: runnerBattery,
      timestamp: Date.now()
    };

    this.broadcast(ackPayload);
    this.state.packetsSent++;
    this.state.latestAckDispatched = true;
    this.notifyState();

    audioService.playRunnerAck();
    audioService.triggerHaptic('success');
  }

  private broadcast(data: any) {
    try {
      if (this.channel) {
        this.channel.postMessage(data);
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        // trigger storage event across windows/tabs
        window.localStorage.setItem('SAE_P2P_SYNC_PACKET', JSON.stringify({ ...data, _ts: Math.random() }));
      }
      // Notify in-process listeners immediately for local subscribers / test runners
      this.handleIncomingMessage(data);
    } catch (e) {
      console.warn('Broadcast send error', e);
    }
  }

  private handleIncomingMessage(data: any) {
    if (!data || !data.type) return;

    this.state.packetsReceived++;
    this.state.lastPingTime = Date.now();

    if (data.type === 'QR_DISPATCH') {
      const dispatch = data as DroneQRDispatchPayload;
      this.state.latestReceivedQR = dispatch.qrCode;
      this.notifyState();
      this.notifyMessage(dispatch);
    } else if (data.type === 'QR_ACK') {
      const ack = data as RunnerAckPayload;
      if (this.pendingPayload && this.pendingPayload.messageId === ack.messageId) {
        ack.ackLatencyMs = Date.now() - this.pendingPayload.timestamp;
        if (this.retransmitTimer) {
          clearInterval(this.retransmitTimer);
          this.retransmitTimer = null;
        }
        this.pendingPayload = null;
        this.state.lastAckTime = Date.now();
        this.notifyState();

        if (this.ackCallback) {
          this.ackCallback(ack);
          this.ackCallback = null;
        }
      }
      this.notifyMessage(ack);
    }
  }

  private notifyMessage(msg: any) {
    this.messageListeners.forEach((fn) => fn(msg));
  }

  private notifyState() {
    const clone = this.getState();
    this.stateListeners.forEach((fn) => fn(clone));
  }

  private startHeartbeat() {
    setInterval(() => {
      // Periodic RSSI jitter for realistic field telemetry
      const jitter = (Math.random() - 0.5) * 4;
      this.state.signalStrengthDbm = Math.round(-48 + jitter);
      this.notifyState();
    }, 2500);
  }
}

export const runnerCommService = new RunnerCommService();
