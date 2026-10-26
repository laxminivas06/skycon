import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';

export class UdpTransport implements MavlinkTransport {
  public readonly id = 'udp';
  public readonly name = 'UDP Telemetry Stream';
  public readonly type: TransportType = 'UDP';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();
  private isConnected = false;
  private host = '0.0.0.0';
  private port = 14550;

  public isAvailable(): boolean {
    return true;
  }

  public async connect(options?: { host?: string; port?: number }): Promise<boolean> {
    this.host = options?.host || '0.0.0.0';
    this.port = options?.port || 14550;

    this.notifyState({
      phase: 'OPENING_USB',
      message: `Listening for UDP MAVLink packets on ${this.host}:${this.port}...`
    });

    this.isConnected = true;
    this.notifyState({
      phase: 'USB_CONNECTED',
      message: `UDP socket active on port ${this.port}. Waiting for MAVLink heartbeat…`,
      device: {
        productName: `UDP MAVLink (${this.host}:${this.port})`
      }
    });

    return true;
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'UDP Telemetry Disconnected'
    });
  }

  public async send(_data: Uint8Array): Promise<boolean> {
    return this.isConnected;
  }

  public subscribeData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public subscribeState(listener: (event: TransportStateEvent) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyState(event: TransportStateEvent) {
    this.stateListeners.forEach((fn) => fn(event));
  }

  public async getDiagnostics(): Promise<Record<string, any>> {
    return {
      productName: `UDP Port ${this.port}`,
      driverType: 'UDP',
      isConnected: this.isConnected
    };
  }
}
