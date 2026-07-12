/**
 * Build the initial prompt for the code-writing agent.
 * Combines plan context, task details, and commit instructions.
 */
import type { Plan, PlanTask } from "./types.ts";
import { execSync } from "node:child_process";

/**
 * Extract first complete sentence from text.
 */
function extractFirstSentence(text: string): string {
	const match = text.match(/^[^.!?]+[.!?]/);
	return match ? match[0].trim() : text.split("\n")[0];
}

/**
 * Get commit information for a specific commit index (0-based from HEAD).
 */
function getCommitInfo(
	cwd: string,
	index: number,
): { hash: string; files: string } | null {
	try {
		// Get the Nth most recent commit hash
		const hash = execSync(`git log --format=%h --skip=${index} -n1`, {
			cwd,
			encoding: "utf-8",
		}).trim();

		if (!hash) return null;

		// Get files changed in that commit
		const files = execSync(`git show --name-only --format= ${hash}`, {
			cwd,
			encoding: "utf-8",
		}).trim();

		return { hash, files };
	} catch {
		return null;
	}
}

/**
 * Build the task implementation prompt.
 */
export function buildTaskPrompt(
	plan: Plan,
	task: PlanTask,
	taskIndex: number,
	cwd: string,
): string {
	const totalTasks = plan.tasks.length;
	const previousTasks = plan.tasks.slice(0, taskIndex);

	// Build previous tasks section
	let previousSection = "";
	if (previousTasks.length > 0) {
		previousSection = `
## Previous Tasks Completed

${previousTasks
	.map((t, i) => {
		const commitInfo = getCommitInfo(cwd, previousTasks.length - i - 1);
		const filesInfo = commitInfo
			? `\n   Files: ${commitInfo.files.split("\n").join(", ")}\n   Commit: ${commitInfo.hash}`
			: "";
		return `${i + 1}. ${t.title}${filesInfo}`;
	})
	.join("\n\n")}

These tasks are already committed. Build on their changes.
`;
	}

	// Build acceptance criteria as checklist
	const acceptanceLines = task.acceptance
		.split(/[.\n]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	const acceptanceChecklist = acceptanceLines
		.map((line) => `- [ ] ${line}`)
		.join("\n");

	// Extract plan motivation for the commit message
	const planMotivation = extractFirstSentence(plan.why);

	return `
# Implementation Task ${taskIndex + 1}/${totalTasks}

## Overall Goal

**What:** ${plan.what}

**Why:** ${plan.why}
${previousSection}
## Your Task: ${task.title}

**Goal:** ${task.goal}

**Acceptance Criteria:**
${acceptanceChecklist}

**Constraints:** ${task.constraints}

## Instructions

1. **Read first** — Understand the current codebase state before making changes
2. **Implement** — Make the changes described in "Goal"
3. **Verify** — Ensure all acceptance criteria are satisfied
4. **Commit** — Use the \`commit_task\` tool with this structure:

\`\`\`
commit_task({
  subject: "${task.title}",
  what: "[2-3 sentences describing the concrete changes you made]",
  why: "${planMotivation} [add task-specific context if needed]"
})
\`\`\`

5. **Stop** — After committing, your session ends. Do NOT continue.

## Commit Message Guidelines

**What:** Describe your actual implementation
- Be specific about functions, classes, files modified
- Include important details: defaults, edge cases, tradeoffs
- Example: "Adds validateEmail() and validatePassword() to utils/validation.ts. LoginForm component calls them on blur. Returns user-friendly error messages."

**Why:** Explain the motivation
- Start with: "${planMotivation}"
- Add task-specific context if relevant
- Focus on the problem solved
- Example: "${planMotivation} This catches invalid credentials before form submission."

---

Begin implementing. Read the relevant code first.
`.trim();
}
