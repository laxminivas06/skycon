#ifndef UART_PROBE_FSM_H
#define UART_PROBE_FSM_H

#include <Arduino.h>
#include <HardwareSerial.h>

/**
 * =====================================================================================
 * SAE INDIA 2026 — S500-AeroRecon Telemetry Relay Firmware
 * Dynamic UART Pin & Baud Auto-Probing State Machine (TELEM2 UART1)
 *
 * SPECIFICATION:
 * - Automatically detects baud rate (115200 vs 921600) and pin polarity.
 * - Candidates:
 *     0: 115200 baud | GPIO 18 RX1 / GPIO 17 TX1 (Standard)
 *     1: 115200 baud | GPIO 17 RX1 / GPIO 18 TX1 (Reversed Polarity)
 *     2: 921600 baud | GPIO 18 RX1 / GPIO 17 TX1 (Standard High-Speed)
 *     3: 921600 baud | GPIO 17 RX1 / GPIO 18 TX1 (Reversed Polarity)
 * - 1500 ms header timeout: if no 0xFD (MAVLink v2) or 0xFE (MAVLink v1) header is
 *   detected within 1500 ms, advances to the next candidate state.
 * - Locks immediately upon detecting valid MAVLink header.
 * - Auto-recovery: If telemetry stream drops completely for > 15 seconds after locking,
 *   re-engages probing to recover from cable reconnection or reconfiguration.
 * =====================================================================================
 */

#define UART_PROBE_TIMEOUT_MS   1500  // Strict 1500 ms header timeout per candidate
#define UART_SIGNAL_LOST_MS     15000 // 15 seconds of zero bytes triggers re-probing

struct UartProbeCandidate {
    uint32_t baud;
    uint8_t rxPin;
    uint8_t txPin;
    const char* description;
};

const UartProbeCandidate PROBE_CANDIDATES[] = {
    {115200, 18, 17, "115200 baud (Standard: RX=GPIO18, TX=GPIO17)"},
    {115200, 17, 18, "115200 baud (Reversed: RX=GPIO17, TX=GPIO18)"},
    {921600, 18, 17, "921600 baud (Standard: RX=GPIO18, TX=GPIO17)"},
    {921600, 17, 18, "921600 baud (Reversed: RX=GPIO17, TX=GPIO18)"}
};

const uint8_t NUM_PROBE_CANDIDATES = sizeof(PROBE_CANDIDATES) / sizeof(PROBE_CANDIDATES[0]);

class UartProbeFSM {
private:
    HardwareSerial* _serial;
    uint8_t _candidateIdx;
    bool _isLocked;
    unsigned long _lastSwitchTime;
    unsigned long _lastValidHeaderTime;
    unsigned long _lastByteReceivedTime;
    uint32_t _totalProbeCycles;

    void applyCandidate(uint8_t idx) {
        _candidateIdx = idx % NUM_PROBE_CANDIDATES;
        const UartProbeCandidate& cand = PROBE_CANDIDATES[_candidateIdx];

        if (_serial != nullptr) {
            _serial->end();
            delay(15);
            _serial->begin(cand.baud, SERIAL_8N1, cand.rxPin, cand.txPin);
            _serial->setTimeout(5);
        }

        _lastSwitchTime = millis();
        Serial.printf("🔄 [UART PROBE] Candidate #%d: %s (Timeout: %d ms)\n",
                      _candidateIdx, cand.description, UART_PROBE_TIMEOUT_MS);
    }

public:
    UartProbeFSM()
        : _serial(nullptr),
          _candidateIdx(0),
          _isLocked(false),
          _lastSwitchTime(0),
          _lastValidHeaderTime(0),
          _lastByteReceivedTime(0),
          _totalProbeCycles(0) {
    }

    void begin(HardwareSerial* serialInstance) {
        _serial = serialInstance;
        _candidateIdx = 0;
        _isLocked = false;
        _totalProbeCycles = 0;
        _lastValidHeaderTime = 0;
        _lastByteReceivedTime = millis();

        applyCandidate(0);
    }

    /**
     * Called whenever a byte is received on TELEM2 UART.
     */
    void onByteReceived(uint8_t b) {
        _lastByteReceivedTime = millis();

        // Check for MAVLink v2 (0xFD) or v1 (0xFE) start-of-frame delimiter
        if (b == 0xFD || b == 0xFE) {
            onHeaderDetected(b);
        }
    }

    /**
     * Lock candidate on header detection.
     */
    void onHeaderDetected(uint8_t header) {
        if (!_isLocked) {
            _isLocked = true;
            _lastValidHeaderTime = millis();
            const UartProbeCandidate& cand = PROBE_CANDIDATES[_candidateIdx];
            Serial.println("=========================================================");
            Serial.printf("🎯 [TELEM2 LOCKED] Valid MAVLink framing (0x%02X) confirmed!\n", header);
            Serial.printf("   Active Baud Rate: %lu baud\n", (unsigned long)cand.baud);
            Serial.printf("   Active RX Pin:    GPIO %d\n", cand.rxPin);
            Serial.printf("   Active TX Pin:    GPIO %d\n", cand.txPin);
            Serial.printf("   Configuration:    %s\n", cand.description);
            Serial.println("=========================================================");
        } else {
            _lastValidHeaderTime = millis();
        }
    }

    /**
     * Periodic FSM tick. Handles 1500 ms candidate timeout and signal-loss auto-recovery.
     */
    void update() {
        unsigned long now = millis();

        if (!_isLocked) {
            if (now - _lastSwitchTime >= UART_PROBE_TIMEOUT_MS) {
                uint8_t nextIdx = (_candidateIdx + 1) % NUM_PROBE_CANDIDATES;
                if (nextIdx == 0) {
                    _totalProbeCycles++;
                }
                applyCandidate(nextIdx);
            }
        } else {
            // Signal-loss auto-recovery: If locked but no data received for 15s, resume probing
            if (now - _lastByteReceivedTime >= UART_SIGNAL_LOST_MS) {
                Serial.println("⚠️ [UART PROBE] Telemetry signal lost for > 15s. Re-engaging auto-probing...");
                _isLocked = false;
                applyCandidate((_candidateIdx + 1) % NUM_PROBE_CANDIDATES);
            }
        }
    }

    void forceUnlock() {
        _isLocked = false;
        applyCandidate((_candidateIdx + 1) % NUM_PROBE_CANDIDATES);
    }

    inline bool isLocked() const { return _isLocked; }
    inline uint32_t getActiveBaud() const { return PROBE_CANDIDATES[_candidateIdx].baud; }
    inline uint8_t getActiveRxPin() const { return PROBE_CANDIDATES[_candidateIdx].rxPin; }
    inline uint8_t getActiveTxPin() const { return PROBE_CANDIDATES[_candidateIdx].txPin; }
    inline const char* getActiveDesc() const { return PROBE_CANDIDATES[_candidateIdx].description; }
    inline uint8_t getCandidateIndex() const { return _candidateIdx; }
    inline uint32_t getTotalProbeCycles() const { return _totalProbeCycles; }
    inline unsigned long getLastHeaderTime() const { return _lastValidHeaderTime; }
};

#endif // UART_PROBE_FSM_H
