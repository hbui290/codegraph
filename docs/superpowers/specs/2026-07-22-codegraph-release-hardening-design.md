# CodeGraph Fork Release Hardening Design

## Goal

Close the independent-review findings without changing CodeGraph's MCP API or
normal indexing behaviour: refuse sensitive paths after symlink resolution,
make release tests exercise the built runtime, prevent the personal fork from
self-updating to upstream, and make MCP fixture cleanup observable.

## Decisions

1. Project-path refusal is evaluated against canonical filesystem identity for
   every existing input and resolved index root. Lexical checks remain for
   non-existent paths so parent-root discovery continues to work.
2. `npm test` builds before running Vitest. The release workflow runs the same
   full suite after dependency installation and before artifacts are built.
3. The personal fork refuses `codegraph upgrade` with an actionable message.
   It does not invent a separate update channel; updates are deliberately
   applied from the verified fork checkout/tarball workflow.
4. MCP fixture cleanup waits for `exit` and fails on timeout; it does not
   silently continue after a potentially leaked process.

## Boundaries

- No MCP tool/API/config/semver changes.
- No npm publish and no upstream release execution.
- Existing untracked hardening blueprint remains untracked.
- Each behaviour gets a regression test before production/config changes.

## Verification

- Security regression tests cover a symlink to a canonical sensitive root.
- MCP lifecycle tests prove child termination, and test runner builds `dist`
  before spawned-MCP tests execute.
- Upgrade tests cover the fork refusal.
- `npm test`, build, audit, focused lifecycle/root stress, and an independent
  whole-diff review gate must pass before push/global reinstall.
