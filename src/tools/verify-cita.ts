import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  cita: z.string().describe("Citation to verify, e.g. 'STS 1234/2024', 'Art. 400 LEC', or 'T-842 de 2019'"),
  texto_citante: z.string().optional().describe("Surrounding text where the citation appears (improves accuracy)"),
  tipo: z.enum(["jurisprudencia", "normativa", "auto"]).default("auto").describe("Citation type — use 'auto' to detect automatically"),
  // Jurisdicción del corpus contra el que verificar. Opcional y SIN default:
  // cada jurisdicción con corpus cableado (ES, CO, …) es una entrada hermana;
  // ninguna se privilegia en el cliente. Si se omite, el backend decide según su
  // propio contrato (p.ej. deriva la jurisdicción del ECLI en jurisprudencia).
  jurisdiction: z
    .string()
    .optional()
    .describe(
      "Optional ISO jurisdiction code of the corpus to verify against (e.g. 'ES', 'CO'). " +
      "Sibling entries — no jurisdiction is privileged. Omit to let the backend infer it " +
      "(e.g. from the ECLI). Jurisdictions without a wired verification corpus return an honest 'not available' status.",
    ),
});

/**
 * Contrato real de las rutas v1 (ver app/api/v1/{jurisprudencia,normativa}/verify-cita/route.ts).
 * jurisprudencia.citation → { type, ecli, roj, tribunal, ... }
 * normativa.citation      → { alias, articulo, norma_id, norma_titulo }
 * vigente_a_fecha / derogated (status==='derogated') solo aplican a normativa.
 */
interface VerifyCitaResponse {
  status: string;
  citation?: {
    type?: string;
    ecli?: string | null;
    roj?: string | null;
    tribunal?: string | null;
    alias?: string | null;
    articulo?: string | null;
    norma_id?: string | null;
    norma_titulo?: string | null;
  } | null;
  canonical_text?: string | null;
  url?: string | null;
  similarity?: number | null;
  vigente_a_fecha?: string | null;
  /** Fecha que se PREGUNTÓ. Siempre presente; `vigente_a_fecha` solo si se acotó por ella. */
  consultado_a_fecha?: string | null;
  vigencia_status?: string | null;
  status_evidence?: string | null;
  note?: string | null;
}

/**
 * Heurística para 'auto': decide si una cita es normativa (artículo/ley/decreto)
 * o jurisprudencia (sentencia/auto). El orden importa: los marcadores de norma se
 * comprueban primero (una "Ley 15/2022" lleva número/año pero es normativa).
 *
 * Multi-jurisdiccional: los marcadores no privilegian ningún país. Se reconocen
 * formatos de sentencia de varias jurisdicciones — p.ej. el formato de la Corte
 * Constitucional de Colombia ('T-842 de 2019', 'C-355 de 2006', 'SU-123 de 2020'),
 * que no lleva ECLI ni número/año con barra — para que enruten a jurisprudencia.
 */
/** Forma estatutaria del Commonwealth: «section 214 of the Insolvency Act 1986», «s 1 Theft Act 1968». */
const COMMONWEALTH_SECCION = /\b(?:sections?|ss?\.?)\s*\d{1,4}[A-Z]{0,2}\b/i;
/**
 * Nombre de instrumento con año. Incluye STATUTORY INSTRUMENTS (Regulations/Rules/Order):
 * solo decía `Act|Code|Charter|Ordinance` y `reg 13 of the Working Time Regulations 1998`
 * acababa en el verificador de sentencias. Ver `lib/mcp/detect-cita-tipo.ts` — GEMELO.
 */
const COMMONWEALTH_LEY = /\b\(?[A-Z][A-Za-z'’()-]*(?:\s+(?:\(?[A-Z][A-Za-z'’()-]*|and|of|the|for|in))*\s+(?:Act|Code|Charter|Ordinance|Regulations?|Rules|Order|Measure|Scheme)\s+\d{4}\b/;
/** Escocia: «Act of Sederunt», «Act of Adjournal» no siguen la forma nombre+instrumento+año. */
const ESCOCIA_ACTO = /\bAct\s+of\s+(?:Sederunt|Adjournal)\b/i;
/**
 * Una cita de tribunal manda sobre el nombre de una ley: `Re Companies Act 2006 [2019] EWHC
 * 12 (Ch)` es un CASO. Se comprueba ANTES que cualquier léxico.
 */
