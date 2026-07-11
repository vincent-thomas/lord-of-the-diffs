/**
 * logic.ts — pure helpers for the write-guard extension.
 *
 * No pi imports — importable from the extension index and tests.
 */

// Re-exports from lib so consumers (index.ts, tests) keep the same import
// path. The Makefile check lives in lib/folder-guard.ts because the
// command-policy extension enforces the same protection on bash commands.
export { baseName, isMakefile } from "../../lib/folder-guard.ts";

/** Maximum line count before write tool is blocked on existing files. */
export const MAX_LINES = 50;

/**
 * Check an existing file's line count and return a block reason if the file
 * exceeds the threshold. Returns null when the write should be allowed.
 */
export function checkFileTooLarge(
	filePath: string,
	content: string,
	lineThreshold: number = MAX_LINES,
): string | null {
	const lineCount = content.split("\n").length;
	if (lineCount <= lineThreshold) return null;
	return (
		`Cannot overwrite "${filePath}" — it has ${lineCount} lines (threshold: ${lineThreshold}). ` +
		`Use the \`edit\` tool to make surgical changes instead. ` +
		`The \`write\` tool on large existing files risks silently dropping content.`
	);
}

/** Reason message for blocking Makefile modifications. */
export function makefileBlockReason(toolType: string, filePath: string): string {
	return (
		`Cannot ${toolType} "${filePath}" — the Makefile defines the project's ` +
		`validation contract and should only be changed intentionally by the user. ` +
		`If the Makefile really needs to change, tell the user what change is needed ` +
		`and why, and ask them to make it.`
	);
}
