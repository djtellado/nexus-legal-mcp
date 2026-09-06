import { z } from "zod";
import { getJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

// Sin parámetros: la bandeja es un query puro del usuario de la key (firm-scope).
const inputSchema = z.object({});

interface InboxResult {
  [k: string]: unknown;
}

export const inboxTool: ToolDefinition = {
  name: "nexus_inbox",
  description:
    "FIRM-WIDE ATTENTION INBOX. Aggregates in one call everything that needs " +
    "attention across the firm: outputs pending review, evidence unverified or " +
    "flagged as possibly hallucinated, and time limits overdue or falling due " +
    "(next 7 days). Firm-scoped, read-only, consumes NO credits. USE WHEN: you " +
    "want an actionable summary of the firm's state to prioritise the day.",
  inputSchema,
  async handler(input, cfg) {
    inputSchema.parse(input);
    const result = await getJson<InboxResult>(cfg, "/api/inbox");
    return { content: JSON.stringify(result, null, 2) };
  },
};
