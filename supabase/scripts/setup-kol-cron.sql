-- ============================================================
-- ACTIVER le cron horaire pour le KOL Leaderboard
-- Ce job appelle l'Edge Function kol-batch toutes les heures
-- ============================================================
--
-- Pré-requis sécurité:
-- 1. Générer un secret fort NON service_role:
--    openssl rand -hex 32
-- 2. Le stocker dans Supabase Vault, jamais dans cron.job:
--    SELECT vault.create_secret('<SECRET_NON_SERVICE_ROLE>', 'kol_oracle_secret', 'KOL oracle cron secret');
-- 3. Déployer le même secret côté Edge Functions:
--    supabase secrets set KOL_ORACLE_SECRET='<SECRET_NON_SERVICE_ROLE>'
--
-- Ne jamais mettre SUPABASE_SERVICE_ROLE_KEY dans un SQL cron/job stocké.

-- Activer les extensions si pas déjà fait
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE WARNING 'Supabase Vault is required: create/store the kol_oracle_secret secret before scheduling this cron.';
    RAISE EXCEPTION 'Missing Supabase Vault secret storage';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'kol_oracle_secret'
      AND decrypted_secret IS NOT NULL
      AND length(decrypted_secret) >= 32
  ) THEN
    RAISE WARNING 'Missing Vault secret "kol_oracle_secret". Cron setup aborted; do not use service_role here.';
    RAISE EXCEPTION 'Missing KOL oracle cron secret';
  END IF;
END
$$;

-- Supprimer l'ancien job s'il existe (ignore toute erreur)
DO $$
BEGIN
  PERFORM cron.unschedule('kol-hourly-snapshot');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

-- Créer le job : toutes les heures à :00
SELECT cron.schedule(
  'kol-hourly-snapshot',
  '0 * * * *',
  $$
    SELECT net.http_get(
      'https://upsnwrjbmahmrhqyjicu.supabase.co/functions/v1/kol-batch',
      headers := jsonb_build_object(
        'x-kol-oracle-secret',
        (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'kol_oracle_secret'
          LIMIT 1
        )
      )
    )
  $$
);

-- Vérifier
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'kol-hourly-snapshot';
