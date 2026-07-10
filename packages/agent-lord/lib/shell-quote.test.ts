/**
 * shell-quote.test.ts — tests for shellQuote.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { shellQuote } from "./shell-quote.ts";

test("wraps a plain value in single quotes", () => {
	assert.equal(shellQuote("main"), "'main'");
});

test("escapes an embedded single quote", () => {
	assert.equal(shellQuote("it's"), "'it'\\''s'");
});

test("neutralizes shell metacharacters when actually run by a shell", () => {
	const dangerous = ["; touch pwned", "$(touch pwned)", "`touch pwned`", "it's a $(trap)", "a && b || c"];
	for (const value of dangerous) {
		const out = execSync(`echo ${shellQuote(value)}`, { encoding: "utf-8" });
		assert.equal(out, value + "\n");
	}
});

test("round-trips an empty string", () => {
	const out = execSync(`echo -n ${shellQuote("")}`, { encoding: "utf-8" });
	assert.equal(out, "");
});
