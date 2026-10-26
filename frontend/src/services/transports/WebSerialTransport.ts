import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';

export class WebSerialTransport implements MavlinkTransport {
  public readonly id = 'webserial';
  public readonly name = 'WebSerial Browser Transport';
  public readonly type: TransportType = 'WEBSERIAL';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();

  private port: any = null;
  private reader: any = null;
  private writer: any = null;
  private isReading = false;
  private baudRate = 115200;

  constructor() {
    if (this.isAvailable()) {
      (navigator as any).serial.addEventListener('connect', () => {
        this.notifyState({
          phase: 'USB_DEVICE_DETECTED',
          message: 'WebSerial device connected'
        });
      });
      (navigator as any).serial.addEventListener('disconnect', () => {
        this.disconnect();
        this.notifyState({
          phase: 'DISCONNECTED',
          message: 'WebSerial device disconnected'
        });
      });
    }
  }

  public isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  public async connect(options?: { baudRate?: number }): Promise<boolean> {
    if (!this.isAvailable()) {
      this.notifyState({
        phase: 'USB_NOT_DETECTED',
        message: 'WebSerial is not supported in this browser environment.'
      });
      return false;
    }

    this.baudRate = options?.baudRate || 115200;

    try {
      const ports = await (navigator as any).serial.getPorts();
      let port = ports.length > 0 ? ports[0] : null;

      if (!port) {
        this.notifyState({
          phase: 'REQUESTING_PERMISSION',
          message: 'Requesting WebSerial port permission...'
        });
        port = await (navigator as any).serial.requestPort();
      }

      this.notifyState({
        phase: 'OPENING_USB',
        message: `Opening WebSerial port @ ${this.baudRate} baud...`
      });

      await port.open({ baudRate: this.baudRate });
      this.port = port;
      this.writer = port.writable.getWriter();

      this.notifyState({
        phase: 'USB_CONNECTED',
        message: `WebSerial port opened @ ${this.baudRate} baud. Waiting for MAVLink heartbeat…`,
        device: {
          productName: 'Pixhawk WebSerial Port',
          baudRate: this.baudRate
        }
      });

      this.startReader(port);
      return true;
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        this.notifyState({
          phase: 'DISCONNECTED',
          message: 'WebSerial port selection cancelled by user.'
        });
      } else {
        this.notifyState({
          phase: 'USB_OPEN_FAILED',
          message: err?.message || 'Failed to open WebSerial port.',
          error: err?.message
        });
      }
      return false;
    }
  }

  private async startReader(port: any) {
    this.isReading = true;
    while (port.readable && this.isReading) {
      try {
        this.reader = port.readable.getReader();
        while (this.isReading) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && value.length > 0) {
            this.notifyData(value);
          }
        }
      } catch (e) {
        break;
      } finally {
        if (this.reader) {
          try { this.reader.releaseLock(); } catch (e) {}
          this.reader = null;
        }
      }
    }
  }

  public async disconnect(): Promise<void> {
    this.isReading = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
        this.reader.releaseLock();
      } catch (e) {}
      this.reader = null;
    }
    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch (e) {}
      this.writer = null;
    }
    if (this.port) {
      try {
        await this.port.close();
      } catch (e) {}
      this.port = null;
    }
    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'WebSerial Disconnected'
    });
  }

  public async send(data: Uint8Array): Promise<boolean> {
    if (!this.writer) return false;
    try {
      await this.writer.write(data);
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
      productName: this.port ? 'Pixhawk WebSerial Port' : 'No WebSerial Port',
      baudRate: this.baudRate,
      driverType: 'WEBSERIAL',
      isConnected: !!this.port
    };
  }
}
