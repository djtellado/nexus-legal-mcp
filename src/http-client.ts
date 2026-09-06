/**
 * Cliente HTTP para hablar con el backend Nexus.
 * Dos modos:
 *   · streamSse(path, body) — consume Server-Sent Events y devuelve el
 *     texto agregado + outputId opcional cuando recibimos `done`.
 *   · postJson(path, body) — POST normal, devuelve el JSON parseado.
 *
 * Ambos modos añaden `Authorization: Bearer nlk_...` automáticamente.
 */

import type { Config } from "./config.js";
import { stripLlmNormativaBlocks } from "./normativa-filter.js";

export class NexusHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly bodyExcerpt?: string,
    /**
     * Código estable del backend (`BYO_PROVIDER_REQUIRED`, `INSUFFICIENT_CREDITS`,
     * `PROVIDER_UNREACHABLE`…) cuando la respuesta lo trae. Es lo único con lo que
     * quien lee puede distinguir "tu cuenta está configurada así" de "se nos ha
     * caído algo", y hasta ahora se perdía: el cuerpo se volcaba crudo y el frame
     * SSE de error se tiraba entero salvo el texto.
     */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "NexusHttpError";
  }
}

/**
 * Lee el envelope de error estable del backend (`lib/api-auth/api-error.ts` →
 * `{error:{type,code,message},code,error_message}`, o el `{error,code}` plano de
 * las rutas internas) y devuelve `{code,message}`. `null` si no hay código: ahí
 * no hay nada que citar.
 */
export function parseNexusError(body: string): { code: string; message: string } | null {
  if (!body || !body.trim().startsWith("{")) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const top = parsed as Record<string, unknown>;
  const nested = (top.error && typeof top.error === "object" && !Array.isArray(top.error))
    ? (top.error as Record<string, unknown>)
    : null;
  const str = (v: unknown): string => (typeof v === "string" && v.trim() ? v.trim() : "");
  const code = str(nested?.code) || str(top.code);
  if (!code) return null;
  const message =
    str(nested?.message) || str(top.error_message) || str(top.message) || (nested ? "" : str(top.error));
  return { code, message: message.slice(0, 1200) };
}

/**
 * Construye el NexusHttpError de una respuesta HTTP no-ok leyendo el código y la
 * redacción del backend cuando existen. Antes se emitía siempre
 * `Nexus backend respondió 409 Conflict en /api/...` + un volcado crudo de JSON:
 * el estado NORMAL de una cuenta que solo corre en su propio motor (409
 * `BYO_PROVIDER_REQUIRED`) se leía como avería nuestra, y la acción que el backend
 * SÍ escribe («Register and enable a provider via POST /api/v1/llm-providers, then
 * retry») quedaba enterrada en el volcado.
 */
export function httpErrorFrom(status: number, statusText: string, path: string, body: string): NexusHttpError {
  const typed = parseNexusError(body);
  if (typed) {
    return new NexusHttpError(
      status,
      `${typed.code}${typed.message ? `: ${typed.message}` : ` (HTTP ${status} on ${path}; the backend gave no message)`}`,
      body.slice(0, 500),
      typed.code,
    );
  }
  return new NexusHttpError(status, `Nexus backend responded ${status} ${statusText} on ${path}`, body.slice(0, 500));
}

/**
 * Resumen de la verificación determinista de citas que el backend emite en el
 * evento `{type:"done"}`. Mismo shape que el connector remoto
 * (`lib/mcp/registry.ts` → `McpDownstreamResult["citationChecks"]`).
 */
export interface CitationChecks {
  counts?: Record<string, number>;
  anyBroken?: boolean;
  total?: number;
  error?: boolean;
  /** Aserciones jurídicas en prosa SIN cita formal verificable (#667/H2 audit 07-18). */
  unverifiableClaims?: number;
  /** Checks individuales del summary completo (permiten la anotación INLINE H9). */
  checks?: Array<{
    citation: string; status: string; mismatchKind?: string; note?: string | null;
    /** 🔴 `false` = se comprobó que la provisión EXISTE y su REDACCIÓN nunca pasó por el
     *  comparador (toda la jurisdicción GB). `keyOfStatus` ya lo usaba para el marcador
     *  inline desde 2026-07-27; el tipo no lo declaraba y la glosa RESUMEN lo ignoraba. */
    contentChecked?: boolean;
  }>;
}

