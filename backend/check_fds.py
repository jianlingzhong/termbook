import os
import sys

try:
    os.fstat(3)
    print("FD 3 IS OPEN")
except OSError:
    print("FD 3 IS CLOSED")
