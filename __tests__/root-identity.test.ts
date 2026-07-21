import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import Module from 'module';
import * as os from 'os';
import * as path from 'path';
import CodeGraph from '../src';
import { canonicalRootKey, findNearestCodeGraphRoot } from '../src/directory';
import { ToolHandler } from '../src/mcp/tools';

describe('filesystem root identity', () => {
  let tempDir: string;
  let rootA: string;
  let aliasRoot: string;
  let rootB: string;
  let hasSymlink: boolean;
  let restoreModuleLoad = () => {};

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-root-identity-'));
    rootA = path.join(tempDir, 'a');
    aliasRoot = path.join(tempDir, 'alias');
    rootB = path.join(tempDir, 'b');
    CodeGraph.initSync(rootA).close();
    CodeGraph.initSync(rootB).close();

    try {
      fs.symlinkSync(rootA, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
      hasSymlink = true;
    } catch {
      hasSymlink = false;
    }

    const moduleLoader = Module as unknown as {
      _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
    };
    const originalLoad = moduleLoader._load;
    const loadSpy = vi.spyOn(moduleLoader, '_load').mockImplementation((request, parent, isMain) =>
      request === '../index'
        ? { default: CodeGraph }
        : originalLoad.call(Module, request, parent, isMain)
    );
    restoreModuleLoad = () => loadSpy.mockRestore();
  });

  afterEach(() => {
    restoreModuleLoad();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps distinct roots distinct and resolves an unstatable path', () => {
    expect(canonicalRootKey(rootA)).not.toBe(canonicalRootKey(rootB));

    const missingRoot = path.relative(process.cwd(), path.join(tempDir, 'missing'));
    expect(canonicalRootKey(missingRoot)).toBe(path.resolve(missingRoot));
  });

  it('canonicalizes aliases while preserving root discovery spelling', (context) => {
    if (!hasSymlink) {
      context.skip();
      return;
    }

    expect(canonicalRootKey(rootA)).toBe(canonicalRootKey(aliasRoot));
    expect(findNearestCodeGraphRoot(aliasRoot)).toBe(aliasRoot);
  });

  it('opens one canonical instance for a cached alias and real root', (context) => {
    if (!hasSymlink) {
      context.skip();
      return;
    }

    const handler = new ToolHandler(null);
    const openSpy = vi.spyOn(CodeGraph, 'openSync');
    try {
      const fromAlias = (handler as any).getCodeGraph(aliasRoot) as CodeGraph;
      const fromRealRoot = (handler as any).getCodeGraph(rootA) as CodeGraph;

      expect(fromAlias).toBe(fromRealRoot);
      expect(fromAlias.getProjectRoot()).toBe(fs.realpathSync(rootA));
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(fs.realpathSync(rootA));
    } finally {
      handler.closeAll();
      openSpy.mockRestore();
    }
  });

  it('reuses a default instance through an alias without opening another connection', (context) => {
    if (!hasSymlink) {
      context.skip();
      return;
    }

    const defaultCg = CodeGraph.openSync(rootA);
    const handler = new ToolHandler(defaultCg);
    const openSpy = vi.spyOn(CodeGraph, 'openSync');
    try {
      expect((handler as any).getCodeGraph(aliasRoot)).toBe(defaultCg);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      defaultCg.close();
    }
  });

  it('does not retarget a cached project when its original alias changes', (context) => {
    if (!hasSymlink) {
      context.skip();
      return;
    }

    const handler = new ToolHandler(null);
    try {
      const cachedA = (handler as any).getCodeGraph(aliasRoot) as CodeGraph;
      fs.unlinkSync(aliasRoot);
      fs.symlinkSync(rootB, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');

      expect((handler as any).getCodeGraph(rootA)).toBe(cachedA);
      expect(fs.realpathSync(cachedA.getProjectRoot())).toBe(fs.realpathSync(rootA));

      const cachedB = (handler as any).getCodeGraph(aliasRoot) as CodeGraph;
      expect(cachedB).not.toBe(cachedA);
      expect(cachedB.getProjectRoot()).toBe(fs.realpathSync(rootB));
    } finally {
      handler.closeAll();
    }
  });

  it.runIf(process.platform !== 'win32')('reuses the cached instance when a root is recreated', () => {
    const handler = new ToolHandler(null);
    try {
      const cachedA = (handler as any).getCodeGraph(rootA) as CodeGraph;
      fs.rmSync(rootA, { recursive: true, force: true });
      CodeGraph.initSync(rootA).close();

      expect((handler as any).getCodeGraph(rootA)).toBe(cachedA);
      expect((handler as any).projectCache.size).toBe(1);
    } finally {
      handler.closeAll();
    }
  });

  it('opens distinct roots separately and closes each cached instance once', () => {
    const handler = new ToolHandler(null);
    try {
      const cachedA = (handler as any).getCodeGraph(rootA) as CodeGraph;
      const cachedB = (handler as any).getCodeGraph(rootB) as CodeGraph;
      const closeA = vi.spyOn(cachedA, 'close');
      const closeB = vi.spyOn(cachedB, 'close');

      expect(cachedA).not.toBe(cachedB);
      handler.closeAll();
      handler.closeAll();

      expect(closeA).toHaveBeenCalledTimes(1);
      expect(closeB).toHaveBeenCalledTimes(1);
    } finally {
      handler.closeAll();
    }
  });
});
