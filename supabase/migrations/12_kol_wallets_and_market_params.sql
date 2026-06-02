-- Migration 12 — KOL wallets registry + params pour résolution auto

-- Table des KOLs avec leurs wallets (utilisée par kol-batch et auto-settle)

CREATE TABLE IF NOT EXISTS kol_wallets (
  name TEXT PRIMARY KEY,
  wallet TEXT NOT NULL UNIQUE
);

INSERT INTO kol_wallets (name, wallet) VALUES
  ('Cented',   'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o'),
  ('theo',     'Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt'),
  ('Jijo',     '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk'),
  ('clukz',    'G6fUXjMKPJzCY1rveAE6Qm7wy5U3vZgKDJmN1VPAdiZC'),
  ('decu',     '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9'),
  ('Cupsey',   '2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f'),
  ('dv',       'BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd'),
  ('Dani',     'AuPp4YTMTyqxYXQnHc5KUc6pUuCSsHQpBJhgnD45yqrf'),
  ('radiance', 'FAicXNV5FVqtfbpn4Zccs71XcfGeyxBSGbqLDyDJZjke'),
  ('Kadenox',  'B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE kol_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read kol_wallets"
  ON kol_wallets
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE markets ADD COLUMN IF NOT EXISTS kol_params JSONB;

CREATE INDEX IF NOT EXISTS idx_markets_kol_tag ON markets(tag) WHERE tag = 'KOL';

NOTIFY pgrst, 'reload schema';