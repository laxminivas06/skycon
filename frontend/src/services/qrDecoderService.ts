import jsQR from 'jsqr';
import { TargetLocation, QRPayloadType } from '../types/recon';

export interface QRDecodeResult {
  text: string;
  twoDigits: string | null;
  isValidTwoDigit: boolean;
  engine: 'zxing-wasm' | 'jsQR' | 'retry-filter';
  latencyMs: number;
  points?: any;
  payloadType?: QRPayloadType;
  targetLocation?: TargetLocation | null;
}

// Lazy-loaded zxing-wasm reader to prevent blocking startup
let zxingReader: any = null;
let zxingLoadPromise: Promise<any> | null = null;

async function getZxingReader() {
  if (zxingReader) return zxingReader;
  if (!zxingLoadPromise) {
    zxingLoadPromise = import('zxing-wasm')
      .then((mod) => {
        zxingReader = mod.readBarcodesFromImageData;
        return zxingReader;
      })
      .catch((err) => {
        console.warn('⚠️ [QR ENGINE] zxing-wasm lazy load fallback to jsQR:', err);
        return null;
      });
  }
  return zxingLoadPromise;
}

// Pre-initialize zxing in background
if (typeof window !== 'undefined') {
  getZxingReader();
}

/**
 * Validates strictly against competition requirements:
 * Competition lock requires exactly 2 digits (regex ^\d{2}$)
 */
export function extractTwoDigits(text: string): { twoDigits: string | null; isValid: boolean } {
  if (!text) return { twoDigits: null, isValid: false };
  const trimmed = text.trim();

  // Strict 2-digit exact match
  if (/^\d{2}$/.test(trimmed)) {
    return { twoDigits: trimmed, isValid: true };
  }

  // Fallback: bounded 2-digit match in larger string (e.g., "TARGET-48" or "ID: 48")
  const match = trimmed.match(/(?:^|\D)(\d{2})(?:\D|$)/);
  if (match) {
    return { twoDigits: match[1], isValid: true };
  }

  return { twoDigits: null, isValid: false };
}

/**
 * Validates and extracts geographical coordinates from arbitrary QR payloads.
 * Supports:
 * - URI: geo:17.385044,78.486671 or geo:17.385044,78.486671,15
 * - JSON: {"lat": 17.385044, "lng": 78.486671} or {"latitude": 17.385044, "longitude": 78.486671}
 * - Key-Value: LAT:17.385044, LON:78.486671 or LAT:17.385044; LNG:78.486671
 * - Comma/Space separated numbers: 17.385044, 78.486671 or 17.385044,78.486671,12.5
 */
