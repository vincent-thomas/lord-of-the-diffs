/**
 * commit-enforcer/logic.test.ts — tests for git-state checking and message building.
 */
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { buildNagMessage, hasUnpushedCommits, checkGitState } from "./logic.ts";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Git repo helpers — a local clone tracking a bare "remote" so upstream
// state (needed by hasUnpushedCommits) is exercised for real.
// ---------------------------------------------------------------------------

function git(cmd: string, cwd: string): string {
	return execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
}

function withGitRepos(
	fn: (local: string, remote: string) => void | Promise<void>,
): () => Promise<void> {
	return async () => {
		const base = mkdtempSync(join(tmpdir(), "commit-enforcer-test-"));
		const remotePath = join(base, "remote.git");
		const localPath = join(base, "local");
		try {
			execSync(`git init --bare ${remotePath}`, { stdio: "pipe" });
			execSync(`git clone ${remotePath} ${localPath}`, { stdio: "pipe" });
			git("git config user.email test@test.com", localPath);
			git("git config user.name test", localPath);
			writeFileSync(join(localPath, "init.txt"), "init");
			git("git add .", localPath);
			git("git commit -m init", localPath);
			git("git push", localPath);
			await fn(localPath, remotePath);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	};
}

// ---------------------------------------------------------------------------
// hasUnpushedCommits
// ---------------------------------------------------------------------------

suite("hasUnpushedCommits", () => {
	test(
		"up to date with upstream → false",
		withGitRepos(async (local) => {
			assert.equal(await hasUnpushedCommits(local), false);
		}),
	);

	test(
		"committed but not pushed → true",
		withGitRepos(async (local) => {
			writeFileSync(join(local, "new.txt"), "new");
			git("git add .", local);
			git("git commit -m 'new file'", local);
			assert.equal(await hasUnpushedCommits(local), true);
		}),
	);

	test(
		"pushed after committing → false again",
		withGitRepos(async (local) => {
			writeFileSync(join(local, "new.txt"), "new");
			git("git add .", local);
			git("git commit -m 'new file'", local);
			git("git push", local);
			assert.equal(await hasUnpushedCommits(local), false);
		}),
	);

	test(
		"no upstream configured → fails closed (false)",
		withGitRepos(async (local) => {
			git("git checkout -b feature/no-upstream", local);
			writeFileSync(join(local, "branch.txt"), "branch");
			git("git add .", local);
			git("git commit -m 'branch commit'", local);
			assert.equal(await hasUnpushedCommits(local), false);
		}),
	);

	test("not a git repo → false (fails closed)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "commit-enforcer-nonrepo-"));
		try {
			assert.equal(await hasUnpushedCommits(dir), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// checkGitState
// ---------------------------------------------------------------------------

suite("checkGitState", () => {
	test(
		"clean and pushed → both false",
		withGitRepos(async (local) => {
			assert.deepEqual(await checkGitState(local), { dirty: false, unpushed: false });
		}),
	);

	test(
		"dirty and unpushed at once",
		withGitRepos(async (local) => {
			writeFileSync(join(local, "committed.txt"), "x");
			git("git add .", local);
			git("git commit -m 'unpushed commit'", local);
			writeFileSync(join(local, "dirty.txt"), "y");
			assert.deepEqual(await checkGitState(local), { dirty: true, unpushed: true });
		}),
	);
});

suite("buildNagMessage");

test("dirty-only: suggests commit, not push", () => {
	const msg = buildNagMessage(true, false);
	assert.ok(msg.includes("uncommitted changes in the working tree"));
	assert.ok(msg.includes("git_commit"));
	assert.ok(msg.includes("yield_with_uncommitted_changes"));
	assert.ok(!msg.includes("push_and_check_ci"));
	assert.ok(!msg.includes("unpushed commits"));
});

test("unpushed-only: suggests push, not commit", () => {
	const msg = buildNagMessage(false, true);
	assert.ok(msg.includes("committed but unpushed commits"));
	assert.ok(msg.includes("push_and_check_ci"));
	assert.ok(msg.includes("yield_with_uncommitted_changes"));
	assert.ok(!msg.includes("git_commit"));
	assert.ok(!msg.includes("uncommitted changes"));
});

test("both dirty and unpushed: suggests commit then push", () => {
	const msg = buildNagMessage(true, true);
	assert.ok(msg.includes("uncommitted changes in the working tree"));
	assert.ok(msg.includes("committed but unpushed commits"));
	assert.ok(msg.includes("git_commit"));
	assert.ok(msg.includes("Then push using `push_and_check_ci`"));
	assert.ok(msg.includes("yield_with_uncommitted_changes"));
});
