import { z } from "zod";
import { renderSseText, streamSse, type SseEvent, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:          z.string().min(20).describe("Full text of the legal document to analyse (max. 50,000 characters)."),
  // OBLIGATORIA y SIN default (jurisdicciones_son_pares): /api/nodo-consensus
  // responde 400 JURISDICTION_REQUIRED si falta — ninguna jurisdicción se privilegia.
  jurisdiction:  z.string().min(2).describe("ISO code of the primary jurisdiction (e.g. 'ES', 'CO', 'SG', 'GB'). REQUIRED: this flow applies no default."),
  jurisdictionB: z.string().optional().describe("Second, cross-border jurisdiction (optional)."),
  legalBranch:   z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil"),
  mode:          z.enum(["standard","auditoria","agil"]).default("standard").describe("standard · auditoria (exhaustivo) · agil (breve)."),
  language:      z.enum(["es","en","fr","de"]).optional(),
  useJurisprudencia: z.boolean().default(false).describe("Also check against the case-law corpus (RAG), if the plan allows it."),
  referenceDate: z.string().optional().describe("Reference date for lex temporis, YYYY-MM-DD (optional)."),
});

/**
 * Techo propio del stream: el consenso encadena 2-5 llamadas LLM (~3-6 min,
 * maxDuration 300s en la ruta), por encima del timeout SSE por defecto (180s).
 * No pisa un NEXUS_TIMEOUT_MS mayor configurado por el usuario.
 */
const CONSENSUS_TIMEOUT_MS = 390_000;

/**
 * POR QUÉ terminó el loop, en la lengua del contenido. "CONSENSO PARCIAL" tapaba
 * con la misma etiqueta "los dos agentes revisaron y no se pusieron de acuerdo" y
 * "la segunda revisión no llegó a ejecutarse". /api/nodo-consensus emite
 * `termination` + `secondPassRan` en su `done` justo para distinguirlos y este
 * composer los tiraba: quien leía el informe creía que lo habían mirado dos
 * agentes cuando podía haberlo mirado uno.
 *
 * PARIDAD: mismo texto que CONSENSUS_TERMINATION_COPY del conector remoto
 * (lib/mcp/jobs.ts). Fallback NEUTRO a EN, como el resto del render stdio.
 */
const TERMINATION_COPY: Record<string, Record<string, string>> = {
  es: {
    agreement:
      "**Cierre:** acuerdo — el Nodo B firmó el informe tras revisarlo (el veto determinista de citas lo permitió).",
    max_iterations:
      "**Cierre:** SIN acuerdo — se agotaron las vueltas previstas y el auditor seguía discrepando. El informe final NO está firmado por el Nodo B.",
    caller_stopped:
      "**Cierre:** la segunda revisión NO llegó a ejecutarse (el loop se detuvo antes). Este informe NO ha pasado por la re-evaluación del Nodo A ni por una segunda auditoría: no lo leas como un desacuerdo entre dos agentes.",
  },
  en: {
    agreement:
      "**Termination:** agreement — Node B signed off on the report after reviewing it (the deterministic citation veto allowed it).",
    max_iterations:
      "**Termination:** NO agreement — the planned rounds were exhausted and the auditor was still dissenting. The final report is NOT signed off by Node B.",
    caller_stopped:
      "**Termination:** the second review NEVER RAN (the loop stopped before it). This report did not go through Node A's re-evaluation or a second audit: do not read it as two agents disagreeing.",
  },
};

/**
 * ANDAMIAJE del informe de consenso, en la lengua del contenido.
 *
 * `TERMINATION_COPY` (arriba) ya hablaba los dos idiomas, pero todo lo que lo rodea
 * —cabecera, sufijo de confianza, línea de iteraciones y el respaldo «sin veredicto»—
 * seguía fijado en castellano, mientras los dos títulos de sección ya estaban en inglés.
 * O sea: la forma MEZCLADA. Un solicitor recibía el cuerpo del informe en inglés, los
 * títulos en inglés y la cabecera y la línea de iteraciones en castellano.
 *
 * PARIDAD: mismos textos que CONSENSUS_FRAME_COPY del conector remoto
 * (lib/mcp/jobs.ts) — si cambias uno, cambia el otro.
 *
 * NO entra aquí `consensusLabel` ("CONSENSO TOTAL" / "CONSENSO PARCIAL") ni
 * `nodoBVerdict` (CONSENSO_TOTAL, DISCREPANCIA_*): son VALORES DE PROTOCOLO que emite
 * /api/nodo-consensus y que la UI compara por igualdad de cadena. Traducirlos los haría
 * divergir del valor que manda el backend.
 */
const FRAME_COPY: Record<string, {
  head:        (label: string, score: string) => string;
  score:       (n: number) => string;
  iterations:  string;
  noVerdict:   string;
  conf:        (n: number) => string;
  finalReport: string;
  finalAudit:  string;
}> = {
  es: {
    head:        (label, score) => `## Consenso multi-agente Nodo A ↔ Nodo B — ${label}${score}`,
    score:       (n) => ` · confianza Nodo B ${n}/100`,
    iterations:  "**Iteraciones A↔B:** ",
    noVerdict:   "sin veredicto",
    conf:        (n) => ` (conf. ${n})`,
    finalReport: "### Informe final (Nodo A)",
    finalAudit:  "### Auditoría final (Nodo B)",
  },
  en: {
    head:        (label, score) => `## Multi-agent consensus Node A ↔ Node B — ${label}${score}`,
    score:       (n) => ` · Node B confidence ${n}/100`,
    iterations:  "**A↔B iterations:** ",
    noVerdict:   "no verdict",
    conf:        (n) => ` (conf. ${n})`,
    finalReport: "### Final report (Node A)",
    finalAudit:  "### Final audit (Node B)",
  },
};

