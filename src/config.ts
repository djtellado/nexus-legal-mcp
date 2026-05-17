/**
 * Configuración runtime del servidor MCP.
 * Las variables se leen de `process.env` al arrancar.
 */

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
      "NEXUS_API_KEY no configurada. Genera una clave MCP en " +
      "https://nexusquantum.legal/developers y añádela al config del " +
      "cliente MCP (ej. claude_desktop_config.json → env.NEXUS_API_KEY).",
    );
  }
  if (!apiKey.startsWith("nlk_")) {
    throw new Error(
      `NEXUS_API_KEY con formato inválido (debe empezar por "nlk_"). ` +
      `Recibido prefix: "${apiKey.slice(0, 4)}..."`,
    );
  }

  const baseUrl   = (process.env.NEXUS_BASE_URL ?? "https://nexusquantum.legal").replace(/\/+$/, "");
  const timeoutMs = Number(process.env.NEXUS_TIMEOUT_MS ?? "180000");
  const userAgent = `nexus-legal-mcp/${process.env.npm_package_version ?? "0.1.0"} (Node ${process.version})`;

  return { baseUrl, apiKey, timeoutMs, userAgent };
}
