/**
 * Regional packs.
 *
 * The same design is not buildable everywhere. Truss stock differs by market,
 * so does mains voltage, so do the units people work in, and so — critically —
 * do the rules an inspector will apply on site. A plan that says "compliant"
 * without saying compliant *where* is worthless.
 *
 * So every plan carries a region code, and this module is what that code
 * resolves to: measurement, power, standard sections, materials that are
 * actually available locally, and the regulatory figures the layout assistant
 * checks against. Adding a market is adding one entry here.
 */
import type { TrussRegion } from './truss.js';
import type { UnitSystem } from './units.js';

export interface RegulatoryOverlay {
  /** What the rules are called, so a finding can name its source. */
  authority: string;
  /** Escape width per 100 occupants, in millimetres. */
  exitWidthPer100Mm: number;
  /** Absolute minimum clear escape width. */
  minExitWidthMm: number;
  /** Maximum travel distance to an exit with one direction available. */
  maxTravelSingleMm: number;
  /** Maximum travel distance with two directions available. */
  maxTravelDualMm: number;
  /** Occupancy above which two independent exits are required. */
  twoExitsAbove: number;
  /** Minimum aisle between exhibition stands. */
  minAisleMm: number;
  /** Default organiser height limit for a stand. */
  standHeightLimitMm: number;
  /** Whether a build over this height typically needs structural sign-off. */
  structuralSignOffAboveMm: number;
  /** Notes a planner should read before quoting in this market. */
  notes: string[];
}

export interface RegionPack {
  code: string;
  label: string;
  /** Countries the pack is written for. */
  countries: string[];
  units: UnitSystem;
  currency: string;
  /** Mains voltage and frequency, which decide fixture and LED power figures. */
  voltage: number;
  frequency: 50 | 60;
  /** Three-phase line voltage. */
  voltage3ph: number;
  /** Truss families stocked here. */
  trussRegion: TrussRegion;
  /** Standard exhibition module. */
  boothModuleMm: { width: number; depth: number };
  /** Standard staging deck module. */
  stageDeckMm: number;
  /** Common wall and drape heights. */
  standardWallHeightMm: number;
  /** Materials genuinely available locally, in the order a contractor reaches for them. */
  materials: string[];
  regulations: RegulatoryOverlay;
  /** Rough cost index against the default rate card, in basis points. */
  costIndexBp: number;
}

/**
 * The markets the brief names — Kenya, the UAE and India — plus the three the
 * platform will be compared against. Each is written from what a contractor in
 * that market actually stocks and is inspected on, rather than from a generic
 * international standard nobody applies locally.
 */
