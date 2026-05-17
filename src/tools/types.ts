import { z } from "zod";
import type { Config } from "../config.js";

/** Resultado canónico de cada tool (lo que devolvemos al cliente MCP). */
export interface ToolResult {
  /** Texto principal — el output Nexus íntegro (con NEXUS-AUDIT-TRAIL). */
  content: string;
  /** Link al expediente o output en nexusquantum.legal, si aplica. */
  link?:   string | null;
  /** Eventos `log` SSE — útil para debugging del cliente. */
  logs?:   string[];
}

export interface ToolDefinition {
  /** Identificador MCP (snake_case). */
  name:        string;
  /** Descripción visible al usuario de Claude. */
  description: string;
  /** Schema zod del input. */
  inputSchema: z.ZodTypeAny;
  /** Handler que recibe el input validado y devuelve el resultado. */
  handler:     (input: unknown, cfg: Config) => Promise<ToolResult>;
}

/** Códigos ISO de jurisdicción soportados (subset principal). */
export const JURISDICTION_CODES = [
  "ES", "CO", "MX", "AR", "CL", "PE", "UY", "EC", "BO", "PY", "VE", "PA",
  "GB", "FR", "DE", "IT", "PT", "NL", "CH", "IE", "AE", "CA", "AU",
  "SG", "JP", "IN", "HK", "ZA", "SA", "BR", "US",
  "US-CA", "US-NY", "US-DE", "US-TX",
  "MULTI",
] as const;
export type JurisdictionCode = (typeof JURISDICTION_CODES)[number] | string;

export const LANGUAGES = ["es", "en", "fr", "de"] as const;
