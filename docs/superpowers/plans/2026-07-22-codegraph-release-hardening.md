# CodeGraph Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the sensitive-path, release-runtime, fork-provenance, and MCP-cleanup findings without changing public MCP behaviour.

**Architecture:** Preserve lexical path handling for missing paths, but refuse any existing input and final index root whose canonical filesystem identity is sensitive. Make test and release commands build the exact `dist` runtime they spawn. Mark this personal fork as non-self-updatable, and make fixture teardown fail if its subprocess remains alive.

**Tech Stack:** TypeScript, Vitest, Node.js, GitHub Actions.

## Global Constraints

- Preserve MCP API, version `1.4.2`, and normal non-sensitive parent-root discovery.
- No new dependency, npm publish, or upstream release execution.
- Keep `docs/superpowers/plans/2026-07-21-codegraph-fork-hardening.md` untracked.
- Every production/configuration change starts with an observed failing test.

---

### Task 1: Canonical sensitive-root refusal

**Files:**
- Modify: `src/utils.ts`, `src/mcp/tools.ts`
- Test: `__tests__/security.test.ts`

- [ ] Add a POSIX symlink fixture pointing at `/etc` and assert `validateProjectPath(alias)` rejects it.
- [ ] Run `npx vitest run __tests__/security.test.ts`; observe failure because lexical validation accepts the alias.
- [ ] Canonicalize existing validation paths and canonicalize the discovered `.codegraph` root before `ToolHandler` opens it; retain lexical handling for non-existing paths.
- [ ] Re-run the focused security suite and verify the alias is rejected while ordinary paths remain allowed.
- [ ] Commit `fix(security): reject canonical sensitive project roots`.

### Task 2: Built-runtime test and release gate

**Files:**
- Modify: `package.json`, `.github/workflows/release.yml`
- Test: `package.json` script and release-workflow inspection

- [ ] Add a test command contract that removes stale `dist`, builds, then runs the existing single-worker Vitest suite.
- [ ] Run the command from a clean `dist` state and verify spawned MCP tests use the fresh build.
- [ ] Add the same full test gate to `release.yml` after `npm ci` and before bundle construction.
- [ ] Re-run the relevant test command and inspect workflow ordering.
- [ ] Commit `test: gate releases on a fresh runtime build`.

### Task 3: Fork provenance and strict MCP teardown

**Files:**
- Modify: `src/upgrade/index.ts`, `__tests__/upgrade.test.ts`, `__tests__/mcp-initialize.test.ts`, `__tests__/mcp-roots.test.ts`

- [ ] Add failing tests for a fork-upgrade refusal and for teardown timeout rejection.
- [ ] Run the focused tests and observe the current updater proceeds / timeout is silently accepted.
- [ ] Refuse `codegraph upgrade` with an explicit verified-fork workflow message; make teardown reject on timeout before temp cleanup.
- [ ] Run upgrade and MCP lifecycle suites to green.
- [ ] Commit `fix: preserve fork provenance and fixture lifecycle`.

### Task 4: Release verification and rollout

**Files:**
- Verify only: current branch and global npm installation

- [ ] Run `npm test`, `npm run build`, production dependency audit, root-identity stress, and MCP lifecycle suite.
- [ ] Request an independent read-only review of the new range.
- [ ] Push `harden/graph-correctness-v1`, pack the verified commit, reinstall global package, and compare global/source binary hashes.
- [ ] Commit only source/test/workflow/docs changes; leave the older blueprint untracked.
