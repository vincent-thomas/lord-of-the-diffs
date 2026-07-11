/**
 * fix-ci extension
 *
 * Wires the `push_and_check_ci` tool from @vt-pi/fix-ci — pushes code,
 * polls GitHub checks until they finish, returns results with failure
 * logs, and waits for review once CI is green.
 *
 * Manual `git push` in bash is blocked by the command-policy extension
 * (COMMAND_POLICY_ENTRIES bans the "git push" subcommand), not here.
 */
import createFixCiExtension from "@vt-pi/fix-ci";

export default createFixCiExtension();