export interface SseResult {
  text:       string;
  outputId:   string | null;
  logs:       string[];
  rawEvents:  number;
  /** Verificación determinista de citas (anti-alucinación), si la ruta la emite. */
  citationChecks?: CitationChecks;
  /**
   * Cribado de partes contra listas de sanciones, si la ruta lo emite.
   *
   * 🔴 `screened` y `failed` se leen JUNTOS: `entries: []` con `failed > 0` significa que
   * nadie miró, no que estuviera limpio.
   */
  partyScreening?: {
    screened: number;
    failed: number;
    failureReason?: string;
    list?: string;
    entries: Array<Record<string, unknown>>;
  };
  /**
   * Eventos SSE tipados no textuales, en orden de llegada: jurisdiction_result/
   * jurisdiction_error/done, etc. Es el contenido real de rutas que no emiten
   * text_delta (p. ej. /api/multi-jurisdiction-compare).
   */
  structuredEvents: SseEvent[];
}

// ── Idioma del COPY de los renders (L6, doctrina de idioma 2026-07-09, nivel 2).
//    El idioma lo decide el `language` del tool-arg y, si no viene, el de la
//    JURISDICCIÓN del arg (nunca castellano por defecto). Solo es/en tienen
//    diccionario; fr/de/… caen a EN hasta traducirse.
//    PARIDAD de copy con el connector remoto (lib/mcp/registry.ts →
//    citationSummary / NORMATIVA_WARN / CITATION markers / COMPARE_CITAS) — si
//    cambias uno, cambia el otro. ──────────────────────────────────────────────

/** Selección es/en con caída a EN para idiomas sin diccionario. */
function pickLang<T>(lang: string, m: Record<string, T>): T { return m[lang] ?? m.en; }

/** Idioma por jurisdicción — PARIDAD con el registro canónico de la app
 *  (lib/jurisdictions.ts JURISDICTIONS[].language + resolveLanguage; el stdio
 *  no puede importarlo por ser paquete npm aparte). Si cambias uno, cambia el
 *  otro. Generado del registro 2026-07-10 (57 jurisdicciones). */
const JURISDICTION_LANG: Record<string, string> = Object.fromEntries(
  (Object.entries({
    es: ["ES","EU","CO","MX","AR","CL","PE","UY","PA","BO","CR","SV","NI","PY","EC","VE"],
    de: ["CH","DE","AT"], pt: ["BR","PT"], ar: ["AE","SA"],
    en: ["GB","IE","AU","IN","HK","CA","PH","MY","LK","US","SG","ZA"],
    ko: ["KR"], fr: ["FR"], it: ["IT"], nl: ["NL"], ja: ["JP"], cs: ["CZ"],
    pl: ["PL"], sv: ["SE"], fi: ["FI"], no: ["NO"], da: ["DK"], el: ["GR"],
    ro: ["RO"], hu: ["HU"], sk: ["SK"], lt: ["LT"], lv: ["LV"], et: ["EE"],
    hr: ["HR"], is: ["IS"], zh: ["TW"], th: ["TH"],
  }) as [string, string[]][]).flatMap(([lang, codes]) => codes.map((c) => [c, lang])),
);

/** Los 27 idiomas del registro (los values de JURISDICTION_LANG). */
const REGISTRY_LANGS = new Set(Object.values(JURISDICTION_LANG));

/** Idioma de CONTENIDO del render stdio: `language` explícito del tool-arg
 *  manda (solo si es un idioma del registro — como resolveLanguage); si no,
 *  el de la jurisdicción del arg; jamás "es" por defecto.
 *  Espejo de resolveLanguage (lib/jurisdictions.ts) / ctxLang (lib/mcp/registry.ts). */
export function resolveToolLang(requested: string | undefined, jurisdiction?: string): string {
  const norm = (requested ?? "").trim().toLowerCase().split("-")[0];
  if (norm && REGISTRY_LANGS.has(norm)) return norm;
  return JURISDICTION_LANG[(jurisdiction ?? "").trim().toUpperCase()] ?? "en";
}

