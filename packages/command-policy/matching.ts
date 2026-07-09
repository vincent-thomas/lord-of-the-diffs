/**
 * matching.ts — pure matching logic for command policy enforcement.
 *
 * No pi imports — importable from any test or logic module.
 */
import { splitCommandSegments, commandInvocation, OBFUSCATED } from "@vt-pi/lib/command-utils.ts";
import { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./types.ts";

export { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse };

/**
 * Check whether a command use matches a policy entry.
 */
export function matchesEntry(use: CommandUse, entry: CommandPolicyEntry): boolean {
	const commandMatches =
		typeof entry.command === "string" ? use.name === entry.command.toLowerCase() : entry.command(use.name);
	if (!commandMatches) return false;
	if (!entry.subcommand) return true;
	// subcommand is a list of arrays — ANY matching sub-array is sufficient (OR semantics).
	return entry.subcommand.some((sub) =>
		sub.every((part, index) => use.args[index]?.toLowerCase() === part.toLowerCase()),
	);
}

/**
 * Check whether an arg matches a flag.
 *
 * Handles exact match, `flag=value` form, and combined short flags
 * (e.g. `-rfv` matches banned flag `-r` or `-rf`).
 */
export function flagMatches(arg: string, flag: string): boolean {
	if (arg === flag || arg.startsWith(`${flag}=`)) return true;

	// Handle combined short flags: `-rfv` should match banned `-r` or `-rf`.
	// Short flags start with a single dash followed by non-dash characters.
	const isShort = (s: string) => s.length >= 2 && s[0] === "-" && s[1] !== "-";
	if (isShort(arg) && isShort(flag)) {
		const argChars = new Set(arg.slice(1));
		return [...flag.slice(1)].every((ch) => argChars.has(ch));
	}

	return false;
}

/**
 * Extract flag arguments from a command use, excluding `--`.
 */
export function commandFlags(use: CommandUse): string[] {
	return use.args.filter((arg) => arg.startsWith("-") && arg !== "--");
}

/**
 * Find the first banned flag present in a command use.
 */
export function findBannedFlag(use: CommandUse, entry: CommandPolicyEntry): string | null {
	for (const flag of entry.bannedFlags ?? []) {
		if (use.args.some((arg) => flagMatches(arg, flag))) return flag;
	}
	return null;
}

/**
 * Find the first flag in a command use that is not in the entry's allowed set.
 * Returns null when there is no allowedFlags restriction, or when all flags
 * are allowed.
 *
 * Combined short flags (e.g. `-sv`) are checked character-by-character: every
 * character must be covered by an allowed single-char flag (e.g. `-s`), so an
 * arbitrary flag can't be smuggled in by bundling it with an allowed one.
 */
export function findDisallowedFlag(use: CommandUse, entry: CommandPolicyEntry): string | null {
	if (!entry.allowedFlags) return null;

	const allowedChars = new Set<string>();
	for (const allowed of entry.allowedFlags) {
		if (allowed.length === 2 && allowed[0] === "-" && allowed[1] !== "-") allowedChars.add(allowed[1]);
	}

	for (const flag of commandFlags(use)) {
		const isCombinedShort = flag.length > 2 && flag[0] === "-" && flag[1] !== "-" && !flag.includes("=");
		if (isCombinedShort) {
			if ([...flag.slice(1)].some((ch) => !allowedChars.has(ch))) return flag;
			continue;
		}
		if (!entry.allowedFlags.some((allowed) => flagMatches(flag, allowed))) return flag;
	}
	return null;
}

/**
 * Extract all command uses from shell text.
 */
export function getCommandUses(text: string): CommandUse[] {
	const uses: CommandUse[] = [];
	for (const segment of splitCommandSegments(text)) {
		const invocation = commandInvocation(segment);
		if (invocation === null) continue;
		if (invocation === OBFUSCATED) {
			uses.push({ name: OBFUSCATED, args: [], segment: segment.trim(), obfuscated: true });
			continue;
		}
		uses.push({ ...invocation, segment: segment.trim() });
	}
	return uses;
}
