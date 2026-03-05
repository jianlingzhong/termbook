const cp = require('child_process');
const path = require('path');
const p = cp.spawn("python3", [path.join(__dirname, "pty_wrapper.py"), "/bin/bash", "-i"], {stdio: ["pipe", "pipe", "pipe", "pipe"]});
p.stdout.on("data", d => {
    const s = d.toString();
    const hex = Array.from(s).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    console.log("OUT:", JSON.stringify(s), "(hex:", hex, ")");
});
p.stderr.on("data", d => console.log("ERR:", d.toString()));
setTimeout(() => { p.stdin.write("nvim -u NONE\r\n"); }, 1000);
setTimeout(() => { p.stdin.write(":q!\r\n"); }, 3000);
setTimeout(() => { process.exit(); }, 5000);
