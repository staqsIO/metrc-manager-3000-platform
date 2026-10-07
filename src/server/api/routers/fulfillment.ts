import { z } from 'zod';
import { createTRPCRouter, facilityProcedure } from '@/lib/trpc';
import { assessFulfillmentRisk } from '@/services/engines/fulfillment-risk';
import {
  getActivePackagesFromDb,
  getIncomingTransfersFromDb,
  getOutgoingTransfersFromDb,
} from '@/services/metrc/snapshot-utils';

export const fulfillmentRouter = createTRPCRouter({
  riskAssessment: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [packages, outgoing, incoming] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getOutgoingTransfersFromDb(ctx.prisma, input.facilityId),
        getIncomingTransfersFromDb(ctx.prisma, input.facilityId),
      ]);
      return assessFulfillmentRisk(packages, outgoing, incoming);
    }),
});
