import { z } from "zod";
import { renderSseText, streamSse, type CitationChecks, type SseEvent } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:          z.string().min(50).describe("Text of the document (contract, legal situation, facts)."),
  jurisdictions: z.array(z.string()).min(2).max(15).describe("ISO codes of 2 to 15 jurisdictions to compare (e.g. ['ES','CO','GB','SG'])."),
  legalBranch:   z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil"),
  language:      z.enum(["es","en"]).optional(),
});

/**
 * Línea compacta de verificación de citas POR JURISDICCIÓN
 * (jurisdiction_result.result.citationChecks — campo aditivo). El resumen
 * global (done.citationChecks) sigue saliendo con citationSummary().
 * PARIDAD: mismo copy que el connector remoto (lib/mcp/registry.ts →
 * compareCitasLine) — si cambias uno, cambia el otro.
 */
// Copy bilingüe de la línea de citas por jurisdicción (L6). PARIDAD con el
// connector remoto (lib/mcp/registry.ts → COMPARE_CITAS).
interface CompareCitasCopy {
  error: string;
  body: (v: number, mm: number, nf: number, nv: number, pending: number) => string;
  anyBroken: string;
}
const COMPARE_CITAS: Record<string, CompareCitasCopy> = {
  es: {
    error: "**Citas:** ⚠ verificación NO ejecutada (error interno) — no asumas que las citas son correctas.",
    body: (v, mm, nf, nv, pending) =>
      `**Citas:** ${v} verificadas · ${mm} divergentes · ${nf} no encontradas · ${nv} sin corpus activo · ${pending} no parseables.`,
    anyBroken: " ⚠ Hay citas con verificación fallida.",
  },
  en: {
    error: "**Citations:** ⚠ verification NOT executed (internal error) — do not assume the citations are correct.",
    body: (v, mm, nf, nv, pending) =>
      `**Citations:** ${v} verified · ${mm} divergent · ${nf} not found · ${nv} without an active corpus · ${pending} unparseable.`,
    anyBroken: " ⚠ Some citations failed verification.",
  },
};

function citasLine(cc: unknown, lang: string): string {
  if (!cc || typeof cc !== "object" || Array.isArray(cc)) return "";
  const checks = cc as CitationChecks;
  const t = COMPARE_CITAS[lang] ?? COMPARE_CITAS.en;
  if (checks.error) return t.error;
  if (!checks.total) return "";
  const c = checks.counts ?? {};
  return (
    t.body(c.verified ?? 0, c.mismatch ?? 0, c.not_found ?? 0, c.not_verifiable ?? 0, c.pending ?? 0) +
    (checks.anyBroken ? t.anyBroken : "")
  );
}

/** Cabeceras estructurales de la comparativa (formatCompare) — el idioma sigue a
 *  la petición/jurisdicción. PARIDAD con el connector remoto
 *  (lib/mcp/registry.ts → COMPARE_COPY). */
interface CompareCopy {
  noResults: string;
  title: (succeeded: number, total: number) => string;
  risk: string;
  applicableLaw: string;
  keyRisks: string;
  protections: string;
  recommendation: string;
  failed: string;
  unknownError: string;
}
const COMPARE_COPY: Record<string, CompareCopy> = {
  es: {
    noResults: "Sin resultados: el backend no devolvió ninguna jurisdicción analizada.",
    title: (s, t) => `## Comparativa multi-jurisdiccional — ${s}/${t} jurisdicciones analizadas`,
    risk: "riesgo",
    applicableLaw: "**Ley aplicable:**",
    keyRisks: "**Riesgos clave:**",
    protections: "**Protecciones:**",
    recommendation: "**Recomendación:**",
    failed: "análisis fallido",
    unknownError: "error desconocido",
  },
  en: {
    noResults: "No results: the backend did not return any analysed jurisdiction.",
    title: (s, t) => `## Multi-jurisdiction comparison — ${s}/${t} jurisdictions analysed`,
    risk: "risk",
    applicableLaw: "**Applicable law:**",
    keyRisks: "**Key risks:**",
    protections: "**Protections:**",
    recommendation: "**Recommendation:**",
    failed: "analysis failed",
    unknownError: "unknown error",
  },
};

