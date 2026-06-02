import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBetVerificationCacheKey,
  computePayoutAmount,
  computeVerifiedMarketPools,
  filterUniqueVerifiedPayoutBets,
} from "./payout-security";

test("computeVerifiedMarketPools excludes unverified bets from both sides", () => {
  const pools = computeVerifiedMarketPools([
    { side: "YES", amount_sol: 0.001, tx_signature: "tx-yes", valid_onchain: true },
    { side: "NO", amount_sol: 1000, tx_signature: "tx-fake-1", valid_onchain: false },
    { side: "NO", amount_sol: 500, tx_signature: "tx-fake-2", valid_onchain: null },
    { side: "NO", amount_sol: 0.5, tx_signature: "tx-no", valid_onchain: true },
  ]);

  assert.equal(pools.yesTotal, 0.001);
  assert.equal(pools.noTotal, 0.5);
});

test("computePayoutAmount cannot be inflated by excluded fake losing liquidity", () => {
  const pools = computeVerifiedMarketPools([
    { side: "YES", amount_sol: 0.001, tx_signature: "tx-yes", valid_onchain: true },
    { side: "NO", amount_sol: 9999, tx_signature: "tx-fake", valid_onchain: false },
  ]);

  assert.equal(computePayoutAmount(0.001, pools.yesTotal, pools.noTotal), 0.001);
});

test("verified pools ignore duplicate or missing tx signatures", () => {
  const bets = [
    { side: "YES" as const, amount_sol: 1, tx_signature: "tx-replay", valid_onchain: true },
    { side: "NO" as const, amount_sol: 99, tx_signature: "tx-replay", valid_onchain: true },
    { side: "NO" as const, amount_sol: 50, tx_signature: null, valid_onchain: true },
    { side: "NO" as const, amount_sol: 2, tx_signature: "tx-legit", valid_onchain: true },
  ];

  assert.deepEqual(filterUniqueVerifiedPayoutBets(bets), [bets[0], bets[3]]);
  assert.deepEqual(computeVerifiedMarketPools(bets), { yesTotal: 1, noTotal: 2 });
});

test("verification cache key is scoped by signature, wallet, amount and pool", () => {
  const base = {
    tx_signature: "tx",
    wallet: "wallet-a",
    amount_sol: 0.001,
    pool_public_key: "pool-a",
  };

  const key = buildBetVerificationCacheKey(base);
  assert.ok(key);
  assert.notEqual(key, buildBetVerificationCacheKey({ ...base, wallet: "wallet-b" }));
  assert.notEqual(key, buildBetVerificationCacheKey({ ...base, amount_sol: 0.002 }));
  assert.notEqual(key, buildBetVerificationCacheKey({ ...base, pool_public_key: "pool-b" }));
  assert.equal(buildBetVerificationCacheKey({ ...base, tx_signature: "" }), null);
});
