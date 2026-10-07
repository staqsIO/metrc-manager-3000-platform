/**
 * Cannabis facility type constants, nav visibility map, and feature gating.
 *
 * Cannabis license types are regulated and change ~never.
 * Hardcoded map — O(1) lookup, zero DB queries.
 * Null/unknown facilityType defaults to showing ALL features (backward compat).
 */

export const FACILITY_TYPES = {
  CULTIVATOR: 'Cultivator',
  MANUFACTURER: 'Manufacturer',
  DISPENSARY: 'Dispensary',
  TESTING_LAB: 'Testing Lab',
  DISTRIBUTOR: 'Distributor',
  TRANSPORTER: 'Transporter',
  STORAGE: 'Storage',
  OPERATOR: 'Operator',
  MICROBUSINESS: 'Microbusiness',
  OTHER: 'Other',
} as const;

export type FacilityType = typeof FACILITY_TYPES[keyof typeof FACILITY_TYPES];

export const FACILITY_TYPE_VALUES = Object.values(FACILITY_TYPES) as [FacilityType, ...FacilityType[]];

const ALL_TYPES: FacilityType[] = [...FACILITY_TYPE_VALUES];

/**
 * Static map: nav path → which facility types see it.
 * Paths not listed here are visible to all types.
 */
export const FACILITY_NAV_VISIBILITY: Record<string, FacilityType[]> = {
  '/inventory': ALL_TYPES,
  '/compliance': ALL_TYPES,
  '/operations': ALL_TYPES,
  '/packages': ALL_TYPES,
  '/fulfillment': ALL_TYPES,
  '/supply': ALL_TYPES,
  '/opex': ALL_TYPES,
  '/reports': ALL_TYPES,
  '/harvests': ['Cultivator', 'Microbusiness'],
  '/plant-batches': ['Cultivator', 'Microbusiness'],
  '/plants': ['Cultivator', 'Microbusiness'],
  '/processing': ['Cultivator', 'Microbusiness'],
  '/transfers': ALL_TYPES,
  '/lab-tests': ALL_TYPES,
  '/sales': ['Dispensary', 'Microbusiness'],
  '/run-rates': ALL_TYPES,
  '/tolling': ['Cultivator', 'Manufacturer', 'Microbusiness'],
  '/labor': ['Cultivator', 'Manufacturer', 'Microbusiness'],
  '/catalog': ALL_TYPES,
  '/analytics': ALL_TYPES,
  '/dutchie-ops': ['Dispensary', 'Microbusiness'],
  '/dispositions': ALL_TYPES,
  '/pipeline': ALL_TYPES,
  '/waste': ['Cultivator', 'Microbusiness'],
  '/analytics/yields': ['Cultivator', 'Microbusiness'],
  '/analytics/throughput': ['Cultivator', 'Microbusiness'],
  '/analytics/forecast': ['Cultivator', 'Microbusiness'],
};

export const DUTCHIE_RECOMMENDED_TYPES: FacilityType[] = ['Dispensary', 'Microbusiness'];

/** Default landing page when navigating to a facility. Cultivators start on harvests. */
export function getDefaultFacilityPage(facilityType?: string | null): string {
  return facilityType === 'Cultivator' ? '/harvests' : '/inventory';
}

/**
 * Check whether a nav path should be visible for the given facility type.
 * Returns true if facilityType is null/undefined (backward compat — show everything).
 */
export function isNavVisibleForType(navPath: string, facilityType: string | null | undefined): boolean {
  if (!facilityType) return true; // null/unknown → show all
  const allowedTypes = FACILITY_NAV_VISIBILITY[navPath];
  if (!allowedTypes) return true; // path not in map → visible to all
  return allowedTypes.includes(facilityType as FacilityType);
}

/**
 * Color badge mapping for facility types (used in UI).
 */
export const FACILITY_TYPE_COLORS: Record<string, string> = {
  Cultivator: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Manufacturer: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Dispensary: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  'Testing Lab': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Distributor: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  Transporter: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  Storage: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  Operator: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  Microbusiness: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
  Other: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

/**
 * Left-border accent color for facility type cards.
 */
export const FACILITY_TYPE_ACCENT_COLORS: Record<string, string> = {
  Cultivator: 'border-l-emerald-500',
  Manufacturer: 'border-l-blue-500',
  Dispensary: 'border-l-purple-500',
  'Testing Lab': 'border-l-amber-500',
  Distributor: 'border-l-cyan-500',
  Transporter: 'border-l-orange-500',
  Storage: 'border-l-slate-500',
  Operator: 'border-l-indigo-500',
  Microbusiness: 'border-l-pink-500',
  Other: 'border-l-gray-500',
};

/**
 * Background icon color for facility type (used in grid card icon containers).
 */
export const FACILITY_TYPE_ICON_BG: Record<string, string> = {
  Cultivator: 'bg-emerald-500/10 text-emerald-500',
  Manufacturer: 'bg-blue-500/10 text-blue-500',
  Dispensary: 'bg-purple-500/10 text-purple-500',
  'Testing Lab': 'bg-amber-500/10 text-amber-500',
  Distributor: 'bg-cyan-500/10 text-cyan-500',
  Transporter: 'bg-orange-500/10 text-orange-500',
  Storage: 'bg-slate-500/10 text-slate-500',
  Operator: 'bg-indigo-500/10 text-indigo-500',
  Microbusiness: 'bg-pink-500/10 text-pink-500',
  Other: 'bg-gray-500/10 text-gray-500',
};
