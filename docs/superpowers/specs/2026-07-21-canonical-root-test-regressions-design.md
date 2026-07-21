# Canonical Root Test Regressions Design

## Goal

Restore the full test-suite release gate without weakening canonical project-root
identity, which prevents a symlink alias from reusing or retargeting an MCP
project cache entry.

## Context

The hardened fork makes `CodeGraph` retain `canonicalRootKey(root)` rather than
the caller's lexical spelling. On macOS, a temporary directory created below
`/var` may canonicalize to `/private/var`. This is intentional: both spellings
must describe one project identity.

QA reproduced four deterministic test failures at commit `5359c7e` while the
baseline `77a0a5c` passed the same suites:

1. `foundation.test.ts` expects the old lexical `path.resolve(tempDir)` value.
2. Three `mcp-staleness-banner.test.ts` cases call the test-only synthetic watch
   event hook with the lexical root. The live watcher registry is now keyed by
   the canonical root, so the hook cannot locate it and no pending-file event
   is injected.

The second case affects only the Vitest seam; production filesystem events go
directly to the live watcher and do not use this registry.

## Non-goals

- Do not restore lexical roots in `CodeGraph` or the MCP cache.
- Do not add dual runtime cache keys or a lexical-to-canonical alias map.
- Do not change global installation, MCP configuration, package version, or
  external behavior.
- Do not change production watcher semantics.

## Design

### Canonical root remains the public runtime value

`CodeGraph.getProjectRoot()` continues to return the canonical root established
by `init`, `open`, and `openSync`. The foundation assertion must compare against
`fs.realpathSync(tempDir)`, making the intended contract explicit and portable
across macOS path aliases. The expected value deliberately uses Node's native
filesystem primitive rather than the production `canonicalRootKey` helper, so
the test does not merely repeat the implementation under test.

### Test-only watch-event lookup canonicalizes its input

`__emitWatchEventForTests(projectRoot, relPath)` will derive a canonical lookup
key before consulting `liveWatchersForTests`. The registry remains canonical,
matching the live `FileWatcher.projectRoot`. The function stays test-only and
does not introduce any production path resolution or state.

If canonicalization fails, the test hook returns `false`, preserving its current
"no live watcher" result instead of throwing. This is appropriate for a test
helper and avoids hiding a production path failure behind a fallback key.

### Regression coverage

Add a watcher-level test that starts an inert watcher at a canonical root and
emits an event using a lexical alias where macOS supplies one. The assertion is
portable: derive the lexical/canonical paths at runtime and skip the alias
subcase when both spellings are identical. Existing staleness-banner tests then
cover the full `CodeGraph -> FileWatcher -> ToolHandler` path.

## Verification

1. First reproduce foundation and staleness failures on the current commit.
2. Add tests before implementation and confirm the new alias case fails.
3. Run targeted foundation, watcher, and staleness suites serially.
4. Run `npm test`, `npm run build`, and `npm audit --omit=dev --json`.
5. Repeat the existing MCP/root-identity stress lanes; package/global parity is
   checked only after the release gate passes.

## Risks and mitigations

- A test-only fix could mask a runtime regression: retain the canonical-root
  contract assertion and run the existing 15-round root-identity/MCP stress
  checks.
- A lexical fallback could reintroduce alias ambiguity: do not add one. The
  hook uses one canonical key only.
- Platforms without `/var` aliases: derive paths at runtime; no hard-coded
  macOS-only expectation.
