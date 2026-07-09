/**
 * predicates.ts — command-name predicates for the language interpreters
 * covered by the default command policy entries.
 */

/** Matches `python`, `python2`, `python3`, `python3.12`, etc. */
export function isPythonCommand(cmd: string): boolean {
	return /^python(?:\d+(?:\.\d+)?)?$/.test(cmd);
}

/** Matches `perl`, `perl5`, `perl5.38`, etc. */
export function isPerlCommand(cmd: string): boolean {
	return /^perl(?:\d+(?:\.\d+)?)?$/.test(cmd);
}

/** Matches `awk`, `gawk`, `mawk`, `nawk`, etc. */
export function isAwkCommand(cmd: string): boolean {
	return /^(?:g|m|n)?awk$/.test(cmd);
}
