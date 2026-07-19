import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../src';
import { FileLock } from '../src/utils';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');

function runSync(cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [BIN, 'sync'], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1', CODEGRAPH_TELEMETRY: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.status ?? 1 };
  }
}

describe('codegraph sync output', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-sync-cmd-'));
    fs.writeFileSync(path.join(tempDir, 'helper.ts'), 'export function helper() { return 1; }\n');
    fs.writeFileSync(path.join(tempDir, 'app.ts'), "import { helper } from './helper';\nexport function app() { return helper(); }\n");
    const cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();
    cg.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports orphan recovery even when no files changed', async () => {
    const cg = await CodeGraph.open(tempDir);
    fs.appendFileSync(path.join(tempDir, 'app.ts'), '// interrupted resolution\n');
    await cg.indexFiles(['app.ts']);
    expect(cg.getPendingReferenceCount()).toBeGreaterThan(0);
    cg.close();

    const { stdout, code } = runSync(tempDir);
    expect(code).toBe(0);
    expect(stdout).toMatch(/recovered interrupted index: resolved \d+ pending references/i);
    expect(stdout).not.toMatch(/already up to date/i);
  });

  it('reports an index-busy sync instead of claiming it is up to date', () => {
    const lock = new FileLock(path.join(tempDir, '.codegraph', 'codegraph.lock'));
    lock.acquire();
    try {
      const { stdout, code } = runSync(tempDir);
      expect(code).toBe(0);
      expect(stdout).toMatch(/index busy/i);
      expect(stdout).not.toMatch(/already up to date/i);
    } finally {
      lock.release();
    }
  });
});