const CITA_DE_TRIBUNAL = /\[\d{4}\]\s+[A-Z][A-Za-z]*(?:\s+\(?[A-Za-z]+\)?)?\s+\d{1,5}\b/;

function detectCitaTipo(cita: string): "jurisprudencia" | "normativa" {
  const c = cita.toLowerCase();
  // Antes que nada: una cita de tribunal manda sobre cualquier léxico.
  if (CITA_DE_TRIBUNAL.test(cita)) {
    return "jurisprudencia";
  }
  // NORMATIVA: artículo, ley, decreto, reglamento, código, directiva, abreviaturas comunes
  if (/\bart\b|\bart[íi]culos?\b|art\.|\bley\b|\bl\.?o\.?\b|real\s+decreto|\br\.?d\.?\b|reglamento|\bc[óo]digo\b|directiva|\b(lec|lecrim|et|lgss|lgt|lopdgdd|rgpd|gdpr)\b/i.test(c)) {
    return "normativa";
  }
  // NORMATIVA (Commonwealth: GB, SG…). Contra el ORIGINAL, no contra `c`: el nombre de la
  // ley se reconoce por las mayúsculas, y en minúsculas se comería media frase.
  // 🔴 GEMELO de `lib/mcp/detect-cita-tipo.ts`, con candado que compara los CUERPOS.
  if (COMMONWEALTH_SECCION.test(cita) || COMMONWEALTH_LEY.test(cita) || ESCOCIA_ACTO.test(cita)) {
    return "normativa";
  }
  // JURISPRUDENCIA (formatos con letra-número + año, p.ej. Corte Constitucional CO):
  // 'T-842 de 2019', 'C-355 de 2006', 'SU-123 de 2020', 'A-123 de 2021'.
  if (/\b(su|[tced]|a)-?\s?\d+\s+de\s+\d{4}\b/i.test(c)) {
    return "jurisprudencia";
  }
  // JURISPRUDENCIA: sentencia/auto/resolución + abreviaturas de tribunal o número/año
  if (/\b(sts|stc|sap|san|atc|ats|sjpi|sentencia|auto|resoluci[óo]n|caso)\b|\b\d+\/\d{2,4}\b/i.test(c)) {
    return "jurisprudencia";
  }
  // Por defecto, jurisprudencia (comportamiento previo de 'auto').
  return "jurisprudencia";
}

