/**
 * lib/ai/index.ts — a small, provider-neutral AI client for the learning modes (quiz gates, corrupted-leaf repairs, ...).
 *
 * One question, one structured answer: `ask({system, user, schema, validate})` returns the validated JSON or a reason it failed.
 * Two adapters:
 *   - "anthropic": the official `@anthropic-ai/sdk` (loaded on first use, so it costs nothing at startup) pointed at the app's own
 *     `/ai` path. The browser holds NO key: nginx (docker/30-biblio-config.sh) puts the real one on the request; the SDK is given a
 *     placeholder. Structured output via `output_config.format`; no temperature / top_p / top_k (rejected on current models);
 *     `effort: "low"` on the 5.x models; a `refusal` stop reason is reported, not retried; no tools.
 *   - "openai-compatible": a plain `fetch` to `/ai/chat/completions` (OpenRouter, Ollama, llama.cpp server, ...): the schema goes
 *     into the prompt and `response_format: json_object` asks for JSON; the answer is parsed loosely (fences, a sentence around it).
 * The provider and model come from the host's `/config.json` (lib/serverconfig.ts): there is no AI unless the host configured one.
 * Everything is cancellable (AbortSignal) and time-limited; nothing here ever throws: failures are `{ok: false, reason}`.
 */

import type { HostAi, ServerConfig } from "../serverconfig";
import { parseJsonLoose } from "./prompt";

export interface AskOptions<T> {
  system: string;
  /** The user turn. Put note text in it ONLY through `wrapUntrusted` (./prompt). */
  user: string;
  /** JSON Schema of the answer. */
  schema: Record<string, unknown>;
  /** Turn the parsed JSON into the typed answer, or null when it does not fit (checked by us, whatever the provider promises). */
  validate: (v: unknown) => T | null;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Give up after this long (default 90 s). */
  timeoutMs?: number;
}

export type AskFailure = "refused" | "invalid" | "http" | "network" | "aborted" | "timeout";
export type AskResult<T> = { ok: true; data: T } | { ok: false; reason: AskFailure; message: string; status?: number };

export interface AiClient {
  readonly provider: HostAi["provider"];
  readonly model: string;
  ask<T>(opts: AskOptions<T>): Promise<AskResult<T>>;
}

export interface AiDeps {
  /** Where the proxy lives; default: this page's origin + "/ai". */
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Models of the 5.x family accept `output_config.effort`; older ones reject it (so it is only sent where it is known to work). */
export function supportsEffort(model: string): boolean {
  return /^claude-(fable|opus|sonnet|haiku|mythos)-5/.test(model);
}

const defaultBase = (): string => (typeof location !== "undefined" ? `${location.origin}/ai` : "/ai");

/** The client for the host's AI, or null when the host configured none. */
export function aiClientFor(host: ServerConfig, deps: AiDeps = {}): AiClient | null {
  return host.ai ? createAiClient(host.ai, deps) : null;
}

export function createAiClient(cfg: HostAi, deps: AiDeps = {}): AiClient {
  const base = (deps.baseUrl ?? defaultBase()).replace(/\/+$/, "");
  const f = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    provider: cfg.provider,
    model: cfg.model,
    ask: <T,>(opts: AskOptions<T>): Promise<AskResult<T>> => guarded(opts, (signal) => (cfg.provider === "anthropic" ? askAnthropic(cfg.model, base, f, opts, signal) : askOpenAi(cfg.model, base, f, opts, signal))),
  };
}

/** Run an adapter with the caller's signal + a timeout; every failure becomes a result. */
async function guarded<T>(opts: AskOptions<T>, run: (signal: AbortSignal) => Promise<AskResult<T>>): Promise<AskResult<T>> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, opts.timeoutMs ?? 90000);
  const onAbort = (): void => ctl.abort();
  if (opts.signal?.aborted) ctl.abort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await run(ctl.signal);
  } catch (err) {
    if (timedOut) return { ok: false, reason: "timeout", message: "The AI took too long to answer." };
    if (ctl.signal.aborted) return { ok: false, reason: "aborted", message: "Cancelled." };
    return { ok: false, reason: "network", message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

function finish<T>(text: string, opts: AskOptions<T>): AskResult<T> {
  const parsed = parseJsonLoose(text);
  if (parsed === undefined) return { ok: false, reason: "invalid", message: "The AI did not answer with JSON." };
  let data: T | null = null;
  try {
    data = opts.validate(parsed);
  } catch {
    data = null;
  }
  return data === null ? { ok: false, reason: "invalid", message: "The AI's answer did not have the expected shape." } : { ok: true, data };
}

// ------------------------------------------------------------------------------------------------------------ anthropic

async function askAnthropic<T>(model: string, base: string, f: typeof fetch, opts: AskOptions<T>, signal: AbortSignal): Promise<AskResult<T>> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // placeholder key: the proxy replaces it; maxRetries 1 keeps a failing provider from stalling the UI
  const client = new Anthropic({ baseURL: base, apiKey: "proxy", dangerouslyAllowBrowser: true, maxRetries: 1, fetch: f });
  try {
    const res = await client.messages.create(
      {
        model,
        max_tokens: opts.maxTokens ?? 1500,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        output_config: { ...(supportsEffort(model) ? { effort: "low" as const } : {}), format: { type: "json_schema", schema: opts.schema } },
      },
      { signal },
    );
    if (res.stop_reason === "refusal") return { ok: false, reason: "refused", message: "The AI declined to answer this." };
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (res.stop_reason === "max_tokens" && !text) return { ok: false, reason: "invalid", message: "The answer was cut off." };
    return finish(text, opts);
  } catch (err) {
    if (signal.aborted) throw err;
    const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
    if (status !== undefined) return { ok: false, reason: "http", status, message: `The AI service answered ${status}: ${err instanceof Error ? err.message.slice(0, 200) : ""}` };
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------- openai-compatible

async function askOpenAi<T>(model: string, base: string, f: typeof fetch, opts: AskOptions<T>, signal: AbortSignal): Promise<AskResult<T>> {
  const system = `${opts.system}\n\nReply with ONLY a JSON object that matches this JSON schema, no other text:\n${JSON.stringify(opts.schema)}`;
  const res = await f(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: opts.maxTokens ?? 1500,
      temperature: 0.2,
    }),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* no body */
    }
    return { ok: false, reason: "http", status: res.status, message: `The AI service answered ${res.status}${detail ? `: ${detail}` : ""}` };
  }
  let body: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, reason: "invalid", message: "The AI service did not answer with JSON." };
  }
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "content_filter") return { ok: false, reason: "refused", message: "The AI declined to answer this." };
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) return { ok: false, reason: "invalid", message: "The AI sent an empty answer." };
  return finish(content, opts);
}