export const REGION_PACKS: RegionPack[] = [
  {
    code: 'global',
    label: 'Global (generic)',
    countries: [],
    units: 'metric',
    currency: 'usd',
    voltage: 230,
    frequency: 50,
    voltage3ph: 400,
    trussRegion: 'global',
    boothModuleMm: { width: 3000, depth: 3000 },
    stageDeckMm: 2000,
    standardWallHeightMm: 2500,
    materials: ['Tensioned fabric (SEG)', 'Modular system extrusion', 'Painted MDF', 'Printed vinyl', 'Plywood'],
    regulations: {
      authority: 'Generic international practice',
      exitWidthPer100Mm: 500,
      minExitWidthMm: 1050,
      maxTravelSingleMm: 18_000,
      maxTravelDualMm: 45_000,
      twoExitsAbove: 60,
      minAisleMm: 3000,
      standHeightLimitMm: 4000,
      structuralSignOffAboveMm: 4000,
      notes: [
        'These are widely used rules of thumb, not any one jurisdiction. Confirm against the venue and the local authority before committing.',
      ],
    },
    costIndexBp: 10_000,
  },
  {
    code: 'kenya',
    label: 'Kenya & East Africa',
    countries: ['KE', 'TZ', 'UG', 'RW', 'ET'],
    units: 'metric',
    currency: 'kes',
    voltage: 240,
    frequency: 50,
    voltage3ph: 415,
    trussRegion: 'africa',
    boothModuleMm: { width: 3000, depth: 3000 },
    stageDeckMm: 2000,
    standardWallHeightMm: 2400,
    materials: [
      'Printed vinyl on timber frame',
      'Plywood and MDF, painted',
      'Octanorm-style hire system',
      'Tensioned fabric (imported, longer lead time)',
      'Steel and aluminium fabrication',
    ],
    regulations: {
      authority: 'Kenyan building regulations and county fire authority practice',
      exitWidthPer100Mm: 500,
      minExitWidthMm: 1200,
      maxTravelSingleMm: 15_000,
      maxTravelDualMm: 40_000,
      twoExitsAbove: 50,
      minAisleMm: 3000,
      standHeightLimitMm: 3500,
      structuralSignOffAboveMm: 3500,
      notes: [
        'Fire authority sign-off is typically obtained per event rather than per venue; allow lead time.',
        'Imported materials such as SEG fabric carry duty and a multi-week lead time. Timber and vinyl are the local default.',
        'Power at 240 V / 415 V three-phase; generator backup is normal rather than exceptional.',
      ],
    },
    costIndexBp: 6800,
  },
  {
    code: 'uae',
    label: 'UAE & the Gulf',
    countries: ['AE', 'SA', 'QA', 'KW', 'OM', 'BH'],
    units: 'metric',
    currency: 'aed',
    voltage: 230,
    frequency: 50,
    voltage3ph: 400,
    trussRegion: 'middle-east',
    boothModuleMm: { width: 3000, depth: 3000 },
    stageDeckMm: 2000,
    standardWallHeightMm: 2500,
    materials: [
      'Tensioned fabric (SEG)',
      'Painted MDF and joinery',
      'Modular system extrusion',
      'Acrylic and Corian solid surface',
      'Powder-coated steel',
    ],
    regulations: {
      authority: 'UAE Fire and Life Safety Code of Practice, and venue-specific rules',
      exitWidthPer100Mm: 500,
      minExitWidthMm: 1100,
      maxTravelSingleMm: 15_000,
      maxTravelDualMm: 60_000,
      twoExitsAbove: 50,
      minAisleMm: 3000,
      standHeightLimitMm: 6000,
      structuralSignOffAboveMm: 4000,
      notes: [
        'Double-deck and heavy rigging require stamped structural drawings from a licensed engineer, submitted well ahead.',
        'Venue approval is a separate process from civil defence approval; both are needed and neither is quick.',
        'Materials must generally carry a fire-retardancy certificate; keep the certificate with the drawing.',
      ],
    },
    costIndexBp: 13_500,
  },
  {
    code: 'india',
    label: 'India & South Asia',
    countries: ['IN', 'LK', 'BD', 'NP'],
    units: 'metric',
    currency: 'inr',
    voltage: 230,
    frequency: 50,
    voltage3ph: 415,
    trussRegion: 'india',
    boothModuleMm: { width: 3000, depth: 3000 },
    stageDeckMm: 1220,
    standardWallHeightMm: 2440,
    materials: [
      'Plywood and MDF, painted or laminated',
      'Printed flex and vinyl',
      'Octanorm-style hire system',
      'Fabricated MS and aluminium',
      'Tensioned fabric (growing availability)',
    ],
    regulations: {
      authority: 'National Building Code of India, Part 4, and local fire NOC practice',
      exitWidthPer100Mm: 500,
      minExitWidthMm: 1000,
      maxTravelSingleMm: 15_000,
      maxTravelDualMm: 30_000,
      twoExitsAbove: 50,
      minAisleMm: 3000,
      standHeightLimitMm: 5000,
      structuralSignOffAboveMm: 4000,
      notes: [
        'A fire NOC is normally required per event; the timeline is the constraint, not the drawing.',
        'Plywood carpentry is the default build method, so allow build days rather than assuming hire stock.',
        'Sheet sizes are 8 × 4 ft, so panel layouts that land on 1220 mm modules waste far less material.',
      ],
    },
    costIndexBp: 5200,
  },
  {
    code: 'uk-eu',
    label: 'UK & Europe',
    countries: ['GB', 'IE', 'FR', 'DE', 'NL', 'ES', 'IT', 'PL', 'SE'],
    units: 'metric',
    currency: 'eur',
    voltage: 230,
    frequency: 50,
    voltage3ph: 400,
    trussRegion: 'europe',
    boothModuleMm: { width: 3000, depth: 3000 },
    stageDeckMm: 2000,
    standardWallHeightMm: 2500,
    materials: [
      'Tensioned fabric (SEG)',
      'Modular system extrusion',
      'Painted MDF',
      'Reusable panel systems',
      'FSC plywood',
    ],
    regulations: {
      authority: 'Approved Document B (UK) and EN 13782 / EN 13814 for temporary structures',
      exitWidthPer100Mm: 500,
      minExitWidthMm: 1050,
      maxTravelSingleMm: 18_000,
      maxTravelDualMm: 45_000,
      twoExitsAbove: 60,
      minAisleMm: 3000,
      standHeightLimitMm: 4000,
      structuralSignOffAboveMm: 4000,
      notes: [
        'Temporary demountable structures follow the Institution of Structural Engineers guidance; a competent person must sign the build.',
        'Sustainability requirements are increasingly contractual — reusable systems are often specified over bespoke build.',
      ],
    },
    costIndexBp: 12_000,
  },
  {
    code: 'north-america',
    label: 'North America',
    countries: ['US', 'CA', 'MX'],
    units: 'imperial',
    currency: 'usd',
    voltage: 120,
    frequency: 60,
    voltage3ph: 208,
    trussRegion: 'north-america',
    boothModuleMm: { width: 3048, depth: 3048 },
    stageDeckMm: 1219,
    standardWallHeightMm: 2438,
    materials: [
      'Hardwall panel systems',
      'Tensioned fabric (SEG)',
      'Painted MDF',
      'Printed vinyl',
      'Aluminium extrusion',
    ],
    regulations: {
      authority: 'NFPA 101 Life Safety Code and IFC, plus IAEE display rules',
      exitWidthPer100Mm: 508,
      minExitWidthMm: 1118,
      maxTravelSingleMm: 22_860,
      maxTravelDualMm: 76_200,
      twoExitsAbove: 49,
      minAisleMm: 3048,
      standHeightLimitMm: 2438,
      structuralSignOffAboveMm: 3658,
      notes: [
        'IAEE guidelines cap an inline stand at 8 ft with a 4 ft front section; islands are permitted higher. Show rules override this.',
        'Booths are sold in 10 ft modules — 3048 mm — which is not the same as a 3 m module. Do not mix the two on one floor.',
        'Power is 120 V single-phase and 208 V three-phase, so an imported 230 V fixture list will not run.',
      ],
    },
    costIndexBp: 14_500,
  },
];

