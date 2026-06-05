import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";

/**
 * Self-feedback extension.
 *
 * When an agent run produces patch-review-style findings (🔴 / 🟡 lines),
 * a follow-up user message is sent asking the agent to:
 *   1. Filter the findings — keep only those that improve general agent
 *      operation, not project/language-specific implementation details.
 *   2. Open a PR to vincent-thomas/vt-pi updating self-feedback.md.
 *   3. Prune the file if it has grown redundant or long.
 *
 * On every subsequent session/turn the current self-feedback.md from the
 * repo's main branch is fetched via `gh api` and injected into the system
 * prompt as things to actively think about while working.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const FEEDBACK_REPO = "vincent-thomas/vt-pi";
const FEEDBACK_FILE = "self-feedback.md";
const CLONE_DIR = "/tmp/vt-pi-self-feedback";

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

/**
 * Fetch the current self-feedback.md from the repo's main branch via `gh api`.
 * Returns an empty string if the file doesn't exist yet or can't be reached.
 */
function fetchFeedbackFromGitHub(): string {
  try {
    const json = execSync(
      `gh api repos/${FEEDBACK_REPO}/contents/${FEEDBACK_FILE}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const parsed = JSON.parse(json) as { content: string };
    return Buffer.from(parsed.content, "base64").toString("utf-8").trim();
  } catch {
    return ""; // File doesn't exist yet, or no network / gh auth
  }
}

function buildTaskMessage(findings: string[]): string {
  const findingLines = findings.map((f) => `- ${f}`).join("\n");
  const today = new Date().toISOString().slice(0, 10);
  const branch = `self-feedback/${today}`;

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
    `2. **Open a PR** to \`${FEEDBACK_REPO}\` with the findings worth keeping:\n\n` +
    `   a. Clone (or refresh) the repo:\n` +
    `      \`\`\`\n` +
    `      rm -rf ${CLONE_DIR} && gh repo clone ${FEEDBACK_REPO} ${CLONE_DIR}\n` +
    `      \`\`\`\n\n` +
    `   b. Create a branch and update the file:\n` +
    `      \`\`\`\n` +
    `      cd ${CLONE_DIR}\n` +
    `      git checkout -b ${branch}\n` +
    `      \`\`\`\n` +
    `      Append the curated findings to \`${FEEDBACK_FILE}\` ` +
    `(create the file if it does not exist yet; **never overwrite** existing content — ` +
    `use the \`edit\` tool if the file exists). ` +
    `Use this format:\n` +
    `      \`\`\`\n` +
    `      ### ${today}\n` +
    `      - 🔴 **When** [scenario]: make sure [what to verify or think about].\n` +
    `      - 🟡 **When** [scenario]: make sure [what to verify or think about].\n` +
    `      \`\`\`\n\n` +
    `   c. **Prune if necessary**: If the file now exceeds ~15 entries total, ` +
    `rewrite it keeping only the highest-quality, most general findings — ` +
    `merge near-duplicates and drop weak ones.\n\n` +
    `   d. Commit, push, and open the PR:\n` +
    `      \`\`\`\n` +
    `      cd ${CLONE_DIR}\n` +
    `      git add ${FEEDBACK_FILE}\n` +
    `      git commit -m "self-feedback: ${today}"\n` +
    `      git push -u origin ${branch}\n` +
    `      gh pr create --title "self-feedback: ${today}" --body "Curated from patch-review findings." --repo ${FEEDBACK_REPO}\n` +
    `      \`\`\`\n\n` +
    `Detected findings:\n${findingLines}`
  );
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Guard: skip the agent_end that fires for our own task message.
  let awaitingFeedbackRun = false;

  // Cache the fetched feedback for the lifetime of the session so we don't
  // hit the GitHub API on every agent turn.
  let sessionFeedback: string | null = null;

  function getFeedback(): string {
    if (sessionFeedback === null) {
      sessionFeedback = fetchFeedbackFromGitHub();
    }
    return sessionFeedback;
  }

  // ── 1. Notify on session start if feedback exists ──────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionFeedback = null; // Re-fetch at the start of each session.
    const content = getFeedback();
    if (content) {
      ctx.ui.notify("📋 Self-feedback from past patch reviews is active.", "info");
    }
  });

  // ── 2. Inject feedback into every agent turn's system prompt ───────────────
  pi.on("before_agent_start", async (event, _ctx) => {
    const content = getFeedback();
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

  // ── 3. Detect findings and delegate curation + PR to the agent ─────────────
  pi.on("agent_end", async (event, _ctx) => {
    // Skip the run that was triggered by our own task message.
    if (awaitingFeedbackRun) {
      awaitingFeedbackRun = false;
      return;
    }

    const text = extractAssistantText(event.messages as LooseAgentMessage[]);
    const findings = extractFindings(text);
    if (findings.length === 0) return;

    awaitingFeedbackRun = true;
    pi.sendUserMessage(buildTaskMessage(findings));
  });
}
