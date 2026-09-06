/**
 * Tests de la COPIA-PARIDAD stdio de lib/sanitization/normativa-output-filter.ts
 * (mcp-server/src/normativa-filter.ts). Corre contra el build (node --test).
 *
 * Foco E2E r5.2 (b): artefactos tras la neutralización — pares de backticks
 * vacíos `` y espacios dobles residuales. Paridad con
 * tests/unit/normativa-output-filter.test.ts del repo principal.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { stripLlmNormativaBlocks } from "../dist/normativa-filter.js";

test("neutraliza el bloque fabricado conservando el texto interior", () => {
  const t =
    `Según el corpus:\n<NORMATIVA_VIGENTE jurisdiccion="CO" fecha_consulta="2026-07-07">` +
    `<ARTICULO boe_id="CGP-590" url="https://falso.example/590">Parágrafo 1: caución…</ARTICULO>` +
    `</NORMATIVA_VIGENTE>\nPor tanto…`;
  // Fixtura COLOMBIANA → informe en castellano. Antes el idioma iba implícito porque el
  // aviso era un literal fijo; desde 2026-08-10 se elige por idioma y se dice cuál.
  const r = stripLlmNormativaBlocks(t, "es");
  assert.equal(r.stripped, 1);
  assert.ok(!r.text.includes("<NORMATIVA_VIGENTE"));
  assert.ok(!r.text.includes("falso.example"));
  assert.ok(r.text.includes("Parágrafo 1: caución…"));
  assert.ok(r.text.includes("SIN RESPALDO OFICIAL"));
});

test("🔴 el aviso va en el idioma del informe, no siempre en castellano", () => {
  // Un despacho inglés recibía en castellano la frase que dice «lo que sigue puede ser
  // inventado». Un aviso que no se entiende no avisa, y este es EL aviso.
  const t = `Analysis. <NORMATIVA_VIGENTE jurisdiccion="GB"><ARTICULO boe_id="x">Section 4…</ARTICULO></NORMATIVA_VIGENTE> Therefore…`;
  const en = stripLlmNormativaBlocks(t, "en");
  assert.equal(en.stripped, 1);
  assert.ok(en.text.includes("LEGISLATIVE CONTENT WITHOUT OFFICIAL BACKING"));
  assert.ok(!en.text.includes("SIN RESPALDO OFICIAL"));
  assert.ok(en.text.includes("Section 4…"), "neutralizar no es borrar");
  // Sin idioma cae a la PRIMERA fila de la tabla, que no es el castellano.
  assert.ok(!stripLlmNormativaBlocks(t).text.includes("SIN RESPALDO OFICIAL"));
});

test("etiquetas envueltas en backticks inline → ni backticks huérfanos ni espacios dobles (E2E r5.2)", () => {
  const t =
    `Fuente: \`<NORMATIVA_VIGENTE jurisdiccion="CO" fecha="2026-07-08">\` texto conservado ` +
    `\`</NORMATIVA_VIGENTE>\` fin.`;
  const r = stripLlmNormativaBlocks(t);
  assert.equal(r.stripped, 1);
  assert.ok(!r.text.includes("<NORMATIVA_VIGENTE"));
  assert.ok(!r.text.includes("``"));
  assert.ok(!r.text.includes("`<"));
  assert.ok(!r.text.includes(">`"));
  assert.ok(r.text.includes("texto conservado"));
  assert.ok(!/[ \t]{2,}/.test(r.text));
});

test("par de backticks VACÍO aislado tras eliminar el tag (doble backtick) → eliminado", () => {
  const t = `Ver \`\`<ARTICULO boe_id="X"/>\`\` y <NORMATIVA_VIGENTE a="b">z</NORMATIVA_VIGENTE>.`;
  const r = stripLlmNormativaBlocks(t);
  assert.ok(!r.text.includes("``"));
  assert.ok(!r.text.includes("<ARTICULO"));
  assert.ok(r.text.includes("z"));
  assert.ok(!/[ \t]{2,}/.test(r.text));
});

test("span de doble backtick LEGÍTIMO con contenido → intacto (limpieza conservadora)", () => {
  const t = `Usa \`\`npm run build\`\` antes. <NORMATIVA_VIGENTE a="b">z</NORMATIVA_VIGENTE>`;
  const r = stripLlmNormativaBlocks(t);
  assert.ok(r.text.includes("``npm run build``"));
});

test("es idempotente y no toca salidas limpias", () => {
  const clean = "El art. 590 CGP regula las medidas cautelares.";
  assert.deepEqual(stripLlmNormativaBlocks(clean), { text: clean, stripped: 0 });
  const once = stripLlmNormativaBlocks(`a <NORMATIVA_VIGENTE x="y">b</NORMATIVA_VIGENTE> c`);
  const twice = stripLlmNormativaBlocks(once.text);
  assert.equal(twice.stripped, 0);
  assert.equal(twice.text, once.text);
});