export function parseCoordinatesFromPayload(payload: string): TargetLocation | null {
  if (!payload || typeof payload !== 'string') return null;
  const trimmed = payload.trim();

  const validateCoords = (lat: number, lon: number, alt?: number): TargetLocation | null => {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90.0 ||
      Math.abs(lon) > 180.0 ||
      (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) // Exclude Null Island (0, 0)
    ) {
      return null;
    }
    return {
      latitude: parseFloat(lat.toFixed(7)),
      longitude: parseFloat(lon.toFixed(7)),
      altitude: alt && Number.isFinite(alt) ? parseFloat(alt.toFixed(2)) : undefined,
      rawCoordinateString: trimmed,
      isValid: true,
      confidence: 1.0
    };
  };

  // 1. Check geo: URI format (e.g., "geo:17.385044,78.486671" or "geo:17.385044,78.486671,12.5")
  if (trimmed.toLowerCase().startsWith('geo:')) {
    const clean = trimmed.substring(4).split('?')[0].trim();
    const parts = clean.split(',').map((p) => parseFloat(p.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const target = validateCoords(parts[0], parts[1], parts[2]);
      if (target) return target;
    }
  }

  // 2. Check JSON payload (e.g., {"lat": 17.385044, "lng": 78.486671} or {"latitude":..., "longitude":...})
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      const lat = obj.lat ?? obj.latitude ?? obj.target_lat;
      const lon = obj.lng ?? obj.lon ?? obj.longitude ?? obj.target_lon;
      const alt = obj.alt ?? obj.altitude;
      if (lat !== undefined && lon !== undefined) {
        const numLat = parseFloat(lat);
        const numLon = parseFloat(lon);
        const numAlt = alt !== undefined ? parseFloat(alt) : undefined;
        if (!isNaN(numLat) && !isNaN(numLon)) {
          const target = validateCoords(numLat, numLon, numAlt);
          if (target) return target;
        }
      }
    } catch {
      // Not valid JSON, continue to next parsers
    }
  }

  // 3. Check Key-Value syntax (e.g., "LAT:17.385044, LON:78.486671" or "lat=17.385044 lng=78.486671")
  const kvLatMatch = trimmed.match(/(?:lat|latitude)[\s:=]+([+-]?\d+(?:\.\d+)?)/i);
  const kvLonMatch = trimmed.match(/(?:lon|lng|longitude)[\s:=]+([+-]?\d+(?:\.\d+)?)/i);
  const kvAltMatch = trimmed.match(/(?:alt|altitude)[\s:=]+([+-]?\d+(?:\.\d+)?)/i);
  if (kvLatMatch && kvLonMatch) {
    const lat = parseFloat(kvLatMatch[1]);
    const lon = parseFloat(kvLonMatch[1]);
    const alt = kvAltMatch ? parseFloat(kvAltMatch[1]) : undefined;
    const target = validateCoords(lat, lon, alt);
    if (target) return target;
  }

  // 4. Check comma/whitespace separated pair (e.g. "17.385044, 78.486671" or "17.385044,78.486671,15.0")
  const commaMatch = trimmed.match(/^([+-]?\d{1,2}(?:\.\d+)?)[,\s]+([+-]?\d{1,3}(?:\.\d+)?)(?:[,\s]+([+-]?\d+(?:\.\d+)?))?$/);
  if (commaMatch) {
    const lat = parseFloat(commaMatch[1]);
    const lon = parseFloat(commaMatch[2]);
    const alt = commaMatch[3] ? parseFloat(commaMatch[3]) : undefined;
    const target = validateCoords(lat, lon, alt);
    if (target) return target;
  }

  return null;
}

/**
 * Classifies the type of QR payload and checks for valid geographical coordinates
 */
export function classifyPayload(payload: string): { type: QRPayloadType; targetLocation: TargetLocation | null } {
  if (!payload || !payload.trim()) {
    return { type: 'UNKNOWN', targetLocation: null };
  }
  const trimmed = payload.trim();

  // 1. Try parsing coordinates
  const coords = parseCoordinatesFromPayload(trimmed);
  if (coords && coords.isValid) {
    return { type: 'COORDINATES', targetLocation: coords };
  }

  // 2. Check strict 2 digits (legacy/competition target)
  const { isValid: isTwoDigit } = extractTwoDigits(trimmed);
  if (isTwoDigit) {
    return { type: 'TWO_DIGIT', targetLocation: null };
  }

  // 3. Check URL
  if (/^https?:\/\/[^\s$.?#].[^\s]*$/i.test(trimmed)) {
    return { type: 'URL', targetLocation: null };
  }

  // 4. Check JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      JSON.parse(trimmed);
      return { type: 'JSON', targetLocation: null };
    } catch {}
  }

  return { type: 'TEXT', targetLocation: null };
}

/**
 * High-performance Dual-Engine QR Decoder:
 * 1. Primary: zxing-wasm (C++ SIMD WebAssembly - handles motion blur, rotation, tilt, inversion)
 * 2. Secondary: jsQR (pure JS fallback)
 */
export async function decodeQRFromImageData(imageData: ImageData): Promise<QRDecodeResult | null> {
  const t0 = performance.now();

  // 1. Primary Engine: zxing-wasm
  try {
    const reader = await getZxingReader();
    if (reader) {
      const results = await reader(imageData, {
        formats: ['QRCode'],
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        tryDownscale: true
      });

      if (results && results.length > 0 && results[0].text) {
        const text = results[0].text.trim();
        const { twoDigits, isValid } = extractTwoDigits(text);
        const { type: payloadType, targetLocation } = classifyPayload(text);

        return {
          text,
          twoDigits,
          isValidTwoDigit: isValid,
          engine: 'zxing-wasm',
          latencyMs: +(performance.now() - t0).toFixed(1),
          points: results[0].position,
          payloadType,
          targetLocation
        };
      }
    }
  } catch (err) {
    // Graceful fallback to jsQR
  }

  // 2. Secondary Engine: jsQR
  try {
    const qr = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth'
    });

    if (qr && qr.data && qr.data.trim()) {
      const text = qr.data.trim();
      const { twoDigits, isValid } = extractTwoDigits(text);
      const { type: payloadType, targetLocation } = classifyPayload(text);

      return {
        text,
        twoDigits,
        isValidTwoDigit: isValid,
        engine: 'jsQR',
        latencyMs: +(performance.now() - t0).toFixed(1),
        points: qr.location,
        payloadType,
        targetLocation
      };
    }
  } catch {
    // Neither engine found valid QR in initial pass
  }

  return null;
}

