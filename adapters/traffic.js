/**
 * Traffic adapter — endpoint traces only. The board reads nothing else.
 */
'use strict';

module.exports = (D) => ({
  generatedAt: D.generatedAt,
  endpoints: D.endpoints,
});
