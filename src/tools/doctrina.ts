import { z } from "zod";
import { renderSseText, streamSse, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  query:        z.string().min(5).describe("Doctrinal query in natural language. E.g. 'is a sole director's entertainment expenditure deductible?'"),
  jurisdiction: z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  language:     z.enum(["es","en","fr","de"]).optional(),
  history:      z.array(z.object({
                  role:    z.enum(["user","assistant"]),
                  content: z.string(),
                })).optional(),
});

export const doctrinaTool: ToolDefinition = {
  name: "nexus_doctrina",
  description:
    "ADMINISTRATIVE DOCTRINE SEARCH (Doctrine node — RAG + LLM). Queries the " +
    "administrative and tax doctrine corpus (" +
    "vinculantes V-XXXX-YY, TEAC RG XXXX/XXXX, Consejo de Estado " +
    "dictámenes). Distingue 'Doctrina consolidada' (≥2 fuentes ORIGEN-A/B) " +
    "vs 'Criterio orientativo' ([L3-NV]). Indica vinculatoriedad y conflictos " +
    "with case law. USE WHEN: the user asks what the administrative position is " +
    "on a specific tax or regulatory point. Cost: 1 credit.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-doctrina", args);
    // Anti-alucinación: resumen de verificación determinista de citas, si la ruta lo emite.
    return { content: renderSseText(r.text, r.citationChecks, resolveToolLang(args.language, args.jurisdiction)), logs: r.logs };
  },
};
