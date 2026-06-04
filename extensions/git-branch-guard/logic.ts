/**
 * logic.ts — pure, pi-free helpers for git-branch-guard.
 *
 * No imports from @mariozechner/pi-coding-agent here so this file can be
 * tested directly with Node (no jiti / pi runtime needed):
 *
 *   node logic.test.ts
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Returns the current branch name, or null if not inside a git repo. */
export function currentBranch(cwd: string): string | null {
  try {
    return (
      execSync("git branch --show-current", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Branch-switch detection
// ---------------------------------------------------------------------------

/**
 * Classifies a blocked branch-switch line so callers can produce
 * command-specific error messages.
 */
export type BranchSwitchKind = "checkout-switch" | "symbolic-ref";

/**
 * Returns true if a single (already whitespace-normalised) command line
 * is a git branch-switching invocation.
 *
 * Blocked:
 *   git checkout <branch>
 *   git checkout -b/-B <new>   (create + switch)
 *   git switch <anything>
 *   git symbolic-ref <anything>  (plumbing bypass — rewrites .git/HEAD directly)
 *
 * Allowed (no branch change):
 *   git checkout -- <path>     (file restore)
 *   git checkout -p            (interactive patch)
 *   git restore …
 */
export function isBranchSwitchLine(line: string): boolean {
  return branchSwitchKind(line) !== null;
}

/**
 * Returns the kind of blocked branch-switch, or null if the line is allowed.
 */
export function branchSwitchKind(line: string): BranchSwitchKind | null {
  // git must be the actual command being invoked, not just a word that
  // appears somewhere in the line (e.g. inside an echo or comment).
  // Allow an optional leading "sudo [-flags]" prefix.
  if (!/^\s*(?:sudo\s+(?:-[a-zA-Z]\S*\s+)*)?git\s/.test(line)) return null;

  if (/\bgit\s+checkout\b/.test(line)) {
    if (/\bgit\s+checkout\s+--\s/.test(line)) return null; // file-restore
    if (/\bgit\s+checkout\s+-p\b/.test(line)) return null; // patch mode
    return "checkout-switch";
  }
  if (/\bgit\s+switch\b/.test(line)) return "checkout-switch";
  // Block all symbolic-ref invocations — this plumbing command rewrites
  // .git/HEAD directly and is a complete bypass of the branch guard.
  if (/\bgit\s+symbolic-ref\b/.test(line)) return "symbolic-ref";
  return null;
}

/**
 * Scans text for a blocked line and returns both the line and its kind,
 * or null if clean.
 */
export function findBranchSwitchWithKind(
  text: string
): { line: string; kind: BranchSwitchKind } | null {
  for (const rawLine of text.split("\n")) {
    for (const raw of rawLine.split(/&&|\|\||;/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (line.startsWith("#")) continue;
      const kind = branchSwitchKind(line);
      if (kind !== null) return { line, kind };
    }
  }
  return null;
}

/**
 * Scans an arbitrary block of text (inline bash command or script file
 * content) for branch-switching git invocations.
 *
 * Handles both multi-line scripts and single-line compound commands joined
 * by &&, ||, or ;.  Skips comment lines.  Returns the first offending
 * segment, or null if clean.
 */
export function findBranchSwitchInText(text: string): string | null {
  return findBranchSwitchWithKind(text)?.line ?? null;
}

// ---------------------------------------------------------------------------
// .git/ internal path detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the given file path is inside a .git directory.
 *
 * Catches all of:
 *   .git/HEAD                              (relative)
 *   .git/config                            (config file)
 *   .git/hooks/pre-commit                  (hook scripts)
 *   .git/refs/heads/main                   (ref files)
 *   /absolute/path/.git/COMMIT_EDITMSG     (absolute)
 *   ../../other-repo/.git/config           (traversal)
 *   .git/worktrees/<name>/HEAD             (worktree internals)
 *
 * Does NOT match:
 *   .gitignore  .gitconfig  .github/…      (.git not a directory component)
 *   my.git/config                          (my.git is not a bare .git component)
 */
export function isGitInternalPath(filePath: string): boolean {
  // Normalise backslashes and collapse repeated separators.
  const p = filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  // Must have .git as a proper path component (preceded by / or start of string)
  // followed by another / — meaning something is *inside* .git, not just .git itself.
  return /(?:^|\/)\.git\//.test(p);
}

// ---------------------------------------------------------------------------
// Shell-script detection
// ---------------------------------------------------------------------------

export const SHELL_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".ksh",
  ".dash",
]);

// Matches shebangs like:
//   #!/bin/bash   #!/usr/bin/bash   #!/usr/bin/env bash   #!bash
export const SHELL_SHEBANG_RE =
  /^#!\s*(?:\/usr\/bin\/env\s+|\/\S+\/)?(?:bash|sh|zsh|ksh|dash)\b/;

/** Returns true if the file path or content looks like a shell script. */
export function isShellScript(filePath: string, content: string): boolean {
  const ext = filePath.match(/(\.[^./\\]+)$/)?.[1]?.toLowerCase() ?? "";
  if (SHELL_EXTENSIONS.has(ext)) return true;
  const firstLine = content.split("\n")[0] ?? "";
  return SHELL_SHEBANG_RE.test(firstLine);
}

// ---------------------------------------------------------------------------
// Script path extraction from bash commands
// ---------------------------------------------------------------------------

/**
 * Extracts shell-script file paths that a bash command is about to execute.
 *
 * Handles:
 *   bash [-flags] script.sh      sh / zsh / ksh / dash too
 *   source file                  . file
 *   ./script.sh   /abs/script
 *
 * Does NOT extract from `bash -c '...'` — that inline text is already
 * scanned by findBranchSwitchInText on the raw command string.
 */
export function extractScriptPaths(command: string): string[] {
  const paths: string[] = [];

  // Split compound commands on ; && || | to examine each segment
  const segments = command.split(/[;&|]+/);

  for (const seg of segments) {
    const s = seg.trim();

    // Skip "bash -c '...'" — inline text already handled elsewhere
    if (/^\s*(?:bash|sh|zsh|ksh|dash)\b.*\s-c\s/.test(s)) continue;

    // bash/sh/zsh/ksh/dash  [flags…]  <script>
    const shellExecMatch = s.match(
      /^\s*(?:bash|sh|zsh|ksh|dash)\s+((?:-[a-zA-Z]+\s+)*)(\S+)/
    );
    if (shellExecMatch) {
      const candidate = shellExecMatch[2];
      if (!candidate.startsWith("-")) {
        paths.push(candidate);
        continue;
      }
    }

    // source <file>  or  . <file>
    const sourceMatch = s.match(/^\s*(?:source|\.)\s+(\S+)/);
    if (sourceMatch) {
      paths.push(sourceMatch[1]);
      continue;
    }

    // Direct execution:  ./script  /absolute/path
    const directMatch = s.match(/^\s*(\.\/\S+|\/\S+)/);
    if (directMatch) {
      paths.push(directMatch[1]);
    }
  }

  return paths;
}

/**
 * Reads a script file (resolved relative to cwd) and returns the first
 * branch-switching line found inside it, or null if the file is clean /
 * unreadable.
 */
export function findBranchSwitchInScript(
  scriptPath: string,
  cwd: string
): string | null {
  return findBranchSwitchInScriptWithKind(scriptPath, cwd)?.line ?? null;
}

/**
 * Like findBranchSwitchInScript but also returns the kind of the blocked line.
 */
export function findBranchSwitchInScriptWithKind(
  scriptPath: string,
  cwd: string
): { line: string; kind: BranchSwitchKind } | null {
  try {
    const abs = resolve(cwd, scriptPath);
    const content = readFileSync(abs, "utf8");
    return findBranchSwitchWithKind(content);
  } catch {
    return null; // Unreadable → not our problem
  }
}

// ---------------------------------------------------------------------------
// Git commit detection
// ---------------------------------------------------------------------------

/**
 * Returns true if a single (already whitespace-normalised) command line
 * is a `git commit` invocation (any flags / options).
 *
 * Examples that match:
 *   git commit
 *   git commit -m "message"
 *   git commit --amend
 *   git commit --amend --no-edit
 *   sudo git commit -a
 */
export function isGitCommitLine(line: string): boolean {
  if (!/^\s*(?:sudo\s+(?:-[a-zA-Z]\S*\s+)*)?git\s/.test(line)) return false;
  return /\bgit\s+commit\b/.test(line);
}

/**
 * Scans an arbitrary block of text (inline bash command or script file
 * content) for `git commit` invocations.
 *
 * Handles both multi-line scripts and single-line compound commands joined
 * by &&, ||, or ;.  Skips comment lines.  Returns the first offending
 * segment, or null if clean.
 */
export function findGitCommitInText(text: string): string | null {
  for (const rawLine of text.split("\n")) {
    for (const raw of rawLine.split(/&&|\|\||;/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (line.startsWith("#")) continue; // ignore comments
      if (isGitCommitLine(line)) return line;
    }
  }
  return null;
}

/**
 * Reads a script file (resolved relative to cwd) and returns the first
 * `git commit` line found inside it, or null if the file is clean /
 * unreadable.
 */
export function findGitCommitInScript(
  scriptPath: string,
  cwd: string
): string | null {
  try {
    const abs = resolve(cwd, scriptPath);
    const content = readFileSync(abs, "utf8");
    return findGitCommitInText(content);
  } catch {
    return null; // Unreadable → not our problem
  }
}
