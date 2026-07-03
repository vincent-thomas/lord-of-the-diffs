/**
 * logic.test.ts — tests for folder-protector logic.
 */
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { isPathInsideBannedFolder, BANNED_FOLDERS, findBannedFolderTarget } from "./logic.ts";
import { splitCommandSegments } from "../../lib/command-utils.ts";

suite("isPathInsideBannedFolder with .git in BANNED_FOLDERS");

const isInsideDotGit = (path: string) => isPathInsideBannedFolder(path, BANNED_FOLDERS);

test("returns true for path directly inside .git", () => {
	assert.ok(isInsideDotGit(".git/HEAD"));
});

test("returns true for path inside .git subdirectory", () => {
	assert.ok(isInsideDotGit(".git/refs/heads/main"));
});

test("returns true for .git directory itself", () => {
	assert.ok(isInsideDotGit(".git"));
	assert.ok(isInsideDotGit(".git/"));
});

test("returns true for absolute paths inside .git", () => {
	assert.ok(isInsideDotGit("/home/user/repo/.git/config"));
});

test("returns false for non-.git paths", () => {
	assert.ok(!isInsideDotGit("src/index.ts"));
	assert.ok(!isInsideDotGit("README.md"));
	assert.ok(!isInsideDotGit("some/path/.gittest/file"));
});

test("returns false for paths containing .git as substring in a segment", () => {
	assert.ok(!isInsideDotGit("tools/gitignore/file"));
	assert.ok(!isInsideDotGit("src/.gitignore"));
	assert.ok(!isInsideDotGit(".gittest"));
});

test("returns false for empty string", () => {
	assert.ok(!isInsideDotGit(""));
});

suite("isPathInsideBannedFolder — custom folder lists");

test("matches any folder in a multi-folder list", () => {
	assert.ok(isPathInsideBannedFolder("node_modules/foo", [".git", "node_modules"]));
	assert.ok(isPathInsideBannedFolder("dist/out.js", ["dist"]));
});

test("does not match folders not in the list", () => {
	assert.ok(!isPathInsideBannedFolder("src/index.ts", [".git", "node_modules"]));
});

test("empty banned list returns false for everything", () => {
	assert.ok(!isPathInsideBannedFolder(".git/HEAD", []));
});

suite("findBannedFolderTarget — file-manipulation commands in banned folders");

test("detects cp targeting .git", () => {
	assert.equal(findBannedFolderTarget("cp file.txt .git/somewhere", BANNED_FOLDERS), ".git/somewhere");
});

test("detects mv targeting .git", () => {
	assert.equal(findBannedFolderTarget("mv .git/refs /tmp/", BANNED_FOLDERS), ".git/refs");
});

test("detects rm targeting .git", () => {
	assert.equal(findBannedFolderTarget("rm -rf .git", BANNED_FOLDERS), ".git");
});

test("detects chmod targeting .git", () => {
	assert.equal(findBannedFolderTarget("chmod -R 755 .git", BANNED_FOLDERS), ".git");
});

test("detects mkdir inside .git", () => {
	assert.equal(findBannedFolderTarget("mkdir -p .git/foo/bar", BANNED_FOLDERS), ".git/foo/bar");
});

test("detects touch inside .git", () => {
	assert.equal(findBannedFolderTarget("touch .git/config", BANNED_FOLDERS), ".git/config");
});

test("detects install targeting .git", () => {
	assert.equal(findBannedFolderTarget("install file .git/bin/", BANNED_FOLDERS), ".git/bin/");
});

test("detects command through env wrapper", () => {
	assert.equal(findBannedFolderTarget("env cp file .git/somewhere", BANNED_FOLDERS), ".git/somewhere");
});

test("detects command through sudo wrapper", () => {
	assert.equal(findBannedFolderTarget("sudo cp file .git/somewhere", BANNED_FOLDERS), ".git/somewhere");
});

test("detects command when target is node_modules", () => {
	assert.equal(findBannedFolderTarget("rm -rf node_modules", BANNED_FOLDERS), "node_modules");
});

test("detects command when target is target", () => {
	assert.equal(findBannedFolderTarget("rm -rf target/", BANNED_FOLDERS), "target/");
});

test("detects in pipeline", () => {
	assert.equal(findBannedFolderTarget("ls | cp file .git/x", BANNED_FOLDERS), ".git/x");
});

test("detects after &&", () => {
	assert.equal(findBannedFolderTarget("echo ok && cp file .git/x", BANNED_FOLDERS), ".git/x");
});

test("returns null for non-file-manipulation commands", () => {
	assert.equal(findBannedFolderTarget("cat .git/HEAD", BANNED_FOLDERS), null);
});

test("returns null for file-manipulation on non-banned path", () => {
	assert.equal(findBannedFolderTarget("cp file.txt out/dir/", BANNED_FOLDERS), null);
});

test("returns null for benign commands", () => {
	assert.equal(findBannedFolderTarget("ls -la", BANNED_FOLDERS), null);
});

test("returns null for empty command", () => {
	assert.equal(findBannedFolderTarget("", BANNED_FOLDERS), null);
});

suite("splitCommandSegments — process substitution");

test("does not split on >(...) — keeps segment whole", () => {
	const segments = splitCommandSegments("diff <(ls a) >(sort -r)");
	const nonEmpty = segments.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
	assert.ok(nonEmpty[0].includes(">("));
});

test("does not split on <(...) — keeps segment whole", () => {
	const segments = splitCommandSegments("diff <(ls a) <(ls b)");
	const nonEmpty = segments.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
});

test("does split on $(...) — command substitution is a separate segment", () => {
	const segments = splitCommandSegments("echo $(whoami)");
	const nonEmpty = segments.filter(Boolean);
	assert.equal(nonEmpty.length, 2);
	assert.equal(nonEmpty[1], "whoami");
});

test(">(...) target not falsely detected as file-manipulation", () => {
	// Before the fix for >(...), the > would be treated as a redirect and
	// `cat .git/HEAD` could appear as a separate segment. Verify it's
	// correctly kept as an argument of the parent command.
	assert.equal(
		findBannedFolderTarget("env cat <(ls) >(cat .git/HEAD)", BANNED_FOLDERS),
		null,
	);
});
