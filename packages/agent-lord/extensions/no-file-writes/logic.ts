/**
 * logic.ts — pure helper for detecting shell file-write redirections.
 *
 * No pi imports — importable from the extension index and tests.
 */

/**
 * Blank out the contents of every quoted span in `command`, replacing each
 * character (quotes included) with a space so a `>` that only appears inside
 * a string literal — e.g. `echo "score > threshold"` — can never match as a
 * redirection operator. Character count is preserved, so match indices still
 * line up with the original string.
 *
 * Only used to locate *operators*. The target that follows one is always
 * read back out of the original, unmasked text (see readWord) — a target
 * can legitimately be quoted (`echo hi > "file.txt"`), and blanking it away
 * here would make it indistinguishable from no target at all.
 */
function maskQuotedSpans(command: string): string {
	let out = "";
	let quote: "'" | '"' | null = null;
	let escape = false;
	for (const ch of command) {
		if (escape) {
			out += quote ? " " : ch;
			escape = false;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			out += quote ? " " : ch;
			escape = true;
			continue;
		}
		if (quote) {
			out += " ";
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			out += " ";
			continue;
		}
		out += ch;
	}
	return out;
}

/** True for redirection targets that discard output rather than writing a real file. */
function isExcludedTarget(value: string): boolean {
	return value === "&1" || value === "&2" || value.startsWith("/dev/");
}

/**
 * Read the shell word starting at `start` (no leading whitespace — callers
 * skip that themselves): a run of characters up to the next unquoted
 * whitespace, resolving quotes/backslash-escapes as it goes.
 *
 * Returns both the raw text (quotes included, for error reporting) and the
 * resolved literal value, so a quoted redirection target's *value* — not
 * its punctuation — is what gets classified. `> "/dev/null"` and `>
 * /dev/null` both resolve to the same value and should be excluded the
 * same way; only comparing raw text would treat the quoted form as some
 * unrecognized file.
 *
 * Returns null if there's nothing there (end of string, or immediate
 * whitespace).
 */
function readWord(command: string, start: number): { raw: string; value: string; end: number } | null {
	let i = start;
	let raw = "";
	let value = "";
	let quote: "'" | '"' | null = null;
	let escape = false;
	while (i < command.length) {
		const ch = command[i];
		if (escape) {
			raw += ch;
			value += ch;
			escape = false;
			i++;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			raw += ch;
			escape = true;
			i++;
			continue;
		}
		if (quote) {
			raw += ch;
			if (ch === quote) quote = null;
			else value += ch;
			i++;
			continue;
		}
		if (ch === "'" || ch === '"') {
			raw += ch;
			quote = ch;
			i++;
			continue;
		}
		if (/\s/.test(ch)) break;
		raw += ch;
		value += ch;
		i++;
	}
	return raw.length > 0 ? { raw, value, end: i } : null;
}

/**
 * Detects file write redirections: `> file` or `>> file`.
 * Excludes common non-file targets like /dev/null, /dev/stderr, /dev/stdout,
 * &1, &2 — including when quoted, since `> "/dev/null"` writes to the same
 * place as `> /dev/null`.
 * Ignores `>` that only appears inside a quoted string (e.g. a commit message
 * or echoed text like `echo "score > threshold"`), which is not a redirection.
 */
export function hasFileWriteRedirection(command: string): { found: boolean; segment?: string } {
	// \d* catches fd-prefixed redirects like 2>file and 1>>file.
	// (?:>>|>(?!>)) prevents >> from backtracking to > and letting the
	// second > leak into the target.
	const operatorPattern = /(?:^|\s)\d*(?:>>|>(?!>))/g;
	const masked = maskQuotedSpans(command);

	let match: RegExpExecArray | null;
	while ((match = operatorPattern.exec(masked))) {
		let targetStart = match.index + match[0].length;
		while (targetStart < command.length && /\s/.test(command[targetStart])) targetStart++;

		const target = readWord(command, targetStart);
		if (target && !isExcludedTarget(target.value)) {
			return {
				found: true,
				segment: command.slice(match.index, target.end).trim(),
			};
		}
	}

	return { found: false };
}