interface CitationCopy {
  error: string;
  mismatchAgg: (mm: number) => string;
  mismatchSplit: (meaning: number, lexical: number) => string;
  body: (v: number, mismatchTxt: string, nf: number, nv: number, pending: number) => string;
  anyBroken: string;
  nvWarn: (nv: number) => string;
  mmNote: string;
  verifiedNote: string;
  /** La misma glosa cuando alguna «verificada» lo es SOLO por existencia. Obligatoria en los
   *  dos idiomas: opcional, uno caería a la que afirma una comparación que no hubo. */
  verifiedNoteExistencia: string;
}
const CITATION_COPY: Record<string, CitationCopy> = {
  es: {
    error: `\n\n---\n⚠ La verificación determinista de citas NO pudo ejecutarse (error interno). NO asumas que las citas son correctas: revísalas manualmente.`,
    mismatchAgg: (mm) => `${mm} divergentes`,
    mismatchSplit: (meaning, lexical) => `${meaning} divergencias de sentido · ${lexical} paráfrasis no contrastadas`,
    body: (v, mismatchTxt, nf, nv, pending) =>
      `\n\n---\nVERIFICACIÓN DETERMINISTA DE CITAS (contra corpus oficial): ${v} verificadas · ${mismatchTxt} · ${nf} no encontradas · ${nv} sin comprobar · ${pending} no parseables.`,
    anyBroken: ` ⚠ Hay citas con verificación fallida — revísalas antes de usar el informe.`,
    nvWarn: (nv) => ` ⚠ ${nv} cita(s) SIN comprobar: no se ha confirmado nada. El motivo va con cada una.`,
    mmNote: ` Nota: ni la divergencia ni la paráfrasis cuestionan la EXISTENCIA o VIGENCIA del artículo citado — solo comparan el texto de ESTA respuesta con el literal del corpus.`,
    verifiedNote: ` Nota: "verificada" = el texto citado coincide con el corpus oficial; NO garantiza aplicabilidad jurídica al caso (vigencia, doctrina posterior, ratio decidendi).`,
    verifiedNoteExistencia: ` Nota: "verificada" aquí = la provisión EXISTE en el corpus oficial. La REDACCIÓN que le atribuye este texto NO se ha comparado con el literal, y tampoco se garantiza aplicabilidad jurídica al caso (vigencia, doctrina posterior, ratio decidendi).`,
  },
  en: {
    error: `\n\n---\n⚠ Deterministic citation verification could NOT run (internal error). Do NOT assume the citations are correct: review them manually.`,
    mismatchAgg: (mm) => `${mm} divergent`,
    mismatchSplit: (meaning, lexical) => `${meaning} meaning divergences · ${lexical} unchecked paraphrases`,
    body: (v, mismatchTxt, nf, nv, pending) =>
      `\n\n---\nDETERMINISTIC CITATION VERIFICATION (against the official corpus): ${v} verified · ${mismatchTxt} · ${nf} not found · ${nv} not checked · ${pending} unparseable.`,
    anyBroken: ` ⚠ Some citations failed verification — review them before using this report.`,
    nvWarn: (nv) => ` ⚠ ${nv} citation(s) NOT checked: nothing was confirmed. The reason is given with each one.`,
    mmNote: ` Note: neither divergence nor paraphrase questions the EXISTENCE or VALIDITY of the cited provision — they only compare the wording of THIS answer against the corpus literal.`,
    verifiedNote: ` Note: "verified" = the cited text matches the official corpus; it does NOT guarantee legal applicability to the case (validity in time, later doctrine, ratio decidendi).`,
    verifiedNoteExistencia: ` Note: "verified" here = the provision EXISTS in the official corpus. The WORDING this text attributes to it has NOT been compared against the literal, and legal applicability to the case is not guaranteed either (validity in time, later doctrine, ratio decidendi).`,
  },
};

/** NORMATIVA_VIGENTE fabricado por el modelo — aviso al neutralizarlo. */
const NORMATIVA_WARN: Record<string, (n: number) => string> = {
  es: (n) => `\n\n---\n⚠ Se neutralizaron ${n} bloque(s) NORMATIVA_VIGENTE FABRICADOS por el modelo: sus metadatos (ids/URLs/vigencias) NO eran oficiales y se eliminaron; el texto interior se CONSERVA sin respaldo oficial. No cites texto de norma de esta respuesta sin verificarlo (verify_cita).`,
  en: (n) => `\n\n---\n⚠ ${n} NORMATIVA_VIGENTE block(s) FABRICATED by the model were neutralised: their metadata (ids/URLs/validity dates) was NOT official and has been removed; the inner text is KEPT without official backing. Do not cite statute text from this answer without verifying it (verify_cita).`,
};

/**
 * Resumen anti-alucinación legible que las tools SSE añaden al final del texto.
 * PARIDAD: copy idéntico a `citationSummary()` del connector remoto
 * (`lib/mcp/registry.ts`) — si cambias uno, cambia el otro. `lang` = idioma
 * resuelto del tool-arg (es/en; el resto cae a EN).
 */
