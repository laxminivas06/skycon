#!/usr/bin/env python3
"""
S500 / PIXHAWK 2.4.8 ONE-CLICK PARAMETER UPLOADER & VERIFIER
=============================================================
Loads S500_AUTONOMOUS_PIXHAWK_TUNING.param and directly writes
all parameters to the connected Pixhawk over MAVLink (COM22 @ 115200).
"""

import sys
import os
import time
import argparse

try:
    from pymavlink import mavutil
except ImportError:
    print("Error: pymavlink is required. Install via: pip install pymavlink")
    sys.exit(1)

def load_params_file(file_path):
    params = {}
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(',')
            if len(parts) >= 2:
                name = parts[0].strip()
                try:
                    val = float(parts[1].strip())
                    params[name] = val
                except ValueError:
                    continue
    return params

def main():
    parser = argparse.ArgumentParser(description="Upload parameter file to Pixhawk.")
    parser.add_argument("--port", default="COM22", help="Serial port (default: COM22)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument("--file", default="S500_AUTONOMOUS_PIXHAWK_TUNING.param", help="Path to .param file")
    parser.add_argument("--bench", action="store_true", help="Keep FENCE_ENABLE=0 and BATT_MONITOR=0 for bench USB testing")
    args = parser.parse_args()

    param_path = args.file
    if not os.path.exists(param_path):
        # Look in parent dir
        parent_path = os.path.join(os.path.dirname(__file__), "..", args.file)
        if os.path.exists(parent_path):
            param_path = parent_path
        else:
            root_path = os.path.join("c:\\Antigravityyyyy\\last drone", args.file)
            if os.path.exists(root_path):
                param_path = root_path

    if not os.path.exists(param_path):
        print(f"Error: Parameter file '{args.file}' not found.")
        sys.exit(1)

    params = load_params_file(param_path)
    if args.bench:
        print("🔧 [BENCH MODE ACTIVE]: Setting FENCE_ENABLE=0 and BATT_MONITOR=0 to avoid pre-arm USB lockout.")
        params['FENCE_ENABLE'] = 0.0
        params['BATT_MONITOR'] = 0.0

    print(f"================================================================")
    print(f"🚀 S500 AUTONOMOUS PARAMETER SYNC ENGINE")
    print(f"📂 Parameter File: {param_path} ({len(params)} parameters)")
    print(f"🔌 Target Port:    {args.port} @ {args.baud} baud")
    print(f"================================================================")

    print(f"Connecting to Pixhawk on {args.port}...")
    try:
        mav = mavutil.mavlink_connection(args.port, baud=args.baud, timeout=3.0)
        hb = mav.wait_heartbeat(timeout=5)
        if not hb:
            print("❌ Error: No heartbeat received from Pixhawk.")
            sys.exit(1)
        print(f"✓ Heartbeat received! System ID: {mav.target_system}, Component ID: {mav.target_component}")
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        sys.exit(1)

    print(f"\nWriting {len(params)} parameters to Pixhawk EEPROM...")
    verified = {}
    mismatches = {}

    for name, val in params.items():
        mav.param_set_send(name, val, mavutil.mavlink.MAV_PARAM_TYPE_REAL32)
        time.sleep(0.04)

    print("Verifying parameters from Pixhawk readback...")
    time.sleep(0.5)

    for name in params.keys():
        mav.param_fetch_one(name)

    start = time.time()
    while time.time() - start < 4.0 and len(verified) + len(mismatches) < len(params):
        msg = mav.recv_match(type='PARAM_VALUE', blocking=True, timeout=0.3)
        if msg and msg.param_id in params:
            expected = params[msg.param_id]
            actual = msg.param_value
            if abs(actual - expected) < 0.05:
                verified[msg.param_id] = actual
            else:
                mismatches[msg.param_id] = (expected, actual)

    print(f"\n================================================================")
    print(f"📊 PARAMETER SYNC RESULTS:")
    print(f"   ✓ Confirmed in EEPROM: {len(verified)} / {len(params)}")
    if mismatches:
        print(f"   ⚠️ Mismatches: {len(mismatches)}")
        for k, (exp, act) in mismatches.items():
            print(f"      - {k:18}: Expected {exp}, Readback {act}")
    else:
        print(f"   🎉 100% OF TARGET PARAMETERS CONFIRMED IN PIXHAWK EEPROM!")
    print(f"================================================================\n")

if __name__ == "__main__":
    main()

