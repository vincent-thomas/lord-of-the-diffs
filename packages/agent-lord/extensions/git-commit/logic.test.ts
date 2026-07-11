/**
 * logic.test.ts — tests for git-commit helpers.
 *
 * Run with:   node --test logic.test.ts
 */
import assert from "node:assert/strict";
import { test, suite } from "node:test";
import {
	isDefaultBranch,
	gitCommit,
	branchExistsOnRemote,
	pathMatchesBlocked,
	findBlockedPaths,
	getModifiedPaths,
	DEFAULT_BLOCKED_PATHS,
} from "./logic.ts";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Git repo helpers
// ---------------------------------------------------------------------------

function git(cmd: string, cwd: string): string {
	return execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
}

function withGitRepo(
	fn: (repoPath: string) => void | Promise<void>,
): () => Promise<void> {
	return async () => {
		const dir = mkdtempSync(join(tmpdir(), "commit-test-"));
		try {
			git("git init", dir);
			git("git config user.email test@test.com", dir);
			git("git config user.name test", dir);
			// Initial commit so HEAD exists.
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
		const base = mkdtempSync(join(tmpdir(), "commit-remote-test-"));
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
// isDefaultBranch
// ---------------------------------------------------------------------------

suite("isDefaultBranch", () => {
	test("main", () => assert.equal(isDefaultBranch("main"), true));
	test("master", () => assert.equal(isDefaultBranch("master"), true));
	test("develop", () => assert.equal(isDefaultBranch("develop"), false));
	test("feature/foo", () => assert.equal(isDefaultBranch("feature/foo"), false));
	test("main-v2", () => assert.equal(isDefaultBranch("main-v2"), false));
	test("my-master", () => assert.equal(isDefaultBranch("my-master"), false));
});

// ---------------------------------------------------------------------------
// branchExistsOnRemote
// ---------------------------------------------------------------------------

suite("branchExistsOnRemote", () => {
	test(
		"current branch already on remote → true",
		withGitRepos(async (local) => {
			const branch = git("git branch --show-current", local);
			assert.equal(await branchExistsOnRemote(local, branch), true);
		}),
	);

	test(
		"local-only branch not yet pushed → false",
		withGitRepos(async (local) => {
			git("git checkout -b feature/unpushed", local);
			assert.equal(await branchExistsOnRemote(local, "feature/unpushed"), false);
		}),
	);

	test(
		"branch name that doesn't exist anywhere → false",
		withGitRepos(async (local) => {
			assert.equal(await branchExistsOnRemote(local, "no-such-branch"), false);
		}),
	);

	test("git failure (no remote configured) → false", async () => {
		const dir = mkdtempSync(join(tmpdir(), "commit-norepo-"));
		try {
			assert.equal(await branchExistsOnRemote(dir, "main"), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// gitCommit
// ---------------------------------------------------------------------------

suite("gitCommit", () => {
	test(
		"commits staged changes",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "file.txt"), "hello");
			git("git add file.txt", dir);
			const result = await gitCommit(dir, "add file");
			assert.equal(result.success, true);
			const log = git("git log --oneline -1", dir);
			assert.ok(log.includes("add file"));
		}),
	);

	test(
		"fails when nothing is staged",
		withGitRepo(async (dir) => {
			const result = await gitCommit(dir, "empty commit");
			assert.equal(result.success, false);
			assert.ok(result.output.includes("Nothing to commit"));
		}),
	);

	test(
		"does NOT stage unstaged changes (leaves them in the working tree)",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "staged.txt"), "staged");
			writeFileSync(join(dir, "unstaged.txt"), "unstaged");
			git("git add staged.txt", dir);
			const result = await gitCommit(dir, "only staged");
			assert.equal(result.success, true);
			// unstaged.txt must remain untracked, not swept into the commit.
			const status = git("git status --porcelain", dir);
			assert.ok(status.includes("?? unstaged.txt"));
			const files = git("git show --name-only --oneline HEAD", dir);
			assert.ok(files.includes("staged.txt"));
			assert.ok(!files.includes("unstaged.txt"));
		}),
	);

	test(
		"handles message with single quotes",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "file.txt"), "content");
			git("git add file.txt", dir);
			const result = await gitCommit(dir, "it's a test");
			assert.equal(result.success, true);
			const log = git("git log --oneline -1", dir);
			assert.ok(log.includes("it's a test"));
		}),
	);

	test(
		"commits staged modifications",
		withGitRepo(async (dir) => {
			// init.txt already exists from withGitRepo
			writeFileSync(join(dir, "init.txt"), "modified");
			git("git add init.txt", dir);
			const result = await gitCommit(dir, "modify init");
			assert.equal(result.success, true);
			const log = git("git log --oneline -1", dir);
			assert.ok(log.includes("modify init"));
		}),
	);

	test(
		"commits staged deletions",
		withGitRepo(async (dir) => {
			rmSync(join(dir, "init.txt"));
			git("git add -A", dir);
			const result = await gitCommit(dir, "delete init");
			assert.equal(result.success, true);
			const log = git("git log --oneline -1", dir);
			assert.ok(log.includes("delete init"));
		}),
	);
});

