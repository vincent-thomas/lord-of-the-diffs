/**
 * No Awk Extension
 *
 * Blocks any bash tool call that executes awk (or its variants).
 * This covers:
 *   - `awk '...'`                  inline script
 *   - `awk -f script.awk`          running a script file
 *   - `gawk`, `mawk`, `nawk`       awk variants
 *   - `env awk …` / `/usr/bin/awk …`
 *   - the same anywhere in a pipeline or command substitution
 *
 * Returns an explaining message to the model when a call is blocked.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { findCommandUse, isAwkCommand } from "../lib/command-utils.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command ?? "";
		const hit = findCommandUse(command, isAwkCommand);
		if (!hit) return;

		if (ctx.hasUI) {
			ctx.ui.notify("🚫 Blocked awk execution.", "warning");
		}

		return {
			block: true,
			reason:
				`awk execution is not allowed (blocked: \`${hit.segment}\`). ` +
				`This covers \`awk\`, \`gawk\`, \`mawk\`, \`nawk\`, inline scripts, ` +
				`script files (\`awk -f\`), and \`env awk …\`. ` +
				`Use the \`read\` tool with offset/limit parameters to read specific lines, ` +
				`or prefer simpler bash tools like \`head\`, \`tail\`, \`wc\`, or \`grep\`.`,
		};
	});
}
