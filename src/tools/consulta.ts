import { z } from "zod";
import { streamSse } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  question:        z.string().min(5).describe("Pregunta jurídica concreta del operador. Puede ir respaldada por un documento de contexto (`documentText`) o por un análisis previo (`analysisContext`)."),
  jurisdiction:    z.string().default("ES").describe("Código ISO de la jurisdicción que rige la consulta. Soporta US-CA/US-NY etc. y MULTI."),
  documentText:    z.string().optional().describe("Texto del documento de referencia (opcional). Si se aporta, el modelo lo trata como Capa A y cita literalmente."),
  analysisContext: z.string().optional().describe("Análisis Nodo A previo sobre el documento (opcional). Si se aporta, sirve como contexto para razonar sobre el caso."),
  language:        z.enum(["es","en","fr","de"]).default("es"),
  history:         z.array(z.object({
                     role:    z.enum(["user","assistant"]),
                     content: z.string(),
                   })).optional().describe("Historial conversacional opcional. Permite múltiples turnos sobre el mismo caso."),
});

export const consultaTool: ToolDefinition = {
  name: "nexus_consulta",
  description:
    "CONSULTA JURÍDICA LIBRE (Nodo A — modo Q&A). Pregunta jurídica en " +
    "lenguaje natural, con o sin documento de referencia. Devuelve " +
    "respuesta con candados de certeza y referencias normativas/" +
    "jurisprudenciales cuando aplican. Soporta hilos conversacionales " +
    "mediante el parámetro `history`. Coste: 1 crédito. USAR CUANDO: el " +
    "usuario hace una pregunta jurídica concreta (¿cuál es el plazo de " +
    "prescripción?, ¿es válida esta cláusula?, ¿qué dice el TS sobre X?) " +
    "y NO necesita análisis íntegro de un documento.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/consulta", args);
    return { content: r.text, logs: r.logs };
  },
};
