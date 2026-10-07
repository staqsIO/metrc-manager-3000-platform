import { createTRPCRouter } from '@/lib/trpc';
import { facilityRouter } from './routers/facility';
import { inventoryRouter } from './routers/inventory';
import { complianceRouter } from './routers/compliance';
import { operationsRouter } from './routers/operations';
import { analyticsRouter } from './routers/analytics';
import { packagesRouter } from './routers/packages';
import { fulfillmentRouter } from './routers/fulfillment';
import { tollingRouter } from './routers/tolling';
import { reportsRouter } from './routers/reports';
import { rulesRouter } from './routers/rules';
import { syncRouter } from './routers/sync';
import { copilotRouter } from './routers/copilot';
import { adminRouter } from './routers/admin';
import { harvestsRouter } from './routers/harvests';
import { plantBatchesRouter } from './routers/plant-batches';
import { processingRouter } from './routers/processing';
import { opexRouter } from './routers/opex';
import { supplyRouter } from './routers/supply';
import { salesRouter } from './routers/sales';
import { financialRouter } from './routers/financial';
import { runRatesRouter } from './routers/run-rates';
import { crossFacilityRouter } from './routers/cross-facility';
import { dutchieBulkRouter } from './routers/dutchie-bulk';
import { discountRouter } from './routers/discount';
import { autoDiscountRouter } from './routers/auto-discount';
import { reconciliationRouter } from './routers/reconciliation';
import { tagsRouter } from './routers/tags';
import { transfersRouter } from './routers/transfers';
import { plantsRouter } from './routers/plants';
import { labTestsRouter } from './routers/lab-tests';
import { catalogRouter } from './routers/catalog';
import { organizationRouter } from './routers/organization';
import { organizationDomainRouter } from './routers/organization-domain';
import { laborRouter } from './routers/labor';
import { coaRouter } from './routers/coa';
import { dispositionRouter } from './routers/disposition';
import { pipelineRouter } from './routers/pipeline';
import { wasteRouter } from './routers/waste';
import { canixRouter } from './routers/canix';
import { strainsRouter } from './routers/strains';
import { intelligenceRouter } from './routers/intelligence';
import { runsRouter } from './routers/runs';
import { artifactsRouter } from './routers/artifacts';
import { notificationsRouter } from './routers/notifications';
import { conversationsRouter } from './routers/conversations';
import { observabilityRouter } from './routers/observability';
import { llmProvidersRouter } from './routers/llm-providers';

export const appRouter = createTRPCRouter({
  facility: facilityRouter,
  inventory: inventoryRouter,
  compliance: complianceRouter,
  operations: operationsRouter,
  analytics: analyticsRouter,
  packages: packagesRouter,
  fulfillment: fulfillmentRouter,
  tolling: tollingRouter,
  reports: reportsRouter,
  rules: rulesRouter,
  sync: syncRouter,
  copilot: copilotRouter,
  admin: adminRouter,
  harvests: harvestsRouter,
  plantBatches: plantBatchesRouter,
  processing: processingRouter,
  opex: opexRouter,
  supply: supplyRouter,
  sales: salesRouter,
  financial: financialRouter,
  runRates: runRatesRouter,
  crossFacility: crossFacilityRouter,
  dutchieBulk: dutchieBulkRouter,
  discount: discountRouter,
  autoDiscount: autoDiscountRouter,
  reconciliation: reconciliationRouter,
  tags: tagsRouter,
  transfers: transfersRouter,
  plants: plantsRouter,
  labTests: labTestsRouter,
  catalog: catalogRouter,
  organization: organizationRouter,
  organizationDomain: organizationDomainRouter,
  labor: laborRouter,
  coa: coaRouter,
  disposition: dispositionRouter,
  pipeline: pipelineRouter,
  waste: wasteRouter,
  canix: canixRouter,
  strains: strainsRouter,
  intelligence: intelligenceRouter,
  runs: runsRouter,
  artifacts: artifactsRouter,
  notifications: notificationsRouter,
  conversations: conversationsRouter,
  observability: observabilityRouter,
  llmProviders: llmProvidersRouter,
});

export type AppRouter = typeof appRouter;
