BEGIN;

ALTER TABLE public.bet_tx_signature_claims
  DROP CONSTRAINT IF EXISTS bet_tx_signature_claims_bet_id_fkey;

ALTER TABLE public.bet_tx_signature_claims
  ADD CONSTRAINT bet_tx_signature_claims_bet_id_fkey
  FOREIGN KEY (bet_id)
  REFERENCES public.bets(id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

COMMIT;

NOTIFY pgrst, 'reload schema';
