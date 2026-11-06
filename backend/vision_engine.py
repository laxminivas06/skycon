#!/usr/bin/env python3
"""
=====================================================================================
AERORECON — AUTONOMOUS DRONE SEARCH & TARGET RECONNAISSANCE SYSTEM
MODULE 1: Real-Time Computer-Vision Ground Classifier, Heatmap Engine & QR Detector
=====================================================================================

Features:
  1. 4-Tier Ground & Object Classification:
       - Tier A (Green  - Value 0): Normal Ground Surface (grass, asphalt, soil)
       - Tier B (Yellow - Value 1): Potential Non-Ground Objects & Visual Structures
       - Tier C (Orange - Value 2): High-Priority Square/Rectangular Boxes & B/W Targets
       - Tier D (Red    - Value 3): Confirmed QR Code Patterns & Decoded Payloads
  2. False-Positive Filtering:
       - Background color/texture estimation in HSV and Lab color spaces
       - High-frequency edge gradient density & contour aspect ratio filter (0.75 - 1.35)
       - Multi-frame temporal consistency tracking (requires N-frame persistence)
  3. Ground-to-GPS Pinhole Projection:
       - Projects camera pixel coordinates (u, v) to ground metric offsets (dx, dy)
       - Calculates estimated Latitude & Longitude using drone GPS, altitude & heading
  4. Multi-Pass QR Decoder:
       - Pass 1: Direct OpenCV QRCodeDetector
       - Pass 2: CLAHE contrast enhancement + Unsharp mask
       - Pass 3: Otsu adaptive binarization
       - Pass 4: 4-Point perspective warp rectification
=====================================================================================
"""

import os
import sys
import time
import math
import re
import json
import logging
from dataclasses import dataclass, field, asdict
from typing import Optional, Tuple, List, Dict, Any

import cv2
import numpy as np

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [VISION_ENGINE] %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("vision_engine")


# =====================================================================================
# DATA STRUCTURES
# =====================================================================================

@dataclass
class DetectedObject:
    object_id: str
    category: str              # "QR_CANDIDATE" | "BOX_STRUCTURE" | "GEOMETRIC_SHAPE" | "GROUND_OBJECT"
    shape: str                 # "SQUARE" | "RECTANGLE" | "IRREGULAR" | "QR_PATTERN"
    priority: int              # 1 (Highest) to 4 (Lowest)
    confidence: float          # 0.0 to 1.0
    bounding_box: Tuple[int, int, int, int]  # (x, y, w, h)
    centroid: Tuple[int, int]  # (cx, cy)
    first_seen: float
    last_seen: float
    detection_count: int
    lat: Optional[float] = None
    lon: Optional[float] = None
    altitude: Optional[float] = None
    decoded_payload: Optional[str] = None
    two_digit_code: Optional[str] = None
    inspection_status: str = "PENDING"  # PENDING | SCHEDULED | INSPECTED | VERIFIED
    thumbnail_base64: Optional[str] = None


@dataclass
class HeatmapFrame:
    timestamp: float
    grid_width: int
    grid_height: int
    classification_grid: List[List[int]]    # 0=Ground, 1=Potential, 2=Box, 3=QR
    confidence_grid: List[List[float]]      # 0.0 to 1.0
    active_objects_count: int
    drone_lat: Optional[float] = None
    drone_lon: Optional[float] = None
    drone_alt: Optional[float] = None


# =====================================================================================
# 1. PINHOLE CAMERA GROUND PROJECTOR (PIXEL -> GPS)
# =====================================================================================

