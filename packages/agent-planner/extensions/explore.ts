/**
 * explore extension
 *
 * Wires the `explore` tool from @vt-pi/agent-explorer so the planner can
 * delegate broad, read-only codebase lookups to a separate, cheaper sub-agent
 * instead of burning its own (frontier) context on raw multi-file searches
 * while grounding a decomposition.
 */
import { createExploreExtension } from "@vt-pi/agent-explorer";

export default createExploreExtension();
