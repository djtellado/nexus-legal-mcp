import { z } from "zod";
import { renderSseText, streamSse, resolveToolLang } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text:            z.string().min(50).describe("Text of the original document (contract) the simulation runs over."),
  analysis:        z.string().optional().describe("Previous Node A analysis (optional). If supplied, the simulation is anchored to the risk profile already computed."),
  stressVariables: z.string().min(10).describe("Stress variables to simulate, in natural language. E.g. 'interest rates up 200bp; collateral litigation; post-2026 tax reform'. One variable per line, or separated by full stops."),
  jurisdiction:    z.string().min(2).describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  language:        z.enum(["es","en","fr","de"]).optional(),
});

export const monteCarloTool: ToolDefinition = {
  name: "nexus_monte_carlo",
  description:
    "MONTE CARLO SCENARIO SIMULATION (Monte Carlo node — ISO 31000 §6). " +
    "Stresses a contract's risk profile under user-defined variables. For each " +
    "variable it simulates three intensities (Moderate P25 / Base P50 / Severe " +
    "P75), re-grades the risks from the Node A analysis and computes a " +
    "Contractual Resilience Index (CRI 0-100). Returns impact tables and " +
    "hardening recommendations. USE WHEN: the client wants to know how the " +
    "contract holds up under external shocks (M&A, due diligence, ratings). " +
    "Cost: 4 credits.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const r = await streamSse(cfg, "/api/nodo-monte-carlo", args);
    // Anti-alucinación: resumen de verificación determinista de citas, si la ruta lo emite.
    return { content: renderSseText(r.text, r.citationChecks, resolveToolLang(args.language, args.jurisdiction)), logs: r.logs };
  },
};