export function citationSummary(cc: CitationChecks | undefined, lang: string): string {
  if (!cc) return "";
  const t = pickLang(lang, CITATION_COPY);
  // Centinela anti-fail-open: la verificación NO corrió. No simular "limpio".
  if (cc.error) return t.error;
  // H2 (audit 07-18): aserciones de autoridad en prosa SIN cita formal → total=0 pero
  // unverifiableClaims>0. NO es "limpio": superficiar la CAUTION en vez de string vacío.
  if (!cc.total) {
    const uv = cc.unverifiableClaims ?? 0;
    if (uv > 0) return lang.startsWith("en")
      ? ` ⚠ ${uv} legal assertion(s) cite authority without a verifiable citation — not checked against the official corpus.`
      : ` ⚠ ${uv} afirmación(es) invocan autoridad sin cita verificable — no contrastadas con el corpus oficial.`;
    return "";
  }
  const c = cc.counts ?? {};
  const nv = c.not_verifiable ?? 0;
  // Desdoble del mismatch (E2E r3) — PARIDAD con lib/mcp/registry.ts.
  const mm = c.mismatch ?? 0;
  const meaningN = cc.checks?.length
    ? cc.checks.filter((k) => k.status === "mismatch" && k.mismatchKind !== "lexical").length
    : null;
  const mismatchTxt = meaningN === null ? t.mismatchAgg(mm) : t.mismatchSplit(meaningN, mm - meaningN);
  return (
    t.body(c.verified ?? 0, mismatchTxt, c.not_found ?? 0, nv, c.pending ?? 0) +
    (cc.anyBroken ? t.anyBroken : ``) +
    // `not_verifiable` NO es `verified`: corpus no activo para esa jurisdicción.
    (nv > 0 ? t.nvWarn(nv) : ``) +
    (mm > 0 ? t.mmNote : ``) +
    // Honestidad (capa D): `verified` = fidelidad TEXTUAL, no aplicabilidad jurídica.
    // 🔴 TERCERA COPIA de la misma glosa. `citation-core.ts` la corrigió el 2026-07-28 y
    // `lib/mcp/registry.ts` el 2026-08-18; ésta —la que se INSTALA— seguía afirmando que el
    // texto coincide con el corpus. En este mismo fichero, `keyOfStatus` ya distinguía
    // `verified_existence`: el arreglo llegó al marcador inline y no al resumen de abajo.
    ((c.verified ?? 0) > 0
      ? (cc.checks?.some((k) => k.status === "verified" && k.contentChecked === false)
          ? t.verifiedNoteExistencia
          : t.verifiedNote)
      : ``)
  );
}

export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * H9 — Anotación INLINE determinista de veredictos junto a cada cita.
 * PARIDAD: copia de `lib/verify/citation-annotate.ts` (el connector remoto la
 * importa; este sub-paquete es standalone) — si cambias uno, cambia el otro.
 * Solo el servidor anota: los marcadores emitidos por el MODELO se raspan.
 */
