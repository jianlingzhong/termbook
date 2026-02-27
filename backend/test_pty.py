import pty
import os

try:
    master, slave = pty.openpty()
    print(f"PTY OPENED: {os.ttyname(slave)}")
    os.close(master)
    os.close(slave)
except Exception as e:
    print(f"PTY FAILED: {e}")
