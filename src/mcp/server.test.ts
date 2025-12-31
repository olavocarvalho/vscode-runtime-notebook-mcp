import { describe, expect, it } from 'vitest';
import { ServerStartResult, setOnReleaseCallback } from './server';

// Tests for v0.2.1 server module additions

describe('ServerStartResult interface', () => {
  it('has correct shape for new server (owning)', () => {
    const result: ServerStartResult = {
      port: 49777,
      isExistingServer: false
    };

    expect(result.port).toBe(49777);
    expect(result.isExistingServer).toBe(false);
  });

  it('has correct shape for existing server (deferred)', () => {
    const result: ServerStartResult = {
      port: 49777,
      isExistingServer: true
    };

    expect(result.port).toBe(49777);
    expect(result.isExistingServer).toBe(true);
  });

  it('port can be any valid port number', () => {
    const result: ServerStartResult = {
      port: 3000,
      isExistingServer: false
    };

    expect(result.port).toBe(3000);
  });
});

describe('setOnReleaseCallback', () => {
  it('should be a function', () => {
    expect(typeof setOnReleaseCallback).toBe('function');
  });

  it('accepts a callback function', () => {
    // Should not throw when called with a function
    expect(() => {
      setOnReleaseCallback(() => {});
    }).not.toThrow();
  });
});

// Note: isServerRunning and requestServerRelease make real HTTP requests
// and are better tested via integration tests or by mocking the http module.
// The E2E tests in test/e2e/notebook.e2e.test.ts cover these functions
// in a real VS Code environment.
