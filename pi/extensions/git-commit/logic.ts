/**
 * logic.ts — helpers for git-commit extension.
 *
 * Uses shared helpers from lib for pre-checks, async exec, and git utilities.
 */
import { execAsync, extractErrorOutput } from "../../lib/exec-async.ts";
import { runPreChecks } from "../../lib/precheck.ts";
import { isDefaultBranch, hasUpstream as hasUpstreamBranch } from "../../lib/git-utils.ts";
import { shellQuote } from "../../lib/shell-quote.ts";

// Re-exports from lib so consumers (index.ts, tests) keep the same import path.
export { runPreChecks } from "../../lib/precheck.ts";
export { isDefaultBranch, hasUpstream as hasUpstreamBranch } from "../../lib/git-utils.ts";

// ---------------------------------------------------------------------------
// Branch checks
// ---------------------------------------------------------------------------

/**
 * Check if the current branch exists on the remote.
 * Returns true if branch exists on remote, false otherwise.
 */
export async function branchExistsOnRemote(
	cwd: string,
	branch: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const { stdout } = await execAsync(
			`git ls-remote --heads origin ${branch}`,
			{ cwd, timeout: 10_000, signal },
		);
		// ls-remote returns empty if branch doesn't exist
		return stdout.trim().length > 0;
	} catch {
		// If git fails, assume branch doesn't exist
		return false;
	}
}

// ---------------------------------------------------------------------------
// Git commit
// ---------------------------------------------------------------------------

export interface CommitResult {
	success: boolean;
	output: string;
}

/**
 * True if there are staged changes ready to commit.
 * `git diff --cached --quiet` exits 0 when nothing is staged and non-zero
 * when something is — flipped here so callers get a normally-named boolean
 * instead of having to remember which exit code means what.
 */
async function hasStagedChanges(cwd: string, signal?: AbortSignal): Promise<boolean> {
	try {
		await execAsync("git diff --cached --quiet", { cwd, timeout: 5_000, signal });
		return false;
	} catch {
		return true;
	}
}

/**
 * Commit the currently-staged changes with the given message.
 * Does NOT stage anything itself — the caller is responsible for staging
 * (e.g. with `git add`) beforehand.
 * Async to avoid blocking the event loop.
 */
export async function gitCommit(
	cwd: string,
	message: string,
	signal?: AbortSignal,
): Promise<CommitResult> {
	if (!(await hasStagedChanges(cwd, signal))) {
		return {
			success: false,
			output: "Nothing to commit — no staged changes. " +
				"Use `add_all: true` to auto-stage, or `git add` individual files.",
		};
	}

	// Commit.
	try {
		const { stdout, stderr } = await execAsync(
			`git commit -m ${shellQuote(message)}`,
			{ cwd, timeout: 30_000, signal },
		);
		return { success: true, output: (stdout + stderr).trim() };
	} catch (err: unknown) {
		return { success: false, output: extractErrorOutput(err) };
	}
}


