import { z } from "zod";
import { streamSse } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  analysis:             z.string().min(50).describe("Análisis Nodo A íntegro a auditar (texto completo del informe Nodo A, incluyendo NEXUS-AUDIT-TRAIL si lo lleva)."),
  text:                 z.string().describe("Documento original del análisis (Capa A). Necesario para que el auditor pueda contrastar afirmaciones contra el corpus."),
  jurisdiction:         z.string().default("ES"),
  jurisdictionB:        z.string().optional(),
  language:             z.enum(["es","en","fr","de"]).default("es"),
  articleContext:       z.string().optional().describe("Contexto de artículos relevantes inyectados por el operador (opcional)."),
  jurisprudenciaContext:z.string().optional().describe("Contexto de jurisprudencia relevante (opcional)."),
});

export const auditTool: ToolDefinition = {
  name: "nexus_audit",
  description:
    "AUDITORÍA CRUZADA DEL ANÁLISIS NODO A (Nodo B — control adversarial). " +
    "Verifica el análisis previo contra el documento original: detecta " +
    "afirmaciones no soportadas, candados mal asignados, omisiones, " +
    "contradicciones internas, y genera el bloque de verificaciones V-XX. " +
    "Devuelve confidence score 0-100. USAR CUANDO: el usuario quiere una " +
    "segunda capa de validación antes de presentar el análisis a un cliente " +
    "o tribunal. Requiere haber ejecutado `nexus_analyze` primero. Coste: 1-2 créditos.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-b-audit", args);
    return { content: r.text, logs: r.logs };
  },
};
