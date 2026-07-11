/**
 * commit-enforcer/logic.ts — pure git-state checking.
 *
 * No pi imports — testable logic only.
 */
import { tryExec } from "../../lib/exec-async.ts";
import { currentBranch, hasUpstream, isWorktreeDirty } from "../../lib/git-utils.ts";

export interface GitState {
	dirty: boolean;
	unpushed: boolean;
}

/**
 * Check whether the current branch has commits that haven't been pushed.
 * Requires an upstream to be set. Returns false if not a git repo or
 * no upstream is configured.
 *
 * Not the same check as fix-ci/logic.ts's `needsPush`, which compares
 * against the remote via `git ls-remote` and fails open — this one is a
 * soft nag before yielding, so it fails closed instead.
 */
export async function hasUnpushedCommits(
	cwd: string,
	signal?: AbortSignal,
): Promise<boolean> {
	const branch = await currentBranch(cwd, signal);
	if (!branch) return false;

	const upstream = await hasUpstream(cwd, signal);
	if (!upstream) return false;

	// tryExec swallows a missing @{u} or any other git failure to null, matching
	// this check's fail-closed contract (no answer → assume nothing to push).
	const log = await tryExec("git log @{u}..HEAD --oneline", { cwd, timeout: 5_000, signal });
	return log !== null;
}

/**
 * Convenience: check both dirty worktree and unpushed commits.
 */
export async function checkGitState(
	cwd: string,
	signal?: AbortSignal,
): Promise<GitState> {
	const [dirty, unpushed] = await Promise.all([
		isWorktreeDirty(cwd, signal),
		hasUnpushedCommits(cwd, signal),
	]);
	return { dirty, unpushed };
}

/**
 * Build the nag message the agent sees when enforcement triggers.
 * Only suggests options that are relevant to the current state.
 */
export function buildNagMessage(
	dirty: boolean,
	unpushed: boolean,
): string {
	const issues: string[] = [];
	if (dirty) issues.push("uncommitted changes in the working tree");
	if (unpushed) issues.push("committed but unpushed commits");

	const steps: string[] = [];
	if (dirty) steps.push("✅ Commit the changes using `git_commit` (or discard with `git checkout -- .`)");
	if (dirty && unpushed) steps.push("✅ Then push using `push_and_check_ci`");
	else if (unpushed) steps.push("✅ Push committed changes using `push_and_check_ci`");
	steps.push("🏳️ Yield back anyway by calling `yield_with_uncommitted_changes` with a reason");

	const header = `## ⚠️ Pending Git Changes\n\nYou have ${issues.join(" and ")}. Before yielding back, resolve them:\n\n`;
	const body = steps.map((step, i) => `${i + 1}. ${step}\n`).join("");
	return `${header}${body}\n`;
}