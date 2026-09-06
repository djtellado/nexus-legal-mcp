/**
 * Tests de las tools stdio FASE-2 (mcp-server/src/tools/normativa.ts).
 * Corre contra el build (node --test) con `fetch` global mockeado.
 *
 * PARIDAD con el connector remoto (lib/mcp/registry.ts) y sus tests
 * (tests/unit/mcp-http.test.ts): mismo endpoint v1, mismos campos REALES
 * renderizados. Read-only, jurisdicción sin default (jurisdicciones_son_pares).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normativaSearchTool,
  normativaArticuloTool,
  normativaPyramidTool,
  corpusCoverageTool,
  normativaCoverageTool,
} from "../dist/tools/normativa.js";

const cfg = {
  baseUrl:   "https://nexus.test",
  apiKey:    "nlk_test",
  timeoutMs: 5_000,
  userAgent: "nexus-legal-mcp-test",
};

/** Mockea fetch global capturando (url, init) y devolviendo JSON. */
function mockFetch(t, payload, capture) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (capture) capture.url = String(url), capture.init = init;
    return new Response(JSON.stringify(payload), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = original; });
}

test("nexus_normativa_search POST /api/v1/normativa/search, jurisdiccion en MAYÚSCULAS, campos reales", async (t) => {
  const cap = {};
  mockFetch(t, {
    data: [
      { numero: "1124", rubrica: "Facultad resolutoria", boe_id: "BOE-A-1889-4763", texto_literal: "La facultad de resolver…", url_boe: "https://boe.es/cc-1124", similarity: 0.87 },
    ],
    jurisdiccion: "ES",
    fecha: "2026-07-08",
  }, cap);
  const r = await normativaSearchTool.handler({ query: "resolución por incumplimiento", jurisdiccion: "es" }, cfg);
  assert.equal(cap.url, "https://nexus.test/api/v1/normativa/search");
  assert.equal(cap.init.method, "POST");
  const sent = JSON.parse(cap.init.body);
  assert.equal(sent.jurisdiccion, "ES");
  assert.ok(r.content.includes("s. 1124 — Facultad resolutoria"));
  assert.ok(r.content.includes("similitud 87.0%"));
  assert.ok(r.content.includes("https://boe.es/cc-1124"));
});

test("nexus_normativa_search sin jurisdiccion → el body NO lleva la clave", async (t) => {
  const cap = {};
  mockFetch(t, { data: [], fecha: "2026-07-08" }, cap);
  await normativaSearchTool.handler({ query: "usufructo viudal" }, cfg);
  const sent = JSON.parse(cap.init.body);
  assert.equal("jurisdiccion" in sent, false);
});

test("nexus_normativa_search rails-only → muestra la nota", async (t) => {
  mockFetch(t, { data: [], jurisdiccion: "MX", fecha: "2026-07-08", note: "Ingestión BOE bajo contrato Premium." });
  const r = await normativaSearchTool.handler({ query: "contrato de trabajo" }, cfg);
  assert.ok(r.content.includes("Ingestión BOE bajo contrato Premium."));
});

test("nexus_normativa_articulo GET con query params y formato del artículo activo", async (t) => {
  const cap = {};
  mockFetch(t, {
    norma: { boe_id: "BOE-A-1889-4763", titulo: "Código Civil", url: "https://boe.es/cc" },
    articulo: { numero: "1124", rubrica: "Resolución", texto_literal: "La facultad de resolver…", version: { vigencia_desde: "1889-07-25", vigencia_hasta: null } },
    vigente_a_fecha: "2020-01-01",
  }, cap);
  const r = await normativaArticuloTool.handler({ norma: "BOE-A-1889-4763", articulo: "1124", fecha: "2020-01-01", jurisdiccion: "es" }, cfg);
  assert.equal(cap.url, "https://nexus.test/api/v1/normativa/articulo?norma=BOE-A-1889-4763&articulo=1124&fecha=2020-01-01&jurisdiccion=ES");
  assert.equal(cap.init.method, "GET");
  assert.ok(r.content.includes("Código Civil — s. 1124"));
  assert.ok(r.content.includes("1889-07-25 → no end date"));
});

