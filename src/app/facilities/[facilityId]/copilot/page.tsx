'use client'

import { useParams } from 'next/navigation'
import { useCopilot } from '@/features/copilot/CopilotContext'
import CopilotPanel from '@/features/copilot/components/CopilotPanel'
import { ToolCatalog } from '@/features/copilot/components/ToolCatalog'

export default function CopilotPage() {
  const params = useParams()
  const facilityId = (params?.facilityId as string) || null
  const { open: openCopilot } = useCopilot()

  const handleToolSelect = (query: string) => {
    openCopilot(query)
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Tool Catalog Sidebar */}
      <div className="w-72 border-r border-border bg-card shrink-0 overflow-hidden flex flex-col">
        <ToolCatalog onSelectTool={handleToolSelect} />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <CopilotPanel facilityId={facilityId} isFullPage />
      </div>
    </div>
  )
}
