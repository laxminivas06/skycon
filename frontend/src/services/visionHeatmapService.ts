/**
 * AERORECON — Computer-Vision Heatmap & Object Queue Service
 * 
 * Manages:
 *  1. 4-Tier Real-Time Heatmap Data (Green: Ground, Yellow: Potential, Orange: Box, Red: QR)
 *  2. Live Registered Object Queue & Priorities (Priority 1: QR, Priority 2: Box, Priority 3: Geometry, Priority 4: Ground Object)
 *  3. Bidirectional WebSocket and REST synchronization with backend /api/vision endpoints
 */

import { fetchWithFallback } from './apiClient';
import { audioService } from './audioService';

export interface HeatmapGridData {
  timestamp: number;
  gridWidth: number;
  gridHeight: number;
  classificationGrid: number[][]; // 0=Ground, 1=Potential, 2=Box, 3=QR
  confidenceGrid: number[][];     // 0.0 to 1.0
  activeObjectsCount: number;
  droneLat?: number;
  droneLon?: number;
  droneAlt?: number;
}

export interface VisionRegisteredObject {
  object_id: string;
  category: 'QR_CANDIDATE' | 'BOX_STRUCTURE' | 'GEOMETRIC_SHAPE' | 'GROUND_OBJECT';
  shape: 'SQUARE' | 'RECTANGLE' | 'POLYGON' | 'IRREGULAR' | 'QR_PATTERN';
  priority: 1 | 2 | 3 | 4;
  confidence: number;
  bounding_box?: [number, number, number, number];
  centroid?: [number, number];
  lat?: number;
  lon?: number;
  altitude?: number;
  first_seen: number;
  last_seen: number;
  hits?: number;
  status: 'PENDING' | 'SCHEDULED' | 'INSPECTED' | 'VERIFIED';
  decoded_payload?: string;
  two_digit_code?: string;
  thumbnail?: string;
  thumbnail_base64?: string;
}

type HeatmapListener = (data: HeatmapGridData | null) => void;
type ObjectQueueListener = (objects: VisionRegisteredObject[]) => void;

class VisionHeatmapService {
  private latestHeatmap: HeatmapGridData | null = null;
  private objectQueue: VisionRegisteredObject[] = [];

  private heatmapListeners: Set<HeatmapListener> = new Set();
  private objectListeners: Set<ObjectQueueListener> = new Set();

  private pollingInterval: any = null;

  constructor() {
    this.initSocketListener();
    this.startPolling();
  }

