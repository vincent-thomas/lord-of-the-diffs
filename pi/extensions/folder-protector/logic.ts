/**
 * Logic for the folder-protector extension.
 *
 * Pure functions — no Pi imports allowed.
 */
import { splitCommandSegments, commandInvocation, OBFUSCATED } from "../../lib/command-utils.ts";

/**
 * List of banned folder names. Any path whose segments contain one of these
 * folder names (as an exact segment match) is blocked from write/edit/bash.
 */
export const BANNED_FOLDERS: string[] = [
	".git",
	"node_modules",
	"target",
];

/** File-manipulation commands whose path args should be checked. */
const FILE_MANIP_COMMANDS = new Set([
	"cp", "mv", "rm", "chmod", "chown", "ln", "install",
	"mkdir", "touch",
	// sudo/doas wrap these commands; scanning their args catches
	// e.g. "sudo cp file .git/x" — subcommand names won't match
	// banned folder patterns, only actual paths will.
	"sudo", "doas",
]);

/**
 * Scan a shell command string for file-manipulation commands targeting
 * paths inside banned folders. Uses the same shell-aware segment splitting
 * and command resolution as the rest of the codebase (splitCommandSegments
 * + commandInvocation).
 *
 * Returns the first banned path found, or null if none.
 */
export function findBannedFolderTarget(
	command: string,
	bannedFolders: string[],
): string | null {
	for (const segment of splitCommandSegments(command)) {
		const inv = commandInvocation(segment);
		// Obfuscated invocations (quoted command name/flag) aren't resolvable
		// to a name or path here, so there's nothing folder-specific to check —
		// they're denied outright by the command-policy allowlist instead.
		if (!inv || inv === OBFUSCATED) continue;
		if (!FILE_MANIP_COMMANDS.has(inv.name)) continue;
		for (const arg of inv.args) {
			if (arg.startsWith("-")) continue;
			if (isPathInsideBannedFolder(arg, bannedFolders)) {
				return arg;
			}
		}
	}
	return null;
}

/** Normalize path separators and remove trailing slash. */
function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Check whether a file path falls within any of the banned folders.
 * Matches exact path segments — e.g. ".git" matches ".git/HEAD" but not
 * ".gitignore" or ".gittest".
 */
export function isPathInsideBannedFolder(path: string, bannedFolders: string[]): boolean {
	const normalized = normalizePath(path);
	const segments = normalized.split("/");
	for (const folder of bannedFolders) {
		if (segments.includes(folder)) return true;
	}
	return false;
}
