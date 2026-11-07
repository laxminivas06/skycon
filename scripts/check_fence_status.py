import time
from pymavlink import mavutil

master = mavutil.mavlink_connection('COM22', baud=115200, timeout=3.0)
master.wait_heartbeat()

print("Listening for FENCE_STATUS from Pixhawk...")
start = time.time()
while time.time() - start < 4.0:
    msg = master.recv_match(type='FENCE_STATUS', blocking=True, timeout=1.0)
    if msg:
        print(f"FENCE_STATUS packet:")
        print(f"  breach_status: {msg.breach_status}") # 0 = no breach, 1 = breached
        print(f"  breach_count:  {msg.breach_count}")
        print(f"  breach_type:   {msg.breach_type}")   # 0 = none, 1 = alt, 2 = circle, 3 = polygon
        print(f"  breach_time:   {msg.breach_time}")
        break

master.close()

