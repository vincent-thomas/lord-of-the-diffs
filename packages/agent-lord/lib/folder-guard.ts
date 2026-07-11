/**
 * folder-guard.ts — "does this path/command touch a protected path?"
 *
 * Covers two kinds of protected path: banned *folders* (.git,
 * node_modules, …) and the *Makefile*, which defines the project's
 * validation contract (lib/precheck.ts runs `make` — and silently passes
 * when no Makefile exists, so deleting or replacing it would neutralize
 * every pre-check).
 *
 * Shared by independent extensions: folder-protector and write-guard
 * (block the write/edit tools from targeting a protected path directly)
 * and command-policy (blocks any bash command whose args target a
 * protected path, via CommandPolicyEntries using findBannedFolderPath /
 * findMakefilePath as their `command` predicates).
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
 * Scan a resolved command invocation (name + args — the shape shared by
 * @vt-pi/command-policy's commandInvocation and CommandUse) for a path
 * argument matching `predicate`. Returns the first offending path, or null
 * if the invocation is not path-manipulating or no path arg matches.
 *
 * `git rm <path>` is included alongside FILE_MANIP_COMMANDS: it deletes the
 * path (and stages the deletion) just like `rm`, and is otherwise allowed by
 * the command policy. Other git subcommands don't take destructive path args
 * the same way and are governed by their own policy entries.
 */
function findMatchingPathArg(
	use: { name: string; args: string[] },
	predicate: (path: string) => boolean,
): string | null {
	let name = use.name;
	let args = use.args;
	if (name === "git") {
		if (args[0]?.toLowerCase() !== "rm") return null;
		name = "rm";
		args = args.slice(1);
	}
	if (!FILE_MANIP_COMMANDS.has(name)) return null;
	for (const arg of args) {
		if (arg.startsWith("-")) continue;
		const path = extractPathArg(name, arg);
		if (path && predicate(path)) return path;
	}
	return null;
}

/**
 * Check a single resolved command invocation for a path targeting a banned
 * folder. Returns the offending path, or null if this invocation doesn't
 * touch one.
 */
export function findBannedFolderPath(
	use: { name: string; args: string[] },
	bannedFolders: string[] = BANNED_FOLDERS,
): string | null {
	return findMatchingPathArg(use, (path) => isPathInsideBannedFolder(path, bannedFolders));
}

// ---------------------------------------------------------------------------
// Makefile protection
// ---------------------------------------------------------------------------

/** Returns the base filename from a path string. */
export function baseName(p: string): string {
	const idx = p.lastIndexOf("/");
	return idx === -1 ? p : p.slice(idx + 1);
}

/** Returns true when the path's basename is a Makefile (case-insensitive). */
export function isMakefile(filePath: string): boolean {
	return baseName(filePath).toLowerCase() === "makefile";
}

/**
 * Check a single resolved command invocation for a path argument that is a
 * Makefile. Returns the offending path, or null if this invocation doesn't
 * touch one. Catches deletion (`rm Makefile`, `git rm Makefile`),
 * replacement (`mv other Makefile`, `cp other Makefile`), and creation
 * (`touch Makefile`) — any of which would rewrite the validation contract
 * that write-guard already protects from the write/edit tools.
 */
export function findMakefilePath(use: { name: string; args: string[] }): string | null {
	return findMatchingPathArg(use, isMakefile);
}
