import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
import { pool } from '../db/pool.js';

export const AUDITED_CAPACITY_ENGINES = [
  {
    ticker: 'ANANTRAJ',
    engine_name: 'Manesar & Panchkula Data Center Capacity Expansion (300MW Pipeline)',
    engine_type: 'GREENFIELD_CAPEX',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 2500.0,
    contracted_backlog_cr: 1800.0,
    current_runrate_revenue_cr: 1800.0,
    full_capacity_revenue_cr: 4500.0,
    normalized_ebitda_margin_pct: 32.0,
    normalized_pat_margin_pct: 22.0,
    normalized_full_capacity_pat_cr: 990.0,
    target_commissioning_quarter: 'Q4_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Phase 1 21MW energized and IT load billing commenced', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Phase 2 50MW shell structure completion and power tie-up', status: 'PENDING' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Quarterly DC lease rental revenue crossing ₹150 Cr', status: 'PENDING' }
    ],
    source_rationale: 'Anant Raj concalls and disclosures confirm 300MW operational target with Phase 1 live and Phase 2 under active construction.'
  },
  {
    ticker: 'ASTRAMICRO',
    engine_name: 'HAL Uttam AESA Radar & AMCA AAAU System Integration',
    engine_type: 'ORDER_BOOK_BACKLOG',
    status: 'UNDER_CONSTRUCTION',
    unbilled_capex_cr: 150.0,
    contracted_backlog_cr: 4300.0,
    current_runrate_revenue_cr: 950.0,
    full_capacity_revenue_cr: 2200.0,
    normalized_ebitda_margin_pct: 19.5,
    normalized_pat_margin_pct: 14.0,
    normalized_full_capacity_pat_cr: 308.0,
    target_commissioning_quarter: 'Q3_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'HAL ₹2,205 Cr Uttam Radar contract formalization', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'First batch Uttam AESA radar module delivery sign-off', status: 'PENDING' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Quarterly revenue run-rate exceeding ₹350 Cr', status: 'PENDING' }
    ],
    source_rationale: 'Landmark ₹2,205 Cr HAL Uttam radar contract and AMCA AAAU program drive multi-year revenue scaling across ₹4,300 Cr order backlog.'
  },
  {
    ticker: 'CCL',
    engine_name: 'Vietnam Freeze-Dried Coffee Plant Expansion (6,000 MT)',
    engine_type: 'CAPACITY_DEBOTTLENECK',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 200.0,
    contracted_backlog_cr: 850.0,
    current_runrate_revenue_cr: 2900.0,
    full_capacity_revenue_cr: 4200.0,
    normalized_ebitda_margin_pct: 21.0,
    normalized_pat_margin_pct: 13.5,
    normalized_full_capacity_pat_cr: 567.0,
    target_commissioning_quarter: 'Q1_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Vietnam 6k MT trial run completion', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Commercial dispatches to EU private label clients', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Sustained quarterly EBITDA above ₹170 Cr', status: 'PENDING' }
    ],
    source_rationale: 'Vietnam freeze-dried coffee capacity expansion enhances premium value mix and global client wallet share.'
  },
  {
    ticker: 'ELECON',
    engine_name: 'Radicon Industrial Gearbox Global Distribution & M&A',
    engine_type: 'PLATFORM_M_AND_A',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 100.0,
    contracted_backlog_cr: 1200.0,
    current_runrate_revenue_cr: 2050.0,
    full_capacity_revenue_cr: 3000.0,
    normalized_ebitda_margin_pct: 24.0,
    normalized_pat_margin_pct: 17.0,
    normalized_full_capacity_pat_cr: 510.0,
    target_commissioning_quarter: 'Q4_FY26',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'US & European warehouse distribution tie-up', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Custom engineered gear unit export trials', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Quarterly export revenue crossing ₹200 Cr', status: 'PENDING' }
    ],
    source_rationale: 'Global Radicon brand expansion and industrial gear replacements drive international margin expansion.'
  },
  {
    ticker: 'GRAVITA',
    engine_name: 'Mundra & Overseas Circular Recycling Expansion (Lead/Alu/Plastics)',
    engine_type: 'CAPACITY_DEBOTTLENECK',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 350.0,
    contracted_backlog_cr: 1500.0,
    current_runrate_revenue_cr: 3400.0,
    full_capacity_revenue_cr: 5500.0,
    normalized_ebitda_margin_pct: 10.5,
    normalized_pat_margin_pct: 8.0,
    normalized_full_capacity_pat_cr: 440.0,
    target_commissioning_quarter: 'Q2_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Mundra rubber & plastic recycling plant operationalization', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Dominican Republic & Ghana secondary lead plant scaling', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Value-added product volume share crossing 45%', status: 'PENDING' }
    ],
    source_rationale: 'Multi-jurisdiction scrap collection network and diversified recycling streams scale volume throughput.'
  },
  {
    ticker: 'HBLENGINE',
    engine_name: 'Indian Railways KAVACH Collision Avoidance & Tonbo Defence Batteries',
    engine_type: 'ORDER_BOOK_BACKLOG',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 250.0,
    contracted_backlog_cr: 3800.0,
    current_runrate_revenue_cr: 2400.0,
    full_capacity_revenue_cr: 5000.0,
    normalized_ebitda_margin_pct: 22.0,
    normalized_pat_margin_pct: 16.0,
    normalized_full_capacity_pat_cr: 800.0,
    target_commissioning_quarter: 'Q4_FY26',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'KAVACH 4.0 railway certification and tender qualification', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Loco and station equipment delivery scale-up', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Quarterly electronics revenue crossing ₹400 Cr', status: 'PENDING' }
    ],
    source_rationale: 'Indian Railways national KAVACH mandate and critical defence battery supply provide multi-year backlog execution runway.'
  },
  {
    ticker: 'HSCL',
    engine_name: 'Sambalpur Synthetic Anode & Advanced Carbon Materials (Phase 1 20k MT)',
    engine_type: 'GREENFIELD_CAPEX',
    status: 'UNDER_CONSTRUCTION',
    unbilled_capex_cr: 1200.0,
    contracted_backlog_cr: 1100.0,
    current_runrate_revenue_cr: 4500.0,
    full_capacity_revenue_cr: 7500.0,
    normalized_ebitda_margin_pct: 20.0,
    normalized_pat_margin_pct: 13.0,
    normalized_full_capacity_pat_cr: 975.0,
    target_commissioning_quarter: 'Q4_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Land acquisition and synthetic anode pilot validation', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Phase 1 civil work completion and trial batches sent to cell makers', status: 'PENDING' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Commercial qualification and supply agreement sign-offs', status: 'PENDING' }
    ],
    source_rationale: 'India first synthetic graphite anode facility positions HSCL at the core of domestic EV and ESS battery manufacturing supply chain.'
  },
  {
    ticker: 'INOXINDIA',
    engine_name: 'Savli & Kandla Cryogenic Tank Expansion (LNG, H2, Space Payloads)',
    engine_type: 'CAPACITY_DEBOTTLENECK',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 300.0,
    contracted_backlog_cr: 1686.0,
    current_runrate_revenue_cr: 1450.0,
    full_capacity_revenue_cr: 2600.0,
    normalized_ebitda_margin_pct: 24.0,
    normalized_pat_margin_pct: 17.5,
    normalized_full_capacity_pat_cr: 455.0,
    target_commissioning_quarter: 'Q3_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Savli factory cryo trailer and tank line energization', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Kandla port-side large vessel fabrication yard audit', status: 'PENDING' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Quarterly dispatch run-rate crossing ₹450 Cr with 23%+ EBITDA', status: 'PENDING' }
    ],
    source_rationale: 'Leading global market share in cryogenic storage, LNG dispensing, and space launch vehicle fuel infrastructure.'
  },
  {
    ticker: 'JSLL',
    engine_name: 'Shuddhi Ayurvedic Hospital & Daycare Bed Capacity Scaling',
    engine_type: 'PRODUCT_LINE_TRANSITION',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 180.0,
    contracted_backlog_cr: 400.0,
    current_runrate_revenue_cr: 550.0,
    full_capacity_revenue_cr: 1200.0,
    normalized_ebitda_margin_pct: 30.0,
    normalized_pat_margin_pct: 21.0,
    normalized_full_capacity_pat_cr: 252.0,
    target_commissioning_quarter: 'Q2_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Opening of 10+ new IPD centers across Tier-1/2 cities', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'NABH accreditation for existing key facilities', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Occupancy rate >75% across mature hospitals', status: 'PENDING' }
    ],
    source_rationale: 'Expansion of integrated Ayurvedic inpatient care network driving higher average revenue per occupied bed and pharmacy margins.'
  },
  {
    ticker: 'JYOTICNC',
    engine_name: 'Aerospace & Defence 5-Axis CNC Precision Machine Scaling',
    engine_type: 'ORDER_BOOK_BACKLOG',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 250.0,
    contracted_backlog_cr: 3500.0,
    current_runrate_revenue_cr: 1600.0,
    full_capacity_revenue_cr: 3200.0,
    normalized_ebitda_margin_pct: 20.5,
    normalized_pat_margin_pct: 13.5,
    normalized_full_capacity_pat_cr: 432.0,
    target_commissioning_quarter: 'Q1_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Record order backlog validation > ₹3,000 Cr', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Rajkot expanded assembly hall commercialization', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Quarterly dispatch value crossing ₹450 Cr', status: 'PENDING' }
    ],
    source_rationale: 'High-end multi-axis CNC machine orders from aerospace, defence, and automotive precision engineering clients.'
  },
  {
    ticker: 'LUMAXTECH',
    engine_name: 'IAC India Cockpit Integration & EV Interior Systems',
    engine_type: 'PLATFORM_M_AND_A',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 220.0,
    contracted_backlog_cr: 1400.0,
    current_runrate_revenue_cr: 3100.0,
    full_capacity_revenue_cr: 4800.0,
    normalized_ebitda_margin_pct: 13.5,
    normalized_pat_margin_pct: 7.5,
    normalized_full_capacity_pat_cr: 360.0,
    target_commissioning_quarter: 'Q4_FY26',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'IAC integration cost synergies completed', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'New OEM model interior lighting & gear-shift rollout', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Consolidated EBITDA margin crossing 13%', status: 'PENDING' }
    ],
    source_rationale: 'Full cockpit and interior components portfolio enables content-per-vehicle expansion with major domestic passenger vehicle OEMs.'
  },
  {
    ticker: 'MOREPENLAB',
    engine_name: 'Baddi USFDA API Expansion & Diagnostic Point-of-Care Devices',
    engine_type: 'CAPACITY_DEBOTTLENECK',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 300.0,
    contracted_backlog_cr: 600.0,
    current_runrate_revenue_cr: 1900.0,
    full_capacity_revenue_cr: 3200.0,
    normalized_ebitda_margin_pct: 16.0,
    normalized_pat_margin_pct: 10.5,
    normalized_full_capacity_pat_cr: 336.0,
    target_commissioning_quarter: 'Q3_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'QIP capital raise ₹350 Cr allocated for capex', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Blood glucose monitor plant capacity doubling', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'US/EU API export filing approvals and commercial dispatches', status: 'PENDING' }
    ],
    source_rationale: 'Medical devices (glucometers/BP monitors) market leadership combined with expanded capacity in key bulk drugs.'
  },
  {
    ticker: 'POLICYBZR',
    engine_name: 'Corporate Health & Renewal Book Operating Leverage Platform',
    engine_type: 'PRODUCT_LINE_TRANSITION',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 150.0,
    contracted_backlog_cr: 2000.0,
    current_runrate_revenue_cr: 4500.0,
    full_capacity_revenue_cr: 8500.0,
    normalized_ebitda_margin_pct: 18.0,
    normalized_pat_margin_pct: 13.0,
    normalized_full_capacity_pat_cr: 1105.0,
    target_commissioning_quarter: 'Q4_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Core business achieves GAAP PAT profitability', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Corporate health book renewal rate >80%', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Annual free cash flow conversion > ₹800 Cr', status: 'PENDING' }
    ],
    source_rationale: 'Digital insurance penetration flywheel with expanding high-margin renewal stream and corporate employee health benefits.'
  },
  {
    ticker: 'QPOWER',
    engine_name: 'Sangli Greenfield Plant (8x High-Voltage Capacity) & Mehru Integration',
    engine_type: 'GREENFIELD_CAPEX',
    status: 'UNDER_CONSTRUCTION',
    unbilled_capex_cr: 450.0,
    contracted_backlog_cr: 1100.0,
    current_runrate_revenue_cr: 850.0,
    full_capacity_revenue_cr: 3200.0,
    normalized_ebitda_margin_pct: 24.0,
    normalized_pat_margin_pct: 16.5,
    normalized_full_capacity_pat_cr: 528.0,
    target_commissioning_quarter: 'Q3_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Sangli plant civil construction and transformer shed completion', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'High-voltage test lab accreditation & trial runs', status: 'PENDING' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Quarterly dispatch run-rate crossing ₹350 Cr with >20% EBITDA', status: 'PENDING' }
    ],
    source_rationale: 'Sangli plant 8x capacity expansion addresses high-voltage grid equipment, HVDC substations, and global renewable interconnections.'
  },
  {
    ticker: 'SBCL',
    engine_name: 'Shivalik Shunt Resistor & Smart Metering Component Capacity Leap',
    engine_type: 'CAPACITY_DEBOTTLENECK',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 120.0,
    contracted_backlog_cr: 450.0,
    current_runrate_revenue_cr: 600.0,
    full_capacity_revenue_cr: 1200.0,
    normalized_ebitda_margin_pct: 22.0,
    normalized_pat_margin_pct: 16.0,
    normalized_full_capacity_pat_cr: 192.0,
    target_commissioning_quarter: 'Q2_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Solan plant electron beam welding line expansion', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Global Tier-1 automotive qualification for EV battery management shunts', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Domestic smart meter rollout tender dispatches scaling', status: 'PENDING' }
    ],
    source_rationale: 'Precision bimetal and shunt resistor technology positioning in smart electric meters and EV battery management systems.'
  },
  {
    ticker: 'SHAKTIPUMP',
    engine_name: 'PM-KUSUM Solar Water Pumps Backlog Execution & EV Powertrains',
    engine_type: 'ORDER_BOOK_BACKLOG',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 150.0,
    contracted_backlog_cr: 2200.0,
    current_runrate_revenue_cr: 1800.0,
    full_capacity_revenue_cr: 3000.0,
    normalized_ebitda_margin_pct: 17.0,
    normalized_pat_margin_pct: 10.5,
    normalized_full_capacity_pat_cr: 315.0,
    target_commissioning_quarter: 'Q1_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'PM-KUSUM Component-B state government tender allocations', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'EV motor and controller manufacturing plant commissioning', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Receivable days reduction below 100 days with DISCOMs', status: 'PENDING' }
    ],
    source_rationale: 'Solar agricultural pump market share dominance backed by government PM-KUSUM subsidy tenders.'
  },
  {
    ticker: 'SJS',
    engine_name: 'Walter Pack & In-Mold Electronics (IME) Exterior/Interior Aesthetic Systems',
    engine_type: 'PLATFORM_M_AND_A',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 180.0,
    contracted_backlog_cr: 900.0,
    current_runrate_revenue_cr: 700.0,
    full_capacity_revenue_cr: 1400.0,
    normalized_ebitda_margin_pct: 26.5,
    normalized_pat_margin_pct: 18.0,
    normalized_full_capacity_pat_cr: 252.0,
    target_commissioning_quarter: 'Q3_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Exxpand capex facility energization', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Walter Pack optical plastics & smart surfaces commercial dispatches', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Export revenue share crossing 25%', status: 'PENDING' }
    ],
    source_rationale: 'Premium decorative aesthetics, dial faces, overlays, and smart surfaces with expanding two-wheeler and passenger vehicle OEM content.'
  },
  {
    ticker: 'SKIPPER',
    engine_name: 'Power T&D Transmission Towers High-Voltage Monopole Scaling',
    engine_type: 'ORDER_BOOK_BACKLOG',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 200.0,
    contracted_backlog_cr: 5500.0,
    current_runrate_revenue_cr: 3800.0,
    full_capacity_revenue_cr: 6200.0,
    normalized_ebitda_margin_pct: 10.5,
    normalized_pat_margin_pct: 5.5,
    normalized_full_capacity_pat_cr: 341.0,
    target_commissioning_quarter: 'Q4_FY26',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Record international order backlog validation > ₹5,000 Cr', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Power Grid 765kV transmission tower supply contract dispatches', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Operating cash flow conversion CFO/PAT > 0.70x', status: 'PENDING' }
    ],
    source_rationale: 'Global grid expansion and domestic renewable corridor transmission towers driving high revenue visibility.'
  },
  {
    ticker: 'TIMETECHNO',
    engine_name: 'Type-IV Composite Cylinders (CNG Cascades & Green H2) Capacity Expansion',
    engine_type: 'GREENFIELD_CAPEX',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 350.0,
    contracted_backlog_cr: 1200.0,
    current_runrate_revenue_cr: 5200.0,
    full_capacity_revenue_cr: 8000.0,
    normalized_ebitda_margin_pct: 15.0,
    normalized_pat_margin_pct: 8.5,
    normalized_full_capacity_pat_cr: 680.0,
    target_commissioning_quarter: 'Q2_FY27',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'PESO approval and commercial launch of Type-IV CNG cascades', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Dahej composite cylinder capacity expansion completion', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Quarterly composite cylinder revenue crossing ₹250 Cr', status: 'PENDING' }
    ],
    source_rationale: 'First-mover advantage in PESO-approved Type-IV carbon fiber composite cylinders for city gas distribution and hydrogen logistics.'
  },
  {
    ticker: 'TRANSRAILL',
    engine_name: 'Domestic 765kV T&D & International Substation EPC Execution',
    engine_type: 'ORDER_BOOK_BACKLOG',
    status: 'COMMERCIAL_BILLING',
    unbilled_capex_cr: 250.0,
    contracted_backlog_cr: 9500.0,
    current_runrate_revenue_cr: 4500.0,
    full_capacity_revenue_cr: 8000.0,
    normalized_ebitda_margin_pct: 12.0,
    normalized_pat_margin_pct: 6.5,
    normalized_full_capacity_pat_cr: 520.0,
    target_commissioning_quarter: 'Q4_FY26',
    milestone_tranches: [
      { tranche_pct: 30, phase: 'STARTER', trigger: 'Consolidated order book crossing ₹9,000 Cr', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMISSIONING', trigger: 'Silvassa conductor manufacturing facility expansion', status: 'ACHIEVED' },
      { tranche_pct: 35, phase: 'COMMERCIAL_BILLING', trigger: 'Receivable days reduction below 100 days', status: 'PENDING' }
    ],
    source_rationale: 'Integrated transmission line, substation, and railway electrification engineering with massive multi-year order backlog.'
  }
];

