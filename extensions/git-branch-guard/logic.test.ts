/**
 * logic.test.ts — tests for git-branch-guard helpers.
 *
 * Run with plain Node (no framework, no build step required):
 *
 *   node logic.test.ts
 *
 * Node v22+ strips TypeScript types natively so no tsx/ts-node needed.
 */
import assert from "node:assert/strict";
import {
  findBranchSwitchInText,
  findGitCommitInText,
  extractScriptPaths,
  isShellScript,
  isBranchSwitchLine,
  isGitCommitLine,
} from "./logic.ts";

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof assert.AssertionError ? err.message : String(err);
    console.error(`  ✗  ${name}\n       ${msg}`);
    failed++;
  }
}

function suite(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ---------------------------------------------------------------------------
// isBranchSwitchLine
// ---------------------------------------------------------------------------

suite("isBranchSwitchLine — blocked", () => {
  const cases = [
    "git checkout main",
    "git checkout feature/foo",
    "git checkout -b new-branch",
    "git checkout -B hotfix",
    "git switch main",
    "git switch -c new-branch",
    "git switch -C new-branch",
    "git switch --create new-branch",
    "git switch develop",
    "sudo git checkout main",
    "sudo -n git switch develop",
  ];
  for (const c of cases) {
    test(JSON.stringify(c), () => assert.ok(isBranchSwitchLine(c)));
  }
});

suite("isBranchSwitchLine — allowed (no branch change)", () => {
  const cases = [
    "git checkout -- src/main.rs",
    "git checkout -- .",
    "git checkout -p",
    "git restore src/main.rs",
    "git restore --staged .",
    "git status",
    "echo git checkout main",  // not actually a git command
  ];
  for (const c of cases) {
    test(JSON.stringify(c), () => assert.ok(!isBranchSwitchLine(c)));
  }
});

// ---------------------------------------------------------------------------
// findBranchSwitchInText
// ---------------------------------------------------------------------------

suite("findBranchSwitchInText — blocked", () => {
  test("single-line checkout", () =>
    assert.ok(findBranchSwitchInText("git checkout main") !== null));

  test("single-line switch", () =>
    assert.ok(findBranchSwitchInText("git switch main") !== null));

  test("branch switch inside multi-line script body", () => {
    const script = `#!/bin/bash\necho hello\ngit checkout feature\necho done`;
    assert.ok(findBranchSwitchInText(script) !== null);
  });

  test("returns the offending line trimmed", () => {
    const result = findBranchSwitchInText("  git checkout feature  ");
    assert.equal(result, "git checkout feature");
  });
});

suite("findBranchSwitchInText — allowed", () => {
  test("file restore checkout", () =>
    assert.equal(findBranchSwitchInText("git checkout -- src/main.rs"), null));

  test("patch checkout", () =>
    assert.equal(findBranchSwitchInText("git checkout -p"), null));

  test("git restore", () =>
    assert.equal(findBranchSwitchInText("git restore ."), null));

  test("commented-out checkout is ignored", () =>
    assert.equal(findBranchSwitchInText("# git checkout main"), null));

  test("unrelated command", () =>
    assert.equal(findBranchSwitchInText("cargo build --release"), null));

  test("clean multi-line script", () => {
    const script = `#!/bin/bash\nset -e\ncargo test\ngit add .\ngit commit -m "wip"`;
    assert.equal(findBranchSwitchInText(script), null);
  });
});

suite("findBranchSwitchInText — compound commands", () => {
  test("git checkout after && on same line", () =>
    assert.ok(findBranchSwitchInText("cd /repo && git checkout main") !== null));

  test("git checkout after ; on same line", () =>
    assert.ok(findBranchSwitchInText("echo hi; git checkout main") !== null));

  test("git checkout after || on same line", () =>
    assert.ok(findBranchSwitchInText("false || git checkout main") !== null));

  test("multi-step compound: cd && add && checkout", () =>
    assert.ok(
      findBranchSwitchInText("cd /repo && git add . && git checkout feature") !== null
    ));

  test("compound with only safe git commands passes", () =>
    assert.equal(
      findBranchSwitchInText("cd /repo && git add . && git commit -m 'wip'"),
      null
    ));
});

// ---------------------------------------------------------------------------
// isGitCommitLine
// ---------------------------------------------------------------------------

suite("isGitCommitLine — matched", () => {
  const cases = [
    "git commit",
    "git commit -m 'msg'",
    'git commit -m "msg"',
    "git commit --amend",
    "git commit --amend --no-edit",
    "git commit -a -m 'all'",
    "sudo git commit -m 'msg'",
  ];
  for (const c of cases) {
    test(JSON.stringify(c), () => assert.ok(isGitCommitLine(c)));
  }
});

suite("isGitCommitLine — not matched", () => {
  const cases = [
    "git add .",
    "git push origin main",
    "git status",
    "echo git commit",
    "# git commit -m 'skip'",
  ];
  for (const c of cases) {
    test(JSON.stringify(c), () => assert.ok(!isGitCommitLine(c)));
  }
});

// ---------------------------------------------------------------------------
// findGitCommitInText
// ---------------------------------------------------------------------------

suite("findGitCommitInText — detected", () => {
  test("bare git commit", () =>
    assert.ok(findGitCommitInText("git commit -m 'wip'") !== null));

  test("git commit in multi-line script", () => {
    const script = "#!/bin/bash\ngit add .\ngit commit -m 'done'";
    assert.ok(findGitCommitInText(script) !== null);
  });

  test("git commit after && on same line", () =>
    assert.ok(
      findGitCommitInText("cd /repo && git add . && git commit -m 'msg'") !== null
    ));

  test("git commit after ; on same line", () =>
    assert.ok(findGitCommitInText("git add .; git commit -m 'msg'") !== null));

  test("compound: cd && add && commit — the real-world case", () =>
    assert.ok(
      findGitCommitInText(
        "cd /home/user/project && git add crates/proxy/src/lib.rs && git commit -m 'fix: something'"
      ) !== null
    ));
});

suite("findGitCommitInText — not detected", () => {
  test("no git commit present", () =>
    assert.equal(findGitCommitInText("git add . && git push origin main"), null));

  test("commented-out commit is ignored", () =>
    assert.equal(findGitCommitInText("# git commit -m 'skip'"), null));

  test("unrelated command", () =>
    assert.equal(findGitCommitInText("cargo build --release"), null));
});

// ---------------------------------------------------------------------------
// extractScriptPaths
// ---------------------------------------------------------------------------

suite("extractScriptPaths", () => {
  test("bash script.sh", () =>
    assert.deepEqual(extractScriptPaths("bash script.sh"), ["script.sh"]));

  test("bash with flags", () =>
    assert.deepEqual(extractScriptPaths("bash -x -e ./deploy.sh"), ["./deploy.sh"]));

  test("sh with absolute path", () =>
    assert.deepEqual(extractScriptPaths("sh -e /tmp/run.sh"), ["/tmp/run.sh"]));

  test("zsh script", () =>
    assert.deepEqual(extractScriptPaths("zsh build.sh"), ["build.sh"]));

  test("source form", () =>
    assert.deepEqual(extractScriptPaths("source ./setup.sh"), ["./setup.sh"]));

  test("dot form", () =>
    assert.deepEqual(extractScriptPaths(". ./setup.sh"), ["./setup.sh"]));

  test("direct ./script", () =>
    assert.deepEqual(extractScriptPaths("./build.sh"), ["./build.sh"]));

  test("absolute direct path", () =>
    assert.deepEqual(extractScriptPaths("/usr/local/bin/deploy"), [
      "/usr/local/bin/deploy",
    ]));

  test("bash -c inline → no paths returned", () =>
    assert.deepEqual(extractScriptPaths("bash -c 'git checkout main'"), []));

  test("sh -c inline → no paths returned", () =>
    assert.deepEqual(extractScriptPaths('sh -c "git switch main"'), []));

  test("compound: echo && bash run.sh", () =>
    assert.deepEqual(extractScriptPaths("echo hi && bash run.sh"), ["run.sh"]));

  test("compound: multiple scripts", () =>
    assert.deepEqual(
      extractScriptPaths("bash a.sh && bash b.sh"),
      ["a.sh", "b.sh"]
    ));
});

// ---------------------------------------------------------------------------
// isShellScript
// ---------------------------------------------------------------------------

suite("isShellScript", () => {
  test(".sh extension", () =>
    assert.ok(isShellScript("deploy.sh", "")));

  test(".bash extension", () =>
    assert.ok(isShellScript("setup.bash", "")));

  test(".zsh extension", () =>
    assert.ok(isShellScript("run.zsh", "")));

  test("no extension but bash shebang", () =>
    assert.ok(isShellScript("Makefile-runner", "#!/bin/bash\necho hi")));

  test("no extension but env shebang", () =>
    assert.ok(isShellScript("run", "#!/usr/bin/env bash\necho hi")));

  test("no extension, sh shebang", () =>
    assert.ok(isShellScript("build", "#!/bin/sh\nset -e")));

  test(".ts file → not a shell script", () =>
    assert.ok(!isShellScript("index.ts", "const x = 1;")));

  test(".rs file → not a shell script", () =>
    assert.ok(!isShellScript("main.rs", 'fn main() { println!("hi"); }')));

  test("no extension, no shebang → not a shell script", () =>
    assert.ok(!isShellScript("README", "# Hello world")));

  test("python shebang → not a shell script", () =>
    assert.ok(!isShellScript("script", "#!/usr/bin/env python3\nprint('hi')")));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
