import { z } from "zod";
import { renderSseText, streamSse, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:               z.string().min(20).describe("Full text of the legal document to analyse (contract, claim form, judgment, administrative order, etc.). Minimum 20 characters."),
  jurisdiction:       z.string().min(2).describe("ISO code of the primary jurisdiction (REQUIRED, no default). Supports US-CA/US-NY/... for a state overlay and MULTI for multi-country analysis."),
  jurisdictionB:      z.string().optional().describe("Second jurisdiction for cross-border / bilateral analysis. Activates MODULE-BILATERAL and the applicable treaty framework."),
  legalBranch:        z.enum(["civil","mercantil","laboral","penal","fiscal","administrativo","constitucional","procesal","all"]).default("civil").describe("Predominant branch of law of the document. Values are wire values and stay in Spanish."),
  mode:               z.enum(["standard","auditoria","agil"]).default("standard").describe("standard: balanced analysis · auditoria: maximum thoroughness, adversarial critique · agil: short answer focused on what is critical. Values are wire values and stay in Spanish."),
  professionalRole:   z.enum(["lawyer","prosecutor","notary","registrar","judge","in-house","individual","abogado","fiscal","notario","registrador","juez","asesor","persona"]).describe("Professional standpoint the document is read from: it decides what counts as a finding. REQUIRED, no default - a role the client did not choose would still shape every analysis in that request. Either spelling works and both mean the same thing: lawyer/solicitor/barrister, prosecutor, notary, registrar, judge, in-house (legal counsel), individual (non-professional). The Spanish forms - abogado, fiscal, notario, registrador, juez, asesor, persona - are the original wire values and keep working unchanged."),
  roleVariant:        z.string().max(40).optional().describe("Local seat where a jurisdiction splits one function into several (England and Wales: solicitor / barrister). Additive: it does not replace the role. A variant that does not exist there falls back to the most common seat."),
  proceduralSide:     z.enum(["claimant","defendant","pursuer","defender","plaintiff","demandante","demandado"]).nullable().optional().describe("Procedural position of the client. Give it in the terms of your own forum - claimant (England and Wales, CPR r 2.3), pursuer (Scotland), plaintiff (Northern Ireland, which did not adopt the CPR), defendant, defender - or in the original wire values demandante/demandado. They all resolve to the same two positions."),
  negotiationProfile: z.enum(["conservador","equilibrado","agresivo"]).default("equilibrado").describe("conservador: maximises alerts and protection · equilibrado: balanced · agresivo: filters out non-blocking alerts. Values are wire values and stay in Spanish."),
  referenceDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date of the FACTS of the case (lex temporis, YYYY-MM-DD). Citation verification checks force at THIS date, not today. Omit for today."),
  language:           z.enum(["es","en","fr","de"]).optional().describe("Language of the output report. If omitted, the backend resolves it from the jurisdiction."),
});

export const analyzeTool: ToolDefinition = {
  name: "nexus_analyze",
  description:
    "PRIMARY LEGAL ANALYSIS (Node A — ISO 31000). Reads a document in full: " +
    "extracts parties, risks, clauses, time limits, applicable law and relevant " +
    "case law. Applies the jurisdiction (ES/CO/GB/etc.) and the corresponding " +
    "branch of law. Returns a structured report with certainty locks " +
    "[L1]/[L2-J]/[L3-NV]/[L4] and blocking signals [L5-C]/[L5-P]. Ends with a " +
    "NEXUS-AUDIT-TRAIL block for later audit. Cost: ~1-3 credits depending on " +
    "size and model tier. USE WHEN: the user supplies a legal document and asks " +
    "for analysis of risk, viability, critical clauses, or a defence at trial.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-a-analyze", args);
    // Anti-alucinación: si el backend verificó las citas contra el corpus oficial,
    // añadimos un resumen legible al final para que el agente/usuario vea el veredicto.
    return { content: renderSseText(r.text, r.citationChecks, resolveToolLang(args.language, args.jurisdiction)), logs: r.logs };
  },
};
