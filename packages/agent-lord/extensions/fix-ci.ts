/**
 * fix-ci extension
 *
 * Wires the `push_and_check_ci` tool from @vt-pi/fix-ci — pushes code, opens
 * a draft PR, polls GitHub checks until they finish, and returns results with
 * failure logs. Tracks fix cycles and tells the agent to stop after the
 * attempt limit.
 *
 * Manual `git push` in bash is blocked by the command-policy extension
 * (its `entries` array bans the "git push" subcommand), not here.
 */
import { createFixCiExtension } from "@vt-pi/fix-ci";

export default createFixCiExtension();
