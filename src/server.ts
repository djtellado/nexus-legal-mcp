/**
 * Servidor MCP de Nexus Legal.
 *
 * Registra las tools de `ALL_TOOLS` en el SDK oficial @modelcontextprotocol/sdk
 * y las sirve sobre stdio. Cada tool valida su input con zod, llama al backend
 * Nexus (HTTPS + Bearer nlk_...) y devuelve el resultado al cliente MCP.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import { loadConfig, PACKAGE_VERSION } from "./config.js";
import { ALL_TOOLS } from "./tools/index.js";
import { NexusHttpError } from "./http-client.js";

export async function startServer(): Promise<void> {
  const cfg = loadConfig();

  const server = new Server(
    {
      // La versión que el cliente MCP muestra en su panel de conectores. Estaba
      // clavada a "0.1.0" desde el primer commit: el paquete 0.3.0 se presentaba
      // como 0.1.0 a quien lo instalaba.
      name:    "nexus-legal",
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ─── tools/list ───────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((t) => ({
        name:        t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.inputSchema, { $refStrategy: "none" }) as Record<string, unknown>,
      })),
    };
  });

  // ─── tools/call ───────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    const tool = ALL_TOOLS.find((t) => t.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }

    try {
      const result = await tool.handler(args, cfg);
      const blocks: Array<{ type: "text"; text: string }> = [
        { type: "text", text: result.content },
      ];
      if (result.link) {
        blocks.push({ type: "text", text: `\n\n🔗 Nexus case file: ${result.link}` });
      }
      return { content: blocks };
    } catch (err: unknown) {
      const isHttp = err instanceof NexusHttpError;
      const msg = err instanceof Error ? err.message : String(err);
      // Cuando el backend manda un código estable, ESE es el mensaje: ya viene con
      // su causa y su acción escritas para un integrador (`httpErrorFrom` lo
      // antepone al texto). El volcado crudo del cuerpo solo se añade cuando NO hay
      // código — ahí es lo único que hay. Antes salía siempre, así que el aviso
      // legible quedaba sepultado bajo un JSON a medio cortar.
      const detail = isHttp && !err.code && err.bodyExcerpt ? `\n\nBackend response:\n${err.bodyExcerpt}` : "";
      // En inglés: al otro lado hay un desarrollador que integra, y el idioma del
      // andamiaje del error no lo decide la jurisdicción del documento.
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Error running ${name}: ${msg}${detail}`,
        }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // El proceso se mantiene vivo gracias al transport. Cerramos limpiamente
  // con SIGINT/SIGTERM.
  const close = () => {
    server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
