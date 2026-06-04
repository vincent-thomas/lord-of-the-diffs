/**
 * index.ts — pi extension entry point for git-branch-guard.
 *
 * All testable logic lives in logic.ts (no pi imports there).
 * Run tests with:   node logic.test.ts
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import {
  currentBranch,
  findBranchSwitchWithKind,
  findBranchSwitchInScriptWithKind,
  findGitCommitInText,
  findGitCommitInScript,
  extractScriptPaths,
  isShellScript,
  isGitInternalPath,
  SHELL_EXTENSIONS,
  type BranchSwitchKind,
} from "./logic.ts";

/** Human-readable label shown in the TUI notification. */
function notifyLabel(kind: BranchSwitchKind): string {
  return kind === "symbolic-ref"
    ? "blocked git symbolic-ref (plumbing bypass)"
    : "blocked branch-switch";
}

/**
 * Detailed reason returned to the model so it understands what it did wrong
 * and what the correct alternative is.
 */
function blockReason(
  kind: BranchSwitchKind,
  offendingLine: string,
  guardedBranch: string,
  source?: string // e.g. 'script "deploy.sh"' or undefined for inline
): string {
  const where = source ? `in ${source}` : "in command";
  if (kind === "symbolic-ref") {
    return (
      `git-branch-guard: "git symbolic-ref" is not allowed. ` +
      `This is a low-level plumbing command that rewrites .git/HEAD directly, ` +
      `bypassing the branch guard entirely. ` +
      `You are locked to branch "${guardedBranch}" for this session. ` +
      `Do not use git symbolic-ref, or any other method that modifies ` +
      `.git/HEAD outside of normal git checkout/switch. ` +
      `Offending line ${where}: ${offendingLine}`
    );
  }
  // checkout / switch
  return (
    `git-branch-guard: Switching branches is not allowed in this session. ` +
    `You are locked to branch "${guardedBranch}". ` +
    `Do not use "git checkout <branch>", "git checkout -b", or "git switch". ` +
    `If you need to reference another branch use git diff, git log, or git show ` +
    `without switching to it. ` +
    `Offending line ${where}: ${offendingLine}`
  );
}

