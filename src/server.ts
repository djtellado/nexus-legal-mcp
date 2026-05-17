/**
 * Servidor MCP de Nexus Legal.
 *
 * Registra las 11 tools en el SDK oficial @modelcontextprotocol/sdk y las
 * sirve sobre stdio. Cada tool valida su input con zod, llama al backend
 * Nexus (HTTPS + Bearer nlk_...) y devuelve el resultado al cliente MCP.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import { loadConfig } from "./config.js";
import { ALL_TOOLS } from "./tools/index.js";
import { NexusHttpError } from "./http-client.js";

export async function startServer(): Promise<void> {
  const cfg = loadConfig();

  const server = new Server(
    {
      name:    "nexus-legal",
      version: "0.1.0",
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
        content: [{ type: "text", text: `Tool desconocida: ${name}` }],
      };
    }

    try {
      const result = await tool.handler(args, cfg);
      const blocks: Array<{ type: "text"; text: string }> = [
        { type: "text", text: result.content },
      ];
      if (result.link) {
        blocks.push({ type: "text", text: `\n\n🔗 Expediente Nexus: ${result.link}` });
      }
      return { content: blocks };
    } catch (err: unknown) {
      const isHttp = err instanceof NexusHttpError;
      const msg = err instanceof Error ? err.message : String(err);
      const detail = isHttp && err.bodyExcerpt ? `\n\nDetalle del backend:\n${err.bodyExcerpt}` : "";
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Error invocando ${name}: ${msg}${detail}`,
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
