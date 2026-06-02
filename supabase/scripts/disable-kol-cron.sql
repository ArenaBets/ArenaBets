-- ============================================================
-- DESACTIVER le cron horaire pour le KOL Leaderboard
-- ============================================================

SELECT cron.unschedule('kol-hourly-snapshot');

-- Vérifier qu'il est bien supprimé
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'kol-hourly-snapshot';
