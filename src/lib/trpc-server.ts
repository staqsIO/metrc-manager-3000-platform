import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createCallerFactory } from '@/lib/trpc';
import { appRouter } from '@/server/api/root';
import { prisma } from '@/lib/prisma';
import { ACTIVE_ORG_COOKIE } from '@/lib/active-org';

const createCaller = createCallerFactory(appRouter);

/**
 * Server-side tRPC caller for use in Server Components.
 * Cached per request via React.cache — safe to call multiple times.
 * Redirects to signin if no session exists.
 */
export const createServerCaller = cache(async () => {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/auth/signin');
  }
  const cookieStore = cookies();
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;
  return createCaller({ prisma, session, activeOrgId });
});
