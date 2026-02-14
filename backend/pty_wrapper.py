import os, pty, sys, select, json, struct, termios, fcntl

def set_winsize(fd, row, col, xpix=0, ypix=0):
    winsize = struct.pack("HHHH", row, col, xpix, ypix)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

pid, fd = pty.fork()
if pid == 0:
    try:
        os.close(3)
    except:
        pass
    os.execv(sys.argv[1], sys.argv[1:])
else:
    # 0 = stdin, fd = pty, 3 = resize pipe
    fds = [0, fd, 3]
    try:
        while fds:
            # We want to wait until there's data to read
            r, _, _ = select.select(fds, [], [])
            if 3 in r:
                try:
                    data = os.read(3, 1024)
                    if not data:
                        fds.remove(3)
                    else:
                        for msg in data.decode('utf-8').strip().split('\n'):
                            if not msg: continue
                            try:
                                cmd = json.loads(msg)
                                if cmd.get('type') == 'resize':
                                    set_winsize(fd, cmd.get('rows', 24), cmd.get('cols', 80))
                            except: pass
                except OSError:
                    fds.remove(3)
                    
            if fd in r:
                try:
                    data = os.read(fd, 1024)
                    if not data: break # PTY closed
                    os.write(1, data)
                except OSError:
                    break
                    
            if 0 in r:
                try:
                    data = os.read(0, 1024)
                    if not data:
                        fds.remove(0) # Standard input closed
                    else:
                        os.write(fd, data)
                except OSError:
                    fds.remove(0)
    except Exception:
        pass
        
    _, status = os.waitpid(pid, 0)
    exit_code = os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else (status >> 8)
    sys.exit(exit_code)
