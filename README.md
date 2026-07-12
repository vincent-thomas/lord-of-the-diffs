# vt-pi — a hardened Pi agent harness

This is a [Pi coding agent](https://github.com/earendil-works/pi) configuration
that prioritises **directed competence over raw capability**. The goal isn't to
make the agent as powerful as possible — it's to make invalid states
unrepresentable so the agent produces useful, correct output in fewer turns.

## How to install/run
(nix is required)

```bash
$ nix profile install github:vincent-thomas/vt-pi
$ pi
```

## Philosophy

The harness is built around a simple premise: **the agent prioritises correct workflow over raw intelligence by constraining the wrong paths.**
The constraints aren't there to limit capability — they're there to channel autonomy by always moving forward, methodically.

> Slow and steady wins the race.

Three design principles:

- **Block the wrong path, provide the right one.** Instead of telling the agent
  "don't push directly," the harness provides `push_and_check_ci` which pushes
  and polls CI. Instead of banning `git commit`, it provides `git_commit` with
  pre-checks. The dangerous path is structurally unavailable. *Make invalid
  state unrepresentable.*

- **The project defines "valid."** The harness doesn't guess what checks to run
  based on marker files. The `Makefile` defines what "valid" means — the
  harness just runs `make`. The project stays in control.

- **Commit rhythm over save-button mentality.** Every commit must represent a
  valid, coherent state at a point in time. The tools enforce this: the working
  tree must be clean before pushing, pre-checks must pass before committing.

## How it works

### System prompt (`packages/agent-lord/AGENTS.md`)

Bundled into the Pi binary and appended to every session. It establishes the
commit rhythm, edit discipline, and verification habits expected of the agent.
This is the "soft" layer — advice backed by structural enforcement below.

### Command policy (`packages/agent-lord/extensions/command-policy/`)

A whitelist of allowed shell commands. Every bash invocation is checked against
the policy entries at runtime:

- **Allowed commands** — `ls`, `git` (specific subcommands only), `nix build`,
  `head`, `tail`, `rg`, `fd`, `jq`, `rm` (no recursive flags), `mv`, `cp` (no
  recursive flags), etc.
- **Banned commands** — `sudo`, `grep`, `cat`, `sed`, `find` — each with a
  description of what to use instead (the tool, `rg`, `fd`, etc.)
- **Flag-level control** — `git checkout` is allowed but `-b` is banned.
  `chmod` is allowed but `-R` is banned.
- **Here-docs banned** — the `<<` operator is blocked entirely. Inline input
  should be used instead.

When a command is blocked, the agent gets a clear message explaining what was
blocked and what to do instead.

### Git tooling (`packages/agent-lord/extensions/git-commit/`, `packages/agent-lord/extensions/fix-ci/`)

The raw git commands (`git push`, `git commit`) are blocked in bash. Two tools
replace them:

**`git_commit`** — Stages (optionally), runs pre-checks, and commits. Pre-checks
run `make` (the project's Makefile defines what checks are needed). Rejects
commits on `main`/`master`.

**`push_and_check_ci`** — Pushes the current branch to origin, polls GitHub
Checks until they finish, and returns the results with failure logs. Before
pushing, it rejects dirty working trees (uncommitted changes). It also tries to
reconcile PR merge conflicts and divergent branches automatically, and stops
after `MAX_CYCLES` (3) fix attempts.

### Write guard (`packages/agent-lord/extensions/write-guard/`)

Blocks the `write` tool from overwriting existing files larger than 50 lines.
Forces the agent to use `edit` instead, which requires exact text matching and
can't silently drop content. The Makefile is fully protected — neither `write`
nor `edit` can modify it. If the Makefile needs to change, the agent must ask
the user.

### No file writes in bash (`packages/agent-lord/extensions/no-file-writes/`)

Blocks all shell redirections (`>`, `>>`) to files. The agent must use the
`write` or `edit` tools instead.

### Explore (`packages/agent-lord/extensions/explore/`, `packages/agent-explorer/`)

An `explore` tool that delegates read-only search/exploration questions to a
separate sub-agent session, run in-process via the Pi SDK (`createAgentSession`)
rather than a subprocess. It's restricted to `read`/`grep`/`find`/`ls` (no
write, edit, or bash), runs on a cheaper/faster model by default, and has no
extensions, skills, or `AGENTS.md` of its own — it starts clean rather than
inheriting agent-lord's system prompt. This keeps multi-file "where is X" /
"how does Y work" questions off agent-lord's own (pricier) model and out of
its own context, at the cost of one round trip into a fresh sub-session.

### Advisor (`packages/agent-lord/extensions/advisor/`, `packages/agent-advisor/`)

An `advisor` tool that lets agent-lord consult a separate, stronger sub-agent
session when it's genuinely stuck (repeated failed attempts, an ambiguous
approach, a hard-to-diagnose bug) — not for routine work. Structurally a
mirror of `explore`: an isolated in-process session, restricted to
`read`/`grep`/`find`/`ls`, with no inherited extensions/skills/`AGENTS.md`.
Where `explore` hands cheap lookups to a *cheaper* model to keep them off
agent-lord's context, `advisor` hands hard problems to a *stronger* model —
kept off agent-lord's own turn loop, so the frontier model's cost is paid
once on a bounded question instead of on every turn of an already-large
context. There's no automatic trigger; agent-lord decides when it's stuck
and calls the tool itself.

