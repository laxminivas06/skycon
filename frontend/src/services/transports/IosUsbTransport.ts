import { Capacitor } from '@capacitor/core';
import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';

export class IosUsbTransport implements MavlinkTransport {
  public readonly id = 'ios_usb';
  public readonly name = 'iOS USB / External Accessory Transport';
  public readonly type: TransportType = 'IOS_ACCESSORY';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();

  public isAvailable(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  }

  public async connect(): Promise<boolean> {
    const errorMsg = 'Direct USB connection is unavailable on this iOS configuration. Use a supported USB accessory/serial interface or network MAVLink connection.';
    this.notifyState({
      phase: 'IOS_UNSUPPORTED',
      message: errorMsg,
      error: errorMsg
    });
    return false;
  }

  public async disconnect(): Promise<void> {
    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'iOS Transport Disconnected'
    });
  }

  public async send(_data: Uint8Array): Promise<boolean> {
    return false;
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
      productName: 'iOS Device (External Accessory / MFi Required)',
      driverType: 'IOS_ACCESSORY',
      lastError: 'Direct USB Host is restricted on standard iOS without MFi serial accessory.'
    };
  }
}
