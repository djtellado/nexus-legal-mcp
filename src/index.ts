#!/usr/bin/env node
/**
 * @nexus-legal/mcp — entry point.
 *
 * Lanza el servidor MCP de Nexus Legal sobre stdio.
 * Lee NEXUS_API_KEY y NEXUS_BASE_URL del entorno.
 */
import { startServer } from "./server.js";

startServer().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  // Importante: stderr, no stdout (stdout es el canal MCP).
  process.stderr.write(`[nexus-legal-mcp] fatal: ${msg}\n`);
  process.exit(1);
});
