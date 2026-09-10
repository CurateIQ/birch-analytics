/**
 * parseCampaignCsv.js
 * Parses Meta Ads Manager and Google Ads CSV exports into normalized rows.
 * Defensive about column names — throws with a clear message if required
 * columns are missing rather than returning silent undefined values.
 */

function parseCSVRow(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function requireCol(headers, name) {
  const idx = headers.indexOf(name);
  if (idx === -1) throw new Error(`Missing required column: "${name}". Found: ${headers.join(', ')}`);
  return idx;
}

function num(v) { return parseFloat(String(v).replace(/,/g, '')) || 0; }
function int(v) { return parseInt(String(v).replace(/,/g, ''), 10) || 0; }

/**
 * parseMetaCsv(fileText)
 * Parses Meta Ads Manager campaign export (Day breakdown).
 *
 * Required columns:
 *   "Reporting starts", "Campaign name", "Amount spent (USD)",
 *   "Impressions", "Link clicks", "Purchases"
 *
 * Returns: { rows: [{ campaignName, date, spend, impressions, clicks, purchases }], parsed, skipped }
 */
export function parseMetaCsv(fileText) {
  const lines = fileText.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('Empty file');

  const headers = parseCSVRow(lines[0]);

  const iDate      = requireCol(headers, 'Reporting starts');
  const iCampaign  = requireCol(headers, 'Campaign name');
  const iSpend     = requireCol(headers, 'Amount spent (USD)');
  const iImpr      = requireCol(headers, 'Impressions');
  const iClicks    = requireCol(headers, 'Link clicks');
  const iPurchases = requireCol(headers, 'Purchases');

  const rows = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    if (fields.length < 3) { skipped++; continue; }
    const date = fields[iDate];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
    rows.push({
      campaignName: fields[iCampaign] || '(unknown)',
      date,
      spend:       num(fields[iSpend]),
      impressions: int(fields[iImpr]),
      clicks:      int(fields[iClicks]),
      purchases:   int(fields[iPurchases]),
    });
  }

  if (!rows.length && skipped > 0) throw new Error(`No valid rows found — ${skipped} rows skipped (check date format YYYY-MM-DD and column alignment)`);
  return { rows, parsed: rows.length, skipped };
}

/**
 * parseGoogleCsv(fileText)
 * Parses Google Ads campaign export (Week segment).
 *
 * Row layout:
 *   Row 0: "Campaign report" — skipped
 *   Row 1: "All time" — skipped
 *   Row 2: real headers
 *   Row 3+: data
 *
 * Required columns: "Week", "Campaign", "Cost", "Impr.", "Clicks", "Conversions"
 *
 * Returns: { rows: [{ campaignName, weekStart, spend, impressions, clicks, conversions }], parsed, skipped }
 */
export function parseGoogleCsv(fileText) {
  const lines = fileText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 3) throw new Error('File too short — expected at least 3 rows (2 header rows + real headers)');

  const headers = parseCSVRow(lines[2]);

  const iWeek        = requireCol(headers, 'Week');
  const iCampaign    = requireCol(headers, 'Campaign');
  const iCost        = requireCol(headers, 'Cost');
  const iImpr        = requireCol(headers, 'Impr.');
  const iClicks      = requireCol(headers, 'Clicks');
  const iConversions = requireCol(headers, 'Conversions');

  const rows = [];
  let skipped = 0;

  for (let i = 3; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    if (fields.length < 3) { skipped++; continue; }
    const weekStart = fields[iWeek];
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) { skipped++; continue; }
    rows.push({
      campaignName: fields[iCampaign] || '(unknown)',
      weekStart,
      spend:       num(fields[iCost]),
      impressions: int(fields[iImpr]),
      clicks:      int(fields[iClicks]),
      conversions: num(fields[iConversions]),
    });
  }

  if (!rows.length && skipped > 0) throw new Error(`No valid rows found — ${skipped} rows skipped (check week date format YYYY-MM-DD)`);
  return { rows, parsed: rows.length, skipped };
}