  private initSocketListener() {
    if (typeof window === 'undefined') return;

    // Listen to custom window events dispatched by MAVLink/Relay WebSocket
    window.addEventListener('message', (event) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'HEATMAP_UPDATE_EVENT' && data.heatmap) {
          this.handleHeatmapUpdate(data.heatmap);
        } else if (data.type === 'OBJECT_QUEUE_UPDATE' && data.objects) {
          this.handleObjectsUpdate(data.objects);
        }
      } catch {}
    });

    // Listen to direct MAVLink STATUSTEXT QR Code downlink
    window.addEventListener('QR_CODE_MAVLINK_EVENT', (event: any) => {
      try {
        const detail = event.detail;
        if (detail && detail.code) {
          try { audioService.playQrSuccess(); } catch {}
          const existing = this.objectQueue.find(o => o.two_digit_code === detail.code || o.decoded_payload === detail.text);
          if (existing) {
            existing.status = 'VERIFIED';
            existing.priority = 1;
            existing.decoded_payload = detail.text;
            existing.two_digit_code = detail.code;
          } else {
            this.objectQueue.unshift({
              object_id: `MAV_${detail.code}`,
              category: 'QR_CANDIDATE',
              shape: 'QR_PATTERN',
              priority: 1,
              confidence: 1.0,
              lat: detail.lat,
              lon: detail.lon,
              first_seen: detail.timestamp || Date.now(),
              last_seen: detail.timestamp || Date.now(),
              hits: 5,
              status: 'VERIFIED',
              decoded_payload: detail.text,
              two_digit_code: detail.code
            });
          }
          this.notifyObjects();
        }
      } catch {}
    });
  }

  private startPolling() {
    if (typeof window === 'undefined') return;

    // Poll every 3 seconds for persistent telemetry & offline fallback
    this.pollingInterval = setInterval(async () => {
      await this.refreshData();
    }, 3000);

    // Initial immediate fetch
    this.refreshData();
  }

  public async refreshData(): Promise<void> {
    try {
      const [heatmapRes, objectsRes] = await Promise.all([
        fetchWithFallback('/api/vision/heatmap'),
        fetchWithFallback('/api/vision/objects'),
      ]);

      if (heatmapRes && heatmapRes.ok) {
        const heatmapData: any = await heatmapRes.json();
        if (heatmapData && heatmapData.heatmap) {
          this.handleHeatmapUpdate(heatmapData.heatmap);
        }
      }
      if (objectsRes && objectsRes.ok) {
        const objectsData: any = await objectsRes.json();
        if (objectsData && Array.isArray(objectsData.objects)) {
          this.handleObjectsUpdate(objectsData.objects);
        }
      }
    } catch {}
  }

  public handleHeatmapUpdate(raw: any) {
    if (!raw || !raw.classification_grid && !raw.classificationGrid) return;

    const formatted: HeatmapGridData = {
      timestamp: raw.timestamp || raw.serverTimestamp || Date.now(),
      gridWidth: raw.grid_width || raw.gridWidth || 48,
      gridHeight: raw.grid_height || raw.gridHeight || 36,
      classificationGrid: raw.classification_grid || raw.classificationGrid || [],
      confidenceGrid: raw.confidence_grid || raw.confidenceGrid || [],
      activeObjectsCount: raw.active_objects_count || raw.activeObjectsCount || 0,
      droneLat: raw.drone_lat || raw.droneLat,
      droneLon: raw.drone_lon || raw.droneLon,
      droneAlt: raw.drone_alt || raw.droneAlt,
    };

    this.latestHeatmap = formatted;
    this.notifyHeatmap();
  }

  public handleObjectsUpdate(objects: any[]) {
    if (!Array.isArray(objects)) return;

    const formatted: VisionRegisteredObject[] = objects.map((obj) => ({
      object_id: obj.object_id || obj.objectId || `OBJ_${Math.random().toString(36).slice(2, 6)}`,
      category: obj.category || 'GROUND_OBJECT',
      shape: obj.shape || 'SQUARE',
      priority: obj.priority || (obj.category === 'QR_CANDIDATE' ? 1 : 2),
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.75,
      bounding_box: obj.bounding_box || obj.boundingBox,
      centroid: obj.centroid,
      lat: obj.lat || (obj.targetLocation && obj.targetLocation.latitude),
      lon: obj.lon || (obj.targetLocation && obj.targetLocation.longitude),
      altitude: obj.altitude || 5.0,
      first_seen: obj.first_seen || obj.firstSeen || Date.now(),
      last_seen: obj.last_seen || obj.lastSeen || Date.now(),
      hits: obj.hits || obj.detection_count || 1,
      status: obj.status || (obj.decoded_payload ? 'VERIFIED' : 'PENDING'),
      decoded_payload: obj.decoded_payload || obj.payload,
      two_digit_code: obj.two_digit_code || obj.twoDigitCode || (obj.decoded_payload ? obj.decoded_payload.slice(0, 2) : undefined),
      thumbnail: obj.thumbnail || obj.thumbnail_base64 || obj.thumbnailDataUrl,
    }));

    // Sort: Priority 1 first, then by confidence descending
    formatted.sort((a, b) => a.priority - b.priority || b.confidence - a.confidence);

    this.objectQueue = formatted;
    this.notifyObjects();
  }

  public getLatestHeatmap(): HeatmapGridData | null {
    return this.latestHeatmap;
  }

  public getObjectQueue(): VisionRegisteredObject[] {
    return this.objectQueue;
  }

  public subscribeHeatmap(listener: HeatmapListener): () => void {
    this.heatmapListeners.add(listener);
    listener(this.latestHeatmap);
    return () => this.heatmapListeners.delete(listener);
  }

  public subscribeObjects(listener: ObjectQueueListener): () => void {
    this.objectListeners.add(listener);
    listener(this.objectQueue);
    return () => this.objectListeners.delete(listener);
  }

  private notifyHeatmap() {
    for (const listener of this.heatmapListeners) {
      try { listener(this.latestHeatmap); } catch {}
    }
  }

  private notifyObjects() {
    for (const listener of this.objectListeners) {
      try { listener(this.objectQueue); } catch {}
    }
  }
}

export const visionHeatmapService = new VisionHeatmapService();
