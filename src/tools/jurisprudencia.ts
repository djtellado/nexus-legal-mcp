import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  query:        z.string().min(5).describe("Natural-language query over case law. E.g. 'unfair interest-rate floor clause bank refund of interest' or 'judicial review of an enforcement notice'."),
  jurisdiction: z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  top_k:        z.number().int().min(1).max(50).default(10).describe("Maximum number of judgments to return."),
});

interface SearchResponse {
  query: string;
  jurisdiction: string;
  intent: string;
  count: number;
  chunks: Array<{
    id: string;
    source: string;
    titulo: string;
    texto: string;
    url: string;
  }>;
}

export const jurisprudenciaTool: ToolDefinition = {
  name: "nexus_jurisprudencia_search",
  description:
    "SEMANTIC CASE-LAW SEARCH. Vector query (voyage-law-2) over the curated " +
    "Nexus corpus: GB ~138k judgments (Scotland and Northern Ireland) · ES " +
    "~141k (CENDOJ) · CO ~106k · more jurisdictions in progress. Returns " +
    "top-K results with title, source, extract (2,000 chars) and a permanent " +
    "URL to the full text. USE WHEN: the user asks to find " +
    "judgments on a specific point, test an argument, or build a bundle of " +
    "authorities. Cost: free (search only).",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const result = await postJson<SearchResponse>(cfg, "/api/v1/jurisprudencia/search", args);
    const summary =
      `Search over the ${result.jurisdiction} corpus — intent: ${result.intent} — ` +
      `${result.count} results:\n\n` +
      result.chunks.map((c, i) =>
        `### ${i + 1}. ${c.titulo}\n` +
        `**Fuente:** ${c.source}\n` +
        `**URL:** ${c.url}\n\n` +
        `${c.texto}\n`
      ).join("\n---\n\n");
    return { content: summary };
  },
};
