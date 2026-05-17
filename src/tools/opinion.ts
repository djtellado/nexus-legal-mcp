import { z } from "zod";
import { streamSse } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  question:        z.string().min(5).describe("Pregunta sobre la que se quiere segunda opinión jurídica."),
  nodaAResponse:   z.string().min(50).describe("Respuesta del Nodo A (Qwen/DeepSeek) sobre la pregunta."),
  analysisContext: z.string().optional().describe("Contexto adicional del expediente (opcional)."),
  jurisdiction:    z.string().default("ES"),
  language:        z.enum(["es","en","fr","de"]).default("es"),
});

export const opinionTool: ToolDefinition = {
  name: "nexus_opinion",
  description:
    "SEGUNDA OPINIÓN JURÍDICA (Nodo Opinion — control adversarial con LLM " +
    "distinto al Nodo A). Toma una respuesta del Nodo A y la reexamina con " +
    "un modelo diferente, buscando: omisiones, sesgos, errores de aplicación " +
    "normativa, o jurisprudencia ignorada. Útil para casos de alto valor. " +
    "USAR CUANDO: el cliente exige doble validación sobre una posición " +
    "jurídica antes de actuar. Coste: 2 créditos.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/consulta-opinion", args);
    return { content: r.text, logs: r.logs };
  },
};
