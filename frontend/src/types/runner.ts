// Drone <-> Runner Wireless Link Protocol

export type RunnerMessageType =
  | 'PING'
  | 'PONG'
  | 'QR_DISPATCH'
  | 'QR_ACK'
  | 'RUNNER_STATUS';

export interface DroneQRDispatchPayload {
  type: 'QR_DISPATCH';
  missionId: string;
  messageId: string;
  detectionId?: string;
  qrCode: string; // Decoded QR payload (arbitrary string or 2-digit)
  timestamp: number;
  altitudeMeters?: number;
  droneBatteryPercent?: number;
  droneLatitude?: number;
  droneLongitude?: number;
  gpsFixValid?: boolean;
  status?: string;
  photoDataUrl?: string;
  thumbnailDataUrl?: string;
  rtlInitiated?: boolean;
  rtlConfirmed?: boolean;
}

export interface RunnerAckPayload {
  type: 'QR_ACK';
  missionId: string;
  messageId: string;
  received: boolean;
  qrCodeConfirmed: string;
  runnerBatteryPercent: number;
  timestamp: number;
  ackLatencyMs?: number;
}

export interface RunnerLinkState {
  isConnected: boolean;
  channel: string;
  peerId: string;
  signalStrengthDbm: number; // e.g. -45 dBm
  lastPingTime: number;
  lastAckTime?: number;
  packetsSent: number;
  packetsReceived: number;
  latestReceivedQR?: string;
  latestAckDispatched?: boolean;
}
