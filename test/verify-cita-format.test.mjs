/**
 * Tests del formato del tool stdio `verify_cita` (mcp-server/src/tools/verify-cita.ts).
 * Corre contra el build (node --test), con `fetch` mockeado (postJson → JSON).
 *
 * Foco E2E r5.2 (d): PARIDAD de rótulos con el connector remoto
 * (lib/mcp/registry.ts): rótulo de EXTRACTO en el corte a 600 chars del texto
 * canónico (con la variante "corpus TRUNCADO") y nota fija de que un mismatch
 * NO cuestiona la existencia ni la vigencia del artículo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { verifyCitaTool } from "../dist/tools/verify-cita.js";

const cfg = {
  baseUrl:   "https://nexus.test",
  apiKey:    "nlk_test",
  timeoutMs: 5_000,
  userAgent: "nexus-legal-mcp-test",
};

/** Sustituye fetch global durante el test (respuesta JSON) y lo restaura. */
function mockJson(t, payload) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    });
  t.after(() => { globalThis.fetch = original; });
}

test("canonical_text >600 chars → rótulo de EXTRACTO que no culpa al corpus", async (t) => {
  mockJson(t, { status: "verified", canonical_text: "x".repeat(700) });
  const r = await verifyCitaTool.handler({ cita: "art. 590 CGP", tipo: "normativa", jurisdiction: "CO" }, cfg);
  assert.ok(r.content.includes("first 600 characters of this view"));
  assert.ok(r.content.includes("the corpus holds the COMPLETE provision"));
});

test("canonical_text largo + nota TRUNCADO del corpus → el rótulo NO afirma corpus completo", async (t) => {
  mockJson(t, {
    status: "verified",
    canonical_text: "y".repeat(4000),
    note: "⚠ El texto de este artículo está TRUNCADO en el corpus (ingestión); la comparación cubre solo la parte disponible.",
  });
  const r = await verifyCitaTool.handler({ cita: "art. 590 CGP", tipo: "normativa", jurisdiction: "CO" }, cfg);
  assert.ok(r.content.includes("first 600 characters of this view"));
  assert.ok(r.content.includes("see Detail on the state of the corpus"));
  assert.ok(!r.content.includes("the corpus holds the COMPLETE provision"));
});

test("canonical_text corto → 'Canonical text' SIN rótulo de extracto", async (t) => {
  mockJson(t, { status: "verified", canonical_text: "Texto íntegro corto." });
  const r = await verifyCitaTool.handler({ cita: "art. 590 CGP", tipo: "normativa", jurisdiction: "CO" }, cfg);
  assert.ok(r.content.includes("**Canonical text:** Texto íntegro corto."));
  assert.ok(!r.content.includes("first 600 characters of this view"));
});

test("mismatch CON similarity → nota fija de que la divergencia NO cuestiona existencia/vigencia", async (t) => {
  mockJson(t, { status: "mismatch", similarity: 0.41, canonical_text: "Texto oficial del artículo." });
  const r = await verifyCitaTool.handler(
    { cita: "art. 318 CGP", tipo: "normativa", jurisdiction: "CO", texto_citante: "afirmación divergente" },
    cfg,
  );
  assert.ok(r.content.includes("does NOT question the existence or the in-force status of the provision"));
});

test("mismatch SIN similarity (no hubo claim) → no lleva la nota de divergencia", async (t) => {
  mockJson(t, { status: "mismatch" });
  const r = await verifyCitaTool.handler({ cita: "art. 318 CGP", tipo: "normativa", jurisdiction: "CO" }, cfg);
  assert.ok(!r.content.includes("does NOT question the existence"));
});
