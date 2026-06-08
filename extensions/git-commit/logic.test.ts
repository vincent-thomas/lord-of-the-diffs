/**
 * logic.test.ts — tests for git-commit helpers.
 *
 * Run with:   node logic.test.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isDefaultBranch, gitCommit } from "./logic.ts";

// ---------------------------------------------------------------------------
// Tiny test harness (async-capable)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const asyncTests: Array<() => Promise<void>> = [];

function test(name: string, fn: (() => void) | (() => Promise<void>)): void {
	const run = async () => {
		try {
			await fn();
			console.log(`  ✓  ${name}`);
			passed++;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  ✗  ${name}\n       ${msg}`);
			failed++;
		}
	};
	asyncTests.push(run);
}

function suite(name: string, fn: () => void): void {
	asyncTests.push(async () => console.log(`\n${name}`));
	fn();
}

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
// gitCommit
// ---------------------------------------------------------------------------

suite("gitCommit", () => {
	test(
		"commits staged changes",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "file.txt"), "hello");
			const result = await gitCommit(dir, "add file");
			assert.equal(result.success, true);
			const log = git("git log --oneline -1", dir);
			assert.ok(log.includes("add file"));
		}),
	);

	test(
		"fails when nothing to commit",
		withGitRepo(async (dir) => {
			const result = await gitCommit(dir, "empty commit");
			assert.equal(result.success, false);
			assert.ok(result.output.includes("Nothing to commit"));
		}),
	);

	test(
		"stages all changes automatically",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "a.txt"), "a");
			writeFileSync(join(dir, "b.txt"), "b");
			const result = await gitCommit(dir, "add two files");
			assert.equal(result.success, true);
			const status = git("git status --porcelain", dir);
			assert.equal(status, ""); // clean working tree
		}),
	);

	test(
		"handles message with single quotes",
		withGitRepo(async (dir) => {
			writeFileSync(join(dir, "file.txt"), "content");
			const result = await gitCommit(dir, "it's a test");
			assert.equal(result.success, true);
			const log = git("git log --oneline -1", dir);
			assert.ok(log.includes("it's a test"));
		}),
	);

	test(
		"stages modified files",
		withGitRepo(async (dir) => {
			// init.txt already exists from withGitRepo
			writeFileSync(join(dir, "init.txt"), "modified");
			const result = await gitCommit(dir, "modify init");
			assert.equal(result.success, true);
			const log = git("git log --oneline -1", dir);
			assert.ok(log.includes("modify init"));
		}),
	);

	test(
		"stages deleted files",
		withGitRepo(async (dir) => {
			rmSync(join(dir, "init.txt"));
			const result = await gitCommit(dir, "delete init");
			assert.equal(result.success, true);
			const log = git("git log --oneline -1", dir);
			assert.ok(log.includes("delete init"));
		}),
	);
});

// ---------------------------------------------------------------------------
// Run all tests & summary
// ---------------------------------------------------------------------------

(async () => {
	for (const t of asyncTests) await t();
	console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
})();