export const verifyCitaTool: ToolDefinition = {
  name: "verify_cita",
  description:
    "Verify whether a legal citation (court judgment or statute article) is accurate. " +
    "Returns verification status, similarity score, and official source URL. " +
    "Supports multiple jurisdictions (ES, CO, …) according to the wired verification corpus, " +
    "without privileging any single one — pass `jurisdiction` to target a specific corpus, or omit " +
    "it to let the backend infer it. Jurisdictions without a wired corpus return an honest " +
    "'not available' status instead of a misleading result. " +
    "USE WHEN: the user wants to check whether a case-law or statutory citation " +
    "exists, is correct, or may be hallucinated.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);

    // 'auto' debe resolver normativa vs jurisprudencia: antes 'auto' caía SIEMPRE
    // al endpoint de jurisprudencia, dejando las citas de NORMA (artículos, leyes,
    // decretos) sin verificar. Heurística simple por marcadores.
    const resolvedTipo = args.tipo === "auto" ? detectCitaTipo(args.cita) : args.tipo;

    // Determine endpoint based on resolved tipo
    let endpoint: string;
    if (resolvedTipo === "normativa") {
      endpoint = "/api/v1/normativa/verify-cita";
    } else {
      endpoint = "/api/v1/jurisprudencia/verify-cita";
    }

    // La API v1 espera los campos en inglés: citation + claim_text
    // (no cita/texto_citante) — ver app/api/v1/*/verify-cita/route.ts.
    // `jurisdiction` es opcional: si no se aporta, se omite del body (JSON.stringify
    // descarta undefined) y el backend infiere la jurisdicción por su cuenta
    // (p.ej. del ECLI). Se envía en los dos nombres que consumen las rutas: la de
    // normativa lee `jurisdiccion`, mientras el resto acepta `jurisdiction`.
    // Ninguna jurisdicción se privilegia aquí.
    const jur = args.jurisdiction?.trim().toUpperCase() || undefined;
    const result = await postJson<VerifyCitaResponse>(cfg, endpoint, {
      citation: args.cita,
      claim_text: args.texto_citante,
      jurisdiccion: jur,
      jurisdiction: jur,
    });

    const status = result.status ?? "unknown";
    const score = result.similarity;
    const url = result.url;
    const c = result.citation ?? null;

    const lines: string[] = [
      `## Citation Verification: ${args.cita}`,
      ``,
      `**Status:** ${status}`,
    ];
    /**
     * PARIDAD con lib/mcp/registry.ts: el rótulo no puede afirmar más que la prueba. Las
     * tres ramas de no-vigencia comparten `status: "derogated"`, pero solo
     * `source_removed_text` tiene un hecho observado detrás; con `none` lo único que hay es
     * una marca del registro que nadie ha corroborado.
     */
    if (status === "derogated") {
      lines.push(result.status_evidence === "none"
        ? `**⚠️ Recorded as not in force, WITHOUT independent proof.** The official register flags the provision, but we could not corroborate that against its text. Treat it as a prompt to check, not as an established fact.`
        : `**⚠️ Repealed instrument:** the provision exists but is not in force at the date queried.`);
    }
    if (score !== undefined && score !== null) lines.push(`**Similarity score:** ${(Number(score) * 100).toFixed(1)}%`);
    // Rótulo fijo anti-malentendido (E2E r5, PARIDAD con lib/mcp/registry.ts): la
    // divergencia compara TEXTOS (tu claim vs literal del corpus), no es un juicio
    // de existencia/vigencia. Solo si hay similarity (implica que hubo claim).
    if (status === "mismatch" && score !== undefined && score !== null) {
      lines.push(`Note: the divergence compares YOUR citing text against the corpus literal — it does NOT question the existence or the in-force status of the provision.`);
    }

    // Citation parseada: tribunal (juris) o norma_titulo/artículo (normativa).
    if (c?.tribunal) lines.push(`**Tribunal:** ${c.tribunal}`);
    if (c?.norma_titulo) lines.push(`**Instrument:** ${c.norma_titulo}${c.articulo ? ` — s. ${c.articulo}` : ""}`);
    else if (c?.articulo) lines.push(`**Provision:** ${c.articulo}`);

    /**
     * PARIDAD con lib/mcp/registry.ts: `vigente_a_fecha` era la fecha que mandó el
     * cliente, devuelta tal cual, y se imprimía como si fuera una comprobación. La ruta
     * v1 solo la rellena cuando la consulta estuvo acotada a esa fecha.
     */
    if (result.vigente_a_fecha) lines.push(`**In force at:** ${result.vigente_a_fecha}`);
    else if (result.consultado_a_fecha) {
      lines.push(`**Date queried:** ${result.consultado_a_fecha}`);
      if (status === "verified" || status === "mismatch") {
        lines.push(
          `⚠ **In-force status NOT checked at that date.** It has been verified that the `
          + `provision exists and that the wording is the one in the official register; NOT that `
          + `it is still in force. Confirm against the official source.`,
        );
      }
    }
    if (url) lines.push(`**Official source:** ${url}`);

    // El corte a 600 chars lleva rótulo EXPLÍCITO (E2E r5, PARIDAD con
    // lib/mcp/registry.ts): el tester leyó el "…" como si el CORPUS estuviera
    // truncado, cuando el corte es solo de esta vista. Si el propio corpus está
    // truncado (nota "TRUNCADO" del verificador), no afirmamos artículo completo.
    if (typeof result.canonical_text === "string" && result.canonical_text.trim()) {
      const cut = result.canonical_text.length > 600;
      const corpusTruncated = /TRUNCADO/.test(String(result.note ?? ""));
      lines.push(``, cut
        ? `**Canonical text** (first 600 characters of this view; ${corpusTruncated ? "see Detail on the state of the corpus" : "the corpus holds the COMPLETE provision"}): ${result.canonical_text.slice(0, 600)}…`
        : `**Canonical text:** ${result.canonical_text}`);
    }

    // Sin texto_citante no se puede contrastar concordancia semántica.
    if (!args.texto_citante) {
      lines.push(``, `_No citing text supplied: only existence is verified, not semantic agreement._`);
    }

    if (result.note) lines.push(``, `**Details:** ${result.note}`);

    return { content: lines.join("\n") };
  },
};
