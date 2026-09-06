import { z } from "zod";
import { renderSseText, streamSse, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:             z.string().min(50).describe("Text of the original document."),
  analysis:         z.string().optional().describe("Previous Node A analysis of the same document. If supplied, the adversarial pass argues AGAINST each conclusion."),
  jurisdiction:     z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  legalBranch:      z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil"),
  professionalRole: z.enum(["lawyer","prosecutor","notary","registrar","judge","in-house","individual","abogado","fiscal","notario","registrador","juez","asesor","persona"]).describe("Professional standpoint the document is read from: it decides what counts as a finding. REQUIRED, no default - a role the client did not choose would still shape every analysis in that request. Either spelling works and both mean the same thing: lawyer/solicitor/barrister, prosecutor, notary, registrar, judge, in-house (legal counsel), individual (non-professional). The Spanish forms - abogado, fiscal, notario, registrador, juez, asesor, persona - are the original wire values and keep working unchanged."),
  language:         z.enum(["es","en","fr","de"]).optional(),
});

export const adversarialTool: ToolDefinition = {
  name: "nexus_adversarial",
  description:
    "ADVERSARIAL ARGUMENT (Node C — opposing-party mode). For each conclusion " +
    "of the Node A analysis, builds the strongest argument the other side would " +
    "run. Useful to prepare litigation or to anticipate objections in " +
    "negotiation. Different from `nexus_redteam`: adversarial DEBATES the " +
    "conclusions (prose), redteam DESTROYS clauses (structured JSON). USE WHEN: " +
    "the client needs to anticipate the other side. Cost: 2-3 credits.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-c-adversarial", args);
    // Anti-alucinación: resumen de verificación determinista de citas, si la ruta lo emite.
    return { content: renderSseText(r.text, r.citationChecks, resolveToolLang(args.language, args.jurisdiction)), logs: r.logs };
  },
};
