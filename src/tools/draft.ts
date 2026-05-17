import { z } from "zod";
import { streamSse } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  instructions:       z.string().min(10).describe("Instrucción al redactor sobre qué escrito generar (ej. 'Redacta recurso de reposición contra providencia de apremio AEAT clave A28...'). Puede ser un solo turno o un hilo si usas `messages`."),
  jurisdiction:       z.string().default("ES").describe("Jurisdicción aplicable al escrito."),
  legalBranch:        z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil"),
  documentContext:    z.string().optional().describe("Texto del documento de partida (ej. el contrato que se va a impugnar, la providencia recurrida). Capa A."),
  language:           z.enum(["es","en","fr","de"]).default("es"),
  professionalRole:   z.enum(["abogado","fiscal","notario","registrador","juez","asesor"]).default("abogado"),
  negotiationProfile: z.enum(["conservador","equilibrado","agresivo"]).default("equilibrado"),
  messages:           z.array(z.object({
                        role:    z.enum(["user","assistant","system"]),
                        content: z.string(),
                      })).optional().describe("Hilo conversacional previo. Si no se aporta, se construye con `instructions` como único turno user."),
});

export const draftTool: ToolDefinition = {
  name: "nexus_draft",
  description:
    "REDACCIÓN DE ESCRITO JURÍDICO (Nodo A — Modo Redactor). Genera el " +
    "primer borrador de un escrito (recurso, demanda, contestación, " +
    "cláusula contractual, dictamen) siguiendo el formato y candados " +
    "obligatorios de MODULE-DRAFT. Si la fecha de notificación es incierta, " +
    "se degrada a [L3-NV] y se pide verificación en el brief. USAR CUANDO: el " +
    "usuario pide redactar un escrito concreto, normalmente tras un análisis " +
    "Nodo A previo o sobre un documento aportado. Coste: 2-4 créditos.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const messages = args.messages ?? [{ role: "user" as const, content: args.instructions }];
    const r = await streamSse(cfg, "/api/draft-assistant", {
      messages,
      jurisdiction:       args.jurisdiction,
      legalBranch:        args.legalBranch,
      language:           args.language,
      documentContext:    args.documentContext ?? "",
      professionalRole:   args.professionalRole,
      negotiationProfile: args.negotiationProfile,
    });
    return { content: r.text, logs: r.logs };
  },
};
