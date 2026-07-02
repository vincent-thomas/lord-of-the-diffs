/**
 * startup-token extension
 *
 * Fires a GitHub App token refresh at pi startup so the token file is
 * ready before any git/gh commands are issued. The refresh runs
 * asynchronously and silently — if env vars aren't set (dev mode, or
 * user hasn't configured the app yet), it just logs a warning and
 * moves on. The token will be generated lazily on first tool use
 * via the git_commit / push_and_check_ci tool handlers.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { refreshAndWriteToken } from "../../lib/github-app-auth.ts";

export default function (pi: ExtensionAPI) {
	// Fire token refresh asynchronously during extension load.
	// Don't block startup — the tool handlers will also call
	// refreshAndWriteToken() before any git/gh operation.
	refreshAndWriteToken().catch((err: unknown) => {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[startup-token] Skipping token refresh: ${msg}`);
	});
}