/**
 * Render de la comparativa a partir de los eventos SSE estructurados.
 * /api/multi-jurisdiction-compare responde SIEMPRE SSE (progressive
 * disclosure): el contenido viaja en `jurisdiction_result` — NO hay text_delta
 * ni JSON plano (con postJson el JSON.parse del body SSE reventaba siempre).
 * El markdown final pasa por renderSseText (raspado anti-fabricación
 * NORMATIVA_VIGENTE + resumen de citas). PARIDAD: mismo render que el
 * connector remoto (lib/mcp/registry.ts → compareFmt) — si cambias uno,
 * cambia el otro.
 */
export function formatCompare(events: SseEvent[], citationChecks: CitationChecks | undefined, lang: string = ""): string {
  const t = COMPARE_COPY[lang] ?? COMPARE_COPY.en;
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const results = events.flatMap((e) =>
    e.type === "jurisdiction_result" && e.result && typeof e.result === "object" ? [e.result as Record<string, unknown>] : [],
  );
  const failures = events.filter((e) => e.type === "jurisdiction_error");
  const doneEvt = events.find((e) => e.type === "done") as { total?: unknown; succeeded?: unknown } | undefined;
  if (!results.length && !failures.length) {
    return renderSseText(t.noResults, citationChecks, lang);
  }
  const total = typeof doneEvt?.total === "number" ? doneEvt.total : results.length + failures.length;
  const succeeded = typeof doneEvt?.succeeded === "number" ? doneEvt.succeeded : results.length;
  const lines: string[] = [t.title(succeeded, total)];
  for (const res of results) {
    const code = String(res.jurisdiction ?? "?");
    const name = String(res.jurisdictionName ?? code);
    const flag = typeof res.flag === "string" && res.flag ? `${res.flag} ` : "";
    lines.push("", `### ${flag}${name} (${code}) — ${t.risk} ${res.riskLevel ?? "?"} (${res.riskScore ?? "?"}/10)`);
    const law = strArr(res.applicableLaw);
    if (law.length) lines.push(`${t.applicableLaw} ${law.join(" · ")}`);
    const risks = strArr(res.keyRisks);
    if (risks.length) lines.push(t.keyRisks, ...risks.map((x) => `- ${x}`));
    const prot = strArr(res.keyProtections);
    if (prot.length) lines.push(t.protections, ...prot.map((x) => `- ${x}`));
    if (typeof res.recommendation === "string" && res.recommendation) lines.push(`${t.recommendation} ${res.recommendation}`);
    const citas = citasLine(res.citationChecks, lang);
    if (citas) lines.push(citas);
  }
  for (const f of failures) {
    lines.push("", `### ⚠ ${String(f.jurisdiction ?? "?")} — ${t.failed}: ${String(f.error ?? t.unknownError)}`);
  }
  return renderSseText(lines.join("\n"), citationChecks, lang);
}

export const crossBorderTool: ToolDefinition = {
  name: "nexus_cross_border_compare",
  description:
    "MULTI-JURISDICTION COMPARISON. For the facts or contract supplied, compares " +
    "how the legal system of each listed jurisdiction (2-15) treats it. " +
    "Identifies: most favourable applicable law, optimal forum, tax exposure by " +
    "country (double-taxation treaties), recognition of judgments between " +
    "jurisdictions, conflicts of laws. Returns a comparison structured by " +
    "jurisdiction (risk, applicable law, recommendation). USE WHEN: the client " +
    "operates in several countries and must decide where to litigate, contract " +
    "or establish. Cost: 2-4 credits depending on the number of jurisdictions.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/multi-jurisdiction-compare", args);
    return { content: formatCompare(r.structuredEvents, r.citationChecks, args.language), logs: r.logs };
  },
};
