-- Migration 07 — Cache des prix crypto pour éviter les rate limits CoinGecko

-- Table pour stocker les prix en cache
CREATE TABLE IF NOT EXISTS public.prices_cache (
  symbol TEXT PRIMARY KEY,
  price NUMERIC NOT NULL,
  change_24h NUMERIC DEFAULT 0,
  history NUMERIC[] DEFAULT '{}',  -- Array de prix pour le chart (24h)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Activer RLS
ALTER TABLE public.prices_cache ENABLE ROW LEVEL SECURITY;

-- Policy: tout le monde peut lire
DROP POLICY IF EXISTS "prices readable by all" ON public.prices_cache;
CREATE POLICY "prices readable by all"
ON public.prices_cache
FOR SELECT USING (true);

-- Policy: seul le service role peut modifier (Edge Function)
DROP POLICY IF EXISTS "prices writable by service" ON public.prices_cache;
CREATE POLICY "prices writable by service"
ON public.prices_cache
FOR ALL
USING (true)
WITH CHECK (true);

-- Index pour les requêtes rapides
CREATE INDEX IF NOT EXISTS prices_cache_updated_idx ON public.prices_cache(updated_at);

-- Fonction pour nettoyer le vieux cache (> 1 heure)
CREATE OR REPLACE FUNCTION public.cleanup_old_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.prices_cache WHERE updated_at < now() - interval '1 hour';
END;
$$;
