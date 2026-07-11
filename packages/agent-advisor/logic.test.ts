import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ADVISOR_TURNS, buildAdvicePrompt, formatAdviceResult, hasExceededTurnLimit } from "./logic.ts";

test("buildAdvicePrompt embeds the query and states the read-only constraint", () => {
	const prompt = buildAdvicePrompt("why does the retry loop for CI polling never terminate?");
	assert.match(prompt, /why does the retry loop for CI polling never terminate\?/);
	assert.match(prompt, /read-only/i);
	assert.match(prompt, /cannot write, edit, or run/i);
});

test("buildAdvicePrompt steers broad searches to explore and precise reads to read/grep", () => {
	const prompt = buildAdvicePrompt("track down the source of the flaky test");
	assert.match(prompt, /\bexplore\b/);
	assert.match(prompt, /read\/grep\/find\/ls/);
	// The delegation rationale — keep raw search churn out of this session.
	assert.match(prompt, /distilled|churn/i);
});

test("formatAdviceResult returns the text unchanged when present", () => {
	assert.equal(formatAdviceResult("Root cause: off-by-one in foo.ts:12"), "Root cause: off-by-one in foo.ts:12");
});

test("formatAdviceResult falls back when the sub-agent returned nothing", () => {
	assert.equal(
		formatAdviceResult(undefined),
		"The advisor did not return a recommendation.",
	);
	assert.equal(
		formatAdviceResult("   "),
		"The advisor did not return a recommendation.",
	);
});

test("hasExceededTurnLimit trips at the configured cap", () => {
	assert.equal(hasExceededTurnLimit(MAX_ADVISOR_TURNS - 1), false);
	assert.equal(hasExceededTurnLimit(MAX_ADVISOR_TURNS), true);
});
