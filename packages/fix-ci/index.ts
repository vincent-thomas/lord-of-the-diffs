/**
 * @vt-pi/fix-ci — a Pi extension factory exposing the `push_and_check_ci`
 * tool: push, open a draft PR, poll CI, and wait for review.
 *
 * This is the package's only public entry point (see package.json's
 * "exports"), and createFixCiExtension is its only export:
 *
 *   import createFixCiExtension from "@vt-pi/fix-ci";
 *   export default createFixCiExtension();
 *
 * Everything else (extension.ts, logic.ts, and the self-contained
 * exec-async/git-utils/shell-quote copies) is private implementation.
 */

export { createFixCiExtension as default } from "./extension.ts";
