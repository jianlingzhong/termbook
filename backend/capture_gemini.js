const cp = require('child_process');
const path = require('path');
const p = cp.spawn("python3", [path.join(__dirname, "pty_wrapper.py"), "/bin/bash", "-i"], {stdio: ["pipe", "pipe", "pipe", "pipe"]});
p.stdout.on("data", d => {
    const s = d.toString();
    if (s.includes('\x1b[?1049h')) console.log("FOUND 1049h");
});
setTimeout(() => { p.stdin.write("gemini\r\n"); }, 1000);
setTimeout(() => { p.stdin.write("hello\r\n"); }, 3000);
setTimeout(() => { process.exit(); }, 8000);
