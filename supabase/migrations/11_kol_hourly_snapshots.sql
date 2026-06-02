-- Table pour stocker les snapshots horaires du KOL leaderboard
-- Utilisée par l'Edge Function gmgn-proxy en mode auto=true

CREATE TABLE IF NOT EXISTS kol_hourly_snapshots (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  name TEXT,
  balance_sol NUMERIC,
  pnl_sol NUMERIC,
  pnl_percent NUMERIC,
  total_trades INTEGER,
  sells INTEGER,
  buys INTEGER,
  snapshot_hour TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (wallet, snapshot_hour)
);

-- Index pour récupérer le dernier snapshot par wallet
CREATE INDEX IF NOT EXISTS idx_kol_snapshots_wallet_hour
  ON kol_hourly_snapshots(wallet, snapshot_hour DESC);

-- Index pour récupérer tous les snapshots d'une heure donnée
CREATE INDEX IF NOT EXISTS idx_kol_snapshots_hour
  ON kol_hourly_snapshots(snapshot_hour DESC);

-- Politique RLS : tout le monde peut lire, seul le service_role peut écrire
ALTER TABLE kol_hourly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read"
  ON kol_hourly_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (true);
