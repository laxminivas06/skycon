import { registerPlugin, Capacitor } from '@capacitor/core';
import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';

export interface NativeUsbDevice {
  deviceName: string;
  vendorId: number;
  productId: number;
  deviceClass: number;
  deviceSubclass: number;
  deviceProtocol?: number;
  interfaceCount: number;
  interfaceType?: string;
  driverType?: string;
  productName: string;
  manufacturerName: string;
  serialNumber: string;
  interfaces?: Array<{
    id: number;
    interfaceClass: number;
    interfaceSubclass: number;
    interfaceProtocol?: number;
    endpointCount: number;
  }>;
}

export interface NativeUsbSerialPlugin {
  getConnectedDevices(): Promise<{ devices: NativeUsbDevice[]; count: number }>;
  autoConnect(options: { baudRate: number }): Promise<{ success: boolean; phase?: string; device?: NativeUsbDevice; error?: string }>;
  requestPermission(options?: { deviceName?: string }): Promise<{ granted?: boolean; requested?: boolean; device?: NativeUsbDevice }>;
  sendData(options: { data: string }): Promise<{ bytesSent: number }>;
  disconnect(): Promise<{ success: boolean }>;
  getDiagnostics(): Promise<any>;
  addListener(eventName: 'usbData', listenerFunc: (data: { data: string; length: number }) => void): Promise<any>;
  addListener(eventName: 'usbStateChange', listenerFunc: (state: { status?: string; phase?: string; message: string; device?: NativeUsbDevice }) => void): Promise<any>;
  addListener(eventName: 'usbAttached', listenerFunc: (info: { device: NativeUsbDevice }) => void): Promise<any>;
  addListener(eventName: 'usbDetached', listenerFunc: (info: { device?: NativeUsbDevice }) => void): Promise<any>;
}

const UsbSerial = registerPlugin<NativeUsbSerialPlugin>('UsbSerial');

export class AndroidUsbTransport implements MavlinkTransport {
  public readonly id = 'android_usb';
  public readonly name = 'Android USB Host / OTG';
  public readonly type: TransportType = 'ANDROID_USB';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();
  private currentDevice: NativeUsbDevice | null = null;
  private currentBaudRate: number = 57600;
  private isInitialized = false;

  constructor() {
    this.initPluginListeners();
  }

  public isAvailable(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  private async initPluginListeners() {
    if (!this.isAvailable() || this.isInitialized) return;
    this.isInitialized = true;

    try {
      await UsbSerial.addListener('usbData', (event) => {
        if (event && event.data) {
          const binaryString = atob(event.data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          this.notifyData(bytes);
        }
      });

      await UsbSerial.addListener('usbStateChange', (event) => {
        if (event.device) this.currentDevice = event.device;
        const phase = event.phase || event.status || 'DISCONNECTED';
        this.notifyState({
          phase,
          message: event.message,
          device: event.device
        });
      });

      await UsbSerial.addListener('usbAttached', async (event) => {
        if (event.device) {
          this.currentDevice = event.device;
          this.notifyState({
            phase: 'USB_DEVICE_DETECTED',
            message: `USB device attached: ${event.device.productName || 'Pixhawk Flight Controller'}`,
            device: event.device
          });
          // Automatically trigger auto-connect & permission request
          await this.connect({ baudRate: this.currentBaudRate });
        }
      });

      await UsbSerial.addListener('usbDetached', () => {
        this.currentDevice = null;
        this.notifyState({
          phase: 'CONNECTION_LOST',
          message: 'Pixhawk connection lost (USB cable disconnected)'
        });
      });
    } catch (err) {
      console.warn('[AndroidUsbTransport] Listener init notice:', err);
    }
  }

  public async scanDevices(): Promise<NativeUsbDevice[]> {
    if (!this.isAvailable()) return [];
    try {
      const res = await UsbSerial.getConnectedDevices();
      return res.devices || [];
    } catch (e) {
      console.warn('[AndroidUsbTransport] Scan error:', e);
      return [];
    }
  }

  public async requestUsbPermission(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      this.notifyState({
        phase: 'USB_PERMISSION_REQUIRED',
        message: 'Requesting Android USB permission...'
      });
      const res = await UsbSerial.requestPermission();
      return !!(res.granted || res.requested);
    } catch (e: any) {
      this.notifyState({
        phase: 'PERMISSION_DENIED',
        message: e?.message || 'USB permission request failed.',
        error: e?.message
      });
      return false;
    }
  }

  public async connect(options?: { baudRate?: number }): Promise<boolean> {
    if (!this.isAvailable()) {
      this.notifyState({
        phase: 'USB_NOT_DETECTED',
        message: 'Android USB Host is only supported when running natively on Android.'
      });
      return false;
    }

    const baudRate = options?.baudRate || 57600;
    this.currentBaudRate = baudRate;

    try {
      this.notifyState({
        phase: 'USB_DEVICE_DETECTED',
        message: 'Scanning USB Host for Pixhawk Flight Controller...'
      });

      const res = await UsbSerial.autoConnect({ baudRate });
      if (res && res.success) {
        if (res.device) this.currentDevice = res.device;
        return true;
      } else {
        const phase = res?.phase || 'USB_NOT_DETECTED';
        const errMsg = res?.error || 'No USB device detected. Verify the OTG adapter supports data and Pixhawk is powered.';
        this.notifyState({
          phase,
          message: errMsg,
          error: errMsg
        });
        return false;
      }
    } catch (err: any) {
      const errMsg = err?.message || 'USB Host connection error';
      this.notifyState({
        phase: 'SERIAL_OPEN_FAILED',
        message: errMsg,
        error: errMsg
      });
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await UsbSerial.disconnect();
    } catch (ignored) {}
    this.currentDevice = null;
    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'Disconnected by user'
    });
  }

  public async send(data: Uint8Array): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      let binaryString = '';
      for (let i = 0; i < data.length; i++) {
        binaryString += String.fromCharCode(data[i]);
      }
      const base64 = btoa(binaryString);
      await UsbSerial.sendData({ data: base64 });
      return true;
    } catch (err) {
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
    if (!this.isAvailable()) {
      return {
        driverType: 'NATIVE_ANDROID_USB',
        isUsbHostSupported: false,
        available: false
      };
    }
    try {
      const diag = await UsbSerial.getDiagnostics();
      return {
        deviceName: diag?.device?.deviceName,
        productName: diag?.device?.productName || 'Pixhawk Flight Controller',
        manufacturerName: diag?.device?.manufacturerName,
        vendorId: diag?.device?.vendorId,
        productId: diag?.device?.productId,
        interfaceCount: diag?.device?.interfaceCount,
        interfaceType: diag?.device?.interfaceType || diag?.interfaceType,
        driverType: diag?.device?.driverType || 'NATIVE_ANDROID_USB',
        endpointIn: diag?.endpointInNumber,
        endpointOut: diag?.endpointOutNumber,
        hasPermission: diag?.hasPermission,
        baudRate: diag?.baudRate || this.currentBaudRate,
        isUsbHostSupported: diag?.isUsbHostSupported ?? true,
        connectedDeviceCount: diag?.connectedDeviceCount ?? 1,
        lastError: diag?.lastError,
        hostPowerStatus: 'HOST_ACTIVE'
      };
    } catch (e) {
      return {
        driverType: 'NATIVE_ANDROID_USB',
        isUsbHostSupported: true,
        available: true
      };
    }
  }
}
