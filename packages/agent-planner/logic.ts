/**
 * logic.ts — pure helpers for the planner sub-agent. No Pi imports: the SDK
 * wiring (createAgentSession, tool registration) lives in index.ts.
 *
 * The prompt built here IS the planner's public contract: it defines the
 * shape of a single-piece task spec, the unit a downstream implementor
 * (e.g. agent-lord) turns into exactly one green commit. Keep it precise —
 * everything else in the system keys off this decomposition.
 */

/** Safety net for a runaway planning loop — the SDK exposes no maxTurns option. */
export const MAX_PLANNER_TURNS = 25;

export function hasExceededTurnLimit(turnCount: number): boolean {
	return turnCount >= MAX_PLANNER_TURNS;
}

export function buildPlanPrompt(request: string): string {
	return [
		"You are a planning agent. You decompose a feature request into an ordered",
		"set of single-piece implementation tasks for downstream code-writing agents.",
		"You have read-only access to the repository — you can read files, search,",
		"and delegate broad lookups to `explore` — but you DO NOT write code, edit",
		"files, or run shell commands. You produce a plan, not an implementation.",
		"",
		"Ground the plan in the actual codebase before decomposing:",
		"- explore: delegate broad or multi-file questions ('where does X live', 'how",
		"  does Y flow', 'what already handles Z') to this cheaper sub-agent, which",
		"  returns a distilled answer so raw search churn never enters your context.",
		"  Prefer it over many raw grep/find calls of your own.",
		"- read/grep/find/ls: read exact bytes yourself when you need a precise",
		"  detail — a specific signature, type, or existing pattern — to size a task.",
		"",
		"THE CORE RULE — every task must be a single piece of work:",
		"- Each task must be implementable as exactly ONE coherent commit: one logical",
		"  change, internally consistent, valid on its own.",
		"- If a task would need two independent commits, or touches unrelated areas,",
		"  split it into separate tasks. When in doubt, split.",
		"- Order tasks so each builds on landed ones: prep/refactor first, new",
		"  abstractions next, wiring/usage last. Express real ordering via `Depends on`.",
		"",
		"Output format — a short approach paragraph, then a numbered task list. For",
		"each task, use exactly these fields:",
		"  ### T<n>: <imperative one-line title>",
		"  - Goal: what changes and why (the intent, not step-by-step instructions)",
		"  - Acceptance: concrete, checkable criteria for done (tests pass, behavior X)",
		"  - Files/area: the files or module the change is expected to touch",
		"  - Constraints: what to avoid or preserve (don't touch X, match pattern Y)",
		"  - Depends on: comma-separated task IDs, or 'none'",
		"  - Specialist: which kind of agent should implement it (e.g. code-writer,",
		"    auth-auditor, cybersecurity) — default 'code-writer'",
		"",
		"Be concrete and lean. No preamble, no restating the request. If the request",
		"is too vague to decompose safely, say precisely what's missing instead of",
		"guessing.",
		"",
		`Request: ${request}`,
	].join("\n");
}

export function formatPlanResult(text: string | undefined): string {
	if (!text || text.trim().length === 0) {
		return "The planner did not return a plan.";
	}
	return text;
}
