import { z } from "zod";
import { postJson } from "../http-client.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  file_id: z
    .string()
    .describe("Box file id (the numeric id from Box, e.g. '1234567890')."),
  jurisdiction: z
    .string()
    .min(2)
    .describe("ISO code of the jurisdiction (e.g. ES, CO, SG, GB). REQUIRED: no jurisdiction is assumed by default."),
  legal_branch: z
    .string()
    .optional()
    .describe("Legal branch, e.g. 'civil', 'penal', 'mercantil'. Default: civil."),
  language: z
    .enum(["es", "en", "fr", "de"])
    .optional()
    .describe("Output language. Default: es."),
  mode: z
    .enum(["standard", "agil", "auditoria"])
    .optional()
    .describe("Analysis mode. 'auditoria' runs the adversarial Node B (2 credits)."),
  write_metadata: z
    .boolean()
    .optional()
    .describe(
      "Write the analysis back to the Box file as metadata " +
      "(jurisdiction, branch, model, top risk, summary, date). Default: true.",
    ),
});

interface BoxAnalyzeResponse {
  analysis?: string;
  jurisdiction?: string;
  legalBranch?: string;
  model?: string;
  processingMs?: number;
  metadata_written?: boolean;
  source?: {
    provider?: string;
    file_id?: string;
    file_name?: string;
    file_size?: number;
    modified_at?: string | null;
    text_chars?: number;
    ocr_confidence?: number | null;
    pages?: number | null;
  };
  requestId?: string;
}

export const boxAnalyzeTool: ToolDefinition = {
  name: "box_analyze",
  description:
    "Analyze a legal document that lives in the user's Box account WITHOUT " +
    "downloading it: pass the Box file_id and Nexus retrieves the user's Box " +
    "token (OAuth), downloads the binary, extracts text (Gemini OCR for " +
    "PDF/DOCX), runs the legal analysis (Node A) and — by default — writes the " +
    "result back to the Box file as metadata. Requires the user behind the API " +
    "key to have an active Box connection. Charges 1 credit only on success " +
    "(2 for 'auditoria' mode). Max file size 50 MB. USE WHEN: the user wants to " +
    "analyse a file they already hold in Box and refers to it by file_id.",
  inputSchema,
  async handler(input, cfg) {
    const args = inputSchema.parse(input);

    const body: Record<string, unknown> = {
      file_id: args.file_id,
      jurisdiction: args.jurisdiction,
    };
    if (args.legal_branch !== undefined) body.legal_branch = args.legal_branch;
    if (args.language !== undefined) body.language = args.language;
    if (args.mode !== undefined) body.mode = args.mode;
    if (args.write_metadata !== undefined) body.write_metadata = args.write_metadata;

    const result = await postJson<BoxAnalyzeResponse>(
      cfg,
      "/api/v1/dms/box/analyze",
      body,
    );

    const src = result.source ?? {};
    const header: string[] = [
      `## Box file analysis: ${src.file_name ?? args.file_id}`,
      ``,
      `**Jurisdiction:** ${result.jurisdiction ?? args.jurisdiction}` +
        `  ·  **Rama:** ${result.legalBranch ?? args.legal_branch ?? "civil"}` +
        `  ·  **Modelo:** ${result.model ?? "N/A"}`,
      `**File:** ${src.file_name ?? "N/A"}` +
        (typeof src.file_size === "number" ? ` (${(src.file_size / 1024).toFixed(0)} KB)` : "") +
        (typeof src.text_chars === "number" ? ` · ${src.text_chars} chars extracted` : ""),
      `**Metadata escrita en Box:** ${result.metadata_written ? "✅ sí" : "no"}`,
      ``,
      `---`,
      ``,
    ];

    const analysis = result.analysis ?? "(no analysis content)";

    return {
      content: header.join("\n") + analysis,
      logs: result.requestId ? [`requestId: ${result.requestId}`] : undefined,
    };
  },
};
