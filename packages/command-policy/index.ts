/**
 * @vt-pi/command-policy — a Pi extension factory that allows only configured
 * shell command invocations via the bash tool.
 *
 * The default export builds the extension from a list of policy entries:
 *
 *   import createCommandPolicyExtension from "@vt-pi/command-policy";
 *   export default createCommandPolicyExtension({ entries: [...] });
 *
 * CommandPolicyEntry, the predicates (isPythonCommand, …), and the matching
 * primitives (matchesEntry, findBannedFlag, …) needed to build and test
 * entries are deliberately not re-exported here — importing them through
 * this barrel would pull in extension.ts's @mariozechner/pi-coding-agent
 * dependency. Import them from their own subpaths instead: ./types.ts,
 * ./predicates.ts, ./matching.ts.
 */

export { createCommandPolicyExtension as default, type CommandPolicyOptions } from "./extension.ts";