test("nexus_normativa_articulo rails-only (data null) → nota", async (t) => {
  mockFetch(t, { data: null, note: "Sin corpus para esta jurisdicción.", vigente_a_fecha: "2026-07-08" });
  const r = await normativaArticuloTool.handler({ norma: "BOE-A-1889-4763", articulo: "9999" }, cfg);
  assert.ok(r.content.includes("Sin corpus para esta jurisdicción."));
});

test("nexus_normativa_pyramid GET sin jurisdiccion → endpoint sin query", async (t) => {
  const cap = {};
  mockFetch(t, {
    jurisdiccion: "ES",
    niveles: [{ nivel: 1, nombre: "Constitucional", total_normas: 1, total_articulos: 169, vigentes: 169, derogadas: 0, pct_vigencia: 100 }],
    total_normas: 1, total_articulos: 169, status: "active",
  }, cap);
  const r = await normativaPyramidTool.handler({}, cfg);
  assert.equal(cap.url, "https://nexus.test/api/v1/normativa/pyramid");
  assert.ok(r.content.includes("Level 1 — Constitucional:"));
  assert.ok(r.content.includes("vigencia 100%"));
});

test("nexus_normativa_pyramid con jurisdiccion → query param", async (t) => {
  const cap = {};
  mockFetch(t, { jurisdiccion: "CO", niveles: [], total_normas: 0, total_articulos: 0, status: "rails-only" }, cap);
  const r = await normativaPyramidTool.handler({ jurisdiccion: "co" }, cfg);
  assert.equal(cap.url, "https://nexus.test/api/v1/normativa/pyramid?jurisdiccion=CO");
  assert.ok(r.content.includes("rails-only"));
});

test("nexus_corpus_coverage GET formatea el inventario", async (t) => {
  const cap = {};
  mockFetch(t, {
    generatedAt: "2026-07-08T00:00:00Z", totalDocs: 561513, totalTables: 1,
    tables: [{ table: "jurisprudencia_docs", inferredJurisdiction: "ES", totalDocs: 278425, oldestDoc: "1979-01-24", newestDoc: "2026-05-05", topSources: [{ source: "cendoj_ts", count: 137341 }] }],
  }, cap);
  const r = await corpusCoverageTool.handler({}, cfg);
  assert.equal(cap.url, "https://nexus.test/api/v1/corpus/coverage");
  assert.equal(cap.init.method, "GET");
  assert.ok(r.content.includes("ES — jurisprudencia_docs"));
  assert.ok(r.content.includes("cendoj_ts (137341)"));
});

test("nexus_normativa_coverage GET formatea jurisdicciones + lag", async (t) => {
  mockFetch(t, {
    jurisdicciones: ["ES", "CO"], total_normas: 14000, total_versiones: 20000, total_articulos: 356000,
    ultima_actualizacion: "2026-07-01T00:00:00Z", lag_dias: 7, status: "active",
  });
  const r = await normativaCoverageTool.handler({}, cfg);
  assert.ok(r.content.includes("Jurisdictions:** ES, CO"));
  assert.ok(r.content.includes("lag 7 day(s)"));
});

/**
 * ── Lo que este fixture NO miraba (2026-08-18) ─────────────────────────────
 *
 * El de arriba fija cabecera, jurisdicciones y lag sobre la respuesta VIEJA. Se quedó en verde
 * mientras la tool servía a un despacho británico **887.263 artículos** que son ES+EU+CO, sin
 * sus 695.446 propios y sin decir que el total los excluye — este renderizador ni siquiera
 * pintaba `not_aggregated`, que su gemelo HTTP sí pintaba.
 *
 * Un fixture que no incluye los campos nuevos no es una prueba de que se rendericen: es una
 * prueba de que el render no se cae sin ellos.
 *
 * 🔴 Cada afirmación va atada al CAMPO y a la SECCIÓN. El fixture ya imprime «sin medir» por su
 * cuenta (GB no tiene normas ni versiones medidas), así que buscar «sin medir» a secas pasaría
 * también con el `?? 0` puesto: lo que discrimina es la LÍNEA de totales completa.
 *
 * Gemelo de `tests/unit/mcp-http.test.ts`: mismos casos, mismas cifras, mismo reparto de
 * asserts. Lo que se comprueba en una superficie se comprueba en la otra.
 */
