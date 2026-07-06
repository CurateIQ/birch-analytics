/**
 * klaviyo.js
 * Klaviyo API calls routed through the birch-api-proxy Lambda.
 */

import { PROXY, PROXY_HEADERS } from './proxy';

async function klaviyoFetch(endpoint, params = {}) {
  const url = new URL(`${PROXY}/klaviyo${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: PROXY_HEADERS });
  if (!res.ok) throw new Error(`Klaviyo API error: ${res.status}`);
  return res.json();
}

export async function fetchListMetrics() {
  try {
    const data = await klaviyoFetch('/lists', {
      'fields[list]': 'name,profile_count,created,updated',
    });
    const lists = data.data || [];
    const totalProfiles = lists.reduce((sum, l) => sum + (l.attributes?.profile_count || 0), 0);
    return {
      totalLists: lists.length,
      totalProfiles,
      lists: lists.map(l => ({
        name: l.attributes?.name,
        count: l.attributes?.profile_count,
      })),
    };
  } catch (err) {
    console.error('Klaviyo fetch error:', err);
    return { totalLists: 0, totalProfiles: 0, lists: [] };
  }
}