export const REGION_MAP: Record<string, RegionPack> = Object.fromEntries(REGION_PACKS.map((r) => [r.code, r]));

export function regionPack(code: string | null | undefined): RegionPack {
  return REGION_MAP[code ?? ''] ?? REGION_MAP.global!;
}

/** Best-guess region from an ISO country code, for a sensible first default. */
export function regionForCountry(country: string | null | undefined): RegionPack {
  if (!country) return REGION_MAP.global!;
  const upper = country.toUpperCase();
  return REGION_PACKS.find((r) => r.countries.includes(upper)) ?? REGION_MAP.global!;
}

/**
 * Regulatory figures for a region, in the shape the layout assistant expects.
 *
 * The assistant holds generic defaults so it works with no region set at all;
 * this replaces the ones a region actually legislates and leaves the rest.
 */
export function regulatoryOverrides(code: string): Partial<Record<string, number>> {
  const pack = regionPack(code);
  return {
    exitWidthPer100Mm: pack.regulations.exitWidthPer100Mm,
    minExitWidthMm: pack.regulations.minExitWidthMm,
    maxTravelSingleMm: pack.regulations.maxTravelSingleMm,
    maxTravelDualMm: pack.regulations.maxTravelDualMm,
    minAisleMm: pack.regulations.minAisleMm,
  };
}
