/**
 * logic.ts — pure helper for detecting shell file-write redirections.
 *
 * No pi imports — importable from the extension index and tests.
 */

/**
 * Blank out the contents of every quoted span in `command`, replacing each
 * character (quotes included) with a space so a `>` that only appears inside
 * a string literal — e.g. `echo "score > threshold"` — can never match as a
 * redirection. Character count is preserved, so match indices/text still
 * line up with the original string for unquoted matches.
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
			out += ch === quote ? " " : " ";
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

/**
 * Detects file write redirections: `> file` or `>> file`.
 * Excludes common non-file targets like /dev/null, /dev/stderr, /dev/stdout, &1, &2.
 * Ignores `>` that only appears inside a quoted string (e.g. a commit message
 * or echoed text like `echo "score > threshold"`), which is not a redirection.
 */
export function hasFileWriteRedirection(command: string): { found: boolean; segment?: string } {
	// Match > or >> optionally followed by whitespace then a file path.
	// \d* catches fd-prefixed redirects like 2>file and 1>>file.
	// Exclude: /dev/null, /dev/std*, &1, &2
	// \s* allows both "> file" and ">file" (no space — valid in bash).
	// (?:>>|>(?!>)) prevents >> from backtracking to > and letting the
	// second > leak into the filename.
	const pattern = /(?:^|\s)\d*(?:>>|>(?!>))\s*(?!\/dev\/|&[12]\b)(?:\S+)/;
	const match = pattern.exec(maskQuotedSpans(command));

	if (match) {
		return {
			found: true,
			segment: match[0].trim(),
		};
	}

	return { found: false };
}