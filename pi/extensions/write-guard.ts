/**
 * Write Guard Extension
 *
 * Blocks the `write` tool from overwriting existing files that are above a
 * line threshold. Forces the agent to use `edit` instead, which is safer
 * because it requires matching exact text and can't silently drop content.
 *
 * New files (that don't exist yet) are always allowed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_LINES = 50;

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("write", event)) return;

		const filePath = event.input.path;
		if (!filePath) return;

		const absolute = resolve(ctx.cwd, filePath);
		if (!existsSync(absolute)) return; // new file — allow

		let lineCount: number;
		try {
			const content = readFileSync(absolute, "utf-8");
			lineCount = content.split("\n").length;
		} catch {
			return; // can't read — let write proceed
		}

		if (lineCount <= MAX_LINES) return; // small file — allow

		if (ctx.hasUI) {
			ctx.ui.notify(
				`✋ Blocked overwrite of ${filePath} (${lineCount} lines). Use edit instead.`,
				"warning",
			);
		}

		return {
			block: true,
			reason:
				`Cannot overwrite "${filePath}" — it has ${lineCount} lines (threshold: ${MAX_LINES}). ` +
				`Use the \`edit\` tool to make surgical changes instead. ` +
				`The \`write\` tool on large existing files risks silently dropping content.`,
		};
	});
}
