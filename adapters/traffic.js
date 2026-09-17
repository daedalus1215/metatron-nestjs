/**
 * Traffic adapter — the tier order and endpoint traces. The board reads
 * nothing else.
 */
'use strict';

module.exports = (D) => ({
  generatedAt: D.generatedAt,
  tiers: D.tiers,
  endpoints: D.endpoints,
});
