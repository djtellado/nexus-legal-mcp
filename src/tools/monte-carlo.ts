import { z } from "zod";
import { streamSse } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:            z.string().min(50).describe("Texto del documento original (contrato) sobre el que se hace la simulación."),
  analysis:        z.string().optional().describe("Análisis Nodo A previo (opcional). Si se aporta, la simulación se ancla al perfil de riesgo ya calculado."),
  stressVariables: z.string().min(10).describe("Variables de estrés a simular, en lenguaje natural. Ej: 'Subida de tipos de interés +200bp; demanda judicial colateral; cambio normativo fiscal post-2026'. Una variable por línea o separadas por puntos."),
  jurisdiction:    z.string().default("ES"),
  language:        z.enum(["es","en","fr","de"]).default("es"),
});

export const monteCarloTool: ToolDefinition = {
  name: "nexus_monte_carlo",
  description:
    "SIMULACIÓN MONTE CARLO DE ESCENARIOS (Nodo Monte Carlo — ISO 31000 §6). " +
    "Estresa el perfil de riesgo de un contrato bajo variables definidas por " +
    "el usuario. Por cada variable, simula tres intensidades (Moderada P25 / " +
    "Base P50 / Severa P75), recalifica los riesgos del análisis Nodo A y " +
    "calcula un Índice de Resiliencia Contractual (IRC 0-100). Devuelve tablas " +
    "de impacto + recomendaciones de blindaje. USAR CUANDO: el cliente quiere " +
    "saber cómo aguanta el contrato shocks externos (M&A, due diligence, " +
    "ratings). Coste: 4 créditos.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-monte-carlo", args);
    return { content: r.text, logs: r.logs };
  },
};
