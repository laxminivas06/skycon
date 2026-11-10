#ifndef MAVLINK_V2_PARSER_H
#define MAVLINK_V2_PARSER_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include "lockfree_ring_buffer.h"

/**
 * =====================================================================================
 * SAE INDIA 2026 — S500-AeroRecon Telemetry Relay Firmware
 * Zero-Copy MAVLink v2 & v1 Parser and Real-Time QR Alert Interceptor
 *
 * SPECIFICATION & CAPABILITIES:
 * - Zero-copy frame inspection directly within the LockFreeRingBuffer.
 * - Validates STX (0xFD for MAVLink v2, 0xFE for MAVLink v1), lengths, and IDs.
 * - Computes ITU X.25 CRC-16 with message-specific CRC_EXTRA lookup.
 * - Decodes HEARTBEAT (#0): extracts custom flight mode, base_mode, and armed state.
 * - Intercepts STATUSTEXT (#253): decodes "QR_CODE:<digits>" instantly.
 * - Builds MAVLink v2 COMMAND_LONG frames for immediate BRAKE (Mode 17) and RTL (Mode 6).
 * =====================================================================================
 */

#define MAVLINK_V2_STX          0xFD
#define MAVLINK_V1_STX          0xFE

#define MAVLINK_MSG_ID_HEARTBEAT            0
#define MAVLINK_MSG_ID_SYS_STATUS           1
#define MAVLINK_MSG_ID_SET_MODE             11
#define MAVLINK_MSG_ID_GPS_RAW_INT          24
#define MAVLINK_MSG_ID_ATTITUDE             30
#define MAVLINK_MSG_ID_GLOBAL_POSITION_INT  33
#define MAVLINK_MSG_ID_COMMAND_LONG         76
#define MAVLINK_MSG_ID_COMMAND_ACK          77
#define MAVLINK_MSG_ID_STATUSTEXT           253

#define MAV_CMD_NAV_RETURN_TO_LAUNCH        20
#define MAV_CMD_DO_SET_MODE                 176

#define ARDUPILOT_MODE_STABILIZE            0
#define ARDUPILOT_MODE_ALT_HOLD             2
#define ARDUPILOT_MODE_AUTO                 3
#define ARDUPILOT_MODE_GUIDED               4
#define ARDUPILOT_MODE_LOITER               5
#define ARDUPILOT_MODE_RTL                  6
#define ARDUPILOT_MODE_BRAKE                17

#define MAV_MODE_FLAG_SAFETY_ARMED          0x80 // 128
#define MAV_MODE_FLAG_CUSTOM_MODE_ENABLED   0x01 // 1

enum MavlinkParseResult {
    PARSE_NEED_MORE = 0,
    PARSE_OK = 1,
    PARSE_NOT_HEADER = 2,
    PARSE_CRC_ERROR = 3
};

struct DecodedMavlinkFrame {
    uint8_t magic;
    uint8_t len;
    uint8_t incompatFlags;
    uint8_t compatFlags;
    uint8_t seq;
    uint8_t sysId;
    uint8_t compId;
    uint32_t msgId;
    uint16_t checksum;
    size_t totalLength;
};

struct VehicleStateTracker {
    bool isArmed;
    uint32_t customFlightMode;
    uint8_t autopilotType;
    uint8_t vehicleType;
    uint8_t baseMode;
    uint8_t systemStatus;
    uint32_t lastHeartbeatMs;
    uint32_t totalPacketsParsed;
    uint32_t totalCrcErrors;
};

// =====================================================================================
// ITU X.25 CRC-16 ALGORITHM IMPLEMENTATION
// =====================================================================================
static inline void crc_accumulate(uint8_t byte, uint16_t* crc) {
    uint8_t tmp = byte ^ (uint8_t)(*crc & 0xFF);
    tmp ^= (tmp << 4);
    *crc = (*crc >> 8) ^ ((uint16_t)tmp << 8) ^ ((uint16_t)tmp << 3) ^ ((uint16_t)tmp >> 4);
}

static inline void crc_init(uint16_t* crc) {
    *crc = 0xFFFF;
}

/**
 * CRC_EXTRA lookup table matching ArduCopter 4.7.2 / MAVLink v2 definitions.
 */
