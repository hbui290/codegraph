# Import-Aware Callback Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve synthesized callback edges through CodeGraph's established import resolver, covering default imports and barrel re-exports without creating guessed cross-file edges.

**Architecture:** `callback-synthesizer.ts` currently interprets an imported callback itself from a direct relative path, then falls back to a same-file symbol. Replace only that imported-binding branch with `resolveViaImport(ref, ctx)`, the resolver already used by the ordinary resolution pipeline. A callback with an import binding must either resolve to a concrete function/method or produce no synthesized edge; same-file lookup remains only for callbacks with no matching import binding.

**Tech Stack:** TypeScript, Vitest, CodeGraph `ResolutionContext`, `QueryBuilder`, existing `resolveViaImport`.

## Global Constraints

- Reuse `resolveViaImport`; do not add a second default-import or re-export parser.
- Preserve high precision: never fall back from an unresolved import to a same-named local/global symbol.
- Only synthesize callback edges to nodes whose kind is `function` or `method`.
- Do not add dependencies, configuration, or indexing changes.
- Run focused tests individually; the aggregate suite has a known local V8/WASM memory failure.

---

## Files

- Modify: `src/resolution/callback-synthesizer.ts` — choose the callback target from the shared resolver.
- Modify: `__tests__/frameworks-integration.test.ts` — add end-to-end fixtures beside the existing named-import callback regression at lines 1127–1147.
- Create: no production files.

### Task 1: Prove the unsupported import forms fail safely

**Files:**
- Modify: `__tests__/frameworks-integration.test.ts`

**Consumes:** Existing `CodeGraph.initSync(tmpDir)`, `getNodesByName`, and synthesized-edge assertion pattern.

**Produces:** Three regressions specifying import-aware callback behavior.

- [ ] **Step 1: Add a default-import fixture and assertion**

  Create `handler.ts` with `export default function triggerRender() {}`, a normal `store.ts`, and `main.ts` containing:

  ```ts
  import { store } from './store';
  import triggerRender from './handler';
  class Local { triggerRender() {} }
  export function connect() { store.subscribe(triggerRender); }
  ```

  Index the temporary project. Assert the callback edges emitted from `Store.emit` contain the node in `handler.ts` and do not contain `Local.triggerRender`.

- [ ] **Step 2: Add a barrel re-export fixture and assertion**

  Create `handler.ts` with `export default function triggerRender() {}`, `events.ts` with `export { default as triggerRender } from './handler'`, and `main.ts` containing:

  ```ts
  import { store } from './store';
  import { triggerRender } from './events';
  class Local { triggerRender() {} }
  export function connect() { store.subscribe(triggerRender); }
  ```

  Assert the synthesized edge reaches the `handler.ts` node, never the local decoy nor a `decoy.ts` node.

- [ ] **Step 3: Add an unresolved-import safety fixture**

  Add a local `triggerRender()` plus an imported binding named `triggerRender` whose exported symbol is deliberately absent. Assert no callback edge targets the local function. This locks the key rule: an import binding cannot silently degrade to local-name matching.

- [ ] **Step 4: Run the new tests before changing production code**

  Run:

  ```bash
  rtk npx vitest run __tests__/frameworks-integration.test.ts
  ```

  Expected: the new default/barrel or unresolved-import safety assertion fails against the current direct-path logic; existing tests remain green.

- [ ] **Step 5: Commit the red tests**

  ```bash
  git add __tests__/frameworks-integration.test.ts
  git commit -m "test: cover imported callback synthesis"
  ```

### Task 2: Resolve imported callbacks through the shared resolver

**Files:**
- Modify: `src/resolution/callback-synthesizer.ts:214-227`

**Consumes:** `resolveViaImport(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null`; `queries.getNodeById(id)`; current callback name, caller node, and source edge line.

**Produces:** A single safe target-selection path for imported callbacks.

- [ ] **Step 1: Import the existing resolver and reference type**

  Replace the now-unneeded `node:path` import with:

  ```ts
  import { resolveViaImport } from './import-resolver';
  import type { UnresolvedRef } from './types';
  ```

