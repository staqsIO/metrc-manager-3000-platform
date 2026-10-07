/**
 * Detect references to known operational pages in assistant text and surface
 * them as actionable deep-link buttons. Pattern → path mapping is kept here
 * so any Copilot surface (panel, full-page, future canvas) can render the
 * same affordances.
 */

const DEEP_LINK_PATTERNS: { pattern: RegExp; getPath: () => string; label: string }[] = [
  { pattern: /FIFO\s+violation/i, getPath: () => '/inventory/aging', label: 'View FIFO violations' },
  { pattern: /aging\s+inventor/i, getPath: () => '/inventory/aging', label: 'View aging inventory' },
  { pattern: /aging\s+package/i, getPath: () => '/inventory/aging', label: 'View aging packages' },
  { pattern: /slow[\s-]?moving/i, getPath: () => '/inventory/aging', label: 'View slow movers' },
  { pattern: /dead\s+stock/i, getPath: () => '/inventory/aging', label: 'View dead stock' },
  { pattern: /compliance\s+audit|audit\s+score/i, getPath: () => '/compliance/audit', label: 'View audit' },
  { pattern: /compliance\s+alert|compliance\s+risk/i, getPath: () => '/compliance', label: 'View compliance' },
  { pattern: /lab\s+test/i, getPath: () => '/compliance/audit', label: 'View lab testing' },
  { pattern: /on\s+hold|held\s+package/i, getPath: () => '/compliance', label: 'View holds' },
  { pattern: /fragmented|consolidat/i, getPath: () => '/packages', label: 'View packages' },
  { pattern: /biomass|waste/i, getPath: () => '/packages/biomass', label: 'View biomass' },
  { pattern: /fulfillment\s+risk/i, getPath: () => '/fulfillment', label: 'View fulfillment' },
  { pattern: /employee|training/i, getPath: () => '/operations', label: 'View operations' },
  { pattern: /transfer|manifest/i, getPath: () => '/fulfillment', label: 'View transfers' },
  { pattern: /plant|batch|clone/i, getPath: () => '/inventory', label: 'View inventory' },
  { pattern: /strain|genetic/i, getPath: () => '/analytics', label: 'View analytics' },
  { pattern: /lab.*result/i, getPath: () => '/compliance/audit', label: 'View lab results' },
];

export function findDeepLinks(text: string): { path: string; label: string }[] {
  const found: { path: string; label: string }[] = [];
  const seenPaths = new Set<string>();
  for (const { pattern, getPath, label } of DEEP_LINK_PATTERNS) {
    if (pattern.test(text) && !seenPaths.has(getPath())) {
      seenPaths.add(getPath());
      found.push({ path: getPath(), label });
    }
  }
  return found;
}
