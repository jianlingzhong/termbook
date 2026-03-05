// Emit Alternate Buffer
process.stdout.write('\x1b[?1049h');
// Set cursor to 5,5
process.stdout.write('\x1b[5;5H');
// Write in Red
process.stdout.write('\x1b[31mMOCK_TUI_ACTIVE\x1b[0m\r\n');
setTimeout(() => {
    // Exit Alternate Buffer
    process.stdout.write('\x1b[?1049l');
    process.exit(0);
}, 2000);
