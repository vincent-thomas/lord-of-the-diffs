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
	isPointlessEscaping,
	isDisguisedFlag,
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

// ── commandInvocation — OBFUSCATED (disguised command name / flag) ─────────
//
// Detection lives at the parser step (here) rather than in individual policy
// consumers: a bareword command name or flag has no legitimate reason to be
// quoted or backslash-escaped — `"git"`, `g\it`, and `g""it` all run
// identically to `git` once the shell resolves them, so doing so only
// serves to dodge string-based checks. commandInvocation returns the
// OBFUSCATED sentinel (distinct from `null`, which means "nothing runs
// here") so every caller is forced to handle it explicitly instead of
// silently skipping it. This isn't limited to whole-token quote pairs —
// backslash-escapes and quote/plain concatenation are resolved too, since
// assuming obfuscation only looks like quotes would leave the rest of that
// space open.

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

test("backslash-per-character command name is obfuscated", () => {
	assert.equal(commandInvocation("g\\it commit -m x"), OBFUSCATED);
});

test("backslash-escaped flag is obfuscated", () => {
	assert.equal(commandInvocation("rm \\-rf dir/"), OBFUSCATED);
});

test("backslash-escaped wrapper name is obfuscated", () => {
	assert.equal(commandInvocation("s\\udo git push"), OBFUSCATED);
});

test("concatenated quote+plain command name is obfuscated", () => {
	assert.equal(commandInvocation('g""it commit -m x'), OBFUSCATED);
});

test("concatenated quote+plain flag is obfuscated", () => {
	assert.equal(commandInvocation("rm '-r'f dir/"), OBFUSCATED);
});

