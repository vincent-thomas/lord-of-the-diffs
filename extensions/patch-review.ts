import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { resolve, relative } from "node:path";

/**
 * Automatically runs the patch-review skill after any agent turn that
 * performs a medium-or-larger patch (at least MUTATION_THRESHOLD successful
 * edit/write tool calls) **within the current project directory**.
 *
 * Mutations to files outside cwd (e.g. ~/.pi/agent/extensions/) are NOT
 * counted — they are not part of the project being reviewed.
 *
 * The skill itself is read-only, so it won't re-trigger the extension.
 */

const MUTATION_THRESHOLD = 3;

/** Returns true if filePath resolves to somewhere inside cwd. */
function isInsideCwd(filePath: string, cwd: string): boolean {
  // Some models prepend a leading @ — strip it (see pi tool docs).
  const clean = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  const abs = resolve(cwd, clean);
  const rel = relative(cwd, abs);
  // relative() returns a path starting with ".." when abs is outside cwd.
  return rel !== "" && !rel.startsWith("..");
}

export default function (pi: ExtensionAPI) {
  let mutationCount = 0;

  // toolCallId → whether the target file is inside the project cwd.
  // Populated on tool_call, consumed on tool_execution_end.
  const pendingInProject = new Map<string, boolean>();

  // Reset counter at the start of each agent run.
  pi.on("agent_start", async (_event, _ctx) => {
    mutationCount = 0;
    pendingInProject.clear();
  });

  // Record whether each edit/write targets a file inside the project.
  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("edit", event)) {
      pendingInProject.set(
        event.toolCallId,
        isInsideCwd(event.input.path ?? "", ctx.cwd)
      );
    } else if (isToolCallEventType("write", event)) {
      pendingInProject.set(
        event.toolCallId,
        isInsideCwd(event.input.path ?? "", ctx.cwd)
      );
    }
  });

  // Count only successful mutations that landed inside the project.
  pi.on("tool_execution_end", async (event, _ctx) => {
    if (event.toolName === "edit" || event.toolName === "write") {
      const inProject = pendingInProject.get(event.toolCallId) ?? false;
      pendingInProject.delete(event.toolCallId);

      if (!event.isError && inProject) {
        mutationCount++;
      }
    }
  });

  // After the agent finishes, fire the review if the patch was medium/large.
  pi.on("agent_end", async (_event, _ctx) => {
    if (mutationCount >= MUTATION_THRESHOLD) {
      pi.sendUserMessage("/skill:patch-review");
    }
  });
}
