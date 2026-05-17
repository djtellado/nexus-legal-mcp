import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:          z.string().min(50).describe("Texto del documento (contrato, situación jurídica, hechos)."),
  jurisdictions: z.array(z.string()).min(2).max(15).describe("Códigos ISO de 2 a 15 jurisdicciones a comparar (ej. ['ES','CO','MX','AR'])."),
  legalBranch:   z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil"),
  language:      z.enum(["es","en"]).default("es"),
});

export const crossBorderTool: ToolDefinition = {
  name: "nexus_cross_border_compare",
  description:
    "COMPARATIVA MULTI-JURISDICCIONAL. Para los hechos/contrato aportados, " +
    "compara cómo lo trata el ordenamiento jurídico de cada jurisdicción " +
    "listada (2-15 países). Identifica: ley aplicable más favorable, foro " +
    "competente óptimo, riesgos fiscales por país (CDI), reconocimiento de " +
    "sentencias entre jurisdicciones, conflictos de leyes. Devuelve JSON " +
    "con tabla comparativa estructurada. USAR CUANDO: el cliente opera en " +
    "varios países y necesita decidir dónde litigar/contratar/establecerse. " +
    "Coste: 2-4 créditos según número de jurisdicciones.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const result = await postJson<Record<string, unknown>>(cfg, "/api/multi-jurisdiction-compare", args);
    return { content: JSON.stringify(result, null, 2) };
  },
};
