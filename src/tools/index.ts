import { analyzeTool }            from "./analyze.js";
import { consultaTool }           from "./consulta.js";
import { draftTool }              from "./draft.js";
import { auditTool }              from "./audit.js";
import { consensusTool }          from "./consensus.js";
import { monteCarloTool }         from "./monte-carlo.js";
import { doctrinaTool }           from "./doctrina.js";
import { opinionTool }            from "./opinion.js";
import { redteamTool }            from "./redteam.js";
import { adversarialTool }        from "./adversarial.js";
import { crossBorderTool }        from "./cross-border.js";
import { jurisprudenciaTool }     from "./jurisprudencia.js";
import { verifyCitaTool }         from "./verify-cita.js";
import { verificacionTool }       from "./verificacion.js";
import { plazosCalcularTool }     from "./plazos.js";
import { cruceTool }              from "./cruce.js";
import { boxAnalyzeTool }         from "./box.js";
import { playbookTool }           from "./playbook.js";
import { compareVersionsTool }    from "./compare-versions.js";
import { conflictCheckTool }      from "./conflict-check.js";
import { inboxTool }              from "./inbox.js";
import { chatTool }               from "./chat.js";
import {
  normativaSearchTool,
  normativaArticuloTool,
  normativaPyramidTool,
  corpusCoverageTool,
  normativaCoverageTool,
} from "./normativa.js";
import type { ToolDefinition }    from "./types.js";

/** Catálogo completo de tools MCP de Nexus (16 core + 5 DELTA-1 + 5 FASE-2 + 1 FASE-3b = 27). */
export const ALL_TOOLS: ToolDefinition[] = [
  analyzeTool,
  consultaTool,
  draftTool,
  auditTool,
  consensusTool,
  monteCarloTool,
  doctrinaTool,
  opinionTool,
  redteamTool,
  adversarialTool,
  crossBorderTool,
  jurisprudenciaTool,
  verifyCitaTool,
  // FASE-3b — Centro de Verificación (determinista, corpus BOE, sin coste LLM).
  verificacionTool,
  plazosCalcularTool,
  cruceTool,
  boxAnalyzeTool,
  // DELTA-1 — wrappers de nodos case-independientes (2026-07-08).
  playbookTool,
  compareVersionsTool,
  conflictCheckTool,
  inboxTool,
  chatTool,
  // FASE-2 — normativa vigente + inventario de corpus (read-only, v1 público).
  normativaSearchTool,
  normativaArticuloTool,
  normativaPyramidTool,
  corpusCoverageTool,
  normativaCoverageTool,
];

export type { ToolDefinition, ToolResult } from "./types.js";
