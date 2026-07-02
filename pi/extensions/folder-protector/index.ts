/**
 * Folder Protector Extension
 *
 * Blocks any Pi tool from writing to or editing files inside banned folders
 * (e.g. .git/). Folder names are configured in logic.ts's BANNED_FOLDERS list.
 *
 * Blocked tools:
 *   - write (creating or overwriting files in banned folders)
 *   - edit (modifying files in banned folders)
 *   - bash (commands that write to banned folder paths, e.g. cp, mv, rm)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { BANNED_FOLDERS, isPathInsideBannedFolder, findBannedFolderTarget } from "./logic.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// Block write/edit tools targeting banned folder paths
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const toolType = isToolCallEventType("write", event) ? "write" : "edit";
			const filePath: string | undefined = event.input.path;

			if (filePath && isPathInsideBannedFolder(filePath, BANNED_FOLDERS)) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`✋ Cannot ${toolType} "${filePath}" — protected folder.`,
						"warning",
					);
				}
				return {
					block: true,
					reason:
						`Cannot ${toolType} "${filePath}" — this path is inside a protected folder. ` +
						`Files inside these directories should not be modified directly.`, 				};
			}
			return;
		}

		// Block bash commands that target banned folders with file-manipulation tools
		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			const match = findBannedFolderTarget(command, BANNED_FOLDERS);
			if (match) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`🚫 Blocked shell command targeting protected folder: ${match}`,
						"warning",
					);
				}
				return {
					block: true,
					reason:
						`Shell commands that manipulate files inside protected folders are not allowed. ` +
						`The path "${match}" is inside a protected directory.`, 				};
			}
			return;
		}
	});
}
