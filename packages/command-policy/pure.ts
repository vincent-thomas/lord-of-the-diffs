/**
 * @vt-pi/command-policy/pure.ts — the types needed to construct CommandPolicyEntry
 * values, plus the matching primitives needed to test them directly, with no
 * dependency on Pi.
 *
 * This is the package's second public entry point, alongside the default
 * export from "." (the Pi-wired createCommandPolicyExtension factory).
 * Consumers should import from here rather than reaching into types.ts,
 * matching.ts, or command-utils.ts directly — those are private
 * implementation files, not part of the package's public API, and may be
 * restructured freely as long as this file's exports stay stable.
 *
 * Deliberately not re-exported: flagMatches, commandFlags, findDisallowedFlag,
 * getCommandUses (matching.ts internals with no consumer outside the
 * package's own matching.test.ts) and any command-name predicates like
 * isPythonCommand — which commands/interpreters to flag is a policy choice
 * that belongs where entries are constructed (pi/extensions/command-policy),
 * not in this engine.
 */

export { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./types.ts";
export { matchesEntry, findBannedFlag } from "./matching.ts";
