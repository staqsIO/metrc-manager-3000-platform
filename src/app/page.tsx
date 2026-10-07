import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { isMetrcPlatformEnabled } from '@/lib/feature-flags'

export default async function Home() {
  if (!isMetrcPlatformEnabled()) {
    redirect('/unavailable')
  }

  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin')
  }

  redirect('/executive')
}
