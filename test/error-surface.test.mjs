/**
 * Candados del 2026-07-27 — lo que el desarrollador VE cuando el backend rechaza.
 *
 * Tres cosas se rendían mal y las tres son de la misma familia:
 *   1. La versión declarada era "0.1.0" fija en el handshake y en el User-Agent,
 *      con el paquete publicado en 0.3.0.
 *   2. Un rechazo HTTP con código estable (409 BYO_PROVIDER_REQUIRED, el estado
 *      NORMAL de una cuenta que solo corre en su propio motor) salía como
 *      "Nexus backend respondió 409 Conflict" + un volcado crudo de JSON.
 *   3. El mismo rechazo llegado por frame SSE se convertía en un error 500 —
 *      avería nuestra— y tiraba el código.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { streamSse, httpErrorFrom, parseNexusError } from "../dist/http-client.js";
import { PACKAGE_VERSION } from "../dist/config.js";

// Redacción REAL de `lib/llm/byo-engine-notice.ts` → byoRequiredApiMessage().
const BYO_MESSAGE =
  "This account requires its own BYO LLM engine for AI-generative endpoints " +
  "(nodes A/B/C, consulta, chat): it is provisioned so that generation never runs " +
  "on a Nexus engine, and no provider is enabled yet. This is a configuration state, " +
  "not a transient failure — retrying returns the same 409. Register and enable a " +
  "provider via POST /api/v1/llm-providers, then retry.";

const byoBody = JSON.stringify({
  error: {
    type: "conflict_error",
    code: "BYO_PROVIDER_REQUIRED",
    message: BYO_MESSAGE,
    request_id: "req_test",
    details: { docs: "https://nexusquantum.legal/developers/docs#byo-llm" },
  },
  error_message: BYO_MESSAGE,
  code: "BYO_PROVIDER_REQUIRED",
});

// ─── 1. Versión declarada = versión publicada ────────────────────────────────
// MUTACIÓN QUE LO PONE EN ROJO: volver a clavar `PACKAGE_VERSION` a un literal, o
// subir package.json sin que el runtime lo lea.
test("PACKAGE_VERSION es la versión real del package.json publicado", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    PACKAGE_VERSION,
    pkg.version,
    `El servidor se anuncia como ${PACKAGE_VERSION} y el paquete publica ${pkg.version}.`,
  );
});

// ─── 2. Rechazo HTTP con código estable ──────────────────────────────────────
// MUTACIÓN QUE LO PONE EN ROJO: devolver `httpErrorFrom` al mensaje genérico
// ("Nexus backend responded 409…") o recortar el cuerpo antes de leer el código.
test("409 BYO_PROVIDER_REQUIRED: llega el código, la causa Y la acción", () => {
  const err = httpErrorFrom(409, "Conflict", "/api/v1/consulta", byoBody);

  assert.equal(err.code, "BYO_PROVIDER_REQUIRED", "el código estable tiene que viajar");
  assert.ok(err.message.startsWith("BYO_PROVIDER_REQUIRED:"), "el código va delante del mensaje");
  // ACCIÓN: es la ÚLTIMA frase del mensaje del backend, justo lo que se perdía al
  // recortar. Sin esto el lector sabe que falló y no sabe qué hacer.
  assert.match(err.message, /POST \/api\/v1\/llm-providers/);
  // CAUSA + que reintentar no sirve.
  assert.match(err.message, /not a transient failure/);
  // ATRIBUCIÓN: no puede leerse como avería nuestra.
  assert.doesNotMatch(err.message, /UPSTREAM_ERROR|backend responded/i);
});

test("cuerpo sin código estable → mensaje genérico, sin inventar un código", () => {
  const err = httpErrorFrom(502, "Bad Gateway", "/api/consulta", "<!doctype html><html>…");
  assert.equal(err.code, undefined);
  assert.match(err.message, /502/);
});

test("parseNexusError acepta el cuerpo plano de las rutas internas", () => {
  const flat = parseNexusError(JSON.stringify({ error: "sin motor", code: "BYO_PROVIDER_REQUIRED" }));
  assert.deepEqual(flat, { code: "BYO_PROVIDER_REQUIRED", message: "sin motor" });
  assert.equal(parseNexusError("no soy json"), null);
  assert.equal(parseNexusError(JSON.stringify({ error: { message: "sin código" } })), null);
});

// ─── 3. Rechazo llegado DENTRO del stream ────────────────────────────────────
// MUTACIÓN QUE LO PONE EN ROJO: volver a `throw new NexusHttpError(500, m)` en el
// case "error" de streamSse → status 500 y `code` undefined.
test("frame SSE {type:error,code}: NO se fabrica un 500 y el código sobrevive", async () => {
  const frames = [
    `data: ${JSON.stringify({ type: "error", code: "BYO_PROVIDER_REQUIRED", message: "Nothing ran. …" })}\n\n`,
  ];
  const cfg = {
    baseUrl: "https://example.test",
    apiKey: "nlk_test",
    timeoutMs: 5000,
    userAgent: "test",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(f));
        c.close();
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });

  try {
    await assert.rejects(
      () => streamSse(cfg, "/api/nodo-a-analyze", {}),
      (err) => {
        assert.equal(err.code, "BYO_PROVIDER_REQUIRED", "el code del frame no puede perderse");
        assert.notEqual(err.status, 500, "un rechazo de política NO es un 500 nuestro");
        assert.match(err.message, /^BYO_PROVIDER_REQUIRED: /);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
