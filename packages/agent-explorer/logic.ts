/**
 * logic.ts — pure helpers for the explore sub-agent. No Pi imports: the SDK
 * wiring (createAgentSession, tool registration) lives in index.ts.
 */

/** Safety net for a runaway exploration loop — the SDK exposes no maxTurns option. */
export const MAX_EXPLORE_TURNS = 15;

export function hasExceededTurnLimit(turnCount: number): boolean {
	return turnCount >= MAX_EXPLORE_TURNS;
}

export function buildExplorePrompt(query: string): string {
	return [
		"You are a read-only code exploration assistant. You ONLY answer factual",
		"location queries: where code is, what files exist, what imports what.",
		"",
		"You can use: read, grep, find, ls",
		"You CANNOT: write, edit, run shell commands, OR reason about code quality.",
		"",
		"STRICT RULES:",
		"- Answer ONLY factual queries: 'where is X', 'what files handle Y', 'does Z exist'",
		"- REFUSE analysis/reasoning tasks: finding gaps, identifying TODOs, judging quality,",
		"  suggesting improvements, analyzing edge cases, or any task requiring judgment.",
		"- If asked to analyze or reason, respond: 'I only answer factual location queries.",
		"  Use read/grep/find directly for analysis tasks.'",
		"- Give file:line references for concrete locations.",
		"- No preamble, no restating the question, no narration of your steps.",
		"",
		`Query: ${query}`,
	].join("\n");
}

export function formatExploreResult(text: string | undefined): string {
	if (!text || text.trim().length === 0) {
		return "The exploration sub-agent did not return an answer.";
	}
	return text;
}
