/*
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
 * ESP32-S3 Dual-Core FreeRTOS Telemetry Relay Firmware (Rev 2.4.0-PROD)
 * Tier 1 Avionics Architecture | TELEM2 (Pixhawk 2.4.8) <-> Cloud Relay (Render WSS)
 * =====================================================================================
 *
 * HARDWARE: ESP32-S3 (Xtensa LX7 Dual Core @ 240 MHz, 512 KB SRAM, 8MB Flash)
 *
 * WIRING TOPOLOGY:
 *   PIXHAWK TELEM2 (SERIAL2)           ESP32-S3
 *   -----------------------            -----------------
 *   Pin 1  +5V DC (1.0A)    ─────────  NC (Isolated 5V 3A UBEC + 1000uF smoothing cap)
 *   Pin 2  TX (3.3V LVTTL)  ─────────  GPIO 18 (RX1, Candidate 0/2) or GPIO 17 (Rev Polarity)
 *   Pin 3  RX (3.3V LVTTL)  ─────────  GPIO 17 (TX1, Candidate 0/2) or GPIO 18 (Rev Polarity)
 *   Pin 4  CTS              ─────────  NC (BRD_SER2_RTSCTS = 0)
 *   Pin 5  RTS              ─────────  NC (BRD_SER2_RTSCTS = 0)
 *   Pin 6  GND (Signal GND) ─────────  GND (Common ground reference)
 *
 * DUAL-CORE FREERTOS THREADING ARCHITECTURE:
 *   CORE 1 (Priority 3 - Hard Real-Time Engine):
 *     - Hardware UART1 auto-probing FSM cycling 115200 and 921600 baud, normal & reversed pins.
 *     - Non-blocking drain into 16 KB lock-free circular ring buffer (internal DRAM).
 *     - Zero-copy MAVLink v2 / v1 framing inspector with ITU X.25 CRC-16 & CRC_EXTRA validation.
 *     - Real-time STATUSTEXT (#253) QR alert interceptor with instant BRAKE (Mode 17) injection.
 *     - High-priority uplink queue drainer writing GCS commands & emergency RTL frames to TELEM2.
 *
 *   CORE 0 (Priority 2 - Networking, TLS 1.3 & Safety Watchdog Engine):
 *     - Non-blocking Wi-Fi FSM with 2.4 GHz channel pre-scan, fast locking, PMF, and 15 dBm cap.
 *     - mbedTLS TLS 1.3 WebSocket client connecting to /connector endpoint with TCP_NODELAY.
 *     - November 2026 baseline epoch clock setter for immediate SSL validation prior to NTP.
 *     - 10-second ping/pong keepalive loop preventing reverse-proxy timeout.
 *     - 5000 ms Heartbeat Watchdog: monitors armed state; triggers localized MAVLink RTL (Mode 6)
 *       failsafe if GCS telemetry link drops for > 5000 ms during armed flight.
 * =====================================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoWebsockets.h>
using namespace websockets;

#include <time.h>
#include <sys/time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "esp_wifi.h"
#include "esp_private/brownout.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "soc/rtc_cntl_struct.h"
#include <lwip/sockets.h>
#include <lwip/netdb.h>

#include "esp32_cloud_relay_client/cert_bundle.h"
#include "esp32_cloud_relay_client/lockfree_ring_buffer.h"
#include "esp32_cloud_relay_client/mavlink_v2_parser.h"
#include "esp32_cloud_relay_client/uart_probe_fsm.h"

// Hardware Brownout Detector disable at earliest C constructor to eliminate reset loops on weak rails
__attribute__((constructor)) static void disable_bod_early_boot() {
    esp_brownout_disable();
    RTCCNTL.fib_sel.val &= ~BIT(1);
    RTCCNTL.brown_out.val = 0;
    RTCCNTL.brown_out.ena = 0;
    RTCCNTL.brown_out.rst_ena = 0;
    RTCCNTL.brown_out.ana_rst_en = 0;
    RTCCNTL.brown_out.pd_rf_ena = 0;
    RTCCNTL.brown_out.close_flash_ena = 0;
    RTCCNTL.int_ena.rtc_brown_out = 0;
}

// =====================================================================================
// 1. WI-FI CREDENTIALS & FALLBACKS
// =====================================================================================
const char* WIFI_SSID     = "drone123";
const char* WIFI_PASSWORD = "drone@123";

const char* FALLBACK_SSID = "IDEALABS-1";
const char* FALLBACK_PASS = "SphnCollege";

// =====================================================================================
// 2. CLOUD RELAY WSS CONFIGURATION
// =====================================================================================
const char* RELAY_HOST    = "dronebackend-ppgp.onrender.com";
const uint16_t RELAY_PORT = 443;
const char* RELAY_PATH    = "/connector?token=saeindia_secret_token_2026";
const char* RELAY_WSS_URL = "wss://dronebackend-ppgp.onrender.com/connector?token=saeindia_secret_token_2026";
const char* RELAY_TOKEN   = "saeindia_secret_token_2026";

#define STATUS_LED_PIN    2

// =====================================================================================
// 3. FREERTOS QUEUES & INTER-TASK MESSAGING
// =====================================================================================
#define MAX_QUEUE_PACKET_LEN  512

enum PacketType : uint8_t {
    PKT_TYPE_MAVLINK_BINARY = 0,
    PKT_TYPE_JSON_TEXT      = 1
};

struct QueuePacket {
    PacketType type;
    uint16_t length;
    uint8_t data[MAX_QUEUE_PACKET_LEN];
};

// Thread-safe FreeRTOS queues for inter-core communication
QueueHandle_t qTxToCloud        = nullptr; // Core 1 (UART RX) -> Core 0 (WSS TX)
QueueHandle_t qRxFromCloud      = nullptr; // Core 0 (WSS RX) -> Core 1 (UART TX)
QueueHandle_t qEmergencyUplink  = nullptr; // Core 0 (Watchdog RTL) -> Core 1 (UART TX)

// =====================================================================================
// 4. CORE ENGINE INSTANCES
// =====================================================================================
HardwareSerial PixhawkSerial(1); // Hardware UART1 for Pixhawk TELEM2
WebsocketsClient wsClient;
LockFreeRingBuffer uartRingBuffer;
MavlinkV2Parser mavlinkParser;
UartProbeFSM uartProber;

// Heartbeat Watchdog & Liveness Tracking
struct TelemetryWatchdog {
    unsigned long lastPixhawkHeartbeatMs;
    unsigned long lastGcsActivityMs;
    unsigned long lastRtlInjectionMs;
    bool isArmed;
    uint32_t currentFlightMode;
    bool rtlFailsafeTriggered;
    uint32_t totalFailsafeInjections;
} watchdog = {0, 0, 0, false, 0, false, 0};

// Performance & Telemetry Counters
unsigned long totalRxBytesFromPixhawk = 0;
unsigned long totalTxBytesToPixhawk   = 0;
unsigned long totalMavlinkPacketsSent = 0;
unsigned long totalCommandsReceived   = 0;
unsigned long totalQrAlertsEmitted    = 0;

unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL_MS = 10000; // 10s ping keepalive

unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL_MS = 3000;

unsigned long wifiConnectionStartTime = 0;
uint8_t wifiAttemptCount = 0;
bool usingFallback = false;

unsigned long lastDiagnosticPrint = 0;
const unsigned long DIAGNOSTIC_INTERVAL_MS = 3000;

// =====================================================================================
// SOCKET TUNING: TCP_NODELAY ENFORCEMENT
// =====================================================================================
void enforceTcpNoDelay() {
    int nodelay = 1;
    // Iterate over active lwIP socket descriptors to enable TCP_NODELAY
    for (int fd = 0; fd < FD_SETSIZE; fd++) {
        int optval = 0;
        socklen_t optlen = sizeof(optval);
        if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &optval, &optlen) == 0 && optval == SOCK_STREAM) {
            int res = setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, (const void*)&nodelay, sizeof(nodelay));
            if (res == 0) {
                Serial.printf("⚡ [SOCKET TUNING] setsockopt(TCP_NODELAY=1) applied to lwIP socket fd=%d\n", fd);
            }
        }
    }
}

// =====================================================================================
// STATUS LED HELPER
// =====================================================================================
void updateLED(int mode) {
    if (STATUS_LED_PIN < 0) return;
    if (mode == 2) {
        digitalWrite(STATUS_LED_PIN, HIGH); // Solid ON (Connected)
    } else if (mode == 0) {
        digitalWrite(STATUS_LED_PIN, LOW);  // OFF
    } else {
        digitalWrite(STATUS_LED_PIN, (millis() / 250) % 2); // Blinking (Connecting)
    }
}

// =====================================================================================
// WI-FI EVENT HANDLERS
// =====================================================================================
const char* getWiFiDisconnectReason(uint8_t reason) {
    switch (reason) {
        case 1:   return "UNSPECIFIED";
        case 2:   return "AUTH_EXPIRE";
        case 3:   return "AUTH_LEAVE";
        case 4:   return "ASSOC_EXPIRE";
        case 5:   return "ASSOC_TOOMANY";
        case 6:   return "NOT_AUTHED";
        case 7:   return "NOT_ASSOCED";
        case 8:   return "ASSOC_LEAVE";
        case 15:  return "4WAY_HANDSHAKE_TIMEOUT (Check Wi-Fi password)";
        case 200: return "BEACON_TIMEOUT (Signal lost / out of range)";
        case 201: return "NO_AP_FOUND (Ensure hotspot is 2.4 GHz)";
        case 202: return "AUTH_FAIL (Incorrect password)";
        case 203: return "ASSOC_FAIL";
        case 204: return "HANDSHAKE_TIMEOUT";
        case 205: return "CONNECTION_FAIL";
        default:  return "UNKNOWN_REASON";
    }
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_START:
            Serial.println("📡 [WIFI EVENT] Wi-Fi station initialized. Searching 2.4 GHz spectrum...");
            break;
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            Serial.println("🤝 [WIFI EVENT] Associated with hotspot! Requesting DHCP lease...");
            break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            Serial.printf("🟢 [WIFI EVENT] IP lease granted: %s\n", WiFi.localIP().toString().c_str());
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
            uint8_t reason = info.wifi_sta_disconnected.reason;
            Serial.printf("⚠️ [WIFI EVENT] Disconnected. Reason code %d: %s\n",
                          reason, getWiFiDisconnectReason(reason));
            break;
        }
        default:
            break;
    }
}

// =====================================================================================
// WEBSOCKET CALLBACKS (CORE 0)
// =====================================================================================
void onMessageCallback(WebsocketsMessage message) {
    // Record inbound GCS activity to reset watchdog
    watchdog.lastGcsActivityMs = millis();
    if (watchdog.rtlFailsafeTriggered) {
        Serial.println("🟢 [WATCHDOG] GCS uplink restored! Clearing RTL failsafe flag.");
        watchdog.rtlFailsafeTriggered = false;
    }

    if (message.isBinary()) {
        size_t length = message.length();
        if (length > 0 && length <= MAX_QUEUE_PACKET_LEN && qRxFromCloud != nullptr) {
            QueuePacket pkt;
            pkt.type = PKT_TYPE_MAVLINK_BINARY;
            pkt.length = length;
            memcpy(pkt.data, message.c_str(), length);
            
            if (xQueueSend(qRxFromCloud, &pkt, 0) == pdTRUE) {
                totalCommandsReceived++;
            }
        }
    } else if (message.isText()) {
        Serial.printf("ℹ️ [RELAY MESSAGE] %s\n", message.data().c_str());
    }
}

void onEventsCallback(WebsocketsEvent event, String data) {
    if (event == WebsocketsEvent::ConnectionOpened) {
        Serial.println("\n*********************************************************");
        Serial.println("🟢 [WSS CLOUD RELAY] >>> CONNECTED SUCCESSFULLY! <<<");
        Serial.println("🌐 High-throughput MAVLink telemetry pipeline active.");
        Serial.println("*********************************************************\n");
        updateLED(2);

        // Enforce socket-level TCP_NODELAY on the newly established connection
        enforceTcpNoDelay();

        watchdog.lastGcsActivityMs = millis();
        watchdog.rtlFailsafeTriggered = false;

        wsClient.send("{\"type\":\"ESP32_STATUS\",\"status\":\"CONNECTED\",\"device\":\"ESP32_S3_DUAL_CORE_RTOS\"}");
    } else if (event == WebsocketsEvent::ConnectionClosed) {
        Serial.println("\n🔴 [WSS CLOUD RELAY] Connection closed. Automatic reconnect active...");
        updateLED(0);
    } else if (event == WebsocketsEvent::GotPing) {
        watchdog.lastGcsActivityMs = millis();
        wsClient.pong();
    } else if (event == WebsocketsEvent::GotPong) {
        watchdog.lastGcsActivityMs = millis();
    }
}

// =====================================================================================
// WI-FI CONNECTION FSM (CORE 0)
// =====================================================================================
bool scanForTargetNetwork(const char* targetSSID, int32_t &foundChannel) {
    Serial.printf("\n🔍 [WIFI PRE-SCAN] Scanning 2.4 GHz spectrum for '%s' ...\n", targetSSID);
    int n = WiFi.scanNetworks(false, false, false, 250);
    bool found = false;

    if (n > 0) {
        for (int i = 0; i < n; ++i) {
            String ssid = WiFi.SSID(i);
            int32_t chan = WiFi.channel(i);
            if (ssid == targetSSID) {
                found = true;
                foundChannel = chan;
                Serial.printf("   🎯 Target network '%s' detected on 2.4 GHz Channel %d (RSSI: %d dBm)\n",
                              ssid.c_str(), chan, WiFi.RSSI(i));
                break;
            }
        }
    }
    WiFi.scanDelete();
    return found;
}

void startWiFiConnection(const char* ssid, const char* pass, int32_t channel = 0) {
    WiFi.persistent(false);
    WiFi.disconnect(true);
    delay(50);

    WiFi.mode(WIFI_STA);

    // Configure Protected Management Frames (PMF) for modern smartphone hotspots
    wifi_config_t conf;
    if (esp_wifi_get_config(WIFI_IF_STA, &conf) == ESP_OK) {
        conf.sta.pmf_cfg.capable = true;
        conf.sta.pmf_cfg.required = false;
        esp_wifi_set_config(WIFI_IF_STA, &conf);
    }

    esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N);

    // CRITICAL: Disable 802.11 modem sleep to prevent radio drops during 4-way handshake
    WiFi.setSleep(false);
    // Limit RF TX power to 15 dBm to eliminate current spikes exceeding 450 mA
    WiFi.setTxPower(WIFI_POWER_15dBm);
    WiFi.setAutoReconnect(true);

    if (channel > 0) {
        WiFi.begin(ssid, pass, channel);
    } else {
        WiFi.begin(ssid, pass);
    }

    wifiConnectionStartTime = millis();
}

void connectToWiFi(bool isInitialSetup = false) {
    if (WiFi.status() == WL_CONNECTED) return;

    const char* activeSSID = usingFallback ? FALLBACK_SSID : WIFI_SSID;
    const char* activePass = usingFallback ? FALLBACK_PASS : WIFI_PASSWORD;
    int32_t targetChannel = 0;

    if (isInitialSetup) {
        scanForTargetNetwork(activeSSID, targetChannel);
    }

    startWiFiConnection(activeSSID, activePass, targetChannel);

    if (isInitialSetup) {
        unsigned long startWait = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - startWait < 12000) {
            delay(250);
            Serial.print(".");
            updateLED(1);
        }
        Serial.println();
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n🟢 [WIFI] CONNECTED SUCCESSFULLY!");
        Serial.printf("📍 [WIFI] Assigned IP: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("📶 [WIFI] RSSI:        %d dBm\n", WiFi.RSSI());
        updateLED(2);

        ensureSaneSystemClock();
        configTime(0, 0, "pool.ntp.org", "time.google.com");
    }
}

void handleWiFiMaintenance() {
    if (WiFi.status() == WL_CONNECTED) {
        wifiAttemptCount = 0;
        return;
    }

    updateLED(1);

    if (millis() - wifiConnectionStartTime > 12000) {
        wifiConnectionStartTime = millis();
        wifiAttemptCount++;

        if (strlen(FALLBACK_SSID) > 0) {
            usingFallback = !usingFallback;
        }

        const char* targetSSID = usingFallback ? FALLBACK_SSID : WIFI_SSID;
        const char* targetPass = usingFallback ? FALLBACK_PASS : WIFI_PASSWORD;

        Serial.printf("⚠️ [WIFI RETRY] Re-attempting connection to '%s' (Attempt #%d)...\n",
                      targetSSID, wifiAttemptCount);

        WiFi.disconnect(true);
        delay(50);
        startWiFiConnection(targetSSID, targetPass);
    }
}

// =====================================================================================
// CLOUD RELAY WSS CONNECTION ENGINE (CORE 0)
// =====================================================================================
void connectToCloudRelay() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (wsClient.available()) return;

    if (millis() - lastReconnectAttempt < RECONNECT_INTERVAL_MS) return;
    lastReconnectAttempt = millis();

    ensureSaneSystemClock();

    Serial.println("☁️  [WSS] Connecting to Render Cloud Relay via mbedTLS...");
    Serial.printf("🔗 [WSS] Target: %s\n", RELAY_WSS_URL);

    wsClient.setCACert(RENDER_CA_BUNDLE);
    wsClient.addHeader("x-relay-token", RELAY_TOKEN);

    bool connected = wsClient.connect(RELAY_WSS_URL);

    if (!connected) {
        Serial.println("⚠️  [WSS] URL connect failed, attempting explicit Host/Port/Path connect...");
        connected = wsClient.connectSecure(RELAY_HOST, RELAY_PORT, RELAY_PATH);
    }

    if (!connected) {
        Serial.println("⚠️  [WSS] Insecure fallback connect...");
        wsClient.setInsecure();
        wsClient.addHeader("x-relay-token", RELAY_TOKEN);
        connected = wsClient.connect(RELAY_WSS_URL);
    }

    if (connected) {
        enforceTcpNoDelay();
    }
}

// =====================================================================================
// CORE 1 TASK: REAL-TIME HARDWARE UART1 DRIVER & MAVLINK V2 PARSER (PRIORITY 3)
// =====================================================================================
void taskUartReceiver(void* pvParameters) {
    Serial.println("⚡ [CORE 1 TASK] Real-Time UART Engine & Zero-Copy Parser active (Priority 3).");

    QueuePacket cmdPkt;
    DecodedMavlinkFrame frame;
    uint8_t packetBuffer[MAX_QUEUE_PACKET_LEN];

    while (true) {
        // 1. Drain Pixhawk TELEM2 hardware FIFO into the >= 16 KB lock-free circular ring buffer
        while (PixhawkSerial.available() > 0) {
            uint8_t b = (uint8_t)PixhawkSerial.read();
            totalRxBytesFromPixhawk++;
            uartRingBuffer.push(b);
            uartProber.onByteReceived(b);
        }

        // 2. Parse frames directly from the ring buffer without copying
        while (uartRingBuffer.available() > 0) {
            MavlinkParseResult res = mavlinkParser.inspectFrame(uartRingBuffer, frame);

            if (res == PARSE_OK) {
                // Confirm UART prober locked state on verified valid packet
                if (!uartProber.isLocked()) {
                    uartProber.onHeaderDetected(frame.magic);
                }

                // Synchronize vehicle state to watchdog tracker
                watchdog.isArmed = mavlinkParser.vehicleState.isArmed;
                watchdog.currentFlightMode = mavlinkParser.vehicleState.customFlightMode;
                watchdog.lastPixhawkHeartbeatMs = mavlinkParser.vehicleState.lastHeartbeatMs;

                // Intercept QR detection alert and inject immediate BRAKE (Mode 17)
                if (mavlinkParser.qrCodeAlertTriggered) {
                    mavlinkParser.qrCodeAlertTriggered = false;

                    // A) Immediate local BRAKE command injection into Pixhawk UART TX
                    uint8_t brakeCmd[64];
                    size_t brakeLen = MavlinkV2Parser::buildBrakeCommand(brakeCmd, (uint8_t)frame.seq);
                    if (brakeLen > 0) {
                        PixhawkSerial.write(brakeCmd, brakeLen);
                        totalTxBytesToPixhawk += brakeLen;
                        Serial.printf("\n🚨 [INSTANT BRAKE INJECTED] Target QR '%s' -> MAV_CMD_DO_SET_MODE (Mode 17 BRAKE) sent to TELEM2!\n",
                                      mavlinkParser.lastQrCodeDigits);
                    }

                    // B) Enqueue high-priority JSON alert to Cloud queue
                    if (qTxToCloud != nullptr) {
                        QueuePacket qrAlertPkt;
                        qrAlertPkt.type = PKT_TYPE_JSON_TEXT;
                        int n = snprintf((char*)qrAlertPkt.data, MAX_QUEUE_PACKET_LEN,
                                         "{\"type\":\"QR_ALERT\",\"digits\":\"%s\",\"timestamp\":%lu}",
                                         mavlinkParser.lastQrCodeDigits, millis());
                        if (n > 0) {
                            qrAlertPkt.length = (uint16_t)n;
                            xQueueSend(qTxToCloud, &qrAlertPkt, 0);
                            totalQrAlertsEmitted++;
                        }
                    }
                }

                // Copy valid MAVLink binary frame to cloud transmission queue
                if (qTxToCloud != nullptr && frame.totalLength <= sizeof(packetBuffer)) {
                    uartRingBuffer.peek_n(0, packetBuffer, frame.totalLength);

                    QueuePacket pkt;
                    pkt.type = PKT_TYPE_MAVLINK_BINARY;
                    pkt.length = (uint16_t)frame.totalLength;
                    memcpy(pkt.data, packetBuffer, frame.totalLength);
                    xQueueSend(qTxToCloud, &pkt, pdMS_TO_TICKS(5));
                }

                // Advance ring buffer tail past the processed packet
                uartRingBuffer.consume(frame.totalLength);
            }
            else if (res == PARSE_CRC_ERROR || res == PARSE_NOT_HEADER) {
                // Byte is noise or CRC failed: advance 1 byte and rescan
                uartRingBuffer.consume(1);
            }
            else if (res == PARSE_NEED_MORE) {
                // Packet incomplete: wait for more bytes from UART hardware FIFO
                break;
            }
        }

        // 3. Drain and transmit emergency uplink commands (e.g. Watchdog RTL)
        if (qEmergencyUplink != nullptr) {
            while (xQueueReceive(qEmergencyUplink, &cmdPkt, 0) == pdTRUE) {
                PixhawkSerial.write(cmdPkt.data, cmdPkt.length);
                totalTxBytesToPixhawk += cmdPkt.length;
            }
        }

        // 4. Drain standard inbound commands from Phone GCS / Cloud -> Pixhawk TELEM2
        if (qRxFromCloud != nullptr) {
            while (xQueueReceive(qRxFromCloud, &cmdPkt, 0) == pdTRUE) {
                PixhawkSerial.write(cmdPkt.data, cmdPkt.length);
                totalTxBytesToPixhawk += cmdPkt.length;
            }
        }

        // 1 ms delay yields control to FreeRTOS scheduler
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

// =====================================================================================
// CORE 0 TASK: WI-FI, TLS 1.3 WSS RELAY & HEARTBEAT WATCHDOG (PRIORITY 2)
// =====================================================================================
void taskCloudRelay(void* pvParameters) {
    Serial.println("☁️  [CORE 0 TASK] Wi-Fi, TLS WSS & Watchdog Engine active (Priority 2).");

    QueuePacket outPkt;
    uint8_t binaryBatch[1024];
    size_t batchLen = 0;
    unsigned long lastBatchFlush = millis();

    while (true) {
        // 1. Maintain Wi-Fi Station
        handleWiFiMaintenance();

        // 2. Maintain WebSocket Connection
        if (WiFi.status() == WL_CONNECTED) {
            if (!wsClient.available()) {
                updateLED(1);
                connectToCloudRelay();
            } else {
                updateLED(2);
            }
        }

        // 3. Service WebSocket Client
        if (wsClient.available()) {
            wsClient.poll();
        }

        // 4. 10-Second Ping/Pong Keepalive
        if (wsClient.available() && (millis() - lastPingTime > PING_INTERVAL_MS)) {
            lastPingTime = millis();
            wsClient.ping();
        }

        // 5. 5000 ms Heartbeat Watchdog & Localized RTL Failsafe Engine
        unsigned long now = millis();
        if (watchdog.isArmed) {
            unsigned long silenceMs = (watchdog.lastGcsActivityMs > 0) ? (now - watchdog.lastGcsActivityMs) : 0;

            if (silenceMs > 5000) {
                if (!watchdog.rtlFailsafeTriggered) {
                    watchdog.rtlFailsafeTriggered = true;
                    Serial.println("\n🚨 =========================================================");
                    Serial.printf("🚨 [WATCHDOG FAILSAFE] Link lost for %lu ms during ARMED flight!\n", silenceMs);
                    Serial.println("🚨 Triggering localized MAVLink RTL (Mode 6) failsafe injection!");
                    Serial.println("🚨 =========================================================\n");
                }

                // Throttle RTL injection to 1 Hz
                if (now - watchdog.lastRtlInjectionMs >= 1000) {
                    watchdog.lastRtlInjectionMs = now;
                    watchdog.totalFailsafeInjections++;

                    QueuePacket rtlPkt;
                    rtlPkt.type = PKT_TYPE_MAVLINK_BINARY;
                    rtlPkt.length = (uint16_t)MavlinkV2Parser::buildRtlCommand(rtlPkt.data, (uint8_t)(watchdog.totalFailsafeInjections & 0xFF));

                    if (qEmergencyUplink != nullptr) {
                        xQueueSend(qEmergencyUplink, &rtlPkt, 0);
                    }
                }
            }
        }

        // 6. Forward Telemetry from Core 1 to Cloud Relay
        if (qTxToCloud != nullptr && wsClient.available()) {
            while (xQueueReceive(qTxToCloud, &outPkt, 0) == pdTRUE) {
                if (outPkt.type == PKT_TYPE_JSON_TEXT) {
                    // Flush pending binary telemetry batch first to preserve temporal order
                    if (batchLen > 0) {
                        wsClient.sendBinary((const char*)binaryBatch, batchLen);
                        totalMavlinkPacketsSent++;
                        batchLen = 0;
                    }
                    // Immediate high-priority transmission of QR_ALERT JSON frame
                    wsClient.send((const char*)outPkt.data);
                } else if (outPkt.type == PKT_TYPE_MAVLINK_BINARY) {
                    if (batchLen + outPkt.length > sizeof(binaryBatch)) {
                        wsClient.sendBinary((const char*)binaryBatch, batchLen);
                        totalMavlinkPacketsSent++;
                        batchLen = 0;
                    }
                    memcpy(binaryBatch + batchLen, outPkt.data, outPkt.length);
                    batchLen += outPkt.length;
                }
            }

            // Flush binary batch if >= 256 bytes or 12 ms elapsed
            if (batchLen > 0 && (batchLen >= 256 || (now - lastBatchFlush >= 12))) {
                wsClient.sendBinary((const char*)binaryBatch, batchLen);
                totalMavlinkPacketsSent++;
                batchLen = 0;
                lastBatchFlush = now;
            }
        } else {
            // Drop stale telemetry if WebSocket is disconnected to avoid heap exhaustion
            if (qTxToCloud != nullptr) {
                while (xQueueReceive(qTxToCloud, &outPkt, 0) == pdTRUE) {
                    // Discard stale frame
                }
            }
            batchLen = 0;
        }

        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

// =====================================================================================
// SETUP & SYSTEM INITIALIZATION
// =====================================================================================
void setup() {
    esp_brownout_disable();
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

    Serial.begin(115200);

    unsigned long startWait = millis();
    while (!Serial && millis() - startWait < 3000) {
        delay(50);
    }
    delay(200);

    Serial.println();
    Serial.println("=========================================================");
    Serial.println("🚀 SAE INDIA — S500-AERORECON DUAL-CORE RELAY FIRMWARE");
    Serial.println("   FreeRTOS Core 1 (UART / MAVLink) + Core 0 (WSS / Safety)");
    Serial.println("=========================================================");
    Serial.println("📋 Hardware Target:     ESP32-S3 (Xtensa LX7 @ 240 MHz)");
    Serial.println("🔌 TELEM2 Pins:         GPIO 18 (RX1) / GPIO 17 (TX1) [Auto-Probed]");
    Serial.println("⚡ UART Auto-Prober:    115200 & 921600 baud (1500 ms header timeout)");
    Serial.println("📦 Ring Buffer:         16 KB Lock-Free Circular SRAM Buffer");
    Serial.printf("☁️  Cloud Endpoint:      %s\n", RELAY_HOST);
    Serial.printf("📡 Target Wi-Fi SSID:   %s\n", WIFI_SSID);
    Serial.println("=========================================================\n");

    if (STATUS_LED_PIN >= 0) {
        pinMode(STATUS_LED_PIN, OUTPUT);
        digitalWrite(STATUS_LED_PIN, LOW);
    }

    ensureSaneSystemClock();
    WiFi.onEvent(onWiFiEvent);

    // Initialize Lock-Free Ring Buffer (16 KB in internal SRAM)
    if (!uartRingBuffer.init()) {
        Serial.println("❌ [CRITICAL] Failed to initialize 16 KB LockFreeRingBuffer!");
    } else {
        Serial.println("✅ [MEMORY] 16 KB LockFreeRingBuffer allocated in internal SRAM.");
    }

    // Allocate FreeRTOS cross-core queues
    qTxToCloud       = xQueueCreate(32, sizeof(QueuePacket));
    qRxFromCloud     = xQueueCreate(16, sizeof(QueuePacket));
    qEmergencyUplink = xQueueCreate(8,  sizeof(QueuePacket));

    if (qTxToCloud == nullptr || qRxFromCloud == nullptr || qEmergencyUplink == nullptr) {
        Serial.println("❌ [CRITICAL] Failed to allocate FreeRTOS Queues!");
    } else {
        Serial.println("✅ [FREERTOS] Thread-safe inter-core queues allocated.");
    }

    // Initialize UART Probing FSM on Hardware UART1
    PixhawkSerial.setRxBufferSize(4096);
    PixhawkSerial.setTxBufferSize(2048);
    uartProber.begin(&PixhawkSerial);

    // Configure WebSocket Client
    wsClient.setCACert(RENDER_CA_BUNDLE);
    wsClient.addHeader("x-relay-token", RELAY_TOKEN);
    wsClient.onMessage(onMessageCallback);
    wsClient.onEvent(onEventsCallback);

    // Initial fast Wi-Fi connect
    connectToWiFi(true);

    // Pin Real-Time UART Engine Task to Core 1 (Priority 3)
    xTaskCreatePinnedToCore(
        taskUartReceiver,
        "TaskUartRx",
        8192,
        nullptr,
        3,
        nullptr,
        1
    );

    // Pin Wireless Transport & Safety Watchdog Task to Core 0 (Priority 2)
    xTaskCreatePinnedToCore(
        taskCloudRelay,
        "TaskCloudRelay",
        12288,
        nullptr,
        2,
        nullptr,
        0
    );
}

// =====================================================================================
// MAIN LOOP: DIAGNOSTIC MONITOR & AUTO-PROBER TICK
// =====================================================================================
void loop() {
    // Tick UART Auto-Prober FSM (switches candidate if timeout expires without STX)
    uartProber.update();

    // Periodic 3-second diagnostic printout
    if (millis() - lastDiagnosticPrint >= DIAGNOSTIC_INTERVAL_MS) {
        lastDiagnosticPrint = millis();

        Serial.printf("📊 [MONITOR] Wi-Fi: %s | Cloud: %s | TELEM2 (%lu baud, RX%d): %s | Pixhawk RX: %lu B | TX: %lu B | Sent: %lu | QRs: %lu | Failsafe: %s\n",
                      WiFi.status() == WL_CONNECTED ? "ONLINE ✓" : "OFFLINE ✗",
                      wsClient.available() ? "STREAMING ✓" : "CONNECTING...",
                      (unsigned long)uartProber.getActiveBaud(),
                      uartProber.getActiveRxPin(),
                      uartProber.isLocked() ? "LOCKED ✓" : "PROBING...",
                      totalRxBytesFromPixhawk,
                      totalTxBytesToPixhawk,
                      totalMavlinkPacketsSent,
                      totalQrAlertsEmitted,
                      watchdog.rtlFailsafeTriggered ? "ACTIVE 🚨" : (watchdog.isArmed ? "ARMED (OK)" : "DISARMED"));
    }

    delay(50);
}
