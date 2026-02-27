import sys
import time

def main():
    # Enter alternate screen
    sys.stdout.write('\x1b[?1049h')
    sys.stdout.write('\x1b[H\x1b[2J')
    sys.stdout.write('FAKE TUI START\n')
    sys.stdout.write('Line 1: Hello Termbook\n')
    sys.stdout.write('Line 2: Visual Audit Test\n')
    sys.stdout.flush()

    # Wait for 5 seconds
    time.sleep(5)

    # Exit alternate screen
    sys.stdout.write('\x1b[?1049l')
    sys.stdout.flush()

if __name__ == "__main__":
    main()
