#!/usr/bin/env python3
import sys
import time
import tty
import termios

def main():
    fd = sys.stdin.fileno()
    old_settings = None
    try:
        if sys.stdin.isatty():
            old_settings = termios.tcgetattr(fd)
            tty.setcbreak(fd)
        
        print("MIMIC GEMINI v1.0")
        # Move to row 2, print prompt
        sys.stdout.write("\x1b[2;1H> Press keys: ")
        sys.stdout.flush()

        while True:
            char = sys.stdin.read(1)
            if not char or char == 'q':
                break
            if char == '/':
                # Mimic the 'menu' that might be triggering TUI
                sys.stdout.write("\x1b[?1049h")
                sys.stdout.write("\x1b[H\x1b[2J")
                sys.stdout.write("--- MENU ---\n1. Search\n2. Help\nPress ESC to exit menu\n")
                sys.stdout.flush()
                
                # Wait for ESC
                while True:
                    c = sys.stdin.read(1)
                    if not c or c == '\x1b':
                        break
                
                sys.stdout.write("\x1b[?1049l")
                sys.stdout.flush()
            else:
                # Normal keypress redraw
                sys.stdout.write(f"\x1b[3;1HLast key: {char}")
                sys.stdout.write("\x1b[2;15H") # Move back to prompt
                sys.stdout.flush()
    finally:
        if old_settings:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

if __name__ == "__main__":
    main()
