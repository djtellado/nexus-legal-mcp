import { z } from "zod";
import { streamSse } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:             z.string().min(50).describe("Texto del documento original."),
  analysis:         z.string().optional().describe("Análisis Nodo A previo sobre el mismo documento. Si se aporta, el adversarial argumenta CONTRA cada conclusión."),
  jurisdiction:     z.string().default("ES"),
  legalBranch:      z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil"),
  professionalRole: z.enum(["abogado","fiscal","notario","registrador","juez","asesor"]).default("abogado"),
  language:         z.enum(["es","en","fr","de"]).default("es"),
});

export const adversarialTool: ToolDefinition = {
  name: "nexus_adversarial",
  description:
    "ARGUMENTACIÓN ADVERSARIAL (Nodo C — modo contraparte). Para cada " +
    "conclusión del análisis Nodo A, construye el argumento más fuerte " +
    "que esgrimiría la contraparte. Útil para preparar litigio o " +
    "anticipar objeciones en negociación. Distinto de `nexus_redteam`: " +
    "adversarial DEBATE las conclusiones (texto en prosa), redteam " +
    "DESTRUYE cláusulas (JSON estructurado). USAR CUANDO: el cliente " +
    "necesita anticipar objeciones de la otra parte. Coste: 2-3 créditos.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-c-adversarial", args);
    return { content: r.text, logs: r.logs };
  },
};
