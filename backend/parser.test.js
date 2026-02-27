
const { parseOutput } = require('./parser');

describe('Parser logic', () => {
    test('should parse standard OSC 133;D and OSC 7', () => {
        const exitCode = '0';
        const pwd = '/Users/test';
        const data = "\x1b]133;D;" + exitCode + "\x07\x1b]7;file://localhost" + pwd + "\x07";
        
        const result = parseOutput(data);
        expect(result).not.toBeNull();
        expect(result.exitCode).toBe(0);
        expect(result.pwd).toBe(pwd);
    });

    test('should handle data before the sequences', () => {
        const data = "some output\x1b]133;D;1\x07\x1b]7;file://hostname/tmp\x07";
        const result = parseOutput(data);
        expect(result).not.toBeNull();
        expect(result.before).toBe('some output');
        expect(result.exitCode).toBe(1);
        expect(result.pwd).toBe('/tmp');
    });

    test('should return null if sequences are missing', () => {
        const data = 'just some text';
        const result = parseOutput(data);
        expect(result).toBeNull();
    });
});

