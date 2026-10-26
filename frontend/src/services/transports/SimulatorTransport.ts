import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';

export class SimulatorTransport implements MavlinkTransport {
  public readonly id = 'simulator';
  public readonly name = 'SITL Bench Test Simulator';
  public readonly type: TransportType = 'SIMULATOR';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();
  private isConnected = false;

  public isAvailable(): boolean {
    return true;
  }

  public async connect(): Promise<boolean> {
    this.isConnected = true;
    this.notifyState({
      phase: 'USB_CONNECTED',
      message: 'SITL Simulator active. Generating virtual Pixhawk telemetry…',
      device: {
        productName: 'SITL Quadrotor Simulator',
        vendorId: 0x26AC,
        productId: 0x0011
      }
    });
    return true;
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'Simulator Stopped'
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
      productName: 'SITL Flight Simulator',
      driverType: 'SIMULATOR',
      isConnected: this.isConnected
    };
  }
}
