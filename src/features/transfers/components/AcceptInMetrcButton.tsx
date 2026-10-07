'use client'

import { useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { getMetrcWebUrl } from '@/services/metrc/metrc-web-urls'

interface AcceptInMetrcButtonProps {
  stateCode: string
  environment: string
  licenseNumber: string
}

export function AcceptInMetrcButton({
  stateCode,
  environment,
  licenseNumber,
}: AcceptInMetrcButtonProps) {
  const [clicked, setClicked] = useState(false)
  const utils = trpc.useUtils()

  const url = getMetrcWebUrl({
    stateCode,
    environment,
    licenseNumber,
    section: 'transfers-incoming',
  })

  // No Metrc web UI available (mock, sandbox, or unknown state)
  if (!url) return null

  const handleOpenMetrc = () => {
    window.open(url, '_blank', 'noopener,noreferrer')
    setClicked(true)
  }

  const handleRefresh = () => {
    utils.transfers.getIncoming.invalidate()
    utils.transfers.getDeliveries.invalidate()
    utils.transfers.getSummary.invalidate()
    setClicked(false)
  }

  if (clicked) {
    return (
      <button
        onClick={handleRefresh}
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 text-emerald-500 px-2.5 py-1 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        Done? Refresh to verify
      </button>
    )
  }

  return (
    <button
      onClick={handleOpenMetrc}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium hover:bg-primary/20 transition-colors"
      title="Opens Metrc -- acceptance must be done in the Metrc interface"
    >
      <ExternalLink className="h-3 w-3" />
      Accept in Metrc
    </button>
  )
}