const COBERTURA_NUEVA = {
  jurisdicciones: ["CO", "ES", "EU", "GB", "SG"],
  counted_in_totals: ["CO", "ES", "EU"],
  not_aggregated: ["GB", "SG"],
  total_normas: 23434, total_versiones: 23432, total_articulos: 887263,
  ultima_actualizacion: "2026-07-08T09:50:17Z", lag_dias: 40, status: "active",
  por_jurisdiccion: [
    {
      jurisdiction: "GB", store: "vector", source: "LegislacionUkV3",
      normas: null, versiones: null, articulos: 695446,
      countStatus: "counted", countedInTotals: false, searchable: true,
      ultimaActualizacion: "2026-08-07T04:27:46Z", lagDias: 11,
    },
    {
      jurisdiction: "ES", store: "relational", source: "normativa_articulos",
      normas: 13921, versiones: 23432, articulos: 356048,
      countStatus: "counted", countedInTotals: true, searchable: true,
      ultimaActualizacion: "2026-07-08T09:50:17Z", lagDias: 40,
    },
  ],
  warnings: [
    { code: "vector_store_load_date_pending", severity: "gap", message: "No load date for: SG." },
    { code: "totals_cover_one_store_only", severity: "caveat", message: "Totals cover one store." },
  ],
  scope: { authenticated: true, entitled: ["GB", "ES"], note: "only the jurisdictions this account has active" },
};

/** Literal de la sección de desglose CUANDO hay filas… */
const DESGLOSE_HAY = "**Per-jurisdiction breakdown** (the ones active on this account):";
/** …y cuando no las hay. Comparten prefijo a propósito: por eso el assert es el sufijo. */
const DESGLOSE_VACIO = "**Per-jurisdiction breakdown:** none for this account.";

test("coverage · un despacho GB ve SU cifra en el desglose, marcada como fuera de los totales", async (t) => {
  mockFetch(t, COBERTURA_NUEVA);
  const r = await normativaCoverageTool.handler({}, cfg);
  // La línea entera, no la cifra suelta: 695446 podría salir en cualquier sitio y seguiría sin
  // contestar «¿y lo mío?». Aquí sale con su almacén, su marca y la fecha de nuestra copia.
  assert.ok(r.content.includes(
    "- **GB** — articles 695446 · instruments not measured · versions not measured\n"
    + "  vector store (`LegislacionUkV3`) · ⚠ NOT counted in the totals above · search enabled"
    + " · our copy last written 2026-08-07T04:27:46Z (lag 11 day(s))",
  ), "la línea de GB no sale entera en el desglose");
  // Y la jurisdicción que SÍ suma se marca al revés — si las dos salieran iguales, la marca no
  // estaría diciendo nada.
  assert.ok(r.content.includes("- **ES** — articles 356048 · instruments 13921 · versions 23432"));
  assert.ok(r.content.includes("relational store (`normativa_articulos`) · counted in the totals above"));
  // Y el aviso de cabecera, que es OTRA cosa que la marca por línea: el que este renderizador
  // no pintaba y su gemelo HTTP sí.
  assert.ok(r.content.includes("⚠ **The totals above do NOT count GB, SG.**"),
    "falta el aviso de not_aggregated (el que no se pintaba)");
});

test("coverage · CONTRA-FIXTURA: un total ausente no se pinta como 0 ni se lleva el que sí vino", async (t) => {
  mockFetch(t, { ...COBERTURA_NUEVA, total_articulos: null, total_normas: null, ultima_actualizacion: null });
  const r = await normativaCoverageTool.handler({}, cfg);
  // `total_versiones` sigue siendo 23432: el marcador sustituye lo que falta, no la línea.
  assert.ok(r.content.includes("**Instruments:** not measured · **Versions:** 23432 · **Articles:** not measured"),
    "un hueco tiene que verse como hueco, y solo donde lo hay");
  assert.ok(!r.content.includes("**Articles:** 0"), "un 0 inventado se lee como «no hay legislación»");
  // Una fecha ausente tampoco es «nunca» ni el viejo `N/A`, que decía «no aplica».
  assert.ok(r.content.includes("**Last update:** not measured"));
  assert.ok(!r.content.includes("N/A"));
});

