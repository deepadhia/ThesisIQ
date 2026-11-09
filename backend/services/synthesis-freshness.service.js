/** Old narrative reports must not outlive a corrected verified results source. */
export function currentSyntheses(rows = [], sourceId = null) {
  if (!sourceId) return [];
  return rows.filter(row => {
    const match = String(row.report_content || '').match(/<!-- METADATA_HEADER: (\{[^\n]*\}) -->/);
    if (!match) return false;
    try { return JSON.parse(match[1]).source_filing_id === sourceId; }
    catch { return false; }
  });
}
