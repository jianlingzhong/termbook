#!/usr/bin/env python3
import os
import subprocess
import time
import signal
import sys
import argparse
import json
from datetime import datetime

# Port Configuration
FRONTEND_PORT = 4000
BACKEND_PORT = 4001
DEBUG_PORT = 4005

# Log Files
BACKEND_STDOUT_LOG = "backend-server.log"
FRONTEND_STDOUT_LOG = "frontend-server.log"
BACKEND_APP_LOG = "termbook-backend.log"
FRONTEND_APP_LOG = "termbook-frontend.log"

def get_pid_on_port(port):
    """Dynamically discover the PID holding a port using lsof."""
    try:
        output = subprocess.check_output(["lsof", "-ti", f":{port}"]).decode().strip()
        if output:
            return [int(pid) for pid in output.split()]
    except subprocess.CalledProcessError:
        pass
    return []

def kill_process_on_port(port):
    """Surgically kill processes holding a specific port."""
    pids = get_pid_on_port(port)
    if not pids:
        return False
    
    print(f"[*] Found processes {pids} on port {port}. Terminating...")
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    
    # Wait for cleanup
    for _ in range(10):
        if not get_pid_on_port(port):
            return True
        time.sleep(0.5)
        
    # Escalation
    pids = get_pid_on_port(port)
    if pids:
        print(f"[!] SIGTERM timeout. Escalating to SIGKILL for {pids}...")
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    return True

def clear_logs():
    """Wipe existing log files."""
    logs = [BACKEND_STDOUT_LOG, FRONTEND_STDOUT_LOG, BACKEND_APP_LOG, FRONTEND_APP_LOG]
    for log in logs:
        if os.path.exists(log):
            os.remove(log)
    print("[*] All logs cleared.")

def add_marker(log_file, msg):
    """Add a timestamp marker to a log file."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_file, "a") as f:
        f.write(f"\n==== {msg} AT {timestamp} ====\n")

def get_last_marker(log_file, pattern):
    """Extract the last occurrence of a pattern from a log file."""
    if not os.path.exists(log_file):
        return None
    try:
        output = subprocess.check_output(["tail", "-n", "100", log_file]).decode()
        markers = []
        for line in output.splitlines():
            if pattern in line:
                markers.append(line)
        return markers[-1] if markers else None
    except Exception:
        return None

def wait_for_live(port, log_file, pattern, timeout=15, require_marker=True):
    """Wait until port is bound (mandatory) and log marker appears (optional)."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        pids = get_pid_on_port(port)
        marker = get_last_marker(log_file, pattern)
        if pids:
            if not require_marker or marker:
                return True, pids, marker
        time.sleep(1)
    return False, get_pid_on_port(port), get_last_marker(log_file, pattern)

def status(log_status="Appending to existing logs"):
    """Report the current status of servers with absolute paths and clear guidance."""
    b_pids = get_pid_on_port(BACKEND_PORT)
    f_pids = get_pid_on_port(FRONTEND_PORT)
    root_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("DEBUG SERVER STATUS REPORT")
    
    # Analyze Backend
    b_marker = get_last_marker(BACKEND_APP_LOG, "==== BACKEND STARTED AT")
    if b_pids:
        print(f"[ONLINE] Backend (Port {BACKEND_PORT})")
        print(f"         - Primary PID: {b_pids[0]}")
        print(f"         - App Log:     {os.path.join(root_dir, BACKEND_APP_LOG)}")
        print(f"         - Console Log: {os.path.join(root_dir, BACKEND_STDOUT_LOG)}")
        print(f"         - Last Start:  {b_marker or 'Unknown (Marker missing)'}")
    else:
        print(f"[OFFLINE] Backend (Port {BACKEND_PORT})")
        if b_marker: print(f"         - Last Start:  {b_marker}")

    # Analyze Frontend
    f_marker = get_last_marker(FRONTEND_APP_LOG, "==== FRONTEND RELOADED ====")
    if f_pids:
        print(f"[ONLINE] Frontend (Port {FRONTEND_PORT})")
        print(f"         - Primary PID: {f_pids[0]}")
        print(f"         - App Log:     {os.path.join(root_dir, FRONTEND_APP_LOG)}")
        print(f"         - Console Log: {os.path.join(root_dir, FRONTEND_STDOUT_LOG)}")
        print(f"         - Last Reload: {f_marker or 'Unknown (Marker missing)'}")
    else:
        print(f"[OFFLINE] Frontend (Port {FRONTEND_PORT})")
        if f_marker: print(f"         - Last Reload: {f_marker}")

    # Missing Files
    missing = [f for f in [BACKEND_APP_LOG, FRONTEND_APP_LOG, BACKEND_STDOUT_LOG, FRONTEND_STDOUT_LOG] if not os.path.exists(f)]
    if missing:
        print(f"[!] WARNING: Missing log files: {', '.join(missing)}")
    
    print(f"LOG STATUS: {log_status}")
    
    print("\n--- AGENT ACTIONABLE GUIDANCE ---")
    if b_pids or f_pids:
        print("1. Servers are currently RUNNING.")
        print("2. To read backend app logs: tail -n 100 " + os.path.join(root_dir, BACKEND_APP_LOG))
        print("3. To read frontend app logs: tail -n 100 " + os.path.join(root_dir, FRONTEND_APP_LOG))
        print("4. To read backend console:  tail -n 100 " + os.path.join(root_dir, BACKEND_STDOUT_LOG))
        print("5. To read frontend console:  tail -n 100 " + os.path.join(root_dir, FRONTEND_STDOUT_LOG))
        print("6. To restart (e.g. after a crash), run: python3 manage_debug_servers.py restart")
        print("7. To restart AND wipe all logs, run: python3 manage_debug_servers.py restart --clear-logs")
    else:
        print("1. Servers are currently STOPPED.")
        print("2. To start them, run: python3 manage_debug_servers.py start")
    print("")

