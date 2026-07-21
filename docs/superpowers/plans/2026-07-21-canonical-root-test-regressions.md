# Canonical Root Test Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the full test release gate while retaining canonical filesystem identity for CodeGraph and the MCP project cache.

**Architecture:** CodeGraph continues to expose the filesystem's canonical root. The only behavior change is inside the Vitest-only watch-event registry: both registration and lookup use the same canonical key. Foundation checks against Node's independent `fs.realpathSync` oracle.

**Tech Stack:** TypeScript, Node `fs.realpathSync`, Vitest, CodeGraph CLI/MCP test suites.

## Global Constraints

- Keep `CodeGraph` and MCP project cache keyed by one canonical root only.
- Do not add lexical fallback keys, dual cache entries, or production watcher behavior.
- Keep `__emitWatchEventForTests` non-throwing: an unresolved root returns `false`.
- Use Node `fs.realpathSync` as the test oracle; do not compare a helper to itself.
- Do not alter package version, global install, or Codex MCP configuration until all release checks pass.

---

### Task 1: Pin the public canonical-root contract

**Files:**
- Modify/test: `__tests__/foundation.test.ts:81-90`

**Interfaces:** Consumes `CodeGraph.openSync(projectRoot): CodeGraph` and
`getProjectRoot(): string`; produces an assertion against Node's filesystem
identity.

- [ ] **Step 1: Change the stale lexical expectation**

Replace the existing assertion with the independent filesystem oracle (the
`fs` import already exists):

```ts
expect(cg2.getProjectRoot()).toBe(fs.realpathSync(tempDir));
```

- [ ] **Step 2: Run the focused contract test**

```bash
npx vitest run __tests__/foundation.test.ts --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=1
```

Expected: all foundation tests pass; the macOS `/var` alias resolves to
`/private/var` where applicable.

- [ ] **Step 3: Commit the isolated test-contract repair**

```bash
git add __tests__/foundation.test.ts
git commit -m "test: expect canonical project roots"
```

### Task 2: Make the test-only watcher registry use one canonical key

**Files:**
- Modify: `src/sync/watcher.ts:147-155, 384, 720, 939-944`
- Test: `__tests__/watcher.test.ts`

**Interfaces:** Consumes `FileWatcher(projectRoot, syncFn, { inertForTests: true })`
and `fs.realpathSync(path)`; produces a non-throwing
`__emitWatchEventForTests(projectRoot, relPath): boolean` that accepts a
lexical alias of a live watcher root.

- [ ] **Step 1: Write the failing alias regression test**

Add near the synthetic-event tests:

```ts
it('finds an inert watcher through a lexical root alias', () => {
  const canonicalRoot = fs.realpathSync(testDir);
  const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
  const watcher = new FileWatcher(canonicalRoot, syncFn, { inertForTests: true });

  expect(watcher.start()).toBe(true);
  expect(__emitWatchEventForTests(testDir, 'src/index.ts')).toBe(true);
  expect(watcher.getPendingFiles().map((entry) => entry.path)).toContain('src/index.ts');
  watcher.stop();
});
```

On this macOS host, before the fix the test fails because the watcher registers
`/private/var/...` while the seam looks up `/var/...`. On platforms whose
spellings match, it remains a valid lifecycle positive control.

- [ ] **Step 2: Confirm the targeted test fails before implementation**

```bash
npx vitest run __tests__/watcher.test.ts -t "finds an inert watcher through a lexical root alias" --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=1
```

Expected before the fix on this macOS host: FAIL because the seam returns
`false`.

- [ ] **Step 3: Add one private canonical-key helper**

Immediately after `IS_TEST_RUNTIME`, add:

```ts
function testWatcherRootKey(projectRoot: string): string | null {
  try {
    return fs.realpathSync(projectRoot);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Canonicalize both test-registry boundaries**

Replace registration in `FileWatcher.start()` with:

```ts
if (IS_TEST_RUNTIME) {
  const key = testWatcherRootKey(this.projectRoot);
  if (key) liveWatchersForTests.set(key, this);
}
```

Replace deletion in `FileWatcher.stop()` with:

```ts
if (IS_TEST_RUNTIME) {
  const key = testWatcherRootKey(this.projectRoot);
  if (key) liveWatchersForTests.delete(key);
}
```

Replace the test seam with:

```ts
export function __emitWatchEventForTests(projectRoot: string, relPath: string): boolean {
  const key = testWatcherRootKey(projectRoot);
  const w = key ? liveWatchersForTests.get(key) : undefined;
  if (!w) return false;
  w.ingestEventForTests(relPath);
  return true;
}
```

There is deliberately no lexical fallback; an unresolvable root retains the
existing `false` outcome.

- [ ] **Step 5: Run focused watcher and MCP regressions serially**

```bash
npx vitest run __tests__/watcher.test.ts __tests__/mcp-staleness-banner.test.ts --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=1
```

Expected: all watcher and staleness-banner tests pass, including the three
formerly timed-out MCP cases.

- [ ] **Step 6: Commit the test-seam repair**

```bash
git add src/sync/watcher.ts __tests__/watcher.test.ts
git commit -m "fix(test): canonicalize watcher seam roots"
```

### Task 3: Verify release readiness without changing installation

**Files:** Test only; no source-file changes.

**Interfaces:** Consumes commits from Tasks 1 and 2; produces either verified
release-gate evidence or a new separately diagnosed failure report.

- [ ] **Step 1: Run the full suite**

```bash
npm test
```

Expected: exit 0. If any failure remains, stop and start a separate root-cause
investigation rather than widening this change.

- [ ] **Step 2: Run build and production dependency audit**

```bash
npm run build
npm audit --omit=dev --json
```

Expected: build exit 0; audit contains zero vulnerabilities.

- [ ] **Step 3: Repeat focused stress checks**

```bash
for i in $(seq 1 15); do
  npx vitest run __tests__/root-identity.test.ts --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=1 || exit 1
done
npx vitest run __tests__/mcp-roots.test.ts __tests__/mcp-daemon.test.ts __tests__/mcp-initialize.test.ts __tests__/mcp-unindexed.test.ts __tests__/mcp-startup-orphan.test.ts --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=1
```

Expected: all iterations and MCP lifecycle suites pass.

- [ ] **Step 4: Review the exact change and preserve installation state**

Run `git diff --check 5359c7e..HEAD` and `git status --short`.

Expected: no whitespace errors. Do not push or reinstall globally; report the
exact verification evidence to Boss first.
