import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PLANNER_TURNS, buildPlanPrompt, formatPlanResult, hasExceededTurnLimit } from "./logic.ts";

test("buildPlanPrompt embeds the request and states the read-only, plan-not-implement constraint", () => {
	const prompt = buildPlanPrompt("add rate limiting to the public API");
	assert.match(prompt, /add rate limiting to the public API/);
	assert.match(prompt, /read-only/i);
	assert.match(prompt, /DO NOT write code/);
	assert.match(prompt, /plan, not an implementation/);
});

test("buildPlanPrompt enforces the single-piece / one-commit rule and the task-spec fields", () => {
	const prompt = buildPlanPrompt("anything");
	assert.match(prompt, /exactly ONE coherent commit/);
	assert.match(prompt, /When in doubt, split/);
	// The task-spec contract fields downstream agents key off.
	for (const field of ["Goal:", "Acceptance:", "Files/area:", "Constraints:", "Depends on:", "Specialist:"]) {
		assert.match(prompt, new RegExp(field));
	}
});

test("buildPlanPrompt steers broad lookups to explore over raw search", () => {
	const prompt = buildPlanPrompt("anything");
	assert.match(prompt, /explore:/);
	assert.match(prompt, /Prefer it over many raw grep\/find calls/);
});

test("formatPlanResult returns the plan unchanged when present", () => {
	assert.equal(formatPlanResult("### T1: do the thing"), "### T1: do the thing");
});

test("formatPlanResult falls back when the sub-agent returned nothing", () => {
	assert.equal(formatPlanResult(undefined), "The planner did not return a plan.");
	assert.equal(formatPlanResult("   "), "The planner did not return a plan.");
});

test("hasExceededTurnLimit trips at the configured cap", () => {
	assert.equal(hasExceededTurnLimit(MAX_PLANNER_TURNS - 1), false);
	assert.equal(hasExceededTurnLimit(MAX_PLANNER_TURNS), true);
});
