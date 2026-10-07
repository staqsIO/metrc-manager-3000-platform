'use client'

import { useCopilot } from '@/features/copilot/CopilotContext'
import { Breadcrumbs } from '@/shared/components/Breadcrumbs'

export default function MainContent({
  isAuthenticated,
  children,
}: {
  isAuthenticated: boolean
  children: React.ReactNode
}) {
  const { isOpen, isExpanded } = useCopilot()

  return (
    <main
      data-sidebar-open={isAuthenticated && isOpen ? 'true' : undefined}
      className={`min-h-screen bg-background transition-[margin] duration-200 ${
        isAuthenticated ? 'ml-64' : ''
      } ${isAuthenticated && isOpen && !isExpanded ? 'mr-[380px]' : ''}`}
    >
      {isAuthenticated && <Breadcrumbs />}
      {children}
    </main>
  )
}
