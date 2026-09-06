/**
 * FASE-2 stdio tools — paridad con el connector remoto (lib/mcp/registry.ts):
 * normativa vigente (search/articulo/pyramid) + inventario de corpus
 * (jurisprudencial + normativo). Todas READ-ONLY, JSON directo sobre endpoints
 * v1 ya públicos que YA validan/cobran. Ninguna abre ruta nueva.
 *
 * jurisdicción SIN default (jurisdicciones_son_pares): la ruta usa `jurisdiccion`
 * pero infiere/aplica su propio default; el tool la reenvía solo si el caller la
 * pasa — NUNCA incrusta "ES".
 */
import { z } from "zod";
import { postJson, httpErrorFrom } from "../http-client.js";
import type { Config } from "../config.js";
import type { ToolDefinition } from "./types.js";

/** GET JSON helper (postJson es POST; estas rutas normativa son GET salvo search). */
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

// ── nexus_normativa_search ────────────────────────────────────────────────────
const searchSchema = z.object({
  query: z.string().min(5).describe("Natural-language query about legislation (min 5 chars)"),
  // Sin default (jurisdicciones_son_pares): omitida → el backend la resuelve.
  jurisdiccion: z.string().optional().describe("ISO jurisdiction code of the statute corpus (e.g. ES, CO). Optional; backend resolves if omitted"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Vigency date YYYY-MM-DD (optional, default today); filters articles in force at that date"),
  tipos: z.array(z.string()).optional().describe("Optional filter by norma_tipo, e.g. ['LEY','CODIGO']"),
  materias: z.array(z.string()).optional().describe("Optional filter by subject/materia"),
  top_k: z.number().int().min(1).max(50).default(10).describe("Maximum articles to return (1-50)"),
});

export const normativaSearchTool: ToolDefinition = {
  name: "nexus_normativa_search",
  description:
    "Semantic search over IN-FORCE legislation articles (Voyage-3 embeddings) of the consolidated statute corpus. " +
    "Filters by in-force status at a date (lex temporis), instrument type and subject. Returns the most similar provisions with " +
    "their heading, number, instrument id, literal text and official URL. USE WHEN: looking for the provision " +
    "that applies to a question, without drafting. Consumes no LLM credits (only the query embedding).",
  inputSchema: searchSchema,
  async handler(input, cfg) {
    const args = searchSchema.parse(input);
    const jur = args.jurisdiccion?.trim() ? args.jurisdiccion.trim().toUpperCase() : undefined;
    const result = await postJson<Record<string, unknown>>(cfg, "/api/v1/normativa/search", {
      query:        args.query,
      jurisdiccion: jur,
      fecha:        args.fecha,
      tipos:        args.tipos,
      materias:     args.materias,
      top_k:        args.top_k,
    });

    const data = (result.data ?? []) as Array<Record<string, unknown>>;
    /**
     * PARIDAD con lib/mcp/registry.ts. La cabecera afirmaba «Normativa vigente … (vigente a
     * X)» sobre un conjunto que en el Reino Unido nadie poda: se hidrata inline y su camino
     * ni recibe la fecha. `result.fecha` es la que se PREGUNTÓ. Sin el hecho publicado por
     * la ruta se asume lo conservador: no afirmar.
     */
    // PARIDAD: solo `consulta` sostiene la cabecera. Ver lib/mcp/registry.ts.
    const filtrada = result.vigencia_filtrada === "consulta";
    const head = filtrada
      ? `## Legislation in force — ${result.jurisdiccion ?? ""} (in force at ${result.fecha ?? "today"}) — ${data.length} provision(s)`
      : `## Legislation — ${result.jurisdiccion ?? ""} (queried at ${result.fecha ?? "today"}) — ${data.length} provision(s)`;
    const avisoVigencia = filtrada ? "" : `\n\n⚠ **Not filtered by in-force status.** The wording is the one in the `
      + `official register, but it has NOT been checked that these provisions are still in force at the `
      + `date queried: some may be repealed, and some may be enacted but not yet in force. `
      + `Confirm against the official source.`;
    if (data.length === 0) {
      return { content: `${head}\n\n${result.note ? String(result.note) : "No results for this query."}` };
    }
    const body = data
      .map((a, i) => {
        const titulo = (a.rubrica ?? a.norma_titulo ?? a.boe_id ?? "") as string;
        const sim = typeof a.similarity === "number" ? ` (similitud ${(a.similarity * 100).toFixed(1)}%)` : "";
        const full = String(a.texto_literal ?? "");
        return `\n### ${i + 1}. s. ${a.numero ?? "?"} — ${titulo}${sim}\n**Instrument:** ${a.boe_id ?? a.norma_id ?? ""}\n**URL:** ${a.url_boe ?? ""}\n\n${full.slice(0, 500)}${full.length > 500 ? "…" : ""}`;
      })
      .join("\n");
    // El aviso va pegado a la cabecera: lo que se lee tras 20 artículos ya no cambia
    // cómo se leyeron los 20.
    return { content: head + avisoVigencia + body };
  },
};

// ── nexus_normativa_articulo ──────────────────────────────────────────────────
const articuloSchema = z.object({
  norma: z.string().describe("Official identifier of the instrument, in the form used by the jurisdiction. Spain: the BOE id, e.g. 'BOE-A-1889-4763' (Civil Code). United Kingdom: the short title as it is cited — 'Companies Act 2006', 'The Working Time Regulations 1998' — or the instrument id (ukpga_2006_46, uksi_1998_1833). A bare 'Schedule 4' is not accepted: Schedules are indexed paragraph by paragraph, so ask for the paragraph (articulo=sch4-3)."),
  articulo: z.string().describe("Article number, e.g. '1124'"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Vigency date YYYY-MM-DD (optional, default today)"),
  jurisdiccion: z.string().optional().describe("ISO jurisdiction code (e.g. ES, CO). Optional"),
});

export const normativaArticuloTool: ToolDefinition = {
  name: "nexus_normativa_articulo",
  description:
    "Deterministic fetch of the literal text of a specific statute article, by the identifier its jurisdiction uses. " +
    "Where the lookup is bounded by the date (Spain today) it returns the version in force then, for historical lex temporis " +
    "queries, with its rubric and vigency window; where it is not (the United Kingdom), the text is the official one but the " +
    "in-force status is NOT checked and the response says so. USE WHEN: the instrument and provision are known exactly and the official text is wanted, not a " +
    "search. Consumes no credits.",
  inputSchema: articuloSchema,
  async handler(input, cfg) {
    const args = articuloSchema.parse(input);
    const qs = new URLSearchParams({ norma: args.norma, articulo: args.articulo });
    if (args.fecha?.trim()) qs.set("fecha", args.fecha.trim());
    if (args.jurisdiccion?.trim()) qs.set("jurisdiccion", args.jurisdiccion.trim().toUpperCase());
    const result = await getJson<Record<string, unknown>>(cfg, `/api/v1/normativa/articulo?${qs.toString()}`);

    if (!result.norma && !result.articulo) {
      return {
        content: `## Statutory provision\n\n${result.note ? String(result.note) : "Provision not found in the corpus."}${result.vigente_a_fecha ? `\n\n**Date queried:** ${result.vigente_a_fecha}` : ""}`,
      };
    }
    const norma = (result.norma ?? {}) as Record<string, unknown>;
    const art = (result.articulo ?? {}) as Record<string, unknown>;
    const ver = (art.version ?? {}) as Record<string, unknown>;
    const lines = [
      `## ${norma.titulo ?? norma.boe_id ?? "Instrument"} — s. ${art.numero ?? "?"}`,
      ``,
      `**Instrument:** ${norma.boe_id ?? ""}`,
    ];
    if (art.rubrica) lines.push(`**Heading:** ${art.rubrica}`);
    /**
     * PARIDAD: con `vigente_a_fecha` nulo la línea DESAPARECÍA y el literal salía sin una
     * palabra sobre vigencia, que se lee como que está bien. Callar lo no comprobado es la
     * misma falta que afirmarlo.
     */
    if (result.vigente_a_fecha) lines.push(`**In force at:** ${result.vigente_a_fecha}`);
    else {
      if (result.consultado_a_fecha) lines.push(`**Date queried:** ${result.consultado_a_fecha}`);
      lines.push(`⚠ **In-force status NOT checked at that date.** The wording is the one in the `
        + `official register; that the provision is still in force has not been verified. Confirm `
        + `against the official source.`);
    }
    if (ver.vigencia_desde || ver.vigencia_hasta) lines.push(`**In force:** ${ver.vigencia_desde ?? "?"} → ${ver.vigencia_hasta ?? "no end date"}`);
    if (norma.url) lines.push(`**Official source:** ${norma.url}`);
    if (art.texto_literal) lines.push(``, `**Literal text:**`, String(art.texto_literal));
    return { content: lines.join("\n") };
  },
};

// ── nexus_normativa_pyramid ───────────────────────────────────────────────────
const pyramidSchema = z.object({
  jurisdiccion: z.string().optional().describe("ISO jurisdiction code (e.g. ES, CO). Optional"),
});

export const normativaPyramidTool: ToolDefinition = {
  name: "nexus_normativa_pyramid",
  description:
    "Stufenbau pyramid of the statute corpus: coverage aggregated by hierarchical level (constitutional, legal, " +
    "regulatory, …) for a jurisdiction, with totals of instruments/provisions, in-force/repealed and in-force percentage " +
    "per level. Public discovery (no credits). USE WHEN: a coverage view by hierarchical level is wanted.",
  inputSchema: pyramidSchema,
  async handler(input, cfg) {
    const args = pyramidSchema.parse(input);
    const jur = args.jurisdiccion?.trim() ? args.jurisdiccion.trim().toUpperCase() : "";
    const path = jur ? `/api/v1/normativa/pyramid?jurisdiccion=${encodeURIComponent(jur)}` : `/api/v1/normativa/pyramid`;
    const result = await getJson<Record<string, unknown>>(cfg, path);

    const niveles = (result.niveles ?? []) as Array<Record<string, unknown>>;
    const lines = [
      `## Legislative hierarchy — ${result.jurisdiccion ?? ""} (${result.status ?? "?"})`,
      ``,
      `**Total instruments:** ${result.total_normas ?? 0} · **Total provisions:** ${result.total_articulos ?? 0}`,
    ];
    if (niveles.length === 0) {
      lines.push(``, result.status === "rails-only" ? "Corpus not ingested for this jurisdiction (rails-only)." : "No levels.");
      return { content: lines.join("\n") };
    }
    lines.push(``);
    for (const n of niveles) {
      const pct = n.pct_vigencia === null || n.pct_vigencia === undefined ? "N/A" : `${n.pct_vigencia}%`;
      lines.push(`- **Level ${n.nivel} — ${n.nombre}:** ${n.total_normas} instruments · ${n.total_articulos} provisions · ${n.vigentes} vigentes / ${n.derogadas} derogados (vigencia ${pct})`);
    }
    return { content: lines.join("\n") };
  },
};

// ── nexus_corpus_coverage ─────────────────────────────────────────────────────
const emptySchema = z.object({});

export const corpusCoverageTool: ToolDefinition = {
  name: "nexus_corpus_coverage",
  description:
    "Self-discoverable inventory of the indexed jurisprudence corpus: for each jurisprudencia_<iso> table, its " +
    "inferred jurisdiction, total documents, date range (oldest/newest) and top sources. Pure metadata, no " +
    "credits. USE WHEN: you want to know which jurisdictions and case-law sources exist before searching.",
  inputSchema: emptySchema,
  async handler(_input, cfg) {
    const result = await getJson<Record<string, unknown>>(cfg, `/api/v1/corpus/coverage`);
    const tables = (result.tables ?? []) as Array<Record<string, unknown>>;
    const lines = [
      `## Inventario de corpus jurisprudencial`,
      ``,
      `**Total documents:** ${result.totalDocs ?? 0} · **Tables:** ${result.totalTables ?? tables.length}${result.generatedAt ? ` · generado ${result.generatedAt}` : ""}`,
      ``,
    ];
    for (const t of tables) {
      const sources = (t.topSources ?? []) as Array<Record<string, unknown>>;
      const srcTxt = sources.map((s) => `${s.source} (${s.count})`).join(", ");
      lines.push(
        `### ${t.inferredJurisdiction ?? "?"} — ${t.table}`,
        `**Docs:** ${t.totalDocs ?? 0} · **Rango:** ${t.oldestDoc ?? "?"} → ${t.newestDoc ?? "?"}`,
      );
      if (srcTxt) lines.push(`**Fuentes:** ${srcTxt}`);
      lines.push(``);
    }
    return { content: lines.join("\n") };
  },
};

// ── nexus_normativa_coverage ──────────────────────────────────────────────────

/**
 * 🔴 UN CAMPO AUSENTE NO ES UN CERO, Y UNA FECHA AUSENTE NO ES «NUNCA».
 *
 * Gemelo literal de `coverageCifra`/`coverageFecha`/`coverageFlag` en
 * `lib/mcp/registry.ts`. Se duplican en vez de compartirse porque este paquete se publica
 * suelto en npm y no puede importar del monorepo; si tocas uno, toca el otro.
 *
 * El render de antes escribía `?? 0` y `?? "N/A"`, y con eso convertía un campo AUSENTE en un
 * HECHO: si la medición fallaba, la tool imprimía «Artículos: 0» y el lector entendía «no hay
 * artículos», que es una afirmación sobre el corpus que nadie ha comprobado. La ruta ya
 * distingue las dos cosas (`null` = no medido, `0` = contado y sale cero); si el render las
 * vuelve a fundir, el arreglo del backend se pierde en la última pulgada.
 *
 * Regla: un `0` solo se escribe cuando el JSON trae un `0`.
 *
 * `Number.isFinite` y no `typeof === "number"` a secas porque un `NaN` colado por un JSON
 * malformado se imprimiría como si fuera una medición.
 */
const SIN_MEDIR = "not measured";
const cifra = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : SIN_MEDIR;
const fecha = (v: unknown): string =>
  typeof v === "string" && v.trim() ? v : SIN_MEDIR;
/** Tri-estado: `true` → sí, `false` → no, cualquier otra cosa → no medido. */
const flag = (v: unknown, si: string, no: string): string =>
  v === true ? si : v === false ? no : SIN_MEDIR;

export const normativaCoverageTool: ToolDefinition = {
  name: "nexus_normativa_coverage",
  description:
    "Coverage of the STATUTE corpus (analogous to nexus_corpus_coverage but for legislation): jurisdictions with " +
    "corpus, per-jurisdiction breakdown for the jurisdictions this account has active, totals of instruments/versions/" +
    "articles (relational store only), last update of OUR COPY and ingestion lag. Public discovery, no credits. " +
    "USE WHEN: you want the state and freshness of the statute corpus.",
  inputSchema: emptySchema,
  async handler(_input, cfg) {
    const result = await getJson<Record<string, unknown>>(cfg, `/api/v1/normativa/coverage`);
    const jurs = (result.jurisdicciones ?? []) as string[];
    const lines = [
      `## Legislation corpus coverage (${result.status ?? "?"})`,
      ``,
      `**Jurisdictions:** ${jurs.length ? jurs.join(", ") : "—"}`,
      `**Instruments:** ${cifra(result.total_normas)} · **Versions:** ${cifra(result.total_versiones)} · **Articles:** ${cifra(result.total_articulos)}`,
    ];

    /**
     * 🔴 EL TOTAL EXCLUÍA A GB Y A SG, Y AQUÍ NO SE DECÍA.
     *
     * La ruta publica `not_aggregated` desde que se arregló para Singapur, y el gemelo HTTP
     * (`lib/mcp/registry.ts`) ya lo pintaba; este renderizador no, así que servía un total de
     * 887.263 artículos —solo ES+EU+CO— junto a una lista de jurisdicciones que incluye a GB
     * y SG. La resta la hacía el lector, y concluía que del Reino Unido no tenemos nada.
     */
    const noAgregadas = (Array.isArray(result.not_aggregated) ? result.not_aggregated : []) as string[];
    if (noAgregadas.length > 0) {
      lines.push(
        ``,
        `⚠ **The totals above do NOT count ${noAgregadas.join(", ")}.** Their legislation is loaded `
        + `and searchable with \`nexus_normativa_search\`, but it is indexed in the vector store and `
        + `does not enter this count. Do not read the difference as missing corpus.`,
        ``,
      );
    }

    lines.push(
      // `N/A` decía «no aplica»; lo que pasa es que no se ha medido. No es lo mismo.
      `**Last update:** ${fecha(result.ultima_actualizacion)}${typeof result.lag_dias === "number" ? ` (lag ${result.lag_dias} day(s))` : ""}`,
      `🔴 The dates in this inventory say when **OUR COPY** was last written, not when the law was `
      + `last amended. A corpus loaded yesterday can hold a provision amended a month ago: what is `
      + `up to date is the ingestion, not necessarily the law.`,
    );

    /**
     * 🔴 EL DESGLOSE ES LA RESPUESTA A «¿Y LO MÍO?».
     *
     * Los totales de portada son de la plataforma, no de la cuenta. Un despacho británico leía
     * 887.263 artículos que no son suyos y NO veía sus 695.446, porque GB vive en el almacén
     * vectorial y no entra en esos totales. La cifra era cierta y contestaba a otra pregunta.
     *
     * Y si el array viene vacío o ausente hay que decirlo: omitir la sección deja al lector con
     * los totales ajenos como única cifra, que es de donde venimos.
     */
    const detalle = Array.isArray(result.por_jurisdiccion)
      ? (result.por_jurisdiccion as Array<Record<string, unknown>>)
      : null;
    if (detalle && detalle.length > 0) {
      lines.push(``, `**Per-jurisdiction breakdown** (the ones active on this account):`);
      for (const p of detalle) {
        const store = String(p.store ?? "?");
        const almacen = store === "vector" ? "vector store"
          : store === "relational" ? "relational store"
          : `${store} store`;
        const comprobada = typeof p.fechaComprobadaEl === "string" && p.fechaComprobadaEl.trim()
          ? ` · date checked ${p.fechaComprobadaEl}`
          : "";
        lines.push(
          `- **${String(p.jurisdiction ?? "?")}** — articles ${cifra(p.articulos)} · instruments ${cifra(p.normas)} · versions ${cifra(p.versiones)}\n`
          + `  ${almacen} (\`${String(p.source ?? "?")}\`)`
          + ` · ${flag(p.countedInTotals, "counted in the totals above", "⚠ NOT counted in the totals above")}`
          + ` · ${flag(p.searchable, "search enabled", "⚠ search NOT enabled in this deployment")}`
          + ` · our copy last written ${fecha(p.ultimaActualizacion)}`
          + `${typeof p.lagDias === "number" ? ` (lag ${p.lagDias} day(s))` : ""}`
          + comprobada,
        );
      }
    } else {
      lines.push(
        ``,
        `**Per-jurisdiction breakdown:** none for this account. That does NOT say there is no `
        + `corpus —the totals above are platform-wide and are not yours—; it says the detail is `
        + `not in this answer. If you expected to see your jurisdiction, write to `
        + `support@nexusquantum.legal.`,
      );
    }

    /**
     * Avisos. `gap` = falta un dato (el inventario está incompleto); `caveat` = la cifra es
     * real pero se lee mal sin el aviso. Quien usa el MCP tiene que ver lo mismo que quien
     * llama al API a pelo.
     *
     * Una severidad DESCONOCIDA cae en el cubo ruidoso a propósito: si mañana la ruta añade un
     * tercer nivel, más vale enseñarlo de más que enterrarlo entre los matices.
     */
    const avisos = Array.isArray(result.warnings)
      ? (result.warnings as Array<Record<string, unknown>>)
      : [];
    const huecos  = avisos.filter((w) => w.severity !== "caveat");
    const matices = avisos.filter((w) => w.severity === "caveat");
    const scope = (result.scope ?? null) as Record<string, unknown> | null;
    const notaAlcance = scope && typeof scope.note === "string" && scope.note.trim()
      ? scope.note.trim()
      : null;
    const aviso = (w: Record<string, unknown>) =>
      `- \`${String(w.code ?? "?")}\` — ${String(w.message ?? "")}`;

    // Los textos de `warnings`/`scope.note`/`note` los redacta la ruta, y los redacta en
    // inglés (son un solo cuerpo de texto para todas las jurisdicciones). Se avisa en vez de
    // fingir que están traducidos — este render es monolingüe en castellano, ver la nota de
    // paridad al final del fichero.
    if (huecos.length > 0 || matices.length > 0 || notaAlcance || result.note) {
      lines.push(``, );
    }
    if (huecos.length > 0) {
      lines.push(``, `**Inventory gaps** (a datum is missing: the affected figure is NOT a measurement):`, ...huecos.map(aviso));
    }
    if (matices.length > 0) {
      lines.push(``, `**How to read these figures** (they are real, but they read wrong without this):`, ...matices.map(aviso));
    }
    if (notaAlcance) lines.push(``, notaAlcance);
    if (result.note) lines.push(``, String(result.note));
    return { content: lines.join("\n") };
  },
};

/**
 * ⚠ DIVERGENCIA DELIBERADA con el gemelo `lib/mcp/registry.ts` — el IDIOMA, y solo el idioma.
 *
 * El registry HTTP tiene negociación de idioma (`NORMATIVA_COVERAGE_COPY` + `resolveLanguage`
 * + un parámetro `language` en el schema) y sirve es/en. Este paquete stdio no tiene ninguna
 * de esas tres piezas: NINGUNA de sus tools acepta `language`, así que meter aquí un
 * diccionario de idiomas sería introducir media infraestructura para una sola tool.
 *
 * Lo que SÍ tiene que ser idéntico, y lo es, es QUÉ se enseña: totales sin `?? 0`, aviso de
 * `not_aggregated`, desglose por jurisdicción (o el motivo de su ausencia), la fecha marcada
 * como la de NUESTRA COPIA, y los `warnings` partidos en huecos y matices. Cualquier campo
 * nuevo que se pinte en uno se pinta en el otro.
 */
