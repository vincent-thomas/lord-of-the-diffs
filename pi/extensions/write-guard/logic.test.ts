/**
 * logic.test.ts — tests for write-guard helpers.
 */

import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { baseName, isMakefile, checkFileTooLarge, makefileBlockReason, MAX_LINES } from "./logic.ts";

suite("write-guard — baseName");

const baseNameCases = [
	["file.txt", "file.txt"],
	["path/to/file.txt", "file.txt"],
	["/absolute/path/file.txt", "file.txt"],
	["no-ext", "no-ext"],
	["relative/", ""],
	["/", ""],
	["", ""],
] as const;

for (const [input, expected] of baseNameCases) {
	test(`baseName("${input}") → "${expected}"`, () => {
		assert.equal(baseName(input), expected);
	});
}

suite("write-guard — isMakefile");

const makefileMatches = [
	"Makefile",
	"makefile",
	"MAKEFILE",
	"MaKeFiLe",
	"path/to/Makefile",
	"/root/Makefile",
] as const;

for (const path of makefileMatches) {
	test(`isMakefile("${path}") → true`, () => {
		assert.ok(isMakefile(path));
	});
}

const makefileNonMatches = [
	"Makefile.am",
	"makefile.in",
	"src/main.rs",
	"readme.md",
	"path/to/not-a-makefile",
] as const;

for (const path of makefileNonMatches) {
	test(`isMakefile("${path}") → false`, () => {
		assert.ok(!isMakefile(path));
	});
}

suite("write-guard — checkFileTooLarge");

test("small file under threshold returns null", () => {
	assert.equal(checkFileTooLarge("test.txt", "line1\nline2\n", 5), null);
});

test("file exactly at threshold returns null", () => {
	const content = Array(10).fill("line").join("\n");
	assert.equal(checkFileTooLarge("test.txt", content, 10), null);
});

test("file over threshold returns block reason", () => {
	const content = Array(51).fill("line").join("\n");
	const reason = checkFileTooLarge("big.txt", content);
	assert.ok(reason !== null);
	assert.ok(reason!.includes("big.txt"));
	assert.ok(reason!.includes("51 lines"));
	assert.ok(reason!.includes("50"));
});

test("empty file returns null", () => {
	assert.equal(checkFileTooLarge("empty.txt", "", MAX_LINES), null);
});

test("single line file returns null", () => {
	assert.equal(checkFileTooLarge("one.txt", "hello", MAX_LINES), null);
});

test("uses default MAX_LINES when no threshold provided", () => {
	const content = Array(MAX_LINES + 1).fill("line").join("\n");
	const reason = checkFileTooLarge("large.txt", content);
	assert.ok(reason !== null);
	assert.ok(reason!.includes(`${MAX_LINES + 1} lines`));
});

suite("write-guard — makefileBlockReason");

test("includes tool type and file path in reason", () => {
	const reason = makefileBlockReason("write", "path/to/Makefile");
	assert.ok(reason.includes("write"));
	assert.ok(reason.includes("path/to/Makefile"));
	assert.ok(reason.includes("Makefile"));
	assert.ok(reason.includes("validation contract"));
});

test("works with edit tool type", () => {
	const reason = makefileBlockReason("edit", "Makefile");
	assert.ok(reason.includes("edit"));
	assert.ok(reason.includes("Makefile"));
});

suite("write-guard — MAX_LINES constant");

test("MAX_LINES is a positive number", () => {
	assert.ok(MAX_LINES > 0);
	assert.equal(typeof MAX_LINES, "number");
});
