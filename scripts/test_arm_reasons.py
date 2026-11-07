import time
from pymavlink import mavutil

master = mavutil.mavlink_connection('COM22', baud=115200, timeout=3.0)
master.wait_heartbeat()

# Listen to STATUSTEXT while attempting arm (standard, non-force)
print("Requesting ARM (param1=1, param2=0) to inspect PreArm failure messages...")

# Request arm
master.mav.command_long_send(
    master.target_system,
    master.target_component,
    mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
    0,
    1, # Arm
    0, # Standard arm (not force)
    0, 0, 0, 0, 0
)

start = time.time()
statustexts = []
ack = None

while time.time() - start < 3.0:
    msg = master.recv_match(blocking=True, timeout=0.5)
    if not msg:
        continue
    if msg.get_type() == 'STATUSTEXT':
        statustexts.append(msg.text)
        print(f" -> STATUSTEXT: {msg.text}")
    elif msg.get_type() == 'COMMAND_ACK':
        ack = msg
        print(f" -> COMMAND_ACK: command={msg.command}, result={msg.result}")
        break

master.close()

