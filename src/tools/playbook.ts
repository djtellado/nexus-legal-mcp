import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  analysis: z.string().min(20).describe(
    "Full text of the Node A risk analysis (ISO 31000, with hallazgos ER-NNN) sobre el que construir la estrategia de negociación.",
  ),
  language: z.enum(["es", "en", "fr"]).optional(),
  documentTitle: z.string().optional().describe("Title of the analysed document (optional, only used to label the playbook)."),
});

interface PlaybookResult {
  entries?: unknown[];
  executiveSummary?: string;
  totalRisks?: number;
  citationChecks?: unknown;
  [k: string]: unknown;
}

export const playbookTool: ToolDefinition = {
  name: "nexus_playbook",
  description:
    "STRATEGIC NEGOTIATION PLAYBOOK. From a Node A risk analysis (ISO 31000), " +
    "generates three levels of counter-proposal for each finding (conservative / " +
    "balanced / aggressive) with suggested clause wording and trade-offs. Returns " +
    "structured JSON + deterministic citation verification. USE WHEN: you already " +
    "have an analysis of a contract and need to prepare for the negotiating " +
    "table. Cost: 3 credits.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const result = await postJson<PlaybookResult>(cfg, "/api/nodo-playbook", args);
    return { content: JSON.stringify(result, null, 2) };
  },
};