/**
 * Image Processing Retry Pipeline for Saved Captured Photos:
 * Applies software image enhancements to an undecodable saved photo:
 * 1. Contrast Normalization (Histogram stretch)
 * 2. Grayscale Adaptive Binarization
 * 3. Color Inversion
 * 4. High-pass Sharpening
 * Note: Operates ONLY on the captured image buffer; NEVER zooms the live camera!
 */
export async function retryDecodeImage(sourceImageData: ImageData): Promise<QRDecodeResult | null> {
  const width = sourceImageData.width;
  const height = sourceImageData.height;
  const totalPixels = width * height;

  // Filter 1: Contrast Stretch & Histogram Equalization
  const contrastData = new ImageData(new Uint8ClampedArray(sourceImageData.data), width, height);
  let minLum = 255;
  let maxLum = 0;

  for (let i = 0; i < contrastData.data.length; i += 4) {
    const lum = 0.299 * contrastData.data[i] + 0.587 * contrastData.data[i + 1] + 0.114 * contrastData.data[i + 2];
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const range = Math.max(1, maxLum - minLum);
  for (let i = 0; i < contrastData.data.length; i += 4) {
    const lum = 0.299 * contrastData.data[i] + 0.587 * contrastData.data[i + 1] + 0.114 * contrastData.data[i + 2];
    const stretched = Math.min(255, Math.max(0, ((lum - minLum) / range) * 255));
    contrastData.data[i] = stretched;
    contrastData.data[i + 1] = stretched;
    contrastData.data[i + 2] = stretched;
  }

  let result = await decodeQRFromImageData(contrastData);
  if (result) {
    result.engine = 'retry-filter';
    return result;
  }

  // Filter 2: Otsu / Adaptive Binarization (High Contrast Black & White)
  const binarizedData = new ImageData(new Uint8ClampedArray(contrastData.data), width, height);
  const midThreshold = (minLum + maxLum) / 2;

  for (let i = 0; i < binarizedData.data.length; i += 4) {
    const lum = binarizedData.data[i];
    const val = lum >= midThreshold ? 255 : 0;
    binarizedData.data[i] = val;
    binarizedData.data[i + 1] = val;
    binarizedData.data[i + 2] = val;
  }

  result = await decodeQRFromImageData(binarizedData);
  if (result) {
    result.engine = 'retry-filter';
    return result;
  }

  // Filter 3: Inversion (White QR on dark ground)
  const invertedData = new ImageData(new Uint8ClampedArray(binarizedData.data), width, height);
  for (let i = 0; i < invertedData.data.length; i += 4) {
    invertedData.data[i] = 255 - invertedData.data[i];
    invertedData.data[i + 1] = 255 - invertedData.data[i + 1];
    invertedData.data[i + 2] = 255 - invertedData.data[i + 2];
  }

  result = await decodeQRFromImageData(invertedData);
  if (result) {
    result.engine = 'retry-filter';
    return result;
  }

  // Filter 4: Sharpening (Laplacian 3x3 kernel)
  const sharpenedData = new ImageData(new Uint8ClampedArray(sourceImageData.data), width, height);
  const src = sourceImageData.data;
  const dst = sharpenedData.data;

  // Kernel:
  //  0 -1  0
  // -1  5 -1
  //  0 -1  0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const val =
          5 * src[idx + c] -
          src[((y - 1) * width + x) * 4 + c] -
          src[((y + 1) * width + x) * 4 + c] -
          src[(y * width + (x - 1)) * 4 + c] -
          src[(y * width + (x + 1)) * 4 + c];
        dst[idx + c] = Math.min(255, Math.max(0, val));
      }
    }
  }

  result = await decodeQRFromImageData(sharpenedData);
  if (result) {
    result.engine = 'retry-filter';
    return result;
  }

  return null;
}
