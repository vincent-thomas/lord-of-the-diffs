# Agent instructions — surgical changes & clean history

**Every change and every commit must be deliberate.** If you can't justify it, don't make it.

---

## Think first — plan before you act

Before touching any tool, take a moment to orient:

- **Name the goal.** What exactly am I being asked to do? Restate it briefly to yourself.
- **Survey first.** What files exist? What's the structure? Breadth-first exploration beats depth-first — read the index, the entry point, the types, then drill in.
- **Outline the plan.** A sentence or two: "I need to understand X, then change Y in file Z, then verify by running V." Share this with the user if the task is complex.
- **Choose the right tool.** The bash tool is for side-effect-free queries (`which`, `ls`, `rg`, `fd`, `jq`). The `read` tool is for file contents. The `edit`/`write` tools are for changes. Pick the simplest one for the job.
- **When ambiguous, ask.** Don't guess user intent. A one-line question saves a round of wrong work.

---

## Tools — use Pi tools first, bash as a last resort

You have Pi-native tools and a bash tool. Prefer Pi tools whenever possible:

| Instead of bash…    | Use the Pi tool…                                |
|---------------------|-------------------------------------------------|
| `cat`, `less`       | `read` — supports offset/limit for large files  |
| `grep`              | `rg` (via bash) — faster, respects .gitignore   |
| `find`              | `fd` (via bash) — faster, respects .gitignore   |
| `sed -i`            | `edit` — exact-text matching, safer             |
| `>`, `>>`, `tee`    | `write` (new files) or `edit` (existing files)  |
| `git commit`         | `git_commit` tool — pre-checks, blocks main     |
| `git push`           | `push_and_check_ci` tool — creates PR, polls CI |
| `python`, `perl`, `awk` | jq for JSON, `head`/`tail`/`wc` for text    |

Shell redirections to files (`>`, `>>`) are blocked — always use `write` or `edit`.

### Writing files: `write` vs `edit`

- **`write`** — only for *new* files or very small existing files. Overwriting a large file with `write` silently drops content; this is blocked by a guard.
- **`edit`** — for modifying existing files. It requires exact-text matching, which protects against accidental overwrites. Use it for all file modifications.
- **Protected folders** (`.git/`, `node_modules/`, etc.) cannot be modified — don't try.

### Git workflow tools

- **`git_commit`** — your ONLY way to commit. It runs pre-commit checks, blocks commits on `main`/`master`, and auto-stages with `add_all: true`. Use it for every commit.
- **`push_and_check_ci`** — your ONLY way to push. It pushes, creates/updates a draft PR, polls CI checks, and marks the PR ready if all pass. It will also auto-merge the base branch before pushing to keep the PR up to date. Call it after meaningful work is committed.
- **`yield_with_uncommitted_changes`** — escape hatch. Use only as a last resort when you genuinely cannot commit or push but must yield back. Always prefer committing and pushing.

---

## Code changes — surgical precision

- **Read before you act.** Never assume what a file contains. Blind writes break things.
- **Prefer `edit` over `write` for existing files.** `edit` forces exact-text matching — safer than `write`, which can silently swallow content. Only `write` genuinely new files.
- **Change only what needs changing.** No reformatting, no reordering imports, no fixing unrelated nits, no whitespace noise. Each of those is its own intentional change. If broader cleanup is needed, propose it separately.
- **One logical step at a time, but batch safe edits.** A "step" is one conceptual change. Within that step, you can batch multiple independent, non-overlapping edits to different regions of the same file in a single `edit` call — the tool supports it. Don't batch unrelated changes to different files into one commit or one action.
- **Never fix opportunistic issues** (typos, style, minor bugs) in the same pass as your main change. Mention them to the user if relevant; don't sneak them in.

---

## Guard the context window

The context window is finite. Long tool outputs push older reasoning out. Stay disciplined:

- **Summarize large reads.** After reading a file larger than 200 lines, collapse your mental model: "This file defines the X interface, Y helper, and Z export. Key line is 42." Don't echo the full content back to yourself.
- **Truncate outputs you don't need.** When a bash command returns pages of output, extract only the relevant lines and let the rest go.
- **Use breadcrumbs.** After multiple steps in a complex task, write a one-line status summary: `// Status: read config, found field X, about to edit Y`. This anchors you if the context shifts.
- **Re-read strategically.** If you can't remember exact details from earlier in the conversation, read the relevant file region again instead of relying on memory.

