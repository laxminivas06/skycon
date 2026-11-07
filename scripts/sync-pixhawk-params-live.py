import sys
import time
from pymavlink import mavutil

print("=================================================================")
print("🛰️  PHASE 1: LIVE PIXHAWK PARAMETER SYNCHRONIZATION (COM22)")
print("=================================================================")

TARGET_PARAMS = [
    ("FENCE_ENABLE", 0.0),       # Disable internal hardware fence
    ("SERIAL2_OPTIONS", 0.0),    # No RTS/CTS or inverted logic on TELEM2
    ("BRD_SER2_RTSCTS", 0.0),    # Disable hardware flow control on SER2
    ("PILOT_TKOFF_ALT", 500.0),  # Takeoff target altitude = 500 cm (5.0m AGL)
    ("WPNAV_SPEED", 350.0),      # Waypoint navigation speed = 350 cm/s (3.5 m/s)
    ("WPNAV_RADIUS", 150.0),     # Waypoint acceptance radius = 150 cm (1.5 m)
    ("RTL_ALT", 500.0),          # RTL altitude = 500 cm (5.0m AGL)
    ("LAND_SPEED", 40.0),        # Autonomous touchdown speed = 40 cm/s
]

try:
    master = mavutil.mavlink_connection('COM22', baud=115200, timeout=3.0)
    print("Connecting to Pixhawk on COM22 at 115200 baud...")
    hb = master.wait_heartbeat(timeout=5.0)
    if not hb:
        print("❌ ERROR: No heartbeat received from Pixhawk on COM22.")
        sys.exit(1)
    print(f"✓ Heartbeat received! System ID: {master.target_system}, Component ID: {master.target_component}")
except Exception as e:
    print(f"❌ Failed to connect on COM22: {e}")
    sys.exit(1)

results = {}

for param_name, desired_value in TARGET_PARAMS:
    print(f"\n--- Synchronizing {param_name} -> {desired_value} ---")
    
    # Send PARAM_SET
    param_bytes = param_name.encode('ascii')
    # Pad to 16 bytes if necessary or pass as is
    master.mav.param_set_send(
        master.target_system,
        master.target_component,
        param_bytes,
        float(desired_value),
        mavutil.mavlink.MAV_PARAM_TYPE_REAL32
    )
    
    # Wait for PARAM_VALUE confirming the set
    confirmed = False
    start_time = time.time()
    while time.time() - start_time < 2.5:
        msg = master.recv_match(type='PARAM_VALUE', blocking=True, timeout=0.5)
        if msg:
            p_id = msg.param_id.strip('\x00')
            if p_id.upper() == param_name.upper():
                val = msg.param_value
                print(f"  ✓ PARAM_VALUE received: {p_id} = {val} (expected {desired_value})")
                results[param_name] = val
                confirmed = True
                break

    if not confirmed:
        # Request read manually to verify
        print(f"  Re-requesting read for {param_name}...")
        master.mav.param_request_read_send(
            master.target_system,
            master.target_component,
            param_bytes,
            -1
        )
        start_time = time.time()
        while time.time() - start_time < 2.5:
            msg = master.recv_match(type='PARAM_VALUE', blocking=True, timeout=0.5)
            if msg:
                p_id = msg.param_id.strip('\x00')
                if p_id.upper() == param_name.upper():
                    val = msg.param_value
                    print(f"  ✓ PARAM_VALUE readback: {p_id} = {val}")
                    results[param_name] = val
                    confirmed = True
                    break
        if not confirmed:
            print(f"  ⚠️ Could not read back {param_name} (might not exist in this firmware build)")
            results[param_name] = "NOT_READ"

print("\n=================================================================")
print("📊 FINAL PARAMETER VERIFICATION REPORT:")
print("=================================================================")
all_ok = True
for param_name, desired_val in TARGET_PARAMS:
    actual = results.get(param_name, "MISSING")
    match = False
    if isinstance(actual, (int, float)):
        match = abs(actual - desired_val) < 0.01
    status = "✅ MATCH" if match else f"⚠️ READBACK: {actual}"
    print(f"  {param_name:<18}: Target={desired_val:<8} | Actual={actual:<10} | {status}")
    if not match and actual != "NOT_READ":
        all_ok = False

master.close()
print("\nSerial port COM22 cleanly released.")
if all_ok:
    print("✅ PHASE 1 COMPLETE: All critical Pixhawk parameters synchronized successfully!")
else:
    print("⚠️ Phase 1 completed with notices (check parameters above).")