export default function (pi: ExtensionAPI) {
  let guardedBranch: string | null = null;

  /**
   * Shows a yes/no confirm for a pending git commit.
   * If the user says no, follows up with an optional "why?" input.
   * Returns { allowed: true } or { allowed: false, reason?: string }.
   */
  async function askCommitPermission(
    ctx: Parameters<Parameters<typeof pi.on>[1]>[1],
    description: string
  ): Promise<{ allowed: boolean; why?: string }> {
    const ok = await ctx.ui.confirm("git commit — permission required", description);
    if (ok) return { allowed: true };
    const why = await ctx.ui.input("Why not? (optional — press Enter to skip)", "");
    return { allowed: false, why: why?.trim() || undefined };
  }

  // ── 1. Capture branch at session start ────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    guardedBranch = currentBranch(ctx.cwd);
    if (guardedBranch) {
      ctx.ui.notify(
        `git-branch-guard: locked to branch "${guardedBranch}"`,
        "info"
      );
    }
  });

  // ── 2. Intercept tool calls ───────────────────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    // ── bash ─────────────────────────────────────────────────────────────────
    if (isToolCallEventType("bash", event)) {
      const cmd = event.input.command ?? "";

      // 2a. Inline command contains a branch switch (requires a known guarded branch)
      if (guardedBranch) {
        const inlineHit = findBranchSwitchWithKind(cmd);
        if (inlineHit) {
          ctx.ui.notify(
            `git-branch-guard: ${notifyLabel(inlineHit.kind)} in command:\n  ${inlineHit.line.slice(0, 120)}`,
            "error"
          );
          return {
            block: true,
            reason: blockReason(inlineHit.kind, inlineHit.line, guardedBranch),
          };
        }

        // 2b. Command is executing a script file — scan it for branch switches
        for (const scriptPath of extractScriptPaths(cmd)) {
          const scriptHit = findBranchSwitchInScriptWithKind(scriptPath, ctx.cwd);
          if (scriptHit) {
            ctx.ui.notify(
              `git-branch-guard: blocked execution of "${scriptPath}" — ` +
                `it contains a ${notifyLabel(scriptHit.kind)}:\n  ${scriptHit.line.slice(0, 120)}`,
              "error"
            );
            return {
              block: true,
              reason: blockReason(
                scriptHit.kind,
                scriptHit.line,
                guardedBranch,
                `script "${scriptPath}"`
              ),
            };
          }
        }
      }

      // 2c. Script file contains a git commit — ask for permission (always, regardless of branch)
      for (const scriptPath of extractScriptPaths(cmd)) {
        const scriptCommit = findGitCommitInScript(scriptPath, ctx.cwd);
        if (scriptCommit) {
          const { allowed, why } = await askCommitPermission(
            ctx,
            `Allow execution of "${scriptPath}"?\n\nIt contains:\n  ${scriptCommit.slice(0, 200)}`
          );
          if (!allowed) {
            ctx.ui.notify(
              `git-commit-guard: blocked execution of "${scriptPath}" — commit denied by user`,
              "error"
            );
            return {
              block: true,
              reason:
                `git-commit-guard: Permission denied. You declined the git commit in ` +
                `"${scriptPath}" (offending line: ${scriptCommit}).` +
                (why ? ` Reason: ${why}` : ""),
            };
          }
        }
      }

      // 2d. Inline command contains a git commit — ask for permission (always, regardless of branch)
      const inlineCommit = findGitCommitInText(cmd);
      if (inlineCommit) {
        const { allowed, why } = await askCommitPermission(
          ctx,
          `Allow the following commit command?\n\n  ${inlineCommit.slice(0, 200)}`
        );
        if (!allowed) {
          ctx.ui.notify(
            `git-commit-guard: blocked commit command — denied by user`,
            "error"
          );
          return {
            block: true,
            reason:
              `git-commit-guard: Permission denied. You declined the git commit. ` +
              `Offending command: ${inlineCommit}.` +
              (why ? ` Reason: ${why}` : ""),
          };
        }
      }

      return; // Bash command is clean.
    }

    // Branch-drift checks for write/edit require knowing the guarded branch.
    if (!guardedBranch) return;

    // ── write ─────────────────────────────────────────────────────────────────
    if (isToolCallEventType("write", event)) {
      // 2b-pre. Block direct writes anywhere inside .git/
      const writePath = event.input.path ?? "";
      if (isGitInternalPath(writePath)) {
        ctx.ui.notify(
          `git-branch-guard: blocked write to "${writePath}" — .git/ is read-only`,
          "error"
        );
        return {
          block: true,
          reason:
            `git-branch-guard: Writing to "${writePath}" is not allowed. ` +
            `The .git directory is git's internal state store; manually editing any file ` +
            `inside it (HEAD, config, refs, hooks, etc.) bypasses normal git safety ` +
            `mechanisms and the branch guard. You are locked to branch "${guardedBranch}". ` +
            `Use the appropriate git commands instead of writing .git files directly.`,
        };
      }

      // 2c. Branch drift check
      const live = currentBranch(ctx.cwd);
      if (live !== null && live !== guardedBranch) {
        ctx.ui.notify(
          `git-branch-guard: blocked write — branch drifted to "${live}"`,
          "error"
        );
        return {
          block: true,
          reason:
            `git-branch-guard: Active branch is now "${live}" but session started on ` +
            `"${guardedBranch}". Writing files on a different branch is not allowed.`,
        };
      }

      // 2d. Shell-script content scan
      const path = event.input.path ?? "";
      const content = event.input.content ?? "";
      if (isShellScript(path, content)) {
        const hit = findBranchSwitchWithKind(content);
        if (hit) {
          ctx.ui.notify(
            `git-branch-guard: blocked write of "${path}" — ` +
              `script contains a ${notifyLabel(hit.kind)}:\n  ${hit.line.slice(0, 120)}`,
            "error"
          );
          return {
            block: true,
            reason: blockReason(
              hit.kind,
              hit.line,
              guardedBranch,
              `shell script "${path}" you are trying to write`
            ),
          };
        }
      }

      return;
    }

    // ── edit ──────────────────────────────────────────────────────────────────
    if (isToolCallEventType("edit", event)) {
      // 2e-pre. Block direct edits anywhere inside .git/
      const editPath = event.input.path ?? "";
      if (isGitInternalPath(editPath)) {
        ctx.ui.notify(
          `git-branch-guard: blocked edit of "${editPath}" — .git/ is read-only`,
          "error"
        );
        return {
          block: true,
          reason:
            `git-branch-guard: Editing "${editPath}" is not allowed. ` +
            `The .git directory is git's internal state store; manually editing any file ` +
            `inside it (HEAD, config, refs, hooks, etc.) bypasses normal git safety ` +
            `mechanisms and the branch guard. You are locked to branch "${guardedBranch}". ` +
            `Use the appropriate git commands instead of editing .git files directly.`,
        };
      }

      // 2e. Branch drift check
      const live = currentBranch(ctx.cwd);
      if (live !== null && live !== guardedBranch) {
        ctx.ui.notify(
          `git-branch-guard: blocked edit — branch drifted to "${live}"`,
          "error"
        );
        return {
          block: true,
          reason:
            `git-branch-guard: Active branch is now "${live}" but session started on ` +
            `"${guardedBranch}". Editing files on a different branch is not allowed.`,
        };
      }

      // 2f. Shell-script content scan on the new text being introduced
      const path = event.input.path ?? "";
      const newText = event.input.newText ?? "";
      const ext = path.match(/(\.[^./\\]+)$/)?.[1]?.toLowerCase() ?? "";
      if (isShellScript(path, newText) || SHELL_EXTENSIONS.has(ext)) {
        const hit = findBranchSwitchWithKind(newText);
        if (hit) {
          ctx.ui.notify(
            `git-branch-guard: blocked edit of "${path}" — ` +
              `new text contains a ${notifyLabel(hit.kind)}:\n  ${hit.line.slice(0, 120)}`,
            "error"
          );
          return {
            block: true,
            reason: blockReason(
              hit.kind,
              hit.line,
              guardedBranch,
              `edit to "${path}"`
            ),
          };
        }
      }
    }
  });
}
