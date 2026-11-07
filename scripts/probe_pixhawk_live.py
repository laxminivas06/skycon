import sys
import time
import serial
from pymavlink import mavutil

print("=================================================================")
print("🛸 LIVE PIXHAWK HARDWARE PROBE (COM22)")
print("=================================================================")

port = 'COM22'
baud_candidates = [115200, 57600, 921600]

connected_mav = None
active_baud = None

for baud in baud_candidates:
    print(f"\nAttempting connection on {port} at {baud} baud...")
    try:
        master = mavutil.mavlink_connection(port, baud=baud, timeout=3.0)
        # Wait up to 3 seconds for heartbeat
        msg = master.wait_heartbeat(timeout=3.0)
        if msg:
            print(f" ✓ SUCCESS: Heartbeat received at {baud} baud!")
            print(f"   Autopilot: {msg.autopilot}, Type: {msg.type}, Base Mode: {msg.base_mode}, Custom Mode: {msg.custom_mode}")
            connected_mav = master
            active_baud = baud
            break
        else:
            print(f"   No heartbeat at {baud} within 3s.")
            master.close()
    except Exception as e:
        print(f"   Could not open {port} at {baud}: {e}")

if not connected_mav:
    print("\n❌ Could not connect to Pixhawk on COM22.")
    print("If Mission Planner or another program is currently open and connected to COM22, Windows locks the serial port exclusively.")
    sys.exit(1)

master = connected_mav

# Request streams
print("\n[STEP 1] Requesting data streams from Pixhawk...")
master.mav.request_data_stream_send(
    master.target_system,
    master.target_component,
    mavutil.mavlink.MAV_DATA_STREAM_ALL,
    4, # 4 Hz
    1  # start
)

# Collect messages for 5 seconds
print("\n[STEP 2] Listening to live Pixhawk telemetry for 5 seconds...")
start_time = time.time()
messages_received = {}
status_texts = []
latest_gps = None
latest_global_pos = None
latest_vfr = None
latest_sys_status = None
latest_battery = None
latest_heartbeat = None

while time.time() - start_time < 5.0:
    msg = master.recv_match(blocking=True, timeout=0.5)
    if not msg:
        continue
    
    mtype = msg.get_type()
    messages_received[mtype] = messages_received.get(mtype, 0) + 1
    
    if mtype == 'HEARTBEAT':
        latest_heartbeat = msg
    elif mtype == 'GPS_RAW_INT':
        latest_gps = msg
    elif mtype == 'GLOBAL_POSITION_INT':
        latest_global_pos = msg
    elif mtype == 'VFR_HUD':
        latest_vfr = msg
    elif mtype == 'SYS_STATUS':
        latest_sys_status = msg
    elif mtype == 'BATTERY_STATUS':
        latest_battery = msg
    elif mtype == 'STATUSTEXT':
        status_texts.append(msg.text)

print(f"\nTotal message types received: {len(messages_received)}")
for mtype, count in sorted(messages_received.items()):
    print(f"   • {mtype}: {count} packets")

print("\n-----------------------------------------------------------------")
print("📊 TELEMETRY BREAKDOWN & ALTITUDE ANALYSIS:")
print("-----------------------------------------------------------------")

if latest_heartbeat:
    is_armed = bool(latest_heartbeat.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
    # Decode flight mode
    mode_name = mavutil.mode_mapping_bynumber(latest_heartbeat.type).get(latest_heartbeat.custom_mode, f"MODE_{latest_heartbeat.custom_mode}")
    print(f"Vehicle State: {'ARMED' if is_armed else 'DISARMED'}")
    print(f"Flight Mode:   {mode_name}")

if latest_gps:
    lat = latest_gps.lat / 1e7
    lon = latest_gps.lon / 1e7
    alt = latest_gps.alt / 1000.0
    print(f"\n[GPS_RAW_INT]:")
    print(f"  Fix Type:   {latest_gps.fix_type} (3=3D Fix)")
    print(f"  Satellites: {latest_gps.satellites_visible}")
    print(f"  EPH / HDOP: {latest_gps.eph / 100.0 if hasattr(latest_gps, 'eph') else 'N/A'}")
    print(f"  GPS Alt:    {alt:.2f} m (MSL)")
    print(f"  Coords:     ({lat:.6f}, {lon:.6f})")

if latest_vfr:
    print(f"\n[VFR_HUD]:")
    print(f"  Baro Alt:   {latest_vfr.alt:.2f} m")
    print(f"  Climb Rate: {latest_vfr.climb:.2f} m/s")
    print(f"  Heading:    {latest_vfr.heading} deg")
    print(f"  Throttle:   {latest_vfr.throttle} %")

if latest_global_pos:
    msl = latest_global_pos.alt / 1000.0
    rel = latest_global_pos.relative_alt / 1000.0
    print(f"\n[GLOBAL_POSITION_INT]:")
    print(f"  MSL Alt:      {msl:.2f} m (Mean Sea Level)")
    print(f"  Relative Alt: {rel:.2f} m (AGL - Above Ground/Home)")
    if abs(msl - rel) > 50:
        print(f"  ⚡ CONFIRMED: Ground elevation offset is {msl - rel:.1f} meters above sea level!")

if latest_battery:
    voltages = [v for v in latest_battery.voltages if v != 65535 and v > 0]
    print(f"\n[BATTERY_STATUS]:")
    print(f"  Voltages:  {voltages} mV")
    print(f"  Remaining: {latest_battery.battery_remaining} %")
elif latest_sys_status:
    volt_mv = latest_sys_status.voltage_battery
    curr_ca = latest_sys_status.current_battery
    print(f"\n[SYS_STATUS Battery]:")
    print(f"  Voltage:   {volt_mv / 1000.0:.2f} V")
    print(f"  Current:   {curr_ca / 100.0:.2f} A")
    print(f"  Remaining: {latest_sys_status.battery_remaining} %")

if status_texts:
    print("\n[RECENT STATUSTEXT NOTICES]:")
    for st in status_texts[-8:]:
        print(f"  ⚠ {st}")

# Step 3: Fetch Pixhawk Geofence Parameters
print("\n[STEP 3] Reading Pixhawk Onboard Fence Parameters...")
fence_params = ['FENCE_ENABLE', 'FENCE_TYPE', 'FENCE_ACTION', 'FENCE_ALT_MAX', 'FENCE_RADIUS', 'ARMING_CHECK']

for param in fence_params:
    master.mav.param_request_read_send(
        master.target_system,
        master.target_component,
        param.encode('utf-8'),
        -1
    )

param_values = {}
param_start = time.time()
while time.time() - param_start < 3.0:
    msg = master.recv_match(type='PARAM_VALUE', blocking=True, timeout=0.5)
    if msg:
        pname = msg.param_id
        if isinstance(pname, bytes):
            pname = pname.decode('utf-8', errors='ignore').rstrip('\x00')
        else:
            pname = str(pname).rstrip('\x00')
        param_values[pname] = msg.param_value
        if len(param_values) >= len(fence_params):
            break

print("Pixhawk Parameters:")
for p in fence_params:
    val = param_values.get(p, "Not Returned")
    print(f"  • {p}: {val}")

master.close()
print("\n=================================================================")
print("✓ LIVE PROBE COMPLETE")
print("=================================================================")

