/**
 * Tests del tool nexus_consensus (stdio) — node:test, fetch mockeado.
 * Corre contra el build: `npm test` (build + `node --test test/`).
 *
 * Foco: (1) SSE directo contra /api/nodo-consensus (el stdio NO tiene el
 * límite de 60s del conector claude.ai → sin submit+poll); (2) el resultado
 * REAL viaja en el evento `done` (los text_delta son solo progreso) → se
 * compone un texto legible con el veredicto de consenso y se renderiza con
 * renderSseText (paridad con el resto de tools SSE); (3) jurisdiction es
 * OBLIGATORIA y sin default (jurisdicciones_son_pares).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { consensusTool, composeConsensusText } from "../dist/tools/consensus.js";

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

/** Sustituye fetch global durante el test (capturando llamadas) y lo restaura. */
function mockFetch(t, response) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

const DONE_EVT = {
  type: "done",
  analysis: "ANALISIS-FINAL con art. 1124 CC.",
  audit: "AUDITORIA-FINAL: dictamen de consenso.",
  consensusVerdict: "CONSENSO_TOTAL",
  consensusLabel: "CONSENSO TOTAL",
  nodoBVerdict: "CONSENSO_TOTAL",
  confidenceScore: 92,
  iterations: [
    { iteration: 1, nodoBVerdict: "DISCREPANCIA_PARCIAL", confidenceScore: 40, consensus: false },
    { iteration: 2, nodoBVerdict: "CONSENSO_TOTAL", confidenceScore: 92, consensus: true },
  ],
  citationChecks: { total: 1, anyBroken: false, counts: { verified: 1 } },
};

