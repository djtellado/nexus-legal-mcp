/**
 * Cliente HTTP para hablar con el backend Nexus.
 * Dos modos:
 *   · streamSse(path, body) — consume Server-Sent Events y devuelve el
 *     texto agregado + outputId opcional cuando recibimos `done`.
 *   · postJson(path, body) — POST normal, devuelve el JSON parseado.
 *
 * Ambos modos añaden `Authorization: Bearer nlk_...` automáticamente.
 */

import type { Config } from "./config.js";

export class NexusHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly bodyExcerpt?: string,
  ) {
    super(message);
    this.name = "NexusHttpError";
  }
}

export interface SseResult {
  text:       string;
  outputId:   string | null;
  logs:       string[];
  rawEvents:  number;
}

export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Consume un stream SSE de Nexus y agrega los `text_delta` en una sola
 * cadena. Termina cuando recibe `{type:"done"}` o cuando el stream cierra.
 * Si recibe `{type:"error"}`, lanza NexusHttpError.
 */
export async function streamSse(
  cfg: Config,
  path: string,
  body: unknown,
): Promise<SseResult> {
  const url = `${cfg.baseUrl}${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,
        "Content-Type":  "application/json",
        "Accept":        "text/event-stream",
        "User-Agent":    cfg.userAgent,
      },
      body:   JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const bodyExcerpt = await res.text().catch(() => "");
      throw new NexusHttpError(
        res.status,
        `Nexus backend respondió ${res.status} ${res.statusText} en ${path}`,
        bodyExcerpt.slice(0, 500),
      );
    }
    if (!res.body) {
      throw new NexusHttpError(500, `Respuesta sin body en ${path}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";
    let   text    = "";
    let   outputId: string | null = null;
    const logs: string[] = [];
    let   events  = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames separados por doble newline
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          events++;
          let evt: SseEvent;
          try { evt = JSON.parse(payload) as SseEvent; }
          catch { continue; }

          switch (evt.type) {
            case "text_delta": {
              const delta = (evt as { delta?: string }).delta ?? "";
              text += delta;
              break;
            }
            case "log": {
              const m = (evt as { message?: string }).message;
              if (m) logs.push(m);
              break;
            }
            case "done": {
              const id = (evt as { outputId?: string | null }).outputId ?? null;
              outputId = id;
              break;
            }
            case "error": {
              const m = (evt as { message?: string }).message ?? "Error en backend.";
              throw new NexusHttpError(500, m);
            }
            default:
              // Algunas rutas legacy emiten {delta:"..."} (consulta), {done:true}, etc.
              if ("delta" in evt && typeof evt.delta === "string") {
                text += evt.delta;
              }
          }
        }
      }
    }

    return { text, outputId, logs, rawEvents: events };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * POST normal a una ruta JSON. Sin streaming.
 */
export async function postJson<T = unknown>(
  cfg: Config,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${cfg.baseUrl}${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "User-Agent":    cfg.userAgent,
      },
      body:   JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new NexusHttpError(
        res.status,
        `Nexus backend respondió ${res.status} ${res.statusText} en ${path}`,
        text.slice(0, 500),
      );
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}
