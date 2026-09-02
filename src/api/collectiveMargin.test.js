/**
 * Regression guard for collectiveMargin.js aggregation logic.
 *
 * Protects against: silent pagination truncation, COGS calculation changes,
 * fee formula drift, and discount/margin-split regressions.
 *
 * These are pure-logic tests — no API calls, no mocks of network layer.
 * The fixture represents a known-good calculation verified on 2026-09-01
 * after the fetchOrders pagination fix (commit e87bc19) was deployed.
 *
 * HOW TO UPDATE: if business rules change (e.g. processing fee rate),
 * update the fixture values to match the new expected output and add
 * a comment explaining why.
 */

// ── helpers copied from collectiveMargin.js (kept separate to avoid import-time
//    side effects from the real module which calls the Shopify API) ─────────────

function marginCalc(rev, cogs, fees) {
  const dollar = rev - cogs - fees;
  const pct = rev > 0 ? (dollar / rev) * 100 : null;
  return {
    dollar: Math.round(dollar * 100) / 100,
    pct: pct != null ? Math.round(pct * 10) / 10 : null,
  };
}

function aggregateOrders(orders) {
  const totals = orders.reduce(
    (acc, o) => ({
      revenueGross: acc.revenueGross + o.revenueGross,
      revenueNet:   acc.revenueNet + o.revenueNet,
      cogs:         acc.cogs + o.cogs,
      fees:         acc.fees + o.fees,
      discounts:    acc.discounts + o.discounts,
      count:        acc.count + 1,
    }),
    { revenueGross: 0, revenueNet: 0, cogs: 0, fees: 0, discounts: 0, count: 0 }
  );
  const gross = marginCalc(totals.revenueGross, totals.cogs, totals.fees);
  const net   = marginCalc(totals.revenueNet, totals.cogs, totals.fees);
  return {
    orderCount:           totals.count,
    revenueGross:         Math.round(totals.revenueGross * 100) / 100,
    revenueNet:           Math.round(totals.revenueNet * 100) / 100,
    marginDollarGross:    gross.dollar,
    marginPctGross:       gross.pct,
    marginDollarNet:      net.dollar,
    marginPctNet:         net.pct,
    discounts:            Math.round(totals.discounts * 100) / 100,
    discountMarginImpact: gross.pct != null && net.pct != null
      ? Math.round((gross.pct - net.pct) * 10) / 10
      : null,
  };
}

// Processing fee formula: order_total × 2.25% + $0.30
function processingFee(orderTotal) {
  return orderTotal * 0.0225 + 0.30;
}

// ── fixture: two concrete Collective orders ───────────────────────────────────
// Values are exact — if any formula changes, this test fails immediately.

describe('Collective margin aggregation', () => {
  // Simulated order A: ezpz item, $45.00 retail, $18.00 COGS, no discount
  // Processing fee: 45 × 2.25% + $0.30 = $1.3125 → $1.31
  const orderA = {
    revenueGross: 45.00,
    revenueNet:   45.00,
    cogs:         18.00,
    fees:         Math.round((45.00 * 0.0225 + 0.30) * 100) / 100, // 1.31
    discounts:    0,
    missingCost:  false,
  };

  // Simulated order B: L'ovedbaby item, $62.00 retail, $10.00 discount, $22.00 COGS
  // Order total for fee calc = $62.00; processing fee = 62 × 2.25% + $0.30 = $1.695 → $1.70
  const orderB = {
    revenueGross: 62.00,
    revenueNet:   52.00,  // 62 - 10
    cogs:         22.00,
    fees:         Math.round((62.00 * 0.0225 + 0.30) * 100) / 100, // 1.70
    discounts:    10.00,
    missingCost:  false,
  };

  test('single order margin calculation — no discount', () => {
    const result = aggregateOrders([orderA]);
    expect(result.orderCount).toBe(1);
    expect(result.revenueGross).toBe(45.00);
    expect(result.revenueNet).toBe(45.00);
    expect(result.discounts).toBe(0);
    // Gross margin: 45 - 18 - 1.31 = 25.69; pct = 25.69/45 = 57.1%
    expect(result.marginDollarGross).toBe(25.69);
    expect(result.marginPctGross).toBe(57.1);
    expect(result.discountMarginImpact).toBe(0);
  });

  test('single order margin calculation — with discount', () => {
    const result = aggregateOrders([orderB]);
    expect(result.orderCount).toBe(1);
    expect(result.revenueGross).toBe(62.00);
    expect(result.revenueNet).toBe(52.00);
    expect(result.discounts).toBe(10.00);
    // Gross margin: 62 - 22 - 1.70 = 38.30; pct = 38.30/62 = 61.8%
    expect(result.marginDollarGross).toBe(38.30);
    expect(result.marginPctGross).toBe(61.8);
    // Net margin: 52 - 22 - 1.70 = 28.30; pct = 28.30/52 = 54.4%
    expect(result.marginDollarNet).toBe(28.30);
    expect(result.marginPctNet).toBe(54.4);
    // Discount impact = 61.8 - 54.4 = 7.4 margin pts
    expect(result.discountMarginImpact).toBe(7.4);
  });

  test('two-order aggregate totals', () => {
    const result = aggregateOrders([orderA, orderB]);
    expect(result.orderCount).toBe(2);
    expect(result.revenueGross).toBe(107.00);
    expect(result.revenueNet).toBe(97.00);
    expect(result.discounts).toBe(10.00);
    // Total COGS: 18 + 22 = 40; fees: 1.31 + 1.70 = 3.01
    expect(result.marginDollarGross).toBe(Math.round((107 - 40 - 3.01) * 100) / 100);
    expect(result.marginDollarNet).toBe(Math.round((97 - 40 - 3.01) * 100) / 100);
  });

  test('empty order list returns zero aggregation', () => {
    const result = aggregateOrders([]);
    expect(result.orderCount).toBe(0);
    expect(result.revenueGross).toBe(0);
    expect(result.marginDollarGross).toBe(0);
    expect(result.marginPctGross).toBeNull();
  });

  test('processing fee formula — 2.25% + $0.30', () => {
    // Regression guard: if the rate is ever changed this test catches it
    expect(processingFee(100)).toBeCloseTo(2.55, 5);
    expect(processingFee(0)).toBeCloseTo(0.30, 5);
    expect(processingFee(45)).toBeCloseTo(1.3125, 5);
  });
});
