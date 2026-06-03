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
  findBranchSwitchInText,
  findBranchSwitchInScript,
  findGitCommitInText,
  findGitCommitInScript,
  extractScriptPaths,
  isShellScript,
  SHELL_EXTENSIONS,
} from "./logic.ts";

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
    if (!guardedBranch) return; // Not in a git repo, nothing to protect.

    // ── bash ─────────────────────────────────────────────────────────────────
    if (isToolCallEventType("bash", event)) {
      const cmd = event.input.command ?? "";

      // 2a. Inline command contains a branch switch
      const inlineBad = findBranchSwitchInText(cmd);
      if (inlineBad) {
        ctx.ui.notify(
          `git-branch-guard: blocked branch-switch in command:\n  ${inlineBad.slice(0, 120)}`,
          "error"
        );
        return {
          block: true,
          reason:
            `git-branch-guard: Switching branches is not allowed in this session. ` +
            `You are locked to branch "${guardedBranch}". ` +
            `Offending line: ${inlineBad}`,
        };
      }

      // 2b. Command is executing a script file — read and scan it
      for (const scriptPath of extractScriptPaths(cmd)) {
        const scriptBad = findBranchSwitchInScript(scriptPath, ctx.cwd);
        if (scriptBad) {
          ctx.ui.notify(
            `git-branch-guard: blocked execution of "${scriptPath}" — ` +
              `it contains a branch-switch:\n  ${scriptBad.slice(0, 120)}`,
            "error"
          );
          return {
            block: true,
            reason:
              `git-branch-guard: The script "${scriptPath}" contains a branch-switching ` +
              `git command ("${scriptBad}"). Executing it is not allowed while locked ` +
              `to branch "${guardedBranch}". Remove the offending line before running the script.`,
          };
        }

        // 2c. Script file contains a git commit — ask for permission
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

      // 2d. Inline command contains a git commit — ask for permission
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

    // ── write ─────────────────────────────────────────────────────────────────
    if (isToolCallEventType("write", event)) {
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
        const bad = findBranchSwitchInText(content);
        if (bad) {
          ctx.ui.notify(
            `git-branch-guard: blocked write of "${path}" — ` +
              `script contains a branch-switch:\n  ${bad.slice(0, 120)}`,
            "error"
          );
          return {
            block: true,
            reason:
              `git-branch-guard: The shell script "${path}" you are trying to write ` +
              `contains a branch-switching git command ("${bad}"). ` +
              `Remove the offending line; you are locked to branch "${guardedBranch}".`,
          };
        }
      }

      return;
    }

    // ── edit ──────────────────────────────────────────────────────────────────
    if (isToolCallEventType("edit", event)) {
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
        const bad = findBranchSwitchInText(newText);
        if (bad) {
          ctx.ui.notify(
            `git-branch-guard: blocked edit of "${path}" — ` +
              `new text contains a branch-switch:\n  ${bad.slice(0, 120)}`,
            "error"
          );
          return {
            block: true,
            reason:
              `git-branch-guard: The edit to "${path}" introduces a branch-switching ` +
              `git command ("${bad}"). ` +
              `Remove the offending line; you are locked to branch "${guardedBranch}".`,
          };
        }
      }
    }
  });
}
