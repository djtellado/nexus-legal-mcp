import { analyzeTool }         from "./analyze.js";
import { consultaTool }        from "./consulta.js";
import { draftTool }           from "./draft.js";
import { auditTool }           from "./audit.js";
import { monteCarloTool }      from "./monte-carlo.js";
import { doctrinaTool }        from "./doctrina.js";
import { opinionTool }         from "./opinion.js";
import { redteamTool }         from "./redteam.js";
import { adversarialTool }     from "./adversarial.js";
import { crossBorderTool }     from "./cross-border.js";
import { jurisprudenciaTool }  from "./jurisprudencia.js";
import type { ToolDefinition } from "./types.js";

/** Catálogo completo de tools MCP de Nexus (v1 — 11 tools). */
export const ALL_TOOLS: ToolDefinition[] = [
  analyzeTool,
  consultaTool,
  draftTool,
  auditTool,
  monteCarloTool,
  doctrinaTool,
  opinionTool,
  redteamTool,
  adversarialTool,
  crossBorderTool,
  jurisprudenciaTool,
];

export type { ToolDefinition, ToolResult } from "./types.js";
