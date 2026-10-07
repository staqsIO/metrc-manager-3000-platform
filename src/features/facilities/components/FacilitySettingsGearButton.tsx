'use client'

import { useState } from 'react'
import { Settings } from 'lucide-react'
import { FacilitySettingsModal } from './FacilitySettingsModal'

export function FacilitySettingsGearButton({
  facilityId,
  facilityName,
}: {
  facilityId: string
  facilityName: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Facility settings"
      >
        <Settings className="h-4 w-4" />
      </button>
      <FacilitySettingsModal
        open={open}
        onOpenChange={setOpen}
        facilityId={facilityId}
        facilityName={facilityName}
      />
    </>
  )
}
