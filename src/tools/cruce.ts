import { z } from "zod";
import { httpErrorFrom } from "../http-client.js";
import type { Config } from "../config.js";
import type { ToolDefinition } from "./types.js";

// Contrato real de las rutas v1 (ver app/api/v1/cruce/*/route.ts):
//   sentencias-de-articulo  → query params norma_alias + articulo + top + jurisdiction
//   articulos-de-sentencia  → query param jurisprudencia_id (uuid ES) o ecli (SG)
const inputSchema = z.object({
  modo: z.enum(["sentencia_a_articulos", "articulo_a_sentencias"]).describe(
    "Direction of cross-reference: 'sentencia_a_articulos' finds statutes cited in a judgment; 'articulo_a_sentencias' finds judgments citing a statute article"
  ),
  jurisprudencia_id: z.string().optional().describe("Internal corpus id (uuid) of the judgment for 'sentencia_a_articulos' mode — obtain it with nexus_jurisprudencia_search"),
  ecli: z.string().optional().describe("ECLI identifier for 'sentencia_a_articulos' mode (Singapore corpus), e.g. 'ECLI:SG:CA:2024:1'"),
  norma_alias: z.string().optional().describe("Statute alias for 'articulo_a_sentencias' mode, e.g. 'LEC', 'CC', 'LECrim'"),
  articulo: z.string().optional().describe("Article number for 'articulo_a_sentencias' mode, e.g. '400'"),
  jurisdiction: z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  top: z.number().int().min(1).max(50).default(10).describe("Maximum results to return"),
});

/** Simple GET JSON helper (not in http-client.ts yet). */
async function getJson<T = unknown>(cfg: Config, path: string): Promise<T> {
  const url = `${cfg.baseUrl}${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,
        "Accept":        "application/json",
        "User-Agent":    cfg.userAgent,
      },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw httpErrorFrom(res.status, res.statusText, path, text);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export const cruceTool: ToolDefinition = {
  name: "cruce_normativa_jurisprudencia",
  description:
    "Cross-reference between statute articles and court judgments. " +
    "Find which statutes a judgment cites, or which judgments cite a particular statute article. " +
    "USE WHEN: the user wants to know which provisions a judgment cites, or which " +
    "judgments apply a particular provision.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);

    let result: Record<string, unknown>;
    let title: string;

    if (args.modo === "sentencia_a_articulos") {
      if (!args.jurisprudencia_id && !args.ecli) {
        throw new Error("jurisprudencia_id (uuid) or ecli (SG) is required for sentencia_a_articulos mode");
      }
      const qs = args.jurisprudencia_id
        ? `jurisprudencia_id=${encodeURIComponent(args.jurisprudencia_id)}`
        : `ecli=${encodeURIComponent(args.ecli!)}`;
      result = await getJson<Record<string, unknown>>(
        cfg,
        `/api/v1/cruce/articulos-de-sentencia?${qs}`,
      );
      title = `Provisions cited in ${args.jurisprudencia_id ?? args.ecli}`;
    } else {
      if (!args.norma_alias || !args.articulo) {
        throw new Error("norma_alias and articulo are required for articulo_a_sentencias mode");
      }
      const qs = new URLSearchParams({
        norma_alias:  args.norma_alias,
        articulo:     args.articulo,
        top:          String(args.top),
        jurisdiction: args.jurisdiction,
      });
      result = await getJson<Record<string, unknown>>(
        cfg,
        `/api/v1/cruce/sentencias-de-articulo?${qs}`,
      );
      title = `Judgments citing ${args.norma_alias} s. ${args.articulo}`;
    }

    // Respuestas reales: { articulos: [...] } o { sentencias: [...] }.
    const items = (result.articulos ?? result.sentencias ?? result.items ?? result.results ?? []) as Record<string, unknown>[];
    const lines: string[] = [
      `## ${title}`,
      ``,
      `**Total:** ${result.total ?? items.length}`,
      ``,
    ];

    for (const item of items.slice(0, args.top)) {
      if (args.modo === "sentencia_a_articulos") {
        lines.push(`- **${item.norma_alias ?? item.alias ?? ""}** art. ${item.articulo ?? ""} — ${item.descripcion ?? item.norma_titulo ?? ""}`);
      } else {
        lines.push(`- **${item.ecli ?? item.roj ?? item.id ?? ""}** — ${item.titulo ?? item.resumen ?? ""}`);
      }
    }

    if (items.length === 0) {
      lines.push("No results found.");
    }

    return { content: lines.join("\n") };
  },
};
