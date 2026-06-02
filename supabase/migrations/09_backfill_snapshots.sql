-- Migration 09 — Backfill snapshots pour marchés déjà fermés
-- Génère les snapshots manquants pour tous les marchés résolus avant la migration 08

DO $$
DECLARE
  m RECORD;
  snapshot_data JSONB;
  count_updated INTEGER := 0;
BEGIN
  FOR m IN
    SELECT id FROM public.markets
    WHERE resolved = true
      AND (snapshot IS NULL OR closed_at IS NULL)
  LOOP
    -- Générer le snapshot
    SELECT public.generate_market_snapshot(m.id) INTO snapshot_data;
    
    IF snapshot_data IS NOT NULL THEN
      UPDATE public.markets
      SET 
        snapshot = snapshot_data,
        closed_at = COALESCE(closed_at, closes_at, NOW())
      WHERE id = m.id;
      
      count_updated := count_updated + 1;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Backfill complete: % markets updated', count_updated;
END $$;

NOTIFY pgrst, 'reload schema';
