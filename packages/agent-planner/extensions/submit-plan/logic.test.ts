import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_PLAN_FILENAME,
	resolveOutputPath,
	serializePlan,
	validatePlan,
	type Plan,
} from "./logic.ts";

function task(overrides: Partial<Plan["tasks"][number]> = {}) {
	return {
		id: "T1",
		title: "Do the thing",
		goal: "Because reasons",
		acceptance: "Tests pass",
		files: "src/thing.ts",
		constraints: "none",
		dependsOn: [] as string[],
		specialist: "code-writer",
		...overrides,
	};
}

test("validatePlan accepts a well-formed plan", () => {
	const plan: Plan = { approach: "x", tasks: [task(), task({ id: "T2", dependsOn: ["T1"] })] };
	assert.deepEqual(validatePlan(plan), []);
});

test("validatePlan rejects an empty task list", () => {
	assert.deepEqual(validatePlan({ approach: "x", tasks: [] }), ["Plan has no tasks."]);
});

test("validatePlan flags empty and duplicate ids", () => {
	const errors = validatePlan({
		approach: "x",
		tasks: [task({ id: "  " }), task({ id: "T2" }), task({ id: "T2" })],
	});
	assert.ok(errors.some((e) => /empty id/.test(e)));
	assert.ok(errors.some((e) => /Duplicate task id: T2/.test(e)));
});

test("validatePlan flags unknown and self dependencies", () => {
	const errors = validatePlan({
		approach: "x",
		tasks: [task({ id: "T1", dependsOn: ["T9"] }), task({ id: "T2", dependsOn: ["T2"] })],
	});
	assert.ok(errors.some((e) => /T1 depends on unknown task T9/.test(e)));
	assert.ok(errors.some((e) => /T2 depends on itself/.test(e)));
});

test("serializePlan is stable, indented, newline-terminated JSON", () => {
	const out = serializePlan({ approach: "a", tasks: [task()] });
	assert.ok(out.endsWith("\n"));
	assert.equal(JSON.parse(out).tasks[0].id, "T1");
	assert.match(out, /\n {2}"approach"/);
});

test("resolveOutputPath honors an absolute env override", () => {
	assert.equal(resolveOutputPath("/tmp/out.json", "/repo"), "/tmp/out.json");
});

test("resolveOutputPath anchors a relative override at cwd", () => {
	assert.equal(resolveOutputPath("plans/p.json", "/repo"), "/repo/plans/p.json");
});

test("resolveOutputPath falls back to the default filename under cwd", () => {
	assert.equal(resolveOutputPath(undefined, "/repo"), `/repo/${DEFAULT_PLAN_FILENAME}`);
	assert.equal(resolveOutputPath("   ", "/repo"), `/repo/${DEFAULT_PLAN_FILENAME}`);
});
