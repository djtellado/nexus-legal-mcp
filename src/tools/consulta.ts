import { z } from "zod";
import { renderSseText, streamSse, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  question:        z.string().min(5).describe("A specific legal question. It may be backed by a context document (`documentText`) or by a previous analysis (`analysisContext`)."),
  jurisdiction:    z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  documentText:    z.string().optional().describe("Text of the reference document (optional). If supplied, the model treats it as Layer A and quotes it verbatim."),
  analysisContext: z.string().optional().describe("Previous Node A analysis of the document (optional). If supplied, it is used as context for reasoning about the case."),
  language:        z.enum(["es","en","fr","de"]).optional(),
  history:         z.array(z.object({
                     role:    z.enum(["user","assistant"]),
                     content: z.string(),
                   })).optional().describe("Optional conversation history. Allows multiple turns about the same case."),
});

export const consultaTool: ToolDefinition = {
  name: "nexus_consulta",
  description:
    "OPEN LEGAL QUESTION (Node A — Q&A mode). A legal question in natural " +
    "language, with or without a reference document. Returns an answer with " +
    "certainty locks and statutory / case-law references where they apply. " +
    "Supports conversation threads through the `history` parameter. Cost: 1 " +
    "credit. USE WHEN: the user asks a specific legal question (what is the " +
    "limitation period? is this clause enforceable? what has the Supreme Court " +
    "said about X?) and does NOT need a full document analysis.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/consulta", args);
    // Anti-alucinación: resumen de verificación determinista de citas, si la ruta lo emite.
    return { content: renderSseText(r.text, r.citationChecks, resolveToolLang(args.language, args.jurisdiction)), logs: r.logs };
  },
};
