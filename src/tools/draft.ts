import { z } from "zod";
import { renderSseText, streamSse, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  instructions:       z.string().min(10).describe("Instruction to the drafter about what to write (e.g. 'Draft an appeal against the enforcement order …'). It can be a single turn, or a thread if you use `messages`."),
  jurisdiction:       z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  legalBranch:        z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil"),
  documentContext:    z.string().optional().describe("Text of the source document (e.g. the contract to be challenged, the order under appeal). Layer A."),
  language:           z.enum(["es","en","fr","de"]).optional(),
  professionalRole:   z.enum(["lawyer","prosecutor","notary","registrar","judge","in-house","individual","abogado","fiscal","notario","registrador","juez","asesor","persona"]).describe("Professional standpoint the document is read from: it decides what counts as a finding. REQUIRED, no default - a role the client did not choose would still shape every analysis in that request. Either spelling works and both mean the same thing: lawyer/solicitor/barrister, prosecutor, notary, registrar, judge, in-house (legal counsel), individual (non-professional). The Spanish forms - abogado, fiscal, notario, registrador, juez, asesor, persona - are the original wire values and keep working unchanged."),
  negotiationProfile: z.enum(["conservador","equilibrado","agresivo"]).default("equilibrado"),
  messages:           z.array(z.object({
                        role:    z.enum(["user","assistant","system"]),
                        content: z.string(),
                      })).optional().describe("Previous conversation thread. If omitted, one is built with `instructions` as the only user turn."),
});

export const draftTool: ToolDefinition = {
  name: "nexus_draft",
  description:
    "LEGAL DRAFTING (Node A — Drafter mode). Produces the first draft of a " +
    "document (appeal, claim, defence, contract clause, opinion) following the " +
    "format and mandatory locks of MODULE-DRAFT. If the date of service is " +
    "uncertain it degrades to [L3-NV] and asks for verification in the brief. " +
    "USE WHEN: the user asks for a specific document to be drafted, usually " +
    "after a Node A analysis or over a supplied document. Cost: 2-4 credits.",
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
    // Anti-alucinación: resumen de verificación determinista de citas, si la ruta lo emite.
    return { content: renderSseText(r.text, r.citationChecks, resolveToolLang(args.language, args.jurisdiction)), logs: r.logs };
  },
};
