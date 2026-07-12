---
name: command-policy
description: "Add, modify, or remove shell command policy entries in the `entries` array in packages/agent-lord/extensions/command-policy/index.ts. Use when allowing a new command, banning a command, or restricting flags."
---

# command-policy

The command policy is defined inline in `packages/agent-lord/extensions/command-policy/index.ts` as the `entries` array passed to `createCommandPolicyExtension({ entries: [...] })` from `@vt-pi/command-policy` (the `packages/command-policy` workspace package). Command-name predicates used by some entries (`isPythonCommand`, `isPerlCommand`, `isAwkCommand`) live in `packages/agent-lord/extensions/command-policy/predicates.ts`.

## Entry types

There are three entry forms, defined by `packages/command-policy/types.ts`:

### 1. Banned — full command ban

```typescript
{
  name: "sed",
  status: CommandPolicyStatus.Banned,
  command: "sed",
  description: "Use the edit tool for find-and-replace edits.",
}
```

- `command` can be a string (exact lowercase basename match) or a predicate `(use: CommandUse) => boolean` — `use.name` is the resolved command name, not a bare string, so match against `use.name` (not `use` itself)
- When a predicate is needed, match the command by name. Reusable name predicates live in `predicates.ts`:

```typescript
{
  name: "Python",
  status: CommandPolicyStatus.Banned,
  command: (use) => isPythonCommand(use.name),
  description: "Use safer shell tools or Pi tools instead.",
}
```

### 2. Allowed with banned flags

```typescript
{
  name: "rm",
  status: CommandPolicyStatus.Allowed,
  command: "rm",
  bannedFlags: ["-r", "-R", "-rf", "-fr", "--recursive"],
  description: "Use the edit or write tool for file management.",
}
```

- The command is allowed, but if any of `bannedFlags` is present, the invocation is blocked
- Mutually exclusive with `allowedFlags`

### 3. Allowed with allowed flags only

```typescript
{
  name: "git status",
  status: CommandPolicyStatus.Allowed,
  command: "git",
  subcommand: [["status"]],
  allowedFlags: ["--short", "--porcelain", "-s"],
}
```

- The command is allowed only when using one of the `allowedFlags`
- Mutually exclusive with `bannedFlags`
- `subcommand` is an array of string-arrays with OR semantics: each inner array is a full sequence of positional args to match (case-insensitive), and the entry matches if ANY inner array matches — e.g. `[["status"]]` matches `git status`, and `[["remote", "add"], ["remote", "remove"]]` matches either `git remote add` or `git remote remove`

### Subcommand filtering

Use `subcommand` to restrict policy to specific git (or other) subcommands:

```typescript
{ name: "git add",     status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["add"]] }
{ name: "git diff",    status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["diff"]] }
```

If `subcommand` is not set, the policy matches any invocation of that command (e.g., `"ls"` matches all `ls` calls).

## How matching works

1. The bash command string is split into segments (handling pipes `|`, `&&`, `||`, `;`, newlines, redirections, command substitutions)
2. Each segment is resolved through wrappers (`env`, `sudo`, `nohup`, `exec`, `time`, etc.) and environment-variable prefixes to find the real command
3. If a segment's resolved command doesn't match any entry, **it is blocked** with "Command is not on the allow list"
4. If it matches an entry:
   - `Banned` → blocked with the description
   - `Allowed` with `bannedFlags` → checked, blocked if a banned flag is used
   - `Allowed` with `allowedFlags` → checked, blocked if a flag outside the set is used
   - `Allowed` with no flag restrictions → allowed

## Adding an entry

1. Open `packages/agent-lord/extensions/command-policy/index.ts`
2. Add a new object to the `entries` array passed to `createCommandPolicyExtension({ entries: [...] })`
3. If the entry needs a new command-name predicate, add it to `predicates.ts` (with a unit test in `predicates.test.ts`) and import it in `index.ts`
4. Run `nix build` to verify the extension still compiles and tests pass