// Marcadores bilingües (L6, §4.1). PARIDAD con lib/verify/citation-annotate.ts
// (MARKERS_BY_LANG) — es verbatim + en; idiomas sin diccionario caen a EN.
const VERDICT_MARKERS_BY_LANG: Record<string, Record<string, string>> = {
  es: {
    verified:          "【✓】",
    verified_norm_level: "【✓ norma existente — contenido no contrastado】",
    verified_existence:  "【✓ existencia probada — contenido no contrastado】",
    verified_identidad_parcial: "【⚠ la resolución EXISTE, pero una de las partes que nombras NO aparece en ella — comprueba de qué caso hablas antes de usarla】",
    verified_identidad_solo_texto: "【✓ existencia probada — el nombre casa con el TEXTO de la resolución, no con el título de nuestro registro (normal en una apelación acumulada); de qué caso se trata, sin confirmar】",
    verified_identidad_sin_contrastar: "【✓ existencia probada — NO se ha podido contrastar de qué caso se trata, ni el contenido】",
    mismatch_meaning:  "【⚠ el sentido atribuido DIVERGE del texto oficial】",
    mismatch_stitched: "【⚠ cita ENSAMBLADA: los fragmentos son literales pero no forman un pasaje continuo del texto oficial — contrástala en la fuente antes de usarla】",
    mismatch_party:    "【⚠ esta cita resuelve a OTRA resolución distinta de la que se nombra — identifica la resolución antes de usarla】",
    mismatch_lexical:  "【◻ paráfrasis no contrastada literalmente — revisar contra la fuente】",
    not_found:         "【⛔ NO CONSTA en el corpus oficial — compruébala en la fuente oficial antes de usarla】",
    derogated:         "【⚠ norma DEROGADA a la fecha consultada】",
    aun_no_en_vigor:   "【⚠ norma AÚN NO EN VIGOR — está promulgada pero no consta su entrada en vigor, así que todavía no rige nada】",
    not_verifiable:    "【◻ no comprobada — el motivo va en la nota de esta cita】",
    pending:           "【◻ no verificada】",
  },
  en: {
    verified:          "【✓】",
    verified_norm_level: "【✓ statute exists — content not checked against the official text】",
    verified_existence:  "【✓ existence confirmed — content not checked against the official text】",
    verified_identidad_parcial: "【⚠ the decision EXISTS, but one of the parties you name does NOT appear in it — check which case you mean before relying on it】",
    verified_identidad_solo_texto: "【✓ existence confirmed — the name matches the TEXT of the decision, not the title in our record (normal in a joined appeal); WHICH decision it is, unconfirmed】",
    verified_identidad_sin_contrastar: "【✓ existence confirmed — WHICH decision it is could not be contrasted, nor its content】",
    mismatch_meaning:  "【⚠ the attributed meaning DIVERGES from the official text】",
    mismatch_stitched: "【⚠ ASSEMBLED quote: the fragments are literal but do not form a continuous passage of the official text — check it at the source before relying on it】",
    mismatch_party:    "【⚠ this citation resolves to ANOTHER decision, not the one named — identify the decision before relying on it】",
    mismatch_lexical:  "【◻ paraphrase not literally checked — review against the source】",
    not_found:         "【⛔ NOT IN the official corpus — verify at the official source before relying on it】",
    derogated:         "【⚠ provision REPEALED as of the date consulted】",
    aun_no_en_vigor:   "【⚠ provision NOT YET IN FORCE — it has been enacted but no commencement is recorded for it, so it governs nothing yet】",
    not_verifiable:    "【◻ not checked — the reason is in this citation's note】",
    pending:           "【◻ not verified】",
  },
  fr: {
    verified:          "【✓】",
    verified_norm_level: "【✓ le texte existe — contenu non confronté au texte officiel】",
    verified_existence:  "【✓ existence établie — contenu non confronté au texte officiel】",
    verified_identidad_parcial: "【⚠ la décision EXISTE, mais une des parties que vous nommez n'y figure PAS — vérifiez de quelle affaire il s'agit avant de l'utiliser】",
    verified_identidad_solo_texto: "【✓ existence établie — le nom correspond au TEXTE de la décision, pas au titre de notre registre (normal dans un pourvoi joint) ; de quelle affaire il s'agit, non confirmé】",
    verified_identidad_sin_contrastar: "【✓ existence établie — impossible de confronter DE QUELLE décision il s'agit, ni son contenu】",
    mismatch_meaning:  "【⚠ le sens attribué DIVERGE du texte officiel】",
    mismatch_stitched: "【⚠ citation ASSEMBLÉE : les fragments sont littéraux mais ne forment pas un passage continu du texte officiel — à confronter à la source avant de vous en servir】",
    mismatch_party:    "【⚠ cette citation renvoie à UNE AUTRE décision que celle qui est nommée — identifiez la décision avant de vous en servir】",
    mismatch_lexical:  "【◻ paraphrase non confrontée littéralement — à vérifier à la source】",
    not_found:         "【⛔ NE FIGURE PAS dans le corpus officiel — vérifiez-la à la source officielle avant de vous en servir】",
    derogated:         "【⚠ disposition ABROGÉE à la date consultée】",
    aun_no_en_vigor:   "【⚠ disposition PAS ENCORE EN VIGUEUR — adoptée, mais aucune entrée en vigueur n'est enregistrée : elle ne régit encore rien】",
    not_verifiable:    "【◻ non vérifiée — le motif figure dans la note de cette citation】",
    pending:           "【◻ non vérifiée】",
  },
  de: {
    verified:          "【✓】",
    verified_norm_level: "【✓ Vorschrift vorhanden — Inhalt nicht mit dem amtlichen Text abgeglichen】",
    verified_existence:  "【✓ Existenz bestätigt — Inhalt nicht mit dem amtlichen Text abgeglichen】",
    verified_identidad_parcial: "【⚠ die Entscheidung EXISTIERT, aber eine der genannten Parteien kommt darin NICHT vor — prüfen Sie, welchen Fall Sie meinen】",
    verified_identidad_solo_texto: "【✓ Existenz bestätigt — der Name entspricht dem TEXT der Entscheidung, nicht dem Titel in unserem Register (bei verbundenen Rechtsmitteln üblich); WELCHE Entscheidung, unbestätigt】",
    verified_identidad_sin_contrastar: "【✓ Existenz bestätigt — WELCHE Entscheidung es ist, konnte nicht abgeglichen werden, ebenso wenig der Inhalt】",
    mismatch_meaning:  "【⚠ der zugeschriebene Sinn WEICHT vom amtlichen Text AB】",
    mismatch_stitched: "【⚠ ZUSAMMENGESETZTES Zitat: die Fragmente sind wörtlich, bilden aber keine zusammenhängende Stelle des amtlichen Textes — vor der Verwendung an der Quelle prüfen】",
    mismatch_party:    "【⚠ diese Fundstelle verweist auf eine ANDERE Entscheidung als die genannte — klären Sie die Entscheidung vor der Verwendung】",
    mismatch_lexical:  "【◻ Paraphrase nicht wörtlich abgeglichen — an der Quelle prüfen】",
    not_found:         "【⛔ NICHT IM amtlichen Korpus — vor der Verwendung an der amtlichen Quelle prüfen】",
    derogated:         "【⚠ Vorschrift zum abgefragten Stichtag AUFGEHOBEN】",
    aun_no_en_vigor:   "【⚠ Vorschrift NOCH NICHT IN KRAFT — erlassen, aber kein Inkrafttreten verzeichnet: sie regelt noch nichts】",
    not_verifiable:    "【◻ nicht geprüft — der Grund steht in der Anmerkung zu diesem Zitat】",
    pending:           "【◻ nicht überprüft】",
  },
};
const VERDICT_MARKER_RE = /\s*【[✓⚠⛔◻][^【】]*】/g;
const VERDICT_SEVERITY = ["not_found", "mismatch_party", "mismatch_meaning", "derogated", "mismatch_stitched", "mismatch_lexical", "pending", "not_verifiable", "verified_identidad_parcial", "verified_identidad_sin_contrastar", "verified_existence", "verified_norm_level", "verified"];
// PARIDAD con lib/verify/citation-annotate.ts (H4 audit 07-18): un `verified` con nota
// de NIVEL DE NORMA o CONTENIDO NO CONTRASTADO no debe pintar 【✓】 pleno — el holding
// nunca se comparó (CO verifyJuris / norma sin artículo). Sin esto, el stdio daba
// 【✓】 pleno donde la web anota el degrade.
const NORM_LEVEL_NOTE_RE = /NIVEL DE NORMA|STATUTE LEVEL/i;
const CONTENT_UNCHECKED_NOTE_RE = /CONTENIDO NO CONTRASTADO|CONTENT NOT CHECKED/i;

