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
	// tee and rsync write to path arguments directly, the same way cp/mv do —
	// `echo x | tee .git/hooks/pre-commit` and `rsync -a src/ .git/` are just
	// as much a write into a banned folder as `cp src .git/hooks/pre-commit`.
	"tee", "rsync",
	// dd writes to its `of=` argument (and reads from `if=`), not a bare
	// positional path — see extractPathArg.
	"dd",
	// sudo/doas wrap these commands; scanning their args catches
	// e.g. "sudo cp file .git/x" — subcommand names won't match
	// banned folder patterns, only actual paths will.
	"sudo", "doas",
]);

/** `dd`'s path-bearing option keys, e.g. `of=path`, `if=path`. */
const DD_PATH_KEYS = new Set(["if", "of"]);

/**
 * Extract the path a command's argument actually refers to, or null if the
 * argument isn't path-shaped for that command. Most commands take bare
 * positional paths; `dd` instead takes `key=value` options, only some of
 * which (`if=`, `of=`) name a path.
 */
function extractPathArg(commandName: string, arg: string): string | null {
	if (commandName !== "dd") return arg;
	const eq = arg.indexOf("=");
	if (eq === -1) return null;
	if (!DD_PATH_KEYS.has(arg.slice(0, eq))) return null;
	return arg.slice(eq + 1);
}

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
			const path = extractPathArg(inv.name, arg);
			if (path && isPathInsideBannedFolder(path, bannedFolders)) {
				return path;
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
