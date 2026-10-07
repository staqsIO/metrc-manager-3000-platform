// Cross-facility pipeline status pills shown beneath the Cash Pipeline on
// /executive. Stages are app-defined; the mapping from a stage to one or more
// Metrc room names is the operator-facing knob. Empty `rooms` means the pill
// renders 0 with a "definition pending" subtext rather than fake data.

export type PipelineStageKey = 'curing' | 'decon' | 'copack' | 'q_status';

export interface StageRoomMapping {
  stage: PipelineStageKey;
  label: string;
  rooms: readonly string[];
  tooltip: string;
  color: string;
  bgColor: string;
}

export function isStageMapped(m: StageRoomMapping): boolean {
  return m.rooms.length > 0;
}

export const STAGE_ROOM_MAPPINGS: readonly StageRoomMapping[] = [
  {
    stage: 'curing',
    label: 'Curing',
    rooms: ['Kitchen Cure Room'],
    tooltip:
      'Active packages currently in cure rooms across accessible facilities.',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  {
    stage: 'decon',
    label: 'Decon',
    // No default room name — Example Farms has no facility-level "Rad Room"
    // and the prior hard-coded value rendered as 0 with stale subtext. Empty
    // rooms triggers the "definition pending" copy via isStageMapped(), which
    // is honest about the unmapped state and keeps the slot for facilities
    // that DO have a decon room (we'll surface it via Settings → Pipeline
    // in a future release).
    rooms: [],
    tooltip:
      'Active packages undergoing decontamination (radiation/X-ray treatment).',
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
  {
    stage: 'copack',
    label: 'Copack',
    // Includes Metrc location variants — Example Farms has Wholesale Room, Wholesale
    // Room: Bulk, Wholesale Room: EPP/Trade Samples, Wholesale Room: Retail.
    // Exact-match against just "Wholesale Room" missed ~180 packages.
    rooms: [
      'Wholesale Room',
      'Wholesale Room: Bulk',
      'Wholesale Room: EPP/Trade Samples',
      'Wholesale Room: Retail',
    ],
    tooltip: 'Active packages designated for co-packing.',
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
  },
  {
    stage: 'q_status',
    label: 'Queue',
    rooms: ['Packaging', 'Main Vault'],
    tooltip: 'Active packages queued for downstream processing.',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
  },
];

export function buildStageRoomLookup(
  mappings: readonly StageRoomMapping[] = STAGE_ROOM_MAPPINGS,
): Map<string, PipelineStageKey> {
  const lookup = new Map<string, PipelineStageKey>();
  for (const m of mappings) {
    for (const room of m.rooms) {
      lookup.set(room.toLowerCase(), m.stage);
    }
  }
  return lookup;
}
