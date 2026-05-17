import { z } from "zod";
import { streamSse } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  query:        z.string().min(5).describe("Consulta doctrinal en lenguaje natural. Ej: '¿La DGT considera deducibles los gastos de representación de un administrador único?'"),
  jurisdiction: z.string().default("ES").describe("Jurisdicción para acotar el corpus doctrinal (DGT/TEAC español, Consejo de Estado, etc.)."),
  language:     z.enum(["es","en","fr","de"]).default("es"),
  history:      z.array(z.object({
                  role:    z.enum(["user","assistant"]),
                  content: z.string(),
                })).optional(),
});

export const doctrinaTool: ToolDefinition = {
  name: "nexus_doctrina",
  description:
    "BÚSQUEDA DE DOCTRINA ADMINISTRATIVA (Nodo Doctrina — RAG + LLM). " +
    "Consulta el corpus de doctrina admin/tributaria (DGT consultas " +
    "vinculantes V-XXXX-YY, TEAC RG XXXX/XXXX, Consejo de Estado " +
    "dictámenes). Distingue 'Doctrina consolidada' (≥2 fuentes ORIGEN-A/B) " +
    "vs 'Criterio orientativo' ([L3-NV]). Indica vinculatoriedad y conflictos " +
    "con jurisprudencia TS. USAR CUANDO: el usuario pregunta por el criterio " +
    "administrativo en un tema fiscal/regulatorio concreto. Coste: 1 crédito.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-doctrina", args);
    return { content: r.text, logs: r.logs };
  },
};
