# vt-pi project instructions

You are working on the vt-pi repo — a Nix flake that builds a customized version
of the Pi coding agent CLI with personal extensions, shell command policies,
and workflow tools.

## What this repo is

The flake (`flake.nix`) produces three Nix packages:

- `piBase` — unmodified upstream Pi, built from `github:earendil-works/pi`
- `piCustomizations` — our code from `./packages/agent-lord/` (tested at build time)
- `pi` (the default) — `piBase` + `piCustomizations` merged, with a wrapper
  that auto-loads every extension, every skill, and the system prompt

Run `nix build` or `nix run` to get the final customized pi binary.

## Repository structure

```
vt-pi/
├── flake.nix                  # The build — all packaging logic lives here
├── flake.lock
├── Makefile                   # Defines what "valid" means for pre-checks
├── package.json               # Root pnpm workspace
├── pnpm-workspace.yaml         # Declares packages/* as workspace members
├── tsconfig.base.json          # Shared tsc config for the @vt-pi/* leaf packages' build step
└── packages/                  # Standalone @vt-pi/* pnpm packages
    ├── agent-lord/             # Everything that gets bundled into the package — a single
    │   │                       # pnpm workspace member (@vt-pi/agent-lord) covering both lib/
    │   │                       # and extensions/*; they reference each other with relative imports
    │   ├── AGENTS.md           # System prompt shipped with the binary
    │   ├── extensions/         # One subdirectory per extension
    │   │   ├── command-policy/ # Wires COMMAND_POLICY_ENTRIES into @vt-pi/command-policy
    │   │   ├── commit-enforcer/# Nags the agent to commit/push before yielding
    │   │   ├── fix-ci/         # push_and_check_ci tool; blocks git push in bash
    │   │   ├── git-commit/     # git_commit tool; blocks git commit in bash
    │   │   ├── no-file-writes/ # Blocks >, >> shell redirections to files
    │   │   └── write-guard/    # Blocks write on existing files > 50 lines
    │   ├── lib/                # Pure logic shared across extensions
    │   │   ├── exec-async.ts
    │   │   ├── git-utils.ts
    │   │   ├── precheck.ts
    │   │   └── shell-quote.ts
    │   └── skills/              # Skill definitions (populated at build time)
    └── command-policy/          # @vt-pi/command-policy — shell command allow-list engine
```

## How extensions are structured

Each extension under `packages/agent-lord/extensions/` exports a default function that takes a
Pi `ExtensionAPI`. Extensions use three main APIs:

- `pi.registerTool(name, { parameters, execute })` — registers a tool the agent can invoke
- `pi.registerCommand(name, { handler })` — registers a slash command
- `pi.on("tool_call" | "before_agent_start" | "agent_end", handler)` — lifecycle hooks

