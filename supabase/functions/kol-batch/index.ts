// @ts-nocheck
// Deno Edge Function – imports are URL-based, not npm modules
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kol-oracle-secret, x-cron-secret",
};

const KOLS = [
  { name: "Cented",   wallet: "CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o" },
  { name: "theo",     wallet: "Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt" },
  { name: "Jijo",     wallet: "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk" },
  { name: "clukz",    wallet: "G6fUXjMKPJzCY1rveAE6Qm7wy5U3vZgKDJmN1VPAdiZC" },
  { name: "decu",     wallet: "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9" },
  { name: "Cupsey",   wallet: "2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f" },
  { name: "dv",       wallet: "BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd" },
  { name: "Dani",     wallet: "AuPp4YTMTyqxYXQnHc5KUc6pUuCSsHQpBJhgnD45yqrf" },
  { name: "radiance", wallet: "FAicXNV5FVqtfbpn4Zccs71XcfGeyxBSGbqLDyDJZjke" },
  { name: "Kadenox",  wallet: "B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC" },
];

function getFunctionUrl() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  if (supabaseUrl) {
    return `${supabaseUrl}/functions/v1/gmgn-proxy`;
  }

  const projectRef = Deno.env.get("PROJECT_REF");
  if (projectRef) {
    return `https://${projectRef}.supabase.co/functions/v1/gmgn-proxy`;
  }

  return null;
}

function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b || a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function hasServiceRoleAccess(req: Request) {
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const apikey = req.headers.get("apikey");

  return Boolean(
    serviceKey &&
      safeEqual(bearer, serviceKey) &&
      safeEqual(apikey, serviceKey)
  );
}

function hasOracleAccess(req: Request) {
  const oracleSecret = Deno.env.get("KOL_ORACLE_SECRET");
  const providedSecret =
    req.headers.get("x-kol-oracle-secret") ?? req.headers.get("x-cron-secret");

  return Boolean((oracleSecret && safeEqual(providedSecret, oracleSecret)) || hasServiceRoleAccess(req));
}

function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

function toHourStartIso(value: string | Date) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

async function getKOLWallet(supabase: any, name: string) {
  const { data, error } = await supabase
    .from("kol_wallets")
    .select("wallet")
    .eq("name", name)
    .maybeSingle();

  if (error || !data?.wallet) return null;
  return data.wallet as string;
}

async function getKOLSnapshot(supabase: any, wallet: string, snapshotHour: string) {
  const { data, error } = await supabase
    .from("kol_hourly_snapshots")
    .select("*")
    .eq("wallet", wallet)
    .eq("snapshot_hour", snapshotHour)
    .limit(1);

  if (error) return null;
  return Array.isArray(data) ? data[0] ?? null : null;
}