---

## Errors are data — recover, don't surrender

When a tool call fails or is blocked, treat the error as debugging input:

1. **Read the error carefully.** Did the tool reject the input? Did bash exit non-zero? Was the call *blocked* by a policy (e.g., write-guard, folder-protector, command-policy)? What does the error message actually say?
2. **If blocked, don't retry the same approach.** A blocked tool call means the approach itself is disallowed. Read the block reason, then switch to the suggested alternative — use `edit` instead of `write`, use a Pi tool instead of a banned shell command, or use `git_commit` instead of raw `git commit`.
3. **Diagnose before retrying.** Guessing and re-running wastes time. Understand the failure first: wrong path? syntax error? missing dependency?
4. **Fix, then retry.** Apply a targeted fix (different flag, correct path, altered approach) and retry the same operation. Don't try a completely different approach unless the diagnosis shows the first approach is fundamentally wrong.
5. **Know when to stop.** After 3 retries on the same operation without progress, tell the user what you tried, what failed, and what you suspect — don't keep spinning.
6. **Tests and builds are not optional failures.** If a pre-check or CI step fails, read the output, understand why, and fix the root cause. Skipping or silencing is not an option.

---

## Commit rhythm — checkpoint every valid state

**Every commit must represent a valid, coherent state at a point in time.** A commit is not a save button — it's a checkpoint that tells part of the story. The tree should be internally consistent (no syntax errors, no dangling references, no half-applied renames), even if the full feature isn't wired up yet. If you've made 3+ edits without committing, you skipped a checkpoint — stop and commit before continuing.

- **Break big tasks into small, independent commits.** If a task touches multiple files or has multiple logical steps, do them one at a time and commit after each. Each commit must be valid on its own — no dangling references, no half-finished abstractions, no commented-out code that a future commit will uncomment.
  - Good sequence for "Add a new config option":
    1. `"Add parseConfig function"` — introduces the parser, no callers yet
    2. `"Wire parseConfig into ConfigReader"` — connects existing code to new parser
  - Bad: `"Add config option"` — a single commit that adds the parser, wires it in, AND modifies config files. If anything goes wrong, everything is mixed together.
- **One logical change per commit.** If the message contains "and", the commit is too large.
  - Good: `"Refactor ConfigReader to use parseConfig"`
  - Too big: `"Add config parsing and update callers"`
- **Commit messages: "why", not "what".** The diff shows what. The message explains context, reasoning, trade-offs. Imperative mood, ≤72 char subject.
- **Order commits logically:** refactoring/prep first, new abstractions next, usage changes last. Each commit should leave the tree in a valid (or acceptable intermediate state) and never depend on future commits to compile or pass checks.
- **Never commit:** debugging artifacts, commented-out code, lockfile drift, unrelated whitespace.
- **Use the tools (`git_commit`, `push_and_check_ci`), not raw bash.** They enforce the rules above and block dangerous operations.
  - `git_commit { message: "...", add_all: true }` — stages everything and commits in one step. Use this for quick checkpoints where all changes belong together.
  - `git_commit { message: "...", add_all: false }` — commits only pre-staged changes (for selective commits).
- **Branch hygiene:** short-lived, focused branches. Never commit on `main`/`master`.

### Pushing: when and how

Push after you've built a meaningful, coherent set of commits — not after every single commit, but before yielding back to the user. Use `push_and_check_ci` (never `git push`). It will:
1. Auto-merge the base branch if it's ahead (keeping your PR up to date)
2. Push your commits
3. Create a draft PR if one doesn't exist
4. Poll CI until all checks finish
5. Mark the PR ready for review if CI passes

If CI fails, read the failure logs (included in the response), fix the issues locally, commit, and call `push_and_check_ci` again. After 3 fix cycles without success, stop and tell the user.

---

## Before yielding — resolve your git state

Before returning control to the user, check your state:

1. **Are there uncommitted changes?** Commit them with `git_commit` (or discard with `git checkout -- .`).
2. **Are there unpushed commits?** Push them with `push_and_check_ci`.
3. **Only as a last resort:** call `yield_with_uncommitted_changes(reason: "...")` if you genuinely cannot commit or push.

---

## Trust, but verify
Always verify your changes took effect and the result is valid. After every `edit`, re-read the changed region to confirm the replacement was applied correctly. After every commit, confirm the tree is in the expected state. This applies doubly to edits and commits — everything this file is about.

