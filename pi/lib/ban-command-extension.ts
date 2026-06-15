/**
 * ban-command-extension.ts — Factory for creating command-blocking extensions.
 *
 * Creates an extension that blocks a specific command (or family of commands)
 * from being executed via the bash tool.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { findCommandUse } from "./command-utils.ts";

export interface BanCommandConfig {
	/** Display name for the command (e.g., "Python", "Perl", "awk") */
	name: string;
	/** Emoji for the notification (e.g., "🐍", "🐪", "🚫") */
	emoji: string;
	/** Predicate function that returns true if a command should be blocked */
	matcher: (cmd: string) => boolean;
	/** Detailed explanation message shown when a command is blocked */
	reason: string;
}

/**
 * Create an extension that blocks execution of one or more commands.
 */
export function createBanCommandExtension(
	configs: BanCommandConfig | BanCommandConfig[],
) {
	const configArray = Array.isArray(configs) ? configs : [configs];

	return function (pi: ExtensionAPI) {
		pi.on("tool_call", async (event, ctx) => {
			if (!isToolCallEventType("bash", event)) return;

			const command = event.input.command ?? "";

			// Check each configured command ban
			for (const config of configArray) {
				const hit = findCommandUse(command, config.matcher);
				if (!hit) continue;

				if (ctx.hasUI) {
					ctx.ui.notify(`${config.emoji} Blocked ${config.name} execution.`, "warning");
				}

				return {
					block: true,
					reason:
						`${config.name} execution is not allowed (blocked: \`${hit.segment}\`). ` +
						config.reason,
				};
			}
		});
	};
}
