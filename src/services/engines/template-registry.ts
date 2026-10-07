/**
 * OpEx Template Registry — maps template IDs to definitions
 * and auto-selects the default template based on facility type.
 */

import type { OpExTemplate } from './opex-templates';
import { DEFAULT_CANNABIS_TEMPLATE } from './opex-templates';

// Lazy imports — templates are loaded when first accessed.
// We use a getter pattern to avoid circular deps and allow
// the templates file to be extended independently.
let _manufacturerTemplate: OpExTemplate | null = null;
let _dispensaryTemplate: OpExTemplate | null = null;
let _testingLabTemplate: OpExTemplate | null = null;

async function loadTemplates() {
  if (!_manufacturerTemplate) {
    const mod = await import('./opex-templates');
    _manufacturerTemplate = mod.MANUFACTURER_TEMPLATE;
    _dispensaryTemplate = mod.DISPENSARY_TEMPLATE;
    _testingLabTemplate = mod.TESTING_LAB_TEMPLATE;
  }
}

// Synchronous registry — populated after first access
function getTemplateMap(): Record<string, OpExTemplate> {
  return {
    'cultivator-standard': DEFAULT_CANNABIS_TEMPLATE,
    'manufacturer-standard': _manufacturerTemplate ?? DEFAULT_CANNABIS_TEMPLATE,
    'dispensary-standard': _dispensaryTemplate ?? DEFAULT_CANNABIS_TEMPLATE,
    'testing-lab-standard': _testingLabTemplate ?? DEFAULT_CANNABIS_TEMPLATE,
  };
}

/**
 * Default template ID for each facility type.
 * Falls back to cultivator-standard for unknown types.
 */
const DEFAULT_TEMPLATE_FOR_TYPE: Record<string, string> = {
  Cultivator: 'cultivator-standard',
  Manufacturer: 'manufacturer-standard',
  Dispensary: 'dispensary-standard',
  'Testing Lab': 'testing-lab-standard',
  Distributor: 'cultivator-standard',
  Microbusiness: 'cultivator-standard',
};

/**
 * Get the template for a given ID, loading templates if needed.
 * Returns the default cultivator template if not found.
 */
export async function getTemplateById(templateId: string): Promise<OpExTemplate> {
  await loadTemplates();
  return getTemplateMap()[templateId] ?? DEFAULT_CANNABIS_TEMPLATE;
}

/**
 * Get the best-fit template for a facility type.
 * Falls back to cultivator template for null/unknown types.
 */
export async function getTemplateForFacility(facilityType: string | null | undefined): Promise<OpExTemplate> {
  if (!facilityType) return DEFAULT_CANNABIS_TEMPLATE;
  const templateId = DEFAULT_TEMPLATE_FOR_TYPE[facilityType] ?? 'cultivator-standard';
  return getTemplateById(templateId);
}

/**
 * List available templates with metadata (for UI selection).
 */
export async function listTemplates(): Promise<Array<{
  id: string;
  name: string;
  description: string;
  recommendedFor: string[];
}>> {
  await loadTemplates();
  return [
    {
      id: 'cultivator-standard',
      name: DEFAULT_CANNABIS_TEMPLATE.name,
      description: DEFAULT_CANNABIS_TEMPLATE.description,
      recommendedFor: ['Cultivator', 'Microbusiness', 'Distributor'],
    },
    {
      id: 'manufacturer-standard',
      name: _manufacturerTemplate?.name ?? 'Cannabis Manufacturing Operations',
      description: _manufacturerTemplate?.description ?? 'Cost model for cannabis extraction, processing, and manufacturing',
      recommendedFor: ['Manufacturer'],
    },
    {
      id: 'dispensary-standard',
      name: _dispensaryTemplate?.name ?? 'Cannabis Retail/Dispensary Operations',
      description: _dispensaryTemplate?.description ?? 'Cost model for cannabis dispensary and retail operations',
      recommendedFor: ['Dispensary'],
    },
    {
      id: 'testing-lab-standard',
      name: _testingLabTemplate?.name ?? 'Cannabis Testing Laboratory Operations',
      description: _testingLabTemplate?.description ?? 'Cost model for cannabis analytical testing laboratory',
      recommendedFor: ['Testing Lab'],
    },
  ];
}

/**
 * Get the recommended template ID for a facility type.
 */
export function getRecommendedTemplateId(facilityType: string | null | undefined): string {
  if (!facilityType) return 'cultivator-standard';
  return DEFAULT_TEMPLATE_FOR_TYPE[facilityType] ?? 'cultivator-standard';
}
