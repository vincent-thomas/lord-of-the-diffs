#!/usr/bin/env node
/**
 * agent-planner CLI
 *
 * Read-only planning agent that decomposes a feature request into single-task
 * implementation steps. Outputs plan.json.
 *
 * Usage:
 *   agent-planner "Add user authentication"
 *   agent-planner "Add user authentication" --model=anthropic/claude-sonnet-4-6
 *   agent-planner "Add user authentication" --output=plan.json
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { resolve } from "node:path";
import { createExploreExtension } from "@vt-pi/agent-explorer";
import submitPlanExtension from "./extensions/submit-plan/index.ts";
import { readFileSync } from "node:fs";

// Public plan-artifact types: agent-planner is the single source of truth for
// the shape the planner emits and consumers (e.g. @vt-pi/agent-coder) read.
export type { Plan, PlanTask } from "./extensions/submit-plan/logic.ts";

interface CliArgs {
  prompt: string;
  model: string;
  output: string;
  cwd: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0].startsWith("--")) {
    console.error(
      "Usage: agent-planner <request> [--model=<provider/model>] [--output=<path>]",
    );
    console.error("\nExample:");
    console.error('  agent-planner "Add user authentication"');
    console.error(
      '  agent-planner "Add dark mode" --model=anthropic/claude-opus-4-6',
    );
    console.error(
      '  agent-planner "Fix bug in checkout" --output=./my-plan.json',
    );
    process.exit(1);
  }

  const prompt = args[0];

  // Parse optional flags
  let model = "anthropic/claude-sonnet-4-6"; // default
  let output = "plan.json"; // default

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--model=")) {
      model = args[i].split("=")[1];
    } else if (args[i].startsWith("--output=")) {
      output = args[i].split("=")[1];
    }
  }

  return {
    prompt,
    model,
    output,
    cwd: process.cwd(),
  };
}

async function main() {
  const args = parseArgs();

  console.log(`\n┌─ Planning: ${args.prompt}`);
  console.log(`└─ Starting agent...\n`);

  // Parse model string (format: "provider/model" or "provider/model:variant")
  const modelParts = args.model.split("/");
  if (modelParts.length !== 2) {
    console.error(
      `Invalid model format: ${args.model}\n` +
        `Expected format: provider/model (e.g., "anthropic/claude-sonnet-4-6")`,
    );
    process.exit(1);
  }

  const [provider, modelName] = modelParts;
  const model = getModel(provider, modelName);

  // Create agent session
  const agentDir = getAgentDir();
  const agentsPromptPath = new URL("./AGENTS.md", import.meta.url).pathname;

  // Verify AGENTS.md exists and log it for debugging
  try {
    const { readFileSync } = await import("node:fs");
    const promptContent = readFileSync(agentsPromptPath, "utf-8");
    console.log(
      `\n📋 Loaded system prompt from ${agentsPromptPath} (${promptContent.length} chars)`,
    );
    if (!promptContent.includes("submit_plan")) {
      console.error("⚠️  WARNING: AGENTS.md doesn't mention submit_plan!");
    }
  } catch (err) {
    console.error(
      `\n❌ Failed to load AGENTS.md from ${agentsPromptPath}:`,
      err,
    );
  }

  // Set PLANNER_OUTPUT env var so submit_plan knows where to write
  process.env.PLANNER_OUTPUT = resolve(args.cwd, args.output);

  const resourceLoader = new DefaultResourceLoader({
    cwd: args.cwd,
    agentDir,
    noExtensions: true, // Don't load agent-lord extensions
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPromptOverride: () => readFileSync(agentsPromptPath),
    extensionFactories: [createExploreExtension(), submitPlanExtension],
  });

  const { session } = await createAgentSession({
    cwd: args.cwd,
    agentDir,
    model,
    // Read-only tools + custom extensions
    tools: ["read", "grep", "find", "ls", "explore", "submit_plan"],
    resourceLoader,
    sessionManager: SessionManager.inMemory(args.cwd),
  });

  // Track if plan was submitted
  let hasSubmitted = false;
  let turnCount = 0;

  let hasThinkingOutput = false;

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_start") {
      turnCount++;
      hasThinkingOutput = false;
      if (turnCount > 1) {
        console.log(`\n🔄 Turn ${turnCount} starting...`);
      }
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

      if (event.toolName === "submit_plan") {
        hasSubmitted = true;
        console.log("\n✅ Plan submitted.");
      }
    }
  });

  try {
    await session.prompt(args.prompt);
  } finally {
    unsubscribe();
    session.dispose();
  }

  if (!hasSubmitted) {
    console.error(
      "\n✗ Agent did not submit a plan. Check the output above for errors.",
    );
    process.exit(1);
  }

  console.log(`\n✓ Plan written to ${args.output}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