async function seedCapacityEngines() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('--- 🚀 Seeding Audited Portfolio Capacity Engines (20 Stocks) ---');

    for (const eng of AUDITED_CAPACITY_ENGINES) {
      await client.query(`
        INSERT INTO portfolio_capacity_engines (
          ticker, engine_name, engine_type, status,
          unbilled_capex_cr, contracted_backlog_cr, current_runrate_revenue_cr,
          full_capacity_revenue_cr, normalized_ebitda_margin_pct, normalized_pat_margin_pct,
          normalized_full_capacity_pat_cr, target_commissioning_quarter,
          milestone_tranches, source_rationale, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
        )
        ON CONFLICT (ticker, engine_name) DO UPDATE SET
          engine_type = EXCLUDED.engine_type,
          status = EXCLUDED.status,
          unbilled_capex_cr = EXCLUDED.unbilled_capex_cr,
          contracted_backlog_cr = EXCLUDED.contracted_backlog_cr,
          current_runrate_revenue_cr = EXCLUDED.current_runrate_revenue_cr,
          full_capacity_revenue_cr = EXCLUDED.full_capacity_revenue_cr,
          normalized_ebitda_margin_pct = EXCLUDED.normalized_ebitda_margin_pct,
          normalized_pat_margin_pct = EXCLUDED.normalized_pat_margin_pct,
          normalized_full_capacity_pat_cr = EXCLUDED.normalized_full_capacity_pat_cr,
          target_commissioning_quarter = EXCLUDED.target_commissioning_quarter,
          milestone_tranches = EXCLUDED.milestone_tranches,
          source_rationale = EXCLUDED.source_rationale,
          updated_at = NOW();
      `, [
        eng.ticker, eng.engine_name, eng.engine_type, eng.status,
        eng.unbilled_capex_cr, eng.contracted_backlog_cr, eng.current_runrate_revenue_cr,
        eng.full_capacity_revenue_cr, eng.normalized_ebitda_margin_pct, eng.normalized_pat_margin_pct,
        eng.normalized_full_capacity_pat_cr, eng.target_commissioning_quarter,
        JSON.stringify(eng.milestone_tranches), eng.source_rationale
      ]);
      console.log(`✅ Seeded capacity engine for ${eng.ticker}: ${eng.engine_name}`);
    }

    await client.query('COMMIT');
    console.log('🎉 Successfully seeded 20/20 portfolio capacity engines into PostgreSQL!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding capacity engines:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedCapacityEngines();
