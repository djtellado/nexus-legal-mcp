#!/usr/bin/env node
/**
 * mcp-server/scripts/preflight-publish.mjs
 *
 * PUERTA DE PUBLICACIÓN. Corre en `prepublishOnly`, antes de que nada salga a npm.
 *
 * 🔴 POR QUÉ EXISTE: dos publicaciones seguidas salieron mal y ninguna dio error.
 *
 *   0.6.0 (2026-08-18) — `npm version` no llegó a commitear porque el árbol estaba sucio.
 *                        npm quedó en 0.6.0 y el repo en 0.5.0: las dos sedes de la versión
 *                        diciendo cosas distintas del mismo paquete.
 *   0.6.1 (2026-08-19) — publicado desde un árbol que llevaba UNO de los tres arreglos. El
 *                        paquete instalable siguió afirmando «"verified" = the cited text
 *                        matches the official corpus» en la jurisdicción donde no se compara
 *                        ni una palabra. El fuente estaba bien; el ÁRBOL estaba atrasado.
 *
 * Las dos veces el fallo fue el mismo: se publica lo que hay delante, y nada comprueba que lo
 * que hay delante sea lo que uno cree. `npm test` compila, así que el `dist` era coherente con
 * SU fuente — solo que ese fuente no era el de `main`. Un build correcto sobre el árbol
 * equivocado da un paquete equivocado, y sale en verde.
 *
 * Esta puerta NO comprueba el contenido: no sabría qué buscar la próxima vez. Comprueba la
 * PROCEDENCIA, que es la invariante — se publica desde `origin/main`, limpio y al día.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
const fallos = [];

// 1. Árbol limpio. Sucio, `npm version` se salta el commit y las versiones divergen.
const sucio = sh("git status --porcelain").split("\n").filter((l) => l && !l.includes("node_modules"));
if (sucio.length) {
  fallos.push(`el árbol tiene ${sucio.length} cambio(s) sin commitear:\n      ` +
    sucio.slice(0, 5).map((l) => l.trim()).join("\n      ") +
    (sucio.length > 5 ? `\n      …y ${sucio.length - 5} más` : "") +
    "\n    Con el árbol sucio `npm version` NO commitea, y npm se queda por delante del repo.");
}

// 2. Al día con origin/main. Éste es el fallo del 0.6.1: fuente bueno, árbol atrasado.
try {
  execSync("git fetch origin --quiet", { stdio: "ignore" });
  const head = sh("git rev-parse HEAD");
  const main = sh("git rev-parse origin/main");
  const detras = Number(sh(`git rev-list --count ${head}..${main}`));
  /**
   * 🔴 SOLO SE MIRA «POR DETRÁS», NUNCA «POR DELANTE».
   *
   * La primera versión bloqueaba cualquier HEAD distinto de origin/main, y habría rechazado
   * TODAS las publicaciones legítimas: `npm version` crea su commit ANTES de que `npm publish`
   * dispare este script, así que en el momento de publicar HEAD va siempre uno por delante.
   * Una puerta que suspende el caso bueno se desactiva a la primera, y entonces deja de
   * proteger el malo. Lo que hace daño es ir ATRASADO: publicar sin arreglos que ya están.
   */
  if (detras > 0) {
    fallos.push(`el árbol va ${detras} commit(s) POR DETRÁS de origin/main.\n` +
      "    Publicar así sube un paquete al que le FALTAN arreglos que ya están en main, y npm\n" +
      "    no se queja: sube lo que le des. Fue exactamente el 0.6.1.");
  }
} catch {
  fallos.push("no se pudo comparar con origin/main (¿sin red?). No se publica a ciegas.");
}

/**
 * 3. La entrada del REGISTRO MCP dice la misma versión que el paquete.
 *
 * 🔴 Añadido el 2026-08-19, después de que el registro recibiera 0.3.0 con npm en 0.6.2. El
 * árbol de publicación se había creado ANTES del commit que corregía `server.json`, así que
 * era coherente consigo mismo y viejo respecto a main — el mismo fallo del 0.6.1, otra vez.
 *
 * Y el motivo de que la puerta no lo parase es que `mcp-publisher publish` NO pasa por
 * `prepublishOnly`: la puerta solo se disparaba con `npm publish`. Por eso el flujo del
 * registro tiene que invocarla a mano (`npm run preflight && mcp-publisher publish`), y por
 * eso ahora comprueba también esta sede: un solo comando cubre las dos publicaciones.
 */
try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const srv = JSON.parse(readFileSync("server.json", "utf8"));
  const delPaquete = (srv.packages ?? []).find((x) => x.identifier === pkg.name)?.version;
  if (srv.version !== pkg.version || delPaquete !== pkg.version) {
    fallos.push(`server.json no dice la versión del paquete (${pkg.version}):\n` +
      `      server.json.version    = ${srv.version}\n` +
      `      packages[].version     = ${delPaquete}\n` +
      "    El registro MCP es una sede APARTE de npm: se instala desde el directorio, y una\n" +
      "    entrada vieja sirve un paquete anterior a los arreglos aunque npm esté al día.");
  }
} catch (e) {
  fallos.push(`no se pudo leer package.json/server.json: ${e.message}`);
}

if (fallos.length) {
  console.error("\n✖ PUBLICACIÓN BLOQUEADA — solo se publica desde main, limpio y al día.\n");
  for (const f of fallos) console.error(`  · ${f}\n`);
  console.error("  Cómo hacerlo bien:");
  console.error("    git worktree add /tmp/pub -b release/mcp-X.Y.Z origin/main");
  console.error("    cd /tmp/pub/mcp-server && npm version patch && npm publish --access public");
  console.error("    cd /tmp/pub && git push origin HEAD:main --follow-tags");
  console.error("  Y para el REGISTRO MCP, que no pasa por prepublishOnly:");
  console.error("    cd /tmp/pub/mcp-server && npm run preflight && mcp-publisher publish\n");
  process.exit(1);
}
console.log("✔ preflight: árbol limpio y al día con origin/main");
