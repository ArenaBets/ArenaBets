import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kol-oracle-secret, x-cron-secret",
};

function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b || a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function hasOracleWriteAccess(req: Request) {
  const oracleSecret = Deno.env.get("KOL_ORACLE_SECRET");
  const providedSecret =
    req.headers.get("x-kol-oracle-secret") ?? req.headers.get("x-cron-secret");

  if (oracleSecret && safeEqual(providedSecret, oracleSecret)) {
    return true;
  }

  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const apikey = req.headers.get("apikey");

  return Boolean(
    serviceKey &&
      safeEqual(bearer, serviceKey) &&
      safeEqual(apikey, serviceKey)
  );
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundNullable(value: number | null, decimals: number) {
  return value === null ? null : round(value, decimals);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const wallet = url.searchParams.get("wallet");
    const auto = url.searchParams.get("auto") === "true"; // auto=true = snapshot horaire

    if (!wallet) {
      return new Response(JSON.stringify({ error: "wallet param required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasOracleWriteAccess(req)) {
      return new Response(JSON.stringify({ error: "oracle access denied" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const heliusKey = Deno.env.get("HELIUS_API_KEY");
    if (!heliusKey) {
      throw new Error("HELIUS_API_KEY not configured");
    }
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    
    // Supabase client (pour snapshot précédent + sauvegarde si auto=true)
    let supabase: any = null;
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseKey) {
        supabase = createClient(supabaseUrl, supabaseKey);
      }
    } catch (e) {
      console.log(`[${wallet}] Supabase init skipped:`, e);
    }

    // 1 & 2. Récupérer solde puis transactions (séquentiel pour éviter rate limiting)
    const since1hSec = Math.floor(Date.now() / 1000) - 3600;
    
    // Fetch balance avec retry
    let balanceSol = 0;
    let balanceAttempts = 0;
    const maxBalanceAttempts = 3;
    let balanceError = null;
    
    while (balanceAttempts < maxBalanceAttempts) {
      balanceAttempts++;
      try {
        const balanceRes = await fetch(`https://api.helius.xyz/v0/addresses/${wallet}/balances?api-key=${heliusKey}`);
        if (!balanceRes.ok) {
          throw new Error(`HTTP ${balanceRes.status}`);
        }
        const balanceData = await balanceRes.json();
        console.log(`[${wallet}] Balance attempt ${balanceAttempts}:`, balanceData.nativeBalance);
        if (typeof balanceData.nativeBalance === 'number') {
          balanceSol = balanceData.nativeBalance / 1e9;
          if (balanceSol >= 0) break; // Accepter aussi 0 comme valeur valide
        }
        if (balanceAttempts < maxBalanceAttempts) {
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        balanceError = e;
        console.log(`[${wallet}] Balance fetch error (attempt ${balanceAttempts}):`, e);
        if (balanceAttempts < maxBalanceAttempts) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    
    // Fetch transactions avec gestion d'erreur
    let txBatch1: any[] = [];
    try {
      const txRes = await fetch(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${heliusKey}&limit=100&type=SWAP`);
      if (!txRes.ok) {
        throw new Error(`HTTP ${txRes.status}`);
      }
      txBatch1 = await txRes.json();
    } catch (e) {
      console.log(`[${wallet}] Transaction fetch error:`, e);
    }
    
    // Parser les transactions batch 1
    let allTxs: any[] = [];
    let lastSignature = null;
    if (Array.isArray(txBatch1)) {
      for (const tx of txBatch1) {
        if (tx.timestamp < since1hSec) break;
        allTxs.push(tx);
        lastSignature = tx.signature;
      }
      
      // Batch 2 si nécessaire (moins de 100 txs trouvées et on a une dernière signature)
      if (allTxs.length === 100 && lastSignature) {
        const txBatch2 = await fetch(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${heliusKey}&limit=100&type=SWAP&before=${lastSignature}`).then(r => r.json());
        if (Array.isArray(txBatch2)) {
          for (const tx of txBatch2) {
            if (tx.timestamp < since1hSec) break;
            allTxs.push(tx);
          }
        }
      }
    }

    // 3. Récupérer le snapshot de l'heure précédente uniquement.
    // Si le cron a manqué une heure, on refuse de produire un faux PnL 1h.
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
    const previousHour = new Date(currentHour.getTime() - 60 * 60 * 1000);

    let prevBalance: number | null = null;
    if (supabase) {
      try {
        const { data: prevSnapshots } = await supabase
          .from("kol_hourly_snapshots")
          .select("balance_sol, snapshot_hour")
          .eq("wallet", wallet)
          .gte("snapshot_hour", previousHour.toISOString())
          .lt("snapshot_hour", currentHour.toISOString())
          .order("snapshot_hour", { ascending: false })
          .limit(1);

        const prevSnapshot = Array.isArray(prevSnapshots) ? prevSnapshots[0] : null;
        if (prevSnapshot?.balance_sol != null) {
          prevBalance = Number(prevSnapshot.balance_sol);
        }
      } catch (e) {
        console.log(`[${wallet}] Previous-hour snapshot lookup failed:`, e);
      }
    }

    // 4. Calculer PnL balance-based (current balance vs exact previous hour)
    const pnlSol = prevBalance === null ? null : balanceSol - prevBalance;
    const pnlPercent = prevBalance === null || prevBalance <= 0 ? null : ((balanceSol - prevBalance) / prevBalance) * 100;

    // 5. Parser les transactions pour trades stats (sells / buys / total_trades)
    let sells = 0; let buys = 0;
    for (const tx of allTxs) {
      const tt = tx.tokenTransfers ?? [];
      const siToken = tt.filter((t: any) => t.mint === SOL_MINT && t.toUserAccount === wallet).reduce((s: number, t: any) => s + (t.tokenAmount ?? 0), 0);
      const soToken = tt.filter((t: any) => t.mint === SOL_MINT && t.fromUserAccount === wallet).reduce((s: number, t: any) => s + (t.tokenAmount ?? 0), 0);
      const nt = tx.nativeTransfers ?? [];
      const siNative = nt.filter((t: any) => t.toUserAccount === wallet).reduce((s: number, t: any) => s + ((t.amount ?? 0) / 1e9), 0);
      const soNative = nt.filter((t: any) => t.fromUserAccount === wallet).reduce((s: number, t: any) => s + ((t.amount ?? 0) / 1e9), 0);
      const si = siToken + siNative;
      const so = soToken + soNative;
      if (si > so) { sells++; }
      else if (so > si) { buys++; }
    }
    const totalTrades = sells + buys;
    const winRate = totalTrades > 0 ? Math.round((sells / totalTrades) * 100) : null;

    // 6. Sauvegarder snapshot si auto=true
    if (auto && supabase) {
      try {
        const { error: rpcError } = await supabase.rpc("save_kol_snapshot", {
          p_wallet: wallet,
          p_balance_sol: balanceSol,
          p_pnl_sol: roundNullable(pnlSol, 3),
          p_pnl_percent: roundNullable(pnlPercent, 2),
          p_total_trades: totalTrades,
          p_sells: sells,
          p_buys: buys,
          p_snapshot_hour: currentHour.toISOString(),
        });
        if (rpcError) {
          console.error(`[${wallet}] Snapshot RPC error:`, rpcError);
        } else {
          console.log(`[${wallet}] Snapshot saved for hour ${currentHour.toISOString()}`);
        }
      } catch (e) {
        console.error(`[${wallet}] Snapshot RPC exception:`, e);
      }
    }

    return new Response(JSON.stringify({
      wallet,
      balance_sol: round(balanceSol, 3),
      pnl_sol: roundNullable(pnlSol, 3),
      pnl_percent: roundNullable(pnlPercent, 2),
      win_rate: winRate,
      total_trades: totalTrades > 0 ? totalTrades : null,
      sells,
      buys,
      period: "1h",
      snapshot_hour: currentHour.toISOString(),
      debug: {
        txs: allTxs.length,
        batches: allTxs.length > 100 ? 2 : 1,
        balanceAttempts,
        baseline_hour: previousHour.toISOString(),
        baseline_found: prevBalance !== null,
      }
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
