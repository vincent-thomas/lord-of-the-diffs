/**
 * @vt-pi/command-policy — types and matching logic for an allow-list of
 * shell command invocations.
 *
 * Pure TypeScript, no dependency on Pi (@mariozechner/pi-coding-agent) or
 * any other agent framework — consumers wire these matching functions into
 * their own tool_call hook. See pi/extensions/command-policy for an example.
 */

export { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./types.ts";
export { isPythonCommand, isPerlCommand, isAwkCommand } from "./predicates.ts";
export { matchesEntry, flagMatches, commandFlags, findBannedFlag, findDisallowedFlag, getCommandUses } from "./matching.ts";
