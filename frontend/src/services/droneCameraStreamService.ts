/**
 * SAE INDIA AUTONOMOUS DRONE — DRONE CORE TO GROUND STATION CAMERA STREAM SERVICE
 * 
 * Provides direct, automatic video transmission from the Drone Core optical sensor
 * to the Ground Station (GCS) camera panel without requiring any IP camera,
 * RTSP URL, or manual IP configuration.
 * 
 * Transport Architecture:
 * 1. Hybrid WebRTC P2P (Low-Latency H.264/VP8 hardware media stream)
 * 2. Real-Time WebSocket Frame Fallback (Continuous 15 FPS compressed JPEG frames)
 * 3. Local BroadcastChannel (0ms same-origin tab/window/PWA/Capacitor synchronization)
 */

export type DroneCameraStreamStatus =
  | 'WAITING_FOR_CAMERA'   // "Waiting for Drone Core Camera"
  | 'CONNECTING'           // "Connecting to Drone Core"
  | 'LIVE_FEED_CONNECTED'  // "Live Feed Connected"
  | 'CAMERA_OFFLINE'       // "Camera Offline"
  | 'CONNECTION_LOST';     // "Connection Lost"

export interface CameraStreamPayload {
  type: 'CAMERA_STREAM_SIGNAL' | 'CAMERA_FRAME_DATA' | 'CAMERA_STATUS_UPDATE' | 'CAMERA_HEARTBEAT' | 'CAMERA_STATUS_REQUEST';
  senderRole?: 'DRONE' | 'GROUND_STATION';
  isCameraActive?: boolean;
  status?: string;
  frame?: string;
  width?: number;
  height?: number;
  timestamp: number;
  signalData?: any;
}

type StreamListener = (stream: MediaStream | null) => void;
type FrameListener = (frameUrl: string | null) => void;
type StatusListener = (status: DroneCameraStreamStatus, message: string) => void;

const BROADCAST_CHANNEL_NAME = 'DRONE_CORE_CAMERA_STREAM_CHANNEL';
const RELAY_TOKEN_DEFAULT = 'saeindia_sec_99348a7b1c0e';
const DEFAULT_SECURE_RELAY_URL = 'wss://seasphndrone-backend.onrender.com/ws';

class DroneCameraStreamService {
  private channel: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private isWsConnecting: boolean = false;

  // Listeners
  private streamListeners: Set<StreamListener> = new Set();
  private frameListeners: Set<FrameListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();

  // State
  private currentStatus: DroneCameraStreamStatus = 'WAITING_FOR_CAMERA';
  private statusMessage: string = 'Waiting for Drone Core Camera';
  private latestRemoteStream: MediaStream | null = null;
  private latestFrameUrl: string | null = null;

  // Publisher State (Drone Core)
  private isPublishing: boolean = false;
  private publisherPc: RTCPeerConnection | null = null;
  private frameCaptureTimer: any = null;
  private heartbeatTimer: any = null;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;
  private activeVideoElement: HTMLVideoElement | null = null;
  private activeStream: MediaStream | null = null;

  // Subscriber State (Ground Station)
  private isSubscribing: boolean = false;
  private subscriberPc: RTCPeerConnection | null = null;
  private watchdogTimer: any = null;
  private lastFrameTimestamp: number = 0;
  private lastHeartbeatTimestamp: number = 0;
  private lastStatusUpdate: { isCameraActive: boolean; status: string; timestamp: number } | null = null;
  private hadLiveConnection: boolean = false;

  constructor() {
    this.initBroadcastChannel();
    this.initWebSocket();
  }

  // ==========================================================================
  // COMMUNICATION CHANNELS SETUP
  // ==========================================================================

