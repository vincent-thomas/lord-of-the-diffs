/**
 * command-utils.test.ts — tests for splitCommandSegments and friends.
 */
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import {
	splitCommandSegments,
	commandInvocation,
	leadingCommand,
	isQuoteDisguisedFlag,
	hasDisguisedFlag,
} from "./command-utils.ts";

// ── splitCommandSegments ────────────────────────────────────────────────────

suite("splitCommandSegments");

test("splits on pipe", () => {
	const segs = splitCommandSegments("echo hello | grep world");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 2);
	assert.ok(nonEmpty[0].includes("echo hello"));
	assert.ok(nonEmpty[1].includes("grep world"));
});

test("splits on && and ||", () => {
	const segs = splitCommandSegments("cd dir && make || echo fail");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 3);
});

test("splits on newline", () => {
	const segs = splitCommandSegments("ls\necho hi");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 2);
});

test("splits on semicolon", () => {
	const segs = splitCommandSegments("ls; echo hi");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 2);
});

// ── Process substitution — must NOT split ───────────────────────────────────

test("does not split on <(...) — input process substitution", () => {
	const segs = splitCommandSegments("diff <(ls a) <(ls b)");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
	assert.ok(nonEmpty[0].includes("<("));
});

test("does not split on >(...) — output process substitution", () => {
	// This was broken before the fix: > in >(...) was treated as a
	// file redirection, causing pushCurrent() and splitting the segment.
	const segs = splitCommandSegments("diff <(ls a) >(sort -r)");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
	assert.ok(nonEmpty[0].includes(">("));
});

test("handles nested process substitution", () => {
	const segs = splitCommandSegments("cmd <(cat <(echo nested))");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
});

// ── Command substitution — MUST split ───────────────────────────────────────

test("splits on $(...) — extracts content as segment", () => {
	const segs = splitCommandSegments("echo $(whoami)");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 2);
	assert.equal(nonEmpty[1], "whoami");
});

test("splits on nested $(...)", () => {
	const segs = splitCommandSegments("echo $(echo $(whoami))");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 3);
	assert.ok(nonEmpty[0].includes("echo"));
	assert.ok(nonEmpty[1].includes("echo"));
	assert.equal(nonEmpty[2], "whoami");
});

// ── Redirection — must split ────────────────────────────────────────────────

// Note: redirection *targets* are skipped (they are file paths, not commands).
// The segment containing the command before the redirect is still emitted.

test("splits on > — emits command, skips target", () => {
	const segs = splitCommandSegments("echo hi > out.txt");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
	assert.ok(nonEmpty[0].includes("echo hi"));
});

test("splits on >> — emits command, skips target", () => {
	const segs = splitCommandSegments("echo hi >> log.txt");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
	assert.ok(nonEmpty[0].includes("echo hi"));
});

test("splits on fd-prefixed redirect — strips fd, emits command, skips target", () => {
	const segs = splitCommandSegments("cmd 2> err.log");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
	assert.ok(nonEmpty[0].includes("cmd"));
	// FD number should be stripped
	assert.ok(!nonEmpty[0].includes("2"));
});

// ── Quoted strings ──────────────────────────────────────────────────────────

test("does not split on operators inside double quotes", () => {
	const segs = splitCommandSegments('echo "hello | world"');
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
});

test("does not split on operators inside single quotes", () => {
	const segs = splitCommandSegments("echo 'hello | world'");
	const nonEmpty = segs.filter(Boolean);
	assert.equal(nonEmpty.length, 1);
});

// ── commandInvocation ───────────────────────────────────────────────────────

suite("commandInvocation");

test("resolves simple command", () => {
	const inv = commandInvocation("ls -la");
	assert.ok(inv);
	assert.equal(inv.name, "ls");
	assert.deepEqual(inv.args, ["-la"]);
});

test("strips leading path from executable", () => {
	const inv = commandInvocation("/bin/ls -la");
	assert.ok(inv);
	assert.equal(inv.name, "ls");
});

test("skips env assignments", () => {
	const inv = commandInvocation("FOO=bar ls -la");
	assert.ok(inv);
	assert.equal(inv.name, "ls");
});

test("skips sudo wrapper", () => {
	const inv = commandInvocation("sudo git status");
	assert.ok(inv);
	assert.equal(inv.name, "sudo");
	assert.deepEqual(inv.args, ["git", "status"]);
});

test("resolves through env to real command", () => {
	const inv = commandInvocation("env ls -la");
	assert.ok(inv);
	assert.equal(inv.name, "ls");
});

// ── leadingCommand ──────────────────────────────────────────────────────────

suite("leadingCommand");

test("returns command name", () => {
	assert.equal(leadingCommand("ls -la"), "ls");
});

test("returns null for empty segment", () => {
	assert.equal(leadingCommand(""), null);
});

test("returns null for env assignment only", () => {
	assert.equal(leadingCommand("FOO=bar"), null);
});

// ── isQuoteDisguisedFlag / hasDisguisedFlag ─────────────────────────────────
//
// A quoted flag (`"-rf"`) runs identically to an unquoted one (`-rf`) but
// evades `arg.startsWith("-")` checks. Rather than unquote-and-continue
// (a losing chase against every possible quoting/escaping trick), these
// are used to deny the whole command outright.

suite("isQuoteDisguisedFlag");

test("detects double-quoted flag", () => {
	assert.equal(isQuoteDisguisedFlag('"-rf"'), true);
});

test("detects single-quoted flag", () => {
	assert.equal(isQuoteDisguisedFlag("'-r'"), true);
});

test("ignores plain unquoted flag", () => {
	assert.equal(isQuoteDisguisedFlag("-rf"), false);
});

test("ignores quoted value that isn't a flag", () => {
	assert.equal(isQuoteDisguisedFlag('"fix bug"'), false);
});

test("ignores mismatched quotes", () => {
	assert.equal(isQuoteDisguisedFlag('"-rf\''), false);
});

test("ignores too-short token", () => {
	assert.equal(isQuoteDisguisedFlag('""'), false);
});

suite("hasDisguisedFlag");

test("finds disguised flag among a command's args", () => {
	assert.equal(hasDisguisedFlag(["\"-rf\"", "some_dir"]), true);
});

test("false when flag is unquoted", () => {
	assert.equal(hasDisguisedFlag(["-rf", "some_dir"]), false);
});

test("false for quoted non-flag args (e.g. a commit message)", () => {
	assert.equal(hasDisguisedFlag(["-m", '"fix bug"']), false);
});
