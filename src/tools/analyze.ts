import { z } from "zod";
import { streamSse } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:               z.string().min(20).describe("Texto íntegro del documento jurídico a analizar (contrato, demanda, sentencia, providencia administrativa, etc.). Mínimo 20 caracteres."),
  jurisdiction:       z.string().default("ES").describe("Código ISO de la jurisdicción primaria. Soporta US-CA/US-NY/... para state overlay y MULTI para análisis multi-país. Default: ES."),
  jurisdictionB:      z.string().optional().describe("Segunda jurisdicción para análisis cross-border / bilateral. Activa MODULE-BILATERAL + framework de tratados aplicables."),
  legalBranch:        z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil").describe("Rama jurídica predominante del documento."),
  mode:               z.enum(["standard","auditoria","agil"]).default("standard").describe("standard: análisis equilibrado · auditoria: máxima exhaustividad, crítica adversarial · agil: respuesta breve enfocada en lo crítico."),
  professionalRole:   z.enum(["abogado","fiscal","notario","registrador","juez","asesor","persona"]).default("abogado").describe("Rol profesional desde el que se mira el documento. Cambia la perspectiva del informe."),
  proceduralSide:     z.enum(["demandante","demandado"]).nullable().optional().describe("Posición procesal del cliente. demandante (acreedor/actor) o demandado (defensor/deudor)."),
  negotiationProfile: z.enum(["conservador","equilibrado","agresivo"]).default("equilibrado").describe("conservador: maximiza alertas y protección · equilibrado: balance · agresivo: filtra alertas no bloqueantes."),
  language:           z.enum(["es","en","fr","de"]).default("es").describe("Idioma del informe de salida."),
});

export const analyzeTool: ToolDefinition = {
  name: "nexus_analyze",
  description:
    "ANÁLISIS PRIMARIO JURÍDICO (Nodo A — ISO 31000). Examina un documento " +
    "íntegramente: extrae partes, riesgos, cláusulas, plazos, normas " +
    "aplicables y jurisprudencia relevante. Aplica la jurisdicción " +
    "(ES/CO/MX/etc.) y rama del derecho correspondiente. Devuelve informe " +
    "estructurado con candados de certeza [L1]/[L2-J]/[L3-NV]/[L4] y " +
    "señales bloqueantes [L5-C]/[L5-P]. Termina con bloque NEXUS-AUDIT-TRAIL " +
    "para auditoría posterior. Coste: ~1-3 créditos según tamaño + tier de modelo. " +
    "USAR CUANDO: el usuario aporta un documento jurídico y pide análisis de " +
    "riesgos, viabilidad, cláusulas críticas, o defensa en juicio.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-a-analyze", args);
    return { content: r.text, logs: r.logs };
  },
};
