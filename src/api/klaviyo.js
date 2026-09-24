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
    const [listsData, countData] = await Promise.allSettled([
      klaviyoFetch('/lists', { 'fields[list]': 'name,created,updated' }),
      fetch(`${PROXY}/klaviyo/profile-count`, { headers: PROXY_HEADERS }).then(r => r.json()),
    ]);

    const lists = listsData.status === 'fulfilled' ? (listsData.value.data || []) : [];
    const totalProfiles = countData.status === 'fulfilled' ? (countData.value.total ?? null) : null;

    return {
      totalLists: lists.length,
      totalProfiles,
      lists: lists.map(l => ({ name: l.attributes?.name })),
    };
  } catch (err) {
    console.error('Klaviyo fetch error:', err);
    return { error: true, totalLists: null, totalProfiles: null, lists: [] };
  }
}
