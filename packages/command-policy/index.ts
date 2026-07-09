/**
 * @vt-pi/command-policy — a Pi extension factory that allows only configured
 * shell command invocations via the bash tool.
 *
 * The default export builds the extension from a list of policy entries:
 *
 *   import createCommandPolicyExtension from "@vt-pi/command-policy";
 *   export default createCommandPolicyExtension({ entries: [...] });
 */

export { createCommandPolicyExtension as default, type CommandPolicyOptions } from "./extension.ts";
export { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./types.ts";
export { isPythonCommand, isPerlCommand, isAwkCommand } from "./predicates.ts";
export { matchesEntry, flagMatches, commandFlags, findBannedFlag, findDisallowedFlag, getCommandUses } from "./matching.ts";
