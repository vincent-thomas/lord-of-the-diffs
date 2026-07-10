/**
 * folder-guard.ts — "does this path/command touch a protected folder?"
 *
 * Shared by two independent extensions: folder-protector (blocks the write
 * and edit tools from targeting a protected path directly) and
 * command-policy (blocks any bash command whose args target a protected
 * path, via a CommandPolicyEntry using findBannedFolderPath as its
 * `command` predicate).
 *
 * No pi imports — importable from any extension's logic module.
 */

/** Folder names that no tool or command may write/edit inside. */
export const BANNED_FOLDERS: string[] = [
	".git",
	"node_modules",
	"target",
];

/** Normalize path separators and remove trailing slash. */
function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Check whether a file path falls within any of the banned folders.
 * Matches exact path segments — e.g. ".git" matches ".git/HEAD" but not
 * ".gitignore" or ".gittest".
 */
export function isPathInsideBannedFolder(path: string, bannedFolders: string[] = BANNED_FOLDERS): boolean {
	const normalized = normalizePath(path);
	const segments = normalized.split("/");
	return bannedFolders.some((folder) => segments.includes(folder));
}

/** Shell commands whose path args should be checked against banned folders. */
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
 * Check a single resolved command invocation (name + args — the shape
 * shared by @vt-pi/command-policy's commandInvocation and CommandUse) for a
 * path targeting a banned folder. Returns the offending path, or null if
 * this invocation doesn't touch one.
 */
export function findBannedFolderPath(
	use: { name: string; args: string[] },
	bannedFolders: string[] = BANNED_FOLDERS,
): string | null {
	if (!FILE_MANIP_COMMANDS.has(use.name)) return null;
	for (const arg of use.args) {
		if (arg.startsWith("-")) continue;
		const path = extractPathArg(use.name, arg);
		if (path && isPathInsideBannedFolder(path, bannedFolders)) return path;
	}
	return null;
}
