/**
 * Unit tests for the Registry Launcher logging utilities.
 *
 * Tests that all logging functions:
 * - Output to stderr only (via console.error)
 * - Include ISO 8601 timestamps
 * - Include severity levels
 * - Format messages correctly
 */

import {
  log,
  logBackpressure,
  logDebug,
  logError,
  logExit,
  logInfo,
  logSpawn,
  logStdinClosed,
  logWarn,
} from './log.js';

describe('Registry Launcher Logging', () => {
  let consoleSpy: jest.SpyInstance;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    consoleSpy = jest.spyOn(console, 'error').mockImplementation((msg: string) => {
      capturedOutput.push(msg);
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('log()', () => {
    it('should log to stderr with ISO 8601 timestamp', () => {
      log('INFO', 'Test message');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = capturedOutput[0];

      // Check ISO 8601 timestamp format
      expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('should include severity level in output', () => {
      log('ERROR', 'Test error');

      const output = capturedOutput[0];
      expect(output).toContain('[ERROR]');
    });

    it('should include default context in output', () => {
      log('INFO', 'Test message');

      const output = capturedOutput[0];
      expect(output).toContain('[registry-launcher]');
    });

    it('should include custom context when provided', () => {
      log('INFO', 'Test message', 'custom-context');

      const output = capturedOutput[0];
      expect(output).toContain('[custom-context]');
    });

    it('should include the message in output', () => {
      log('INFO', 'My specific message');

      const output = capturedOutput[0];
      expect(output).toContain('My specific message');
    });

    it('should support all severity levels', () => {
      log('DEBUG', 'Debug message');
      log('INFO', 'Info message');
      log('WARN', 'Warn message');
      log('ERROR', 'Error message');

      expect(capturedOutput[0]).toContain('[DEBUG]');
      expect(capturedOutput[1]).toContain('[INFO]');
      expect(capturedOutput[2]).toContain('[WARN]');
      expect(capturedOutput[3]).toContain('[ERROR]');
    });
  });

  describe('logSpawn()', () => {
    it('should log agent spawn with agentId and command', () => {
      logSpawn('test-agent', 'npx', ['@test/agent', '--stdio']);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = capturedOutput[0];

      expect(output).toContain('[INFO]');
      expect(output).toContain('test-agent');
      expect(output).toContain('npx @test/agent --stdio');
    });

    it('should handle empty args array', () => {
      logSpawn('simple-agent', '/usr/bin/agent', []);

      const output = capturedOutput[0];
      expect(output).toContain('/usr/bin/agent');
    });

    it('should handle command with multiple args', () => {
      logSpawn('complex-agent', 'uvx', ['package', '--arg1', 'value1', '--arg2', 'value2']);

      const output = capturedOutput[0];
      expect(output).toContain('uvx package --arg1 value1 --arg2 value2');
    });
  });

  describe('logExit()', () => {
    it('should log agent exit with exit code', () => {
      logExit('test-agent', 0);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = capturedOutput[0];

      expect(output).toContain('[INFO]');
      expect(output).toContain('test-agent');
      expect(output).toContain('exited with code 0');
    });

    it('should log agent exit with non-zero exit code', () => {
      logExit('failing-agent', 1);

      const output = capturedOutput[0];
      expect(output).toContain('exited with code 1');
    });

    it('should log agent exit with signal', () => {
      logExit('killed-agent', null, 'SIGTERM');

      const output = capturedOutput[0];
      expect(output).toContain('exited with signal SIGTERM');
    });

    it('should log agent exit with null code and no signal', () => {
      logExit('unknown-agent', null);

      const output = capturedOutput[0];
      expect(output).toContain('exited');
    });
  });

  describe('logBackpressure()', () => {
    it('should log backpressure warning with agentId', () => {
      logBackpressure('slow-agent');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = capturedOutput[0];

      expect(output).toContain('[WARN]');
      expect(output).toContain('slow-agent');
      expect(output).toContain('backpressure');
    });
  });

  describe('logStdinClosed()', () => {
    it('should log stdin closed error with agentId', () => {
      logStdinClosed('broken-agent');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = capturedOutput[0];

      expect(output).toContain('[ERROR]');
      expect(output).toContain('broken-agent');
      expect(output).toContain('stdin closed unexpectedly');
    });

    it('should include error message when provided', () => {
      logStdinClosed('broken-agent', new Error('EPIPE'));

      const output = capturedOutput[0];
      expect(output).toContain('EPIPE');
    });
  });

  describe('convenience functions', () => {
    it('logDebug should log with DEBUG level', () => {
      logDebug('Debug message');

      const output = capturedOutput[0];
      expect(output).toContain('[DEBUG]');
      expect(output).toContain('Debug message');
    });

    it('logInfo should log with INFO level', () => {
      logInfo('Info message');

      const output = capturedOutput[0];
      expect(output).toContain('[INFO]');
      expect(output).toContain('Info message');
    });

    it('logWarn should log with WARN level', () => {
      logWarn('Warn message');

      const output = capturedOutput[0];
      expect(output).toContain('[WARN]');
      expect(output).toContain('Warn message');
    });

    it('logError should log with ERROR level', () => {
      logError('Error message');

      const output = capturedOutput[0];
      expect(output).toContain('[ERROR]');
      expect(output).toContain('Error message');
    });

    it('convenience functions should support custom context', () => {
      logInfo('Test', 'my-context');

      const output = capturedOutput[0];
      expect(output).toContain('[my-context]');
    });
  });

  describe('output format', () => {
    it('should format output as [timestamp] [level] [context] message', () => {
      log('INFO', 'Test message');

      const output = capturedOutput[0];
      // Verify the format: [ISO8601] [LEVEL] [context] message
      const formatRegex = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[registry-launcher\] Test message$/;
      expect(output).toMatch(formatRegex);
    });
  });
});
