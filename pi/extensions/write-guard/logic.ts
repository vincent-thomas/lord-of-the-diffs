/**
 * logic.ts — pure helpers for the write-guard extension.
 *
 * No pi imports — importable from the extension index and tests.
 */

/** Maximum line count before write tool is blocked on existing files. */
export const MAX_LINES = 50;

/** Name of the Makefile (case-insensitive match target). */
const MAKEFILE_NAME = "makefile";

/** Returns the base filename from a path string. */
export function baseName(p: string): string {
	const idx = p.lastIndexOf("/");
	return idx === -1 ? p : p.slice(idx + 1);
}

/** Returns true when the path's basename is a Makefile (case-insensitive). */
export function isMakefile(filePath: string): boolean {
	return baseName(filePath).toLowerCase() === MAKEFILE_NAME;
}

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