export function annotateCitations(text: string, cc: CitationChecks | undefined, lang: string): string {
  if (!text || !cc?.checks?.length) return text;
  const markers = pickLang(lang, VERDICT_MARKERS_BY_LANG);
  let out = text.includes("【") ? text.replace(VERDICT_MARKER_RE, "") : text;
  const keyOfStatus = (c: { status: string; mismatchKind?: string; note?: string | null; contentChecked?: boolean; partyCheck?: string }) => {
    // "stitched" NO es divergencia de sentido: el reproche es ESTRUCTURAL — los
    // fragmentos son literales pero no forman un pasaje continuo del texto oficial.
    // Este carril lo mapeaba a `mismatch_meaning` y acusaba de DIVERGIR a una cita
    // fiel — la acusación falsa que el anotador web ya había retirado (2026-07-25).
    // Paridad restablecida 2026-07-27, junto con el texto del aviso en los 4 idiomas:
    // ahora que el veto solo dispara sobre citas realmente ensambladas, el aviso
    // puede decir qué se ha encontrado en vez de insinuarlo.
    if (c.status === "mismatch") {
      if (c.mismatchKind === "lexical")  return "mismatch_lexical";
      if (c.mismatchKind === "stitched") return "mismatch_stitched";
      if (c.mismatchKind === "party")    return "mismatch_party";
      return "mismatch_meaning";
    }
    if (c.status === "verified") {
      // 🔴 El HECHO manda sobre la prosa, igual que en el anotador web: la identidad se
      // decide por el campo `partyCheck`, no por lo que diga la nota. Una nota redactada
      // de otra manera —la de GB— se llevaba el tick pleno de una cita cuyo nombre de
      // parte podía estar fabricado.
      if (c.partyCheck === "partial") return "verified_identidad_parcial";
      if (c.partyCheck === "unavailable") return "verified_identidad_sin_contrastar";
      if (c.contentChecked === false) return "verified_existence";
      if (typeof c.note === "string") {
        if (NORM_LEVEL_NOTE_RE.test(c.note)) return "verified_norm_level";
        if (CONTENT_UNCHECKED_NOTE_RE.test(c.note)) return "verified_existence";
      }
    }
    return c.status;
  };
  const rank = (s: string) => { const i = VERDICT_SEVERITY.indexOf(s); return i === -1 ? Number.POSITIVE_INFINITY : i; };
  const byCitation = new Map<string, string>();
  for (const c of cc.checks) {
    const s = keyOfStatus(c);
    const prev = byCitation.get(c.citation);
    if (prev === undefined || rank(s) < rank(prev)) byCitation.set(c.citation, s);
  }
  const citations = [...byCitation.keys()].sort((a, b) => b.length - a.length);
  for (const citation of citations) {
    const marker = markers[byCitation.get(citation)!];
    if (!marker) continue;
    const re = new RegExp(`${citation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\s*【)`, "g");
    out = out.replace(re, `${citation} ${marker}`);
  }
  return out;
}

