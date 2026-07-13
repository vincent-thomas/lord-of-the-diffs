#!/usr/bin/env node
/**
 * agent-validator — validates implementation against plan
 *
 * Loads plan.json, reads the commits/code, and validates that the implementation
 * matches what was planned. Can flag issues via `not_correct` tool or fix them directly.
 *
 * Usage:
 *   agent-validator                    # Validate against plan.json
 *   agent-validator --plan=custom.json # Use custom plan file
 *   agent-validator --model=opus       # Use opus for validation
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createFixCiExtension } from "@vt-pi/fix-ci";
import { createValidationExtension } from "./extensions/validate-plan/index.ts";
import type { Plan } from "@vt-pi/agent-planner";

interface CliArgs {
  model: string;
  planPath: string;
  cwd: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  let model = "anthropic/claude-sonnet-4-6"; // default
  let planPath = "plan.json"; // default

  for (const arg of args) {
    if (arg.startsWith("--model=")) {
      const value = arg.split("=")[1];
      // Allow shorthand: opus → anthropic/claude-opus-4-6
      if (!value.includes("/")) {
        model = `anthropic/claude-${value}-4-6`;
      } else {
        model = value;
      }
    } else if (arg.startsWith("--plan=")) {
      planPath = arg.split("=")[1];
    }
  }

  return { model, planPath, cwd: process.cwd() };
}

async function main() {
  const args = parseArgs();

  // Load and validate plan
  const planPath = resolve(args.cwd, args.planPath);
  if (!existsSync(planPath)) {
    console.error(`\n✗ Plan file not found: ${planPath}`);
    console.error(`Run agent-planner first to create it.\n`);
    process.exit(1);
  }

  const plan: Plan = JSON.parse(readFileSync(planPath, "utf-8"));
  console.log(`\n┌─ Agent Validator`);
  console.log(`├─ Plan: ${args.planPath}`);
  console.log(`├─ Tasks: ${plan.tasks.length}`);
  console.log(`├─ Model: ${args.model}`);
  console.log(`└─ Starting validation...\n`);

  // Parse model
  const [provider, modelName] = args.model.split("/");
  const model = getModel(provider, modelName);

  const agentDir = getAgentDir();
  const agentsPromptPath = new URL("./AGENTS.md", import.meta.url).pathname;

  // Make plan available to extensions via env
  process.env.VALIDATOR_PLAN = JSON.stringify(plan);

  const resourceLoader = new DefaultResourceLoader({
    cwd: args.cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPromptOverride: () => readFileSync(agentsPromptPath),
    extensionFactories: [
      createValidationExtension(),
      createFixCiExtension(),
    ],
  });

  const { session } = await createAgentSession({
    cwd: args.cwd,
    agentDir,
    model,
    // Tools: read/write + validation tools
    tools: [
      "read",
      "grep",
      "find",
      "edit",
      "write",
      "bash",
      "not_correct",
      "approve_plan_implementation",
      "push_and_check_ci",
    ],
    resourceLoader,
    sessionManager: SessionManager.inMemory(args.cwd),
  });

  let turnCount = 0;
  let hasThinkingOutput = false;
  let approved = false;
  let rejected = false;

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_start") {
      turnCount++;
      hasThinkingOutput = false;
      if (turnCount > 1) {
        console.log(`\n🔄 Turn ${turnCount}`);
      }
    }

    if (event.type === "message_update") {
      const msgEvent = (event as any).assistantMessageEvent;
      if (msgEvent?.type === "thinking_delta") {
        process.stdout.write(msgEvent.delta);
        hasThinkingOutput = true;
      }
    }

    if (event.type === "tool_execution_start") {
      if (hasThinkingOutput) {
        console.log();
        hasThinkingOutput = false;
      }
      console.log(`  → ${event.toolName}`);
    }

    if (event.type === "tool_execution_end") {
      console.log(`  ✓ ${event.toolName}`);

      // Check validation status
      if (event.toolName === "approve_plan_implementation") {
        approved = true;
      } else if (event.toolName === "not_correct") {
        rejected = true;
      }
    }
  });

  try {
    // The agent validates implementation against the plan
    const planSummary = plan.tasks.map((t, i) => `${i + 1}. ${t.title}`).join("\n");

    const prompt =
      `You are validating that the implementation matches the plan.\n\n` +
      `## The Plan\n\n` +
      `**What:** ${plan.what}\n\n` +
      `**Why:** ${plan.why}\n\n` +
      `**Tasks:**\n${planSummary}\n\n` +
      `## Your Job\n\n` +
      `1. Review the git commits to see what was actually implemented\n` +
      `2. Read the code to understand the implementation\n` +
      `3. For each task, check if:\n` +
      `   - The goal was achieved (does the code do what the task said?)\n` +
      `   - The acceptance criteria are met\n` +
      `   - The constraints were respected\n\n` +
      `4. Then either:\n` +
      `   - Call \`not_correct\` with detailed reasons if implementation doesn't match plan\n` +
      `   - Call \`approve_plan_implementation\` if everything matches\n\n` +
      `## Important Notes\n\n` +
      `- Don't nitpick style or minor details — focus on whether the plan was followed\n` +
      `- Extra features beyond the plan are OK if they make sense\n` +
      `- Missing features from the plan are NOT OK\n` +
      `- Check git log to see the actual commits and what changed\n` +
      `- You can fix small issues yourself, but call not_correct for major deviations`;

    await session.prompt(prompt);

    if (approved) {
      console.log(`\n✅ Implementation approved! Matches the plan.\n`);
      console.log(`Next: Run push_and_check_ci to validate CI and create PR\n`);
    } else if (rejected) {
      console.log(`\n❌ Implementation does not match plan. See reasons above.\n`);
      process.exit(1);
    } else {
      console.log(`\n⚠️  Validation incomplete. Agent did not call approve or not_correct.\n`);
      process.exit(1);
    }
  } finally {
    unsubscribe();
    session.dispose();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
