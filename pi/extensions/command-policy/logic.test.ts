/**
 * logic.test.ts — integration tests for this repo's command policy entries.
 *
 * Generic command-parsing and matching-logic tests live upstream, in
 * @vt-pi/lib's command-utils.test.ts and @vt-pi/command-policy's
 * matching.test.ts / predicates.test.ts. This file only exercises
 * COMMAND_POLICY_ENTRIES itself.
 *
 * Imports from the package's "./matching.ts" subpath rather than its main
 * entry point — the main entry also pulls in the Pi extension wiring, which
 * needs @mariozechner/pi-coding-agent to be resolvable and isn't available
 * in the test environment.
 *
 * Run with:   node --test logic.test.ts
 */
import assert from "node:assert/strict";
import { test, suite } from "node:test";
import { hasDisguisedFlag } from "@vt-pi/lib/command-utils.ts";
import { CommandPolicyStatus, type CommandUse, matchesEntry, findBannedFlag } from "@vt-pi/command-policy/matching.ts";
import { COMMAND_POLICY_ENTRIES } from "./logic.ts";

suite("COMMAND_POLICY_ENTRIES");
function findEntry(name: string) {
	return COMMAND_POLICY_ENTRIES.find((entry) => entry.name === name);
}

test("allows commands by exact command", () => {
	assert.equal(findEntry("rg")?.status, CommandPolicyStatus.Allowed);
	assert.equal(findEntry("rg")?.command, "rg");
	assert.equal(findEntry("fd")?.command, "fd");
	assert.equal(findEntry("jq")?.command, "jq");
});

test("allows git on a subcommand basis", () => {
	assert.deepEqual(findEntry("git")?.subcommand, [
		["diff"], ["log"], ["show"],
		["ls-files"], ["add"], ["restore"],
		["rev-parse"], ["merge-base"],
	]);
	assert.deepEqual(findEntry("git status")?.subcommand, [["status"]]);
	assert.deepEqual(findEntry("git branch")?.subcommand, [["branch"]]);
	assert.deepEqual(findEntry("git rm")?.subcommand, [["rm"]]);
});

test("git commit is not allowed by the command policy — must use the git_commit tool", () => {
	const use: CommandUse = { name: "git", args: ["commit", "-m", "msg"], segment: "git commit -m msg" };
	const entry = COMMAND_POLICY_ENTRIES.find((candidate) => matchesEntry(use, candidate));
	assert.equal(entry, undefined);
});

test("git rm bans recursive flags, matching plain rm", () => {
	assert.ok(findEntry("git rm")?.bannedFlags?.includes("-r"));
	assert.ok(findEntry("git rm")?.bannedFlags?.includes("-rf"));
});

test("git rm -rf is blocked (bypass regression)", () => {
	const use: CommandUse = { name: "git", args: ["rm", "-rf", "dir/"], segment: "git rm -rf dir/" };
	const entry = COMMAND_POLICY_ENTRIES.find((candidate) => matchesEntry(use, candidate));
	assert.equal(entry?.name, "git rm");
	assert.equal(findBannedFlag(use, entry!), "-r");
});

test("git rm without recursive flags is still allowed", () => {
	const use: CommandUse = { name: "git", args: ["rm", "file.txt"], segment: "git rm file.txt" };
	const entry = COMMAND_POLICY_ENTRIES.find((candidate) => matchesEntry(use, candidate));
	assert.equal(entry?.name, "git rm");
	assert.equal(findBannedFlag(use, entry!), null);
});

// Quoting a banned flag (`"-rf"` runs identically to `-rf`) used to slip past
// findBannedFlag, because it only recognizes flags via `arg.startsWith("-")`
// — a quoted token starts with `"` instead. The command's entry would still
// match (by name/subcommand alone) and be treated as Allowed with no flag
// hit. hasDisguisedFlag closes this by flagging the quoted token so callers
// deny the command outright instead of silently letting it through.
test("rm with a quoted recursive flag is caught by hasDisguisedFlag (bypass regression)", () => {
	const use: CommandUse = { name: "rm", args: ['"-rf"', "dir/"], segment: 'rm "-rf" dir/' };
	const entry = COMMAND_POLICY_ENTRIES.find((candidate) => matchesEntry(use, candidate));
	assert.equal(entry?.name, "rm"); // entry still matches by name alone
	assert.equal(findBannedFlag(use, entry!), null); // ...and the flag check alone misses it
	assert.equal(hasDisguisedFlag(use.args), true); // but the disguise itself is caught
});

test("git rm with a quoted recursive flag is caught by hasDisguisedFlag (bypass regression)", () => {
	const use: CommandUse = { name: "git", args: ["rm", "'-r'", "dir/"], segment: "git rm '-r' dir/" };
	const entry = COMMAND_POLICY_ENTRIES.find((candidate) => matchesEntry(use, candidate));
	assert.equal(entry?.name, "git rm");
	assert.equal(findBannedFlag(use, entry!), null);
	assert.equal(hasDisguisedFlag(use.args), true);
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

test("supports allowed flags per allowed entry", () => {
	assert.ok(findEntry("git status")?.allowedFlags?.includes("--short"));
	assert.equal(findEntry("git status")?.bannedFlags, undefined);
});
