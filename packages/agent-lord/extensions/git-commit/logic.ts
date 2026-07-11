/**
 * logic.ts — helpers for git-commit extension.
 *
 * Uses shared helpers from lib for pre-checks, async exec, and git utilities.
 */
import { execAsync, execSucceeds, extractErrorOutput, tryExec } from "../../lib/exec-async.ts";
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
	// ls-remote returns empty output if the branch doesn't exist; tryExec maps
	// both that and an outright failure to null, so a non-null result means the
	// branch is present on the remote.
	const stdout = await tryExec(
		`git ls-remote --heads origin ${shellQuote(branch)}`,
		{ cwd, timeout: 10_000, signal },
	);
	return stdout !== null;
}

// ---------------------------------------------------------------------------
// Blocked-path checking
// ---------------------------------------------------------------------------

/** Strip a leading "./" and any trailing "/" so paths and patterns compare cleanly. */
function normalizeForMatch(p: string): string {
	return p.replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * True when `modifiedPath` is covered by `pattern`. A pattern blocks a path
 * when the path is exactly the pattern (a specific file, e.g. "Makefile") or
 * lives underneath it (the pattern names a directory, e.g. ".github/workflows").
 * Both are treated as repo-root-relative. Matching is on whole path segments, so
 * "Makefile" does not match "Makefile.bak" and "pkg/a" does not match "pkg/ab".
 */
export function pathMatchesBlocked(modifiedPath: string, pattern: string): boolean {
	const path = normalizeForMatch(modifiedPath);
	const pat = normalizeForMatch(pattern);
	if (!pat || !path) return false;
	return path === pat || path.startsWith(`${pat}/`);
}

/**
 * Return every path in `modifiedPaths` blocked by at least one entry in
 * `blockedPaths`. An empty `blockedPaths` blocks nothing.
 */
export function findBlockedPaths(modifiedPaths: string[], blockedPaths: string[]): string[] {
	if (blockedPaths.length === 0) return [];
	return modifiedPaths.filter((p) => blockedPaths.some((b) => pathMatchesBlocked(p, b)));
}

/**
 * List the repo-root-relative paths a commit would include, so they can be
 * screened against a blocklist before committing.
 *
 * With `addAll` the set mirrors `git add -A` + commit — already-staged changes,
 * plus unstaged modifications/deletions, plus untracked files — computed
 * without actually staging anything. Without it, only what is already staged.
 * Rename detection is disabled (`--no-renames`) so both the old and new path of
 * a rename are reported; blocking either should block the commit.
 */
export async function getModifiedPaths(
	cwd: string,
	addAll: boolean,
	signal?: AbortSignal,
): Promise<string[]> {
	const paths = new Set<string>();
	const collect = (out: string | null) => {
		if (!out) return;
		for (const line of out.split("\n")) {
			const trimmed = line.trim();
			if (trimmed) paths.add(trimmed);
		}
	};

	collect(await tryExec("git diff --cached --name-only --no-renames", { cwd, timeout: 10_000, signal }));
	if (addAll) {
		collect(await tryExec("git diff --name-only --no-renames", { cwd, timeout: 10_000, signal }));
		collect(await tryExec("git ls-files --others --exclude-standard", { cwd, timeout: 10_000, signal }));
	}

	return [...paths];
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
	return !(await execSucceeds("git diff --cached --quiet", { cwd, timeout: 5_000, signal }));
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


