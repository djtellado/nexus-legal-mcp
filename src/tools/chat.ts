import { z } from "zod";
import { postJson, renderSseText, type CitationChecks, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  messages: z.array(z.object({
    role:    z.enum(["user", "assistant"]),
    content: z.string(),
  })).min(1).describe("Conversation history; must contain at least one user turn. Multi-turn over the same document or case file."),
  context: z.string().min(1).describe(
    "Document and/or previous analysis (Node A/B) to answer over. BYOD: it is procesa en RAM, no se persiste (Zero Retention).",
  ),
  analysisContext: z.string().optional().describe("Separate previous analysis (optional). If omitted, `context` covers both document and analysis."),
  language: z.enum(["es", "en", "fr"]).optional(),
});

interface ChatResult {
  reply?: string;
  citationChecks?: CitationChecks;
  [k: string]: unknown;
}

export const chatTool: ToolDefinition = {
  name: "nexus_chat",
  description:
    "CASE-FILE RAG CHAT (interactive auditor). Multi-turn conversational Q&A over " +
    "a document and its Node A/B analysis supplied in `context` (BYOD, no " +
    "persisted case file). Returns the answer with deterministic citation " +
    "verification annotated. USE WHEN: you want to interrogate a contract that " +
    "has already been analysed ('which clause caps my liability?', 'what happens " +
    "if I miss the deadline?'). Cost: 1 credit.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    // La ruta interna acepta documentContext + analysisContext; el `context`
    // unificado del tool se inyecta como documentContext.
    const body = {
      messages: args.messages,
      documentContext: args.context,
      analysisContext: args.analysisContext ?? "",
      language: args.language,
    };
    const result = await postJson<ChatResult>(cfg, "/api/nodo-chat", body);
    // Anti-alucinación: anota veredictos INLINE + resumen de citas sobre la
    // respuesta, igual que las tools SSE (paridad de output).
    return { content: renderSseText(result.reply ?? "", result.citationChecks, resolveToolLang(args.language)) };
  },
};