test("coverage · CONTROL POSITIVO: un 0 de verdad sí se escribe como 0", async (t) => {
  mockFetch(t, { ...COBERTURA_NUEVA, total_articulos: 0 });
  const r = await normativaCoverageTool.handler({}, cfg);
  assert.ok(r.content.includes("**Articles:** 0"),
    "si «sin medir» se comiera los ceros reales, el marcador no distinguiría entre no haber "
    + "medido y haber medido cero");
  assert.ok(!r.content.includes("**Articles:** not measured"));
});

test("coverage · sin desglose se dice — ausente y `[]` se tratan igual", async (t) => {
  const { por_jurisdiccion, ...sinDesglose } = COBERTURA_NUEVA;
  void por_jurisdiccion;
  for (const payload of [sinDesglose, { ...COBERTURA_NUEVA, por_jurisdiccion: [] }]) {
    mockFetch(t, payload);
    const r = await normativaCoverageTool.handler({}, cfg);
    assert.ok(r.content.includes(DESGLOSE_VACIO), "el silencio deja los totales ajenos como única cifra");
    assert.ok(r.content.includes("are not yours"), "hay que decir de quién son los totales");
    assert.ok(!r.content.includes(DESGLOSE_HAY));
  }
});

test("coverage · CONTROL: con desglose NO aparece el texto de «no hay desglose»", async (t) => {
  // El gemelo del test de arriba. Los dos literales comparten el prefijo «Desglose por
  // jurisdicción», así que sin esta mitad bastaría con buscar ese prefijo —presente en los dos
  // casos— para tener un test que pasa siempre y no distingue nada.
  mockFetch(t, COBERTURA_NUEVA);
  const r = await normativaCoverageTool.handler({}, cfg);
  assert.ok(r.content.includes(DESGLOSE_HAY));
  assert.ok(!r.content.includes(DESGLOSE_VACIO));
});

test("coverage · huecos y matices van CADA UNO bajo su sección", async (t) => {
  mockFetch(t, COBERTURA_NUEVA);
  const r = await normativaCoverageTool.handler({}, cfg);
  const iSecHuecos  = r.content.indexOf("**Inventory gaps**");
  const iGap        = r.content.indexOf("`vector_store_load_date_pending`");
  const iSecMatices = r.content.indexOf("**How to read these figures**");
  const iCaveat     = r.content.indexOf("`totals_cover_one_store_only`");
  assert.ok(iSecHuecos >= 0 && iSecMatices >= 0, "los avisos no llegan al lector del MCP");
  // El orden ata cada aviso a SU sección: un `gap` listado bajo «cómo leer estas cifras» es un
  // hueco disfrazado de matiz, que es justo lo que no puede pasar.
  assert.ok(iSecHuecos < iGap, "el hueco no está bajo la sección de huecos");
  assert.ok(iGap < iSecMatices, "primero lo que falta, después cómo leer lo que hay");
  assert.ok(iSecMatices < iCaveat, "el matiz no está bajo la sección de matices");
  assert.ok(r.content.includes("- `vector_store_load_date_pending` — No load date for: SG."));
  // La nota de alcance dice que esto es lo de ESTA cuenta, y el rótulo avisa de que ese texto
  // llega en inglés en vez de fingir que está traducido.
  assert.ok(r.content.includes("only the jurisdictions this account has active"));
});

test("coverage · la fecha se etiqueta como la de NUESTRA COPIA", async (t) => {
  mockFetch(t, COBERTURA_NUEVA);
  const r = await normativaCoverageTool.handler({}, cfg);
  assert.ok(r.content.includes("**OUR COPY**"),
    "sin esto se cree que la ley está al día cuando lo único al día es la ingestión");
  assert.ok(r.content.includes("our copy last written 2026-08-07T04:27:46Z"));
});
