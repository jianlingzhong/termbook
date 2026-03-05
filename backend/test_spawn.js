const pty = require('node-pty');
const path = require('path');
const rcPath = path.join(__dirname, 'test_rc');
require('fs').writeFileSync(rcPath, 'echo test');

try {
  const ptyProcess = pty.spawn('/bin/bash', ['--rcfile', rcPath, '-i'], {
    name: 'xterm-kitty',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env
  });
  console.log("Spawned successfully with args!");
  process.exit(0);
} catch (e) {
  console.error("Failed to spawn:", e);
}