def start_servers(clear=False):
    """Scenario-aware server startup."""
    b_pids = get_pid_on_port(BACKEND_PORT)
    f_pids = get_pid_on_port(FRONTEND_PORT)
    
    if b_pids or f_pids:
        if clear:
            print("[!] ABORT: Cannot clear logs while servers are running.")
            print("    Reason: Clearing logs while processes are active results in 'Unknown' status and missing markers.")
            print("    Action: Use 'python3 manage_debug_servers.py restart --clear-logs' instead.")
        else:
            print("[!] NOTICE: Start requested but servers are already active.")
        status(log_status="N/A (Already running)")
        return

    if clear:
        clear_logs()
    
    log_status = "Cleared and started fresh" if clear else "Appending to existing logs"

    print(f"[*] Starting Backend (port {BACKEND_PORT})...")
    add_marker(BACKEND_STDOUT_LOG, "START")
    b_out = open(BACKEND_STDOUT_LOG, "a")
    subprocess.Popen(["npm", "run", "dev"], cwd="backend", stdout=b_out, stderr=b_out, start_new_session=True)

    print(f"[*] Starting Frontend (port {FRONTEND_PORT})...")
    add_marker(FRONTEND_STDOUT_LOG, "START")
    f_out = open(FRONTEND_STDOUT_LOG, "a")
    subprocess.Popen(["npm", "run", "dev"], cwd="frontend", stdout=f_out, stderr=f_out, start_new_session=True)

    print("[*] Waiting for servers to become live (timeout 30s)...")
    time.sleep(2) # Initial stabilization delay
    b_ok, _, _ = wait_for_live(BACKEND_PORT, BACKEND_APP_LOG, "==== BACKEND STARTED AT", timeout=30)
    # Frontend marker is optional because it only appears after browser activity
    f_ok, _, _ = wait_for_live(FRONTEND_PORT, FRONTEND_APP_LOG, "==== FRONTEND RELOADED ====", timeout=30, require_marker=False)

    if b_ok and f_ok:
        print("[+] SUCCESS: Both servers are live.")
        if not get_last_marker(FRONTEND_APP_LOG, "==== FRONTEND RELOADED ===="):
            print("    (Note: Frontend marker will appear in logs after first browser access)")
        status(log_status=log_status)
    else:
        print("[!] ERROR: Verification failed or timed out.")
        if not b_ok: print(f"    - Backend failed to bind or log to {BACKEND_APP_LOG}")
        if not f_ok: print(f"    - Frontend failed to bind or log to {FRONTEND_APP_LOG}")
        print("    Action: Check Console Logs for startup errors.")
        status(log_status=log_status)

def stop_servers():
    """Stop servers and wait for port release."""
    print("[*] Initiating graceful shutdown...")
    b_active = bool(get_pid_on_port(BACKEND_PORT))
    f_active = bool(get_pid_on_port(FRONTEND_PORT))
    
    if not b_active and not f_active:
        print("[*] No active servers found.")
        return False

    kill_process_on_port(BACKEND_PORT)
    kill_process_on_port(FRONTEND_PORT)
    
    print("[*] Verification: Checking if ports are free...")
    time.sleep(1)
    if not get_pid_on_port(BACKEND_PORT) and not get_pid_on_port(FRONTEND_PORT):
        print("[+] SUCCESS: All ports cleared.")
        return True
    else:
        print("[!] WARNING: Some processes may still be lingering.")
        return False

def restart_servers(clear=False):
    """Restart sequence."""
    print("[*] RESTART SEQUENCE INITIATED")
    stop_servers()
    time.sleep(1)
    start_servers(clear=clear)

def main():
    parser = argparse.ArgumentParser(description="Manage Termbook debug servers.")
    parser.add_argument("command", choices=["start", "stop", "restart", "status"], help="Command to execute")
    parser.add_argument("--clear-logs", action="store_true", help="Clear logs before starting/restarting")
    
    args = parser.parse_args()
    
    if args.command == "start":
        start_servers(clear=args.clear_logs)
    elif args.command == "stop":
        stop_servers()
    elif args.command == "restart":
        restart_servers(clear=args.clear_logs)
    elif args.command == "status":
        status()

if __name__ == "__main__":
    main()
