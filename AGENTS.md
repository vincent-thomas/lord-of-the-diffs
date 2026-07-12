# vt-pi project instructions

You are working on the vt-pi repo — a Nix flake that builds a customized version
of the Pi coding agent CLI with personal extensions, shell command policies,
workflow tools, standalone planner/coder agents, and GitHub App auth wrappers.

## What this repo is

The flake (`flake.nix`) exposes several packages/apps:

- `packages.default` / `packages.pi` — the full code-writer (`pi` binary). Wraps
  upstream Pi with all of `agent-lord`'s extensions/skills/`AGENTS.md` bundled
  in, plus the LOTD `git`/`gh` wrappers and credential helper on `PATH`.
- `packages.planner` — the read-only planner agent (`pi` binary, restricted to
  `read`/`grep`/`find`/`ls`/`explore`/`submit_plan`) built from
  `packages/agent-planner/`. Decomposes a feature request into single-task
  chunks; can never write/edit/bash.
- `packages.coder` — the standalone `agent-coder` binary, built from
  `packages/agent-coder/index.ts`. A hyper-specialized single-task code-writer,
  not a wrapper around upstream `pi`.
- `packages.piBase` — unmodified upstream Pi, built from
  `github:earendil-works/pi`.
- `packages.piCustomizations` — the deployed `agent-lord/` tree (extensions +
  lib + skills + `AGENTS.md` + `node_modules`) that stacks onto `piBase`.
- `packages.lotd-token` — CLI that reads `LOTD_CONFIG_FILE`, builds an RS256
  JWT and exchanges it for a short-lived GitHub App installation token.
- `packages.lotd-credential-helper` — git credential helper that wraps
  `lotd-token` in the credential-helper protocol.
- `packages.git` — a wrapper around real `git` that sets
  `GIT_AUTHOR_*`/`GIT_COMMITTER_*` from the LOTD config's `login`, injects the
  credential helper, and enforces HTTPS for GitHub remotes.
- `packages.gh` — a wrapper around real `gh` that exports
  `GH_TOKEN=$(lotd-token)` before delegating.

Apps (`nix run`): `default`/`pi` → the code-writer, `planner` → the planner
agent, `coder` → `agent-coder`.

The `mkPiAgent` helper in `flake.nix` is the shared builder for the two
`pi`-wrapper agents (`pi` and `planner`): it takes a deployed workspace tree
(agent-lord for `pi`, agent-planner for `planner`), copies `piBase` in, points
the wrapper at the tree's extensions/skills/`AGENTS.md` and reused
`node_modules`, and drops the LOTD `git`/`gh`/`lotd-token`/
`lotd-credential-helper` binaries alongside it. `coder` is built separately
because it's its own agent binary, not a wrapper around upstream `pi`.

The `pi` wrapper refuses to start unless `LOTD_CONFIG_FILE` points at a JSON
file with `appId`, `installId`, `privateKeyPath`, and `login` fields — that's
how the agent authenticates to GitHub as a GitHub App instead of via a personal
token. `git push` / `gh` calls inside the sandbox go through the wrappers and
the credential helper mints a fresh installation token on demand.

Run `nix build` or `nix run` to get the final customized pi binary.

## Repository structure

```
vt-pi/
├── flake.nix                  # The build — all packaging logic lives here
├── flake.lock
├── Makefile                   # Defines what "valid" means for pre-checks
├── package.json               # Root pnpm workspace
├── pnpm-workspace.yaml        # Declares packages/* as workspace members
├── tsconfig.base.json         # Shared tsc config for the @vt-pi/* leaf packages' build step
└── packages/                  # Standalone @vt-pi/* pnpm packages
    ├── agent-lord/             # Everything bundled into the main pi binary — a single
    │   │                       # pnpm workspace member (@vt-pi/agent-lord) covering both lib/
    │   │                       # and extensions/*; they reference each other with relative imports
    │   ├── AGENTS.md           # System prompt shipped with the binary
    │   ├── extensions/         # Extensions — each either a single .ts file or a subdirectory
    │   │   ├── advisor.ts       # Wires the advisor tool into @vt-pi/agent-advisor
    │   │   ├── command-policy/  # index.ts + predicates.ts (+ predicates.test.ts)
    │   │   │                    # index.ts holds the inline
    │   │   │                    # createCommandPolicyExtension({ entries: [...] }) call
    │   │   ├── explore.ts       # Wires the explore tool into @vt-pi/agent-explorer
    │   │   ├── fix-ci.ts        # Wires push_and_check_ci from @vt-pi/fix-ci
    │   │   ├── git-commit/      # git_commit tool; blocks git commit in bash
    │   │   ├── no-file-writes/  # Blocks >, >> shell redirections to files
    │   │   └── write-guard/     # Blocks write on existing files > 50 lines
    │   ├── lib/                # Pure logic shared across extensions
    │   │   ├── exec-async.ts
    │   │   ├── git-utils.ts
    │   │   ├── precheck.ts
    │   │   └── shell-quote.ts
    │   └── skills/              # Skill definitions (populated at build time)
    ├── agent-advisor/           # @vt-pi/agent-advisor — stronger-model advisory sub-agent
    ├── agent-coder/             # @vt-pi/agent-coder — standalone single-task coder CLI
    ├── agent-explorer/          # @vt-pi/agent-explorer — cheap read-only exploration sub-agent
    ├── agent-planner/           # @vt-pi/agent-planner — standalone read-only planner agent
    ├── command-policy/          # @vt-pi/command-policy — shell command allow-list engine
    └── fix-ci/                  # @vt-pi/fix-ci — push_and_check_ci engine (push, PR, poll CI)
```

