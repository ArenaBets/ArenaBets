import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type WorkerEnv = {
  KOL_ORACLE_SECRET?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

function getSupabaseFunctionBaseUrl(env: WorkerEnv): string | null {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  return url ? url.replace(/\/$/, "") : null;
}

async function runHourlyKOLSnapshot(env: WorkerEnv): Promise<void> {
  const functionBaseUrl = getSupabaseFunctionBaseUrl(env);
  if (!functionBaseUrl || !env.KOL_ORACLE_SECRET) {
    console.error("[scheduled] Missing SUPABASE_URL/VITE_SUPABASE_URL or KOL_ORACLE_SECRET for KOL batch");
    return;
  }

  const response = await fetch(`${functionBaseUrl}/functions/v1/kol-batch`, {
    headers: { "x-kol-oracle-secret": env.KOL_ORACLE_SECRET },
  });

  if (!response.ok) {
    console.error("[scheduled] KOL batch failed", response.status, await response.text());
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },

  async scheduled(_event: unknown, env: WorkerEnv, ctx: { waitUntil: (promise: Promise<unknown>) => void }) {
    ctx.waitUntil(runHourlyKOLSnapshot(env));
  },
};
