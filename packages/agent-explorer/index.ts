/**
 * agent-explorer — a read-only exploration sub-agent, run in-process via the
 * Pi SDK (not a subprocess). ExtensionAPI has no built-in way to spawn a
 * nested session from a tool handler, so this imports createAgentSession
 * directly from the same package ExtensionAPI comes from.
 *
 * Kept deliberately lean and isolated from the parent session:
 * - tools allowlist restricts it to read/grep/find/ls — no write, edit, bash.
 * - resourceLoader has all discovery (extensions, skills, AGENTS.md, context
 *   files) turned off, so it never inherits agent-lord's own extensions,
 *   system prompt, or skills. That would both bloat its context and re-enable
 *   behavior that makes no sense for a session that can't write or run
 *   commands.
 * - default model is a cheap/fast one, independent of whatever model
 *   agent-lord itself is running — the whole point of delegating.
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { Object as TObject, String as TString } from "typebox";
import {
  buildExplorePrompt,
  formatExploreResult,
  hasExceededTurnLimit,
} from "./logic.ts";

export interface ExploreExtensionOptions {
  /** Model for the nested exploration session. Default: a cheap/fast model, independent of agent-lord's own. */
  model?: Model<any>;
}

export function createExploreExtension(options: ExploreExtensionOptions = {}) {
  const model = options.model ?? getModel("anthropic", "claude-haiku-4-5");

  return function (pi: ExtensionAPI) {
    pi.registerTool({
      name: "explore",
      label: "Explore",
      description:
        "Delegate ONLY factual location queries to a cheaper sub-agent. Use " +
        "this to find WHERE code is ('where is X defined', 'what files import Y', " +
        "'does Z exist'), NOT to analyze quality, identify gaps, find TODOs, or " +
        "reason about the code. For analysis tasks, use read/grep/find yourself. " +
        "Returns file:line references. The sub-agent has read-only tools and " +
        "will refuse reasoning tasks.",
      promptSnippet:
        "Delegate factual location queries to a cheaper sub-agent (NOT analysis/reasoning)",
      parameters: TObject({
        query: TString({
          description:
            "The exploration question to answer, e.g. 'where is the retry logic for CI polling?'",
        }),
      }),
      async execute(_toolCallId, params, signal, onUpdate, ctx) {
        const notify = (text: string) =>
          onUpdate?.({ content: [{ type: "text", text }] });
        notify(`Exploring: ${params.query}`);

        const agentDir = getAgentDir();
        const resourceLoader = new DefaultResourceLoader({
          cwd: ctx.cwd,
          agentDir,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        });

        const { session } = await createAgentSession({
          cwd: ctx.cwd,
          agentDir,
          model,
          tools: ["read", "grep", "find", "ls"],
          resourceLoader,
          sessionManager: SessionManager.inMemory(ctx.cwd),
        });

        let turnCount = 0;
        const unsubscribe = session.subscribe((event) => {
          if (event.type === "turn_end") {
            turnCount++;
            if (hasExceededTurnLimit(turnCount)) {
              void session.abort();
            }
          }
        });

        const onAbort = () => void session.abort();
        signal?.addEventListener("abort", onAbort, { once: true });

        try {
          await session.prompt(buildExplorePrompt(params.query));
        } finally {
          unsubscribe();
          signal?.removeEventListener("abort", onAbort);
          session.dispose();
        }

        const text = formatExploreResult(session.getLastAssistantText());
        return { content: [{ type: "text" as const, text }] };
      },
    });
  };
}

export default createExploreExtension;
