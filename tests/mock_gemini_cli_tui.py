#!/usr/bin/env python3
import sys
import time
import signal
import os
import tty
import termios

def get_terminal_size():
    try:
        cols, rows = os.get_terminal_size()
        return cols, rows
    except OSError:
        return 80, 24

def draw_tui():
    cols, rows = get_terminal_size()
    
    # Hide cursor
    sys.stdout.write("\x1b[?25l")
    
    # Move to top left and clear
    sys.stdout.write("\x1b[H\x1b[2J")
    
    # Draw some "chat history"
    history = [
        "User: Hello, Gemini!",
        "Gemini: Hi there! How can I help you today?",
        "User: Write a small python script.",
        "Gemini: Sure, here is a small python script:"
    ]
    
    for i, line in enumerate(history):
        sys.stdout.write(f"\x1b[{i+1};1H{line}")

    # Draw a mock code block
    sys.stdout.write(f"\x1b[{len(history)+2};1H```python")
    sys.stdout.write(f"\x1b[{len(history)+3};1Hprint('Hello World')")
    sys.stdout.write(f"\x1b[{len(history)+4};1H```")

    # Draw bottom prompt area
    sys.stdout.write(f"\x1b[{rows-2};1H" + "-" * cols)
    sys.stdout.write(f"\x1b[{rows-1};1H> Type here: ")
    
    # Show cursor, move to prompt position
    sys.stdout.write("\x1b[?25h")
    sys.stdout.write(f"\x1b[{rows-1};14H")
    sys.stdout.flush()

def handle_sigwinch(signum, frame):
    draw_tui()

def main():
    signal.signal(signal.SIGWINCH, handle_sigwinch)
    
    fd = sys.stdin.fileno()
    old_settings = None
    try:
        if sys.stdin.isatty():
            old_settings = termios.tcgetattr(fd)
            tty.setcbreak(fd)
        
        draw_tui()
        
        # Simulate typing "test" and redrawing rapidly to mimic rendering
        time.sleep(1)
        typing = "test interaction"
        for i, char in enumerate(typing):
            cols, rows = get_terminal_size()
            sys.stdout.write(char)
            sys.stdout.flush()
            time.sleep(0.1)
            # occasionally redraw entirely to simulate React-like TUI redraw
            if i % 3 == 0:
                draw_tui()
                sys.stdout.write(typing[:i+1])
                sys.stdout.flush()
        
        # Wait longer to let Playwright observe without hitting exit and snapshot conversion
        time.sleep(8)
        
        # Exit gracefully
        sys.stdout.write("\x1b[?25h\x1b[H\x1b[2J")
        sys.stdout.write("Done.\n")
        sys.stdout.flush()

    finally:
        if old_settings:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

if __name__ == "__main__":
    main()
