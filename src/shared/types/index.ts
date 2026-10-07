// Shared TypeScript types for the Metrc platform

import type { MetrcFacility } from '@prisma/client';

// Session user type augmentation
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      orgIds: string[];
      facilityAccess: Record<string, string>; // facilityId -> FacilityRole
      orgEnvironments: Record<string, string>; // organizationId -> OrganizationEnvironment (PRODUCTION/DEMO/TEST). ADR-020 Phase 3.
      isPlatformAdmin: boolean;
    };
  }
}

// Facility-level access roles (FOR-1172)
export type FacilityRoleType = 'VIEWER' | 'OPERATOR' | 'ADMIN';

// Facility context passed through tRPC
export interface FacilityContext {
  facilityId: string;
  facility: MetrcFacility;
  organizationId: string;
  facilityRole: FacilityRoleType;
}

// Alert severity levels
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

// Alert status
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

// Action status for preview/confirm/execute pipeline
export type ActionStatus = 'PREVIEWING' | 'CONFIRMED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';

// Sync status
export type SyncStatus = 'STARTED' | 'SUCCESS' | 'FAILED' | 'PARTIAL';

// Business rule condition DSL
export interface RuleCondition {
  field: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'contains' | 'not_contains';
  value: string | number | boolean;
  itemCategory?: string;
}

export interface BusinessRuleDefinition {
  conditions: RuleCondition[];
  combinator: 'AND' | 'OR';
}

// Report template column definition
export interface ReportColumn {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  width?: number;
  sortable?: boolean;
  filterable?: boolean;
}

// Pagination
export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
