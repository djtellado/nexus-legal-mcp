import { z } from "zod";
import { postJson, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

// Contrato real de POST /api/v1/verificacion/analizar (ver
// app/api/v1/verificacion/analizar/route.ts + lib/normativa/verificacion-core.ts):
// body { text, fecha?, jurisdiction? } → { fecha, total, found, not_found, derogated,
// unknown, flagged, verified_clean, review_required, counts_by_meaning, results[] }.
const inputSchema = z.object({
  text: z.string().min(20).max(50_000).describe(
    "Full text of the document to verify (min 20, max 50,000 chars). Citations are auto-detected — " +
    "statutes (art. 1902 CC, section 80 of the Employment Act 1968…) and case law ([2007] SGCA 37, STS 1234/2024…).",
  ),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(
    "Effective date to check validity against (YYYY-MM-DD). Defaults to today.",
  ),
  // Jurisdicción OPCIONAL y SIN valor por defecto: cada jurisdicción con corpus
  // cableado es una entrada hermana y ninguna se privilegia. Sin ella, cada cita se
  // enruta por su FORMA y lo que no se pueda determinar sale `unknown`.
  jurisdiction: z.string().optional().describe(
    "OPTIONAL ISO code, with NO default value. It only disambiguates a citation that is valid in " +
    "several jurisdictions (e.g. 'art. 1902 CC' → ES/CO). If omitted, the backend infers each " +
    "citation's jurisdiction from its FORM; nothing falls back to Spain.",
  ),
  // Idioma del INFORME que se devuelve aquí (no del documento verificado). Si no
  // viene, lo decide la jurisdicción del argumento; jamás castellano por defecto.
  language: z.string().optional().describe(
    "Language of THIS report (ISO 639-1). If omitted it follows `jurisdiction`; it never defaults to " +
    "Spanish. Today only 'es' and 'en' have a dictionary — any other language falls back to English.",
  ),
});

interface VerificacionResult {
  raw:                 string;
  alias:               string | null;
  norma_label:         string | null;
  numero_articulo:     string;
  status:              "found" | "not_found" | "derogated" | "unknown";
  /** «partial» = identidad a medias: señala la fila SIN `meaning` (API v1.40.0). */
  party_check?: string | null;
  /**
   * ¿Se estableció que la provisión SIGUE EN VIGOR, o solo que existe en el corpus?
   * Ausente = solo existencia, y entonces el rótulo NO puede decir «vigente». Es el
   * mismo animal que `meaning` de más abajo: un veredicto no se deriva de `status` a
   * solas, y esta superficie ya se llevó una vez el fallo renderizado como éxito.
   */
  vigencia_verificada?: true;
  vigencia_desde?: string | null;
  vigencia_hasta?: string | null;
  canonical_text:      string | null;
  canonical_truncated: boolean;
  url:                 string | null;
  context:             string;
  /**
   * Reproche sobre una cita que SÍ existe en el corpus (por eso llega `status:"found"`).
   *
   * 🔴 UNA FILA CON `meaning` NO ES UNA CITA LIMPIA. El par de lectura obligatorio es
   * (`status`, `meaning`): nadie puede derivar rótulo ni veredicto de `status` a solas.
   *
   * Este tipo declaraba DOS valores cuando el motor ya emitía TRES. Al no estar
   * `other_case` aquí, TypeScript no avisó de que el formateador se lo dejaba fuera y
   * la cita transpuesta («Spandeck … [2007] SGHC 37», que resuelve a otra sentencia)
   * salía por esta superficie rotulada «✅ VIGENTE». Un fallo renderizado como éxito.
   * Mantener la unión al día es lo que hace que el compilador avise del CUARTO valor.
   */
  meaning?:            "diverges" | "paraphrase" | "other_case";
  /**
   * El reproche VERBATIM del motor (`lib/verify/citation-core.ts` → `mismatchKind`).
   * `meaning` lo colapsa: `stitched` y `lexical` caen los dos en "paraphrase", y sin
   * este campo el formateador acusa de parafrasear a una cita literal mal ensamblada.
   */
  mismatch_kind?:      "lexical" | "meaning" | "stitched" | "party";
  /** Por qué salió `unknown`: sin corpus con el que comprobar, o comprobación caída. */
  unknown_reason?:     "not_verifiable" | "error";
  /** Explicación del verificador: por qué no pudo comprobarla, o cuál es la cita buena. */
  note?:               string | null;
  kind?:               "norma" | "jurisprudencia";
}

interface VerificacionResponse {
  fecha:     string;
  total:     number;
  found:     number;
  not_found: number;
  derogated: number;
  unknown:   number;
  results:   VerificacionResult[];
  /**
   * Desglose de `found`, que SIGUE contando las señaladas (la cita existe, y eso es
   * cierto también cuando apunta a otra sentencia). Invariante del núcleo:
   * `found === verified_clean + flagged`. Opcionales por defensa: si un backend viejo
   * no los manda, se recalculan aquí desde `results` — nunca se dan por cero, porque
   * un cero por ausencia de campo es exactamente el falso verde que se está cerrando.
   */
  flagged?:        number;
  verified_clean?: number;
  /** ¿Puede el integrador seguir sin mirar? Incluye huecos: `unknown` y no comprobadas. */
  review_required?: boolean;
  counts_by_meaning?: { other_case: number; diverges: number; paraphrase: number };
  /** Jurisdicciones con verificador cableado hoy. */
  verifiable_jurisdictions?: string[];
  citations_detected?: number;
  citations_checked?:  number;
  /** Presente SOLO cuando el tope por petición recortó. */
  citations_truncated?: {
    code: string; limit: number; detected: number; checked: number;
    unchecked: number; message: string;
  };
}

// ── COPY del informe (es/en). PARIDAD con `VERIFICACION_COPY` del connector remoto
//    (lib/mcp/registry.ts) — si cambias uno, cambia el otro. Este paquete se PUBLICA:
//    un despacho de Singapur que instala @nexus-legal/mcp recibía el informe entero en
//    castellano. El idioma lo decide `language` y, si no viene, la jurisdicción del
//    argumento; sin ninguno de los dos, inglés — jamás castellano por defecto.
interface VerificacionCopy {
  head:      (fecha: string) => string;
  hoy:       string;
  counts:    (detected: unknown, checked: unknown) => string;
  totals:    (clean: number, flagged: number, notFound: number, derogated: number, unknown_: number, soloExistencia: boolean) => string;
  review:    string;
  clean:     string;
  /** Cero citas detectadas NO es un certificado de limpieza. */
  noCitations: string;
  limit:     (message: string) => string;
  scope:     (list: string) => string;
  none:      string;
  norma:     string;
  detalle:   string;
  reproche:  string;
  canonical: (cut: boolean) => string;
  fuente:    string;
  // Rótulos de estado. `found` se parte por `kind`: "VIGENTE" sobre una SENTENCIA es
  // un error de categoría que además disfraza el hueco (una resolución no está "en
  // vigor", existe o no existe).
  stFoundNorma:    string;
  /** `found` sin vigencia establecida: existe en el corpus y nadie ha mirado si rige. */
  stFoundSoloExiste: string;
  stFoundJuris:    string;
  stNotFound:      string;
  stDerogated:     string;
  stUnknown:       string;
  stUnknownError:  string;
  stNotVerifiable: string;
  // Rótulos de cita SEÑALADA (`status:"found"` + `meaning`).
  stOtherCase:  string;
  stDiverges:   string;
  stParaphrase: string;
  stStitched:   string;
  /** Fallback SEGURO para un `meaning` que este paquete aún no conoce. */
  stFlagged:    string;
  /** Señalada pero SIN reproche: el hueco es NUESTRO, no un defecto de la cita. */
  stIdentidadSinContrastar: string;
  /** Qué le reprocha el motor a la cita, por `mismatch_kind`. */
  mkNote: Record<"lexical" | "meaning" | "stitched" | "party", string>;
}

const VERIFICACION_COPY: Record<string, VerificacionCopy> = {
  es: {
    head:   (fecha) => `## Verificación de citas (vigente a ${fecha})`,
    hoy:    "hoy",
    // Halladas y comprobadas van SIEMPRE las dos, aunque coincidan: "100 citas ·
    // 100 verificadas" sobre un escrito de 140 es una cifra correcta que se lee
    // como "todas".
    counts: (detected, checked) => `**Citas halladas:** ${detected}  ·  **comprobadas:** ${checked}`,
    totals: (clean, flagged, notFound, derogated, unknown_, soloExistencia) =>
      `✅ ${clean} ${soloExistencia ? "existen (sin reproche; redacción NO comparada)" : "verificadas sin reproche"}  ·  ⛔ ${flagged} señaladas  ·  ❌ ${notFound} no encontradas  ·  ` +
      `⚠️ ${derogated} derogadas  ·  ❓ ${unknown_} sin comprobar`,
    review:
      `> ⛔ **REVISIÓN REQUERIDA.** Este documento trae citas señaladas, no encontradas, derogadas o sin ` +
      `comprobar. Mira una por una las de abajo antes de usarlo.`,
    clean:
      `> ✅ **Sin reproches.** Todas las citas detectadas se comprobaron y ninguna quedó señalada.`,
    noCitations:
      `> ⚠️ **NINGUNA CITA DETECTADA.** Esto NO es un certificado de limpieza: el escrito puede invocar ` +
      `autoridad sin citarla en una forma reconocible, o ser de una jurisdicción fuera del alcance de abajo.`,
    limit:  (message) => `> ⚠️ **TOPE ALCANZADO.** ${message}`,
    scope:  (list) =>
      `_Verificador activo en: ${list}. Las citas de otras jurisdicciones se entregan SIN comprobar — ` +
      `eso no dice nada sobre si existen._`,
    none:      "No se detectaron citas reconocibles en el texto.",
    norma:     "**Norma:**",
    detalle:   "**Detalle del verificador:**",
    reproche:  "**Qué falla:**",
    canonical: (cut) => `**Texto canónico${cut ? " (extracto — ver URL para el completo)" : ""}:**`,
    fuente:    "**Fuente oficial:**",
    stFoundNorma:    "✅ VIGENTE",
    stFoundSoloExiste: "✅ EXISTE (vigencia NO comprobada)",
    stFoundJuris:    "✅ LOCALIZADA EN EL CORPUS (la resolución existe)",
    stNotFound:      "❌ NO CONSTA EN EL CORPUS (compruébala en la fuente oficial: puede ser una referencia errónea o un hueco de cobertura)",
    stDerogated:     "⚠️ DEROGADA (existió, no vigente a la fecha)",
    // "ALIAS NO RECONOCIDO" era un motivo inventado: `unknown` también recoge la cita
    // de una jurisdicción sin corpus cableado y la cita cuya comprobación se cayó.
    // Decirle a un despacho que su cita de Singapur tiene "el alias no reconocido"
    // manda a mirar donde no hay nada.
    stUnknown:       "❓ NO COMPROBADA",
    stUnknownError:  "❓ COMPROBACIÓN CAÍDA (no llegó a ejecutarse — reintenta; NO es un veredicto sobre la cita)",
    stNotVerifiable: "❓ NO VERIFICABLE (sin corpus con el que contrastarla — NO significa que no exista)",
    stOtherCase:     "⛔ RESUELVE A OTRA RESOLUCIÓN (la cita existe, pero no es el caso que nombras)",
    stDiverges:      "⚠️ SENTIDO DIVERGENTE (la cita existe; el texto oficial no dice lo que se le atribuye)",
    stParaphrase:    "⚠️ PARÁFRASIS NO CONTRASTADA LITERALMENTE",
    stStitched:      "⚠️ CITA ENSAMBLADA (los fragmentos son literales, pero no forman un pasaje continuo del texto oficial)",
    stFlagged:       "⛔ CITA SEÑALADA — revísala en la fuente oficial antes de usarla",
    stIdentidadSinContrastar: "⚠️ IDENTIDAD SIN CONTRASTAR — la resolución EXISTE, pero no hemos podido comprobar que sea la que nombras: nuestro registro no trae su carátula. NO es un defecto de tu cita, es un hueco nuestro.",
    mkNote: {
      party:    "El defecto es de IDENTIDAD de la autoridad: la referencia devuelve otra resolución distinta de la que nombra el documento. No es una paráfrasis. Identifica la resolución antes de citarla.",
      meaning:  "El texto oficial no sostiene lo que la cita le atribuye. Contrasta el pasaje antes de apoyarte en él.",
      stitched: "Los fragmentos citados son literales, pero no forman un pasaje continuo del texto oficial. Contrástalo en la fuente antes de usarlo.",
      lexical:  "No se contrastó palabra por palabra contra el texto oficial: repásala tú contra la fuente.",
    },
  },
  en: {
    head:   (fecha) => `## Citation verification (in force as of ${fecha})`,
    hoy:    "today",
    counts: (detected, checked) => `**Citations found:** ${detected}  ·  **checked:** ${checked}`,
    totals: (clean, flagged, notFound, derogated, unknown_, soloExistencia) =>
      `✅ ${clean} ${soloExistencia ? "exist (no objection; wording NOT compared)" : "verified with no reproach"}  ·  ⛔ ${flagged} flagged  ·  ❌ ${notFound} not found  ·  ` +
      `⚠️ ${derogated} repealed  ·  ❓ ${unknown_} not checked`,
    review:
      `> ⛔ **REVIEW REQUIRED.** This document carries citations that are flagged, not found, repealed or ` +
      `unchecked. Go through the ones below one by one before relying on it.`,
    clean:
      `> ✅ **No reproaches.** Every citation detected was checked and none came back flagged.`,
    noCitations:
      `> ⚠️ **NO CITATIONS DETECTED.** This is NOT a clean bill of health: the document may invoke ` +
      `authority without citing it in a recognisable form, or belong to a jurisdiction outside the scope below.`,
    limit:  (message) => `> ⚠️ **LIMIT REACHED.** ${message}`,
    scope:  (list) =>
      `_Verifier active in: ${list}. Citations from any other jurisdiction are returned WITHOUT being ` +
      `checked — that says nothing about whether they exist._`,
    none:      "No recognisable citations were detected in the text.",
    norma:     "**Instrument:**",
    detalle:   "**Verifier details:**",
    reproche:  "**What is wrong:**",
    canonical: (cut) => `**Canonical text${cut ? " (extract — see the URL for the full text)" : ""}:**`,
    fuente:    "**Official source:**",
    stFoundNorma:    "✅ IN FORCE",
    stFoundSoloExiste: "✅ EXISTS (in-force status NOT checked)",
    stFoundJuris:    "✅ FOUND IN THE CORPUS (the decision exists)",
    stNotFound:      "❌ NOT IN THE CORPUS (check it at the official source: it may be an erroneous reference or a coverage gap)",
    stDerogated:     "⚠️ REPEALED (it existed, not in force on that date)",
    stUnknown:       "❓ NOT CHECKED",
    stUnknownError:  "❓ CHECK DID NOT RUN (it never completed — retry; this is NOT a verdict on the citation)",
    stNotVerifiable: "❓ NOT VERIFIABLE (no corpus to check it against — it does NOT mean it does not exist)",
    stOtherCase:     "⛔ RESOLVES TO ANOTHER DECISION (the citation exists, but it is not the case you name)",
    stDiverges:      "⚠️ DIVERGENT MEANING (the citation exists; the official text does not say what is attributed to it)",
    stParaphrase:    "⚠️ PARAPHRASE NOT LITERALLY CHECKED",
    stStitched:      "⚠️ ASSEMBLED QUOTE (the fragments are literal, but they do not form a continuous passage of the official text)",
    stFlagged:       "⛔ FLAGGED CITATION — check it at the official source before relying on it",
    stIdentidadSinContrastar: "⚠️ IDENTITY NOT CONTRASTED — the decision EXISTS, but we could not check that it is the one you name: our record holds no case name for it. This is NOT a defect in your citation, it is a gap on our side.",
    mkNote: {
      party:    "The defect is one of IDENTITY of the authority: the reference returns a decision other than the one the document names. It is not a paraphrase. Identify the decision before citing it.",
      meaning:  "The official text does not support what the citation attributes to it. Check the passage before relying on it.",
      stitched: "The quoted fragments are literal, but they do not form a continuous passage of the official text. Check it at the source before using it.",
      lexical:  "It was not checked word by word against the official text: review it yourself against the source.",
    },
  },
};

/** es/en con caída a EN para idiomas sin diccionario (misma regla que el resto del paquete). */
function copyFor(lang: string): VerificacionCopy {
  return VERIFICACION_COPY[lang] ?? VERIFICACION_COPY.en;
}

/**
 * ¿Esta fila está SEÑALADA? Copia del predicado ÚNICO del núcleo
 * (`lib/normativa/verificacion-core.ts` → `isFlagged`); este paquete es npm aparte y
 * no puede importarlo. Si cambias uno, cambia el otro.
 */
const isFlagged = (c: VerificacionResult): boolean =>
  c.status === "found" && (!!c.meaning || c.party_check === "partial");

/** Etiqueta afinada con lo que el resultado sí sabe de sí mismo. */
function statusLabel(c: VerificacionResult, t: VerificacionCopy): string {
  // Las SEÑALADAS van primero y salen de `meaning`, no de `status`. Una cita señalada
  // llega como `found` —la cita EXISTE— con el reproche aparte; pintarla "✅ VIGENTE"
  // convierte el hallazgo del candado en un visto bueno. Es el mismo falso verde que se
  // corrigió en la pantalla y que por MCP seguía saliendo (medido en producción
  // 2026-07-27 con «Spandeck … [2007] SGHC 37», que resuelve a otra sentencia).
  if (c.status === "found" && c.meaning === "other_case")  return t.stOtherCase;
  if (c.status === "found" && c.meaning === "diverges")    return t.stDiverges;
  if (c.status === "found" && c.meaning === "paraphrase") {
    // `paraphrase` colapsa DOS reproches distintos. Una cita ensamblada es literal:
    // acusarla de parafrasear es una acusación falsa.
    return c.mismatch_kind === "stitched" ? t.stStitched : t.stParaphrase;
  }
  // Fallback SEGURO, y es el que mata la CLASE de fallo: un `meaning` que este paquete
  // todavía no conoce (el motor añadió un cuarto valor) NO puede caer al verde. Se
  // rotula como señalada y se manda a mirar, que es lo cierto en cualquier caso.
  if (c.status === "found" && c.meaning) return t.stFlagged;
  /**
   * PARIDAD: `unavailable` deja de contar como cita limpia (v1.60.0) pero NO se acusa. El
   * abogado escribió el nombre del caso; somos nosotros los que no tenemos la carátula.
   */
  if (c.status === "found" && c.party_check === "unavailable") return t.stIdentidadSinContrastar;
  if (c.status === "unknown" && c.unknown_reason === "error")          return t.stUnknownError;
  if (c.status === "unknown" && c.unknown_reason === "not_verifiable") return t.stNotVerifiable;
  /**
   * 🔴 PARIDAD con lib/mcp/registry.ts. `found` = «existe en el corpus», NO «está en
   * vigor». Este paquete sellaba «✅ IN FORCE» sobre cualquier provisión británica que
   * existiera, mientras el `note` del mismo informe decía «this is NOT a statement that
   * the provision is in force». Aquí no hay vuelta atrás posible —el paquete no puede
   * importar el verificador—, así que el hecho tiene que venir en la fila. Ausente = solo
   * existencia, que es lo conservador y lo que protege a quien se lo instala.
   */
  const byStatus: Record<string, string> = {
    // Una SENTENCIA no está "vigente": existe o no existe.
    found:     c.kind === "jurisprudencia" ? t.stFoundJuris
             : c.vigencia_verificada === true ? t.stFoundNorma
             : t.stFoundSoloExiste,
    not_found: t.stNotFound,
    derogated: t.stDerogated,
    unknown:   t.stUnknown,
  };
  return byStatus[c.status] ?? String(c.status);
}

/**
 * Render del informe. Función PURA y exportada a propósito: el candado de superficies
 * («una cita señalada no sale limpia en ninguna superficie») tiene que poder ejecutar
 * ESTE formateador, no leer su código fuente.
 *
 * `lang` = idioma ya resuelto (es/en; el resto cae a EN).
 */
export function formatVerificacion(result: VerificacionResponse, lang = ""): string {
  const t = copyFor(lang);
  const results = result.results ?? [];
  const detected = result.citations_detected ?? result.total ?? results.length;
  const checked  = result.citations_checked  ?? result.total ?? results.length;

  // Desglose de `found`, que SIGUE contando las señaladas. Los agregados del backend NO
  // se toman a ciegas: se cruzan con lo que se ve en `results`, y en las señaladas manda
  // el MAYOR. Un `flagged` ausente (backend viejo) o corto vale exactamente lo mismo que
  // el falso verde que se está cerrando, y aquí la duda tiene que caer del lado de mirar.
  const found     = result.found ?? 0;
  const flagged   = Math.max(result.flagged ?? 0, results.filter(isFlagged).length);
  // `verified_clean` se DERIVA, no se copia: es el número que pinta de verde, y el core
  // garantiza la invariante `found === verified_clean + flagged`.
  const clean     = Math.max(0, found - flagged);
  const notFound  = result.not_found ?? 0;
  const derogated = result.derogated ?? 0;
  const unknown   = result.unknown ?? 0;
  const unchecked = result.citations_truncated?.unchecked ?? 0;
  // Un hueco no es una cita limpia: lo no comprobado y lo que no cupo cuentan.
  const reviewRequired = result.review_required === true
    || flagged > 0 || notFound > 0 || derogated > 0 || unknown > 0 || unchecked > 0;

  // El titular tiene que decir la verdad, y es lo primero que lee un agente: la
  // cabecera de un documento con una cita transpuesta decía `found: 1, not_found: 0`.
  // Y "sin reproches" solo se puede decir cuando ha habido algo que reprochar: sobre
  // un documento del que no se extrajo ninguna cita, el verde certifica el vacío.
  const headline = reviewRequired ? t.review : results.length === 0 ? t.noCitations : t.clean;

  const lines: string[] = [
    t.head(String(result.fecha || t.hoy)),
    ``,
    t.counts(detected, checked),
    // 🔴 CUARTA copia del mismo patrón. El detalle de cada cita ya decía «CONTENT NOT
    // CHECKED» y el recuento de arriba la llamaba «verificada sin reproche», en la misma
    // pantalla. Se lee el campo `content_checked` (API desde c69b3669), no la prosa.
    t.totals(clean, flagged, notFound, derogated, unknown,
      results.some((r) => (r as { content_checked?: boolean }).content_checked === false)),
    ``,
    headline,
  ];

  // El tope por petición se DECLARA. Las citas que no cupieron no salen en `results`
  // ni en ningún contador: su ausencia se leía como ausencia de problemas, que es justo
  // lo contrario de lo que significa.
  if (result.citations_truncated) {
    lines.push(``, t.limit(result.citations_truncated.message));
  }

  // Alcance del verificador: sin esto, un "0 citas" o un "sin comprobar" sobre un
  // escrito de una jurisdicción que no cubrimos se lee como documento limpio.
  if (result.verifiable_jurisdictions?.length) {
    lines.push(``, t.scope(result.verifiable_jurisdictions.join(", ")));
  }

  if (results.length === 0) {
    lines.push(``, t.none);
    return lines.join("\n");
  }

  results.forEach((c, i) => {
    const label = statusLabel(c, t);
    const cita = c.alias ? `Art. ${c.numero_articulo} ${c.alias}` : c.raw;
    lines.push(``, `### ${i + 1}. ${cita} — ${label}`);
    if (c.norma_label) lines.push(`${t.norma} ${c.norma_label}`);
    // Qué le reprocha el motor, con su nombre. Sin esto, `stitched` y `lexical` —que
    // no significan lo mismo— salen con el mismo texto.
    if (isFlagged(c) && c.mismatch_kind && t.mkNote[c.mismatch_kind]) {
      lines.push(`${t.reproche} ${t.mkNote[c.mismatch_kind]}`);
    }
    // La nota es donde el verificador explica por qué no pudo comprobarla o CUÁL es la
    // cita buena («[2007] SGCA 37 sí coincide con el caso que nombras»): el dato más
    // accionable del hallazgo. Se perdía por completo en esta superficie.
    if (c.note) lines.push(`${t.detalle} ${c.note}`);
    if (c.canonical_text && c.canonical_text.trim()) {
      const cut = c.canonical_truncated === true;
      lines.push(`${t.canonical(cut)} ${c.canonical_text}${cut ? "…" : ""}`);
    }
    if (c.url) lines.push(`${t.fuente} ${c.url}`);
  });

  return lines.join("\n");
}

export const verificacionTool: ToolDefinition & {
  format: (result: VerificacionResponse, lang?: string) => string;
} = {
  name: "nexus_verificacion",
  description:
    "Verify a document's citations —LEGISLATION and CASE LAW— against the corpus of their jurisdiction. " +
    "Auto-detects the citations in the text (art. 1902 CC; section 80 of the Employment Act 1968; " +
    "[2007] SGCA 37…), checks force/repeal/existence at a given date and returns a structured " +
    "per-citation report with canonical text and the official source URL where there is one. " +
    "Deterministic, no LLM cost. " +
    // La descripción prometía `not_found` para las citas de otras jurisdicciones.
    // Eso no es lo que hace el motor y no es lo que debe hacer: `not_found` acusa de
    // fabricar jurisprudencia y se reserva a lo contrastado contra corpus ACTIVO.
    // Sin corpus, el veredicto es "no comprobada" y así se devuelve.
    "SCOPE: MULTI-JURISDICTIONAL. Each citation is routed by its FORM to its own verifier; there is NO " +
    "default jurisdiction and nothing falls back to Spain. The response declares " +
    "`verifiable_jurisdictions` — citations from any other jurisdiction come back as 'unknown' " +
    "(NOT checked), never as 'not_found'; check that list before reading a `total:0` as a clean document. " +
    "READING THE RESULT: `found` means the citation EXISTS — which is also true when it resolves to a " +
    "DIFFERENT decision. Never derive a verdict from `status` alone: read (`status`, `meaning`), or the " +
    "aggregate `flagged` / `review_required`. " +
    "USE WHEN: auditing a document before filing it, or detecting " +
    "hallucinated citations in a text. The PDF dossier export is NOT exposed as a tool (binary); " +
    "it is only available from the web UI.",
  inputSchema,
  format: formatVerificacion,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const jur = args.jurisdiction?.trim().toUpperCase() || undefined;

    const result = await postJson<VerificacionResponse>(cfg, "/api/v1/verificacion/analizar", {
      text:  args.text,
      // fecha/jurisdiction undefined se descartan en JSON.stringify → el backend usa
      // hoy y enruta cada cita por su forma.
      ...(args.fecha ? { fecha: args.fecha } : {}),
      ...(jur ? { jurisdiction: jur } : {}),
    });

    return { content: formatVerificacion(result, resolveToolLang(args.language, jur)) };
  },
};