// ---------------------------------------------------------------------------
// pathMatchesBlocked
// ---------------------------------------------------------------------------

suite("pathMatchesBlocked", () => {
	test("exact file path matches", () => assert.equal(pathMatchesBlocked("Makefile", "Makefile"), true));
	test("unrelated file does not match", () => assert.equal(pathMatchesBlocked("src/app.ts", "Makefile"), false));
	test("file under a blocked directory matches", () =>
		assert.equal(pathMatchesBlocked("packages/agent-lord/x.ts", "packages/agent-lord"), true));
	test("nested file under a blocked directory matches", () =>
		assert.equal(pathMatchesBlocked(".github/workflows/ci.yml", ".github/workflows"), true));
	test("trailing slash on a directory pattern is tolerated", () =>
		assert.equal(pathMatchesBlocked("a/b.txt", "a/"), true));
	test("leading ./ on the path is ignored", () =>
		assert.equal(pathMatchesBlocked("./Makefile", "Makefile"), true));
	test("leading ./ on the pattern is ignored", () =>
		assert.equal(pathMatchesBlocked("Makefile", "./Makefile"), true));
	test("partial segment does not match (Makefile vs Makefile.bak)", () =>
		assert.equal(pathMatchesBlocked("Makefile.bak", "Makefile"), false));
	test("a prefix that is not a path boundary does not match", () =>
		assert.equal(pathMatchesBlocked("packages/agent-lord2/x", "packages/agent-lord"), false));
	test("empty pattern matches nothing", () => assert.equal(pathMatchesBlocked("Makefile", ""), false));
});

// ---------------------------------------------------------------------------
// findBlockedPaths
// ---------------------------------------------------------------------------

suite("findBlockedPaths", () => {
	test("empty blocklist blocks nothing", () =>
		assert.deepEqual(findBlockedPaths(["Makefile", "a.ts"], []), []));
	test("returns only the paths that match", () =>
		assert.deepEqual(
			findBlockedPaths(["a.ts", "Makefile", ".npmrc"], ["Makefile", ".npmrc"]),
			["Makefile", ".npmrc"],
		));
	test("no matches yields empty", () =>
		assert.deepEqual(findBlockedPaths(["a.ts", "b.ts"], ["Makefile"]), []));
	test("a directory pattern catches every file beneath it", () =>
		assert.deepEqual(
			findBlockedPaths(["src/a.ts", "src/b.ts", "x.ts"], ["src"]),
			["src/a.ts", "src/b.ts"],
		));
});

// ---------------------------------------------------------------------------
// getModifiedPaths
// ---------------------------------------------------------------------------

suite("getModifiedPaths", () => {
	test(
		"add_all=false reports only staged paths",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "staged.txt"), "s");
			git("git add staged.txt", dir);
			writeFileSync(join(dir, "untracked.txt"), "u");
			writeFileSync(join(dir, "init.txt"), "changed"); // tracked, left unstaged
			const paths = await getModifiedPaths(dir, false);
			assert.deepEqual(paths.sort(), ["staged.txt"]);
		}),
	);

	test(
		"add_all=true reports staged, unstaged, and untracked paths",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "staged.txt"), "s");
			git("git add staged.txt", dir);
			writeFileSync(join(dir, "untracked.txt"), "u");
			writeFileSync(join(dir, "init.txt"), "changed");
			const paths = await getModifiedPaths(dir, true);
			assert.deepEqual(paths.sort(), ["init.txt", "staged.txt", "untracked.txt"]);
		}),
	);

	test(
		"an unstaged deletion is reported only under add_all=true",
		withGitRepo(async (dir) => {
			rmSync(join(dir, "init.txt"));
			assert.deepEqual(await getModifiedPaths(dir, false), []);
			assert.ok((await getModifiedPaths(dir, true)).includes("init.txt"));
		}),
	);
});

// ---------------------------------------------------------------------------
// DEFAULT_BLOCKED_PATHS
// ---------------------------------------------------------------------------

suite("DEFAULT_BLOCKED_PATHS", () => {
	test("always includes .npmrc and Makefile", () => {
		assert.ok(DEFAULT_BLOCKED_PATHS.includes(".npmrc"));
		assert.ok(DEFAULT_BLOCKED_PATHS.includes("Makefile"));
	});
	test("catches a Makefile change through findBlockedPaths", () =>
		assert.deepEqual(findBlockedPaths(["src/a.ts", "Makefile"], DEFAULT_BLOCKED_PATHS), ["Makefile"]));
	test("catches a .npmrc change through findBlockedPaths", () =>
		assert.deepEqual(findBlockedPaths(["a.ts", ".npmrc"], DEFAULT_BLOCKED_PATHS), [".npmrc"]));
});
