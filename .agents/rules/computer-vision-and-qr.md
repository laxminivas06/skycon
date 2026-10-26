# Computer Vision & QR Pipeline Rules

## Target Box & QR Code Requirements
1. **QR Code Format**:
   - The competition target payload is strictly a **2-digit numeric code**.
   - Always validate with regex `^\d{2}$`.
   - Reject any QR content with letters, symbols, or length != 2.
2. **Box Detection Pipeline**:
   - The box detector in `boxDetectionService.ts` looks for cardboard brown / white top-face cuboids.
   - **Multi-Frame Verification**: The box must be detected for at least 3 consecutive frames before declaring `LOCKED`.
   - **Smoothing**: Apply Exponential Moving Average (EMA) filtering (`alpha = 0.5`) to bounding box coordinates `(x, y, w, h)` to prevent flight oscillations during visual servoing.
3. **P2P Runner Transmission Protocol**:
   - Once the QR code is verified (`DATA_CONFIRMED`), immediately transmit over `runnerCommService` to the field runner socket.
   - Set a 30-second ACK watchdog. If the runner does not ACK within 30 seconds, trigger `EMERGENCY_RTL`.
   - On valid Runner ACK reception, immediately trigger autonomous `RTL`.