static inline int16_t getMavlinkCrcExtra(uint32_t msgId) {
    switch (msgId) {
        case 0:   return 50;  // HEARTBEAT
        case 1:   return 124; // SYS_STATUS
        case 2:   return 137; // SYSTEM_TIME
        case 4:   return 237; // PING
        case 11:  return 89;  // SET_MODE
        case 20:  return 214; // PARAM_REQUEST_READ
        case 21:  return 159; // PARAM_REQUEST_LIST
        case 22:  return 220; // PARAM_VALUE
        case 23:  return 168; // PARAM_SET
        case 24:  return 24;  // GPS_RAW_INT
        case 26:  return 170; // SCALED_IMU
        case 27:  return 144; // RAW_IMU
        case 29:  return 115; // SCALED_PRESSURE
        case 30:  return 39;  // ATTITUDE
        case 32:  return 185; // LOCAL_POSITION_NED
        case 33:  return 104; // GLOBAL_POSITION_INT
        case 36:  return 222; // SERVO_OUTPUT_RAW
        case 39:  return 254; // MISSION_ITEM
        case 40:  return 230; // MISSION_REQUEST
        case 42:  return 28;  // MISSION_SET_CURRENT
        case 43:  return 132; // MISSION_REQUEST_LIST
        case 44:  return 221; // MISSION_COUNT
        case 45:  return 232; // MISSION_CLEAR_ALL
        case 46:  return 11;  // MISSION_ITEM_REACHED
        case 47:  return 153; // MISSION_ACK
        case 51:  return 196; // MISSION_REQUEST_INT
        case 62:  return 183; // NAV_CONTROLLER_OUTPUT
        case 65:  return 118; // RC_CHANNELS
        case 66:  return 148; // REQUEST_DATA_STREAM
        case 73:  return 38;  // MISSION_ITEM_INT
        case 74:  return 20;  // VFR_HUD
        case 75:  return 158; // COMMAND_INT
        case 76:  return 152; // COMMAND_LONG
        case 77:  return 143; // COMMAND_ACK
        case 116: return 76;  // SCALED_IMU2
        case 124: return 87;  // GPS2_RAW
        case 125: return 203; // POWER_STATUS
        case 147: return 154; // BATTERY_STATUS
        case 163: return 187; // AHRS2
        case 168: return 21;  // WIND
        case 192: return 36;  // MAG_CAL_REPORT
        case 242: return 104; // HOME_POSITION
        case 253: return 83;  // STATUSTEXT
        default:  return -1;  // Unknown message ID: skip CRC_EXTRA validation
    }
}

class MavlinkV2Parser {
public:
    VehicleStateTracker vehicleState;
    char lastQrCodeDigits[32];
    bool qrCodeAlertTriggered;

    MavlinkV2Parser() {
        memset(&vehicleState, 0, sizeof(vehicleState));
        memset(lastQrCodeDigits, 0, sizeof(lastQrCodeDigits));
        qrCodeAlertTriggered = false;
    }

