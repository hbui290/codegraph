import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/directory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/directory')>();
  return { ...actual, findNearestCodeGraphRoot: vi.fn(() => '/etc') };
});

import { MCPEngine } from '../src/mcp/engine';

describe('MCPEngine sensitive-root refusal', () => {
  it('does not open a sensitive root discovered during default initialization', async () => {
    const engine = new MCPEngine({ watch: false });

    await engine.ensureInitialized('/safe-looking-symlink');

    expect(engine.getProjectPath()).toBeNull();
    expect(engine.hasDefaultCodeGraph()).toBe(false);
  });

  it('does not open a sensitive root during synchronous retry initialization', () => {
    const engine = new MCPEngine({ watch: false });

    engine.retryInitializeSync('/safe-looking-symlink');

    expect(engine.getProjectPath()).toBeNull();
    expect(engine.hasDefaultCodeGraph()).toBe(false);
  });
});
