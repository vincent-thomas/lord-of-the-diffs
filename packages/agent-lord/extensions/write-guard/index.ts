/**
 * Write Guard Extension
 *
 * Blocks the `write` tool from overwriting existing files that are above a
 * line threshold. Forces the agent to use `edit` instead, which is safer
 * because it requires matching exact text and can't silently drop content.
 *
 * Also blocks both `write` and `edit` on Makefiles — the Makefile defines the
 * project's validation contract and should only be changed intentionally by
 * the user.
 *
 * New files (that don't exist yet) are always allowed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMakefile, checkFileTooLarge, makefileBlockReason } from "./logic.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// Determine which tool is being called.
		const toolType = isToolCallEventType("write", event)
			? "write"
			: isToolCallEventType("edit", event)
				? "edit"
				: null;

		if (!toolType) return;

		const filePath = event.input.path;
		if (!filePath) return;

		// Block any modification to Makefile — it defines the project's validation contract.
		if (isMakefile(filePath)) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`✋ Cannot modify Makefile — ask the user to change it if needed.`,
					"warning",
				);
			}
			return {
				block: true,
				reason: makefileBlockReason(toolType, filePath),
			};
		}

		// For write tool only: guard against overwrites of large existing files.
		if (toolType !== "write") return;

		const absolute = resolve(ctx.cwd, filePath);
		if (!existsSync(absolute)) return; // new file — allow

		let content: string;
		try {
			content = readFileSync(absolute, "utf-8");
		} catch {
			return; // can't read — let write proceed
		}

		const blockReason = checkFileTooLarge(filePath, content);
		if (!blockReason) return; // small enough — allow

		if (ctx.hasUI) {
			ctx.ui.notify(
				`✋ Blocked overwrite of ${filePath} (too large). Use edit instead.`,
				"warning",
			);
		}

		return { block: true, reason: blockReason };
	});
}
