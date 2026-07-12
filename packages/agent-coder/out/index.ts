#!/usr/bin/env node
/**
 * agent-coder CLI
 *
 * Spawns a hyper-specialized code-writing agent to implement exactly one task
 * from a plan. The agent reads the task, implements it, commits it, and exits.
 *
 * Usage:
 *   agent-coder <plan.json> <task-index>
 *   agent-coder <plan.json> <task-index> --model=sonnet
 *
 * The plan.json should be the output from agent-planner (submit_plan tool).
 * Task index is 0-based.
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plan } from "./types.ts";
import { buildTaskPrompt } from "./prompt-builder.ts";
import commitTaskExtension from "./extensions/commit-task/index.ts";

interface CliArgs {
  planPath: string;
  taskIndex: number;
  model: string;
  cwd: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      "Usage: agent-coder <plan.json> <task-index> [--model=<provider/model>]",
    );
    console.error("\nExample:");
    console.error("  agent-coder ./plan.json 0");
    console.error(
      "  agent-coder ./plan.json 1 --model=anthropic/claude-opus-4-6",
    );
    console.error(
      "  agent-coder ./plan.json 2 --model=anthropic/claude-sonnet-5:high",
    );
    process.exit(1);
  }

  const planPath = resolve(args[0]);
  const taskIndex = parseInt(args[1], 10);

  if (isNaN(taskIndex) || taskIndex < 0) {
    console.error(`Invalid task index: ${args[1]} (must be >= 0)`);
    process.exit(1);
  }

  // Parse optional --model flag
  let model = "anthropic/claude-sonnet-4-6"; // default
  const modelArg = args.find((a) => a.startsWith("--model="));
  if (modelArg) {
    model = modelArg.split("=")[1];
  }

  return {
    planPath,
    taskIndex,
    model,
    cwd: process.cwd(),
  };
}

function loadPlan(planPath: string): Plan {
  try {
    const content = readFileSync(planPath, "utf-8");
    return JSON.parse(content) as Plan;
  } catch (err: any) {
    console.error(`Failed to load plan from ${planPath}: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs();
  const plan = loadPlan(args.planPath);

  // Validate task index
  if (args.taskIndex >= plan.tasks.length) {
    console.error(
      `Task index ${args.taskIndex} out of range (plan has ${plan.tasks.length} tasks)`,
    );
    process.exit(1);
  }

  const task = plan.tasks[args.taskIndex];

  console.log(`\n┌─ Task ${args.taskIndex + 1}/${plan.tasks.length}`);
  console.log(`│  ${task.title}`);
  console.log(`└─ Starting agent...\n`);

  // Parse model string (format: "provider/model" or "provider/model:variant")
  const modelParts = args.model.split("/");
  if (modelParts.length !== 2) {
    console.error(
      `Invalid model format: ${args.model}\n` +
        `Expected format: provider/model (e.g., "anthropic/claude-sonnet-4-6" or "anthropic/claude-sonnet-5:high")`,
    );
    process.exit(1);
  }

  const [provider, modelName] = modelParts;
  const model = getModel(provider, modelName);

  // Create agent session
  const agentDir = getAgentDir();
  const agentsPromptPath = new URL("./AGENTS.md", import.meta.url).pathname;

  const resourceLoader = new DefaultResourceLoader({
    cwd: args.cwd,
    agentDir,
    noExtensions: true, // Don't load agent-lord extensions
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    customSystemPromptPath: agentsPromptPath, // Use our AGENTS.md
    extensionFactories: [commitTaskExtension],
  });

  const { session } = await createAgentSession({
    cwd: args.cwd,
    agentDir,
    model,
    // Core tools for code writing
    tools: ["read", "write", "edit", "bash", "grep", "glob", "find", "ls"],
    resourceLoader,
    sessionManager: SessionManager.inMemory(args.cwd),
  });

  // Build and send the task prompt
  const prompt = buildTaskPrompt(plan, task, args.taskIndex, args.cwd);

  // Track if committed
  let hasCommitted = false;
  let turnCount = 0;

  let hasThinkingOutput = false;

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_start") {
      turnCount++;
      hasThinkingOutput = false;
    }

    // Show thinking deltas in real-time
    if (event.type === "message_update") {
      const msgEvent = (event as any).assistantMessageEvent;
      if (msgEvent?.type === "thinking_delta") {
        process.stdout.write(msgEvent.delta);
        hasThinkingOutput = true;
      }
    }

    if (event.type === "tool_execution_start") {
      // Add newline if there was thinking output before tools
      if (hasThinkingOutput) {
        console.log();
        hasThinkingOutput = false;
      }
      console.log(`  → ${event.toolName}`);
    }

    if (event.type === "tool_execution_end") {
      console.log(`  ✓ ${event.toolName}`);

      if (event.toolName === "commit_task") {
        hasCommitted = true;
        console.log("\n✅ Task committed. Stopping agent...");
        setTimeout(() => void session.abort(), 500);
      }
    }

    if (event.type === "turn_end") {
      // Safety: stop after 30 turns
      if (turnCount > 30) {
        console.log("\n⚠ Turn limit exceeded (30). Stopping agent...");
        void session.abort();
      }
    }
  });

  try {
    await session.prompt(prompt);
  } finally {
    unsubscribe();
    session.dispose();
  }

  if (!hasCommitted) {
    console.error(
      "\n✗ Agent did not commit the task. Check the output above for errors.",
    );
    process.exit(1);
  }

  console.log(`\n✓ Task ${args.taskIndex + 1} complete.\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
