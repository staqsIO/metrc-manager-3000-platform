import { createNextApiHandler } from '@trpc/server/adapters/next';
import { appRouter } from '@/server/api/root';
import { createTRPCContext } from '@/lib/trpc';

export default createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
  onError: ({ path, error }) => {
    console.error(`tRPC error on ${path}:`, error);
  },
});
