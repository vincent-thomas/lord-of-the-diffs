/**
 * No Perl Extension
 *
 * Blocks any bash tool call that executes Perl, matching the Python ban.
 * This covers:
 *   - `perl -e "..."`             inline code
 *   - `perl script.pl`             running a script
 *   - `perl <<EOF … EOF`           heredocs
 *   - `env perl …` / `/usr/bin/perl …` / `perl5.38 …`
 *   - the same anywhere in a pipeline or command substitution
 *
 * Returns an explaining message to the model when a call is blocked.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { findCommandUse, isPerlCommand } from "../lib/command-utils.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command ?? "";
		const hit = findCommandUse(command, isPerlCommand);
		if (!hit) return;

		if (ctx.hasUI) {
			ctx.ui.notify("🐪 Blocked Perl execution.", "warning");
		}

		return {
			block: true,
			reason:
				`Perl execution is not allowed (blocked: \`${hit.segment}\`). ` +
				`This covers \`perl\`/\`perl5\`, \`-e\` snippets, running scripts, ` +
				`heredocs (\`perl <<EOF\`), and \`env perl …\`. ` +
				`Prefer other bash tools — for example, use \`jq\` to parse JSON.`,
		};
	});
}