To keep that frontier session's context lean, the advisor also gets its own
`explore` tool (the same agent-explorer extension, injected via the resource
loader's `extensionFactories` so it loads even though disk discovery is off).
The prompt steers it to delegate broad, multi-file searches to that cheaper
sub-agent — the raw grep/read churn is distilled by the cheap model and never
enters the frontier context — while it reads directly for the precise,
targeted lookups where exact bytes matter.

### Sandbox (`packages/agent-lord/extensions/sandbox/`)

A `/sandbox` command that puts the agent in read-only mode. In sandbox mode,
the write and edit tools are blocked — the agent can only read files and run
read-only commands.

### Pre-check system (`packages/agent-lord/lib/precheck.ts`)

Runs `make` before every commit. The project defines what "valid" means
through its `Makefile` — currently this runs `nix build`, verifying the full
build and all tests. No harness-side project-type detection needed.

## Repository structure

```
vt-pi/
├── flake.nix                  # Nix build — packages everything
├── flake.lock
├── Makefile                   # Defines what "valid" means
└── packages/
    ├── agent-lord/             # Standalone @vt-pi/agent-lord pnpm package
    │   ├── AGENTS.md           # System prompt (bundled into binary)
    │   ├── extensions/
    │   │   ├── advisor/        # Wires the advisor tool into @vt-pi/agent-advisor
    │   │   ├── command-policy/ # Wires COMMAND_POLICY_ENTRIES into @vt-pi/command-policy
    │   │   ├── explore/        # Wires the explore tool into @vt-pi/agent-explorer
    │   │   ├── fix-ci/         # push_and_check_ci tool
    │   │   ├── git-commit/     # git_commit tool
    │   │   ├── no-file-writes/ # Blocks >/>> in bash
    │   │   ├── sandbox/        # /sandbox read-only mode
    │   │   └── write-guard/    # Blocks write on large existing files
    │   ├── lib/                # Pure logic, no Pi SDK imports
    │   │   ├── exec-async.ts
    │   │   ├── git-utils.ts
    │   │   ├── precheck.ts
    │   │   └── shell-quote.ts
    │   └── skills/              # Skill definitions (populated at build time)
    ├── agent-advisor/           # Read-only advisory sub-agent, stronger model (in-process SDK session)
    ├── agent-explorer/          # Read-only exploration sub-agent (in-process SDK session)
    └── command-policy/          # Shell command allow-list engine
```

## Adding an extension

1. Create `packages/agent-lord/extensions/<name>/index.ts` (and `logic.ts` for testable logic)
2. Import from `../../lib/` for shared helpers
3. Add a `logic.test.ts` alongside your logic — tests run on `nix build`
4. The flake auto-discovers and registers new extensions — no manual step

## Adding a skill

1. Create `packages/agent-lord/skills/<name>/SKILL.md` with frontmatter
   (`name`, `description`) and markdown body
2. Add it with `git add packages/agent-lord/skills/<name>/` (the flake discovers tracked skills)
3. The agent sees it in the `<available_skills>` block of the system prompt

## Building

```bash
nix build              # Builds everything, runs all tests
```
