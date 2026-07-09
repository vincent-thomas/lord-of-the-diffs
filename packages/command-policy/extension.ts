/**
 * extension.ts — builds a Pi extension that allows only configured shell
 * command invocations via the bash tool. Rules can match commands,
 * subcommands, and banned flags.
 *
 * This file is pure Pi wiring: the actual policy decision (which violation,
 * if any, and what to say about it) lives in evaluateCommand (matching.ts),
 * which has no Pi dependency and is tested directly there.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { CommandPolicyEntry } from "./types.ts";
import { evaluateCommand } from "./matching.ts";

export interface CommandPolicyOptions {
	entries: CommandPolicyEntry[];
}

export function createCommandPolicyExtension(options: CommandPolicyOptions) {
	return function (pi: ExtensionAPI) {
		pi.on("tool_call", async (event, ctx) => {
			if (!isToolCallEventType("bash", event)) return;

			const command = event.input.command ?? "";
			const violation = evaluateCommand(command, options.entries);
			if (!violation) return;

			if (ctx.hasUI) ctx.ui.notify(violation.notify, "warning");
			return { block: true, reason: violation.reason };
		});
	};
}
