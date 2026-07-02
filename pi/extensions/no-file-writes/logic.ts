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
	// Match > or >> followed by something that looks like a file path
	// Exclude: /dev/null, /dev/std*, &1, &2
	const pattern = /(\s|^)(>>?)\s+(?!\/dev\/|&[12]\b)(\S+)/g;
	const match = pattern.exec(command);

	if (match) {
		return {
			found: true,
			segment: match[0].trim(),
		};
	}

	return { found: false };
}