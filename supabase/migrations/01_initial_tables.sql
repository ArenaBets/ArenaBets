-- Migration 01 — Tables de base markets + bets

CREATE TABLE public.markets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT 'GENERAL',
  created_by_wallet TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT,
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.bets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_id UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  amount_sol NUMERIC,
  tx_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bets_market_idx ON public.bets(market_id);

ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "markets readable by all" ON public.markets FOR SELECT USING (true);
CREATE POLICY "anyone can create markets" ON public.markets FOR INSERT WITH CHECK (true);

CREATE POLICY "bets readable by all" ON public.bets FOR SELECT USING (true);
CREATE POLICY "anyone can insert bets" ON public.bets FOR INSERT WITH CHECK (true);