test("single leading backslash (alias-busting idiom) is NOT obfuscated", () => {
	// \cat is a well-known idiom for bypassing shell aliases, not an
	// evasion attempt — commandInvocation resolves it to a plain "cat".
	const inv = commandInvocation("\\cat file");
	assert.ok(inv && inv !== OBFUSCATED);
	assert.equal(inv.name, "cat");
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

// ── isPointlessEscaping ──────────────────────────────────────────────────────
//
// Generalizes past "wrapped in a matching quote pair" — a shell resolves
// backslash-escapes and concatenated quoted/plain/escaped fragments to the
// exact same literal value, so all of those forms need to be caught, not
// just whole-token quoting.

suite("isPointlessEscaping");

test("quoted bareword is pointless", () => {
	assert.equal(isPointlessEscaping('"git"'), true);
	assert.equal(isPointlessEscaping("'rm'"), true);
});

test("backslash-per-character bareword is pointless", () => {
	assert.equal(isPointlessEscaping("g\\it"), true);
});

test("concatenated quote+plain bareword is pointless", () => {
	assert.equal(isPointlessEscaping('g""it'), true);
	assert.equal(isPointlessEscaping("'g'it"), true);
});

test("quoted value with whitespace is not pointless", () => {
	assert.equal(isPointlessEscaping('"fix bug"'), false);
});

test("quoted value with shell metacharacters is not pointless", () => {
	assert.equal(isPointlessEscaping('"a && b"'), false);
	assert.equal(isPointlessEscaping('"$(whoami)"'), false);
});

test("mismatched quotes are not pointless (unresolvable, not a signal either way)", () => {
	assert.equal(isPointlessEscaping("\"git'"), false);
});

test("empty quotes are not pointless (nothing resolved)", () => {
	assert.equal(isPointlessEscaping('""'), false);
});

test("unescaped token is not pointless (nothing to resolve)", () => {
	assert.equal(isPointlessEscaping("git"), false);
});

test("single leading backslash (alias-busting idiom) is exempted", () => {
	assert.equal(isPointlessEscaping("\\cat"), false);
});

test("dangling trailing backslash is not pointless (unresolvable)", () => {
	assert.equal(isPointlessEscaping("git\\"), false);
});

// ── isDisguisedFlag / hasDisguisedFlag ──────────────────────────────────────
//
// A disguised flag (`"-rf"`, `\-rf`, `'-r'f`) runs identically to a plain
// `-rf` but evades `arg.startsWith("-")` checks. Rather than
// resolve-and-continue matching through it (a losing chase against every
// possible quoting/escaping trick), these are used to deny the whole
// command outright.

suite("isDisguisedFlag");

test("detects double-quoted flag", () => {
	assert.equal(isDisguisedFlag('"-rf"'), true);
});

test("detects single-quoted flag", () => {
	assert.equal(isDisguisedFlag("'-r'"), true);
});

test("detects backslash-escaped flag", () => {
	assert.equal(isDisguisedFlag("\\-rf"), true);
});

test("detects concatenated quote+plain flag", () => {
	assert.equal(isDisguisedFlag("'-r'f"), true);
});

test("ignores plain unquoted flag", () => {
	assert.equal(isDisguisedFlag("-rf"), false);
});

test("ignores quoted value that isn't a flag", () => {
	assert.equal(isDisguisedFlag('"fix bug"'), false);
});

test("ignores mismatched quotes", () => {
	assert.equal(isDisguisedFlag('"-rf\''), false);
});

test("ignores too-short/empty token", () => {
	assert.equal(isDisguisedFlag('""'), false);
});

test("a leading backslash on a flag is still disguised — no alias-busting exemption for flags", () => {
	// Unlike the command-name check, there's no legitimate idiom that
	// backslash-escapes a flag, so isDisguisedFlag doesn't exempt it.
	assert.equal(isDisguisedFlag("\\-r"), true);
});

suite("hasDisguisedFlag");

test("finds disguised flag among a command's args", () => {
	assert.equal(hasDisguisedFlag(["\"-rf\"", "some_dir"]), true);
});

test("finds backslash-disguised flag among a command's args", () => {
	assert.equal(hasDisguisedFlag(["\\-rf", "some_dir"]), true);
});

test("false when flag is unquoted", () => {
	assert.equal(hasDisguisedFlag(["-rf", "some_dir"]), false);
});

test("false for quoted non-flag args (e.g. a commit message)", () => {
	assert.equal(hasDisguisedFlag(["-m", '"fix bug"']), false);
});

// ── commandInvocation — wrapper/argument extraction table ───────────────────

function commandNames(text: string): string[] {
	return splitCommandSegments(text)
		.map((segment) => {
			const inv = commandInvocation(segment);
			return inv && inv !== OBFUSCATED ? inv.name : undefined;
		})
		.filter((name): name is string => Boolean(name));
}

suite("commandInvocation — executable resolution");
const invocationCases = [
	["cat file", "cat", ["file"]],
	["sudo cat /etc/x", "sudo", ["cat", "/etc/x"]],
	["sudo -n -- cat /etc/x", "sudo", ["-n", "--", "cat", "/etc/x"]],
	["doas cat /etc/x", "doas", ["cat", "/etc/x"]],
	["env python -c 'x'", "python", ["-c", "'x'"]],
	["env -i FOO=bar python script.py", "python", ["script.py"]],
	["FOO=bar PYTHONPATH=. tee out", "tee", ["out"]],
	["/usr/bin/sed -i s/a/b/ f", "sed", ["-i", "s/a/b/", "f"]],
	["\\cat x", "cat", ["x"]],
	["command grep x file", "grep", ["x", "file"]],
	["builtin echo hi", "echo", ["hi"]],
	["nice -n 10 rg needle", "rg", ["needle"]],
	["time -p git status --short", "git", ["status", "--short"]],
] as const;

for (const [segment, name, args] of invocationCases) {
	test(`resolves: ${segment}`, () => {
		assert.deepEqual(commandInvocation(segment), { name, args });
	});
}

test("empty segment → null", () => assert.equal(commandInvocation("   "), null));
test("leadingCommand returns only executable name", () => assert.equal(leadingCommand("grep cat file"), "grep"));

test("arguments are not treated as commands", () => {
	assert.equal(findCommandUse("echo 'grep'", new Set(["grep"])), null);
});

suite("splitCommandSegments — multi-command bash text");
const splitCases = [
	["ls && true && cat 'fdsafdsa'", ["ls", "true", "cat"]],
	["rg foo | head", ["rg", "head"]],
	["rg foo || fd bar", ["rg", "fd"]],
	["pwd; ls\nrg needle", ["pwd", "ls", "rg"]],
	["echo $(git status --short)", ["echo", "git"]],
	["echo `git status --short`", ["echo", "git"]],
	["(cd /tmp && ls)", ["cd", "ls"]],
	["cat < input > output", ["cat"]],
	["foo & bar", ["foo", "bar"]],
	["echo 'awk && python' && true", ["echo", "true"]],
	["echo \"grep | sed\"; pwd", ["echo", "pwd"]],
] as const;

for (const [text, expected] of splitCases) {
	test(`extracts commands from: ${text}`, () => {
		assert.deepEqual(commandNames(text), expected);
	});
}

test("findCommandUse scans every runnable segment", () => {
	const hit = findCommandUse("ls && true && cat 'fdsafdsa'", new Set(["cat"]));
	assert.deepEqual(hit, { name: "cat", segment: "cat 'fdsafdsa'" });
});

test("findCommandUse sees pipelines and command substitutions", () => {
	assert.equal(findCommandUse("rg foo | head", new Set(["head"]))?.name, "head");
	assert.equal(findCommandUse("echo $(git status --short)", new Set(["git"]))?.segment, "git status --short");
});

suite("splitCommandSegments — edge cases");

const heredocCases = [
	// Here-doc body lines leak through — the parser doesn't track heredoc state.
	["cat << EOF\nhello\nEOF", ["cat", "hello", "eof"]],
	["cat << 'EOF'\nhello\nEOF", ["cat", "hello", "eof"]],
	["cat <<- EOF\n\thello\nEOF", ["cat", "eof", "hello", "eof"]],
	["cat << EOF\nhello\nEOF && ls", ["cat", "hello", "eof", "ls"]],
] as const;

for (const [text, expected] of heredocCases) {
	test(`here-doc body leaks: ${JSON.stringify(text.slice(0, 20))}...`, () => {
		assert.deepEqual(commandNames(text), expected);
	});
}

const redirectEdgeCases = [
	["cmd &> file", ["cmd"]],
	["cmd &>> file", ["cmd"]],
	["cmd |& grep foo", ["cmd", "grep"]],
	["echo foo >> file", ["echo"]],
	["cmd 2>&1", ["cmd"]],
	["cmd 2>&1 3>&2", ["cmd"]],
	["cmd 2>file", ["cmd"]],
	["cmd 1>>file", ["cmd"]],
	// Here-doc body leaks through even with an additional redirect.
	["cat << EOF > file\nhello\nEOF", ["cat", "hello", "eof"]],
	["cmd < input > output", ["cmd"]],
] as const;

for (const [text, expected] of redirectEdgeCases) {
	test(`redirect stripped: ${text}`, () => {
		assert.deepEqual(commandNames(text), expected);
	});
}

const complexCases = [
	// Nested command substitution: both echos and git are real commands.
	["echo $(echo $(git status))", ["echo", "echo", "git"]],
	// Backtick inside double quotes inside $() — echo cmd, backtick content not extracted.
	["echo $(echo \"`pwd`\")", ["echo", "echo"]],
	// Process substitution <(...) — inner commands are args, not extracted.
	["diff <(echo a) <(echo b)", ["diff"]],
] as const;

for (const [text, expected] of complexCases) {
	test(`complex extraction: ${JSON.stringify(text.slice(0, 30))}...`, () => {
		assert.deepEqual(commandNames(text), expected);
	});
}
