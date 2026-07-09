/**
 * git-utils.test.ts — tests for shared git-state helpers.
 *
 * Run with:   node --test git-utils.test.ts
 */
import assert from "node:assert/strict";
import { test, suite } from "node:test";
import { isWorktreeDirty, currentBranch, hasUpstream, isDefaultBranch } from "./git-utils.ts";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function git(cmd: string, cwd: string): string {
	return execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
}

function withGitRepo(
	fn: (repoPath: string) => void | Promise<void>,
): () => Promise<void> {
	return async () => {
		const dir = mkdtempSync(join(tmpdir(), "git-utils-test-"));
		try {
			git("git init", dir);
			git("git config user.email test@test.com", dir);
			git("git config user.name test", dir);
			writeFileSync(join(dir, "init.txt"), "init");
			git("git add .", dir);
			git("git commit -m init", dir);
			await fn(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};
}

function withGitRepos(
	fn: (local: string, remote: string) => void | Promise<void>,
): () => Promise<void> {
	return async () => {
		const base = mkdtempSync(join(tmpdir(), "git-utils-remote-test-"));
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
// isWorktreeDirty
// ---------------------------------------------------------------------------

suite("isWorktreeDirty", () => {
	test(
		"clean repo → false",
		withGitRepo(async (dir) => {
			assert.equal(await isWorktreeDirty(dir), false);
		}),
	);

	test(
		"untracked file → true",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "untracked.txt"), "x");
			assert.equal(await isWorktreeDirty(dir), true);
		}),
	);

	test(
		"unstaged modification → true",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "init.txt"), "modified");
			assert.equal(await isWorktreeDirty(dir), true);
		}),
	);

	test(
		"staged but uncommitted change → true",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "new.txt"), "new");
			git("git add new.txt", dir);
			assert.equal(await isWorktreeDirty(dir), true);
		}),
	);

	test("not a git repo → true (fails open)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "git-utils-nonrepo-"));
		try {
			assert.equal(await isWorktreeDirty(dir), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// currentBranch
// ---------------------------------------------------------------------------

suite("currentBranch", () => {
	test(
		"returns the checked-out branch name",
		withGitRepo(async (dir) => {
			const branch = git("git branch --show-current", dir);
			assert.equal(await currentBranch(dir), branch);
		}),
	);

	test(
		"detached HEAD → null",
		withGitRepo(async (dir) => {
			const sha = git("git rev-parse HEAD", dir);
			git(`git checkout ${sha}`, dir);
			assert.equal(await currentBranch(dir), null);
		}),
	);

	test("not a git repo → null", async () => {
		const dir = mkdtempSync(join(tmpdir(), "git-utils-nonrepo-"));
		try {
			assert.equal(await currentBranch(dir), null);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// hasUpstream
// ---------------------------------------------------------------------------

suite("hasUpstream", () => {
	test(
		"branch with no upstream configured → false",
		withGitRepo(async (dir) => {
			assert.equal(await hasUpstream(dir), false);
		}),
	);

	test(
		"branch tracking a remote → true",
		withGitRepos(async (local) => {
			assert.equal(await hasUpstream(local), true);
		}),
	);

	test(
		"new local branch with no push yet → false",
		withGitRepos(async (local) => {
			git("git checkout -b feature/new", local);
			assert.equal(await hasUpstream(local), false);
		}),
	);
});

// ---------------------------------------------------------------------------
// isDefaultBranch
// ---------------------------------------------------------------------------

suite("isDefaultBranch", () => {
	test("main", () => assert.equal(isDefaultBranch("main"), true));
	test("master", () => assert.equal(isDefaultBranch("master"), true));
	test("develop", () => assert.equal(isDefaultBranch("develop"), false));
	test("feature/foo", () => assert.equal(isDefaultBranch("feature/foo"), false));
});
