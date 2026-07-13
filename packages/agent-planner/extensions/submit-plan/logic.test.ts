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
    title: "Do the thing",
    goal: "Because reasons",
    acceptance: "Tests pass",
    constraints: "none",
    ...overrides,
  };
}

test("validatePlan accepts a well-formed plan", () => {
  const plan: Plan = {
    what: "w",
    why: "y",
    branchName: "vt_test_feature",
    tasks: [task(), task({ title: "Second" })],
  };
  assert.deepEqual(validatePlan(plan), []);
});

test("validatePlan rejects an empty task list", () => {
  assert.deepEqual(validatePlan({ what: "w", why: "y", branchName: "vt_test", tasks: [] }), [
    "Plan has no tasks.",
  ]);
});

test("validatePlan flags a missing what or why", () => {
  const errors = validatePlan({ what: "  ", why: "", branchName: "vt_test", tasks: [task()] });
  assert.ok(errors.some((e) => /`what`/.test(e)));
  assert.ok(errors.some((e) => /`why`/.test(e)));
});

test("serializePlan is stable, indented, newline-terminated JSON", () => {
  const out = serializePlan({ what: "w", why: "y", branchName: "vt_test", tasks: [task()] });
  assert.ok(out.endsWith("\n"));
  assert.equal(JSON.parse(out).tasks[0].title, "Do the thing");
  assert.match(out, /\n {2}"what"/);
});

test("resolveOutputPath honors an absolute env override", () => {
  assert.equal(resolveOutputPath("/tmp/out.json", "/repo"), "/tmp/out.json");
});

test("resolveOutputPath anchors a relative override at cwd", () => {
  assert.equal(
    resolveOutputPath("plans/p.json", "/repo"),
    "/repo/plans/p.json",
  );
});

test("resolveOutputPath falls back to the default filename under cwd", () => {
  assert.equal(
    resolveOutputPath(undefined, "/repo"),
    `/repo/${DEFAULT_PLAN_FILENAME}`,
  );
  assert.equal(
    resolveOutputPath("   ", "/repo"),
    `/repo/${DEFAULT_PLAN_FILENAME}`,
  );
});

test("validatePlan rejects missing branchName", () => {
  const errors = validatePlan({ what: "w", why: "y", branchName: "", tasks: [task()] });
  assert.ok(errors.some((e) => /`branchName`/.test(e)));
});

test("validatePlan rejects invalid git ref names", () => {
  const invalidNames = ["foo..bar", "foo bar", "~foo", "foo^bar"];
  for (const name of invalidNames) {
    const errors = validatePlan({ what: "w", why: "y", branchName: name, tasks: [task()] });
    assert.ok(errors.length > 0, `Should reject invalid branch name: ${name}`);
  }
});

test("validatePlan accepts valid branch names", () => {
  const validNames = ["vt_add_feature", "feature-123", "bug/fix-thing"];
  for (const name of validNames) {
    const errors = validatePlan({ what: "w", why: "y", branchName: name, tasks: [task()] });
    assert.ok(!errors.some((e) => /branchName/.test(e)), `Should accept valid branch name: ${name}`);
  }
});
