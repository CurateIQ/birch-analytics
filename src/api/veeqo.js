/**
 * veeqo.js
 * Veeqo API integration — routed through the Lambda proxy.
 * API key lives in Lambda env var VEEQO_API_KEY (never in frontend code).
 *
 * Confirmed field names from live API inspection (2026-08-13):
 *   order.number           → Shopify order name, e.g. "#1150"
 *   allocation.warehouse.name → "NJ Warehouse" | "JIT - Portland" | "Shop Location" | …
 *   allocation.shipment.outbound_label_charges.value → actual carrier cost in USD
 *   (delivery_cost at order level is always 0; use outbound_label_charges instead)
 */

import { PROXY, PROXY_HEADERS } from './proxy';

const NJ_WAREHOUSE = 'NJ Warehouse';

async function veeqoFetch(path, params = {}) {
  const url = new URL(`${PROXY}/veeqo${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { headers: PROXY_HEADERS });
  if (!res.ok) throw new Error(`Veeqo proxy error: ${res.status}`);
  return res.json();
}

/**
 * Fetches all Veeqo orders since `sinceDate` (ISO string) and returns:
 *   shippingCosts  Map<shopifyOrderName, shippingCostUSD>  — NJ Warehouse only
 *   njOrderNames   Set<shopifyOrderName>                   — orders with any NJ allocation
 *
 * Veeqo order.number matches Shopify order.name (e.g. "#1150").
 * Pagination uses page/page_size query params; stops when a page comes back short.
 */
export async function fetchVeeqoData(sinceDate) {
  const shippingCosts = new Map();
  const njOrderNames  = new Set();
  const PAGE_SIZE = 100;
  let page = 1;

  while (true) {
    let orders;
    try {
      orders = await veeqoFetch('/orders', {
        page_size:        PAGE_SIZE,
        page,
        created_at_min:   sinceDate,
      });
    } catch (e) {
      console.warn('Veeqo fetch failed (page', page, '):', e.message);
      break;
    }

    if (!Array.isArray(orders) || orders.length === 0) break;

    for (const order of orders) {
      const name = order.number;
      if (!name) continue;

      for (const alloc of (order.allocations || [])) {
        if (alloc.warehouse?.name !== NJ_WAREHOUSE) continue;
        njOrderNames.add(name);
        const cost = alloc.shipment?.outbound_label_charges?.value;
        if (cost != null && cost > 0) {
          shippingCosts.set(name, (shippingCosts.get(name) || 0) + cost);
        }
      }
    }

    if (orders.length < PAGE_SIZE) break;
    page++;
    if (page > 50) break; // safety cap
  }

  return { shippingCosts, njOrderNames };
}
