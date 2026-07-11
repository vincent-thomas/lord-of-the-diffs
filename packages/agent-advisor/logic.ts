/**
 * logic.ts — pure helpers for the advisor sub-agent. No Pi imports: the SDK
 * wiring (createAgentSession, tool registration) lives in index.ts.
 */

/** Safety net for a runaway consult loop — the SDK exposes no maxTurns option. */
export const MAX_ADVISOR_TURNS = 20;

export function hasExceededTurnLimit(turnCount: number): boolean {
	return turnCount >= MAX_ADVISOR_TURNS;
}

export function buildAdvicePrompt(query: string): string {
	return [
		"You are a senior engineering advisor, consulted by another agent that is",
		"stuck — repeated failures, an ambiguous approach, or a hard-to-diagnose bug.",
		"You have read-only access to the repository to verify claims and inspect",
		"relevant code yourself — you cannot write, edit, or run shell commands. Two",
		"ways to look at the code, and using the right one keeps your context lean:",
		"- read/grep/find/ls: read exact bytes yourself when you need precise detail",
		"  — a specific function, line, or value — to pin down the problem.",
		"- explore: delegate broad or multi-file searches ('where is X', 'how does Y",
		"  flow', 'find everything that touches Z') to this cheaper sub-agent, which",
		"  returns a distilled answer so the raw search churn never enters your",
		"  context. Prefer it over many raw grep/find calls of your own.",
		"",
		"Diagnose the problem and answer as concisely as possible:",
		"- Give a direct root cause if you can identify one, and the specific next",
		"  step(s) to take.",
		"- Don't restate the question, don't hedge with generic advice, no preamble.",
		"- If the problem is underspecified, say what's missing instead of guessing.",
		"",
		`Query: ${query}`,
	].join("\n");
}

export function formatAdviceResult(text: string | undefined): string {
	if (!text || text.trim().length === 0) {
		return "The advisor did not return a recommendation.";
	}
	return text;
}
