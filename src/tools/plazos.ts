import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

// Contrato real de POST /api/v1/plazos/calcular (ver route.ts):
// { jurisdiction, fecha_base, cantidad, tipo_computo, ccaa?, agosto_inhabil?, acto_en_oficina? }
//
// 🔴 `jurisdiction` es OBLIGATORIA y NO tiene default. Esta tool describía el cómputo
// español como si fuera el cómputo, y un agente que la leyera pedía un plazo sin decir el
// foro y recibía una fecha calculada con la LEC para un pleito inglés. La preclusión no se
// recupera: el cliente actúa sobre esa fecha y el plazo se pierde.
const inputSchema = z.object({
  jurisdiction: z.string().min(2).describe("Forum whose procedural rules govern the count. REQUIRED, no default: 'ES' (LEC) or 'GB-EAW' (CPR, England and Wales)"),
  fecha_base: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Base date in YYYY-MM-DD format from which the deadline is computed (e.g. notification date)"),
  cantidad: z.number().int().min(1).max(36500).describe("Number of days/months/years of the deadline, e.g. 20"),
  tipo_computo: z.enum(["habiles", "naturales", "meses", "anios"]).default("habiles").describe("Computation type: 'habiles' (business days), 'naturales' (calendar days), 'meses' (months), 'anios' (years). GB-EAW takes a day count only: under CPR r 2.8 that split does not exist and the answer comes back as 'clear_days'"),
  ccaa: z.string().regex(/^ES(-[A-Z]{2})?$/).optional().describe("ES only: Spanish autonomous community ISO 3166-2 code for regional holidays, e.g. 'ES-MD', 'ES-CT'. Omit for national holidays only"),
  agosto_inhabil: z.boolean().optional().describe("ES only: treat August as non-working (LEC default). Default: true. There is NO August vacation under the CPR"),
  acto_en_oficina: z.boolean().optional().describe("GB-EAW only: the act must be done AT THE COURT OFFICE, so CPR r 2.8(5) extends the deadline if it ends on a day the office is closed. Default false"),
});

export const plazosCalcularTool: ToolDefinition = {
  name: "plazos_calcular",
  description:
    "Calculate a procedural time limit under the law of a SPECIFIC forum. `jurisdiction` is " +
    "required and has NO default: a time limit computed under another jurisdiction's rules " +
    "produces a date the client may act on, and a missed limitation period cannot be undone. " +
    "Supported: ES (LEC + LOPJ, CGPJ and regional holidays, August as a non-working month) and " +
    "GB-EAW (CPR r 2.8, clear days, England and Wales bank holidays, and NO August vacation). " +
    "Scotland and Northern Ireland are refused rather than approximated: their rules and their " +
    "bank holidays differ. Returns the due date, the rule applied and every adjustment made. " +
    "USE WHEN: the user needs to compute a procedural time limit (appeal, cassation, " +
    "defence, filing a defence, appellant's notice…) from a base date.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);

    const result = await postJson<Record<string, unknown>>(cfg, "/api/v1/plazos/calcular", {
      jurisdiction:    args.jurisdiction.trim().toUpperCase(),
      fecha_base:      args.fecha_base,
      cantidad:        args.cantidad,
      tipo_computo:    args.tipo_computo,
      ccaa:            args.ccaa ?? null,
      agosto_inhabil:  args.agosto_inhabil ?? true,
      acto_en_oficina: args.acto_en_oficina === true,
    });

    const lines: string[] = [
      `## Time-limit calculation`,
      ``,
      // 🔴 El foro y la regla VIAJAN con la fecha: un vencimiento sin decir bajo qué norma
      // se contó es el campo cuyo nombre promete más de lo que el dato sostiene.
      `**Foro:** ${result.jurisdiction ?? args.jurisdiction}`,
      `**Base date:** ${result.fecha_base ?? args.fecha_base}`,
      `**Count:** ${result.cantidad ?? args.cantidad} ${result.tipo_computo ?? args.tipo_computo}`,
      `**Due date:** ${result.fecha_vencimiento ?? "N/A"}`,
      `**Regla aplicable:** ${result.regla_aplicable ?? "N/A"}`,
    ];
    if (result.ccaa) lines.push(`**CCAA (festivos):** ${result.ccaa}`);

    const ajustes = (result.ajustes_aplicados ?? result.ajustes) as string[] | undefined;
    if (ajustes && ajustes.length > 0) {
      lines.push(``, `**Ajustes aplicados:**`);
      for (const aj of ajustes) {
        lines.push(`- ${aj}`);
      }
    }

    if (result.advertencia) {
      lines.push(``, `⚠️ **Advertencia:** ${result.advertencia}`);
    }

    return { content: lines.join("\n") };
  },
};
