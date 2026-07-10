/**
 * exec-async.test.ts — tests for execAsync's buffering, abort, and error behavior.
 *
 * Run with:   node --test exec-async.test.ts
 */
import assert from "node:assert/strict";
import { test, suite } from "node:test";
import { execAsync, extractErrorOutput } from "./exec-async.ts";

suite("execAsync", () => {
	test("resolves with stdout/stderr on success", async () => {
		const { stdout, stderr } = await execAsync("node -e \"process.stdout.write('out'); process.stderr.write('err')\"", {});
		assert.equal(stdout, "out");
		assert.equal(stderr, "err");
	});

	test("rejects with stdout/stderr attached on non-zero exit", async () => {
		await assert.rejects(
			execAsync("node -e \"process.stdout.write('partial'); process.exit(1)\"", {}),
			(err: any) => {
				assert.equal(err.stdout, "partial");
				return true;
			},
		);
	});

	test("rejects immediately when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(execAsync("echo hi", { signal: controller.signal }));
	});

	// node:child_process.exec defaults maxBuffer to 1MB and kills the child
	// (rather than truncating) once either stream exceeds it — a real risk for
	// callers like fix-ci's fetchRunLog, which fetches full CI logs that
	// routinely exceed 1MB. Guards against that default creeping back in.
	test("handles stdout well past node's default 1MB maxBuffer", async () => {
		const twoMb = 2 * 1024 * 1024;
		const { stdout } = await execAsync(
			`node -e "process.stdout.write('x'.repeat(${twoMb}))"`,
			{},
		);
		assert.equal(stdout.length, twoMb);
	});

	test("caller can still cap maxBuffer lower than the default", async () => {
		await assert.rejects(
			execAsync(`node -e "process.stdout.write('x'.repeat(${2 * 1024 * 1024}))"`, {
				maxBuffer: 1024,
			}),
		);
	});
});

suite("extractErrorOutput", () => {
	test("prefers stderr when present", () => {
		const err = Object.assign(new Error("boom"), { stdout: "out", stderr: "err" });
		assert.equal(extractErrorOutput(err), "err");
	});

	test("falls back to stdout when stderr is empty", () => {
		const err = Object.assign(new Error("boom"), { stdout: "out", stderr: "" });
		assert.equal(extractErrorOutput(err), "out");
	});

	test("falls back to String(err) for a plain non-Error value", () => {
		assert.equal(extractErrorOutput("just a string"), "just a string");
	});
});
