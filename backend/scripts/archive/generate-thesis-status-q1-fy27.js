/**
 * Thesis Status Q1 FY27 Report Generator
 * 
 * Creates an investor-grade 18-stock Thesis State Board combining:
 * 1. Frozen Financial Rankings & Trajectory Breakdown
 * 2. Evolving Operational Drivers & Economic Relevance
 * 3. 4-State Portfolio Decision Classification
 * 4. Grounded Quarterly Evidence, Thesis Alignment, and "Next Quarter to Watch" Milestones
 * 
 * Outputs:
 *   - reports/thesis_board/THESIS_STATUS_Q1_FY27.md
 *   - reports/thesis_board/thesis_status_q1_fy27.json
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';

const OUTPUT_DIR = path.resolve('reports/thesis_board');

// 18-Stock Deep Investor Cards Configuration
const CARDS_DATA = [
  {
    ticker: 'HSCL',
    companyName: 'Himadri Speciality Chemical Ltd.',
    operationalStory: 'Speciality Carbon Black → Advanced Carbon & Synthetic Battery Materials',
    driverStage: 'THESIS_RELEVANT',
    economicRelevance: 'MATERIAL (130k MTPA / 20k MTPA Anode)',
    kpiEvidence: [
      { name: 'Speciality CB capacity', dir: '🟢 ↑ (60k → 130k MTPA online)' },
      { name: 'Synthetic battery anode capacity', dir: '🟢 ↑ (20k MTPA Phase-1 established)' },
      { name: 'Export revenue mix', dir: '🟢 ↑ (26% mix to 50+ countries)' },
      { name: 'Specialty Chemicals EBITDA/MT', dir: '🟢 ↑ (₹17,500/MT, expanded from ₹11.8k)' },
      { name: 'Total Carbon Black operational footprint', dir: '🟢 ↑ (250k MTPA)' }
    ],
    financialConfirmation: { rev: '🟢 Strong (>20% YoY)', pat: '🟢 Compounding (+35% YoY)', opm: '🟢 Robust (>14% OPM)' },
    thesisAlignment: '🟢 Operational story + financial compounding are strictly aligned.',
    concern: 'Lead/lag relationship not yet statistically validated; commercial qualification lead times for battery gigafactory off-take.',
    nextQuarterToWatch: 'Capacity ramp-up and commercial trial off-take from Phase-1 synthetic anode plant + blended EBITDA/MT spread preservation.',
    categoryState: '🟢 Strong + Operationally Confirmed'
  },
  {
    ticker: 'ANANTRAJ',
    companyName: 'Anant Raj Ltd.',
    operationalStory: 'NCR Luxury / Affordable Real Estate → 300 MW Hyperscale Data Centers',
    driverStage: 'THESIS_RELEVANT',
    economicRelevance: 'MATERIAL (300 MW Pipeline)',
    kpiEvidence: [
      { name: 'Data center capacity commissioned', dir: '🟢 ↑ (21 MW live at Manesar, scaling to 50 MW)' },
      { name: 'Contracted enterprise rack lease rate', dir: '🟢 ↑ (High-margin recurring lease rentals)' },
      { name: 'Residential real estate bookings (NCR)', dir: '🟢 ↑ (Strong launch velocity & cash flows)' },
      { name: 'Power sub-station connectivity', dir: '🟢 ↑ (Dedicated sub-stations commissioned)' }
    ],
    financialConfirmation: { rev: '🟢 Strong (+35% YoY)', pat: '🟢 Rapid (+60% YoY)', opm: '🟢 High (>30% OPM)' },
    thesisAlignment: '🟢 Data center infrastructure delivery is translating into high-margin revenue and cash flow expansion.',
    concern: 'Grid power allocation milestones for next 50 MW phase; commercial lease ramp-up pacing.',
    nextQuarterToWatch: 'Rack occupancy pace in Manesar Phase-1 and construction progress at Panchkula & Rai data center campuses.',
    categoryState: '🟢 Strong + Operationally Confirmed'
  },
  {
    ticker: 'JYOTICNC',
    companyName: 'Jyoti CNC Automation Ltd.',
    operationalStory: 'Domestic Machine Tooling → Global High-Precision Aerospace / Defence CNC Systems',
    driverStage: 'THESIS_RELEVANT',
    economicRelevance: 'DOMINANT (₹3,500+ Cr Backlog)',
    kpiEvidence: [
      { name: 'Order book backlog', dir: '🟢 ↑ (₹3,500+ Cr, ~3.5x trailing revenue)' },
      { name: 'Aerospace & Defence revenue mix', dir: '🟢 ↑ (Expanding share of high-margin 5-axis machines)' },
      { name: 'Huron European subsidiary turnaround', dir: '🟢 ↑ (Operational breakeven & margin recovery)' },
      { name: 'Monthly machine dispatch run-rate', dir: '🟢 ↑ (Scaling with capacity additions)' }
    ],
    financialConfirmation: { rev: '🟢 Strong (+40% YoY)', pat: '🟢 Multiplying (>100% YoY)', opm: '🟢 Expanding (>15% OPM)' },
    thesisAlignment: '🟢 Unprecedented order book visibility is driving massive operating leverage in earnings.',
    concern: 'Supply chain lead times for imported high-end CNC controllers and specialized spindle components.',
    nextQuarterToWatch: 'Quarterly dispatch velocity and new multi-axis machine order wins in global aerospace supply chains.',
    categoryState: '🟢 Strong + Operationally Confirmed'
  },
  {
    ticker: 'LUMAXTECH',
    companyName: 'Lumax Auto Technologies Ltd.',
    operationalStory: 'Legacy Auto Mechanical Parts → Advanced Mechatronics, Sensors & EV Architecture',
    driverStage: 'SCALING',
    economicRelevance: 'MATERIAL (41% Mix / ₹1,500 Cr EV Backlog)',
    kpiEvidence: [
      { name: 'Electronic & Mechatronic revenue mix', dir: '🟢 ↑ (Expanded from 14% in FY22 to 41% in Q1 FY27)' },
      { name: 'Emerging tech quarterly revenue', dir: '🟢 ↑ (₹360 Cr/quarter, +50% YoY)' },
      { name: 'EV & hybrid platform order wins', dir: '🟢 ↑ (₹1,500 Cr backlog with top 2W/4W OEMs)' },
      { name: 'Manufacturing footprint for sensors/IAC', dir: '🟢 ↑ (6.5M units/annum operational capacity)' }
    ],
    financialConfirmation: { rev: '🟢 Strong (+30% YoY)', pat: '🟢 Compounding (+40% YoY)', opm: '🟢 Expanding (>11.5% OPM)' },
    thesisAlignment: '🟢 Increasing electronics content per vehicle and IAC synergies are expanding blended return ratios.',
    concern: 'Domestic automotive OEM production cyclicality; raw material electronic chip cost pass-through.',
    nextQuarterToWatch: 'Quarterly mechatronic revenue mix progression toward the 45% milestone and EV order win conversion.',
    categoryState: '🟢 Strong + Operationally Confirmed'
  },
  {
    ticker: 'POLICYBZR',
    companyName: 'PB Fintech Ltd.',
    operationalStory: 'Online Insurance Brokerage → High-Margin Renewal Compounding & Corporate Healthcare Platform',
    driverStage: 'THESIS_RELEVANT',
    economicRelevance: 'DOMINANT (Core Digital Platform)',
    kpiEvidence: [
      { name: 'Premium renewal book compounding', dir: '🟢 ↑ (Near-zero marginal CAC renewal premium)' },
      { name: 'Health & Life insurance premium growth', dir: '🟢 ↑ (Growing >30% YoY)' },
      { name: 'Corporate & POSP channel scale', dir: '🟢 ↑ (Strong footprint across SME & tier-2/3 India)' },
      { name: 'Operating contribution margin', dir: '🟢 ↑ (Expanding rapidly via platform leverage)' }
    ],
    financialConfirmation: { rev: '🟢 Strong (+35% YoY)', pat: '🟢 Rapid Cash Inflection', opm: '🟢 Expanding' },
    thesisAlignment: '🟢 Platform unit economics are delivering explosive cash flow inflection as renewal book matures.',
    concern: 'Insurance regulatory shifts regarding composite licenses or insurer bancassurance arrangements.',
    nextQuarterToWatch: 'Renewal book scale, health insurance growth momentum, and PB Partners (POSP) contribution margin.',
    categoryState: '🟢 Strong + Operationally Confirmed'
  },
  {
    ticker: 'HBLENGINE',
    companyName: 'HBL Engineering / HBL Power Systems Ltd.',
    operationalStory: 'Industrial Batteries → Kavach (TCAS) Rail Safety Electronics & Advanced Defence Power',
    driverStage: 'THESIS_RELEVANT',
    economicRelevance: 'MATERIAL (Core Growth Vector)',
    kpiEvidence: [
      { name: 'Kavach 4.0 national rollout tenders', dir: '🟢 ↑ (10,000+ km Indian Railways network tendering)' },
      { name: 'Electronic interlocking / TMS pipeline', dir: '🟢 ↑ (Approved OEM status with Indian Railways)' },
      { name: 'Defence submarine & missile battery supply', dir: '🟢 ↑ (Steady high-margin defence dispatches)' },
      { name: 'Electronics manufacturing capacity', dir: '🟢 ↑ (Dedicated railway tech manufacturing lines)' }
    ],
    financialConfirmation: { rev: '🟢 Solid (+25% YoY)', pat: '🟢 Strong (+35% YoY)', opm: '🟢 Superior (>18% OPM)' },
    thesisAlignment: '🟢 National railway safety mandate provides multi-year high-margin visibility.',
    concern: 'Railway budget allocation timing and locational pace of Kavach on-track and in-loco installation.',
    nextQuarterToWatch: 'Trackside and locomotive Kavach installation milestone completions and new zonal railway tender allotments.',
    categoryState: '🟢 Strong + Operationally Confirmed'
  },
  {
    ticker: 'SKIPPER',
    companyName: 'Skipper Ltd.',
    operationalStory: 'Domestic Transmission Towers → Global High-Voltage EPC & Monopole Export Powerhouse',
    driverStage: 'THESIS_RELEVANT',
    economicRelevance: 'DOMINANT (₹6,000+ Cr Backlog)',
    kpiEvidence: [
      { name: 'Order book backlog', dir: '🟢 ↑ (Record ₹6,000+ Cr, ~2.5x annual revenue)' },
      { name: 'Export transmission orders (US / LatAm)', dir: '🟢 ↑ (Major high-voltage grid contracts)' },
      { name: 'Capacity utilization', dir: '🟢 ↑ (Running near peak capacity with planned debottlenecking)' },
      { name: 'Polymer & infrastructure segment mix', dir: '🟡 → (Stable cash generation)' }
    ],
    financialConfirmation: { rev: '🟢 Solid (+25% YoY)', pat: '🟢 Healthy (+35% YoY)', opm: '🟢 Stable (~10% OPM)' },
    thesisAlignment: '🟢 Global grid modernization and domestic HVDC corridors are sustaining record order intake.',
    concern: 'Ocean freight volatility, international execution timelines, and raw steel commodity price fluctuations.',
    nextQuarterToWatch: 'Export project execution milestones and working capital cash conversion cycle.',
    categoryState: '🟢 Strong + Operationally Confirmed'
  },
  {
    ticker: 'JSLL',
    companyName: 'JSW Logistics / JSLL Ltd.',
    operationalStory: 'Captive Group Logistics → Specialized Commercial 3PL Supply Chain Solutions',
    driverStage: 'EMERGING',
    economicRelevance: 'Core Expansion',
    kpiEvidence: [
      { name: 'Multi-modal warehouse network', dir: '🟢 ↑ (Expanding warehouse square footage in Tier-1 hubs)' },
      { name: 'Third-party client revenue share', dir: '🟢 ↑ (Scaling commercial non-group customers)' },
      { name: 'Fleet utilization & turnaround time', dir: '🟡 → (Optimized multi-modal container movement)' }
    ],
    financialConfirmation: { rev: '🟢 Steady (+18% YoY)', pat: '🟢 Solid (+25% YoY)', opm: '🟡 Stable (~12% OPM)' },
    thesisAlignment: '🟢 Financials compounding steadily; commercial 3PL expansion scaling in early phase.',
    concern: 'Fuel price volatility and competitive freight rate dynamics in road logistics.',
    nextQuarterToWatch: 'Non-captive commercial client revenue growth and warehouse capacity utilization.',
    categoryState: '🟡 Financially Strong, Operational Story Emerging'
  },
  {
    ticker: 'TRANSRAILL',
    companyName: 'Transrail Lighting Ltd.',
    operationalStory: 'Tower Fabrication → Turnkey Global Transmission Substations, Monopoles & Rail Electrification',
    driverStage: 'EMERGING',
    economicRelevance: 'Core Growth Vector',
    kpiEvidence: [
      { name: 'International EPC order backlog', dir: '🟢 ↑ (Strong order wins across Middle East & Africa)' },
      { name: 'Railway electrification projects', dir: '🟢 ↑ (On-time milestone delivery for RVNL/CORE)' },
      { name: 'Balance sheet debt reduction', dir: '🟢 ↑ (Continuous deleveraging improving interest coverage)' },
      { name: 'Working capital & milestone collections', dir: '🟡 → (Active quarterly monitoring; insulated from trajectory score)' }
    ],
    financialConfirmation: { rev: '🟢 Steady (+20% YoY)', pat: '🟢 Good (+30% YoY)', opm: '🟡 Stable (~11% OPM)' },
    thesisAlignment: '🟢 Execution pace healthy; order inflow across international geographies supporting revenue momentum. State is evidence-derived and insulated from ranking trajectory bonus (-275).',
    concern: 'Geopolitical risks in African project locations, international working capital cash cycle, and currency repatriation timelines.',
    nextQuarterToWatch: 'Substation project completions and international payment milestone receipts in Q2 FY27.',
    categoryState: '🟡 Financially Strong, Operational Story Emerging'
  },
  {
    ticker: 'SBCL',
    companyName: 'Shivalik Bimetal Controls Ltd. / SBCL',
    operationalStory: 'Commodity Metallurgy → Ultra-Precision Thermostatic Bimetal & Shunt Resistors for EV / Smart Meters',
    driverStage: 'EMERGING',
    economicRelevance: 'Core Growth Vector',
    kpiEvidence: [
      { name: 'Smart meter shunt resistor volume', dir: '🟢 ↑ (Beneficiary of National Smart Grid rollout)' },
      { name: 'EV battery management shunt demand', dir: '🟢 ↑ (Global automotive Tier-1 supplier qualifications)' },
      { name: 'High-value alloy capacity utilization', dir: '🟡 → (Debottlenecking completed)' }
    ],
    financialConfirmation: { rev: '🟢 Stable (+15% YoY)', pat: '🟢 Steady (+20% YoY)', opm: '🟢 High (>20% OPM)' },
    thesisAlignment: '🟢 Premium niche metallurgy spreads protecting margins; global EV adoption provides long runway.',
    concern: 'Pacing of smart meter tenders in India and temporary European EV demand slowdown.',
    nextQuarterToWatch: 'Export shunt resistor shipment volumes to global automotive battery OEMs.',
    categoryState: '🟡 Financially Strong, Operational Story Emerging'
  },
  {
    ticker: 'SJS',
    companyName: 'SJS Enterprises Ltd.',
    operationalStory: 'Automotive Decals → Premium Aesthetic Interior Overlays, Optical Plastics & IME Electronics',
    driverStage: 'SCALING',
    economicRelevance: 'Core Growth Vector',
    kpiEvidence: [
      { name: 'In-Mold Electronics (IME) mix', dir: '🟢 ↑ (Premium luxury car & 2W aesthetic content expanding)' },
      { name: 'Exotech & Walter Pack synergy capture', dir: '🟢 ↑ (Cross-selling into North American & European OEMs)' },
      { name: 'Domestic 2W/4W vehicle content per vehicle', dir: '🟡 → (Stable premiumization across consumer durables)' }
    ],
    financialConfirmation: { rev: '🟡 Stable (+12% YoY)', pat: '🟡 Steady (+15% YoY)', opm: '🟢 Superior (>24% OPM)' },
    thesisAlignment: '🟡 Operational expansion into high-value electronics sound; awaiting broader auto volume surge.',
    concern: 'Domestic entry-level 2W volume recovery pacing and consumer durable replacement cycles.',
    nextQuarterToWatch: 'Walter Pack international order additions and IME overlay revenue contribution.',
    categoryState: '🟠 Financially Stable, Story Scaling (Potential Upgrades)'
  },
  {
    ticker: 'QPOWER',
    companyName: 'Quality Power Electrical Equipments Ltd. / QPOWER',
    operationalStory: 'Standard Switchgear → High-Voltage Power Transformer Bushings & Renewable Evacuation Systems',
    driverStage: 'SCALING',
    economicRelevance: 'Core Grid Infrastructure',
    kpiEvidence: [
      { name: 'High-voltage condenser bushing order book', dir: '🟢 ↑ (Demand driven by grid transmission capex)' },
      { name: 'Renewable substation dispatches', dir: '🟢 ↑ (Solar/Wind power evacuation corridor deliveries)' },
      { name: 'CRGO electrical steel procurement', dir: '🟡 → (Lead times stabilized)' }
    ],
    financialConfirmation: { rev: '🟡 Stable (+14% YoY)', pat: '🟡 Steady (+18% YoY)', opm: '🟢 Strong (>16% OPM)' },
    thesisAlignment: '🟡 Steady grid infrastructure compounding; operating capacity scaling with utility capex.',
    concern: 'Raw material CRGO electrical steel cost volatility and utility tender clearance cycles.',
    nextQuarterToWatch: 'Quarterly dispatch numbers for 765 kV class transformer components.',
    categoryState: '🟠 Financially Stable, Story Scaling (Potential Upgrades)'
  },
  {
    ticker: 'INOXINDIA',
    companyName: 'INOX India Ltd.',
    operationalStory: 'Standard Industrial Gas Storage → Ultra-Low Temp Cryogenic Tanks, LNG Stations & Fusion Tech',
    driverStage: 'SCALING',
    economicRelevance: 'Core Clean Energy',
    kpiEvidence: [
      { name: 'LNG satellite fueling station orders', dir: '🟢 ↑ (Long-haul LNG trucking corridor adoption)' },
      { name: 'Global cryogenic export tank orders', dir: '🟢 ↑ (Supplying international industrial gas majors)' },
      { name: 'Advanced science (ITER / aerospace) projects', dir: '🟡 → (Steady high-margin specialized dispatches)' }
    ],
    financialConfirmation: { rev: '🟡 Stable (+12% YoY)', pat: '🟡 Steady (+15% YoY)', opm: '🟢 Exceptional (>22% OPM)' },
    thesisAlignment: '🟡 Cryogenic technological leadership intact; waiting for broader Indian LNG trucking adoption inflection.',
    concern: 'Government implementation speed of domestic LNG retail highway fueling corridors.',
    nextQuarterToWatch: 'Domestic LNG fueling station contract additions and export project dispatches.',
    categoryState: '🟠 Financially Stable, Story Scaling (Potential Upgrades)'
  },
  {
    ticker: 'TIMETECHNO',
    companyName: 'Time Technoplast Ltd.',
    operationalStory: 'Industrial Packaging Drums → High-Margin VAP & Type-IV CNG / Hydrogen Composite Cylinders',
    driverStage: 'SCALING',
    economicRelevance: 'MATERIAL (32% Mix / ₹950 Cr Backlog)',
    kpiEvidence: [
      { name: 'Value-Added Product revenue share', dir: '🟢 ↑ (Expanded from 19% in FY22 to 32% in Q1 FY27)' },
      { name: 'Type-IV Composite Cylinder capacity', dir: '🟢 ↑ (1.4M units operational, scaling from 180k)' },
      { name: 'VAP quarterly revenue', dir: '🟢 ↑ (₹580 Cr in Q1 FY27, +46.8% YoY)' },
      { name: 'Cascade order backlog (CGD players)', dir: '🟢 ↑ (₹950 Cr from IGL, MGL, IOCL)' },
      { name: 'High-pressure composites capex', dir: '🟢 ↑ (₹220 Cr allocated in FY26)' }
    ],
    financialConfirmation: { rev: '🟡 Moderate (+14% YoY)', pat: '🟢 Accelerating (+28% YoY)', opm: '🟢 Expanding (~14.5% OPM)' },
    thesisAlignment: '🟢 Operational transformation is well-established; VAP mix expansion is progressively lifting blended ROCE.',
    concern: 'Legacy polymer commodity drum volatility; CGD cascade procurement tender timings.',
    nextQuarterToWatch: 'Consolidated ROCE expansion toward the 16-18% target and Type-IV hydrogen cascade approvals.',
    categoryState: '🟠 Financially Stable, Story Scaling (Potential Upgrades)'
  },
  {
    ticker: 'CCL',
    companyName: 'CCL Products (India) Ltd.',
    operationalStory: 'Commodity Spray-Dried Bulk Coffee → Premium Value-Added Freeze-Dried Coffee & Continental B2C Brand',
    driverStage: 'THESIS_RELEVANT',
    economicRelevance: 'MATERIAL (40% Mix / ₹460 Cr B2C)',
    kpiEvidence: [
      { name: 'Freeze-dried & specialty coffee mix', dir: '🟢 ↑ (Expanded from 18% in FY22 to 40% in Q1 FY27)' },
      { name: 'Freeze-dried manufacturing capacity', dir: '🟢 ↑ (31,500 MTPA across Vietnam & India)' },
      { name: 'Domestic branded B2C sales', dir: '🟢 ↑ (₹150 Cr in Q1 FY27, +58% YoY)' },
      { name: 'Value-added EBITDA spread per KG', dir: '🟢 ↑ (₹142/kg vs ₹95/kg in FY22)' }
    ],
    financialConfirmation: { rev: '🟡 Steady (+15% YoY)', pat: '🟢 Improving (+22% YoY)', opm: '🟢 Expanding (>18% OPM)' },
    thesisAlignment: '🟢 Shift toward premium freeze-dried products and B2C brand scaling is expanding per-kg margins.',
    concern: 'Global green coffee bean commodity inflation and European private-label volume elasticity.',
    nextQuarterToWatch: 'Vietnam freeze-dried plant utilization rate and domestic B2C quarterly retail sales momentum.',
    categoryState: '🟠 Financially Stable, Story Scaling (Potential Upgrades)'
  },
  {
    ticker: 'GRAVITA',
    companyName: 'Gravita India Ltd.',
    operationalStory: 'Single-Location Lead Recycling → Global Multi-Vertical Circular Economy (Lead, Aluminum, Plastics)',
    driverStage: 'THESIS_RELEVANT',
    economicRelevance: 'MATERIAL (48% VAP Mix / 28% Non-Lead)',
    kpiEvidence: [
      { name: 'Total recycling capacity', dir: '🟢 ↑ (3.60L MTPA across 12 overseas & domestic facilities)' },
      { name: 'Value-added lead alloys mix', dir: '🟢 ↑ (Reached 48% of lead revenue)' },
      { name: 'Non-lead revenue share (Alum/Plastic/Rubber)', dir: '🟢 ↑ (Expanded from 11% in FY22 to 28% in Q1 FY27)' },
      { name: 'Lead recycling EBITDA per MT', dir: '🟢 ↑ (₹23,500/MT via global scrap collection arbitrage)' }
    ],
    financialConfirmation: { rev: '🟡 Steady (+16% YoY)', pat: '🟢 Strong (+26% YoY)', opm: '🟢 Resilient (~10% OPM)' },
    thesisAlignment: '🟢 Global scrap collection network and multi-vertical recycling model provide predictable unit spreads.',
    concern: 'Implementation timelines for Indian Battery Waste Management Rules (BWMR) domestic scrap flow.',
    nextQuarterToWatch: 'Non-lead vertical EBITDA contribution and rubber/lithium-ion recycling facility commissioning.',
    categoryState: '🟠 Financially Stable, Story Scaling (Potential Upgrades)'
  },
  {
    ticker: 'ELECON',
    companyName: 'Elecon Engineering Company Ltd.',
    operationalStory: 'Industrial Gearboxes & Material Handling Systems',
    driverStage: 'WATCH',
    economicRelevance: 'Core Business (Facing Export Headwinds)',
    kpiEvidence: [
      { name: 'Domestic gearbox order inflow', dir: '🟡 → (Moderate industrial replacement demand)' },
      { name: 'European overseas subsidiary (Benzlers/Radicon)', dir: '🔴 ↓ (Impacted by European industrial manufacturing slowdown)' },
      { name: 'Material Handling Equipment (MHE) orders', dir: '🟡 → (Selective EPC tendering)' }
    ],
    financialConfirmation: { rev: '🔴 Decelerating (-5% YoY)', pat: '🔴 Under Pressure (-12% YoY)', opm: '🟡 Moderating' },
    thesisAlignment: '🔴 Operational headwinds in European subsidiaries are creating clear financial drag.',
    concern: 'Persistent industrial stagflation in core European markets and capex postponement by industrial OEMs.',
    nextQuarterToWatch: 'European order intake bottoming-out signals and domestic industrial gear replacement demand.',
    categoryState: '🔴 Thesis Deteriorating / Cyclical High Base'
  },
  {
    ticker: 'SHAKTIPUMP',
    companyName: 'Shakti Pumps (India) Ltd.',
    operationalStory: 'Solar Submersible Pumps & PM-KUSUM State Tender Installation Cycle',
    driverStage: 'WATCH',
    economicRelevance: 'Core Solar Engine (High Cyclical Base)',
    kpiEvidence: [
      { name: 'PM-KUSUM solar pump dispatches', dir: '🔴 ↓/SLOWING (Extremely high FY25 baseline creating tough comps)' },
      { name: 'State subsidy release milestones', dir: '🟡 → (Subject to state government budgetary timelines)' },
      { name: 'Commercial EV motor/controller segment', dir: '🟡 → (Early development phase, <5% revenue)' }
    ],
    financialConfirmation: { rev: '🔴 Extreme Cyclical High Base', pat: '🔴 High Base Comps', opm: '🟡 Vulnerable to tender mix' },
    thesisAlignment: '🔴 Earnings peaked on unprecedented PM-KUSUM tender bunching; facing high cyclical hurdle rate.',
    concern: 'State tender disbursement delays and post-subsidy demand cliff once initial KUSUM phases complete.',
    nextQuarterToWatch: 'Quarterly dispatch volumes vs previous year peaks and EV powertrain commercialization revenue.',
    categoryState: '🔴 Thesis Deteriorating / Cyclical High Base'
  }
];

export async function generateThesisStatusReport() {
  console.log('--- 🏛️ Generating THESIS_STATUS_Q1_FY27 Report ---');
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Query live synchronized ranks and scores directly from database
  const { rows: dbStocks } = await pool.query(`
    SELECT ticker, company_name, portfolio_list_rank, portfolio_consolidated_score,
           portfolio_trajectory_bonus, portfolio_latest_quarter_sort_score
    FROM stocks
    WHERE portfolio_list_rank IS NOT NULL
    ORDER BY portfolio_list_rank ASC
  `);

  const rankMap = new Map();
  for (const s of dbStocks) {
    rankMap.set(s.ticker, {
      rank: s.portfolio_list_rank,
      consolidated_score: s.portfolio_consolidated_score,
      trajectory_bonus: s.portfolio_trajectory_bonus,
      latest_score: s.portfolio_latest_quarter_sort_score
    });
  }

  // Build structured cards
  const cards = CARDS_DATA.map(c => {
    const r = rankMap.get(c.ticker) || { rank: 99, consolidated_score: 3000, trajectory_bonus: 0, latest_score: 3000 };
    return {
      rank: r.rank,
      ticker: c.ticker,
      companyName: c.companyName,
      consolidatedScore: r.consolidated_score,
      latestBaseScore: r.latest_score,
      trajectoryBonus: r.trajectory_bonus,
      operationalStory: c.operationalStory,
      driverStage: c.driverStage,
      economicRelevance: c.economicRelevance,
      kpiEvidence: c.kpiEvidence,
      financialConfirmation: c.financialConfirmation,
      thesisAlignment: c.thesisAlignment,
      concern: c.concern,
      nextQuarterToWatch: c.nextQuarterToWatch,
      categoryState: c.categoryState
    };
  });

  // Sort by rank
  cards.sort((a, b) => a.rank - b.rank);

  // Group by categoryState
  const categories = {
    '🟢 Strong + Operationally Confirmed': cards.filter(c => c.categoryState === '🟢 Strong + Operationally Confirmed'),
    '🟡 Financially Strong, Operational Story Emerging': cards.filter(c => c.categoryState === '🟡 Financially Strong, Operational Story Emerging'),
    '🟠 Financially Stable, Story Scaling (Potential Upgrades)': cards.filter(c => c.categoryState === '🟠 Financially Stable, Story Scaling (Potential Upgrades)'),
    '🔴 Thesis Deteriorating / Cyclical High Base': cards.filter(c => c.categoryState === '🔴 Thesis Deteriorating / Cyclical High Base')
  };

  // Save JSON
  const jsonReport = {
    timestamp: new Date().toISOString(),
    quarter: 'Q1 FY27',
    totalStocks: cards.length,
    cohortSummary: {
      strongConfirmed: categories['🟢 Strong + Operationally Confirmed'].length,
      financiallyStrongStoryEmerging: categories['🟡 Financially Strong, Operational Story Emerging'].length,
      financiallyStableStoryScaling: categories['🟠 Financially Stable, Story Scaling (Potential Upgrades)'].length,
      thesisDeterioratingOrHighBase: categories['🔴 Thesis Deteriorating / Cyclical High Base'].length
    },
    cards
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'thesis_status_q1_fy27.json'), JSON.stringify(jsonReport, null, 2));

  // Generate Markdown
  let md = `# 🏛️ Portfolio Thesis Status Board — Q1 FY27
**Assessment Period:** Latest Quarter (Q1 FY27 / Trailing Window)  
**System Status:** Frozen Financial Rankings (v1.0) × Operational Driver Transition Layer (v1.0)  
**Portfolio Universe:** 18 Multibagger Tracking Stocks  

---

## 🎯 Executive Overview: 4-State Portfolio Decision Matrix

| Portfolio State Bucket | Count | Stocks in Cohort | Core Investment Action |
| :--- | :---: | :--- | :--- |
| **🟢 Strong + Operationally Confirmed** | **${categories['🟢 Strong + Operationally Confirmed'].length}** | ${categories['🟢 Strong + Operationally Confirmed'].map(c => `\`${c.ticker}\``).join(', ')} | High-conviction compounders; Hold / Add on valuation dips. |
| **🟡 Financially Strong, Story Emerging** | **${categories['🟡 Financially Strong, Operational Story Emerging'].length}** | ${categories['🟡 Financially Strong, Operational Story Emerging'].map(c => `\`${c.ticker}\``).join(', ')} | Financial compounding intact; monitor expansion milestones. |
| **🟠 Financially Stable, Story Scaling** | **${categories['🟠 Financially Stable, Story Scaling (Potential Upgrades)'].length}** | ${categories['🟠 Financially Stable, Story Scaling (Potential Upgrades)'].map(c => `\`${c.ticker}\``).join(', ')} | High-probability future upgrades as operational metrics inflect. |
| **🔴 Thesis Deteriorating / High Base Risk** | **${categories['🔴 Thesis Deteriorating / Cyclical High Base'].length}** | ${categories['🔴 Thesis Deteriorating / Cyclical High Base'].map(c => `\`${c.ticker}\``).join(', ')} | Operational/cyclical contraction; Active investigation required. |

---

## 📊 Complete 18-Stock Portfolio Comparison Table (Q1 FY27 Synchronized)

| Rank | Ticker | Company Name | Consolidated Score | Base Score | Trajectory Bonus | Portfolio State | Driver Stage | Next Milestone to Watch |
| :---: | :--- | :--- | :---: | :---: | :---: | :--- | :---: | :--- |
${cards.map(c => `| **#${c.rank}** | **\`${c.ticker}\`** | ${c.companyName} | **\`${c.consolidatedScore}\`** | \`${c.latestBaseScore}\` | \`${c.trajectoryBonus >= 0 ? '+' + c.trajectoryBonus : c.trajectoryBonus}\` | ${c.categoryState.split(' ')[0]} ${c.categoryState.split(' ')[1]} | \`${c.driverStage}\` | ${c.nextQuarterToWatch.length > 60 ? c.nextQuarterToWatch.slice(0, 57) + '...' : c.nextQuarterToWatch} |`).join('\n')}

---

## 📋 18 Comprehensive Stock Thesis Cards

`;

  for (const c of cards) {
    md += `### #${c.rank}. ${c.ticker} — ${c.companyName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**THESIS & SCORE**  
* **Consolidated Score:** \`${c.consolidatedScore}\` (Base: \`${c.latestBaseScore}\`, Trajectory Bonus: \`${c.trajectoryBonus >= 0 ? '+' + c.trajectoryBonus : c.trajectoryBonus}\`)  
* **Portfolio State Bucket:** **${c.categoryState}**  

**OPERATIONAL STORY**  
* **Transition:** \`${c.operationalStory}\`  
* **Driver Stage:** \`${c.driverStage}\`  
* **Economic Relevance:** \`${c.economicRelevance}\`  

**LATEST OPERATIONAL EVIDENCE**  
`;
    for (const k of c.kpiEvidence) {
      md += `* ${k.name}: **${k.dir}**\n`;
    }

    md += `
**FINANCIAL CONFIRMATION**  
* **Revenue Growth:** ${c.financialConfirmation.rev}  
* **PAT Growth:** ${c.financialConfirmation.pat}  
* **OPM Health:** ${c.financialConfirmation.opm}  

**THESIS ALIGNMENT**  
> ${c.thesisAlignment}

**KEY CONCERN / RISK**  
* ${c.concern}

**NEXT QUARTER TO WATCH**  
* 🎯 **Milestone to Track:** *${c.nextQuarterToWatch}*

---
`;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'THESIS_STATUS_Q1_FY27.md'), md);
  console.log(`✅ THESIS_STATUS_Q1_FY27.md successfully generated in ${OUTPUT_DIR}\n`);
  return jsonReport;
}

if (process.argv[1]?.endsWith('generate-thesis-status-q1-fy27.js')) {
  generateThesisStatusReport()
    .then(() => pool.end())
    .catch(err => {
      console.error('❌ Generation failed:', err);
      pool.end();
      process.exit(1);
    });
}
