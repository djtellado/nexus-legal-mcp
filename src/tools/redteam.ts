import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  documentText: z.string().min(50).describe("Full text of the document to attack adversarially (typically a contract)."),
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
    "ADVERSARIAL RED TEAM (Node C — destructive mode). Hostile analysis of the " +
    "document as if written by the other side's lawyer: legal gaps, trap clauses, " +
    "power asymmetries, catastrophic risks. Returns structured JSON with " +
    "vulnerabilities (severity High/Medium) and a catastrophic_risk_score 1-100. " +
    "USE WHEN: pre-signature of a strategic contract, M&A audit, aggressive due " +
    "diligence. Cost: 5 credits.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const result = await postJson<RedTeamResult>(cfg, "/api/nodo-c-redteam", args);
    return {
      content: JSON.stringify(result, null, 2),
    };
  },
};
