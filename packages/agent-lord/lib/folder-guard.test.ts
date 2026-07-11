/**
 * folder-guard.test.ts — tests for the shared banned-folder checks used by
 * folder-protector (write/edit tools) and command-policy (bash commands).
 */
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import {
	isPathInsideBannedFolder,
	findBannedFolderPath,
	findMakefilePath,
	BANNED_FOLDERS,
} from "./folder-guard.ts";

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

suite("findBannedFolderPath — file-manipulation invocations targeting banned folders");

const use = (name: string, args: string[]) => ({ name, args });

test("detects cp targeting .git", () => {
	assert.equal(findBannedFolderPath(use("cp", ["file.txt", ".git/somewhere"]), BANNED_FOLDERS), ".git/somewhere");
});

test("detects mv targeting .git", () => {
	assert.equal(findBannedFolderPath(use("mv", [".git/refs", "/tmp/"]), BANNED_FOLDERS), ".git/refs");
});

test("detects rm targeting .git", () => {
	assert.equal(findBannedFolderPath(use("rm", ["-rf", ".git"]), BANNED_FOLDERS), ".git");
});

test("detects chmod targeting .git", () => {
	assert.equal(findBannedFolderPath(use("chmod", ["-R", "755", ".git"]), BANNED_FOLDERS), ".git");
});

test("detects mkdir inside .git", () => {
	assert.equal(findBannedFolderPath(use("mkdir", ["-p", ".git/foo/bar"]), BANNED_FOLDERS), ".git/foo/bar");
});

test("detects touch inside .git", () => {
	assert.equal(findBannedFolderPath(use("touch", [".git/config"]), BANNED_FOLDERS), ".git/config");
});

test("detects install targeting .git", () => {
	assert.equal(findBannedFolderPath(use("install", ["file", ".git/bin/"]), BANNED_FOLDERS), ".git/bin/");
});

test("detects sudo wrapping a command targeting .git", () => {
	assert.equal(findBannedFolderPath(use("sudo", ["cp", "file", ".git/somewhere"]), BANNED_FOLDERS), ".git/somewhere");
});

test("detects tee writing into .git", () => {
	assert.equal(findBannedFolderPath(use("tee", [".git/hooks/pre-commit"]), BANNED_FOLDERS), ".git/hooks/pre-commit");
});

test("detects rsync targeting .git", () => {
	assert.equal(findBannedFolderPath(use("rsync", ["-a", "src/", ".git/hooks/"]), BANNED_FOLDERS), ".git/hooks/");
});

test("detects dd writing to .git via of=", () => {
	assert.equal(findBannedFolderPath(use("dd", ["if=payload", "of=.git/hooks/pre-commit"]), BANNED_FOLDERS), ".git/hooks/pre-commit");
});

test("detects dd reading from .git via if=", () => {
	assert.equal(findBannedFolderPath(use("dd", ["if=.git/config", "of=/tmp/out"]), BANNED_FOLDERS), ".git/config");
});

test("ignores unrelated dd key=value options", () => {
	assert.equal(findBannedFolderPath(use("dd", ["if=payload", "of=/tmp/out", "bs=1M"]), BANNED_FOLDERS), null);
});

test("detects command when target is node_modules", () => {
	assert.equal(findBannedFolderPath(use("rm", ["-rf", "node_modules"]), BANNED_FOLDERS), "node_modules");
});

test("detects command when target is target", () => {
	assert.equal(findBannedFolderPath(use("rm", ["-rf", "target/"]), BANNED_FOLDERS), "target/");
});

test("returns null for non-file-manipulation commands", () => {
	assert.equal(findBannedFolderPath(use("cat", [".git/HEAD"]), BANNED_FOLDERS), null);
});

test("returns null for file-manipulation on non-banned path", () => {
	assert.equal(findBannedFolderPath(use("cp", ["file.txt", "out/dir/"]), BANNED_FOLDERS), null);
});

test("returns null for benign commands", () => {
	assert.equal(findBannedFolderPath(use("ls", ["-la"]), BANNED_FOLDERS), null);
});

test("detects git rm targeting a banned folder", () => {
	assert.equal(findBannedFolderPath(use("git", ["rm", ".git/config"]), BANNED_FOLDERS), ".git/config");
});

suite("findMakefilePath — file-manipulation invocations targeting a Makefile");

test("detects rm deleting the Makefile", () => {
	assert.equal(findMakefilePath(use("rm", ["Makefile"])), "Makefile");
	assert.equal(findMakefilePath(use("rm", ["-f", "Makefile"])), "Makefile");
});

test("detects git rm deleting the Makefile", () => {
	assert.equal(findMakefilePath(use("git", ["rm", "Makefile"])), "Makefile");
});

test("detects mv replacing or renaming away the Makefile", () => {
	assert.equal(findMakefilePath(use("mv", ["Makefile.new", "Makefile"])), "Makefile");
	assert.equal(findMakefilePath(use("mv", ["Makefile", "/tmp/gone"])), "Makefile");
});

test("detects cp overwriting the Makefile", () => {
	assert.equal(findMakefilePath(use("cp", ["other", "Makefile"])), "Makefile");
});

test("detects touch creating a Makefile", () => {
	assert.equal(findMakefilePath(use("touch", ["Makefile"])), "Makefile");
});

test("detects dd writing to the Makefile via of=", () => {
	assert.equal(findMakefilePath(use("dd", ["if=payload", "of=Makefile"])), "Makefile");
});

test("matches case-insensitively and in subdirectories", () => {
	assert.equal(findMakefilePath(use("rm", ["makefile"])), "makefile");
	assert.equal(findMakefilePath(use("rm", ["src/Makefile"])), "src/Makefile");
});

test("does not match Makefile-adjacent names", () => {
	assert.equal(findMakefilePath(use("rm", ["Makefile.am"])), null);
	assert.equal(findMakefilePath(use("rm", ["makefile.in"])), null);
	assert.equal(findMakefilePath(use("rm", ["not-a-makefile"])), null);
});

test("returns null for non-file-manipulation commands", () => {
	assert.equal(findMakefilePath(use("ls", ["Makefile"])), null);
	assert.equal(findMakefilePath(use("wc", ["-l", "Makefile"])), null);
});

test("returns null for git subcommands other than rm", () => {
	assert.equal(findMakefilePath(use("git", ["add", "Makefile"])), null);
	assert.equal(findMakefilePath(use("git", ["restore", "Makefile"])), null);
});