  private initBroadcastChannel() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.channel.onmessage = (event: MessageEvent) => {
          this.handleIncomingPayload(event.data);
        };
      } catch (err) {
        console.warn('[CAMERA STREAM] BroadcastChannel unavailable:', err);
      }
    }
  }

  private getRelayWebSocketUrl(): string {
    if (typeof window === 'undefined') return '';
    const envUrl = (import.meta as any).env?.VITE_SECURE_RELAY_URL || (import.meta as any).env?.VITE_ESP32_WS_URL;
    const token = (import.meta as any).env?.VITE_RELAY_TOKEN || RELAY_TOKEN_DEFAULT;

    if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
      let url = envUrl.trim().replace(/^http/i, 'ws');
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}token=${encodeURIComponent(token)}`;
    }

    const loc = window.location;
    // On HTTPS (e.g. Netlify deployment), browsers require WSS and Netlify cannot host WebSockets directly.
    // Connect to the deployed Render Cloud Relay:
    if (loc.protocol === 'https:' || loc.hostname.includes('netlify.app')) {
      const sep = DEFAULT_SECURE_RELAY_URL.includes('?') ? '&' : '?';
      return `${DEFAULT_SECURE_RELAY_URL}${sep}token=${encodeURIComponent(token)}`;
    }

    // Local Development: connect to backend server on port 8443 (or Render relay as fallback)
    const host = loc.hostname || '127.0.0.1';
    return `ws://${host}:8443/ws?token=${encodeURIComponent(token)}`;
  }

  private initWebSocket() {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isWsConnecting = true;
    try {
      const url = this.getRelayWebSocketUrl();
      if (!url) return;

      const ws = new WebSocket(url);

      ws.onopen = () => {
        this.isWsConnecting = false;
        console.log('[CAMERA STREAM WS] Connected to relay server');
        if (this.isPublishing && this.activeStream) {
          this.sendPayload({
            type: 'CAMERA_STATUS_UPDATE',
            isCameraActive: true,
            status: 'LIVE',
            timestamp: Date.now()
          });
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const parsed = JSON.parse(event.data);
            this.handleIncomingPayload(parsed);
          } catch (e) {}
        }
      };

      ws.onclose = () => {
        this.isWsConnecting = false;
        this.scheduleWsReconnect();
      };

      ws.onerror = () => {
        this.isWsConnecting = false;
        try { ws.close(); } catch (e) {}
      };

      this.ws = ws;
    } catch (err) {
      this.isWsConnecting = false;
      this.scheduleWsReconnect();
    }
  }

  private scheduleWsReconnect() {
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    this.wsReconnectTimer = setTimeout(() => {
      this.initWebSocket();
    }, 2500);
  }

  private sendPayload(payload: CameraStreamPayload) {
    const raw = JSON.stringify(payload);
    // 1. Broadcast locally (same origin tabs/windows)
    if (this.channel) {
      try {
        this.channel.postMessage(payload);
      } catch (e) {}
    }

    // 2. Transmit over WebSocket relay across devices
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(raw);
      } catch (e) {}
    }
  }

  // ==========================================================================
  // PUBLISHER: DRONE CORE SENDER LOGIC
  // ==========================================================================

  public startPublishing(stream: MediaStream | null, videoElement: HTMLVideoElement | null) {
    this.isPublishing = true;
    this.activeStream = stream;
    this.activeVideoElement = videoElement;

    console.log('[CAMERA STREAM] Starting Drone Core stream publishing...');

    // 1. Notify that Drone Core camera is ON
    this.sendPayload({
      type: 'CAMERA_STATUS_UPDATE',
      senderRole: 'DRONE',
      isCameraActive: true,
      status: 'LIVE',
      timestamp: Date.now()
    });

    // 2. Start Periodic Heartbeat
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.isPublishing && this.activeStream) {
        this.sendPayload({
          type: 'CAMERA_HEARTBEAT',
          senderRole: 'DRONE',
          isCameraActive: true,
          timestamp: Date.now()
        });
      }
    }, 1000);

    // 3. Initialize WebRTC Publisher Peer
    this.initPublisherPeerConnection(stream);

    // 4. Start Frame Capture Loop for Direct Streaming Fallback
    this.startFrameCaptureLoop();
  }

  public stopPublishing() {
    this.isPublishing = false;
    this.activeStream = null;
    this.activeVideoElement = null;

    if (this.frameCaptureTimer) {
      clearInterval(this.frameCaptureTimer);
      this.frameCaptureTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.publisherPc) {
      try {
        this.publisherPc.close();
      } catch (e) {}
      this.publisherPc = null;
    }

    // Broadcast Camera OFF update
    this.sendPayload({
      type: 'CAMERA_STATUS_UPDATE',
      senderRole: 'DRONE',
      isCameraActive: false,
      status: 'OFFLINE',
      timestamp: Date.now()
    });

    console.log('[CAMERA STREAM] Stopped Drone Core stream publishing.');
  }

  private initPublisherPeerConnection(stream: MediaStream | null) {
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined' || !stream) {
      return;
    }

    try {
      if (this.publisherPc) {
        try { this.publisherPc.close(); } catch (e) {}
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Add camera tracks to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendPayload({
            type: 'CAMERA_STREAM_SIGNAL',
            senderRole: 'DRONE',
            timestamp: Date.now(),
            signalData: { candidate: event.candidate }
          });
        }
      };

      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sendPayload({
            type: 'CAMERA_STREAM_SIGNAL',
            senderRole: 'DRONE',
            timestamp: Date.now(),
            signalData: { sdp: pc.localDescription }
          });
        } catch (err) {
          console.warn('[CAMERA WEBRTC] Error creating offer:', err);
        }
      };

      this.publisherPc = pc;
    } catch (err) {
      console.warn('[CAMERA WEBRTC] PeerConnection setup failed, using frame streaming:', err);
    }
  }

  private startFrameCaptureLoop() {
    if (typeof document === 'undefined') return;
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (this.frameCaptureTimer) clearInterval(this.frameCaptureTimer);

    // 15 FPS frame streaming loop (~66ms interval)
    this.frameCaptureTimer = setInterval(() => {
      if (!this.isPublishing || !this.activeVideoElement || !this.offscreenCanvas || !this.offscreenCtx) {
        return;
      }

      const video = this.activeVideoElement;
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        return;
      }

      // Downscale to 640x360 for high visual fidelity with ultra-low latency & bandwidth
      const targetWidth = 640;
      const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth) || 360;

      if (this.offscreenCanvas.width !== targetWidth || this.offscreenCanvas.height !== targetHeight) {
        this.offscreenCanvas.width = targetWidth;
        this.offscreenCanvas.height = targetHeight;
      }

      try {
        this.offscreenCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
        const dataUrl = this.offscreenCanvas.toDataURL('image/jpeg', 0.60);

        this.sendPayload({
          type: 'CAMERA_FRAME_DATA',
          senderRole: 'DRONE',
          frame: dataUrl,
          width: targetWidth,
          height: targetHeight,
          timestamp: Date.now()
        });
      } catch (err) {}
    }, 66);
  }

  public captureAndSendSingleFrame() {
    if (!this.isPublishing || !this.activeVideoElement || !this.offscreenCanvas || !this.offscreenCtx) return;
    const video = this.activeVideoElement;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
    const targetWidth = 640;
    const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth) || 360;
    if (this.offscreenCanvas.width !== targetWidth || this.offscreenCanvas.height !== targetHeight) {
      this.offscreenCanvas.width = targetWidth;
      this.offscreenCanvas.height = targetHeight;
    }
    try {
      this.offscreenCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
      const dataUrl = this.offscreenCanvas.toDataURL('image/jpeg', 0.60);
      this.sendPayload({
        type: 'CAMERA_FRAME_DATA',
        senderRole: 'DRONE',
        frame: dataUrl,
        width: targetWidth,
        height: targetHeight,
        timestamp: Date.now()
      });
    } catch (err) {}
  }

  // ==========================================================================
  // SUBSCRIBER: GROUND STATION RECEIVER LOGIC
  // ==========================================================================

  public startSubscribing() {
    this.isSubscribing = true;
    console.log('[CAMERA STREAM] Ground Station subscribed to Drone Core camera feed.');

    // Query active publisher for instant feed synchronization
    this.sendPayload({
      type: 'CAMERA_STATUS_REQUEST',
      senderRole: 'GROUND_STATION',
      timestamp: Date.now()
    });

    // Start watchdog for connection liveness
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      this.checkSubscriberLiveness();
    }, 500);

    this.checkSubscriberLiveness();
  }

  public stopSubscribing() {
    this.isSubscribing = false;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.subscriberPc) {
      try { this.subscriberPc.close(); } catch (e) {}
      this.subscriberPc = null;
    }
  }

  private handleIncomingPayload(msg: any) {
    if (!msg || typeof msg !== 'object' || !msg.type) return;

    // 0. Query from Ground Station asking for immediate status & frame
    if (msg.type === 'CAMERA_STATUS_REQUEST') {
      if (this.isPublishing && this.activeStream) {
        this.sendPayload({
          type: 'CAMERA_STATUS_UPDATE',
          senderRole: 'DRONE',
          isCameraActive: true,
          status: 'LIVE',
          timestamp: Date.now()
        });
        this.captureAndSendSingleFrame();
      }
      return;
    }

    // 1. Frame Data Arrival
    if (msg.type === 'CAMERA_FRAME_DATA' && msg.frame) {
      this.lastFrameTimestamp = Date.now();
      this.hadLiveConnection = true;
      this.latestFrameUrl = msg.frame;
      this.updateStatus('LIVE_FEED_CONNECTED', 'Live Feed Connected');
      this.notifyFrame(msg.frame);
      return;
    }

    // 2. Status Updates (Drone turned Camera ON or OFF)
    if (msg.type === 'CAMERA_STATUS_UPDATE') {
      this.lastStatusUpdate = {
        isCameraActive: Boolean(msg.isCameraActive),
        status: msg.status || 'UNKNOWN',
        timestamp: Date.now()
      };

      if (!msg.isCameraActive) {
        this.latestFrameUrl = null;
        this.latestRemoteStream = null;
        this.notifyStream(null);
        this.notifyFrame(null);
        this.updateStatus('CAMERA_OFFLINE', 'Camera Offline');
      } else {
        if (!this.latestFrameUrl && !this.latestRemoteStream) {
          this.updateStatus('CONNECTING', 'Connecting to Drone Core');
        }
      }
      return;
    }

    // 3. Heartbeats
    if (msg.type === 'CAMERA_HEARTBEAT') {
      this.lastHeartbeatTimestamp = Date.now();
      if (!this.latestFrameUrl && !this.latestRemoteStream) {
        this.updateStatus('CONNECTING', 'Connecting to Drone Core');
      }
      return;
    }

    // 4. WebRTC Signals (Offer / Candidate)
    if (msg.type === 'CAMERA_STREAM_SIGNAL' && msg.signalData) {
      this.handleWebRTCSignal(msg.signalData);
    }
  }

  private async handleWebRTCSignal(signalData: any) {
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') return;

    try {
      if (signalData.sdp && signalData.sdp.type === 'offer') {
        if (this.subscriberPc) {
          try { this.subscriberPc.close(); } catch (e) {}
        }

        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        });

        pc.ontrack = (event) => {
          if (event.streams && event.streams[0]) {
            this.latestRemoteStream = event.streams[0];
            this.lastFrameTimestamp = Date.now();
            this.hadLiveConnection = true;
            this.updateStatus('LIVE_FEED_CONNECTED', 'Live Feed Connected');
            this.notifyStream(this.latestRemoteStream);
          }
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            this.sendPayload({
              type: 'CAMERA_STREAM_SIGNAL',
              senderRole: 'GROUND_STATION',
              timestamp: Date.now(),
              signalData: { candidate: event.candidate }
            });
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.sendPayload({
          type: 'CAMERA_STREAM_SIGNAL',
          senderRole: 'GROUND_STATION',
          timestamp: Date.now(),
          signalData: { sdp: pc.localDescription }
        });

        this.subscriberPc = pc;
      } else if (signalData.sdp && signalData.sdp.type === 'answer' && this.publisherPc) {
        await this.publisherPc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
      } else if (signalData.candidate) {
        const targetPc = this.isPublishing ? this.publisherPc : this.subscriberPc;
        if (targetPc && targetPc.remoteDescription) {
          await targetPc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
        }
      }
    } catch (err) {
      console.warn('[CAMERA WEBRTC] Signal negotiation error:', err);
    }
  }

  private checkSubscriberLiveness() {
    if (!this.isSubscribing) return;
    const now = Date.now();
    const frameAge = now - this.lastFrameTimestamp;
    const heartbeatAge = now - this.lastHeartbeatTimestamp;

    // A. Active Frames arriving
    if (this.lastFrameTimestamp > 0 && frameAge < 3500) {
      this.updateStatus('LIVE_FEED_CONNECTED', 'Live Feed Connected');
      return;
    }

    // B. Explicit Camera OFF
    if (this.lastStatusUpdate && !this.lastStatusUpdate.isCameraActive) {
      this.updateStatus('CAMERA_OFFLINE', 'Camera Offline');
      return;
    }

    // C. Heartbeat arriving but frames not yet arrived
    if (this.lastHeartbeatTimestamp > 0 && heartbeatAge < 3500) {
      this.updateStatus('CONNECTING', 'Connecting to Drone Core');
      return;
    }

    // D. Link timed out after having been live
    if (this.hadLiveConnection && (frameAge >= 3500 || heartbeatAge >= 3500)) {
      this.updateStatus('CONNECTION_LOST', 'Connection Lost');
      return;
    }

    // E. Initial state: waiting for drone camera
    this.updateStatus('WAITING_FOR_CAMERA', 'Waiting for Drone Core Camera');
  }

  private updateStatus(newStatus: DroneCameraStreamStatus, message: string) {
    if (this.currentStatus !== newStatus || this.statusMessage !== message) {
      this.currentStatus = newStatus;
      this.statusMessage = message;
      this.notifyStatus(newStatus, message);
    }
  }

  // ==========================================================================
  // SUBSCRIPTION LISTENERS
  // ==========================================================================

  public subscribeStatus(fn: StatusListener) {
    this.statusListeners.add(fn);
    fn(this.currentStatus, this.statusMessage);
    return () => this.statusListeners.delete(fn);
  }

  public subscribeStream(fn: StreamListener) {
    this.streamListeners.add(fn);
    fn(this.latestRemoteStream);
    return () => this.streamListeners.delete(fn);
  }

  public subscribeFrame(fn: FrameListener) {
    this.frameListeners.add(fn);
    fn(this.latestFrameUrl);
    return () => this.frameListeners.delete(fn);
  }

  private notifyStatus(status: DroneCameraStreamStatus, msg: string) {
    this.statusListeners.forEach((fn) => fn(status, msg));
  }

  private notifyStream(stream: MediaStream | null) {
    this.streamListeners.forEach((fn) => fn(stream));
  }

  private notifyFrame(frameUrl: string | null) {
    this.frameListeners.forEach((fn) => fn(frameUrl));
  }

  public getStatus(): { status: DroneCameraStreamStatus; message: string } {
    return { status: this.currentStatus, message: this.statusMessage };
  }

  public getCurrentStatus(): DroneCameraStreamStatus {
    return this.currentStatus;
  }

  public getLatestFrame(): string | null {
    return this.latestFrameUrl;
  }

  public getLatestStream(): MediaStream | null {
    return this.latestRemoteStream;
  }

  public getMediaStream(): MediaStream | null {
    return this.latestRemoteStream;
  }
}

export const droneCameraStreamService = new DroneCameraStreamService();