    /**
     * Inspects the next frame in the ring buffer without destroying data (Zero-Copy).
     */
    MavlinkParseResult inspectFrame(const LockFreeRingBuffer& ringBuf, DecodedMavlinkFrame& frame) {
        size_t avail = ringBuf.available();
        if (avail == 0) return PARSE_NEED_MORE;

        uint8_t stx = ringBuf.peek(0);
        if (stx != MAVLINK_V2_STX && stx != MAVLINK_V1_STX) {
            return PARSE_NOT_HEADER;
        }

        // =================================================================================
        // MAVLink v2 Framing (STX = 0xFD)
        // =================================================================================
        if (stx == MAVLINK_V2_STX) {
            if (avail < 10) return PARSE_NEED_MORE; // Header incomplete

            frame.magic = stx;
            frame.len = ringBuf.peek(1);
            frame.incompatFlags = ringBuf.peek(2);
            frame.compatFlags = ringBuf.peek(3);
            frame.seq = ringBuf.peek(4);
            frame.sysId = ringBuf.peek(5);
            frame.compId = ringBuf.peek(6);

            // 24-bit Message ID (little-endian)
            frame.msgId = (uint32_t)ringBuf.peek(7) |
                          ((uint32_t)ringBuf.peek(8) << 8) |
                          ((uint32_t)ringBuf.peek(9) << 16);

            size_t sigLen = (frame.incompatFlags & 0x01) ? 13 : 0;
            frame.totalLength = 10 + frame.len + 2 + sigLen;

            if (avail < frame.totalLength) {
                return PARSE_NEED_MORE; // Full packet not yet buffered
            }

            // Calculate ITU X.25 CRC-16 over bytes 1 through (10 + frame.len - 1)
            uint16_t crc;
            crc_init(&crc);
            for (size_t i = 1; i < (10 + frame.len); i++) {
                crc_accumulate(ringBuf.peek(i), &crc);
            }

            int16_t crcExtra = getMavlinkCrcExtra(frame.msgId);
            if (crcExtra >= 0) {
                crc_accumulate((uint8_t)crcExtra, &crc);
            }

            uint16_t rxCrc = (uint16_t)ringBuf.peek(10 + frame.len) |
                             ((uint16_t)ringBuf.peek(10 + frame.len + 1) << 8);
            frame.checksum = rxCrc;

            if (crcExtra >= 0 && crc != rxCrc) {
                vehicleState.totalCrcErrors++;
                return PARSE_CRC_ERROR;
            }

            // Packet successfully verified!
            vehicleState.totalPacketsParsed++;
            processMessagePayload(ringBuf, frame);
            return PARSE_OK;
        }

        // =================================================================================
        // MAVLink v1 Framing (STX = 0xFE)
        // =================================================================================
        if (stx == MAVLINK_V1_STX) {
            if (avail < 6) return PARSE_NEED_MORE;

            frame.magic = stx;
            frame.len = ringBuf.peek(1);
            frame.incompatFlags = 0;
            frame.compatFlags = 0;
            frame.seq = ringBuf.peek(2);
            frame.sysId = ringBuf.peek(3);
            frame.compId = ringBuf.peek(4);
            frame.msgId = ringBuf.peek(5);
            frame.totalLength = 6 + frame.len + 2;

            if (avail < frame.totalLength) {
                return PARSE_NEED_MORE;
            }

            uint16_t crc;
            crc_init(&crc);
            for (size_t i = 1; i < (6 + frame.len); i++) {
                crc_accumulate(ringBuf.peek(i), &crc);
            }

            int16_t crcExtra = getMavlinkCrcExtra(frame.msgId);
            if (crcExtra >= 0) {
                crc_accumulate((uint8_t)crcExtra, &crc);
            }

            uint16_t rxCrc = (uint16_t)ringBuf.peek(6 + frame.len) |
                             ((uint16_t)ringBuf.peek(6 + frame.len + 1) << 8);
            frame.checksum = rxCrc;

            if (crcExtra >= 0 && crc != rxCrc) {
                vehicleState.totalCrcErrors++;
                return PARSE_CRC_ERROR;
            }

            vehicleState.totalPacketsParsed++;
            processMessagePayload(ringBuf, frame);
            return PARSE_OK;
        }

        return PARSE_NOT_HEADER;
    }

    /**
     * Decodes message payload for critical autopilot states & QR detection alerts.
     */
    void processMessagePayload(const LockFreeRingBuffer& ringBuf, const DecodedMavlinkFrame& frame) {
        size_t payloadOffset = (frame.magic == MAVLINK_V2_STX) ? 10 : 6;

        // 1. HEARTBEAT (#0)
        if (frame.msgId == MAVLINK_MSG_ID_HEARTBEAT && frame.len >= 9) {
            uint32_t customMode = (uint32_t)ringBuf.peek(payloadOffset) |
                                  ((uint32_t)ringBuf.peek(payloadOffset + 1) << 8) |
                                  ((uint32_t)ringBuf.peek(payloadOffset + 2) << 16) |
                                  ((uint32_t)ringBuf.peek(payloadOffset + 3) << 24);

            uint8_t type = ringBuf.peek(payloadOffset + 4);
            uint8_t autopilot = ringBuf.peek(payloadOffset + 5);
            uint8_t baseMode = ringBuf.peek(payloadOffset + 6);
            uint8_t systemStatus = ringBuf.peek(payloadOffset + 7);

            vehicleState.customFlightMode = customMode;
            vehicleState.vehicleType = type;
            vehicleState.autopilotType = autopilot;
            vehicleState.baseMode = baseMode;
            vehicleState.systemStatus = systemStatus;
            vehicleState.isArmed = ((baseMode & MAV_MODE_FLAG_SAFETY_ARMED) != 0);
            vehicleState.lastHeartbeatMs = millis();
        }

        // 2. STATUSTEXT (#253) — QR Alert Packet Interceptor
        if (frame.msgId == MAVLINK_MSG_ID_STATUSTEXT && frame.len >= 2) {
            // Severity is at payloadOffset, text begins at payloadOffset + 1 (up to 50 chars)
            char textBuf[52];
            memset(textBuf, 0, sizeof(textBuf));

            size_t textLen = (frame.len > 1) ? (frame.len - 1) : 0;
            if (textLen > 50) textLen = 50;

            for (size_t i = 0; i < textLen; i++) {
                textBuf[i] = (char)ringBuf.peek(payloadOffset + 1 + i);
            }
            textBuf[textLen] = '\0';

            // Scan for "QR_CODE:"
            char* match = strstr(textBuf, "QR_CODE:");
            if (match != nullptr) {
                char* pDigits = match + 8;
                size_t dIdx = 0;
                while (pDigits[dIdx] >= '0' && pDigits[dIdx] <= '9' && dIdx < (sizeof(lastQrCodeDigits) - 1)) {
                    lastQrCodeDigits[dIdx] = pDigits[dIdx];
                    dIdx++;
                }
                lastQrCodeDigits[dIdx] = '\0';

                if (dIdx >= 1) {
                    qrCodeAlertTriggered = true;
                }
            }
        }
    }

