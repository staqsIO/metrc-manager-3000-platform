import { TRPCError } from '@trpc/server';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isMetrcPlatformEnabled } from '@/lib/feature-flags';
import { createServerCaller } from '@/lib/trpc-server';
import { notFound } from 'next/navigation';

export default async function FacilityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { facilityId: string };
}) {
  if (!isMetrcPlatformEnabled()) {
    redirect('/unavailable');
  }

  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/auth/signin');
  }

  const caller = await createServerCaller();
  try {
    await caller.facility.getById({ facilityId: params.facilityId });
  } catch (error) {
    if (error instanceof TRPCError && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) {
      notFound();
    }
    throw error;
  }

  // Facility header bar merged into Breadcrumbs component (shared/components/Breadcrumbs.tsx)
  return <>{children}</>;
}
