import sys
import time
from pymavlink import mavutil

print("=================================================================")
print("🔍 ULTIMATE PRE-FLIGHT HARDWARE AUDIT: PIXHAWK & AVIONICS")
print("=================================================================")

TARGET_PARAMS = [
    # Core Fences & Navigation
    "FENCE_ENABLE",
    "FENCE_ACTION",
    "FENCE_ALT_MAX",
    "PILOT_TKOFF_ALT",
    "WPNAV_SPEED",
    "WPNAV_RADIUS",
    "RTL_ALT",
    "LAND_SPEED",
    
    # Telemetry Ports & Protocol (TELEM1 & TELEM2)
    "SERIAL1_PROTOCOL",
    "SERIAL1_BAUD",
    "SERIAL2_PROTOCOL",
    "SERIAL2_BAUD",
    "SERIAL2_OPTIONS",
    "BRD_SER2_RTSCTS",
    
    # Safety Switch & Arming
    "BRD_SAFETYENABLE",
    "ARMING_CHECK",
    
    # GPS & Compass
    "GPS_TYPE",
    "COMPASS_ENABLE",
    "COMPASS_USE",
    "AHRS_EKF_TYPE",
    
    # Failsafes
    "FS_GCS_ENABLE",
    "FS_THR_ENABLE",
    "FS_BATT_ENABLE",
    "BATT_MONITOR",
    "BATT_LOW_VOLT"
]

try:
    master = mavutil.mavlink_connection('COM22', baud=115200, timeout=3.0)
    hb = master.wait_heartbeat(timeout=4.0)
    if not hb:
        print("❌ Cannot receive heartbeat on COM22.")
        sys.exit(1)
    print(f"✓ Connected to Pixhawk on COM22 (System ID: {master.target_system}, Autopilot: {hb.autopilot})")
except Exception as e:
    print(f"❌ Connection error: {e}")
    sys.exit(1)

param_values = {}

print("\n[PHASE 1] Querying Avionics & Safety Parameters from Pixhawk EEPROM...")
for param_name in TARGET_PARAMS:
    master.mav.param_request_read_send(
        master.target_system,
        master.target_component,
        param_name.encode('ascii'),
        -1
    )
    start = time.time()
    while time.time() - start < 0.6:
        msg = master.recv_match(type='PARAM_VALUE', blocking=True, timeout=0.2)
        if msg:
            p_id = msg.param_id.strip('\x00').upper()
            if p_id == param_name.upper():
                param_values[param_name] = msg.param_value
                break

print("\n--- PARAMETER READBACK TABLE ---")
for p in TARGET_PARAMS:
    val = param_values.get(p, "NOT_FOUND")
    print(f"  {p:<18}: {val}")

# Listen to live sensors for 3 seconds
print("\n[PHASE 2] Listening to Live Sensor Telemetry on COM22...")
master.mav.request_data_stream_send(
    master.target_system,
    master.target_component,
    mavutil.mavlink.MAV_DATA_STREAM_ALL,
    4,
    1
)

start = time.time()
latest_gps = None
latest_sys_status = None
latest_battery = None
latest_statustexts = []
latest_attitude = None
latest_ekf = None

while time.time() - start < 3.5:
    msg = master.recv_match(blocking=True, timeout=0.2)
    if not msg:
        continue
    mtype = msg.get_type()
    if mtype == 'GPS_RAW_INT':
        latest_gps = msg
    elif mtype == 'SYS_STATUS':
        latest_sys_status = msg
    elif mtype == 'BATTERY_STATUS':
        latest_battery = msg
    elif mtype == 'ATTITUDE':
        latest_attitude = msg
    elif mtype == 'EKF_STATUS_REPORT':
        latest_ekf = msg
    elif mtype == 'STATUSTEXT':
        latest_statustexts.append(msg.text)

print("\n--- LIVE SENSOR STATUS ---")
if latest_gps:
    fix_names = {0: "NO_GPS", 1: "NO_FIX", 2: "2D_FIX", 3: "3D_FIX", 4: "DGPS", 5: "RTK_FLOAT", 6: "RTK_FIXED"}
    fix_str = fix_names.get(latest_gps.fix_type, f"TYPE_{latest_gps.fix_type}")
    hdop = latest_gps.eph / 100.0 if hasattr(latest_gps, 'eph') else 99.9
    print(f"  GPS Fix Type     : {fix_str} ({latest_gps.fix_type})")
    print(f"  GPS Satellites   : {latest_gps.satellites_visible}")
    print(f"  GPS HDOP         : {hdop:.2f}m")
    print(f"  GPS Coordinates  : Lat={latest_gps.lat / 1e7:.6f}°, Lon={latest_gps.lon / 1e7:.6f}°, Alt={latest_gps.alt / 1000.0:.1f}m MSL")
else:
    print("  GPS              : No GPS_RAW_INT packet received within 3s")

if latest_sys_status:
    volt = latest_sys_status.voltage_battery / 1000.0
    current = latest_sys_status.current_battery / 100.0
    rem = latest_sys_status.battery_remaining
    print(f"  Battery Status   : {volt:.2f}V | {current:.1f}A | {rem}% remaining")
elif latest_battery:
    volt = latest_battery.voltages[0] / 1000.0 if latest_battery.voltages else 0.0
    print(f"  Battery Status   : {volt:.2f}V | {latest_battery.battery_remaining}% remaining")
else:
    print("  Battery Status   : No battery telemetry")

if latest_attitude:
    import math
    roll_deg = math.degrees(latest_attitude.roll)
    pitch_deg = math.degrees(latest_attitude.pitch)
    yaw_deg = math.degrees(latest_attitude.yaw) % 360
    print(f"  IMU Attitude     : Roll={roll_deg:.1f}°, Pitch={pitch_deg:.1f}°, Yaw={yaw_deg:.1f}°")

if latest_ekf:
    print(f"  EKF Flags        : {latest_ekf.flags} (Velocity={latest_ekf.velocity_variance:.2f}, PosHoriz={latest_ekf.pos_horiz_variance:.2f})")

if latest_statustexts:
    print(f"\n--- PIXHAWK CONSOLE STATUSTEXTS ({len(latest_statustexts)}) ---")
    for st in latest_statustexts[-8:]:
        print(f"  [PIXHAWK] {st}")

master.close()
print("\nPort COM22 released cleanly.")