The `packages/agent-lord/lib/` directory holds shared code, imported via relative paths (e.g.
`../../lib/git-utils.ts`) since `lib/` and `extensions/*` are part of
the same pnpm workspace member (`@vt-pi/agent-lord`, `packages/agent-lord/package.json`). **No Pi
imports allowed in lib/** — it must stay pure TypeScript so it can be
imported from any extension's logic module. Extensions should keep Pi
imports in `index.ts` and put testable logic in their own `logic.ts`.

## pnpm workspaces and packages/

The repo is a pnpm workspace (`pnpm-workspace.yaml` covers every `packages/*`,
including `packages/agent-lord` — one member for the whole lib+extensions
tree). Workspace-local dependencies (e.g. `@vt-pi/agent-lord`'s dependency on
`@vt-pi/command-policy`) are declared with the `workspace:*` protocol so pnpm
links them locally instead of trying to fetch them from the registry.
Workspace members are plain TypeScript with no build step for anything
consumed by *relative* import — Node's native type-stripping runs `.ts`
files directly, both in `nix build` and via `node --test`. The three leaf
`@vt-pi/*` packages (`command-policy`, `agent-advisor`, `agent-explorer`)
are the exception: they're consumed from `agent-lord` by *package name*
through `node_modules`, and Node refuses to type-strip a `.ts` file whose
real path resolves under any `node_modules` directory. So each has a
`tsconfig.json` (extending the root `tsconfig.base.json`) and a `build: tsc`
script that compiles it to plain `dist/*.js` — that's what their `exports`
field points at. `noCheck` is set on purpose: this build step exists only to
emit plain JS Node will load through node_modules, not to add a new
type-checking gate Node's own stripping never had.

`packages/agent-lord/lib/` is for logic shared across *this repo's*
extensions, referenced by relative import since it's in the same workspace
member as the extensions that use it. Promote code out of
`packages/agent-lord/lib/` into its own `packages/<name>/` package when it's
a self-contained feature with its own public API that's substantial enough
to reason about independently, and that other consumers outside this repo's
own extensions might plausibly want — e.g. `@vt-pi/command-policy` bundles
the shell command allow-list types, matching engine, and the Pi extension
factory behind one entry point (`createCommandPolicyExtension`), rather than
leaving that logic as loose files in `packages/agent-lord/lib/` alongside
unrelated helpers like `git-utils.ts`.

**A package encapsulates its functionality: `index.ts` is the only file in
`package.json`'s `exports`, and it exports only the thing the package is
for plus the types needed to use it** — for `@vt-pi/command-policy`, that's
`createCommandPolicyExtension` (default export) and `CommandPolicyEntry`/
`CommandPolicyStatus`/`CommandUse`/`CommandPolicyOptions`. The matching
engine (`matchesEntry`, `findBannedFlag`, …) and `command-utils.ts` are
private, used only internally by `createCommandPolicyExtension`, and may be
freely restructured. Code that isn't used internally by the package's own
public function doesn't belong in the package — e.g. the command-name
predicates (`isPythonCommand`, …) live in
`packages/agent-lord/extensions/command-policy/` instead, since *which*
interpreters to ban is a policy choice made where entries are constructed,
not something the engine itself needs.

**Tests for a package's own logic (the matching engine, etc.) live inside
the package**, as plain unit tests against its internals via relative
imports (`packages/command-policy/matching.test.ts` imports `./matching.ts`
directly — the `exports` restriction only applies to imports from *outside*
the package). Don't write tests that fake Pi's `ExtensionAPI` to drive the
wired extension end-to-end; test the underlying functions directly instead.
Tests for *this repo's own* configuration (e.g. `COMMAND_POLICY_ENTRIES` in
`packages/agent-lord/extensions/command-policy/logic.ts`) live in the
extension.

A package that needs a real external dependency (e.g.
`@mariozechner/pi-coding-agent`, which `createCommandPolicyExtension` needs
for `ExtensionAPI`/`isToolCallEventType`) just declares it normally in that
package's `package.json` `dependencies` — same as any npm package.
`packages/agent-lord/lib/` still must not depend on any `@vt-pi/*` workspace
package or on Pi; a package that needs logic resembling something in
`packages/agent-lord/lib/` keeps its own self-contained copy inside the
package (see `packages/command-policy/command-utils.ts`) rather than
importing across that boundary.

`flake.nix`'s `workspaceDeps` derivation runs a real, hash-pinned `pnpm
install` against the root workspace (`fetchPnpmDeps` + `pnpmConfigHook`,
mirroring the `buildNpmPackage` + `npmDepsHash` pattern `piBase` uses for its
own deps) to resolve real external dependencies declared by any workspace
package. It then builds the three `@vt-pi/*` leaf packages (`pnpm -r run
build`, see above) and runs `pnpm --filter=@vt-pi/agent-lord deploy` to
produce a self-contained `agent-lord/` tree: its own
`extensions/lib/skills/AGENTS.md` alongside a `node_modules` where every
`@vt-pi/*` dependency and real dependency (e.g. `@mariozechner/pi-coding-agent`)
is fully materialized by pnpm — no symlinks back into this build's own tree.
`piCustomizations` is just a copy of that deployed directory.
The final `pi` derivation reuses `piCustomizations`'s already-assembled
`node_modules` as-is. Adding a new `packages/*` package that `agent-lord`
depends on needs no extra wiring beyond declaring the `workspace:*`
dependency — `pnpm deploy` picks it up automatically. Adding a package with a
new external dependency just needs the `pnpmDeps` hash regenerated (`nix
build 2>&1 | awk '/got:/{print $2}'`).

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

1. Create `packages/agent-lord/extensions/<name>/index.ts` (and `logic.ts` for testable logic)
2. Import from `../../lib/` for shared helpers
3. Add a `logic.test.ts` alongside your logic — tests run on build
4. Run `nix build` — the flake auto-discovers and registers new extensions
5. No manual registration step needed

## Adding a new skill

1. Create `packages/agent-lord/skills/<name>/SKILL.md`
2. The flake auto-discovers any skills that are tracked by git. Use
   `git add <path>` to make git track it.
3. The agent sees them via `<available_skills>` in the system prompt

## The system prompt

`packages/agent-lord/AGENTS.md` is the system prompt bundled with the binary
and passed via `--append-system-prompt`. It is separate from this file. When
changing how the agent behaves at runtime, edit
`packages/agent-lord/AGENTS.md`. When changing how the agent should work on
*this repo*, edit this file (`./AGENTS.md`).