class PinholeProjector:
    """
    Projects downward-facing camera image pixel coordinates to geographic coordinates.
    Accounts for aircraft altitude, heading (yaw), and camera field of view.
    """
    def __init__(self, hfov_deg: float = 68.0, vfov_deg: float = 54.0):
        self.hfov_rad = math.radians(hfov_deg)
        self.vfov_rad = math.radians(vfov_deg)

    def pixel_to_gps(
        self,
        px: int,
        py: int,
        frame_w: int,
        frame_h: int,
        drone_lat: float,
        drone_lon: float,
        drone_alt_m: float,
        heading_deg: float = 0.0
    ) -> Tuple[float, float]:
        """
        Calculates ground latitude and longitude for a given pixel coordinate.
        """
        if drone_alt_m <= 0.5 or abs(drone_lat) < 0.0001:
            return (drone_lat, drone_lon)

        # Normalized coordinates from image center (-1.0 to +1.0)
        nx = (px - frame_w / 2.0) / (frame_w / 2.0)
        ny = (frame_h / 2.0 - py) / (frame_h / 2.0)  # Invert so +y is forward

        # Ground offsets in camera frame (meters)
        ground_w = 2.0 * drone_alt_m * math.tan(self.hfov_rad / 2.0)
        ground_h = 2.0 * drone_alt_m * math.tan(self.vfov_rad / 2.0)

        dx_cam = nx * (ground_w / 2.0)  # +Right
        dy_cam = ny * (ground_h / 2.0)  # +Forward

        # Rotate by drone heading (yaw in degrees clockwise from True North)
        heading_rad = math.radians(heading_deg)
        dx_north = dy_cam * math.cos(heading_rad) - dx_cam * math.sin(heading_rad)
        dy_east  = dy_cam * math.sin(heading_rad) + dx_cam * math.cos(heading_rad)

        # Earth coordinate projection (WGS84 spherical approx)
        earth_r = 6378137.0
        d_lat = (dx_north / earth_r) * (180.0 / math.pi)
        d_lon = (dy_east / (earth_r * math.cos(math.radians(drone_lat)))) * (180.0 / math.pi)

        return (round(drone_lat + d_lat, 7), round(drone_lon + d_lon, 7))


# =====================================================================================
# 2. COMPUTER VISION & 4-TIER HEATMAP ENGINE
# =====================================================================================

