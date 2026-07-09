/**
 * git-utils.ts — shared helpers for extensions that intercept git commands.
 *
 * No pi imports — importable from any extension's logic module.
 */
import { execSync } from "node:child_process";
import { execAsync } from "./exec-async.ts";

// ---------------------------------------------------------------------------
// Working tree checks
// ---------------------------------------------------------------------------

/**
 * Check whether the working tree has uncommitted changes (unstaged or
 * untracked). Returns true if dirty, false if clean. When git fails (e.g.
 * not in a repo), errs on the side of caution and returns true.
 */
export async function isWorktreeDirty(
	cwd: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const { stdout } = await execAsync("git status --porcelain", {
			cwd,
			timeout: 10_000,
			signal,
		});
		return stdout.trim().length > 0;
	} catch {
		// If git fails, err on the side of caution — assume dirty.
		return true;
	}
}

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

/** Returns the current branch name, or null if not in a git repo. */
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
// Branch metadata
// ---------------------------------------------------------------------------

const DEFAULT_BRANCHES = new Set(["main", "master"]);

/** Returns true if `branch` is a default branch (main/master). */
export function isDefaultBranch(branch: string): boolean {
	return DEFAULT_BRANCHES.has(branch);
}

/**
 * Returns true if the current branch has an upstream tracking branch set.
 * Async — uses execAsync under the hood.
 */
export async function hasUpstream(cwd: string, signal?: AbortSignal): Promise<boolean> {
	try {
		await execAsync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
			cwd,
			timeout: 5_000,
			signal,
		});
		return true;
	} catch {
		// Non-zero exit means no upstream is configured for this branch.
		return false;
	}
}
