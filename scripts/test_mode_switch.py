import time
from pymavlink import mavutil

master = mavutil.mavlink_connection('COM22', baud=115200, timeout=3.0)
master.wait_heartbeat()

print("Testing SET_MODE to ALT_HOLD (custom_mode=2)...")
master.mav.set_mode_send(
    master.target_system,
    mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
    2 # ALT_HOLD
)

start = time.time()
while time.time() - start < 2.0:
    msg = master.recv_match(blocking=True, timeout=0.5)
    if not msg:
        continue
    if msg.get_type() == 'HEARTBEAT':
        mode_name = mavutil.mode_mapping_bynumber(msg.type).get(msg.custom_mode, f"MODE_{msg.custom_mode}")
        print(f" -> Current Mode: {mode_name}")
        if mode_name == 'ALT_HOLD':
            print(" ✓ Successfully switched to ALT_HOLD!")
            break
    elif msg.get_type() == 'STATUSTEXT':
        print(f" -> STATUSTEXT: {msg.text}")

# Switch back to STABILIZE
print("\nSwitching back to STABILIZE (custom_mode=0)...")
master.mav.set_mode_send(
    master.target_system,
    mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
    0 # STABILIZE
)

start = time.time()
while time.time() - start < 2.0:
    msg = master.recv_match(type='HEARTBEAT', blocking=True, timeout=0.5)
    if msg:
        mode_name = mavutil.mode_mapping_bynumber(msg.type).get(msg.custom_mode, f"MODE_{msg.custom_mode}")
        if mode_name == 'STABILIZE':
            print(" ✓ Successfully returned to STABILIZE!")
            break

master.close()

