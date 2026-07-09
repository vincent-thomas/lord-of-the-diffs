# vt-pi project instructions

You are working on the vt-pi repo — a Nix flake that builds a customized version
of the Pi coding agent CLI with personal extensions, shell command policies,
and workflow tools.

## What this repo is

The flake (`flake.nix`) produces three Nix packages:

- `piBase` — unmodified upstream Pi, built from `github:earendil-works/pi`
- `piCustomizations` — our code from `./pi/` (tested at build time)
- `pi` (the default) — `piBase` + `piCustomizations` merged, with a wrapper
  that auto-loads every extension, every skill, and the system prompt

Run `nix build` or `nix run` to get the final customized pi binary.

## Repository structure

```
vt-pi/
├── flake.nix                  # The build — all packaging logic lives here
├── flake.lock
├── package.json               # Root npm workspace (pi/lib, pi/extensions/*, packages/*)
├── packages/                  # Standalone @vt-pi/* npm packages, promoted out of pi/lib
│   └── command-policy/        # @vt-pi/command-policy — shell command allow-list engine
└── pi/                        # Everything that gets bundled into the package
    ├── AGENTS.md              # System prompt shipped with the binary
    ├── extensions/            # One subdirectory or .ts file per extension
    │   ├── command-policy/    # Wires COMMAND_POLICY_ENTRIES into @vt-pi/command-policy
    │   ├── fix-ci/            # push_and_check_ci tool; blocks git push in bash
    │   ├── git-commit/        # git_commit tool; blocks git commit in bash
    │   ├── sandbox/           # /sandbox command for read-only mode
    │   ├── no-file-writes/    # Blocks >, >> shell redirections to files
    │   └── write-guard/       # Blocks write on existing files > 50 lines
    └── lib/                   # @vt-pi/lib — pure logic shared across extensions
        ├── command-utils.ts
        └── git-utils.ts
```

## How extensions are structured

Each extension under `pi/extensions/` exports a default function that takes a
Pi `ExtensionAPI`. Extensions use three main APIs:

- `pi.registerTool(name, { parameters, execute })` — registers a tool the agent can invoke
- `pi.registerCommand(name, { handler })` — registers a slash command like `/sandbox`
- `pi.on("tool_call" | "before_agent_start" | "agent_end", handler)` — lifecycle hooks

The `pi/lib/` directory (npm package `@vt-pi/lib`) holds shared code. **No Pi
imports allowed in lib/** — it must stay pure TypeScript so it can be
imported from any extension's logic module. Extensions should keep Pi
imports in `index.ts` and put testable logic in their own `logic.ts`.

## npm workspaces and packages/

The repo is an npm workspace (root `package.json`'s `workspaces` field covers
`pi/lib`, every `pi/extensions/*`, and every `packages/*`). Workspace members
are plain TypeScript with no build step — Node's native type-stripping runs
`.ts` files directly, both in `nix build` and via `node --test`.

`pi/lib/` is for logic shared across *this repo's* extensions. Promote code
out of `pi/lib/` into its own `packages/<name>/` package when it's a
self-contained feature with its own public API that's substantial enough to
reason about independently — e.g. `@vt-pi/command-policy` bundles the shell
command allow-list types, matching engine, and the Pi extension factory
behind one entry point (`createCommandPolicyExtension`), rather than leaving
that logic as loose files in `pi/lib/` alongside unrelated helpers like
`git-utils.ts`.

A package's `package.json` needs an `exports` map entry for every subpath
another workspace member imports (e.g. `@vt-pi/lib/command-utils.ts`). Keep
Pi-touching code (anything importing `@mariozechner/pi-coding-agent`) in its
own file behind the package's main `index.ts` export — pure-logic test files
elsewhere in the repo should import a pure subpath (e.g.
`@vt-pi/command-policy/matching.ts`) instead of the barrel, so testing that
logic doesn't require `@mariozechner/pi-coding-agent` to be resolvable.

**A `packages/*` package must not depend on any other `@vt-pi/*` workspace
package** (only on external deps like `@mariozechner/pi-coding-agent`, which
is fine — Pi is the framework these extensions run in, not part of this
repo's own internal layering). Depending on `@vt-pi/lib` would tie a package
that's meant to stand on its own back to this monorepo's internal helpers.
If a package needs something also used by `pi/lib/` or another extension
(e.g. the shell-parsing helpers in `command-utils.ts`), duplicate that code
into the package rather than importing it — see
`packages/command-policy/command-utils.ts`, a deliberate copy of
`pi/lib/command-utils.ts`'s parsing logic.

**Tests for a package's logic live in the extension that consumes it, not in
the package itself** — e.g. `packages/command-policy/` has no `*.test.ts`
files; `matching.test.ts`, `predicates.test.ts`, and `logic.test.ts` all live
under `pi/extensions/command-policy/`, importing the package's pure subpaths
(`@vt-pi/command-policy/matching.ts`, etc.) to test it from the consumer's
side. This keeps `packages/*` as plain, test-free implementations that vt-pi
exercises through its own extension test suites, the same way vt-pi tests
everything else it depends on.

`flake.nix`'s `piCustomizations` and `pi` derivations wire up each
`@vt-pi/*` workspace package as a symlink under `node_modules/@vt-pi/` —
equivalent to what `npm install` would produce for these
zero-external-dependency workspace members, without needing network access
mid-build. Adding a new package requires a matching `ln -s` line in both
derivations.

## Test files

Test files use `*.test.ts` and sit alongside the code they test. They run
during `nix build` — the flake discovers them automatically and runs them
with `node`. Test files are filtered out of extension registration (the
flake skips them when building the wrapper flags).

## Editing conventions when working on this repo

### Tools and shell commands

- Commit on feature branches, never on `main`/`master`
- Run `nix build` to verify changes before pushing

### Key commands

```bash
nix build              # Verify the full build passes (includes tests)
nix flake update       # Update upstream pi and nixpkgs inputs
```

## Adding a new extension

1. Create `pi/extensions/<name>/index.ts` (and `logic.ts` for testable logic)
2. Import from `../../lib/` for shared helpers
3. Add a `logic.test.ts` alongside your logic — tests run on build
4. Run `nix build` — the flake auto-discovers and registers new extensions
5. No manual registration step needed

## Adding a new skill

1. Create `pi/skills/<name>/SKILL.md`
2. The flake auto-discovers any skills that are tracked by git. Use
   `git add <path>` to make git track it.
3. The agent sees them via `<available_skills>` in the system prompt

## The system prompt

`pi/AGENTS.md` is the system prompt bundled with the binary and passed via
`--append-system-prompt`. It is separate from this file. When changing how
the agent behaves at runtime, edit `pi/AGENTS.md`. When changing how the
agent should work on *this repo*, edit this file (`./AGENTS.md`).
