/**
 * Folder Protector Extension
 *
 * Blocks the write and edit Pi tools from targeting files inside banned
 * folders (e.g. .git/). Folder names are configured in
 * ../../lib/folder-guard.ts's BANNED_FOLDERS list.
 *
 * Bash commands that target banned folder paths (cp, mv, rm, tee, …) are
 * blocked by the command-policy extension's "protected folder" entry
 * instead, using the same BANNED_FOLDERS list and isPathInsideBannedFolder
 * check — see ../command-policy/logic.ts.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { BANNED_FOLDERS, isPathInsideBannedFolder } from "../../lib/folder-guard.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const toolType = isToolCallEventType("write", event)
			? "write"
			: isToolCallEventType("edit", event)
				? "edit"
				: null;
		if (!toolType) return;

		const filePath: string | undefined = event.input.path;
		if (!filePath || !isPathInsideBannedFolder(filePath, BANNED_FOLDERS)) return;

		if (ctx.hasUI) {
			ctx.ui.notify(`✋ Cannot ${toolType} "${filePath}" — protected folder.`, "warning");
		}
		return {
			block: true,
			reason:
				`Cannot ${toolType} "${filePath}" — this path is inside a protected folder. ` +
				`Files inside these directories should not be modified directly.`,
		};
	});
}
