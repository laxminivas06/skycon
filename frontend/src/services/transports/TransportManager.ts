import { Capacitor } from '@capacitor/core';
import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';
import { AndroidUsbTransport } from './AndroidUsbTransport';
import { IosUsbTransport } from './IosUsbTransport';
import { WebSerialTransport } from './WebSerialTransport';
import { WebUsbTransport } from './WebUsbTransport';
import { UdpTransport } from './UdpTransport';
import { SimulatorTransport } from './SimulatorTransport';
import { Esp32WebSocketTransport } from './Esp32WebSocketTransport';

export class TransportManager {
  private transports: Map<string, MavlinkTransport> = new Map();
  private activeTransport: MavlinkTransport;
  private esp32Transport: Esp32WebSocketTransport;
  
  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();
  
  private currentUnsubData?: () => void;
  private currentUnsubState?: () => void;

  constructor() {
    const androidUsb = new AndroidUsbTransport();
    const iosUsb = new IosUsbTransport();
    const webSerial = new WebSerialTransport();
    const webUsb = new WebUsbTransport();
    const udp = new UdpTransport();
    const sim = new SimulatorTransport();
    const esp32 = new Esp32WebSocketTransport();

    this.esp32Transport = esp32;

    this.transports.set(androidUsb.id, androidUsb);
    this.transports.set(iosUsb.id, iosUsb);
    this.transports.set(webSerial.id, webSerial);
    this.transports.set(webUsb.id, webUsb);
    this.transports.set(udp.id, udp);
    this.transports.set(esp32.id, esp32);
    this.transports.set(sim.id, sim);

    // Auto-select primary transport based on environment
    const savedMethod = typeof window !== 'undefined' ? localStorage.getItem('preferred_connection_method') : null;
    if (Capacitor.isNativePlatform()) {
      if (savedMethod === 'ESP32') {
        this.activeTransport = esp32;
      } else if (Capacitor.getPlatform() === 'android') {
        this.activeTransport = androidUsb;
      } else if (Capacitor.getPlatform() === 'ios') {
        this.activeTransport = iosUsb;
      } else {
        this.activeTransport = androidUsb;
      }
    } else {
      if (savedMethod === 'USB' && webSerial.isAvailable()) {
        this.activeTransport = webSerial;
      } else if (savedMethod === 'USB' && webUsb.isAvailable()) {
        this.activeTransport = webUsb;
      } else {
        this.activeTransport = esp32;
      }
    }

    this.bindActiveTransport();
  }

  private bindActiveTransport() {
    if (this.currentUnsubData) this.currentUnsubData();
    if (this.currentUnsubState) this.currentUnsubState();

    this.currentUnsubData = this.activeTransport.subscribeData((chunk) => {
      this.dataListeners.forEach((fn) => fn(chunk));
    });

    this.currentUnsubState = this.activeTransport.subscribeState((event) => {
      this.stateListeners.forEach((fn) => fn(event));
    });
  }

  public getActiveTransport(): MavlinkTransport {
    return this.activeTransport;
  }

  public getAvailableTransports(): MavlinkTransport[] {
    return Array.from(this.transports.values()).filter((t) => t.isAvailable());
  }

  public getAllTransports(): MavlinkTransport[] {
    return Array.from(this.transports.values());
  }

  public setTransport(id: string): boolean {
    const next = this.transports.get(id);
    if (!next) return false;
    if (this.activeTransport.id === id) return true;

    this.activeTransport.disconnect();
    this.activeTransport = next;
    this.bindActiveTransport();
    return true;
  }

  public async connect(options?: { baudRate?: number; host?: string; port?: number }): Promise<boolean> {
    return this.activeTransport.connect(options);
  }

  public async disconnect(): Promise<void> {
    return this.activeTransport.disconnect();
  }

  public async send(data: Uint8Array): Promise<boolean> {
    return this.activeTransport.send(data);
  }

  public async scanUsbDevices(): Promise<any[]> {
    if (this.activeTransport instanceof AndroidUsbTransport) {
      return (this.activeTransport as AndroidUsbTransport).scanDevices();
    }
    return [];
  }

  public async requestUsbPermission(): Promise<boolean> {
    if (this.activeTransport instanceof AndroidUsbTransport) {
      return (this.activeTransport as AndroidUsbTransport).requestUsbPermission();
    }
    return false;
  }

  public async getDiagnostics(): Promise<Record<string, any>> {
    return this.activeTransport.getDiagnostics();
  }

  public getEsp32Transport(): Esp32WebSocketTransport {
    return this.esp32Transport;
  }

  public async connectEsp32(options?: import('./Esp32WebSocketTransport').Esp32WebSocketOptions): Promise<boolean> {
    this.setTransport('esp32_websocket');
    return this.activeTransport.connect(options);
  }

  public subscribeData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public subscribeState(listener: (event: TransportStateEvent) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }
}

export const transportManager = new TransportManager();
