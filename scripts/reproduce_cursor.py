
import sys
import time

def send(s):
    sys.stdout.write(s)
    sys.stdout.flush()

# Enter alternate screen buffer
send('\x1b[?1049h')
send('\x1b[H\x1b[2J') # Clear screen

send('REPRODUCING NVIM CURSOR ISSUE...\r\n')
send('Normal Mode Simulation (Steady Block): \x1b[2 q')
send('CURSOR SHOULD BE A BLOCK HERE ->')
time.sleep(3)

send('\x1b[H\x1b[2J')
send('Insert Mode Simulation (Steady Bar): \x1b[6 q')
send('CURSOR SHOULD BE A BAR HERE ->')
time.sleep(3)

# Exit alternate screen buffer
send('\x1b[?1049l')

