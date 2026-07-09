/**
 * command-utils.test.ts — tests for splitCommandSegments and friends.
 */
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import {
	splitCommandSegments,
	commandInvocation,
	leadingCommand,
	findCommandUse,
	isPointlessQuoting,
	isQuoteDisguisedFlag,
	hasDisguisedFlag,
	OBFUSCATED,
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

/** Narrow past the OBFUSCATED sentinel for tests that expect a clean resolution. */
function resolved(segment: string) {
	const inv = commandInvocation(segment);
	assert.ok(inv && inv !== OBFUSCATED, `expected a resolved invocation for ${JSON.stringify(segment)}`);
	return inv;
}

test("resolves simple command", () => {
	const inv = resolved("ls -la");
	assert.equal(inv.name, "ls");
	assert.deepEqual(inv.args, ["-la"]);
});

test("strips leading path from executable", () => {
	assert.equal(resolved("/bin/ls -la").name, "ls");
});

test("skips env assignments", () => {
	assert.equal(resolved("FOO=bar ls -la").name, "ls");
});

test("skips sudo wrapper", () => {
	const inv = resolved("sudo git status");
	assert.equal(inv.name, "sudo");
	assert.deepEqual(inv.args, ["git", "status"]);
});

test("resolves through env to real command", () => {
	assert.equal(resolved("env ls -la").name, "ls");
});

// ── commandInvocation — OBFUSCATED (quoted command name / flag) ────────────
//
// Detection lives at the parser step (here) rather than in individual policy
// consumers: a bareword command name or flag has no legitimate reason to be
// wrapped in quotes — `"git"` and `"-rf"` run identically to `git` and
// `-rf` once the shell strips the quotes, so quoting only serves to dodge
// string-based checks. commandInvocation returns the OBFUSCATED sentinel
// (distinct from `null`, which means "nothing runs here") so every caller
// is forced to handle it explicitly instead of silently skipping it.

suite("commandInvocation — OBFUSCATED");

test("quoted command name is obfuscated", () => {
	assert.equal(commandInvocation('"git" commit -m x'), OBFUSCATED);
});

test("single-quoted command name is obfuscated", () => {
	assert.equal(commandInvocation("'rm' -rf /"), OBFUSCATED);
});

test("quoted wrapper name is obfuscated", () => {
	assert.equal(commandInvocation('"sudo" git push'), OBFUSCATED);
});

test("quoted flag is obfuscated even with a clean command name", () => {
	assert.equal(commandInvocation('rm "-rf" dir/'), OBFUSCATED);
});

test("quoted flag after a wrapper is obfuscated", () => {
	assert.equal(commandInvocation('nice "-n" 10 rg needle'), OBFUSCATED);
});

test("path-prefixed quoted command name is obfuscated", () => {
	assert.equal(commandInvocation('"/bin/rm" -rf /'), OBFUSCATED);
});

test("quoted commit message is NOT obfuscated — legitimate value quoting", () => {
	// Note: commandInvocation tokenizes on whitespace without being
	// quote-aware, so a multi-word quoted value is fragmented into several
	// tokens — none of which is itself fully quote-wrapped, so none look
	// like a disguised flag or command name.
	const inv = commandInvocation('git commit -m "fix bug"');
	assert.ok(inv && inv !== OBFUSCATED);
	assert.equal(inv.name, "git");
	assert.deepEqual(inv.args, ["commit", "-m", '"fix', 'bug"']);
});

test("quoted single-word value is NOT obfuscated — not a flag or command position", () => {
	const inv = commandInvocation('git commit -m "wip"');
	assert.ok(inv && inv !== OBFUSCATED);
});

test("quoted value containing shell metacharacters is NOT obfuscated", () => {
	// Single whitespace-free token, so it's not fragmented by the naive
	// whitespace tokenizer — genuinely tests the metacharacter guard.
	const inv = commandInvocation('echo "$(whoami)"');
	assert.ok(inv && inv !== OBFUSCATED);
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

test("returns null for obfuscated invocation", () => {
	assert.equal(leadingCommand('"git" push'), null);
});

// ── findCommandUse — obfuscated segments always match ───────────────────────

suite("findCommandUse — OBFUSCATED");

test("obfuscated segment matches any search — treated as a potential hit, not skipped", () => {
	const hit = findCommandUse('"git" push', new Set(["git"]));
	assert.deepEqual(hit, { name: OBFUSCATED, segment: '"git" push' });
});

test("clean non-matching segment still returns null", () => {
	assert.equal(findCommandUse("ls -la", new Set(["git"])), null);
});

// ── isPointlessQuoting ───────────────────────────────────────────────────────

suite("isPointlessQuoting");

test("quoted bareword is pointless", () => {
	assert.equal(isPointlessQuoting('"git"'), true);
	assert.equal(isPointlessQuoting("'rm'"), true);
});

test("quoted value with whitespace is not pointless", () => {
	assert.equal(isPointlessQuoting('"fix bug"'), false);
});

test("quoted value with shell metacharacters is not pointless", () => {
	assert.equal(isPointlessQuoting('"a && b"'), false);
	assert.equal(isPointlessQuoting('"$(whoami)"'), false);
});

test("mismatched quotes are not pointless quoting", () => {
	assert.equal(isPointlessQuoting("\"git'"), false);
});

test("empty quotes are not pointless quoting", () => {
	assert.equal(isPointlessQuoting('""'), false);
});

test("unquoted token is not pointless quoting", () => {
	assert.equal(isPointlessQuoting("git"), false);
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
