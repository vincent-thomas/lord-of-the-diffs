/**
 * predicates.test.ts — tests for @vt-pi/command-policy's language interpreter
 * command predicates.
 *
 * Lives in this extension (not in the @vt-pi/command-policy package itself)
 * — command-policy logic is tested from the side that consumes it.
 *
 * Run with:   node --test predicates.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { findCommandUse } from "@vt-pi/command-policy/command-utils.ts";
import { isAwkCommand, isPerlCommand, isPythonCommand } from "@vt-pi/command-policy/predicates.ts";

test("arguments are not treated as commands", () => {
	assert.equal(findCommandUse("echo awk", isAwkCommand), null);
	assert.equal(findCommandUse("printf python", isPythonCommand), null);
});

const predicateCases = [
	["python -c 'print(1)'", isPythonCommand, "python"],
	["python3.12 script.py", isPythonCommand, "python3.12"],
	["/usr/bin/python2 old.py", isPythonCommand, "python2"],
	["perl5.38 thing.pl", isPerlCommand, "perl5.38"],
	["gawk '{print}' file", isAwkCommand, "gawk"],
	["mawk '{print}' file", isAwkCommand, "mawk"],
] as const;

for (const [text, predicate, expected] of predicateCases) {
	test(`matches executable only: ${text}`, () => {
		assert.equal(findCommandUse(text, predicate)?.name, expected);
	});
}

const predicateNonMatches = [
	["echo python", isPythonCommand],
	["pythonize x", isPythonCommand],
	["echo perl", isPerlCommand],
	["perlbrew list", isPerlCommand],
	["echo awk", isAwkCommand],
	["awkward name", isAwkCommand],
] as const;

for (const [text, predicate] of predicateNonMatches) {
	test(`does not match argument/plain text: ${text}`, () => {
		assert.equal(findCommandUse(text, predicate), null);
	});
}