/**
 * Compone el TEXTO final del consenso a partir del evento `done`.
 * /api/nodo-consensus solo emite `text_delta` de PROGRESO ("▸ Fase A…"); el
 * resultado real (analysis/audit/veredicto/iteraciones) viaja en el `done` —
 * sin esta composición la tool devolvería el log de progreso como informe.
 * PARIDAD: mismo formato que composeConsensusJobText del conector remoto
 * (lib/mcp/jobs.ts) — si cambias uno, cambia el otro.
 *
 * Devuelve null si el done no trae un `analysis` no vacío (stream incompleto).
 */
export function composeConsensusText(done: SseEvent | undefined, lang?: string): string | null {
  if (!done) return null;
  const analysis = typeof done.analysis === "string" ? done.analysis.trim() : "";
  if (!analysis) return null;
  const audit = typeof done.audit === "string" ? done.audit.trim() : "";
  // Andamiaje por idioma con fallback NEUTRO a EN, como el resto del render stdio.
  const f = (lang && FRAME_COPY[lang]) || FRAME_COPY.en;
  // Valor de PROTOCOLO del backend — no se traduce (ver FRAME_COPY).
  const label =
    typeof done.consensusLabel === "string" && done.consensusLabel
      ? done.consensusLabel
      : done.consensusVerdict === "CONSENSO_TOTAL"
        ? "CONSENSO TOTAL"
        : "CONSENSO PARCIAL";
  const score =
    typeof done.confidenceScore === "number" ? f.score(done.confidenceScore) : "";
  const iters = Array.isArray(done.iterations) ? done.iterations : [];
  const iterLine = iters.length
    ? f.iterations +
      iters
        .map((it) => {
          const r = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
          // `nodoBVerdict` es también valor de protocolo (CONSENSO_TOTAL, DISCREPANCIA_*).
          const v = typeof r.nodoBVerdict === "string" && r.nodoBVerdict ? r.nodoBVerdict : f.noVerdict;
          const c = typeof r.confidenceScore === "number" ? f.conf(r.confidenceScore) : "";
          return `${r.iteration ?? "?"}: ${v}${c}`;
        })
        .join(" → ")
    : "";
  // Motivo del cierre: lo emite la ruta interna y aquí se dice. `secondPassRan:false`
  // vale por sí solo aunque el backend no mandara `termination`: que la segunda
  // vuelta no corriera es un hecho del run, no una etiqueta.
  const termCopy = (lang && TERMINATION_COPY[lang]) || TERMINATION_COPY.en;
  const termKey =
    typeof done.termination === "string" && termCopy[done.termination]
      ? done.termination
      : done.secondPassRan === false && done.consensusVerdict !== "CONSENSO_TOTAL"
        ? "caller_stopped"
        : "";
  const lines = [f.head(label, score)];
  if (termKey) lines.push(termCopy[termKey]);
  if (iterLine) lines.push(iterLine);
  lines.push("", f.finalReport, "", analysis);
  if (audit) lines.push("", "---", "", f.finalAudit, "", audit);
  return lines.join("\n");
}

export const consensusTool: ToolDefinition = {
  name: "nexus_consensus",
  description:
    "MULTI-AGENT CONSENSUS NODE A ↔ NODE B. Node A (the analyst) produces the report and the " +
    "Node B (adversarial auditor) validates it; if B finds discrepancies (deterministic veto), " +
    "A re-evaluates taking B's feedback on board and B audits again, until FULL or PARTIAL " +
    "CONSENSUS (max. 2 iterations). Returns final report + final audit + consensus verdict, " +
    "with deterministic citation verification against the official corpus. `jurisdiction` is " +
    "REQUIRED (no default). LONG OPERATION: 3-6 minutes of streaming (this stdio client has " +
    "no 60s limit unlike the remote connector, so the call waits for the complete result). " +
    "USE WHEN: the user wants the analysis with the strongest guarantee (analyst + auditor in " +
    "a loop) in a single call. Cost: ~3-7 credits depending on iterations.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    // SSE directo contra la ruta interna (mismo patrón que nexus_audit), con
    // techo de tiempo propio del consenso.
    const consensusCfg = { ...cfg, timeoutMs: Math.max(cfg.timeoutMs, CONSENSUS_TIMEOUT_MS) };
    const r = await streamSse(consensusCfg, "/api/nodo-consensus", args);
    const lang = resolveToolLang(args.language, args.jurisdiction);
    const composed = composeConsensusText(r.structuredEvents.find((e) => e.type === "done"), lang);
    if (!composed) {
      // Inglés + código estable: lo lee el cliente, no una persona (mismo criterio
      // que los errores de job del conector remoto — lib/mcp/jobs.ts).
      throw new Error(
        "CONSENSUS_NO_RESULT: The backend returned no consensus result (stream without a valid done event). Retry.",
      );
    }
    // PARIDAD de render con el resto de tools SSE (anti-fabricación de bloques
    // NORMATIVA_VIGENTE + anotación inline H9 + resumen determinista de citas).
    return { content: renderSseText(composed, r.citationChecks, lang), logs: r.logs };
  },
};