test("nexus_consensus: SSE directo a /api/nodo-consensus y compone el done (veredicto legible, sin log de progreso)", async (t) => {
  const calls = mockFetch(t, sseResponse([
    { type: "log", message: "Consenso multi-agente server-side iniciado (jurisdicción CO)." },
    { type: "text_delta", delta: "▸ Nodo A analizando…\n" },
    { type: "text_delta", delta: "✔ CONSENSO TOTAL\n" },
    DONE_EVT,
  ]));

  const r = await consensusTool.handler({ text: "x".repeat(60), jurisdiction: "CO" }, cfg);

  // SSE directo contra la ruta interna (patrón nexus_audit, sin submit+poll).
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://nexus.test/api/nodo-consensus");
  assert.equal(calls[0].init.headers.Accept, "text/event-stream");
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.jurisdiction, "CO");

  // Veredicto de consenso legible + informe + auditoría (compuestos del done).
  // CO → `es`: el andamiaje ENTERO va en castellano. Antes esta misma aserción exigía
  // «### Final report (Node A)» con la cabecera en castellano justo encima — o sea, el
  // test fijaba la forma MEZCLADA como si fuera lo correcto.
  assert.match(r.content, /## Consenso multi-agente Nodo A ↔ Nodo B — CONSENSO TOTAL · confianza Nodo B 92\/100/);
  assert.match(r.content, /\*\*Iteraciones A↔B:\*\* 1: DISCREPANCIA_PARCIAL \(conf\. 40\) → 2: CONSENSO_TOTAL \(conf\. 92\)/);
  assert.match(r.content, /### Informe final \(Nodo A\)/);
  assert.match(r.content, /ANALISIS-FINAL con art\. 1124 CC\./);
  assert.match(r.content, /### Auditoría final \(Nodo B\)/);
  assert.match(r.content, /AUDITORIA-FINAL: dictamen de consenso\./);
  assert.ok(!/Multi-agent consensus|A↔B iterations|### Final report/.test(r.content),
    "se ha colado andamiaje inglés en un informe castellano");
  // El log de progreso NO es parte del entregable.
  assert.ok(!r.content.includes("▸ Nodo A analizando"));
  // Render de paridad (renderSseText): resumen determinista de citas al pie.
  assert.match(r.content, /VERIFICACIÓN DETERMINISTA DE CITAS/);
  assert.match(r.content, /1 verificadas/);
  // Los logs SSE se exponen como logs (debugging del cliente).
  assert.ok(r.logs.some((l) => l.includes("Consenso multi-agente server-side iniciado")));
});

/**
 * 🔴 GEMELO. El test de arriba, solo, prueba que el andamiaje castellano existe — que es lo
 * que ya hacía cuando estaba fijado en castellano PARA TODOS. Sin este par, cambiar un idioma
 * fijo por otro pasaría en verde. Y este es el caso que importaba: GB → `en`, y el solicitor
 * recibía cabecera e iteraciones en castellano alrededor de un informe inglés.
 *
 * PARIDAD con `tests/unit/mcp-jobs-consensus.test.ts` del conector remoto: los dos carriles
 * MCP componen el MISMO andamiaje, así que los dos se comprueban igual.
 */
test("nexus_consensus: GB → el andamiaje ENTERO va en inglés (gemelo del caso CO)", async (t) => {
  mockFetch(t, sseResponse([DONE_EVT]));
  const r = await consensusTool.handler({ text: "x".repeat(60), jurisdiction: "GB" }, cfg);

  assert.match(r.content, /## Multi-agent consensus Node A ↔ Node B — CONSENSO TOTAL · Node B confidence 92\/100/);
  assert.match(r.content, /\*\*A↔B iterations:\*\* 1: DISCREPANCIA_PARCIAL \(conf\. 40\) → 2: CONSENSO_TOTAL \(conf\. 92\)/);
  assert.match(r.content, /### Final report \(Node A\)/);
  assert.match(r.content, /### Final audit \(Node B\)/);
  // Ni una palabra del andamiaje castellano se cuela en el informe inglés.
  assert.ok(!/Consenso multi-agente|confianza Nodo B|Iteraciones A↔B|Informe final|Auditoría final/.test(r.content),
    "se ha colado andamiaje castellano en un informe inglés");
  // 🔴 CONTRA-ASERCIÓN: `consensusLabel` y `nodoBVerdict` son valores de PROTOCOLO y
  // siguen viajando tal cual — traducirlos los haría divergir de lo que manda el backend.
  assert.match(r.content, /CONSENSO TOTAL/);
  assert.match(r.content, /DISCREPANCIA_PARCIAL/);
});

test("nexus_consensus: jurisdiction es OBLIGATORIA (sin default) — zod rechaza sin llamar al backend", async (t) => {
  const calls = mockFetch(t, sseResponse([DONE_EVT]));
  // El mensaje pasó a inglés con código estable en MAYÚSCULAS (2026-07-26): quien
  // consume el conector es un integrador, no un usuario final, y un código en máquina
  // es lo que le permite ramificar. El invariante NO cambia: un stream sin `done`
  // válido tiene que fallar con claridad, y jamás entregar el progreso como informe.
  await assert.rejects(
    () => consensusTool.handler({ text: "x".repeat(60) }, cfg),
    (err) => err.name === "ZodError",
  );
  assert.equal(calls.length, 0);
});

test("nexus_consensus: stream sin evento done válido → error claro (no entrega el progreso como informe)", async (t) => {
  mockFetch(t, sseResponse([{ type: "text_delta", delta: "▸ Nodo A analizando…\n" }]));
  await assert.rejects(
    () => consensusTool.handler({ text: "x".repeat(60), jurisdiction: "CO" }, cfg),
    /CONSENSUS_NO_RESULT/,
  );
});

test("composeConsensusText: null sin analysis; label cae al verdict (PARCIAL)", () => {
  assert.equal(composeConsensusText(undefined), null);
  assert.equal(composeConsensusText({ type: "done", analysis: "  " }), null);
  const partial = composeConsensusText({ type: "done", analysis: "A", consensusVerdict: "CONSENSO_PARCIAL" });
  assert.match(partial, /— CONSENSO PARCIAL/);
});
