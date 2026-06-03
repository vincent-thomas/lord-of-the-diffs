import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Self-feedback extension.
 *
 * When an agent run produces patch-review-style findings (🔴 / 🟡 lines),
 * a follow-up user message is sent asking the agent to:
 *   1. Filter the findings — keep only those that improve general agent
 *      operation, not project/language-specific implementation details.
 *   2. Append the keepers to <cwd>/.pi/self-feedback.md as proactive checks:
 *      each entry states WHEN a check applies and WHAT to make sure of.
 *   3. Prune the file if it has grown redundant or long.
 *
 * On every subsequent session/turn the accumulated checks are injected
 * into the system prompt as things to actively think about while working.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

type ContentBlock = { type?: string; text?: string };
type LooseAgentMessage = { role?: string; content?: unknown };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractAssistantText(messages: LooseAgentMessage[]): string {
  return messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => {
      const c = m.content;
      if (typeof c === "string") return [c];
      if (Array.isArray(c))
        return (c as ContentBlock[])
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string);
      return [];
    })
    .join("\n");
}

function extractFindings(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[🔴🟡]/.test(l));
}

function feedbackFilePath(cwd: string): string {
  return join(cwd, ".pi", "self-feedback.md");
}

function buildTaskMessage(findings: string[], feedbackFile: string): string {
  const findingLines = findings.map((f) => `- ${f}`).join("\n");

  return (
    `Patch-review findings were just detected. Please do the following:\n\n` +
    `1. **Filter**: For each finding below, decide if it belongs in self-feedback. ` +
    `A finding qualifies only if it describes a **general flaw in how you operate as a coding agent** ` +
    `— a reasoning or process mistake you could repeat in any project or codebase.\n\n` +
    `Apply this litmus test: *"Would this finding make sense to someone working on a Python web app, ` +
    `a Go CLI tool, and a Rust embedded library equally?"* ` +
    `If the answer is no — if understanding the finding requires knowing a specific protocol, ` +
    `library, language feature, framework, or domain — it is too specific and must be discarded.\n\n` +
    `If a finding has a general kernel but is currently phrased too specifically, ` +
    `rework it into domain-neutral language before keeping it. ` +
    `If it cannot be abstracted without losing its meaning, discard it.\n\n` +
    `Discard anything that is project-specific, domain-specific, language-specific, ` +
    `or already covered by this project's AGENTS.md / CLAUDE.md.\n\n` +
    `2. **Append**: Add the findings worth keeping to \`${feedbackFile}\`. ` +
    `**Never overwrite the file** — always append new content at the end of existing content. ` +
    `If the file does not exist yet, create it with only the new entries. ` +
    `If it already exists, use the \`edit\` tool to insert the new block at the end — ` +
    `do NOT use the \`write\` tool on an existing file, as that would erase prior entries.\n\n` +
    `Each entry must be a single line combining two parts: the scenario in which the check applies, ` +
    `and what to make sure of. ` +
    `Write it as a forward-looking reminder, not a description of what went wrong. ` +
    `Use this format:\n` +
    `   \`\`\`\n` +
    `   ### YYYY-MM-DD\n` +
    `   - 🔴 **When** [scenario]: make sure [what to verify or think about].\n` +
    `   - 🟡 **When** [scenario]: make sure [what to verify or think about].\n` +
    `   \`\`\`\n\n` +
    `3. **Prune if necessary**: After appending, re-read the full file. ` +
    `If it has grown redundant or large (more than ~15 entries total), ` +
    `rewrite it keeping only the highest-quality, most general findings — ` +
    `merge near-duplicates and drop weak ones.\n\n` +
    `Detected findings:\n${findingLines}`
  );
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Guard: skip the agent_end that fires for our own task message.
  let awaitingFeedbackRun = false;

  // ── 1. Notify on session start if feedback exists ──────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const feedbackFile = feedbackFilePath(ctx.cwd);
    if (!existsSync(feedbackFile)) return;
    const content = readFileSync(feedbackFile, "utf-8").trim();
    if (content) {
      ctx.ui.notify("📋 Self-feedback from past patch reviews is active.", "info");
    }
  });

  // ── 2. Inject feedback into every agent turn's system prompt ───────────────
  pi.on("before_agent_start", async (event, ctx) => {
    const feedbackFile = feedbackFilePath(ctx.cwd);
    if (!existsSync(feedbackFile)) return;
    const content = readFileSync(feedbackFile, "utf-8").trim();
    if (!content) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n---\n` +
        `## Self-Feedback: Proactive Checks\n\n` +
        `The following checks were derived from past patch reviews. ` +
        `Actively think about these while working — each one describes a scenario ` +
        `and what to make sure of before considering the work done:\n\n` +
        `${content}\n` +
        `---`,
    };
  });

  // ── 3. Detect findings and delegate curation to the agent ─────────────────
  pi.on("agent_end", async (event, ctx) => {
    // Skip the run that was triggered by our own task message.
    if (awaitingFeedbackRun) {
      awaitingFeedbackRun = false;
      return;
    }

    const text = extractAssistantText(event.messages as LooseAgentMessage[]);
    const findings = extractFindings(text);
    if (findings.length === 0) return;

    const feedbackFile = feedbackFilePath(ctx.cwd);
    // Ensure .pi/ exists so the agent can write without needing to create it.
    const dir = dirname(feedbackFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    awaitingFeedbackRun = true;
    pi.sendUserMessage(buildTaskMessage(findings, feedbackFile));
  });
}
