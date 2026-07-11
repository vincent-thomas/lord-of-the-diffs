/**
 * logic.test.ts — tests for this repo's COMMAND_POLICY_ENTRIES configuration.
 *
 * Verifies the shape of these entries (status, command, subcommand,
 * bannedFlags, allowedFlags, description) — not the matching engine's
 * behavior, which is unit-tested generically in
 * packages/command-policy/matching.test.ts. @vt-pi/command-policy only
 * exports createCommandPolicyExtension and its associated types, so there's
 * nothing here that simulates command matching or drives the extension.
 *
 * Run with:   node --test logic.test.ts
 */
import assert from "node:assert/strict";
import { test, suite } from "node:test";
import { CommandPolicyStatus, type CommandUse } from "@vt-pi/command-policy";
import { COMMAND_POLICY_ENTRIES } from "./logic.ts";

suite("COMMAND_POLICY_ENTRIES");
function findEntry(name: string) {
	return COMMAND_POLICY_ENTRIES.find((entry) => entry.name === name);
}

const use = (name: string, args: string[]): CommandUse => ({ name, args, segment: `${name} ${args.join(" ")}` });

test("allows commands by exact command", () => {
	assert.equal(findEntry("rg")?.status, CommandPolicyStatus.Allowed);
	assert.equal(findEntry("rg")?.command, "rg");
	assert.equal(findEntry("fd")?.command, "fd");
	assert.equal(findEntry("jq")?.command, "jq");
});

test("allows git only on the listed subcommands — commit and push are banned separately below", () => {
	assert.deepEqual(findEntry("git")?.subcommand, [
		["diff"], ["log"], ["show"],
		["ls-files"], ["add"], ["restore"],
		["rev-parse"], ["merge-base"],
	]);
	assert.deepEqual(findEntry("git status")?.subcommand, [["status"]]);
	assert.deepEqual(findEntry("git branch")?.subcommand, [["branch"]]);
	assert.deepEqual(findEntry("git rm")?.subcommand, [["rm"]]);
});

test("bans git push and git commit — use push_and_check_ci / git_commit tools instead", () => {
	assert.equal(findEntry("git push")?.status, CommandPolicyStatus.Banned);
	assert.deepEqual(findEntry("git push")?.subcommand, [["push"]]);
	assert.match(findEntry("git push")?.description ?? "", /push_and_check_ci/);
	assert.equal(findEntry("git commit")?.status, CommandPolicyStatus.Banned);
	assert.deepEqual(findEntry("git commit")?.subcommand, [["commit"]]);
	assert.match(findEntry("git commit")?.description ?? "", /git_commit/);
});

test("git rm bans recursive flags, matching plain rm", () => {
	assert.ok(findEntry("git rm")?.bannedFlags?.includes("-r"));
	assert.ok(findEntry("git rm")?.bannedFlags?.includes("-rf"));
});

test("can explicitly ban entries with model guidance", () => {
	assert.equal(findEntry("git config")?.status, CommandPolicyStatus.Banned);
	assert.match(findEntry("git config")?.description ?? "", /Do not inspect or modify Git configuration/);
	assert.equal(findEntry("git branch")?.status, CommandPolicyStatus.Banned);
	assert.equal(findEntry("grep")?.status, CommandPolicyStatus.Banned);
	assert.match(findEntry("grep")?.description ?? "", /Use rg/);
});

test("supports banned flags per entry", () => {
	assert.ok(findEntry("rm")?.bannedFlags?.includes("-rf"));
	assert.ok(findEntry("git checkout")?.bannedFlags?.includes("-b"));
});

test("cp bans -a/--archive, not just -r/-R/--recursive — archive mode also copies recursively", () => {
	assert.ok(findEntry("cp")?.bannedFlags?.includes("-a"));
	assert.ok(findEntry("cp")?.bannedFlags?.includes("--archive"));
});

test("supports allowed flags per allowed entry", () => {
	assert.ok(findEntry("git status")?.allowedFlags?.includes("--short"));
	assert.equal(findEntry("git status")?.bannedFlags, undefined);
});

test("protected folder entry is checked first, ahead of otherwise-allowed commands", () => {
	assert.equal(COMMAND_POLICY_ENTRIES[0].name, "protected folder");
	assert.equal(COMMAND_POLICY_ENTRIES[0].status, CommandPolicyStatus.Banned);
});

test("protected folder entry blocks file-manipulation commands targeting .git/node_modules/target", () => {
	const command = findEntry("protected folder")!.command as (u: CommandUse) => boolean;
	assert.ok(command(use("cp", ["file", ".git/somewhere"])));
	assert.ok(command(use("rm", ["-rf", "node_modules"])));
	assert.ok(command(use("tee", [".git/hooks/pre-commit"])));
	assert.ok(command(use("dd", ["if=payload", "of=.git/hooks/pre-commit"])));
});

test("protected folder entry does not match unrelated commands or paths", () => {
	const command = findEntry("protected folder")!.command as (u: CommandUse) => boolean;
	assert.ok(!command(use("cp", ["file", "out/dir"])));
	assert.ok(!command(use("rg", ["foo"])));
});

test("Makefile entry is checked ahead of the allowed rm/cp/mv/git rm entries", () => {
	const makefileIndex = COMMAND_POLICY_ENTRIES.findIndex((e) => e.name === "Makefile");
	assert.ok(makefileIndex >= 0);
	assert.equal(COMMAND_POLICY_ENTRIES[makefileIndex].status, CommandPolicyStatus.Banned);
	for (const name of ["rm", "cp", "mv", "git rm"]) {
		const allowedIndex = COMMAND_POLICY_ENTRIES.findIndex((e) => e.name === name);
		assert.ok(makefileIndex < allowedIndex, `Makefile entry must precede "${name}"`);
	}
});

test("Makefile entry blocks shell commands that delete, replace, or create a Makefile", () => {
	const command = findEntry("Makefile")!.command as (u: CommandUse) => boolean;
	assert.ok(command(use("rm", ["Makefile"])));
	assert.ok(command(use("rm", ["-f", "Makefile"])));
	assert.ok(command(use("git", ["rm", "Makefile"])));
	assert.ok(command(use("mv", ["Makefile.new", "Makefile"])));
	assert.ok(command(use("cp", ["other", "src/Makefile"])));
	assert.ok(command(use("touch", ["makefile"])));
});

test("Makefile entry does not match reads or unrelated paths", () => {
	const command = findEntry("Makefile")!.command as (u: CommandUse) => boolean;
	assert.ok(!command(use("head", ["Makefile"])));
	assert.ok(!command(use("rm", ["file.txt"])));
	assert.ok(!command(use("rm", ["Makefile.am"])));
	assert.ok(!command(use("git", ["add", "Makefile"])));
});