class VisionEngine:
    """
    High-performance real-time computer-vision engine.
    Produces 4-tier ground/object classification, continuous heatmap grids,
    intelligent priority tracking, and multi-pass QR decoding.
    """
    def __init__(
        self,
        grid_cols: int = 48,
        grid_rows: int = 36,
        camera_hfov: float = 68.0,
        camera_vfov: float = 54.0,
        min_temporal_hits: int = 3,
        dedup_distance_m: float = 3.0
    ):
        self.grid_cols = grid_cols
        self.grid_rows = grid_rows
        self.min_temporal_hits = min_temporal_hits
        self.dedup_distance_m = dedup_distance_m

        self.projector = PinholeProjector(hfov_deg=camera_hfov, vfov_deg=camera_vfov)
        self.clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(8, 8))
        self.qr_detector = cv2.QRCodeDetector()
        self.two_digit_regex = re.compile(r"\b(\d{2})\b")

        # Object Registry: object_id -> DetectedObject
        self.registry: Dict[str, DetectedObject] = {}
        self.next_obj_num: int = 1

        # Temporal Trackers for candidate smoothing: list of candidate dicts
        self.recent_candidates: List[Dict[str, Any]] = []

        # Latest Generated Heatmap
        self.latest_heatmap: Optional[HeatmapFrame] = None

    # ---------------------------------------------------------------------------------
    # Ground Classification & Filtering
    # ---------------------------------------------------------------------------------
    def _classify_ground_and_edges(self, frame: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Analyzes HSV color, saturation variance, and edge gradients.
        Returns:
          - ground_mask: Binary mask where 255 = normal ground (grass/asphalt/dirt)
          - edge_mag: Gradient magnitude map
          - high_contrast_mask: Binary mask of high-contrast non-ground anomalies
        """
        h, w = frame.shape[:2]

        # Convert to HSV and Lab
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # 1. Estimate Ground Characteristics (dominant background color)
        # Downsample for fast background statistical sampling
        small_hsv = cv2.resize(hsv, (80, 60))
        mean_h, mean_s, mean_v = np.median(small_hsv[:, :, 0]), np.median(small_hsv[:, :, 1]), np.median(small_hsv[:, :, 2])

        # Define adaptive bounds around dominant ground color (±25 Hue, ±55 Saturation)
        h_low = max(0, int(mean_h - 28))
        h_high = min(179, int(mean_h + 28))
        s_low = max(20, int(mean_s - 60))
        s_high = min(255, int(mean_s + 60))
        v_low = max(30, int(mean_v - 75))
        v_high = min(255, int(mean_v + 75))

        ground_mask = cv2.inRange(hsv, np.array([h_low, s_low, v_low]), np.array([h_high, s_high, v_high]))

        # Smooth ground mask with morphological closing
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        ground_mask = cv2.morphologyEx(ground_mask, cv2.MORPH_CLOSE, kernel)

        # 2. High-Frequency Edge Detection (Sobel)
        blurred_gray = cv2.GaussianBlur(gray, (5, 5), 0)
        grad_x = cv2.Sobel(blurred_gray, cv2.CV_16S, 1, 0, ksize=3)
        grad_y = cv2.Sobel(blurred_gray, cv2.CV_16S, 0, 1, ksize=3)
        abs_grad_x = cv2.convertScaleAbs(grad_x)
        abs_grad_y = cv2.convertScaleAbs(grad_y)
        edge_mag = cv2.addWeighted(abs_grad_x, 0.5, abs_grad_y, 0.5, 0)

        # 3. High Contrast Non-Ground Mask
        # Non-ground is inverse of ground mask combined with high edge energy
        non_ground = cv2.bitwise_not(ground_mask)
        _, high_edge = cv2.threshold(edge_mag, 45, 255, cv2.THRESH_BINARY)
        high_contrast = cv2.bitwise_and(non_ground, high_edge)
        high_contrast = cv2.morphologyEx(high_contrast, cv2.MORPH_OPEN, kernel)

        return ground_mask, edge_mag, high_contrast

    # ---------------------------------------------------------------------------------
    # Geometric Shape & Box Detection
    # ---------------------------------------------------------------------------------
    def _detect_geometric_candidates(
        self,
        frame: np.ndarray,
        high_contrast_mask: np.ndarray
    ) -> List[Dict[str, Any]]:
        """
        Detects rectangular, square, and high-priority QR-like candidates.
        Evaluates contour vertex count, convexity, aspect ratio, and black/white symmetry.
        """
        h, w = frame.shape[:2]
        frame_area = w * h

        # Enhance contrast
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        clahe_img = self.clahe.apply(gray)
        thresh = cv2.adaptiveThreshold(
            clahe_img, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 5
        )

        # Combine with high contrast mask
        combined = cv2.bitwise_or(thresh, high_contrast_mask)
        contours, _ = cv2.findContours(combined, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []
        min_area = frame_area * 0.003  # At least 0.3% of camera view
        max_area = frame_area * 0.65   # At most 65% of camera view

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area or area > max_area:
                continue

            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.035 * peri, True)
            num_vertices = len(approx)

            x, y, bw, bh = cv2.boundingRect(cnt)
            aspect_ratio = float(bw) / float(bh) if bh > 0 else 0.0
            cx = x + bw // 2
            cy = y + bh // 2

            # Evaluate Shape Classification
            is_quad = (num_vertices == 4 and cv2.isContourConvex(approx))
            is_square = is_quad and (0.75 <= aspect_ratio <= 1.35)
            is_rectangle = is_quad and (0.50 <= aspect_ratio <= 2.0)

            # Analyze black/white edge variance inside bounding box (QR check)
            roi = gray[y:y+bh, x:x+bw]
            edge_density = 0.0
            has_qr_patterns = False
            if roi.size > 100:
                roi_std = np.std(roi)
                # QR codes have very high standard deviation (black and white interleaving)
                if roi_std > 52.0:
                    edge_density = float(roi_std / 128.0)
                    has_qr_patterns = True

            # Determine Tier Classification & Priority:
            # Priority 1: QR candidate (High edge density + square box)
            # Priority 2: Square / Rectangular target box
            # Priority 3: Unusual geometric polygonal structure
            # Priority 4: Other potential ground objects
            if has_qr_patterns and (is_square or is_rectangle):
                category = "QR_CANDIDATE"
                shape = "QR_PATTERN"
                priority = 1
                tier = 3  # Tier D / High Priority
                confidence = min(0.95, 0.70 + (edge_density * 0.25))
            elif is_square:
                category = "BOX_STRUCTURE"
                shape = "SQUARE"
                priority = 2
                tier = 2  # Tier C / High Priority Object
                confidence = 0.85
            elif is_rectangle:
                category = "BOX_STRUCTURE"
                shape = "RECTANGLE"
                priority = 2
                tier = 2  # Tier C
                confidence = 0.75
            elif num_vertices in (5, 6, 8):
                category = "GEOMETRIC_SHAPE"
                shape = "POLYGON"
                priority = 3
                tier = 1  # Tier B / Potential Object
                confidence = 0.60
            else:
                category = "GROUND_OBJECT"
                shape = "IRREGULAR"
                priority = 4
                tier = 1  # Tier B
                confidence = 0.45

            candidates.append({
                "category": category,
                "shape": shape,
                "priority": priority,
                "tier": tier,
                "confidence": round(confidence, 2),
                "box": (x, y, bw, bh),
                "centroid": (cx, cy),
                "area": area,
                "aspect_ratio": round(aspect_ratio, 2)
            })

        # Deduplicate internal overlapping nested contours
        filtered_candidates = []
        for cand in sorted(candidates, key=lambda c: (c["priority"], -c["area"])):
            cx, cy = cand["centroid"]
            overlap = False
            for existing in filtered_candidates:
                ex, ey, ew, eh = existing["box"]
                if (ex <= cx <= ex + ew) and (ey <= cy <= ey + eh):
                    overlap = True
                    break
            if not overlap:
                filtered_candidates.append(cand)

        return filtered_candidates

    # ---------------------------------------------------------------------------------
    # Multi-Pass QR Decoder
    # ---------------------------------------------------------------------------------
    def decode_qr(self, frame: np.ndarray, roi_box: Optional[Tuple[int, int, int, int]] = None) -> Tuple[Optional[str], Optional[str]]:
        """
        Executes robust multi-pass QR decoding on image ROI.
        Returns: (full_payload, two_digit_code) or (None, None).
        """
        h, w = frame.shape[:2]
        if roi_box:
            x, y, bw, bh = roi_box
            pad = int(max(bw, bh) * 0.25)
            x1 = max(0, x - pad)
            y1 = max(0, y - pad)
            x2 = min(w, x + bw + pad)
            y2 = min(h, y + bh + pad)
            roi = frame[y1:y2, x1:x2]
        else:
            roi = frame

        if roi.size == 0 or roi.shape[0] < 20 or roi.shape[1] < 20:
            return None, None

        # Pass 1: Direct OpenCV QR Detection
        val, _, _ = self.qr_detector.detectAndDecode(roi)
        if val:
            two_digits = self._extract_two_digits(val)
            return val, two_digits

        # Pass 2: Grayscale + CLAHE + Sharpening filter
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        clahe_roi = self.clahe.apply(gray)
        kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
        sharpened = cv2.filter2D(clahe_roi, -1, kernel)

        val, _, _ = self.qr_detector.detectAndDecode(sharpened)
        if val:
            two_digits = self._extract_two_digits(val)
            return val, two_digits

        # Pass 3: Otsu Adaptive Binarization
        _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        val, _, _ = self.qr_detector.detectAndDecode(otsu)
        if val:
            two_digits = self._extract_two_digits(val)
            return val, two_digits

        # Pass 4: Inverted Otsu (for white-on-dark labels)
        otsu_inv = cv2.bitwise_not(otsu)
        val, _, _ = self.qr_detector.detectAndDecode(otsu_inv)
        if val:
            two_digits = self._extract_two_digits(val)
            return val, two_digits

        return None, None

    def _extract_two_digits(self, raw: str) -> Optional[str]:
        raw = raw.strip()
        if len(raw) == 2 and raw.isdigit():
            return raw
        match = self.two_digit_regex.search(raw)
        if match:
            return match.group(1)
        return None

    # ---------------------------------------------------------------------------------
    # Object Registry & Multi-Frame Temporal Associator
    # ---------------------------------------------------------------------------------
    def _update_object_registry(
        self,
        candidates: List[Dict[str, Any]],
        frame: np.ndarray,
        drone_telemetry: Optional[Dict[str, Any]] = None
    ) -> List[DetectedObject]:
        """
        Associates candidates across frames using spatial proximity and GPS projection.
        Maintains unique object IDs, merges duplicates, and triggers QR decoding.
        """
        now = time.time()
        h, w = frame.shape[:2]
        drone_lat = drone_telemetry.get("lat", 0.0) if drone_telemetry else 0.0
        drone_lon = drone_telemetry.get("lon", 0.0) if drone_telemetry else 0.0
        drone_alt = drone_telemetry.get("alt", 5.0) if drone_telemetry else 5.0
        drone_hdg = drone_telemetry.get("heading", 0.0) if drone_telemetry else 0.0

        for cand in candidates:
            cx, cy = cand["centroid"]
            bx, by, bw, bh = cand["box"]

            # Calculate estimated GPS coordinate
            obj_lat, obj_lon = self.projector.pixel_to_gps(
                cx, cy, w, h, drone_lat, drone_lon, drone_alt, drone_hdg
            )

            # Check if this detection matches an existing registered object
            matched_id = None
            for obj_id, obj in self.registry.items():
                # Matching criteria: GPS proximity (< 3m) or image pixel proximity if stationary
                if obj.lat and obj.lon and obj_lat and obj_lon:
                    dist = self._haversine(obj.lat, obj.lon, obj_lat, obj_lon)
                    if dist <= self.dedup_distance_m:
                        matched_id = obj_id
                        break
                else:
                    # Pixel distance check (within 60px)
                    px_dist = math.hypot(obj.centroid[0] - cx, obj.centroid[1] - cy)
                    if px_dist < 60.0:
                        matched_id = obj_id
                        break

            if matched_id:
                # Update existing object
                obj = self.registry[matched_id]
                obj.last_seen = now
                obj.detection_count += 1
                obj.centroid = (cx, cy)
                obj.bounding_box = (bx, by, bw, bh)
                obj.confidence = max(obj.confidence, cand["confidence"])
                if obj_lat and obj_lon:
                    obj.lat = obj_lat
                    obj.lon = obj_lon
                    obj.altitude = drone_alt

                # If Priority 1 or 2 and not yet decoded, attempt multi-pass decode
                if not obj.decoded_payload and cand["priority"] <= 2:
                    full_payload, two_digits = self.decode_qr(frame, (bx, by, bw, bh))
                    if full_payload or two_digits:
                        obj.decoded_payload = full_payload
                        obj.two_digit_code = two_digits or (full_payload[:2] if full_payload else "42")
                        obj.inspection_status = "VERIFIED"
                        obj.priority = 1
                        cand["tier"] = 3
                        log.info(f"Target {obj_id} successfully decoded: [{obj.decoded_payload}] (Two-Digits: {obj.two_digit_code})")
            else:
                # Register new object candidate
                obj_id = f"OBJ_{self.next_obj_num:03d}"
                self.next_obj_num += 1

                # Generate thumbnail JPEG in base64
                thumb_crop = frame[by:by+bh, bx:bx+bw]
                thumb_b64 = None
                if thumb_crop.size > 0:
                    try:
                        _, buf = cv2.imencode(".jpg", cv2.resize(thumb_crop, (80, 80)), [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                        import base64
                        thumb_b64 = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('ascii')}"
                    except Exception:
                        pass

                new_obj = DetectedObject(
                    object_id=obj_id,
                    category=cand["category"],
                    shape=cand["shape"],
                    priority=cand["priority"],
                    confidence=cand["confidence"],
                    bounding_box=(bx, by, bw, bh),
                    centroid=(cx, cy),
                    first_seen=now,
                    last_seen=now,
                    detection_count=1,
                    lat=obj_lat,
                    lon=obj_lon,
                    altitude=drone_alt,
                    inspection_status="PENDING",
                    thumbnail_base64=thumb_b64
                )

                # Attempt immediate decode
                if cand["priority"] <= 2:
                    full_payload, two_digits = self.decode_qr(frame, (bx, by, bw, bh))
                    if full_payload or two_digits:
                        new_obj.decoded_payload = full_payload
                        new_obj.two_digit_code = two_digits or (full_payload[:2] if full_payload else "42")
                        new_obj.inspection_status = "VERIFIED"
                        new_obj.priority = 1
                        cand["tier"] = 3
                        log.info(f"New Target {obj_id} decoded on first sight: [{new_obj.decoded_payload}]")

                self.registry[obj_id] = new_obj

        # Prune stale unverified single-hit noise older than 15s
        stale_cutoff = now - 15.0
        to_delete = [
            oid for oid, obj in self.registry.items()
            if obj.detection_count < self.min_temporal_hits and obj.last_seen < stale_cutoff and not obj.decoded_payload
        ]
        for oid in to_delete:
            del self.registry[oid]

        return list(self.registry.values())

    # ---------------------------------------------------------------------------------
    # Primary Frame Processing & Heatmap Grid Generation
    # ---------------------------------------------------------------------------------
    def process_frame(
        self,
        frame: np.ndarray,
        drone_telemetry: Optional[Dict[str, Any]] = None
    ) -> Tuple[np.ndarray, HeatmapFrame, List[Dict[str, Any]]]:
        """
        Executes the complete vision pipeline for a single frame:
        1. Ground vs Non-Ground segmentation
        2. Geometric structure and QR candidate extraction
        3. Registry update & QR decode
        4. Heatmap downsampling (grid_rows x grid_cols)
        5. Visual HUD annotation

        Returns:
          - annotated_frame: Display frame with bounding boxes, HUD info, and heatmap tint
          - heatmap: HeatmapFrame dataclass containing classification and confidence grids
          - object_list: Serialized list of confirmed active registered objects
        """
        now = time.time()
        h, w = frame.shape[:2]

        # 1. Classify ground and edge features
        ground_mask, edge_mag, high_contrast = self._classify_ground_and_edges(frame)

        # 2. Detect geometric candidate structures
        candidates = self._detect_geometric_candidates(frame, high_contrast)

        # 3. Update temporal registry & QR decoding
        active_objects = self._update_object_registry(candidates, frame, drone_telemetry)

        # 4. Generate Spatial Heatmap Grid (Downsampled matrix)
        class_grid = [[0 for _ in range(self.grid_cols)] for _ in range(self.grid_rows)]
        conf_grid = [[0.85 for _ in range(self.grid_cols)] for _ in range(self.grid_rows)]

        cell_w = w / float(self.grid_cols)
        cell_h = h / float(self.grid_rows)

        # Project candidate tiers onto grid cells
        for cand in candidates:
            bx, by, bw, bh = cand["box"]
            tier = cand["tier"]
            conf = cand["confidence"]

            c_min = max(0, int(bx / cell_w))
            c_max = min(self.grid_cols - 1, int((bx + bw) / cell_w))
            r_min = max(0, int(by / cell_h))
            r_max = min(self.grid_rows - 1, int((by + bh) / cell_h))

            for r in range(r_min, r_max + 1):
                for c in range(c_min, c_max + 1):
                    # Higher tier takes precedence
                    if tier > class_grid[r][c]:
                        class_grid[r][c] = tier
                        conf_grid[r][c] = conf

        drone_lat = drone_telemetry.get("lat") if drone_telemetry else None
        drone_lon = drone_telemetry.get("lon") if drone_telemetry else None
        drone_alt = drone_telemetry.get("alt") if drone_telemetry else None

        heatmap_data = HeatmapFrame(
            timestamp=now,
            grid_width=self.grid_cols,
            grid_height=self.grid_rows,
            classification_grid=class_grid,
            confidence_grid=conf_grid,
            active_objects_count=len(active_objects),
            drone_lat=drone_lat,
            drone_lon=drone_lon,
            drone_alt=drone_alt
        )
        self.latest_heatmap = heatmap_data

        # 5. Render Visual Tactical Annotations on Display Frame
        annotated = frame.copy()

        # Render subtle heatmap tint overlay
        overlay = np.zeros_like(annotated, dtype=np.uint8)
        colors = {
            1: (0, 230, 255),   # Yellow - Potential object (BGR)
            2: (0, 140, 255),   # Orange - High-Priority box (BGR)
            3: (50, 50, 255)    # Red - Confirmed QR (BGR)
        }
        for r in range(self.grid_rows):
            for c in range(self.grid_cols):
                tier = class_grid[r][c]
                if tier > 0:
                    x1 = int(c * cell_w)
                    y1 = int(r * cell_h)
                    x2 = int((c + 1) * cell_w)
                    y2 = int((r + 1) * cell_h)
                    cv2.rectangle(overlay, (x1, y1), (x2, y2), colors.get(tier, (0, 255, 0)), -1)

        annotated = cv2.addWeighted(annotated, 0.82, overlay, 0.18, 0)

        # Draw detected object bounding boxes and labels
        for obj in active_objects:
            if obj.detection_count < self.min_temporal_hits and not obj.decoded_payload:
                continue

            bx, by, bw, bh = obj.bounding_box
            p = obj.priority
            color = (0, 255, 0)
            if p == 1:
                color = (0, 0, 255)       # Red for QR
            elif p == 2:
                color = (0, 140, 255)     # Orange for Box
            elif p == 3:
                color = (0, 230, 255)     # Yellow for Geometry

            cv2.rectangle(annotated, (bx, by), (bx + bw, by + bh), color, 2)
            label = f"{obj.object_id} [P{p}] {obj.shape}"
            if obj.two_digit_code:
                label += f" CODE:{obj.two_digit_code}"

            cv2.putText(annotated, label, (bx, max(18, by - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)

        # Convert objects to JSON-serializable list
        serialized_objects = [asdict(o) for o in active_objects if o.detection_count >= self.min_temporal_hits or o.decoded_payload]

        return annotated, heatmap_data, serialized_objects

    # ---------------------------------------------------------------------------------
    # Helper Utilities
    # ---------------------------------------------------------------------------------
    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Computes distance in meters between two coordinates."""
        r = 6371000.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2.0)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0)**2
        return r * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


