import type { Metadata } from 'next'
import { Inter, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import LeftSidebar from '@/shared/components/LeftSidebar'
import MainContent from '@/shared/components/MainContent'
import Providers from '@/shared/components/Providers'
import EnvironmentBanner from '@/shared/components/EnvironmentBanner'
import DomainVerifyBanner from '@/shared/components/DomainVerifyBanner'
import { CopilotProvider } from '@/features/copilot/CopilotContext'
import CopilotSidebar from '@/features/copilot/components/CopilotSidebar'
import { PackageModalProvider } from '@/features/inventory/PackageModalContext'
import PackageDetailModal from '@/features/inventory/components/PackageDetailModal'
import CommandPalette from '@/shared/components/CommandPalette'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getBrand } from '@/lib/brand'

// UI face — Inter for chrome, labels, body copy
const fontUI = Inter({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
})

// Numeric face — IBM Plex Mono for KPIs, table cells, package tags, dollar
// amounts. Tabular numerals align quantity columns naturally; reads as
// "this number was measured, not estimated."
const fontNumeric = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-numeric',
  display: 'swap',
})

export const metadata: Metadata = {
  // Brand is a build-time setting (NEXT_PUBLIC_BRAND_*).
  title: getBrand().name,
  description: 'Cannabis compliance and inventory intelligence platform powered by Metrc',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  const isAuthenticated = !!session

  return (
    <html lang="en" className={`dark ${fontUI.variable} ${fontNumeric.variable}`}>
      <body className="font-sans bg-background text-foreground">
        <Providers>
          <CopilotProvider>
            <PackageModalProvider>
              {isAuthenticated && <LeftSidebar />}
              <MainContent isAuthenticated={isAuthenticated}>
                {isAuthenticated && <EnvironmentBanner />}
                {isAuthenticated && <DomainVerifyBanner />}
                {children}
              </MainContent>
              {isAuthenticated && <CommandPalette />}
              {isAuthenticated && <CopilotSidebar />}
              {isAuthenticated && <PackageDetailModal />}
            </PackageModalProvider>
          </CopilotProvider>
        </Providers>
      </body>
    </html>
  )
}
