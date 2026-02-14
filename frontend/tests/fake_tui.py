import time
import sys

print("\x1b[?1049h", end="")
sys.stdout.flush()

time.sleep(3)

print("FAKE TUI SNAPSHOT RENDERED HERE\r\n", end="")
sys.stdout.flush()

time.sleep(1)

print("\x1b[?1049l", end="")
sys.stdout.flush()
