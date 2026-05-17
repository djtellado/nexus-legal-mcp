import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  query:        z.string().min(5).describe("Consulta en lenguaje natural sobre jurisprudencia. Ej: 'cláusula suelo abusiva entidad bancaria devolución intereses' o 'recurso de amparo contra providencia administrativa apremio'."),
  jurisdiction: z.string().default("ES").describe("Jurisdicción del corpus. ES = CENDOJ (TS/AN/TSJ/AP ~141k docs). CO = CC/CSJ/CE (~106k). Otros países según disponibilidad."),
  top_k:        z.number().int().min(1).max(50).default(10).describe("Número máximo de sentencias a devolver."),
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
    "BÚSQUEDA SEMÁNTICA DE JURISPRUDENCIA. Consulta vectorial (voyage-law-2) " +
    "sobre el corpus curado de Nexus: ES ~141k sentencias (CENDOJ — TS/AN/" +
    "TSJ/AP) · CO ~106k (CC/CSJ/CE) · más países en expansión. Devuelve " +
    "top-K resultados con título, fuente, extracto (2 000 chars) y URL " +
    "permanente al texto íntegro. USAR CUANDO: el usuario pide localizar " +
    "sentencias sobre un tema concreto, contrastar un argumento, o " +
    "construir un dossier de citas. Coste: gratis (solo búsqueda).",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const result = await postJson<SearchResponse>(cfg, "/api/v1/jurisprudencia/search", args);
    const summary =
      `Búsqueda en corpus ${result.jurisdiction} — intent: ${result.intent} — ` +
      `${result.count} resultados:\n\n` +
      result.chunks.map((c, i) =>
        `### ${i + 1}. ${c.titulo}\n` +
        `**Fuente:** ${c.source}\n` +
        `**URL:** ${c.url}\n\n` +
        `${c.texto}\n`
      ).join("\n---\n\n");
    return { content: summary };
  },
};
