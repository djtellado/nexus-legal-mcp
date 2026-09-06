import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  textV1: z.string().min(20).describe("Full text of the ORIGINAL version (V1) of the document."),
  textV2: z.string().min(20).describe("Full text of the version AMENDED by the other side (V2)."),
  // Sin default: ninguna jurisdicción se privilegia (jurisdicciones_son_pares).
  // La ruta interna exige jurisdiction y el Nodo B inyecta su marco normativo.
  jurisdiction: z.string().describe(
    "ISO code of the jurisdiction governing the document (ES, CO, MX…). OBLIGATORIA: determina el marco normativo con el que se evalúan los cambios.",
  ),
  jurisdictionB: z.string().optional().describe("Second jurisdiction (optional) to activate the bilateral V-BIL cross-border checks."),
  language: z.enum(["es", "en", "fr"]).optional(),
});

interface CompareResult {
  resolvedAlerts?: string[];
  newAlerts?: string[];
  executiveSummary?: string;
  citationChecks?: unknown;
  [k: string]: unknown;
}

export const compareVersionsTool: ToolDefinition = {
  name: "nexus_compare_versions",
  description:
    "VERSION COMPARISON V1↔V2 (Node B — dual audit). Analyses two versions of the " +
    "same document (V1 original vs V2 returned by the other side) and reports: " +
    "alarms resolved, new vulnerabilities introduced, and an executive view of " +
    "the commercial impact, with deterministic citation verification. With " +
    "`jurisdictionB` it activates the bilateral checks (governing law / forum " +
    "altered between versions). USE WHEN: the other side returns a redline and " +
    "you need to know what improved and what traps went in. Cost: 2 credits.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const jurisdiction = args.jurisdiction.trim().toUpperCase();
    const body = {
      textV1: args.textV1,
      textV2: args.textV2,
      jurisdiction,
      language: args.language,
      ...(args.jurisdictionB ? { jurisdictionB: args.jurisdictionB.trim().toUpperCase() } : {}),
    };
    const result = await postJson<CompareResult>(cfg, "/api/nodo-b-compare", body);
    return { content: JSON.stringify(result, null, 2) };
  },
};
