/*
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
 * ESP32-S3 Cloud Relay Direct WSS Client (Standalone / Zero-Laptop Mode)
 * FreeRTOS Dual-Core Architecture | MAVLink Frame Assembler | QR Code Interceptor
 * =====================================================================================
 *
 * HARDWARE: ESP32-S3 (Dual Core 240 MHz, 8MB PSRAM)
 * 
 * EXACT WIRING:
 *   PIXHAWK TELEM2                     ESP32-S3
 *   -----------------                  -----------------
 *   Pin 1  +5V        ───────────────  NC (Powered by external isolated 5V 3A UBEC + 1000uF cap)
 *   Pin 2  TX         ───────────────  GPIO 18 (RX on ESP32-S3 UART1)
 *   Pin 3  RX         ───────────────  GPIO 17 (TX on ESP32-S3 UART1)
 *   Pin 4  CTS        ───────────────  NC (Not connected)
 *   Pin 5  RTS        ───────────────  NC (Not connected)
 *   Pin 6  GND        ───────────────  GND (Common Ground)
 *
 * DUAL-CORE FREERTOS THREADING MODEL:
 *   - CORE 1 (High Priority 3): UART MAVLink Driver & Frame Assembler
 *       * Drains Pixhawk TELEM2 hardware FIFO continuously at 1ms resolution.
 *       * Parses complete MAVLink v1 (0xFE) and v2 (0xFD) frames.
 *       * Intercepts STATUSTEXT (msgid 253) for "QR_CODE:" and emits high-priority QR_ALERT.
 *       * Pushes complete frames to thread-safe FreeRTOS queue (qTxToCloud).
 *       * Drains inbound commands from (qRxFromCloud) and writes to Pixhawk TELEM2.
 *   - CORE 0 (Priority 2): Wi-Fi Network & WebSocket SSL Client
 *       * Manages 802.11b/g/n radio, PMF, channel locking, and connection state.
 *       * Runs WebSocket client poll, SSL encryption, and heartbeat pings.
 *       * Flushes batched MAVLink telemetry and instant QR_ALERT JSON frames to Render cloud.
 *       * Feeds inbound phone GCS commands to qRxFromCloud.
 *
 * PRESERVED ZERO-REGRESSION WI-FI & SSL FIXES:
 *   1. Pre-scan 2.4 GHz channel discovery & fast channel locking before WiFi.begin()
 *   2. ESP-IDF 5.x PMF (Protected Management Frames) via esp_wifi_get_config / set_config
 *   3. WiFi.setSleep(false) invoked prior to association to keep radio awake for 4-way handshake
 *   4. WiFi.persistent(false) + WiFi.disconnect(true) to flush stale NVS cache
 *   5. 20-second non-blocking retry timer with immediate timestamp reset at top of block
 *   6. Explicit 802.11b/g/n protocol enforcement
 *   7. 3-stage WSS reconnect fallback (URL -> Host/Port/Path -> Insecure SSL fallback)
 * =====================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoWebsockets.h>
using namespace websockets;
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "esp_wifi.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "soc/rtc_cntl_struct.h"

// Disable hardware Brownout Detector at earliest C initialization (before RTOS/setup)
// to prevent reboot loops when powered over computer USB cables or during Wi-Fi transmit bursts
__attribute__((constructor)) static void disable_bod_early_boot() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
}

// =====================================================================================
// 1. WI-FI CONFIGURATION (Phone Hotspot or Field Wi-Fi)
// =====================================================================================
const char* WIFI_SSID     = "drone123";
const char* WIFI_PASSWORD = "drone@123";

const char* FALLBACK_SSID = "";
const char* FALLBACK_PASS = "";

// =====================================================================================
// 2. CLOUD RELAY WSS CONFIGURATION
// =====================================================================================
const char* RELAY_HOST    = "dronebackend-ppgp.onrender.com";
const uint16_t RELAY_PORT = 443;
const char* RELAY_PATH    = "/connector?token=saeindia_secret_token_2026";
const char* RELAY_WSS_URL = "wss://dronebackend-ppgp.onrender.com/connector?token=saeindia_secret_token_2026";
const char* RELAY_TOKEN   = "saeindia_secret_token_2026";

// Combined Root CA Certificate Bundle trusted by Render.com & Cloudflare:
// 1. Google Trust Services (GTS Root R4) - Cross-signed by GlobalSign
// 2. GlobalSign Root CA
const char RENDER_CA_BUNDLE[] PROGMEM = 
"-----BEGIN CERTIFICATE-----\n"
"MIIDejCCAmKgAwIBAgIQf+UwvzMTQ77dghYQST2KGzANBgkqhkiG9w0BAQsFADBX\n"
"MQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2lnbiBudi1zYTEQMA4GA1UE\n"
"CxMHUm9vdCBDQTEbMBkGA1UEAxMSR2xvYmFsU2lnbiBSb290IENBMB4XDTIzMTEx\n"
"NTAzNDMyMVoXDTI4MDEyODAwMDA0MlowRzELMAkGA1UEBhMCVVMxIjAgBgNVBAoT\n"
"GUdvb2dsZSBUcnVzdCBTZXJ2aWNlcyBMTEMxFDASBgNVBAMTC0dUUyBSb290IFI0\n"
"MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE83Rzp2iLYK5DuDXFgTB7S0md+8Fhzube\n"
"Rr1r1WEYNa5A3XP3iZEwWus87oV8okB2O6nGuEfYKueSkWpz6bFyOZ8pn6KY019e\n"
"WIZlD6GEZQbR3IvJx3PIjGov5cSr0R2Ko4H/MIH8MA4GA1UdDwEB/wQEAwIBhjAd\n"
"BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDwYDVR0TAQH/BAUwAwEB/zAd\n"
"BgNVHQ4EFgQUgEzW63T/STaj1dj8tT7FavCUHYwwHwYDVR0jBBgwFoAUYHtmGkUN\n"
"l8qJUC99BM00qP/8/UswNgYIKwYBBQUHAQEEKjAoMCYGCCsGAQUFBzAChhpodHRw\n"
"Oi8vaS5wa2kuZ29vZy9nc3IxLmNydDAtBgNVHR8EJjAkMCKgIKAehhxodHRwOi8v\n"
"Yy5wa2kuZ29vZy9yL2dzcjEuY3JsMBMGA1UdIAQMMAowCAYGZ4EMAQIBMA0GCSqG\n"
"SIb3DQEBCwUAA4IBAQAYQrsPBtYDh5bjP2OBDwmkoWhIDDkic574y04tfzHpn+cJ\n"
"odI2D4SseesQ6bDrarZ7C30ddLibZatoKiws3UL9xnELz4ct92vID24FfVbiI1hY\n"
"+SW6FoVHkNeWIP0GCbaM4C6uVdF5dTUsMVs/ZbzNnIdCp5Gxmx5ejvEau8otR/Cs\n"
"kGN+hr/W5GvT1tMBjgWKZ1i4//emhA1JG1BbPzoLJQvyEotc03lXjTaCzv8mEbep\n"
"8RqZ7a2CPsgRbuvTPBwcOMBBmuFeU88+FSBX6+7iP0il8b4Z0QFqIwwMHfs/L6K1\n"
"vepuoxtGzi4CZ68zJpiq1UvSqTbFJjtbD4seiMHl\n"
"-----END CERTIFICATE-----\n"
"-----BEGIN CERTIFICATE-----\n"
"MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG\n"
"A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv\n"
"b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw\n"
"MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i\n"
"YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT\n"
"aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ\n"
"jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp\n"
"xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp\n"
"1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG\n"
"snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ\n"
"U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8\n"
"9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E\n"
"BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B\n"
"AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz\n"
"yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE\n"
"38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP\n"
"AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad\n"
"DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME\n"
"HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==\n"
"-----END CERTIFICATE-----\n";

// =====================================================================================
// 3. PIXHAWK TELEM2 UART CONFIGURATION
// =====================================================================================
#define PIXHAWK_RX_PIN    18     // ESP32-S3 GPIO 18 connects to Pixhawk TELEM2 Pin 2 (TX)
#define PIXHAWK_TX_PIN    17     // ESP32-S3 GPIO 17 connects to Pixhawk TELEM2 Pin 3 (RX)
#define PIXHAWK_RX_BUF    4096   // Expanded 4KB RX FIFO buffer (prevents overflow during TLS delays)
#define PIXHAWK_TX_BUF    2048   // Expanded 2KB TX FIFO buffer

const uint32_t TELEM2_BAUDS[] = {57600, 115200};
uint8_t currentBaudIdx = 0;
uint32_t activePixhawkBaud = 57600;
bool isBaudLocked = false;
unsigned long lastBaudSwitchTime = 0;

#define STATUS_LED_PIN    2

// =====================================================================================
// 4. FREERTOS INTER-TASK DATA STRUCTURES & QUEUES
// =====================================================================================
#define MAX_PACKET_LEN    512

enum PacketType : uint8_t {
  PKT_TYPE_MAVLINK_BINARY = 0,
  PKT_TYPE_JSON_TEXT      = 1
};

struct QueuePacket {
  PacketType type;
  uint16_t length;
  uint8_t data[MAX_PACKET_LEN];
};

// Thread-safe queues for cross-core packet exchange
QueueHandle_t qTxToCloud    = nullptr;  // Producer: Core 1 (UART RX) -> Consumer: Core 0 (WSS TX)
QueueHandle_t qRxFromCloud  = nullptr;  // Producer: Core 0 (WSS RX) -> Consumer: Core 1 (UART TX)

// =====================================================================================
// GLOBAL OBJECTS & TELEMETRY COUNTERS
// =====================================================================================
using namespace websockets;
WebsocketsClient wsClient;

// Hardware UART1 on ESP32-S3 for Pixhawk TELEM2
HardwareSerial PixhawkSerial(1);

unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL_MS = 10000; // 10-second heartbeat for Render.com

unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL_MS = 3000;

// Wi-Fi Connection Management
unsigned long wifiConnectionStartTime = 0;
uint8_t wifiAttemptCount = 0;
bool usingFallback = false;

// Periodic 3-second live diagnostic print timer
unsigned long lastDiagnosticPrint = 0;
const unsigned long DIAGNOSTIC_INTERVAL_MS = 3000;

// Cumulative statistics
unsigned long totalRxBytesFromPixhawk = 0;
unsigned long totalTxBytesToPixhawk   = 0;
unsigned long totalMavlinkPacketsSent = 0;
unsigned long totalCommandsReceived   = 0;
unsigned long totalQrAlertsEmitted    = 0;

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
// BASELINE SYSTEM CLOCK INITIALIZATION (CRITICAL FOR SSL/TLS VALIDATION)
// =====================================================================================
void ensureSaneSystemClock() {
  time_t now = time(nullptr);
  if (now < 1735689600) { // If before Jan 1, 2025
    struct timeval tv;
    tv.tv_sec = 1793966000; // Baseline epoch (November 2026, valid within Render SSL certificate window)
    tv.tv_usec = 0;
    settimeofday(&tv, nullptr);
    Serial.println("🕒 [TIME] Initialized baseline system clock (Nov 2026) for instant TLS validation.");
  }
}

// =====================================================================================
// WI-FI DISCONNECT REASON DECODER & EVENT HANDLERS
// =====================================================================================
const char* getWiFiDisconnectReason(uint8_t reason) {
  switch (reason) {
    case 1:   return "UNSPECIFIED";
    case 2:   return "AUTH_EXPIRE (Authentication expired / PMF mismatch)";
    case 3:   return "AUTH_LEAVE (Left network)";
    case 4:   return "ASSOC_EXPIRE (Association expired)";
    case 5:   return "ASSOC_TOOMANY (Too many associations on AP)";
    case 6:   return "NOT_AUTHED (Not authenticated)";
    case 7:   return "NOT_ASSOCED (Not associated)";
    case 8:   return "ASSOC_LEAVE (Station left AP)";
    case 15:  return "4WAY_HANDSHAKE_TIMEOUT (Wrong password 'drone@123' or weak signal)";
    case 200: return "BEACON_TIMEOUT (Signal lost / hotspot out of range)";
    case 201: return "NO_AP_FOUND (SSID 'drone123' not found on 2.4 GHz)";
    case 202: return "AUTH_FAIL (Incorrect password / 'drone@123' rejected)";
    case 203: return "ASSOC_FAIL (Hotspot rejected association)";
    case 204: return "HANDSHAKE_TIMEOUT (WPA2/WPA3 handshake failed)";
    case 205: return "CONNECTION_FAIL";
    default:  return "UNKNOWN_REASON";
  }
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      Serial.println("📡 [WIFI EVENT] Wi-Fi station active. Searching spectrum...");
      break;
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      Serial.println("🤝 [WIFI EVENT] Associated with hotspot! Requesting IP lease (DHCP)...");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.printf("🟢 [WIFI EVENT] IP lease granted: %s\n", WiFi.localIP().toString().c_str());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
      uint8_t reason = info.wifi_sta_disconnected.reason;
      Serial.printf("⚠️ [WIFI EVENT] Disconnected / Connect failed. Code %d: %s\n",
                    reason, getWiFiDisconnectReason(reason));
      if (reason == 201) {
        Serial.println("   👉 iPhone: Turn ON 'Maximize Compatibility' in Personal Hotspot!");
        Serial.println("   👉 Android: Set Hotspot band to '2.4 GHz' (ESP32 cannot see 5 GHz)!");
        Serial.println("   👉 Keep hotspot settings screen open on phone while connecting!");
      } else if (reason == 202 || reason == 15 || reason == 204) {
        Serial.println("   👉 Verify Wi-Fi password is typed exactly: drone@123");
      }
      break;
    }
    default:
      break;
  }
}

// =====================================================================================
// WEBSOCKET EVENT CALLBACKS (CORE 0 CONTEXT)
// =====================================================================================
void onMessageCallback(WebsocketsMessage message) {
  if (message.isBinary()) {
    // Binary MAVLink command frame received from Phone GCS -> forward to Core 1 via queue
    size_t length = message.length();
    if (length > 0 && length <= MAX_PACKET_LEN && qRxFromCloud != nullptr) {
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
    Serial.println("\n");
    Serial.println("*********************************************************");
    Serial.println("🟢 [WSS CLOUD RELAY] >>> CONNECTED SUCCESSFULLY! <<<");
    Serial.println("🌐 Drone is now online in the cloud. Dual-Core engine active!");
    Serial.println("*********************************************************\n");
    updateLED(2);

    wsClient.send("{\"type\":\"ESP32_STATUS\",\"status\":\"CONNECTED\",\"device\":\"ESP32_S3_DUAL_CORE_RTOS\"}");
  } else if (event == WebsocketsEvent::ConnectionClosed) {
    Serial.println("\n🔴 [WSS CLOUD RELAY] Connection closed. Will reconnect automatically...");
    updateLED(0);
  } else if (event == WebsocketsEvent::GotPing) {
    wsClient.pong();
  } else if (event == WebsocketsEvent::GotPong) {
    // Pong acknowledged
  }
}

// =====================================================================================
// WI-FI PRE-SCAN DIAGNOSTIC & CHANNEL DISCOVERY
// =====================================================================================
bool scanForTargetNetwork(const char* targetSSID, int32_t &foundChannel) {
  Serial.printf("\n🔍 [WIFI PRE-SCAN] Scanning 2.4 GHz spectrum for '%s' ...\n", targetSSID);
  int n = WiFi.scanNetworks(false, false, false, 250);
  bool found = false;
  if (n <= 0) {
    Serial.println("   ❌ No 2.4 GHz Wi-Fi networks found in the air!");
    Serial.println("   👉 iPhone Users: Open Settings -> Personal Hotspot -> Turn ON 'Maximize Compatibility'!");
    Serial.println("   👉 Android Users: Open Hotspot Settings -> Set AP Band to '2.4 GHz'!");
  } else {
    Serial.printf("   Found %d visible 2.4 GHz networks:\n", n);
    for (int i = 0; i < n; ++i) {
      String ssid = WiFi.SSID(i);
      int32_t rssi = WiFi.RSSI(i);
      int32_t chan = WiFi.channel(i);
      bool isMatch = (ssid == targetSSID);
      Serial.printf("   %2d) %s '%s' (Signal: %d dBm, Ch: %d) %s\n",
                    i + 1,
                    isMatch ? "🎯" : "  ",
                    ssid.c_str(),
                    rssi,
                    chan,
                    isMatch ? "<-- TARGET DETECTED!" : "");
      if (isMatch && !found) {
        found = true;
        foundChannel = chan;
      }
    }
  }
  WiFi.scanDelete();
  Serial.println("---------------------------------------------------------");
  return found;
}

// =====================================================================================
// WI-FI CONNECTION HELPER (PRESERVING ALL FIXES)
// =====================================================================================
void startWiFiConnection(const char* ssid, const char* pass, int32_t channel = 0) {
  Serial.println("---------------------------------------------------------");
  Serial.printf("📡 [WIFI] Initiating connection to SSID: '%s' ...\n", ssid);
  if (channel > 0) {
    Serial.printf("⚡ [WIFI] Fast-locking to pre-scanned Channel: %d\n", channel);
  }
  Serial.println("---------------------------------------------------------");

  // Prevent ESP32 from using stale/corrupt cached NVS Wi-Fi state
  WiFi.persistent(false);
  WiFi.disconnect(true);
  delay(100);

  WiFi.mode(WIFI_STA);

  // Configure PMF (Protected Management Frames) for modern iPhone/Android WPA2/WPA3 compatibility
  wifi_config_t conf;
  if (esp_wifi_get_config(WIFI_IF_STA, &conf) == ESP_OK) {
    conf.sta.pmf_cfg.capable = true;
    conf.sta.pmf_cfg.required = false;
    esp_wifi_set_config(WIFI_IF_STA, &conf);
  }

  // Enforce standard 802.11 b/g/n protocols
  esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N);

  // CRITICAL: Disable 802.11 modem sleep BEFORE begin() so radio doesn't miss beacons or handshake frames
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
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
    bool found = scanForTargetNetwork(activeSSID, targetChannel);
    if (!found) {
      Serial.printf("⚠️ [WIFI NOTE] '%s' not seen in pre-scan. Attempting direct broadcast connect...\n", activeSSID);
    }
  }

  startWiFiConnection(activeSSID, activePass, targetChannel);

  if (isInitialSetup) {
    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
      delay(250);
      Serial.print(".");
      updateLED(1);
    }
    Serial.println();
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n🟢 [WIFI] CONNECTED SUCCESSFULLY!");
    Serial.printf("📍 [WIFI] IP Address:    %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("📶 [WIFI] Signal (RSSI):  %d dBm\n", WiFi.RSSI());
    Serial.printf("🚪 [WIFI] Gateway:        %s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("🔍 [WIFI] DNS Server:    %s\n", WiFi.dnsIP().toString().c_str());
    updateLED(2);

    ensureSaneSystemClock();

    Serial.println("⏳ [NTP] Synchronizing network time...");
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    Serial.println("---------------------------------------------------------");
  } else if (isInitialSetup) {
    Serial.println("\n⚠️ [WIFI PENDING] Hotspot not connected within 15s. Background retries active.");
    Serial.println("   👉 Hotspot Tips:");
    Serial.println("      1. Keep the 'Personal Hotspot' screen OPEN on your phone.");
    Serial.println("      2. iPhone: Turn ON 'Maximize Compatibility'.");
    Serial.println("      3. Android: Set Hotspot band to '2.4 GHz' (ESP32 cannot see 5 GHz).");
    Serial.printf("      4. Target SSID: '%s' | Password: '%s'\n", activeSSID, activePass);
    Serial.println("---------------------------------------------------------");
  }
}

// Background Wi-Fi monitor called periodically from Core 0
void handleWiFiMaintenance() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiAttemptCount = 0;
    return;
  }

  updateLED(1);

  if (millis() - wifiConnectionStartTime > 20000) {
    wifiConnectionStartTime = millis();
    wifiAttemptCount++;
    Serial.printf("\n⚠️ [WIFI RETRY] Re-attempting Wi-Fi connection (Attempt #%d)...\n", wifiAttemptCount);

    if (strlen(FALLBACK_SSID) > 0) {
      usingFallback = !usingFallback;
    }

    const char* targetSSID = usingFallback ? FALLBACK_SSID : WIFI_SSID;
    const char* targetPass = usingFallback ? FALLBACK_PASS : WIFI_PASSWORD;

    WiFi.disconnect(true);
    delay(100);
    startWiFiConnection(targetSSID, targetPass);

    if (wifiAttemptCount >= 3) {
      wifiAttemptCount = 0;
      Serial.println("⚠️ [WIFI] Multiple attempts failed. Quick checklist:");
      Serial.println("   1. Is your phone hotspot ON with screen unlocked?");
      Serial.println("   2. iPhone: 'Maximize Compatibility' ON?");
      Serial.println("   3. Android: Band set to '2.4 GHz'?");
      Serial.printf("   4. SSID: '%s' | Pass: '%s'\n", targetSSID, targetPass);
    }
  }
}

// =====================================================================================
// CLOUD RELAY CONNECTION HELPER (CORE 0 CONTEXT)
// =====================================================================================
void connectToCloudRelay() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (wsClient.available()) return;

  if (millis() - lastReconnectAttempt < RECONNECT_INTERVAL_MS) return;
  lastReconnectAttempt = millis();

  // 1. Verify DNS resolution
  IPAddress relayIP;
  if (!WiFi.hostByName(RELAY_HOST, relayIP)) {
    Serial.printf("❌ [DNS FAILED] Could not resolve '%s' via DNS %s. Check Internet connection!\n",
                  RELAY_HOST, WiFi.dnsIP().toString().c_str());
    return;
  }
  Serial.printf("🌐 [DNS OK] %s -> %s\n", RELAY_HOST, relayIP.toString().c_str());

  ensureSaneSystemClock();

  Serial.println("☁️  [WSS] Connecting to Render Cloud Relay via SSL...");
  Serial.printf("🔗 [WSS] URL: %s\n", RELAY_WSS_URL);
  
  wsClient.setCACert(RENDER_CA_BUNDLE);
  wsClient.addHeader("x-relay-token", RELAY_TOKEN);

  bool connected = wsClient.connect(RELAY_WSS_URL);

  if (!connected) {
    Serial.println("⚠️  [WSS] URL connect failed, trying explicit host/port/path...");
    connected = wsClient.connectSecure(RELAY_HOST, RELAY_PORT, RELAY_PATH);
  }

  if (!connected) {
    Serial.println("⚠️  [WSS] CA certificate verify failed, attempting SSL connection with insecure fallback...");
    wsClient.setInsecure();
    wsClient.addHeader("x-relay-token", RELAY_TOKEN);
    connected = wsClient.connect(RELAY_WSS_URL);
    if (!connected) {
      connected = wsClient.connectSecure(RELAY_HOST, RELAY_PORT, RELAY_PATH);
    }
  }

  if (!connected) {
    Serial.println("⚠️  [WSS] Connection attempt failed. Retrying in 3 seconds...");
  }
}

// =====================================================================================
// MAVLINK PROTOCOL FRAME ASSEMBLER & QR STATUSTEXT INTERCEPTOR (CORE 1)
// =====================================================================================
enum MavParseState : uint8_t {
  MAV_STATE_IDLE = 0,
  MAV_STATE_GOT_STX,
  MAV_STATE_V1_HDR,
  MAV_STATE_V2_HDR,
  MAV_STATE_PAYLOAD_CRC
};

struct MavFrameAssembler {
  MavParseState state = MAV_STATE_IDLE;
  uint8_t buffer[MAX_PACKET_LEN];
  uint16_t index = 0;
  uint16_t expectedLength = 0;
  uint8_t magic = 0;
  uint8_t payloadLen = 0;
  uint32_t msgId = 0;
};

static MavFrameAssembler assembler;

// Inspect assembled MAVLink frame for MAVLINK_MSG_ID_STATUSTEXT (ID 253)
void inspectAndHandleFrame(const uint8_t* frame, uint16_t len, uint32_t msgId, uint8_t magic) {
  if (msgId == 253 && len >= 15) {
    // STATUSTEXT payload starts at byte 6 in MAVLink 1, byte 10 in MAVLink 2
    uint16_t payloadOffset = (magic == 0xFE) ? 6 : 10;
    
    // In MAVLink STATUSTEXT: severity (1 byte), text (50 bytes)
    // Scan up to 50 bytes of payload for "QR_CODE:"
    const char* payloadText = (const char*)(frame + payloadOffset + 1);
    uint16_t maxScan = (len > payloadOffset + 1) ? (len - (payloadOffset + 1)) : 0;
    if (maxScan > 50) maxScan = 50;

    for (uint16_t i = 0; i + 8 <= maxScan; ++i) {
      if (strncmp(payloadText + i, "QR_CODE:", 8) == 0) {
        const char* digitPtr = payloadText + i + 8;
        char digits[16] = {0};
        uint8_t dIdx = 0;
        while (dIdx < 15 && digitPtr[dIdx] != '\0' && digitPtr[dIdx] != ' ' && digitPtr[dIdx] != '\r' && digitPtr[dIdx] != '\n') {
          if (digitPtr[dIdx] >= '0' && digitPtr[dIdx] <= '9') {
            digits[dIdx] = digitPtr[dIdx];
            dIdx++;
          } else {
            break;
          }
        }
        digits[dIdx] = '\0';

        if (dIdx > 0 && qTxToCloud != nullptr) {
          QueuePacket qrPkt;
          qrPkt.type = PKT_TYPE_JSON_TEXT;
          int n = snprintf((char*)qrPkt.data, MAX_PACKET_LEN,
                           "{\"type\":\"QR_ALERT\",\"digits\":\"%s\",\"timestamp\":%lu}",
                           digits, millis());
          if (n > 0) {
            qrPkt.length = (uint16_t)n;
            xQueueSend(qTxToCloud, &qrPkt, 0); // Fast non-blocking enqueue
            totalQrAlertsEmitted++;
            Serial.printf("🎯 [QR STATUSTEXT INTERCEPTED] Digits='%s' -> Dispatched high-priority QR_ALERT!\n", digits);
          }
        }
        break;
      }
    }
  }
}

// Feeds incoming raw bytes through MAVLink frame assembler
void processIncomingUartByte(uint8_t b) {
  totalRxBytesFromPixhawk++;

  if ((b == 0xFE || b == 0xFD) && !isBaudLocked) {
    isBaudLocked = true;
    Serial.printf("\n🎯 [TELEM2 LOCKED] Valid MAVLink framing (0x%02X) confirmed at %lu baud!\n", b, (unsigned long)activePixhawkBaud);
  }

  switch (assembler.state) {
    case MAV_STATE_IDLE:
      if (b == 0xFE || b == 0xFD) {
        assembler.magic = b;
        assembler.buffer[0] = b;
        assembler.index = 1;
        assembler.msgId = 0;
        assembler.payloadLen = 0;
        assembler.state = MAV_STATE_GOT_STX;
      }
      break;

    case MAV_STATE_GOT_STX:
      assembler.buffer[assembler.index++] = b;
      assembler.payloadLen = b;
      if (assembler.magic == 0xFE) {
        // MAVLink 1: Header (6 bytes: STX, LEN, SEQ, SYS, COMP, MSGID) + Payload + CRC (2 bytes)
        assembler.expectedLength = (uint16_t)assembler.payloadLen + 8;
        assembler.state = MAV_STATE_V1_HDR;
      } else {
        // MAVLink 2: Header (10 bytes) + Payload + CRC (2 bytes) + optional signature (13 bytes)
        assembler.state = MAV_STATE_V2_HDR;
      }
      break;

    case MAV_STATE_V1_HDR:
      assembler.buffer[assembler.index++] = b;
      if (assembler.index == 6) {
        assembler.msgId = assembler.buffer[5];
        assembler.state = MAV_STATE_PAYLOAD_CRC;
      }
      break;

    case MAV_STATE_V2_HDR:
      assembler.buffer[assembler.index++] = b;
      if (assembler.index == 10) {
        uint8_t incompatFlags = assembler.buffer[2];
        uint8_t sigLen = (incompatFlags & 0x01) ? 13 : 0;
        assembler.expectedLength = (uint16_t)10 + assembler.payloadLen + 2 + sigLen;
        assembler.msgId = (uint32_t)assembler.buffer[7] |
                          ((uint32_t)assembler.buffer[8] << 8) |
                          ((uint32_t)assembler.buffer[9] << 16);
        assembler.state = MAV_STATE_PAYLOAD_CRC;
      }
      break;

    case MAV_STATE_PAYLOAD_CRC:
      if (assembler.index < MAX_PACKET_LEN) {
        assembler.buffer[assembler.index++] = b;
      } else {
        // Overflow safety reset
        assembler.state = MAV_STATE_IDLE;
        break;
      }

      if (assembler.index >= assembler.expectedLength) {
        // Complete MAVLink frame assembled
        inspectAndHandleFrame(assembler.buffer, assembler.index, assembler.msgId, assembler.magic);

        // Enqueue binary telemetry frame to Cloud transmitter queue
        if (qTxToCloud != nullptr) {
          QueuePacket pkt;
          pkt.type = PKT_TYPE_MAVLINK_BINARY;
          pkt.length = assembler.index;
          memcpy(pkt.data, assembler.buffer, assembler.index);
          xQueueSend(qTxToCloud, &pkt, 0); // Drop if queue full to prevent stall
        }

        assembler.state = MAV_STATE_IDLE;
      }
      break;
  }
}

// =====================================================================================
// CORE 1 TASK: HIGH-SPEED MAVLINK UART DRIVER (1MS DRAIN LOOP)
// =====================================================================================
void taskUartReceiver(void* pvParameters) {
  Serial.println("⚡ [TASK CORE 1] UART Receiver & MAVLink Parser active on Core 1 (Priority 3).");

  QueuePacket cmdPkt;

  while (true) {
    // 1. Drain incoming UART bytes from Pixhawk TELEM2 hardware buffer
    while (PixhawkSerial.available() > 0) {
      uint8_t b = (uint8_t)PixhawkSerial.read();
      processIncomingUartByte(b);
    }

    // 2. Transmit queued GCS commands from Cloud -> Pixhawk TELEM2
    if (qRxFromCloud != nullptr) {
      while (xQueueReceive(qRxFromCloud, &cmdPkt, 0) == pdTRUE) {
        PixhawkSerial.write(cmdPkt.data, cmdPkt.length);
        totalTxBytesToPixhawk += cmdPkt.length;
      }
    }

    // Yield 1 millisecond so FreeRTOS scheduler remains responsive
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

// =====================================================================================
// CORE 0 TASK: WI-FI & WEBSOCKET CLOUD RELAY
// =====================================================================================
void taskCloudRelay(void* pvParameters) {
  Serial.println("☁️  [TASK CORE 0] Wi-Fi & WSS Cloud Relay active on Core 0 (Priority 2).");

  QueuePacket outPkt;
  uint8_t binaryBatch[1024];
  size_t batchLen = 0;
  unsigned long lastBatchFlush = millis();

  while (true) {
    // 1. Maintain Wi-Fi Connection
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

    // 3. Poll WebSocket for incoming commands
    if (wsClient.available()) {
      wsClient.poll();
    }

    // 4. Send Periodic Heartbeat Ping (10s interval for Render load balancers)
    if (wsClient.available() && millis() - lastPingTime > PING_INTERVAL_MS) {
      lastPingTime = millis();
      wsClient.ping();
    }

    // 5. Drain transmission queue from Core 1 and forward to Cloud Relay
    if (qTxToCloud != nullptr && wsClient.available()) {
      while (xQueueReceive(qTxToCloud, &outPkt, 0) == pdTRUE) {
        if (outPkt.type == PKT_TYPE_JSON_TEXT) {
          // Flush any pending binary batch first to maintain ordering
          if (batchLen > 0) {
            wsClient.sendBinary((const char*)binaryBatch, batchLen);
            totalMavlinkPacketsSent++;
            batchLen = 0;
          }
          // Instant high-priority JSON alert transmission
          wsClient.send((const char*)outPkt.data);
        } else if (outPkt.type == PKT_TYPE_MAVLINK_BINARY) {
          // Accumulate binary batch
          if (batchLen + outPkt.length > sizeof(binaryBatch)) {
            wsClient.sendBinary((const char*)binaryBatch, batchLen);
            totalMavlinkPacketsSent++;
            batchLen = 0;
          }
          memcpy(binaryBatch + batchLen, outPkt.data, outPkt.length);
          batchLen += outPkt.length;
        }
      }

      // Flush binary batch if buffer reached threshold or timed out (12ms)
      if (batchLen > 0 && (batchLen >= 256 || millis() - lastBatchFlush >= 12)) {
        wsClient.sendBinary((const char*)binaryBatch, batchLen);
        totalMavlinkPacketsSent++;
        batchLen = 0;
        lastBatchFlush = millis();
      }
    } else {
      // If WebSocket is offline, drain queue to prevent stale telemetry buildup
      if (qTxToCloud != nullptr) {
        while (xQueueReceive(qTxToCloud, &outPkt, 0) == pdTRUE) {
          // drop stale frame
        }
      }
      batchLen = 0;
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// =====================================================================================
// SETUP
// =====================================================================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  
  unsigned long startWait = millis();
  while (!Serial && millis() - startWait < 3000) {
    delay(50);
  }
  delay(500);

  Serial.println();
  Serial.println("=========================================================");
  Serial.println("🚀 SAE INDIA — ESP32-S3 DUAL-CORE CLOUD RELAY CLIENT");
  Serial.println("   FreeRTOS Core 1 (UART 1ms) + Core 0 (WSS Cloud)");
  Serial.println("=========================================================");
  Serial.printf("📋 Hardware Target:     ESP32-S3\n");
  Serial.printf("🔌 Pixhawk TELEM2 RX:   GPIO %d (Connects to Pixhawk TX Pin 2)\n", PIXHAWK_RX_PIN);
  Serial.printf("🔌 Pixhawk TELEM2 TX:   GPIO %d (Connects to Pixhawk RX Pin 3)\n", PIXHAWK_TX_PIN);
  Serial.printf("⚡ Pixhawk Baud Rate:   %lu baud (Auto-Sync: 57600 / 115200)\n", (unsigned long)activePixhawkBaud);
  Serial.printf("📦 Hardware UART FIFO:  RX=%d bytes, TX=%d bytes\n", PIXHAWK_RX_BUF, PIXHAWK_TX_BUF);
  Serial.printf("☁️  Cloud Relay Host:   %s\n", RELAY_HOST);
  Serial.printf("📡 Target Wi-Fi SSID:   %s\n", WIFI_SSID);
  Serial.println("=========================================================\n");

  if (STATUS_LED_PIN >= 0) {
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);
  }

  ensureSaneSystemClock();
  WiFi.onEvent(onWiFiEvent);

  // Initialize FreeRTOS Queues
  qTxToCloud   = xQueueCreate(48, sizeof(QueuePacket));
  qRxFromCloud = xQueueCreate(32, sizeof(QueuePacket));
  if (qTxToCloud == nullptr || qRxFromCloud == nullptr) {
    Serial.println("❌ [CRITICAL] Failed to allocate FreeRTOS Queues!");
  } else {
    Serial.println("✅ [FREERTOS] Thread-safe TX and RX queues allocated.");
  }

  // Initialize Pixhawk Hardware UART1 with expanded 4KB RX / 2KB TX buffers
  PixhawkSerial.setRxBufferSize(PIXHAWK_RX_BUF);
  PixhawkSerial.setTxBufferSize(PIXHAWK_TX_BUF);
  PixhawkSerial.begin(activePixhawkBaud, SERIAL_8N1, PIXHAWK_RX_PIN, PIXHAWK_TX_PIN);
  PixhawkSerial.setTimeout(5);
  Serial.printf("✅ [TELEM2 UART] Hardware Serial1 ready on GPIO 18 (RX) and GPIO 17 (TX) @ %lu baud.\n", (unsigned long)activePixhawkBaud);

  // Configure WebSocket Client callbacks, CA certificates, and headers
  wsClient.setCACert(RENDER_CA_BUNDLE);
  wsClient.addHeader("x-relay-token", RELAY_TOKEN);
  wsClient.onMessage(onMessageCallback);
  wsClient.onEvent(onEventsCallback);

  // Initial fast Wi-Fi connect
  connectToWiFi(true);

  // Pin High-Speed MAVLink UART Receiver Task to Core 1 (Priority 3)
  xTaskCreatePinnedToCore(
    taskUartReceiver,
    "TaskUartRx",
    8192,
    nullptr,
    3,
    nullptr,
    1
  );

  // Pin Wi-Fi Network & WebSocket SSL Client Task to Core 0 (Priority 2)
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
// MAIN ARDUINO LOOP (DIAGNOSTIC MONITOR & AUTO-BAUD DETECTOR)
// =====================================================================================
void loop() {
  // Auto-baud switcher: ONLY if not locked AND zero bytes received after 12s
  if (!isBaudLocked && totalRxBytesFromPixhawk == 0 && (millis() - lastBaudSwitchTime > 12000)) {
    lastBaudSwitchTime = millis();
    currentBaudIdx = (currentBaudIdx + 1) % 2;
    activePixhawkBaud = TELEM2_BAUDS[currentBaudIdx];
    
    // Reconfigure hardware UART buffers and baud rate
    PixhawkSerial.setRxBufferSize(PIXHAWK_RX_BUF);
    PixhawkSerial.setTxBufferSize(PIXHAWK_TX_BUF);
    PixhawkSerial.begin(activePixhawkBaud, SERIAL_8N1, PIXHAWK_RX_PIN, PIXHAWK_TX_PIN);
    Serial.printf("🔄 [TELEM2 AUTO-BAUD] Testing %lu baud on TELEM2...\n", (unsigned long)activePixhawkBaud);
  }

  // Periodic 3-Second Live Status Heartbeat
  if (millis() - lastDiagnosticPrint > DIAGNOSTIC_INTERVAL_MS) {
    lastDiagnosticPrint = millis();

    Serial.printf("📊 [MONITOR] Wi-Fi: %s | Cloud: %s | TELEM2 (%lu baud): %s | Pixhawk RX: %lu B | TX: %lu B | Sent: %lu | QRs: %lu\n",
                  WiFi.status() == WL_CONNECTED ? "ONLINE ✓" : "OFFLINE ✗",
                  wsClient.available() ? "STREAMING ✓" : "CONNECTING...",
                  (unsigned long)activePixhawkBaud,
                  isBaudLocked ? "LOCKED ✓" : (totalRxBytesFromPixhawk == 0 ? "NO SIGNAL (Check Pin 18)" : "SYNCING..."),
                  totalRxBytesFromPixhawk,
                  totalTxBytesToPixhawk,
                  totalMavlinkPacketsSent,
                  totalQrAlertsEmitted);
  }

  delay(100);
}
