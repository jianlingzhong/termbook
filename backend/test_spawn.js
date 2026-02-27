const cp = require('child_process');
const path = require('path');

const child = cp.spawn('python3', [path.join(__dirname, 'check_fds.py')], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
    console.log(`STDOUT: ${data}`);
});

child.stderr.on('data', (data) => {
    console.log(`STDERR: ${data}`);
});

child.on('exit', (code) => {
    console.log(`EXIT: ${code}`);
});
