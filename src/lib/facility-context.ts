import { MetrcFacility } from '@prisma/client';

export interface FacilityContext {
  facilityId: string;
  facility: MetrcFacility;
  organizationId: string;
}

// Platform uses 3-value union ('mock' is platform-specific, handled in factory before reaching the package).
// The shared package only has 'sandbox' | 'production'.
export type MetrcEnvironment = 'none' | 'mock' | 'sandbox' | 'production';