## How extensions are structured

Each extension under `packages/agent-lord/extensions/` exports a default
function that takes a Pi `ExtensionAPI`. An extension is either a single
`<name>.ts` file (e.g. `advisor.ts`, `explore.ts`, `fix-ci.ts`) or a
`<name>/index.ts` inside its own subdirectory (e.g. `command-policy/`,
`git-commit/`, `write-guard/`); the flake auto-discovers both forms.

Extensions use three main APIs:

- `pi.registerTool(name, { parameters, execute })` — registers a tool the agent can invoke
- `pi.registerCommand(name, { handler })` — registers a slash command
- `pi.on("tool_call" | "before_agent_start" | "agent_end", handler)` — lifecycle hooks

The `packages/agent-lord/lib/` directory holds shared code, imported via
relative paths (e.g. `../../lib/git-utils.ts`) since `lib/` and `extensions/*`
are part of the same pnpm workspace member (`@vt-pi/agent-lord`,
`packages/agent-lord/package.json`). **No Pi imports allowed in lib/** — it
must stay pure TypeScript so it can be imported from any extension's logic
module. Extensions should keep Pi imports in `index.ts` (or the single
`<name>.ts` entry point) and put testable logic in a sibling module
(`predicates.ts`, `logic.ts`, …).

## pnpm workspaces and packages/

The repo is a pnpm workspace (`pnpm-workspace.yaml` covers every `packages/*`,
including `packages/agent-lord` — one member for the whole lib+extensions
tree). Workspace-local dependencies (e.g. `@vt-pi/agent-lord`'s dependency on
`@vt-pi/command-policy`) are declared with the `workspace:*` protocol so pnpm
links them locally instead of trying to fetch them from the registry.
Workspace members are plain TypeScript with no build step for anything
consumed by *relative* import — Node's native type-stripping runs `.ts`
files directly, both in `nix build` and via `node --test`. The five leaf
`@vt-pi/*` packages (`command-policy`, `agent-advisor`, `agent-explorer`,
`agent-coder`, `fix-ci`) are the exception: they're consumed from `agent-lord`
(or, for `agent-coder`, deployed as its own standalone tree) by *package name*
through `node_modules`, and Node refuses to type-strip a `.ts` file whose real
path resolves under any `node_modules` directory. So each has a `tsconfig.json`
(extending the root `tsconfig.base.json`) and a `build: tsc` script that
compiles it to plain `dist/*.js` — that's what their `exports` field points at.
`noCheck` is set on purpose: this build step exists only to emit plain JS Node
will load through node_modules, not to add a new type-checking gate Node's own
stripping never had.

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
`packages/agent-lord/extensions/command-policy/predicates.ts` instead, since
*which* interpreters to ban is a policy choice made where entries are
constructed, not something the engine itself needs.

**Tests for a package's own logic (the matching engine, etc.) live inside
the package**, as plain unit tests against its internals via relative
imports (`packages/command-policy/matching.test.ts` imports `./matching.ts`
directly — the `exports` restriction only applies to imports from *outside*
the package). Don't write tests that fake Pi's `ExtensionAPI` to drive the
wired extension end-to-end; test the underlying functions directly instead.
Tests for *this repo's own* configuration (e.g. the policy entries wired up
by `createCommandPolicyExtension({ entries: [...] })` in
`packages/agent-lord/extensions/command-policy/index.ts`, and the predicates
in `predicates.ts`) live in the extension.

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
package. It then builds the five `@vt-pi/*` leaf packages (`pnpm -r run
build`, see above) and runs three `pnpm deploy` invocations against the
resulting install — one per standalone agent tree:

- `pnpm --filter=@vt-pi/agent-lord deploy` → `agent-lord/` (extensions + lib +
  skills + `AGENTS.md` + `node_modules`), consumed by `piCustomizations`/`pi`.
- `pnpm --filter=@vt-pi/agent-planner deploy` → `agent-planner/`, the
  self-contained tree the `planner` binary is built from.
- `pnpm --filter=@vt-pi/agent-coder deploy` → `agent-coder/`, the
  self-contained tree the `coder` binary is built from.

Each deployed tree has every `@vt-pi/*` dependency and real dependency (e.g.
`@mariozechner/pi-coding-agent`) fully materialized by pnpm — no symlinks back
into this build's own tree. `piCustomizations` is just a copy of the deployed
`agent-lord/`. The `pi` and `planner` derivations reuse the corresponding
deployed tree's already-assembled `node_modules` as-is; `coder` builds
`agent-coder/dist/index.js` out of its deployed tree and wraps it as its own
binary. Adding a new `packages/*` package that any of the deployed agents
depends on needs no extra wiring beyond declaring the `workspace:*` dependency
— `pnpm deploy` picks it up automatically. Adding a package with a new
external dependency just needs the `pnpmDeps` hash regenerated (`nix build
2>&1 | awk '/got:/{print $2}'`).

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

1. Create either `packages/agent-lord/extensions/<name>.ts` (single-file
   extension) or `packages/agent-lord/extensions/<name>/index.ts` (with a
   sibling `predicates.ts` / `logic.ts` for testable helpers)
2. Import from `../../lib/` for shared helpers
3. Add a `*.test.ts` alongside your logic — tests run on build
4. Run `nix build` — the flake auto-discovers both file- and directory-form
   extensions (skipping `*.test.ts`) and registers each with `--extension`
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
