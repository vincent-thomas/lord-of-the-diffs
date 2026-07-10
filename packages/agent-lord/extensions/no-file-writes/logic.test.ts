/**
 * logic.test.ts — tests for blocking file write redirections
 */

import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { hasFileWriteRedirection } from "./logic.ts";

suite("no-file-writes — file write redirection detection");

const shouldBlock = [
	"echo 'content' >> file.txt",
	"printf 'data' > output.rs",
	"cat input.txt > output.txt",
	"ls -la > listing.txt",
	"echo foo >> /tmp/log.txt",
	"printf '\\ncode\\n' >> src/main.rs",
	"command arg1 arg2 > result.json",
	"FOO=bar echo test >> data.txt",
	"env echo x > file",
	"echo 'multi\nline' >> app.log",
	// No space between operator and target (valid bash).
	"echo hi >file",
	"echo hi >>file",
	"printf '%s' >out.json",
	"cmd arg >/tmp/out",
	"cmd arg >>/tmp/log",
	// File-descriptor-prefixed redirects (2>file, 1>>file).
	"cmd 2>file",
	"cmd 2> file",
	"cmd 1>>file",
	"cmd 1>> file",
	"cmd 2>/tmp/errors.log",
	"build 3>output.txt",
	"cmd 2>&1 3>trace.log",
];

for (const cmd of shouldBlock) {
	test(`blocks: ${cmd}`, () => {
		const result = hasFileWriteRedirection(cmd);
		assert.ok(result.found, `expected to block ${cmd}`);
		assert.ok(result.segment, `expected segment for ${cmd}`);
	});
}

const shouldPass = [
	"echo 'status message'",
	"printf 'debugging: %s' $VAR",
	"ls | grep foo",
	"cat file | wc -l",
	"echo test > /dev/null",
	"command 2> /dev/stderr",
	"build 1>&2",
	"test >&1",
	// No-space forms targeting excluded targets — still fine.
	"echo hi >/dev/null",
	"echo hi >>/dev/null",
	"cmd >&1",
	"grep pattern files",
	"echo concatenate things",
	"which printf",
	"man echo",
];

for (const cmd of shouldPass) {
	test(`allows: ${cmd}`, () => {
		const result = hasFileWriteRedirection(cmd);
		assert.equal(result.found, false, `should not block ${cmd}`);
	});
}