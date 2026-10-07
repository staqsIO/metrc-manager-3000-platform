-- CreateEnum
CREATE TYPE "OrganizationEnvironment" AS ENUM ('PRODUCTION', 'DEMO', 'TEST');

-- CreateEnum
CREATE TYPE "DomainVerificationStatus" AS ENUM ('PENDING', 'VERIFYING', 'VERIFIED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DomainVerificationMethod" AS ENUM ('ADMIN_EMAIL', 'DNS_TXT', 'MANUAL');

-- CreateEnum
CREATE TYPE "FacilityRole" AS ENUM ('VIEWER', 'OPERATOR', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "jwtInvalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identity_map" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "canonical_email" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identity_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "website" TEXT,
    "environment" "OrganizationEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_domains" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "DomainVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "method" "DomainVerificationMethod" NOT NULL DEFAULT 'ADMIN_EMAIL',
    "defaultRoleName" TEXT NOT NULL DEFAULT 'MEMBER',
    "includeSubdomains" BOOLEAN NOT NULL DEFAULT false,
    "challengeTokenHash" TEXT,
    "challengeExpiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_domain_events" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "fromStatus" "DomainVerificationStatus",
    "toStatus" "DomainVerificationStatus" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generic_email_domains" (
    "domain" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generic_email_domains_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "hierarchy" INTEGER NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrc_facilities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "facilityType" TEXT,
    "encryptedVendorApiKey" TEXT,
    "encryptedUserApiKey" TEXT,
    "encryptedSandboxVendorApiKey" TEXT,
    "encryptedSandboxUserApiKey" TEXT,
    "metrcEnvironment" TEXT NOT NULL DEFAULT 'mock',
    "metrcKeyAccess" TEXT,
    "sandboxMetrcKeyAccess" TEXT,
    "requirePerUserCredentials" BOOLEAN NOT NULL DEFAULT false,
    "dutchieEnvironment" TEXT DEFAULT 'none',
    "encryptedDutchieLocationKey" TEXT,
    "encryptedDutchieIntegratorKey" TEXT,
    "encryptedDutchieSandboxLocationKey" TEXT,
    "encryptedDutchieSandboxIntegratorKey" TEXT,
    "dutchieFacilityTypes" TEXT[] DEFAULT ARRAY['retail']::TEXT[],
    "canixEnvironment" TEXT DEFAULT 'none',
    "encryptedCanixApiKey" TEXT,
    "encryptedCanixSandboxApiKey" TEXT,
    "canixFacilityId" TEXT,
    "license_expiry_date" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "syncErrorMessage" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metrc_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrc_sync_logs" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "plantsCount" INTEGER,
    "packagesCount" INTEGER,
    "transfersCount" INTEGER,
    "salesCount" INTEGER,
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "durationMs" INTEGER,
    "apiCallCount" INTEGER,
    "entityType" TEXT,
    "rowsUpserted" INTEGER,
    "rowsStatusChanged" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrc_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_rules" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "stateCode" VARCHAR(2),
    "conditions" JSONB NOT NULL,
    "actionType" TEXT NOT NULL DEFAULT 'ALERT',
    "actionParams" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "snapshotType" TEXT NOT NULL,
    "packagesData" JSONB NOT NULL,
    "plantsData" JSONB,
    "totalPackages" INTEGER NOT NULL,
    "totalQuantity" DOUBLE PRECISION,
    "totalCategories" INTEGER,
    "agingDistribution" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_alerts" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "packageLabel" TEXT,
    "plantLabel" TEXT,
    "transferId" TEXT,
    "employeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "ruleId" TEXT,
    "actionType" TEXT,
    "actionParams" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_logs" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEWING',
    "targetType" TEXT NOT NULL,
    "targetIds" TEXT[],
    "targetCount" INTEGER NOT NULL,
    "previewData" JSONB,
    "beforeState" JSONB,
    "afterState" JSONB,
    "executedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "metrcResponse" JSONB,
    "metadata" JSONB,
    "originated_by" TEXT,
    "originating_run_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "reportType" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "filters" JSONB,
    "groupBy" TEXT[],
    "sortBy" JSONB,
    "chartConfig" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "auditType" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "categoryScores" JSONB NOT NULL,
    "totalFindings" INTEGER NOT NULL,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "infoCount" INTEGER NOT NULL DEFAULT 0,
    "findings" JSONB NOT NULL,
    "inventorySnapshotId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yield_records" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "strainName" TEXT NOT NULL,
    "batchId" TEXT,
    "harvestId" TEXT,
    "stage" TEXT NOT NULL,
    "inputWeight" DOUBLE PRECISION NOT NULL,
    "outputWeight" DOUBLE PRECISION NOT NULL,
    "yieldPercent" DOUBLE PRECISION NOT NULL,
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'grams',
    "potencyThc" DOUBLE PRECISION,
    "potencyCbd" DOUBLE PRECISION,
    "moistureContent" DOUBLE PRECISION,
    "notes" TEXT,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yield_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolling_agreements" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "partnerLicense" TEXT,
    "agreementType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "inputWeight" DOUBLE PRECISION,
    "outputWeight" DOUBLE PRECISION,
    "processingFee" DOUBLE PRECISION,
    "totalFees" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "feeStructure" JSONB,
    "yieldGuarantee" DOUBLE PRECISION,
    "qualityStandards" JSONB,
    "inputPackageIds" TEXT[],
    "outputPackageIds" TEXT[],
    "billingMode" TEXT NOT NULL DEFAULT 'SEPARATE_INVOICE',
    "terms" JSONB,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tolling_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolling_batches" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "inputPackageIds" TEXT[],
    "inputWeight" DOUBLE PRECISION,
    "outputPackageIds" TEXT[],
    "outputWeight" DOUBLE PRECISION,
    "calculatedFees" JSONB,
    "totalFees" DOUBLE PRECISION,
    "expectedYieldPct" DOUBLE PRECISION,
    "actualYieldPct" DOUBLE PRECISION,
    "yieldVariance" DOUBLE PRECISION,
    "wasteWeight" DOUBLE PRECISION,
    "wastePct" DOUBLE PRECISION,
    "lifecycleStage" TEXT NOT NULL DEFAULT 'INTAKE',
    "commencedAt" TIMESTAMP(3),
    "lifecycleSnapshot" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tolling_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_records" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "reconciliationType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceA" TEXT NOT NULL,
    "sourceB" TEXT NOT NULL,
    "totalRecords" INTEGER,
    "matchedCount" INTEGER,
    "mismatchCount" INTEGER,
    "missingInA" INTEGER,
    "missingInB" INTEGER,
    "discrepancies" JSONB,
    "resolvedCount" INTEGER DEFAULT 0,
    "resolutionNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opex_models" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "annualRevenue" DOUBLE PRECISION,
    "annualCost" DOUBLE PRECISION,
    "costPerPound" DOUBLE PRECISION,
    "grossMargin" DOUBLE PRECISION,
    "grossProfit" DOUBLE PRECISION,
    "taxableProfit" DOUBLE PRECISION,
    "kpiCells" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceFile" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opex_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opex_sections" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "icon" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opex_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opex_cell_groups" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opex_cell_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opex_cells" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cellType" TEXT NOT NULL,
    "dataType" TEXT NOT NULL DEFAULT 'number',
    "value" DOUBLE PRECISION,
    "textValue" TEXT,
    "formula" TEXT,
    "dependsOn" TEXT[],
    "sortOrder" INTEGER NOT NULL,
    "unit" TEXT,
    "precision" INTEGER NOT NULL DEFAULT 2,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "tooltip" TEXT,
    "sourceSheet" TEXT,
    "sourceCell" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opex_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opex_snapshots" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "cellData" JSONB NOT NULL,
    "kpis" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opex_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefing_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_categories" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_items" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'Each',
    "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reorderPoint" DOUBLE PRECISION,
    "reorderQty" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "vendor" TEXT,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_transactions" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills_of_material" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcItemName" TEXT NOT NULL,
    "metrcItemCategory" TEXT,
    "componentItemId" TEXT,
    "componentMetrcItemName" TEXT,
    "quantityPerUnit" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Each',
    "notes" TEXT,
    "isAutoInferred" BOOLEAN NOT NULL DEFAULT false,
    "inferenceConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_of_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_discount_configs" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxDiscountPct" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "minPriceFloor" DOUBLE PRECISION,
    "minScoreThreshold" INTEGER NOT NULL DEFAULT 30,
    "priorityFilter" TEXT[] DEFAULT ARRAY['urgent', 'high']::TEXT[],
    "discountTiers" JSONB NOT NULL DEFAULT '[{"ageDays":60,"discountPct":10},{"ageDays":90,"discountPct":20},{"ageDays":120,"discountPct":30}]',
    "excludedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryMaxDiscountPct" JSONB,
    "useVelocityData" BOOLEAN NOT NULL DEFAULT false,
    "velocityLookbackDays" INTEGER NOT NULL DEFAULT 30,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_discount_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_discount_runs" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "overrideCount" INTEGER NOT NULL DEFAULT 0,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedRevenueImpact" DOUBLE PRECISION,
    "planData" JSONB,
    "resultData" JSONB,
    "actionLogId" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_discount_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disposition_policies" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "categoryLimits" JSONB NOT NULL DEFAULT '{}',
    "allowBudgetOverride" BOOLEAN NOT NULL DEFAULT false,
    "requireNote" BOOLEAN NOT NULL DEFAULT true,
    "alertThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disposition_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disposition_records" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "estimatedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recipientName" TEXT,
    "note" TEXT,
    "metrcAdjustmentReason" TEXT,
    "actionLogId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disposition_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_logs" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "employeeId" TEXT,
    "metrcBatchId" TEXT,
    "tollingBatchId" TEXT,
    "packageLabel" TEXT,
    "activityType" TEXT NOT NULL,
    "description" TEXT,
    "hoursWorked" DOUBLE PRECISION NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "laborCost" DOUBLE PRECISION NOT NULL,
    "unitsProduced" INTEGER,
    "skuName" TEXT,
    "costPerUnit" DOUBLE PRECISION,
    "rateSource" TEXT NOT NULL DEFAULT 'manual',
    "workDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_access" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FacilityRole" NOT NULL DEFAULT 'VIEWER',
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_user_credentials" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedUserApiKey" TEXT NOT NULL,
    "encryptedSandboxUserApiKey" TEXT,
    "metrcUsername" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_user_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coa_records" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "packageLabel" TEXT,
    "packageId" INTEGER,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "terpenes" JSONB,
    "cannabinoids" JSONB,
    "labInfo" JSONB,
    "batchInfo" JSONB,
    "totalTerpenes" DOUBLE PRECISION,
    "totalCannabinoids" DOUBLE PRECISION,
    "parseTier" TEXT NOT NULL,
    "parseConfidence" DOUBLE PRECISION NOT NULL,
    "parseWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PARSED',
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "testDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coa_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_configs" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_statuses" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "locationNames" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcTransferId" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "manifestNumber" TEXT NOT NULL,
    "shipperFacilityLicenseNumber" TEXT NOT NULL,
    "shipperFacilityName" TEXT NOT NULL,
    "receiverFacilityLicenseNumber" TEXT,
    "receiverFacilityName" TEXT,
    "transporterFacilityLicenseNumber" TEXT,
    "transporterFacilityName" TEXT,
    "deliveryCount" INTEGER NOT NULL,
    "receivedDeliveryCount" INTEGER NOT NULL,
    "packageCount" INTEGER NOT NULL,
    "receivedPackageCount" INTEGER NOT NULL,
    "containsDonation" BOOLEAN NOT NULL DEFAULT false,
    "containsTradeSample" BOOLEAN NOT NULL DEFAULT false,
    "containsTestingSample" BOOLEAN NOT NULL DEFAULT false,
    "estimatedDepartureDateTime" TEXT NOT NULL,
    "estimatedArrivalDateTime" TEXT NOT NULL,
    "receivedDateTime" TEXT,
    "createdDateTime" TEXT NOT NULL,
    "lastModified" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metrcLastModified" TIMESTAMP(3),
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_delivery_records" (
    "id" TEXT NOT NULL,
    "transferSnapshotId" TEXT NOT NULL,
    "metrcDeliveryId" INTEGER NOT NULL,
    "recipientFacilityLicenseNumber" TEXT NOT NULL,
    "recipientFacilityName" TEXT NOT NULL,
    "shipmentTypeName" TEXT,
    "shipmentTransactionType" TEXT,
    "estimatedDepartureDateTime" TEXT,
    "estimatedArrivalDateTime" TEXT,
    "actualDepartureDateTime" TEXT,
    "actualArrivalDateTime" TEXT,
    "receivedDateTime" TEXT,
    "receivedByName" TEXT,
    "grossWeight" DECIMAL(12,4),
    "grossUnitOfWeightName" TEXT,
    "plannedRoute" TEXT,
    "totalPackages" INTEGER NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(14,2),
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_delivery_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_package_records" (
    "id" TEXT NOT NULL,
    "deliveryRecordId" TEXT NOT NULL,
    "metrcPackageId" INTEGER NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "packageType" TEXT,
    "itemName" TEXT NOT NULL,
    "itemStrainName" TEXT,
    "itemCategory" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitOfMeasureName" TEXT,
    "grossWeight" DECIMAL(12,4),
    "grossUnitOfWeightName" TEXT,
    "wholesalePrice" DECIMAL(14,2),
    "shipmentPackageState" TEXT,
    "labTestingState" TEXT,
    "remediationDate" TEXT,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_package_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcItemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "productCategoryName" TEXT,
    "productCategoryType" TEXT,
    "quantityType" TEXT,
    "defaultLabTestingState" TEXT,
    "unitOfMeasureName" TEXT,
    "strainName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcLocationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "locationTypeId" INTEGER,
    "locationTypeName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strain_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcStrainId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "testingStatus" TEXT,
    "thcLevel" DECIMAL(6,3),
    "cbdLevel" DECIMAL(6,3),
    "indicaPercentage" DECIMAL(6,2),
    "sativaPercentage" DECIMAL(6,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strain_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_line_items" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "manifestNumber" TEXT NOT NULL,
    "originLicenseNumber" TEXT NOT NULL,
    "originFacilityName" TEXT NOT NULL,
    "originFacilityType" TEXT,
    "destLicenseNumber" TEXT NOT NULL,
    "destFacilityName" TEXT NOT NULL,
    "destFacilityType" TEXT,
    "transferType" TEXT NOT NULL,
    "createdDateTime" TEXT,
    "receivedDateTime" TEXT,
    "isVoided" BOOLEAN NOT NULL DEFAULT false,
    "packageLabel" TEXT,
    "itemName" TEXT NOT NULL,
    "itemCategory" TEXT NOT NULL,
    "shippedQuantity" DOUBLE PRECISION,
    "shippedUnitOfMeasure" TEXT,
    "shippedWeight" DOUBLE PRECISION,
    "shippedWeightUoM" TEXT,
    "receivedQuantity" DOUBLE PRECISION,
    "receivedUnitOfMeasure" TEXT,
    "receivedWeight" DOUBLE PRECISION,
    "receivedWeightUoM" TEXT,
    "countVariancePct" DOUBLE PRECISION,
    "weightVariancePct" DOUBLE PRECISION,
    "shipperWholesalePrice" DOUBLE PRECISION,
    "receiverWholesalePrice" DOUBLE PRECISION,
    "importSource" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importBatchId" TEXT NOT NULL,

    CONSTRAINT "transfer_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_benchmarks" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "label" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retail_sales" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productCategory" TEXT,
    "customerType" TEXT,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(12,4),
    "totalPrice" DECIMAL(12,4) NOT NULL,
    "unitOfMeasure" TEXT,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "sourcePackageLabel" TEXT,

    CONSTRAINT "retail_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retail_sale_receipts" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "customerType" TEXT,
    "lineItemCount" INTEGER NOT NULL,
    "totalPrice" DECIMAL(12,4) NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retail_sale_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcPackageId" INTEGER NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "packageType" TEXT,
    "itemId" INTEGER,
    "itemName" TEXT NOT NULL,
    "itemCategory" TEXT,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitOfMeasure" TEXT,
    "locationName" TEXT,
    "packagedDate" TIMESTAMP(3),
    "productCategory" TEXT,
    "itemStrainName" TEXT,
    "isFinished" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "finishedDate" TIMESTAMP(3),
    "archivedDate" TIMESTAMP(3),
    "metrcLastModified" TIMESTAMP(3),
    "labTestingState" TEXT,
    "isOnHold" BOOLEAN NOT NULL DEFAULT false,
    "sourceHarvestNames" TEXT,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_watermarks" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "entityState" TEXT,
    "watermark" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_watermarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_call_budgets" (
    "id" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "callsUsed" INTEGER NOT NULL DEFAULT 0,
    "callsCap" INTEGER NOT NULL DEFAULT 125000,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_call_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcPlantId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "state" TEXT,
    "growthPhase" TEXT,
    "plantBatchName" TEXT,
    "plantBatchTypeName" TEXT,
    "strainName" TEXT,
    "locationName" TEXT,
    "roomName" TEXT,
    "isOnHold" BOOLEAN NOT NULL DEFAULT false,
    "plantedDate" TIMESTAMP(3),
    "vegetativeDate" TIMESTAMP(3),
    "floweringDate" TIMESTAMP(3),
    "harvestedDate" TIMESTAMP(3),
    "destroyedDate" TIMESTAMP(3),
    "metrcLastModified" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_batch_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcBatchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "strainName" TEXT,
    "locationName" TEXT,
    "roomName" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "untrackedCount" INTEGER NOT NULL DEFAULT 0,
    "trackedCount" INTEGER NOT NULL DEFAULT 0,
    "packagedCount" INTEGER NOT NULL DEFAULT 0,
    "harvestedCount" INTEGER NOT NULL DEFAULT 0,
    "destroyedCount" INTEGER NOT NULL DEFAULT 0,
    "plantedDate" TIMESTAMP(3),
    "metrcLastModified" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_batch_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvest_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "metrcHarvestId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "harvestType" TEXT,
    "sourceStrainNames" TEXT,
    "dryingLocationName" TEXT,
    "currentWeight" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "totalWasteWeight" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "totalRestoredWeight" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "packageCount" INTEGER NOT NULL DEFAULT 0,
    "totalPackagedWeight" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "unitOfWeightName" TEXT,
    "labTestingState" TEXT,
    "isOnHold" BOOLEAN NOT NULL DEFAULT false,
    "harvestStartDate" TIMESTAMP(3),
    "finishedDate" TIMESTAMP(3),
    "archivedDate" TIMESTAMP(3),
    "metrcLastModified" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harvest_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrc_api_calls" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remainingQuota" INTEGER,
    "requestId" TEXT,
    "error" TEXT,

    CONSTRAINT "metrc_api_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_snapshots" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "packageId" INTEGER NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "testPerformedDate" TIMESTAMP(3),
    "overallPassed" BOOLEAN NOT NULL,
    "testTypeName" TEXT,
    "testResultLevel" DECIMAL(12,4),
    "testResultUnit" TEXT,
    "labFacilityName" TEXT,
    "metrcLastModified" TIMESTAMP(3),
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_test_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "facility_id" TEXT,
    "user_id" TEXT NOT NULL,
    "skill_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "prompt" TEXT NOT NULL,
    "model" TEXT,
    "schedule_spec" JSONB,
    "iterations" JSONB NOT NULL DEFAULT '[]',
    "current_artifact_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "tools_used" TEXT[],
    "error_message" TEXT,
    "conversation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "facility_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "current_version_id" TEXT,
    "pinned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_versions" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "produced_by_turn_idx" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "run_id" TEXT,
    "artifact_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "facility_id" TEXT,
    "title" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "run_id" TEXT,
    "audit" JSONB,
    "tools_used" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_org_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "copilot_writes_enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthly_budget_usd" DECIMAL(10,2),
    "drafted_actions_count" INTEGER NOT NULL DEFAULT 0,
    "submitted_actions_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_org_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_identity_map_user_id_idx" ON "user_identity_map"("user_id");

-- CreateIndex
CREATE INDEX "user_identity_map_canonical_email_idx" ON "user_identity_map"("canonical_email");

-- CreateIndex
CREATE UNIQUE INDEX "user_identity_map_provider_provider_account_id_key" ON "user_identity_map"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_environment_idx" ON "organizations"("environment");

-- CreateIndex
CREATE INDEX "organization_domains_organizationId_idx" ON "organization_domains"("organizationId");

-- CreateIndex
CREATE INDEX "organization_domains_domain_idx" ON "organization_domains"("domain");

-- CreateIndex
CREATE INDEX "organization_domain_events_domainId_createdAt_idx" ON "organization_domain_events"("domainId", "createdAt");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE INDEX "memberships_organizationId_idx" ON "memberships"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organizationId_userId_key" ON "memberships"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "metrc_facilities_organizationId_isActive_idx" ON "metrc_facilities"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "metrc_facilities_stateCode_idx" ON "metrc_facilities"("stateCode");

-- CreateIndex
CREATE UNIQUE INDEX "metrc_facilities_organizationId_licenseNumber_key" ON "metrc_facilities"("organizationId", "licenseNumber");

-- CreateIndex
CREATE INDEX "metrc_sync_logs_facilityId_createdAt_idx" ON "metrc_sync_logs"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "metrc_sync_logs_status_idx" ON "metrc_sync_logs"("status");

-- CreateIndex
CREATE INDEX "business_rules_facilityId_category_idx" ON "business_rules"("facilityId", "category");

-- CreateIndex
CREATE INDEX "business_rules_facilityId_isActive_category_stateCode_idx" ON "business_rules"("facilityId", "isActive", "category", "stateCode");

-- CreateIndex
CREATE INDEX "inventory_snapshots_facilityId_createdAt_idx" ON "inventory_snapshots"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_snapshots_facilityId_snapshotType_idx" ON "inventory_snapshots"("facilityId", "snapshotType");

-- CreateIndex
CREATE INDEX "compliance_alerts_facilityId_status_idx" ON "compliance_alerts"("facilityId", "status");

-- CreateIndex
CREATE INDEX "compliance_alerts_facilityId_category_idx" ON "compliance_alerts"("facilityId", "category");

-- CreateIndex
CREATE INDEX "compliance_alerts_facilityId_severity_idx" ON "compliance_alerts"("facilityId", "severity");

-- CreateIndex
CREATE INDEX "compliance_alerts_facilityId_createdAt_idx" ON "compliance_alerts"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "compliance_alerts_ruleId_idx" ON "compliance_alerts"("ruleId");

-- CreateIndex
CREATE INDEX "compliance_alerts_facilityId_actionType_idx" ON "compliance_alerts"("facilityId", "actionType");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_alerts_facilityId_ruleId_packageLabel_status_key" ON "compliance_alerts"("facilityId", "ruleId", "packageLabel", "status");

-- CreateIndex
CREATE INDEX "action_logs_facilityId_createdAt_idx" ON "action_logs"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "action_logs_facilityId_status_idx" ON "action_logs"("facilityId", "status");

-- CreateIndex
CREATE INDEX "action_logs_userId_idx" ON "action_logs"("userId");

-- CreateIndex
CREATE INDEX "action_logs_originated_by_status_idx" ON "action_logs"("originated_by", "status");

-- CreateIndex
CREATE INDEX "report_templates_facilityId_reportType_idx" ON "report_templates"("facilityId", "reportType");

-- CreateIndex
CREATE INDEX "report_templates_createdBy_idx" ON "report_templates"("createdBy");

-- CreateIndex
CREATE INDEX "audit_snapshots_facilityId_createdAt_idx" ON "audit_snapshots"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "yield_records_facilityId_strainName_idx" ON "yield_records"("facilityId", "strainName");

-- CreateIndex
CREATE INDEX "yield_records_facilityId_stage_idx" ON "yield_records"("facilityId", "stage");

-- CreateIndex
CREATE INDEX "yield_records_facilityId_createdAt_idx" ON "yield_records"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "tolling_agreements_facilityId_status_idx" ON "tolling_agreements"("facilityId", "status");

-- CreateIndex
CREATE INDEX "tolling_agreements_facilityId_createdAt_idx" ON "tolling_agreements"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "tolling_batches_facilityId_status_idx" ON "tolling_batches"("facilityId", "status");

-- CreateIndex
CREATE INDEX "tolling_batches_facilityId_lifecycleStage_idx" ON "tolling_batches"("facilityId", "lifecycleStage");

-- CreateIndex
CREATE INDEX "tolling_batches_agreementId_idx" ON "tolling_batches"("agreementId");

-- CreateIndex
CREATE INDEX "reconciliation_records_facilityId_reconciliationType_idx" ON "reconciliation_records"("facilityId", "reconciliationType");

-- CreateIndex
CREATE INDEX "reconciliation_records_facilityId_status_idx" ON "reconciliation_records"("facilityId", "status");

-- CreateIndex
CREATE INDEX "reconciliation_records_facilityId_createdAt_idx" ON "reconciliation_records"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "opex_models_facilityId_status_idx" ON "opex_models"("facilityId", "status");

-- CreateIndex
CREATE INDEX "opex_models_facilityId_isDefault_idx" ON "opex_models"("facilityId", "isDefault");

-- CreateIndex
CREATE INDEX "opex_models_createdBy_idx" ON "opex_models"("createdBy");

-- CreateIndex
CREATE INDEX "opex_sections_modelId_sortOrder_idx" ON "opex_sections"("modelId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "opex_sections_modelId_slug_key" ON "opex_sections"("modelId", "slug");

-- CreateIndex
CREATE INDEX "opex_cell_groups_sectionId_sortOrder_idx" ON "opex_cell_groups"("sectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "opex_cells_groupId_sortOrder_idx" ON "opex_cells"("groupId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "opex_cells_modelId_key_key" ON "opex_cells"("modelId", "key");

-- CreateIndex
CREATE INDEX "opex_snapshots_modelId_createdAt_idx" ON "opex_snapshots"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "opex_snapshots_createdBy_idx" ON "opex_snapshots"("createdBy");

-- CreateIndex
CREATE INDEX "briefing_snapshots_facilityId_createdAt_idx" ON "briefing_snapshots"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "supply_categories_facilityId_idx" ON "supply_categories"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "supply_categories_facilityId_name_parentId_key" ON "supply_categories"("facilityId", "name", "parentId");

-- CreateIndex
CREATE INDEX "supply_items_facilityId_categoryId_idx" ON "supply_items"("facilityId", "categoryId");

-- CreateIndex
CREATE INDEX "supply_items_facilityId_isActive_idx" ON "supply_items"("facilityId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "supply_items_facilityId_sku_key" ON "supply_items"("facilityId", "sku");

-- CreateIndex
CREATE INDEX "supply_transactions_facilityId_itemId_idx" ON "supply_transactions"("facilityId", "itemId");

-- CreateIndex
CREATE INDEX "supply_transactions_facilityId_createdAt_idx" ON "supply_transactions"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "supply_transactions_itemId_type_idx" ON "supply_transactions"("itemId", "type");

-- CreateIndex
CREATE INDEX "bills_of_material_facilityId_metrcItemName_idx" ON "bills_of_material"("facilityId", "metrcItemName");

-- CreateIndex
CREATE UNIQUE INDEX "bills_of_material_facilityId_metrcItemName_componentItemId_key" ON "bills_of_material"("facilityId", "metrcItemName", "componentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "auto_discount_configs_facilityId_key" ON "auto_discount_configs"("facilityId");

-- CreateIndex
CREATE INDEX "auto_discount_runs_facilityId_createdAt_idx" ON "auto_discount_runs"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "auto_discount_runs_facilityId_status_idx" ON "auto_discount_runs"("facilityId", "status");

-- CreateIndex
CREATE INDEX "auto_discount_runs_configId_idx" ON "auto_discount_runs"("configId");

-- CreateIndex
CREATE UNIQUE INDEX "disposition_policies_facilityId_key" ON "disposition_policies"("facilityId");

-- CreateIndex
CREATE INDEX "disposition_records_facilityId_category_idx" ON "disposition_records"("facilityId", "category");

-- CreateIndex
CREATE INDEX "disposition_records_facilityId_createdAt_idx" ON "disposition_records"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "disposition_records_facilityId_status_idx" ON "disposition_records"("facilityId", "status");

-- CreateIndex
CREATE INDEX "disposition_records_facilityId_status_createdAt_idx" ON "disposition_records"("facilityId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "employees_facilityId_isActive_idx" ON "employees"("facilityId", "isActive");

-- CreateIndex
CREATE INDEX "employees_facilityId_name_idx" ON "employees"("facilityId", "name");

-- CreateIndex
CREATE INDEX "work_logs_facilityId_workDate_idx" ON "work_logs"("facilityId", "workDate");

-- CreateIndex
CREATE INDEX "work_logs_facilityId_skuName_idx" ON "work_logs"("facilityId", "skuName");

-- CreateIndex
CREATE INDEX "work_logs_facilityId_employeeId_idx" ON "work_logs"("facilityId", "employeeId");

-- CreateIndex
CREATE INDEX "work_logs_facilityId_activityType_idx" ON "work_logs"("facilityId", "activityType");

-- CreateIndex
CREATE INDEX "facility_access_userId_idx" ON "facility_access"("userId");

-- CreateIndex
CREATE INDEX "facility_access_facilityId_idx" ON "facility_access"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "facility_access_facilityId_userId_key" ON "facility_access"("facilityId", "userId");

-- CreateIndex
CREATE INDEX "facility_user_credentials_facilityId_idx" ON "facility_user_credentials"("facilityId");

-- CreateIndex
CREATE INDEX "facility_user_credentials_userId_idx" ON "facility_user_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "facility_user_credentials_facilityId_userId_key" ON "facility_user_credentials"("facilityId", "userId");

-- CreateIndex
CREATE INDEX "coa_records_facilityId_packageLabel_idx" ON "coa_records"("facilityId", "packageLabel");

-- CreateIndex
CREATE INDEX "coa_records_facilityId_status_idx" ON "coa_records"("facilityId", "status");

-- CreateIndex
CREATE INDEX "coa_records_facilityId_createdAt_idx" ON "coa_records"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "coa_records_facilityId_isExpired_idx" ON "coa_records"("facilityId", "isExpired");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_configs_facilityId_key" ON "pipeline_configs"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_statuses_configId_name_key" ON "pipeline_statuses"("configId", "name");

-- CreateIndex
CREATE INDEX "transfer_snapshots_facilityId_direction_isActive_idx" ON "transfer_snapshots"("facilityId", "direction", "isActive");

-- CreateIndex
CREATE INDEX "transfer_snapshots_facilityId_manifestNumber_idx" ON "transfer_snapshots"("facilityId", "manifestNumber");

-- CreateIndex
CREATE INDEX "transfer_snapshots_facilityId_metrcLastModified_idx" ON "transfer_snapshots"("facilityId", "metrcLastModified");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_snapshots_facilityId_metrcTransferId_direction_key" ON "transfer_snapshots"("facilityId", "metrcTransferId", "direction");

-- CreateIndex
CREATE INDEX "transfer_delivery_records_transferSnapshotId_isCompleted_idx" ON "transfer_delivery_records"("transferSnapshotId", "isCompleted");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_delivery_records_transferSnapshotId_metrcDeliveryI_key" ON "transfer_delivery_records"("transferSnapshotId", "metrcDeliveryId");

-- CreateIndex
CREATE INDEX "transfer_package_records_deliveryRecordId_packageLabel_idx" ON "transfer_package_records"("deliveryRecordId", "packageLabel");

-- CreateIndex
CREATE INDEX "transfer_package_records_packageLabel_idx" ON "transfer_package_records"("packageLabel");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_package_records_deliveryRecordId_metrcPackageId_key" ON "transfer_package_records"("deliveryRecordId", "metrcPackageId");

-- CreateIndex
CREATE INDEX "item_snapshots_facilityId_isActive_idx" ON "item_snapshots"("facilityId", "isActive");

-- CreateIndex
CREATE INDEX "item_snapshots_facilityId_productCategoryName_idx" ON "item_snapshots"("facilityId", "productCategoryName");

-- CreateIndex
CREATE UNIQUE INDEX "item_snapshots_facilityId_metrcItemId_key" ON "item_snapshots"("facilityId", "metrcItemId");

-- CreateIndex
CREATE INDEX "location_snapshots_facilityId_isActive_idx" ON "location_snapshots"("facilityId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "location_snapshots_facilityId_metrcLocationId_key" ON "location_snapshots"("facilityId", "metrcLocationId");

-- CreateIndex
CREATE INDEX "strain_snapshots_facilityId_isActive_idx" ON "strain_snapshots"("facilityId", "isActive");

-- CreateIndex
CREATE INDEX "strain_snapshots_facilityId_name_idx" ON "strain_snapshots"("facilityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "strain_snapshots_facilityId_metrcStrainId_key" ON "strain_snapshots"("facilityId", "metrcStrainId");

-- CreateIndex
CREATE INDEX "transfer_line_items_facilityId_transferType_idx" ON "transfer_line_items"("facilityId", "transferType");

-- CreateIndex
CREATE INDEX "transfer_line_items_facilityId_itemCategory_idx" ON "transfer_line_items"("facilityId", "itemCategory");

-- CreateIndex
CREATE INDEX "transfer_line_items_facilityId_createdDateTime_idx" ON "transfer_line_items"("facilityId", "createdDateTime");

-- CreateIndex
CREATE INDEX "transfer_line_items_importBatchId_idx" ON "transfer_line_items"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_line_items_facilityId_manifestNumber_itemName_pack_key" ON "transfer_line_items"("facilityId", "manifestNumber", "itemName", "packageLabel");

-- CreateIndex
CREATE INDEX "operator_benchmarks_facilityId_category_idx" ON "operator_benchmarks"("facilityId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "operator_benchmarks_facilityId_category_key_key" ON "operator_benchmarks"("facilityId", "category", "key");

-- CreateIndex
CREATE INDEX "retail_sales_facilityId_soldAt_idx" ON "retail_sales"("facilityId", "soldAt" DESC);

-- CreateIndex
CREATE INDEX "retail_sales_facilityId_finalized_soldAt_idx" ON "retail_sales"("facilityId", "finalized", "soldAt" DESC);

-- CreateIndex
CREATE INDEX "retail_sales_packageLabel_soldAt_idx" ON "retail_sales"("packageLabel", "soldAt" DESC);

-- CreateIndex
CREATE INDEX "retail_sales_facilityId_productCategory_idx" ON "retail_sales"("facilityId", "productCategory");

-- CreateIndex
CREATE UNIQUE INDEX "retail_sales_facilityId_receiptId_packageLabel_key" ON "retail_sales"("facilityId", "receiptId", "packageLabel");

-- CreateIndex
CREATE INDEX "retail_sale_receipts_facilityId_soldAt_idx" ON "retail_sale_receipts"("facilityId", "soldAt" DESC);

-- CreateIndex
CREATE INDEX "retail_sale_receipts_facilityId_customerType_idx" ON "retail_sale_receipts"("facilityId", "customerType");

-- CreateIndex
CREATE UNIQUE INDEX "retail_sale_receipts_facilityId_receiptId_key" ON "retail_sale_receipts"("facilityId", "receiptId");

-- CreateIndex
CREATE INDEX "package_snapshots_facilityId_isActive_packagedDate_idx" ON "package_snapshots"("facilityId", "isActive", "packagedDate");

-- CreateIndex
CREATE INDEX "package_snapshots_facilityId_productCategory_idx" ON "package_snapshots"("facilityId", "productCategory");

-- CreateIndex
CREATE INDEX "package_snapshots_facilityId_itemName_idx" ON "package_snapshots"("facilityId", "itemName");

-- CreateIndex
CREATE INDEX "package_snapshots_facilityId_labTestingState_idx" ON "package_snapshots"("facilityId", "labTestingState");

-- CreateIndex
CREATE INDEX "package_snapshots_facilityId_isOnHold_idx" ON "package_snapshots"("facilityId", "isOnHold");

-- CreateIndex
CREATE INDEX "package_snapshots_facilityId_packageLabel_idx" ON "package_snapshots"("facilityId", "packageLabel");

-- CreateIndex
CREATE UNIQUE INDEX "package_snapshots_facilityId_metrcPackageId_key" ON "package_snapshots"("facilityId", "metrcPackageId");

-- CreateIndex
CREATE INDEX "sync_watermarks_facilityId_endpoint_lastRunAt_idx" ON "sync_watermarks"("facilityId", "endpoint", "lastRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "sync_watermarks_facilityId_endpoint_key" ON "sync_watermarks"("facilityId", "endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "api_call_budgets_yearMonth_key" ON "api_call_budgets"("yearMonth");

-- CreateIndex
CREATE INDEX "plant_snapshots_facilityId_isActive_growthPhase_idx" ON "plant_snapshots"("facilityId", "isActive", "growthPhase");

-- CreateIndex
CREATE INDEX "plant_snapshots_facilityId_strainName_idx" ON "plant_snapshots"("facilityId", "strainName");

-- CreateIndex
CREATE UNIQUE INDEX "plant_snapshots_facilityId_metrcPlantId_key" ON "plant_snapshots"("facilityId", "metrcPlantId");

-- CreateIndex
CREATE INDEX "plant_batch_snapshots_facilityId_isActive_idx" ON "plant_batch_snapshots"("facilityId", "isActive");

-- CreateIndex
CREATE INDEX "plant_batch_snapshots_facilityId_strainName_idx" ON "plant_batch_snapshots"("facilityId", "strainName");

-- CreateIndex
CREATE UNIQUE INDEX "plant_batch_snapshots_facilityId_metrcBatchId_key" ON "plant_batch_snapshots"("facilityId", "metrcBatchId");

-- CreateIndex
CREATE INDEX "harvest_snapshots_facilityId_isActive_idx" ON "harvest_snapshots"("facilityId", "isActive");

-- CreateIndex
CREATE INDEX "harvest_snapshots_facilityId_sourceStrainNames_idx" ON "harvest_snapshots"("facilityId", "sourceStrainNames");

-- CreateIndex
CREATE UNIQUE INDEX "harvest_snapshots_facilityId_metrcHarvestId_key" ON "harvest_snapshots"("facilityId", "metrcHarvestId");

-- CreateIndex
CREATE INDEX "metrc_api_calls_facilityId_ts_idx" ON "metrc_api_calls"("facilityId", "ts" DESC);

-- CreateIndex
CREATE INDEX "metrc_api_calls_facilityId_endpoint_ts_idx" ON "metrc_api_calls"("facilityId", "endpoint", "ts" DESC);

-- CreateIndex
CREATE INDEX "lab_test_snapshots_facilityId_packageLabel_idx" ON "lab_test_snapshots"("facilityId", "packageLabel");

-- CreateIndex
CREATE INDEX "lab_test_snapshots_facilityId_overallPassed_idx" ON "lab_test_snapshots"("facilityId", "overallPassed");

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_snapshots_facilityId_packageId_testTypeName_key" ON "lab_test_snapshots"("facilityId", "packageId", "testTypeName");

-- CreateIndex
CREATE INDEX "runs_organization_id_created_at_idx" ON "runs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "runs_organization_id_status_idx" ON "runs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "runs_user_id_created_at_idx" ON "runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "runs_facility_id_status_idx" ON "runs"("facility_id", "status");

-- CreateIndex
CREATE INDEX "runs_skill_id_organization_id_idx" ON "runs"("skill_id", "organization_id");

-- CreateIndex
CREATE INDEX "runs_conversation_id_created_at_idx" ON "runs"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_run_id_idx" ON "artifacts"("run_id");

-- CreateIndex
CREATE INDEX "artifacts_organization_id_type_created_at_idx" ON "artifacts"("organization_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_facility_id_type_idx" ON "artifacts"("facility_id", "type");

-- CreateIndex
CREATE INDEX "artifacts_organization_id_pinned_at_idx" ON "artifacts"("organization_id", "pinned_at");

-- CreateIndex
CREATE INDEX "artifact_versions_artifact_id_created_at_idx" ON "artifact_versions"("artifact_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_created_at_idx" ON "notifications"("user_id", "read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_created_at_idx" ON "notifications"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_run_id_idx" ON "notifications"("run_id");

-- CreateIndex
CREATE INDEX "conversations_organization_id_last_message_at_idx" ON "conversations"("organization_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_user_id_last_message_at_idx" ON "conversations"("user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_facility_id_last_message_at_idx" ON "conversations"("facility_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_created_at_idx" ON "conversation_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_messages_run_id_idx" ON "conversation_messages"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "copilot_org_settings_organization_id_key" ON "copilot_org_settings"("organization_id");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_domain_events" ADD CONSTRAINT "organization_domain_events_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "organization_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrc_sync_logs" ADD CONSTRAINT "metrc_sync_logs_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_rules" ADD CONSTRAINT "business_rules_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "business_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_logs" ADD CONSTRAINT "action_logs_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_snapshots" ADD CONSTRAINT "audit_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yield_records" ADD CONSTRAINT "yield_records_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tolling_agreements" ADD CONSTRAINT "tolling_agreements_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tolling_batches" ADD CONSTRAINT "tolling_batches_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tolling_batches" ADD CONSTRAINT "tolling_batches_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "tolling_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opex_models" ADD CONSTRAINT "opex_models_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opex_sections" ADD CONSTRAINT "opex_sections_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "opex_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opex_sections" ADD CONSTRAINT "opex_sections_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "opex_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opex_cell_groups" ADD CONSTRAINT "opex_cell_groups_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "opex_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opex_cells" ADD CONSTRAINT "opex_cells_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "opex_cell_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opex_snapshots" ADD CONSTRAINT "opex_snapshots_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "opex_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_snapshots" ADD CONSTRAINT "briefing_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_categories" ADD CONSTRAINT "supply_categories_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_categories" ADD CONSTRAINT "supply_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "supply_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_items" ADD CONSTRAINT "supply_items_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_items" ADD CONSTRAINT "supply_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "supply_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_transactions" ADD CONSTRAINT "supply_transactions_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_transactions" ADD CONSTRAINT "supply_transactions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "supply_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_material" ADD CONSTRAINT "bills_of_material_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_material" ADD CONSTRAINT "bills_of_material_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "supply_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_discount_configs" ADD CONSTRAINT "auto_discount_configs_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_discount_runs" ADD CONSTRAINT "auto_discount_runs_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_discount_runs" ADD CONSTRAINT "auto_discount_runs_configId_fkey" FOREIGN KEY ("configId") REFERENCES "auto_discount_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposition_policies" ADD CONSTRAINT "disposition_policies_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposition_records" ADD CONSTRAINT "disposition_records_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_access" ADD CONSTRAINT "facility_access_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_user_credentials" ADD CONSTRAINT "facility_user_credentials_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coa_records" ADD CONSTRAINT "coa_records_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_configs" ADD CONSTRAINT "pipeline_configs_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_statuses" ADD CONSTRAINT "pipeline_statuses_configId_fkey" FOREIGN KEY ("configId") REFERENCES "pipeline_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_snapshots" ADD CONSTRAINT "transfer_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_delivery_records" ADD CONSTRAINT "transfer_delivery_records_transferSnapshotId_fkey" FOREIGN KEY ("transferSnapshotId") REFERENCES "transfer_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_package_records" ADD CONSTRAINT "transfer_package_records_deliveryRecordId_fkey" FOREIGN KEY ("deliveryRecordId") REFERENCES "transfer_delivery_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_snapshots" ADD CONSTRAINT "item_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_snapshots" ADD CONSTRAINT "location_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strain_snapshots" ADD CONSTRAINT "strain_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_line_items" ADD CONSTRAINT "transfer_line_items_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_benchmarks" ADD CONSTRAINT "operator_benchmarks_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retail_sales" ADD CONSTRAINT "retail_sales_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retail_sale_receipts" ADD CONSTRAINT "retail_sale_receipts_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_snapshots" ADD CONSTRAINT "package_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_watermarks" ADD CONSTRAINT "sync_watermarks_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_snapshots" ADD CONSTRAINT "plant_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_batch_snapshots" ADD CONSTRAINT "plant_batch_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_snapshots" ADD CONSTRAINT "harvest_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_snapshots" ADD CONSTRAINT "lab_test_snapshots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "metrc_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