    /**
     * Builds a MAVLink v2 COMMAND_LONG packet.
     * Frame length: 10 (header) + 33 (payload) + 2 (CRC) = 45 bytes.
     */
    static size_t buildCommandLong(uint8_t* outBuf,
                                  uint8_t targetSys,
                                  uint8_t targetComp,
                                  uint16_t command,
                                  float p1, float p2, float p3, float p4, float p5, float p6, float p7,
                                  uint8_t seq = 0,
                                  uint8_t sysId = 255,
                                  uint8_t compId = 190) {
        if (outBuf == nullptr) return 0;

        const uint8_t payloadLen = 33;
        outBuf[0] = MAVLINK_V2_STX;
        outBuf[1] = payloadLen;
        outBuf[2] = 0; // Incompat flags
        outBuf[3] = 0; // Compat flags
        outBuf[4] = seq;
        outBuf[5] = sysId;
        outBuf[6] = compId;
        outBuf[7] = (uint8_t)(MAVLINK_MSG_ID_COMMAND_LONG & 0xFF);
        outBuf[8] = (uint8_t)((MAVLINK_MSG_ID_COMMAND_LONG >> 8) & 0xFF);
        outBuf[9] = (uint8_t)((MAVLINK_MSG_ID_COMMAND_LONG >> 16) & 0xFF);

        // Floats p1 through p7 (little-endian)
        float params[7] = {p1, p2, p3, p4, p5, p6, p7};
        for (int i = 0; i < 7; i++) {
            memcpy(&outBuf[10 + (i * 4)], &params[i], 4);
        }

        // command (uint16_t)
        outBuf[38] = (uint8_t)(command & 0xFF);
        outBuf[39] = (uint8_t)((command >> 8) & 0xFF);

        // target_system, target_component, confirmation
        outBuf[40] = targetSys;
        outBuf[41] = targetComp;
        outBuf[42] = 0; // confirmation

        // ITU X.25 CRC-16 with CRC_EXTRA = 152 for COMMAND_LONG
        uint16_t crc;
        crc_init(&crc);
        for (size_t i = 1; i < (10 + payloadLen); i++) {
            crc_accumulate(outBuf[i], &crc);
        }
        crc_accumulate(152, &crc); // CRC_EXTRA for COMMAND_LONG

        outBuf[10 + payloadLen] = (uint8_t)(crc & 0xFF);
        outBuf[10 + payloadLen + 1] = (uint8_t)((crc >> 8) & 0xFF);

        return (10 + payloadLen + 2); // 45 bytes
    }

    /**
     * Builds instant BRAKE command (Mode 17) via MAV_CMD_DO_SET_MODE.
     * Injected to halt vehicle immediately upon QR detection.
     */
    static size_t buildBrakeCommand(uint8_t* outBuf, uint8_t seq = 0) {
        return buildCommandLong(
            outBuf,
            1,   // target_system (Autopilot)
            1,   // target_component
            MAV_CMD_DO_SET_MODE,
            (float)MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, // param1: 1.0
            (float)ARDUPILOT_MODE_BRAKE,               // param2: 17.0
            0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
            seq
        );
    }

    /**
     * Builds localized RTL failsafe command (Mode 6) via MAV_CMD_NAV_RETURN_TO_LAUNCH.
     * Injected when 5000 ms watchdog expires during armed flight.
     */
    static size_t buildRtlCommand(uint8_t* outBuf, uint8_t seq = 0) {
        return buildCommandLong(
            outBuf,
            1,   // target_system (Autopilot)
            1,   // target_component
            MAV_CMD_NAV_RETURN_TO_LAUNCH,
            0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
            seq
        );
    }

    /**
     * Builds alternate RTL failsafe command via MAV_CMD_DO_SET_MODE (Mode 6).
     */
    static size_t buildSetModeRtlCommand(uint8_t* outBuf, uint8_t seq = 0) {
        return buildCommandLong(
            outBuf,
            1,
            1,
            MAV_CMD_DO_SET_MODE,
            (float)MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, // param1: 1.0
            (float)ARDUPILOT_MODE_RTL,                 // param2: 6.0
            0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
            seq
        );
    }
};

#endif // MAVLINK_V2_PARSER_H
