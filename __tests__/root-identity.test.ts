import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canonicalRootKey, findNearestCodeGraphRoot } from '../src/directory';

describe('filesystem root identity', () => {
  let tempDir: string;
  let realRoot: string;
  let aliasRoot: string;
  let otherRoot: string;
  let hasSymlink: boolean;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-root-identity-'));
    realRoot = path.join(tempDir, 'real');
    aliasRoot = path.join(tempDir, 'alias');
    otherRoot = path.join(tempDir, 'other');
    fs.mkdirSync(path.join(realRoot, '.codegraph'), { recursive: true });
    fs.writeFileSync(path.join(realRoot, '.codegraph', 'codegraph.db'), '');
    fs.mkdirSync(otherRoot);

    try {
      fs.symlinkSync(realRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
      hasSymlink = true;
    } catch {
      hasSymlink = false;
    }
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses physical directory identity while preserving root discovery spelling', () => {
    expect(canonicalRootKey(realRoot)).not.toBe(canonicalRootKey(otherRoot));

    if (hasSymlink) {
      expect(canonicalRootKey(realRoot)).toBe(canonicalRootKey(aliasRoot));
      expect(findNearestCodeGraphRoot(aliasRoot)).toBe(aliasRoot);
    }
  });

  it('falls back to the input path when the root cannot be stated', () => {
    const missingRoot = path.join(tempDir, 'missing');
    expect(canonicalRootKey(missingRoot)).toBe(missingRoot);
  });
});
