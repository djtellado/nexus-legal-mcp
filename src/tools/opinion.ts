import { z } from "zod";
import { renderSseText, streamSse, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  question:        z.string().min(5).describe("The question a second legal opinion is wanted on."),
  nodaAResponse:   z.string().min(50).describe("The Node A answer to the question."),
  analysisContext: z.string().optional().describe("Additional context from the case file (optional)."),
  jurisdiction:    z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  language:        z.enum(["es","en","fr","de"]).optional(),
});

export const opinionTool: ToolDefinition = {
  name: "nexus_opinion",
  description:
    "SECOND LEGAL OPINION (Opinion node — adversarial control run on a different " +
    "LLM from Node A). Takes a Node A answer and re-examines it with " +
    "a different model, looking for: omissions, bias, misapplication of the law, " +
    "or case law ignored. Useful for high-value case files. USE WHEN: the client " +
    "requires a second validation of a legal position before acting. Cost: 2 credits.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/consulta-opinion", args);
    // Anti-alucinación: resumen de verificación determinista de citas, si la ruta lo emite.
    return { content: renderSseText(r.text, r.citationChecks, resolveToolLang(args.language, args.jurisdiction)), logs: r.logs };
  },
};
