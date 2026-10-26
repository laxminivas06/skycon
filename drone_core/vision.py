"""
Decoupled Asynchronous Computer Vision & Target Detection Engine
"""

import cv2
import numpy as np
import time
import queue
import threading
from dataclasses import dataclass
from typing import Optional, Tuple, List, Dict, Any, Callable
from .config import EdgeMissionConfig


@dataclass
class VisionCandidate:
    x: int
    y: int
    width: int
    height: int
    centroid_u: float
    centroid_v: float
    confidence: float
    aspect_ratio: float
    is_qr_direct: bool = False
    qr_payload: Optional[str] = None


@dataclass
class DecodeResult:
    payload: str
    verified: bool
    detection_time: float
    method: str


class OnboardVisionEngine:
    """
    Non-blocking, thread-decoupled vision engine executing:
    - Fast frame ingest with bounded queue (drop-oldest policy to eliminate latency lag)
    - Dynamic zoom sweep stepping
    - Contour and aspect-ratio candidate detection
    - Multi-pass high-resolution QR decoding
    """

    def __init__(self, config: EdgeMissionConfig):
        self.config = config
        self.qr_detector = cv2.QRCodeDetector()
        self.regex = config.get_compiled_regex()

        # Threading & Concurrency Queues
        self.frame_queue: queue.Queue = queue.Queue(maxsize=2)
        self.result_queue: queue.Queue = queue.Queue(maxsize=10)
        self._worker_thread: Optional[threading.Thread] = None
        self._running = False

        # Zoom Sweep State
        self.current_zoom: float = config.min_zoom
        self.zoom_direction: float = 1.0
        self.last_zoom_step_time: float = time.time()

        # Target Candidate Tracking
        self.consecutive_detections: int = 0
        self.last_candidate: Optional[VisionCandidate] = None

    def start(self):
        """Starts the decoupled background CV worker thread."""
        if self._running:
            return
        self._running = True
        self._worker_thread = threading.Thread(target=self._cv_worker_loop, daemon=True)
        self._worker_thread.start()

    def stop(self):
        """Cleanly stops the background CV thread."""
        self._running = False
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=1.0)
        self._worker_thread = None

    def submit_frame(self, frame: np.ndarray):
        """
        Submits a raw camera frame for non-blocking processing.
        Drops oldest frame if queue is full to preserve real-time latency.
        """
        if not self._running or frame is None:
            return
        try:
            self.frame_queue.put_nowait(frame)
        except queue.Full:
            try:
                self.frame_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self.frame_queue.put_nowait(frame)
            except queue.Full:
                pass

    def get_latest_result(self) -> Optional[Dict[str, Any]]:
        """Polls the latest processed result from worker queue without blocking."""
        try:
            return self.result_queue.get_nowait()
        except queue.Empty:
            return None

    def step_dynamic_zoom(self, is_searching: bool) -> float:
        """
        Executes dynamic zoom sweeping during SEARCHING state,
        cycling smoothly between min_zoom and max_zoom.
        """
        now = time.time()
        if not is_searching:
            return self.current_zoom

        if now - self.last_zoom_step_time >= self.config.zoom_interval_s:
            self.last_zoom_step_time = now
            next_zoom = round(self.current_zoom + (self.zoom_direction * self.config.zoom_step), 2)
            if next_zoom >= self.config.max_zoom:
                next_zoom = self.config.max_zoom
                self.zoom_direction = -1.0
            elif next_zoom <= self.config.min_zoom:
                next_zoom = self.config.min_zoom
                self.zoom_direction = 1.0
            self.current_zoom = next_zoom

        return self.current_zoom

    def set_zoom(self, zoom: float):
        """Explicitly sets zoom level (e.g., during APPROACHING or DECODING)."""
        self.current_zoom = max(self.config.min_zoom, min(self.config.max_zoom, zoom))

    # =========================================================================
    # CORE CV ALGORITHMS (RUN IN WORKER THREAD)
    # =========================================================================

    def _cv_worker_loop(self):
        while self._running:
            try:
                frame = self.frame_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            try:
                # 1. Fast Direct QR Decode Attempt
                qr_result = self.decode_frame(frame)

                # 2. Candidate Contour Detection
                candidate = self.detect_candidate(frame)

                if qr_result and qr_result.verified:
                    if candidate:
                        candidate.is_qr_direct = True
                        candidate.qr_payload = qr_result.payload

                # Dispatch result to main state loop
                out = {
                    "timestamp": time.time(),
                    "candidate": candidate,
                    "qr_result": qr_result,
                    "zoom": self.current_zoom
                }

                try:
                    self.result_queue.put_nowait(out)
                except queue.Full:
                    try:
                        self.result_queue.get_nowait()
                    except queue.Empty:
                        pass
                    self.result_queue.put_nowait(out)

            except Exception as e:
                pass

    def detect_candidate(self, frame: np.ndarray) -> Optional[VisionCandidate]:
        """
        Detects bounding box/contour candidates matching target aspect ratios.
        """
        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame

        # Adaptive thresholding to identify sharp square/rectangular contours
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        thresh = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3
        )

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best_candidate: Optional[VisionCandidate] = None
        max_score = 0.0

        for cnt in contours:
            area = cv2.contourArea(cnt)
            # Filter out tiny noise and full-screen artifacts
            if area < (w * h * 0.001) or area > (w * h * 0.6):
                continue

            x, y, bw, bh = cv2.boundingRect(cnt)
            aspect_ratio = float(bw) / float(bh)

            # Target aspect ratio for QR and square cuboid top face is near 1.0 (0.75 - 1.35)
            if 0.70 <= aspect_ratio <= 1.40:
                # Convexity and perimeter ratio score
                peri = cv2.arcLength(cnt, True)
                approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
                is_quad = len(approx) in [4, 5]

                score = (1.0 - abs(1.0 - aspect_ratio)) * 0.5 + (0.5 if is_quad else 0.2)
                if score > max_score and score > 0.45:
                    max_score = score
                    best_candidate = VisionCandidate(
                        x=x,
                        y=y,
                        width=bw,
                        height=bh,
                        centroid_u=x + bw / 2.0,
                        centroid_v=y + bh / 2.0,
                        confidence=round(score, 2),
                        aspect_ratio=round(aspect_ratio, 2)
                    )

        return best_candidate

    def decode_frame(self, frame: np.ndarray) -> Optional[DecodeResult]:
        """
        Multi-pass high-resolution QR decoding pipeline:
        Pass 1: Direct OpenCV QRCodeDetector
        Pass 2: CLAHE Contrast Enhanced
        Pass 3: Adaptive Binarization
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame

        # Pass 1: Raw Grayscale
        text, points, _ = self.qr_detector.detectAndDecode(gray)
        if text and self._validate_payload(text.strip()):
            return DecodeResult(payload=text.strip(), verified=True, detection_time=time.time(), method="PASS1_RAW")

        # Pass 2: Contrast Enhancement (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        text, points, _ = self.qr_detector.detectAndDecode(enhanced)
        if text and self._validate_payload(text.strip()):
            return DecodeResult(payload=text.strip(), verified=True, detection_time=time.time(), method="PASS2_CLAHE")

        # Pass 3: Thresholded Binarization
        _, bin_frame = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        text, points, _ = self.qr_detector.detectAndDecode(bin_frame)
        if text and self._validate_payload(text.strip()):
            return DecodeResult(payload=text.strip(), verified=True, detection_time=time.time(), method="PASS3_OTSU")

        return None

    def _validate_payload(self, text: str) -> bool:
        r"""Validates payload against configured regex constraint (e.g. ^\d{2}$)."""
        if not text:
            return False
        return bool(self.regex.match(text))
