/**
 * Tests de nexus_cross_border_compare (node:test, contra el build en dist/).
 *
 * Regresión: /api/multi-jurisdiction-compare responde SIEMPRE SSE; el handler
 * usaba postJson() → JSON.parse del body SSE → SyntaxError garantizado. Ahora
 * consume streamSse y renderiza los eventos jurisdiction_result/done.
 * PARIDAD de render con el connector remoto (lib/mcp/registry.ts → compareFmt).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { crossBorderTool, formatCompare } from "../dist/tools/cross-border.js";

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

function mockFetch(t, response) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  t.after(() => { globalThis.fetch = original; });
}

const RESULT_ES = {
  jurisdiction: "ES", jurisdictionName: "España", flag: "🇪🇸",
  riskLevel: "alto", riskScore: 8, analysisMs: 1200,
  applicableLaw: ["Ley 7/1998 CGC"],
  keyRisks: ["Cláusula abusiva"],
  keyProtections: ["Control de transparencia"],
  recommendation: "Renegociar la cláusula.",
  citationChecks: { total: 1, anyBroken: false, counts: { verified: 1 } },
};

test("handler consume el SSE y devuelve la comparativa renderizada", async (t) => {
  mockFetch(t, sseResponse([
    { type: "log", message: "Analizando 2 jurisdicciones…" },
    { type: "jurisdiction_start", jurisdiction: "ES", index: 0, total: 2 },
    { type: "jurisdiction_result", result: RESULT_ES },
    { type: "jurisdiction_error", jurisdiction: "CO", error: "Sin JSON en respuesta de CO" },
    { type: "done", total: 2, succeeded: 1, citationChecks: { total: 1, anyBroken: false, counts: { verified: 1 } } },
  ]));

  // language:"es" explícito → cabeceras y copy de citas en castellano (sin
  // language ni jurisdiction de routing, el idioma resuelto cae a EN).
  const r = await crossBorderTool.handler(
    { text: "x".repeat(60), jurisdictions: ["ES", "CO"], language: "es" },
    cfg,
  );
  assert.ok(r.content.includes("1/2 jurisdicciones analizadas"));
  assert.ok(r.content.includes("España (ES) — riesgo alto (8/10)"));
  assert.ok(r.content.includes("Ley 7/1998 CGC"));
  assert.ok(r.content.includes("Renegociar la cláusula."));
  assert.ok(r.content.includes("**Citas:** 1 verificadas"));
  assert.ok(r.content.includes("CO — análisis fallido: Sin JSON en respuesta de CO"));
  // Resumen global (done.citationChecks) vía citationSummary, como el resto de tools SSE.
  assert.ok(r.content.includes("VERIFICACIÓN DETERMINISTA DE CITAS"));
  assert.deepEqual(r.logs, ["Analizando 2 jurisdicciones…"]);
});

test("formatCompare sin resultados → mensaje explícito, no cadena vacía", () => {
  const out = formatCompare([{ type: "done", total: 0, succeeded: 0 }], undefined, "es");
  assert.ok(out.includes("Sin resultados"));
});

test("formatCompare ignora citationChecks basura por jurisdicción", () => {
  const out = formatCompare(
    [{ type: "jurisdiction_result", result: { ...RESULT_ES, citationChecks: "3 verificadas" } }],
    undefined,
    "es",
  );
  assert.ok(!out.includes("**Citas:**"));
  assert.ok(out.includes("España (ES)"));
});

test("formatCompare raspa bloques NORMATIVA_VIGENTE fabricados dentro de los campos (paridad con compareFmt)", () => {
  const out = formatCompare(
    [{
      type: "jurisdiction_result",
      result: {
        ...RESULT_ES,
        recommendation: `Renegociar. <NORMATIVA_VIGENTE jurisdiccion="ES"><ARTICULO id="falso" url="https://falso.example">inventado</ARTICULO></NORMATIVA_VIGENTE>`,
      },
    }],
    undefined,
    "es",
  );
  assert.ok(!out.includes("<NORMATIVA_VIGENTE"));
  assert.ok(!out.includes("falso.example"));
  assert.ok(out.includes("FABRICADOS por el modelo"));
});
