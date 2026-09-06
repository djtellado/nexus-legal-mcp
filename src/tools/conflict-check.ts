import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  parties: z.array(z.string().min(1)).min(1).max(50).describe(
    "Names of the parties to check (1-50) against tos expedientes ya existentes del despacho.",
  ),
  excludeCaseId: z.string().optional().describe("Case file ID to exclude from the check (e.g. when editing an existing one)."),
});

interface ConflictResult {
  clean?: boolean;
  conflicts?: unknown[];
  [k: string]: unknown;
}

export const conflictCheckTool: ToolDefinition = {
  name: "nexus_conflict_check",
  description:
    "CONFLICT CHECK (conflicts of interest). Deterministic check BEFORE opening a " +
    "case file: compares the parties given against the parties of the firm's " +
    "existing case files (pattern matching + trigram similarity + shared tokens). " +
    "Returns `{ clean, conflicts[] }`. Consumes NO credits. USE WHEN: you are " +
    "about to open a case and need " +
    "descartar un conflicto de intereses antes de aceptarlo.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);
    const parties = args.parties.map((p) => p.trim()).filter((p) => p.length > 0);
    const body = { parties, ...(args.excludeCaseId ? { excludeCaseId: args.excludeCaseId } : {}) };
    const result = await postJson<ConflictResult>(cfg, "/api/conflict-check", body);
    return { content: JSON.stringify(result, null, 2) };
  },
};
