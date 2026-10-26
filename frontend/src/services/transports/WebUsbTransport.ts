import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';

export class WebUsbTransport implements MavlinkTransport {
  public readonly id = 'webusb';
  public readonly name = 'WebUSB Transport';
  public readonly type: TransportType = 'WEBUSB';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();

  private device: any = null;
  private isReading = false;
  private inEp = 1;
  private outEp = 2;

  public isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  public async connect(): Promise<boolean> {
    if (!this.isAvailable()) {
      this.notifyState({
        phase: 'USB_NOT_DETECTED',
        message: 'WebUSB is not supported in this browser environment.'
      });
      return false;
    }

    try {
      const devices = await (navigator as any).usb.getDevices();
      let dev = devices.length > 0 ? devices[0] : null;

      if (!dev) {
        this.notifyState({
          phase: 'REQUESTING_PERMISSION',
          message: 'Requesting WebUSB device access...'
        });
        dev = await (navigator as any).usb.requestDevice({
          filters: [
            { vendorId: 0x26ac },
            { vendorId: 0x1209 },
            { vendorId: 0x0483 },
            { vendorId: 0x10c4 },
            { vendorId: 0x0403 },
            { vendorId: 0x1a86 },
            { vendorId: 0x2e3c },
            { vendorId: 0x067b },
            { vendorId: 0x303a }
          ]
        });
      }

      this.notifyState({
        phase: 'OPENING_USB',
        message: `Opening WebUSB connection to ${dev.productName || 'Flight Controller'}...`
      });

      await dev.open();
      if (dev.configuration === null) {
        await dev.selectConfiguration(1);
      }
      const iface = dev.configuration.interfaces[0];
      await dev.claimInterface(iface.interfaceNumber);

      for (const ep of iface.alternate.endpoints) {
        if (ep.direction === 'in') this.inEp = ep.endpointNumber;
        if (ep.direction === 'out') this.outEp = ep.endpointNumber;
      }

      this.device = dev;
      this.notifyState({
        phase: 'USB_CONNECTED',
        message: `WebUSB interface claimed for ${dev.productName || 'Pixhawk'}. Waiting for MAVLink heartbeat…`,
        device: {
          productName: dev.productName || 'Pixhawk WebUSB',
          vendorId: dev.vendorId,
          productId: dev.productId,
          endpointIn: this.inEp,
          endpointOut: this.outEp
        }
      });

      this.startReader(dev);
      return true;
    } catch (e: any) {
      this.notifyState({
        phase: 'USB_OPEN_FAILED',
        message: e?.message || 'WebUSB connection failed.',
        error: e?.message
      });
      return false;
    }
  }

  private async startReader(dev: any) {
    this.isReading = true;
    while (this.isReading && this.device) {
      try {
        const result = await dev.transferIn(this.inEp, 64);
        if (result.data && result.data.byteLength > 0) {
          const chunk = new Uint8Array(result.data.buffer);
          this.notifyData(chunk);
        }
      } catch (e) {
        if (!this.isReading) break;
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  public async disconnect(): Promise<void> {
    this.isReading = false;
    if (this.device) {
      try {
        await this.device.close();
      } catch (e) {}
      this.device = null;
    }
    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'WebUSB Disconnected'
    });
  }

  public async send(data: Uint8Array): Promise<boolean> {
    if (!this.device) return false;
    try {
      await this.device.transferOut(this.outEp, data);
      return true;
    } catch (e) {
      return false;
    }
  }

  public subscribeData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public subscribeState(listener: (event: TransportStateEvent) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyData(chunk: Uint8Array) {
    this.dataListeners.forEach((fn) => fn(chunk));
  }

  private notifyState(event: TransportStateEvent) {
    this.stateListeners.forEach((fn) => fn(event));
  }

  public async getDiagnostics(): Promise<Record<string, any>> {
    return {
      productName: this.device?.productName || 'WebUSB Device',
      vendorId: this.device?.vendorId,
      productId: this.device?.productId,
      driverType: 'WEBUSB',
      isConnected: !!this.device
    };
  }
}
