/**
 * extension.ts — builds a Pi extension that allows only configured shell
 * command invocations via the bash tool. Rules can match commands,
 * subcommands, and banned flags.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { CommandPolicyStatus, type CommandPolicyEntry } from "./types.ts";
import { getCommandUses, matchesEntry, findBannedFlag, findDisallowedFlag } from "./matching.ts";

export interface CommandPolicyOptions {
	entries: CommandPolicyEntry[];
}

/** Check if raw shell text contains `<<` outside of quotes. */
function hasHereDoc(text: string): boolean {
	let quote: "'" | '"' | null = null;
	let escape = false;
	for (let i = 0; i < text.length - 1; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (escape) { escape = false; continue; }
		if (ch === "\\") { escape = true; continue; }
		if (quote) { if (ch === quote) quote = null; continue; }
		if (ch === "'" || ch === '"') { quote = ch; continue; }
		// << or <<- outside quotes = here-doc
		if (ch === "<" && next === "<") {
			return true;
		}
	}
	return false;
}

export function createCommandPolicyExtension(options: CommandPolicyOptions) {
	return function (pi: ExtensionAPI) {
		pi.on("tool_call", async (event, ctx) => {
			if (!isToolCallEventType("bash", event)) return;

			// Notify the UI (if any) and return the block result — every rejection
			// path below reduces to this same shape.
			const deny = (notify: string, reason: string) => {
				if (ctx.hasUI) ctx.ui.notify(notify, "warning");
				return { block: true, reason };
			};

			const command = event.input.command ?? "";

			// Block here-docs entirely — they're not relevant for command policy.
			if (hasHereDoc(command)) {
				return deny(
					"🚫 Blocked here-doc (<<).",
					`Here-docs (<<) are not allowed. ` +
						`Use inline input or other methods instead. ` +
						`Blocked: \`${command.trim()}\``,
				);
			}
			for (const use of getCommandUses(command)) {
				if (use.obfuscated) {
					return deny(
						`🚫 Blocked disguised command.`,
						`Command name or flag is pointlessly quoted or backslash-escaped ` +
							`(blocked: \`${use.segment}\`) — e.g. \`"git"\`, \`\\-rf\`, or \`g""it\` run identically ` +
							`to \`git\` or \`-rf\` but hide from the command policy. Rewrite the command with the ` +
							`command name and flags written plainly, with no quotes or backslashes.`,
					);
				}

				const entry = options.entries.find((candidate) => matchesEntry(use, candidate));
				if (!entry) {
					return deny(
						`🚫 Blocked ${use.name}.`,
						`Command is not on the allow list (blocked: \`${use.segment}\`).`,
					);
				}

				if (entry.status === CommandPolicyStatus.Banned) {
					return deny(
						`🚫 Blocked ${entry.name}.`,
						`${entry.name} is banned (blocked: \`${use.segment}\`). ${entry.description ?? ""}`,
					);
				}

				const bannedFlag = findBannedFlag(use, entry);
				if (bannedFlag) {
					return deny(
						`🚫 Blocked ${entry.name} flag ${bannedFlag}.`,
						`Flag \`${bannedFlag}\` is not allowed for ${entry.name} (blocked: \`${use.segment}\`). ${entry.description ?? ""}`,
					);
				}

				const disallowedFlag = findDisallowedFlag(use, entry);
				if (disallowedFlag) {
					return deny(
						`🚫 Blocked ${entry.name} flag ${disallowedFlag}.`,
						`Flag \`${disallowedFlag}\` is not in the allowed flags for ${entry.name} ` +
							`(blocked: \`${use.segment}\`). Allowed flags: ${entry.allowedFlags?.join(", ")}. ` +
							`${entry.description ?? ""}`,
					);
				}

				const validationError = entry.validate?.(use);
				if (validationError) {
					return deny(
						`🚫 Blocked ${entry.name}.`,
						`${entry.name} is not allowed here (blocked: \`${use.segment}\`). ${validationError}`,
					);
				}
			}
		});
	};
}
