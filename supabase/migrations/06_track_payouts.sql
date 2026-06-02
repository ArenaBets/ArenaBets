-- Migration 06 — Tracking des paiements de gains SOL

-- Ajouter une colonne pour tracker les paiements
ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS payout_tx TEXT,
  ADD COLUMN IF NOT EXISTS payout_amount NUMERIC;

-- Index pour trouver rapidement les paris non payés
CREATE INDEX IF NOT EXISTS bets_payout_idx ON public.bets(payout_tx) WHERE payout_tx IS NULL;

-- Policy pour permettre au worker auto-settle de marquer les paiements
DROP POLICY IF EXISTS "auto-settle can record payouts" ON public.bets;
CREATE POLICY "auto-settle can record payouts"
ON public.bets
FOR UPDATE
USING (payout_tx IS NULL)  -- On peut modifier seulement si pas encore payé
WITH CHECK (payout_tx IS NOT NULL);  -- On doit mettre un payout_tx
