/**
 * Configuración runtime del servidor MCP.
 * Las variables se leen de `process.env` al arrancar.
 */

import { readFileSync } from "node:fs";

/**
 * Versión REAL del paquete, leída del package.json que npm publica junto a
 * `dist/`.
 *
 * Antes salía de `process.env.npm_package_version ?? "0.1.0"`. Esa variable solo
 * existe cuando el proceso arranca desde un script de npm; el arranque real —
 * `npx -y @nexus-legal/mcp` desde Claude Desktop / Cursor — no la define. O sea:
 * el paquete 0.3.0 se identificaba ante el backend, y ante el cliente MCP, como
 * `0.1.0`. Cuando un despacho reporta un problema, la primera pregunta es qué
 * versión corre, y la respuesta era falsa para todo el mundo.
 */
export const PACKAGE_VERSION: string = (() => {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch { /* fuera del layout publicado */ }
  // Sin package.json legible NO se inventa un número: un "0.1.0" plausible es peor
  // que un "unknown" honesto, porque se lee como un dato.
  return "unknown";
})();

export interface Config {
  /** URL base del backend Nexus. Default: producción. */
  baseUrl: string;
  /** API key del usuario (`nlk_...`). Obligatoria. */
  apiKey: string;
  /** Timeout de las llamadas SSE (ms). Default 180s para análisis largos. */
  timeoutMs: number;
  /** User-Agent enviado al backend para identificar al cliente MCP. */
  userAgent: string;
}

export function loadConfig(): Config {
  const apiKey = process.env.NEXUS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "NEXUS_API_KEY is not set. Generate an MCP key at " +
      "https://legal.nexusquantum.legal/developers y añádela al config del " +
      "cliente MCP (ej. claude_desktop_config.json → env.NEXUS_API_KEY).",
    );
  }
  if (!apiKey.startsWith("nlk_")) {
    throw new Error(
      `NEXUS_API_KEY has an invalid format (it must start with "nlk_"). ` +
      `Recibido prefix: "${apiKey.slice(0, 4)}..."`,
    );
  }

  // La API vive en legal.nexusquantum.legal — el apex (nexusquantum.legal) es
  // el site de marketing (Vercel) y devuelve 404 para /api/v1/*.
  const baseUrl   = (process.env.NEXUS_BASE_URL ?? "https://legal.nexusquantum.legal").replace(/\/+$/, "");
  // Validar: un valor no numérico (o <= 0) produciría NaN y abortaría TODAS
  // las peticiones al instante. Caer al default en ese caso.
  const parsedTimeout = Number(process.env.NEXUS_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 180000;
  const userAgent = `nexus-legal-mcp/${PACKAGE_VERSION} (Node ${process.version})`;

  return { baseUrl, apiKey, timeoutMs, userAgent };
}
