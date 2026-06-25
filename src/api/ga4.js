/**
 * ga4.js
 * Google Analytics 4 Data API — routed through the birch-api-proxy Lambda.
 * Pulls website traffic & source data for birchstore.com.
 *
 * Required environment variables (set in AWS Amplify):
 *   REACT_APP_GA4_PROPERTY_ID   = 538994991
 *   REACT_APP_GA4_CLIENT_EMAIL  = birch-metrics-dashboard@birch-analytics.iam.gserviceaccount.com
 *   REACT_APP_GA4_PRIVATE_KEY   = <private_key from JSON, with \n preserved>
 *
 * The Lambda proxy forwards requests to the GA4 Data API using the service account credentials.
 */

const PROXY = 'https://ez5e63jmydqmttr3qorvopyyt40baytn.lambda-url.us-east-1.on.aws';
const PROPERTY_ID = process.env.REACT_APP_GA4_PROPERTY_ID || '538994991';

async function ga4Fetch(body) {
  const res = await fetch(`${PROXY}/ga4/runReport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyId: PROPERTY_ID, ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 API error ${res.status}: ${text}`);
  }
  return res.json();
}

/** Format date as YYYY-MM-DD for GA4 */
function fmtDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetch traffic by channel for last 7 days vs prior 7 days.
 * Returns: { channels: [{channel, sessions, pct}], totals: {sessions, thisWeek, prevWeek} }
 */
export async function fetchTrafficByChannel(weekStart, weekEnd, prevWeekStart, prevWeekEnd) {
  const [thisWeek, prevWeek] = await Promise.all([
    ga4Fetch({
      dateRanges: [{ startDate: fmtDate(new Date(weekStart)), endDate: fmtDate(new Date(weekEnd)) }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'bounceRate' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
    ga4Fetch({
      dateRanges: [{ startDate: fmtDate(new Date(prevWeekStart)), endDate: fmtDate(new Date(prevWeekEnd)) }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
  ]);

  const parseRows = (report) => {
    const rows = report?.rows || [];
    return rows.map(row => ({
      channel: row.dimensionValues?.[0]?.value || 'Unknown',
      sessions: parseInt(row.metricValues?.[0]?.value || '0', 10),
      users: parseInt(row.metricValues?.[1]?.value || '0', 10),
      bounceRate: parseFloat(row.metricValues?.[2]?.value || '0'),
    }));
  };

  const thisRows = parseRows(thisWeek);
  const prevRows = parseRows(prevWeek);

  const totalSessions = thisRows.reduce((s, r) => s + r.sessions, 0);
  const totalPrev     = prevRows.reduce((s, r) => s + r.sessions, 0);

  // Build prev map for WoW
  const prevMap = {};
  prevRows.forEach(r => { prevMap[r.channel] = r.sessions; });

  const channels = thisRows.map(r => ({
    channel:    r.channel,
    sessions:   r.sessions,
    users:      r.users,
    bounceRate: Math.round(r.bounceRate * 100),
    pct:        totalSessions > 0 ? Math.round((r.sessions / totalSessions) * 100) : 0,
    wow:        prevMap[r.channel]
      ? Math.round(((r.sessions - prevMap[r.channel]) / prevMap[r.channel]) * 100)
      : null,
  }));

  return {
    channels,
    totalSessions,
    totalPrev,
    totalWoW: totalPrev > 0
      ? Math.round(((totalSessions - totalPrev) / totalPrev) * 100)
      : null,
  };
}

/**
 * Fetch daily sessions for last 14 days (for sparkline chart).
 * Returns: [{ date: 'MM-DD', sessions }]
 */
export async function fetchDailySessions(twoWeeksStart, weekEnd) {
  const report = await ga4Fetch({
    dateRanges: [{ startDate: fmtDate(new Date(twoWeeksStart)), endDate: fmtDate(new Date(weekEnd)) }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  const rows = report?.rows || [];
  return rows.map(row => {
    const raw = row.dimensionValues?.[0]?.value || ''; // YYYYMMDD
    const formatted = raw.length === 8
      ? `${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : raw;
    return {
      date:     formatted,
      sessions: parseInt(row.metricValues?.[0]?.value || '0', 10),
    };
  });
}

/**
 * Fetch top landing pages by sessions this week.
 * Returns: [{ page, sessions }]
 */
export async function fetchTopLandingPages(weekStart, weekEnd) {
  const report = await ga4Fetch({
    dateRanges: [{ startDate: fmtDate(new Date(weekStart)), endDate: fmtDate(new Date(weekEnd)) }],
    dimensions: [{ name: 'landingPage' }],
    metrics: [{ name: 'sessions' }, { name: 'bounceRate' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 8,
  });

  const rows = report?.rows || [];
  return rows.map(row => ({
    page:       row.dimensionValues?.[0]?.value || '/',
    sessions:   parseInt(row.metricValues?.[0]?.value || '0', 10),
    bounceRate: Math.round(parseFloat(row.metricValues?.[1]?.value || '0') * 100),
  }));
}

/**
 * Fetch overall engagement metrics for the week.
 * Returns: { avgSessionDuration, pagesPerSession, bounceRate, newUserPct }
 */
export async function fetchEngagementMetrics(weekStart, weekEnd) {
  const report = await ga4Fetch({
    dateRanges: [{ startDate: fmtDate(new Date(weekStart)), endDate: fmtDate(new Date(weekEnd)) }],
    dimensions: [],
    metrics: [
      { name: 'averageSessionDuration' },
      { name: 'screenPageViewsPerSession' },
      { name: 'bounceRate' },
      { name: 'newUsers' },
      { name: 'totalUsers' },
    ],
  });

  const row = report?.rows?.[0];
  if (!row) return {};

  const avgDuration = parseFloat(row.metricValues?.[0]?.value || '0');
  const mins = Math.floor(avgDuration / 60);
  const secs = Math.round(avgDuration % 60);
  const newUsers   = parseInt(row.metricValues?.[3]?.value || '0', 10);
  const totalUsers = parseInt(row.metricValues?.[4]?.value || '0', 10);

  return {
    avgSessionDuration: `${mins}m ${secs}s`,
    pagesPerSession:    Math.round(parseFloat(row.metricValues?.[1]?.value || '0') * 10) / 10,
    bounceRate:         Math.round(parseFloat(row.metricValues?.[2]?.value || '0') * 100),
    newUserPct:         totalUsers > 0 ? Math.round((newUsers / totalUsers) * 100) : null,
  };
}
