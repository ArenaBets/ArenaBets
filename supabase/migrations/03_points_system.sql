-- Migration 03 — Comptes points + fonction place_points_bet

CREATE TABLE IF NOT EXISTS public.users (
  wallet TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 100 CHECK (points >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS amount_points INTEGER,
  ADD COLUMN IF NOT EXISTS amount_sol NUMERIC,
  ADD COLUMN IF NOT EXISTS tx_signature TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bets'
      AND column_name = 'amount'
  ) THEN
    ALTER TABLE public.bets ALTER COLUMN amount DROP NOT NULL;
  END IF;

  ALTER TABLE public.bets ALTER COLUMN amount_sol DROP NOT NULL;
  ALTER TABLE public.bets ALTER COLUMN tx_signature DROP NOT NULL;
END;
$$;

ALTER TABLE public.bets DROP CONSTRAINT IF EXISTS bets_amount_points_check;
ALTER TABLE public.bets
  ADD CONSTRAINT bets_amount_points_check CHECK (amount_points IS NULL OR amount_points > 0);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users readable by all" ON public.users;
CREATE POLICY "users readable by all"
ON public.users
FOR SELECT
USING (true);

CREATE OR REPLACE FUNCTION public.ensure_user(p_wallet TEXT)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  arena_user public.users;
BEGIN
  IF p_wallet IS NULL OR length(trim(p_wallet)) = 0 THEN
    RAISE EXCEPTION 'Wallet is required';
  END IF;

  INSERT INTO public.users (wallet, points)
  VALUES (p_wallet, 100)
  ON CONFLICT (wallet) DO NOTHING;

  SELECT * INTO arena_user
  FROM public.users
  WHERE wallet = p_wallet;

  RETURN arena_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.place_points_bet(
  p_market_id UUID,
  p_wallet TEXT,
  p_side TEXT,
  p_amount_points INTEGER
)
RETURNS public.bets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  arena_user public.users;
  placed_bet public.bets;
BEGIN
  IF p_wallet IS NULL OR length(trim(p_wallet)) = 0 THEN
    RAISE EXCEPTION 'Wallet is required';
  END IF;

  IF p_side NOT IN ('YES', 'NO') THEN
    RAISE EXCEPTION 'Side must be YES or NO';
  END IF;

  IF p_amount_points IS NULL OR p_amount_points <= 0 THEN
    RAISE EXCEPTION 'Bet amount must be greater than 0';
  END IF;

  PERFORM public.ensure_user(p_wallet);

  SELECT * INTO arena_user
  FROM public.users
  WHERE wallet = p_wallet
  FOR UPDATE;

  IF arena_user.points < p_amount_points THEN
    RAISE EXCEPTION 'Not enough points';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.markets
    WHERE id = p_market_id
      AND (resolved = true OR (closes_at IS NOT NULL AND closes_at <= now()))
  ) THEN
    RAISE EXCEPTION 'Market is closed';
  END IF;

  UPDATE public.users
  SET points = points - p_amount_points
  WHERE wallet = p_wallet;

  INSERT INTO public.bets (market_id, wallet, side, amount_points)
  VALUES (p_market_id, p_wallet, p_side, p_amount_points)
  RETURNING * INTO placed_bet;

  RETURN placed_bet;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_user(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_points_bet(UUID, TEXT, TEXT, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
