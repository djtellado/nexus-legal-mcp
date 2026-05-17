import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  documentText: z.string().min(50).describe("Texto íntegro del documento a atacar adversarialmente (típicamente un contrato)."),
});

interface RedTeamResult {
  vulnerabilities?: Array<{ severity: string; clause_excerpt: string; attack_vector: string }>;
  catastrophic_risk_score?: number;
  summary?: string;
  [k: string]: unknown;
}

export const redteamTool: ToolDefinition = {
  name: "nexus_redteam",
  description:
    "RED TEAM ADVERSARIAL (Nodo C — modo destructivo). Análisis hostil " +
    "del documento como si fuera el abogado de la contraparte: vacíos " +
    "legales, cláusulas trampa, asimetrías de poder, riesgos catastróficos. " +
    "Devuelve JSON estructurado con vulnerabilidades (severidad Alta/Media) " +
    "y un catastrophic_risk_score 1-100. USAR CUANDO: pre-firma de contrato " +
    "estratégico, auditoría de M&A, due diligence agresivo. Coste: 5 créditos.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const result = await postJson<RedTeamResult>(cfg, "/api/nodo-c-redteam", args);
    return {
      content: JSON.stringify(result, null, 2),
    };
  },
};
