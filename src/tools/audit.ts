import { z } from "zod";
import { renderSseText, streamSse, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  analysis:             z.string().min(50).describe("The full Node A analysis to audit (complete report text, including NEXUS-AUDIT-TRAIL if present)."),
  text:                 z.string().describe("The original document the analysis was run over (Layer A). The auditor needs it to check assertions against the corpus."),
  jurisdiction:         z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  jurisdictionB:        z.string().optional(),
  language:             z.enum(["es","en","fr","de"]).optional(),
  articleContext:       z.string().optional().describe("Relevant provisions injected by the operator as context (optional)."),
  jurisprudenciaContext:z.string().optional().describe("Contexto de jurisprudencia relevante (opcional)."),
});

export const auditTool: ToolDefinition = {
  name: "nexus_audit",
  description:
    "CROSS-AUDIT OF THE NODE A ANALYSIS (Node B — adversarial control). " +
    "Checks the previous analysis against the original document: detects " +
    "unsupported assertions, misapplied certainty locks, omissions, " +
    "internal contradictions, and produces the V-XX verification block. " +
    "Returns a confidence score 0-100. USE WHEN: the user wants a second layer " +
    "of validation before putting the analysis in front of a client or a court. " +
    "Requires `nexus_analyze` to have run first. Cost: 1-2 credits.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-b-audit", args);
    // Anti-alucinación: resumen de verificación determinista de citas, si la ruta lo emite.
    return { content: renderSseText(r.text, r.citationChecks, resolveToolLang(args.language, args.jurisdiction)), logs: r.logs };
  },
};
