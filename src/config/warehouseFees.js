/**
 * warehouseFees.js
 * Per-location warehouse handling fee configuration.
 * Each warehouse has its own fee structure — do not assume a default.
 * computeWarehouseFee returns null (not zero) for unknown locations so callers
 * can surface the gap rather than silently under-counting costs.
 */

export const WAREHOUSE_FEES = {
  'NJ Warehouse': { baseFee: 2.00, additionalUnitFee: 0.35 },
};

/**
 * Returns handling fee for an order at the given location, or null if the
 * location is not configured. Callers must treat null as "unknown" and flag it.
 * @param {string} locationName
 * @param {number} totalUnitsInOrder  total quantity of warehouse-fulfilled items
 */
export function computeWarehouseFee(locationName, totalUnitsInOrder) {
  const config = WAREHOUSE_FEES[locationName];
  if (!config) return null;
  return config.baseFee + config.additionalUnitFee * Math.max(0, totalUnitsInOrder - 1);
}
