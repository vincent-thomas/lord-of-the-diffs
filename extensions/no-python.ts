/**
 * No Python Extension
 *
 * Blocks bash tool calls that execute inline Python code (e.g. `python3 -c "..."`).
 * Returns an explaining message to the model when a call is blocked.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// Matches `python -c` or `python3 -c` with optional flags in between,
// staying within the same shell command segment (no pipes/semicolons/newlines).
const INLINE_PYTHON_PATTERN = /\bpython3?\b[^|&;\n]*\s-c\b/;

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command ?? "";
		if (!INLINE_PYTHON_PATTERN.test(command)) return;

		if (ctx.hasUI) {
			ctx.ui.notify("🐍 Blocked inline Python execution.", "warning");
		}

		return {
			block: true,
			reason:
				"Inline Python execution is not allowed (e.g. `python3 -c '...'`). " +
				"Prefer to use other bash commands. For example when parsing json, use the 'jq' binary",
		};
	});
}
