// Fuzz target for backend/parser.js.
//
// parser.js consumes raw bytes from a PTY and extracts OSC 133;D (cell
// close), OSC 7 (pwd), and OSC 1338 (env chips) markers. The byte
// stream is fully untrusted (anything the running command writes to
// stdout/stderr), so the parser must never throw or hang regardless
// of input.
//
// Run with: bun x jsfuzz backend/parser.fuzz.js corpus/
// (or in CI: see .github/workflows/fuzz.yml — runs nightly with a
// 10-minute budget).

const parser = require('./parser.js');

module.exports.fuzz = function (buf) {
    // jsfuzz invokes this with a Buffer. Convert to a string the same
    // way the real onData handler does, then feed it to parseOutput
    // with a deterministic salt. parseOutput must not throw.
    try {
        const s = buf.toString('utf8');
        parser.parseOutput(s, {
            promptSalt: 'fuzz-test-salt',
            allowUnsalted: true,
        });
        // Also try the salted-only mode
        parser.parseOutput(s, {
            promptSalt: 'fuzz-test-salt',
            allowUnsalted: false,
        });
    } catch (e) {
        // Re-throw — jsfuzz expects parser bugs to surface as throws.
        // Catching here would hide every finding.
        throw e;
    }
};
