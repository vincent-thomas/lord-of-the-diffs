/**
 * logic.ts — pure helper for detecting shell file-write redirections.
 *
 * No pi imports — importable from the extension index and tests.
 */

/**
 * Detects file write redirections: `> file` or `>> file`.
 * Excludes common non-file targets like /dev/null, /dev/stderr, /dev/stdout, &1, &2.
 */
export function hasFileWriteRedirection(command: string): { found: boolean; segment?: string } {
	// Match > or >> optionally followed by whitespace then a file path.
	// \d* catches fd-prefixed redirects like 2>file and 1>>file.
	// Exclude: /dev/null, /dev/std*, &1, &2
	// \s* allows both "> file" and ">file" (no space — valid in bash).
	// (?:>>|>(?!>)) prevents >> from backtracking to > and letting the
	// second > leak into the filename.
	const pattern = /(?:^|\s)\d*(?:>>|>(?!>))\s*(?!\/dev\/|&[12]\b)(?:\S+)/;
	const match = pattern.exec(command);

	if (match) {
		return {
			found: true,
			segment: match[0].trim(),
		};
	}

	return { found: false };
}