async function settleDueKOLMarkets(supabase: any) {
  const { data: markets, error } = await supabase
    .from("markets")
    .select("*")
    .eq("tag", "KOL")
    .eq("resolved", false)
    .is("deleted_at", null)
    .lte("closes_at", new Date().toISOString());

  if (error) {
    return { ok: false, error: error.message, settled: 0, skipped: 0, results: [] };
  }

  const results = [];
  let settled = 0;
  let skipped = 0;

  for (const market of markets ?? []) {
    const params = market.kol_params;
    const kolName = params?.kol_name;
    if (!params?.type || !kolName || !market.closes_at) {
      skipped++;
      results.push({ id: market.id, ok: false, reason: "missing kol params" });
      continue;
    }

    const wallet = await getKOLWallet(supabase, kolName);
    if (!wallet) {
      skipped++;
      results.push({ id: market.id, ok: false, reason: `wallet not found for ${kolName}` });
      continue;
    }

    const settlementHour = toHourStartIso(market.closes_at);
    const snapshot = await getKOLSnapshot(supabase, wallet, settlementHour);
    if (!snapshot) {
      skipped++;
      results.push({ id: market.id, ok: false, reason: `no snapshot at ${settlementHour}` });
      continue;
    }

    if (
      (snapshot.pnl_sol == null || snapshot.pnl_percent == null) &&
      ["pnl_sol_positive", "pnl_sol_negative", "pnl_percent", "head_to_head", "top3"].includes(params.type)
    ) {
      skipped++;
      results.push({ id: market.id, ok: false, reason: `no previous-hour baseline at ${settlementHour}` });
      continue;
    }

    let outcome: "YES" | "NO";
    let settlementValue = 0;

    switch (params.type) {
      case "pnl_sol_positive":
        outcome = Number(snapshot.pnl_sol ?? 0) >= Number(params.threshold ?? 0) ? "YES" : "NO";
        settlementValue = Number(snapshot.pnl_sol ?? 0);
        break;
      case "pnl_sol_negative":
        outcome = Number(snapshot.pnl_sol ?? 0) <= -Number(params.threshold ?? 0) ? "YES" : "NO";
        settlementValue = Number(snapshot.pnl_sol ?? 0);
        break;
      case "pnl_percent":
        outcome = params.direction === "positive"
          ? (Number(snapshot.pnl_percent ?? 0) > 0 ? "YES" : "NO")
          : (Number(snapshot.pnl_percent ?? 0) < 0 ? "YES" : "NO");
        settlementValue = Number(snapshot.pnl_percent ?? 0);
        break;
      case "trades":
        outcome = Number(snapshot.total_trades ?? 0) > Number(params.min_trades ?? 5) ? "YES" : "NO";
        settlementValue = Number(snapshot.total_trades ?? 0);
        break;
      case "top3": {
        const { data: allSnapshots } = await supabase
          .from("kol_hourly_snapshots")
          .select("wallet,pnl_sol")
          .eq("snapshot_hour", snapshot.snapshot_hour)
          .order("pnl_sol", { ascending: false });
        const rank = (allSnapshots ?? []).findIndex((row: any) => row.wallet === wallet) + 1;
        outcome = rank > 0 && rank <= Number(params.position ?? 3) ? "YES" : "NO";
        settlementValue = rank;
        break;
      }
      case "head_to_head": {
        const opponentName = params.opponent_kol_name;
        if (!opponentName || opponentName === kolName) {
          skipped++;
          results.push({ id: market.id, ok: false, reason: "invalid opponent" });
          continue;
        }

        const opponentWallet = await getKOLWallet(supabase, opponentName);
        if (!opponentWallet) {
          skipped++;
          results.push({ id: market.id, ok: false, reason: `wallet not found for ${opponentName}` });
          continue;
        }

        const opponentSnapshot = await getKOLSnapshot(supabase, opponentWallet, settlementHour);
        if (!opponentSnapshot || opponentSnapshot.pnl_sol == null) {
          skipped++;
          results.push({ id: market.id, ok: false, reason: `no usable opponent snapshot at ${settlementHour}` });
          continue;
        }

        const primaryPnl = Number(snapshot.pnl_sol);
        const opponentPnl = Number(opponentSnapshot.pnl_sol);
        outcome = primaryPnl > opponentPnl ? "YES" : "NO";
        settlementValue = primaryPnl - opponentPnl;
        break;
      }
      default:
        skipped++;
        results.push({ id: market.id, ok: false, reason: `unknown type ${params.type}` });
        continue;
    }

    const { error: settleError } = await supabase.rpc("settle_market", {
      p_market_id: market.id,
      p_outcome: outcome,
      p_settlement_price: settlementValue,
    });

    if (settleError) {
      skipped++;
      results.push({ id: market.id, ok: false, reason: settleError.message });
      continue;
    }

    try {
      const { data: marketSnapshot } = await supabase.rpc("generate_market_snapshot", {
        p_market_id: market.id,
      });
      if (marketSnapshot) {
        await supabase.from("markets").update({ snapshot: marketSnapshot }).eq("id", market.id);
      }
    } catch {
      // Settlement is the source of truth; snapshot archival can retry later.
    }

    settled++;
    results.push({ id: market.id, ok: true, outcome, settlement_value: settlementValue });
  }

  return { ok: true, settled, skipped, results };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const oracleSecret = Deno.env.get("KOL_ORACLE_SECRET");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!oracleSecret && !hasServiceRoleAccess(req)) {
    return new Response(JSON.stringify({ error: "KOL_ORACLE_SECRET not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!hasOracleAccess(req)) {
    return new Response(JSON.stringify({ error: "oracle access denied" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const functionUrl = getFunctionUrl();
  if (!functionUrl) {
    return new Response(JSON.stringify({ error: "SUPABASE_URL or PROJECT_REF not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: { name: string; wallet: string; ok: boolean; error?: string }[] = [];

  for (const kol of KOLS) {
    try {
      const url = `${functionUrl}?wallet=${kol.wallet}&auto=true`;
      const headers = oracleSecret
        ? { "x-kol-oracle-secret": oracleSecret }
        : {
            authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          };
      const res = await fetch(url, {
        headers,
      });

      if (!res.ok) {
        const body = await res.text();
        results.push({ name: kol.name, wallet: kol.wallet, ok: false, error: `HTTP ${res.status}: ${body}` });
      } else {
        results.push({ name: kol.name, wallet: kol.wallet, ok: true });
      }

      // 4s delay to avoid Helius rate limits
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      results.push({ name: kol.name, wallet: kol.wallet, ok: false, error: String(e) });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const supabase = getSupabaseAdmin();
  const settlement = supabase
    ? await settleDueKOLMarkets(supabase)
    : { ok: false, error: "SUPABASE_URL or service role key not configured", settled: 0, skipped: 0, results: [] };

  return new Response(
    JSON.stringify({ total: results.length, ok: okCount, failed: failCount, results, settlement }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