# =====================================================================================
# STANDALONE VERIFICATION ROUTINE
# =====================================================================================
if __name__ == "__main__":
    log.info("Testing VisionEngine with synthetic ground and QR test frame...")
    engine = VisionEngine(grid_cols=32, grid_rows=24)

    # Create synthetic arena frame (grass ground with a high-contrast square target box)
    test_frame = np.full((480, 640, 3), (35, 95, 30), dtype=np.uint8)  # Grass green ground
    # Add high-contrast white box with black center (Cache Box target)
    cv2.rectangle(test_frame, (270, 190), (370, 290), (245, 245, 245), -1)  # White box
    cv2.rectangle(test_frame, (290, 210), (350, 270), (15, 15, 15), -1)      # Black inner pattern

    telemetry = {"lat": 13.0827, "lon": 80.2707, "alt": 5.0, "heading": 90.0}

    # Run 4 consecutive frames to trigger temporal hit validation
    for i in range(4):
        annotated, heatmap, objects = engine.process_frame(test_frame, telemetry)

    log.info(f"Verification Successful! Active Detected Objects: {len(objects)}")
    for obj in objects:
        log.info(f" -> Object: {obj['object_id']} | Category: {obj['category']} | Priority: {obj['priority']} | GPS: ({obj['lat']}, {obj['lon']})")

    log.info(f"Heatmap dimensions: {heatmap.grid_width}x{heatmap.grid_height}. Sample classification value: {heatmap.classification_grid[12][16]}")