/**
 * Render final del texto de una tool SSE: raspa bloques NORMATIVA_VIGENTE
 * fabricados por el modelo (con advertencia si eliminó alguno), anota el
 * veredicto INLINE junto a cada cita (H9) y añade el resumen anti-alucinación.
 * PARIDAD: mismo comportamiento y copy que `sseTextFmt` del connector remoto
 * (`lib/mcp/registry.ts`) — si cambias uno, cambia el otro.
 */
export function renderSseText(rawText: string, cc: CitationChecks | undefined, lang: string = ""): string {
  const { text, stripped } = stripLlmNormativaBlocks(rawText ?? "", lang);
  const warn = stripped > 0 ? pickLang(lang, NORMATIVA_WARN)(stripped) : "";
  return annotateCitations(text, cc, lang) + warn + citationSummary(cc, lang);
}

/**
 * Consume un stream SSE de Nexus y agrega los `text_delta` en una sola
 * cadena. Termina cuando recibe `{type:"done"}` o cuando el stream cierra.
 * Si recibe `{type:"error"}`, lanza NexusHttpError.
 */
export async function streamSse(
  cfg: Config,
  path: string,
  body: unknown,
): Promise<SseResult> {
  const url = `${cfg.baseUrl}${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,
        "Content-Type":  "application/json",
        "Accept":        "text/event-stream",
        "User-Agent":    cfg.userAgent,
      },
      body:   JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const bodyExcerpt = await res.text().catch(() => "");
      throw httpErrorFrom(res.status, res.statusText, path, bodyExcerpt);
    }
    if (!res.body) {
      throw new NexusHttpError(500, `Empty response body from ${path}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";
    let   text    = "";
    /** Texto con el veredicto ya dentro (evento `done`). Si llega, sustituye a los deltas. */
    let   textoVerificado = "";
    let   outputId: string | null = null;
    let   partyScreening: SseResult["partyScreening"] = undefined;
    let   citationChecks: CitationChecks | undefined = undefined;
    const logs: string[] = [];
    const structuredEvents: SseEvent[] = [];
    let   events  = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames separados por doble newline
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          events++;
          let evt: SseEvent;
          try { evt = JSON.parse(payload) as SseEvent; }
          catch { continue; }

          switch (evt.type) {
            case "text_delta": {
              const delta = (evt as { delta?: string }).delta ?? "";
              text += delta;
              break;
            }
            case "log": {
              const m = (evt as { message?: string }).message;
              if (m) logs.push(m);
              break;
            }
            case "done": {
              const id = (evt as { outputId?: string | null }).outputId ?? null;
              outputId = id;
              const cc = (evt as { citationChecks?: unknown }).citationChecks;
              // Solo objetos: un valor basura (string, número) no debe colarse
              // como resumen de verificación.
              if (cc && typeof cc === "object" && !Array.isArray(cc)) {
                citationChecks = cc as CitationChecks;
              }
              /**
               * 🔴 EL TEXTO ANOTADO GANA A LOS DELTAS (2026-08-02).
               *
               * Este agregador es una copia deliberada del de la app (`aggregateSse` en
               * `lib/mcp/server.ts`): el paquete npm es independiente y no puede importarla.
               * Allí se arregló hoy y aquí no, así que un cliente MCP recibía la prosa CRUDA
               * mientras la app entregaba la misma respuesta con el veredicto dentro.
               *
               * Los deltas son lo que el modelo escribió; `verifiedText` es eso mismo con el
               * marcador junto a cada cita y el parte al pie. Sin esta preferencia, el
               * abogado que trabaja desde un cliente MCP lee un texto que llega a afirmar
               * que no tenemos autoridades que sí tenemos — medido en vivo el 2026-08-02.
               *
               * Solo una cadena NO VACÍA: un `verifiedText: ""` borraría la respuesta entera,
               * que es peor que no anotarla.
               */
              /**
               * 🔴 Y EL ARREGLO DEL 0.3.2 SE QUEDÓ A MEDIAS, POR PARTIDA DOBLE (2026-08-04).
               *
               * (a) Leía SOLO `verifiedText`, y esa clave la emiten `/api/consulta` y
               *     `/api/nodo-doctrina`. La ruta de análisis —la que usa `nexus_analyze`,
               *     que es la tool principal— emite el texto anotado en `analysis`, y ahí
               *     dentro van el parte de cribado, el aviso de OCR y el veredicto de citas.
               *     O sea que justo la tool que más importa seguía devolviendo prosa cruda.
               * (b) `textoVerificado` se asignaba y NO SE DEVOLVÍA: variable muerta, también
               *     en el build publicado. Aunque (a) hubiera acertado, no habría servido.
               */
              const vt = (evt as { verifiedText?: unknown }).verifiedText;
              const an = (evt as { analysis?: unknown }).analysis;
              if (typeof vt === "string" && vt.trim()) textoVerificado = vt;
              else if (typeof an === "string" && an.trim()) textoVerificado = an;

              const ps = (evt as { partyScreening?: unknown }).partyScreening;
              if (ps && typeof ps === "object" && !Array.isArray(ps)) {
                partyScreening = ps as SseResult["partyScreening"];
              }
              structuredEvents.push(evt);
              break;
            }
            case "error": {
              // Las rutas que resuelven el motor DENTRO del stream ya han abierto un
              // 200 cuando rechazan, así que la negativa llega como frame
              // `{type:"error", code, message}`. Esto lo convertía en un
              // `NexusHttpError(500)` y tiraba el `code`: un 409
              // BYO_PROVIDER_REQUIRED —la garantía del despacho funcionando— salía
              // por la tool como un error 500, o sea, como avería NUESTRA. El status
              // no se inventa (0 = no hubo status HTTP: el fallo llegó dentro del
              // stream) y el código viaja delante del mensaje.
              const e = evt as { message?: string; code?: string };
              const code = typeof e.code === "string" && e.code.trim() ? e.code.trim() : undefined;
              const m = e.message ?? "The backend reported an error mid-stream.";
              throw new NexusHttpError(0, code ? `${code}: ${m}` : m, undefined, code);
            }
            default:
              // Algunas rutas legacy emiten {delta:"..."} (consulta), {done:true}, etc.
              if ("delta" in evt && typeof evt.delta === "string") {
                text += evt.delta;
              } else if (typeof evt.type === "string") {
                // Eventos estructurados de rutas no textuales, p. ej.
                // jurisdiction_result de /api/multi-jurisdiction-compare.
                structuredEvents.push(evt);
              }
          }
        }
      }
    }

    /**
     * 🔴 EL TEXTO ANOTADO ES EL QUE SALE. Devolver `text` a secas dejaba fuera el parte de
     * cribado, el aviso de OCR y los marcadores de cita: todo eso viaja en el frame `done`,
     * no en los deltas.
     */
    return { text: textoVerificado || text, outputId, logs, rawEvents: events, citationChecks, partyScreening, structuredEvents };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET a una ruta JSON. Sin streaming. Añade el Bearer automáticamente.
 */
export async function getJson<T = unknown>(
  cfg: Config,
  path: string,
): Promise<T> {
  const url = `${cfg.baseUrl}${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method:  "GET",
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

/**
 * POST normal a una ruta JSON. Sin streaming.
 */
export async function postJson<T = unknown>(
  cfg: Config,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${cfg.baseUrl}${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "User-Agent":    cfg.userAgent,
      },
      body:   JSON.stringify(body ?? {}),
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
