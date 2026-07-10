/**
 * logic.ts — pure helper for detecting shell file-write redirections.
 *
 * No pi imports — importable from the extension index and tests.
 */

/**
 * Replace the contents of every quoted span in `command` (quotes included)
 * with a non-whitespace placeholder (`x`), so a `>` that only appears inside
 * a string literal — e.g. `echo "score > threshold"` — can never match as a
 * redirection operator. Character count is preserved, so match indices/text
 * still line up with the original string for unquoted matches.
 *
 * Deliberately masks to a non-space filler rather than blanking to spaces:
 * a *quoted redirection target* — `echo hi > "file.txt"`, an entirely
 * ordinary way to write a redirect — is just as real a file write as an
 * unquoted one, and needs to still read as a non-empty `\S+` token after
 * masking. Blanking to spaces made every quoted target disappear entirely,
 * which let `> "file"` sail past this guard undetected.
 */
function maskQuotedSpans(command: string): string {
	let out = "";
	let quote: "'" | '"' | null = null;
	let escape = false;
	for (const ch of command) {
		if (escape) {
			out += quote ? "x" : ch;
			escape = false;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			out += quote ? "x" : ch;
			escape = true;
			continue;
		}
		if (quote) {
			out += "x";
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			out += "x";
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
		// Report the matched span from the original text, not the masked
		// placeholder text, so a quoted target shows its real filename.
		return {
			found: true,
			segment: command.slice(match.index, match.index + match[0].length).trim(),
		};
	}

	return { found: false };
}