- [ ] **Step 2: Replace manual direct-relative matching**

  At the current `callbackName` block, first locate a matching import mapping:

  ```ts
  const imported = ctx.getImportMappings(caller.filePath, caller.language)
    .some((mapping) => mapping.localName === callbackName);
  ```

  When `imported` is true, build the resolver input from the already-known source location:

  ```ts
  const ref: UnresolvedRef = {
    fromNodeId: caller.id,
    referenceName: callbackName,
    referenceKind: 'references',
    line: e.line,
    column: 0,
    filePath: caller.filePath,
    language: caller.language,
  };
  const resolved = resolveViaImport(ref, ctx);
  const fn = resolved ? queries.getNodeById(resolved.targetNodeId) : undefined;
  ```

  When `imported` is false, retain the existing same-file lookup by name. In both branches, continue unless `fn?.kind` is `function` or `method`.

  The precise branch contract is:

  ```ts
  // Import exists: resolve concrete target or omit edge.
  // No import: same-file callback may be synthesized.
  ```

  Do not call `getNodesByName` to repair a failed imported lookup.

- [ ] **Step 3: Run focused callback tests**

  Run:

  ```bash
  rtk npx vitest run __tests__/frameworks-integration.test.ts
  ```

  Expected: all tests pass, including named import, default import, barrel re-export, and unresolved-import decoy safety.

- [ ] **Step 4: Build TypeScript**

  Run:

  ```bash
  rtk npm run build
  ```

  Expected: exit 0; no unused `path` import and no type incompatibility in the synthetic `UnresolvedRef`.

- [ ] **Step 5: Commit the implementation**

  ```bash
  git add src/resolution/callback-synthesizer.ts __tests__/frameworks-integration.test.ts
  git commit -m "fix: resolve imported callback targets"
  ```

### Task 3: Verify no regression at the graph and installed-package layers

**Files:**
- Modify: none unless verification finds a defect.

**Consumes:** Task 2 commit and the current fork packaging workflow.

**Produces:** Evidence that source, build, runtime graph, and installed global CLI agree.

- [ ] **Step 1: Run focused regression suites separately**

  Run:

  ```bash
  rtk npx vitest run __tests__/frameworks.test.ts
  rtk npx vitest run __tests__/frameworks-integration.test.ts
  rtk npx vitest run __tests__/extraction.test.ts -t "same-line TypeScript getters and setters"
  rtk npx vitest run __tests__/context-ranking.test.ts
  rtk npx vitest run __tests__/mcp-unindexed.test.ts
  ```

  Expected: each command exits 0. Do not treat the known aggregate Vitest V8/WASM OOM as a product failure or mask it with worker configuration changes in this task.

- [ ] **Step 2: Run a fresh global-package canary after installation**

  Build a tarball from the committed fork, install that tarball globally through the documented npm path, then index a disposable TS project containing the barrel fixture. Verify through the global API/CLI that `Store.emit → handler.ts:triggerRender` exists and no edge targets `Local.triggerRender`.

- [ ] **Step 3: Independent review**

  Give a reviewer the changed source and fixtures with these acceptance criteria: no duplicated import parsing, no imported-to-local fallback, correct default/barrel target, no cross-file decoy edge. Reviewer must run the focused integration test independently.

- [ ] **Step 4: Publish only after explicit approval**

  Push the verified commits to `hbui290/codegraph` only when Boss authorizes the external update. Record the commit SHA and global package version/hash in the closeout.

## Acceptance Criteria

- Default import callback creates one synthesized edge to its actual exported function.
- Named callback routed through a barrel creates one synthesized edge to its actual final export.
- A same-named local/cross-file decoy never receives the edge.
- An unresolved imported callback creates no synthesized edge rather than an inferred one.
- Direct named-import behavior remains green.
- `npm run build` and the focused suites pass.

## Self-Review

- Spec coverage: default import, barrel, high precision, decoys, implementation, source/build/runtime checks are all mapped to a task.
- No new parser/dependency/configuration was introduced; the plan reuses the existing resolver.
- Type consistency: the planned `UnresolvedRef` supplies every required field and the target is recovered through `QueryBuilder.getNodeById`.
