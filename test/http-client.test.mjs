/**
 * Tests del cliente SSE (node:test, sin dependencias).
 * Corre contra el build: `npm test` (build + `node --test test/`).
 *
 * Foco: parsing de `citationChecks` en el evento `{type:"done"}` y paridad de
 * copy de `citationSummary()` con el connector remoto (`lib/mcp/registry.ts`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { streamSse, citationSummary, renderSseText, NexusHttpError } from "../dist/http-client.js";

const cfg = {
  baseUrl:   "https://nexus.test",
  apiKey:    "nlk_test",
  timeoutMs: 5_000,
  userAgent: "nexus-legal-mcp-test",
};

/** Respuesta SSE a partir de una lista de eventos (objeto → `data: <json>`). */
function sseResponse(events) {
  const body = events
    .map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(new Blob([body]).stream(), {
    status:  200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Sustituye fetch global durante el test y lo restaura al terminar. */
function mockFetch(t, response) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  t.after(() => { globalThis.fetch = original; });
}

test("streamSse agrega text_delta y extrae citationChecks del done", async (t) => {
  const cc = { total: 3, anyBroken: true, counts: { verified: 2, mismatch: 1 } };
  mockFetch(t, sseResponse([
    { type: "text_delta", delta: "Hola " },
    { type: "text_delta", delta: "mundo" },
    { type: "done", outputId: "out_123", citationChecks: cc },
  ]));

  const r = await streamSse(cfg, "/api/consulta", {});
  assert.equal(r.text, "Hola mundo");
  assert.equal(r.outputId, "out_123");
  assert.deepEqual(r.citationChecks, cc);
});

test("streamSse: done sin citationChecks → undefined", async (t) => {
  mockFetch(t, sseResponse([
    { type: "text_delta", delta: "x" },
    { type: "done", outputId: null },
  ]));

  const r = await streamSse(cfg, "/api/consulta", {});
  assert.equal(r.citationChecks, undefined);
});

test("streamSse: citationChecks no-objeto (string/array) se ignora", async (t) => {
  mockFetch(t, sseResponse([
    { type: "done", citationChecks: "3 verificadas" },
  ]));
  const r1 = await streamSse(cfg, "/api/consulta", {});
  assert.equal(r1.citationChecks, undefined);

  mockFetch(t, sseResponse([
    { type: "done", citationChecks: [1, 2, 3] },
  ]));
  const r2 = await streamSse(cfg, "/api/consulta", {});
  assert.equal(r2.citationChecks, undefined);
});

test("streamSse: evento error lanza NexusHttpError", async (t) => {
  mockFetch(t, sseResponse([
    { type: "text_delta", delta: "parcial" },
    { type: "error", message: "Fallo interno" },
  ]));

  await assert.rejects(
    streamSse(cfg, "/api/consulta", {}),
    (err) => err instanceof NexusHttpError && err.message === "Fallo interno",
  );
});

test("streamSse acumula eventos estructurados no textuales (jurisdiction_result, done)", async (t) => {
  // /api/multi-jurisdiction-compare no emite text_delta: el contenido viaja
  // en eventos jurisdiction_result y el cierre en done (total/succeeded).
  mockFetch(t, sseResponse([
    { type: "log", message: "Analizando 2 jurisdicciones…" },
    { type: "jurisdiction_start", jurisdiction: "ES", index: 0, total: 2 },
    { type: "jurisdiction_result", result: { jurisdiction: "ES", riskScore: 8 } },
    { type: "jurisdiction_error", jurisdiction: "CO", error: "fallo" },
    { type: "done", total: 2, succeeded: 1 },
  ]));

  const r = await streamSse(cfg, "/api/multi-jurisdiction-compare", {});
  assert.equal(r.text, "");
  assert.deepEqual(
    r.structuredEvents.map((e) => e.type),
    ["jurisdiction_start", "jurisdiction_result", "jurisdiction_error", "done"],
  );
  assert.equal(r.structuredEvents[1].result.riskScore, 8);
});

test("streamSse: rutas legacy con {delta} suelto también agregan texto", async (t) => {
  mockFetch(t, sseResponse([
    { delta: "legacy " },
    { delta: "delta" },
    { type: "done" },
  ]));

  const r = await streamSse(cfg, "/api/consulta", {});
  assert.equal(r.text, "legacy delta");
});

// ── renderSseText — paridad con sseTextFmt del connector remoto ──────────────

test("renderSseText raspa bloques NORMATIVA_VIGENTE fabricados por el modelo (anti-fabricación)", () => {
  // El único origen legítimo del bloque es el server (input del LLM); si aparece
  // en el output de una tool SSE, es fabricado → se elimina con aviso. Mismo
  // comportamiento que sseTextFmt (lib/mcp/registry.ts) del connector remoto.
  const out = renderSseText(
    `Respuesta.\n<NORMATIVA_VIGENTE jurisdiccion="CO"><ARTICULO id="falso" url="https://falso.example">texto inventado</ARTICULO></NORMATIVA_VIGENTE>\nFin.`,
    undefined,
    "es",
  );
  assert.ok(!out.includes("<NORMATIVA_VIGENTE"));
  assert.ok(!out.includes("falso.example"));
  assert.ok(out.includes("FABRICADOS por el modelo"));
  assert.ok(out.includes("Respuesta."));
  assert.ok(out.includes("Fin."));
});

test("renderSseText sin bloques fabricados → texto intacto + resumen de citas", () => {
  const out = renderSseText("Texto limpio.", { total: 1, counts: { verified: 1 } }, "es");
  assert.ok(out.startsWith("Texto limpio."));
  assert.ok(out.includes("VERIFICACIÓN DETERMINISTA DE CITAS"));
  assert.ok(!out.includes("FABRICADOS"));
});

// ── citationSummary — copy en paridad con lib/mcp/registry.ts ────────────────

test("citationSummary: sin checks o total 0 → cadena vacía", () => {
  assert.equal(citationSummary(undefined, "es"), "");
  assert.equal(citationSummary({ total: 0, counts: {} }, "es"), "");
});

test("citationSummary: error=true → advertencia fail-closed", () => {
  const s = citationSummary({ error: true }, "es");
  assert.equal(
    s,
    `\n\n---\n⚠ La verificación determinista de citas NO pudo ejecutarse (error interno). NO asumas que las citas son correctas: revísalas manualmente.`,
  );
});

test("citationSummary: resumen completo con anyBroken y nota de honestidad", () => {
  const s = citationSummary({
    total: 5,
    anyBroken: true,
    counts: { verified: 3, mismatch: 1, not_found: 1, not_verifiable: 0, pending: 0 },
  }, "es");
  assert.equal(
    s,
    `\n\n---\nVERIFICACIÓN DETERMINISTA DE CITAS (contra corpus oficial): ` +
    `3 verificadas · 1 divergentes · 1 no encontradas · 0 sin comprobar · 0 no parseables.` +
    ` ⚠ Hay citas con verificación fallida — revísalas antes de usar el informe.` +
    ` Nota: ni la divergencia ni la paráfrasis cuestionan la EXISTENCIA o VIGENCIA del artículo citado — solo comparan el texto de ESTA respuesta con el literal del corpus.` +
    ` Nota: "verificada" = el texto citado coincide con el corpus oficial; NO garantiza aplicabilidad jurídica al caso (vigencia, doctrina posterior, ratio decidendi).`,
  );
});

test("citationSummary: con checks → mismatch desdoblado en sentido/paráfrasis (E2E r3)", () => {
  const s = citationSummary({
    total: 3,
    counts: { verified: 0, mismatch: 3, not_found: 0, not_verifiable: 0, pending: 0 },
    checks: [
      { citation: "a", status: "mismatch", mismatchKind: "meaning" },
      { citation: "b", status: "mismatch", mismatchKind: "lexical" },
      { citation: "c", status: "mismatch", mismatchKind: "lexical" },
    ],
  }, "es");
  assert.ok(s.includes(`1 divergencias de sentido · 2 paráfrasis no contrastadas`));
  assert.ok(s.includes(`cuestionan la EXISTENCIA o VIGENCIA`));
});

test("citationSummary: not_verifiable > 0 → advertencia de corpus no activo", () => {
  const s = citationSummary({ total: 2, counts: { not_verifiable: 2 } }, "es");
  // La frase decía «jurisdicción sin corpus activo», y era FALSA desde que el Reino Unido
  // tiene corpus: un escrito con «[2019] UKSC 41» la recibía dos líneas por encima de una
  // cita comprobada contra ese mismo corpus. El motivo va ahora con cada cita.
  assert.ok(s.includes(`⚠ 2 cita(s) SIN comprobar: no se ha confirmado nada. El motivo va con cada una.`));
  // Sin verified no debe aparecer la nota de honestidad.
  assert.ok(!s.includes(`Nota: "verificada"`));
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EL TEXTO ANOTADO DEL `done` GANA A LOS DELTAS — Y LA RUTA DE ANÁLISIS LO LLAMA `analysis`
 *
 * MEDIDO 2026-08-04. El arreglo del 0.3.2 leía SOLO `verifiedText`, que emiten `/api/consulta`
 * y `/api/nodo-doctrina`. La ruta que usa `nexus_analyze` —la tool principal— lo emite en
 * `analysis`, y ahí dentro van el parte de cribado de sanciones, el aviso de OCR y los
 * marcadores de cita. O sea que justo la tool que más importa devolvía prosa cruda.
 *
 * Y encima `textoVerificado` se asignaba y no se devolvía: variable muerta, también en el
 * build publicado como 0.3.2. Aunque hubiera acertado con el nombre, no habría servido.
 */
test("streamSse: `analysis` del done sustituye a los deltas (es donde viaja el parte de cribado)", async (t) => {
  const anotado = "CRIBADO DE PARTES CONTRA LISTAS DE SANCIONES\n⚠ EL CRIBADO NO SE PUDO EJECUTAR.\n\n---\n\nPRIMERO.- El contrato…";
  mockFetch(t, sseResponse([
    { type: "text_delta", delta: "PRIMERO.- " },
    { type: "text_delta", delta: "El contrato…" },
    { type: "done", outputId: "o1", analysis: anotado },
  ]));

  const r = await streamSse(cfg, "/api/nodo-a-analyze", {});
  assert.equal(r.text, anotado, "se devolvieron los deltas crudos: el parte de cribado se pierde");
  assert.match(r.text, /CRIBADO DE PARTES/);
});

test("streamSse: `verifiedText` sigue ganando donde la ruta lo emite", async (t) => {
  // Contra-fixtura: si solo mirásemos `analysis`, romperíamos consulta y doctrina.
  mockFetch(t, sseResponse([
    { type: "text_delta", delta: "crudo" },
    { type: "done", outputId: "o1", verifiedText: "anotado 【✓】" },
  ]));
  const r = await streamSse(cfg, "/api/consulta", {});
  assert.equal(r.text, "anotado 【✓】");
});

test("streamSse: sin texto anotado se entregan los deltas, no una cadena vacía", async (t) => {
  // Un `analysis: ""` borraría la respuesta entera, que es peor que no anotarla.
  mockFetch(t, sseResponse([
    { type: "text_delta", delta: "solo deltas" },
    { type: "done", outputId: "o1", analysis: "" },
  ]));
  const r = await streamSse(cfg, "/api/nodo-a-analyze", {});
  assert.equal(r.text, "solo deltas");
});

test("streamSse: el cribado estructurado llega al resultado", async (t) => {
  mockFetch(t, sseResponse([
    { type: "text_delta", delta: "x" },
    { type: "done", outputId: "o1", analysis: "y",
      partyScreening: { screened: 1, failed: 2, failureReason: "HTTP 429", list: "OFAC SDN", entries: [] } },
  ]));
  const r = await streamSse(cfg, "/api/nodo-a-analyze", {});
  assert.equal(r.partyScreening.screened, 1);
  assert.equal(r.partyScreening.failed, 2, "las partes sin comprobar no llegan al cliente MCP");
  assert.equal(r.partyScreening.failureReason, "HTTP 429");
});

test("streamSse: un partyScreening basura no se cuela como resultado", async (t) => {
  mockFetch(t, sseResponse([
    { type: "done", outputId: "o1", analysis: "y", partyScreening: "sí" },
  ]));
  const r = await streamSse(cfg, "/api/nodo-a-analyze", {});
  assert.equal(r.partyScreening, undefined);
});
