import * as cheerio from 'cheerio';

/**
 * Parses XBRL contexts to map internal IDs to date ranges/instants.
 * Returns an object: { [contextId]: { startDate, endDate, instant, isYearToDate, quarter, fy } }
 */
export function parseContexts(xmlContent) {
  const $ = cheerio.load(xmlContent, { xmlMode: true });
  const contexts = {};

  // Detect overall filing nature from NatureOfReportStandaloneConsolidated or TypeOfFiling
  let filingIsConsolidated = false;
  $('*').filter((i, el) => {
    const name = (el.name || '').toLowerCase();
    return name.includes('natureofreportstandaloneconsolidated') || name.includes('typeoffiling');
  }).each((i, el) => {
    const text = $(el).text().toLowerCase();
    if (text.includes('consolidated')) filingIsConsolidated = true;
  });

  // Handle both <xbrli:context> and <context>
  const contextElements = $('*').filter((i, el) => el.name === 'context' || el.name.endsWith(':context'));

  contextElements.each((i, el) => {
    const id = $(el).attr('id');
    const startDate = $(el).find('*').filter((j, e) => e.name === 'startDate' || e.name.endsWith(':startDate')).text();
    const endDate = $(el).find('*').filter((j, e) => e.name === 'endDate' || e.name.endsWith(':endDate')).text();
    const instant = $(el).find('*').filter((j, e) => e.name === 'instant' || e.name.endsWith(':instant')).text();

    if (!id) return;

    contexts[id] = {
      startDate: startDate || null,
      endDate: endDate || null,
      instant: instant || null,
      type: instant ? 'instant' : 'duration'
    };

    const dateToUse = endDate || instant;
    if (dateToUse) {
      const d = new Date(dateToUse);
      const month = d.getMonth() + 1;
      const year = d.getFullYear();

      let q, fy;
      if (month >= 4 && month <= 6) { q = 1; fy = year + 1; }
      else if (month >= 7 && month <= 9) { q = 2; fy = year + 1; }
      else if (month >= 10 && month <= 12) { q = 3; fy = year + 1; }
      else { q = 4; fy = year; }

      contexts[id].quarter = `FY${String(fy).slice(-2)}-Q${q}`;
      contexts[id].fy = fy;
      
      // Classify context: Consolidated, Standalone, or Segment
      const explicitMembers = $(el).find('*').filter((j, e) => e.name === 'explicitMember' || e.name.endsWith(':explicitMember'));
      
      let isConsolidated = false;
      let isSegmentOrOther = false;
      
      if (explicitMembers.length > 0) {
        explicitMembers.each((j, e) => {
          const text = $(e).text().toLowerCase();
          const dim = ($(e).attr('dimension') || '').toLowerCase();
          if (text.includes('consolidated') || dim.includes('consolidated')) {
            isConsolidated = true;
          } else {
            isSegmentOrOther = true;
          }
        });
        
        if (isConsolidated) {
          contexts[id].isConsolidated = true;
        } else if (isSegmentOrOther) {
          contexts[id].isSegment = true;
        }
      } else {
        if (filingIsConsolidated) {
          contexts[id].isConsolidated = true;
        } else {
          contexts[id].isStandalone = true;
        }
      }

      // Calculate duration in days
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
        contexts[id].days = diffDays;
        
        // Duration logic: if duration is > 105 days, it is YTD or Annual, not a single quarter
        if (diffDays > 105) {
           contexts[id].isYTD = true;
        }
      }
    }
  });

  return contexts;
}
