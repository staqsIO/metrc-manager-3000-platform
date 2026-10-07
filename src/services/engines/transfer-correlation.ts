/**
 * transfer-correlation.ts — Correlate packages to incoming/outgoing transfers.
 *
 * Incoming correlation (high confidence): matches pkg.ReceivedFromManifestNumber
 * against incomingTransfers[].ManifestNumber — authoritative Metrc data.
 *
 * Outgoing correlation (heuristic): for consumed packages, matches by date
 * proximity to outgoing transfers from the same facility.
 */

import type { MetrcPackage, MetrcTransfer } from '../metrc/types'

export interface TransferLink {
  packageLabel: string
  direction: 'incoming' | 'outgoing'
  manifestNumber: string
  counterpartyFacility: string
  counterpartyLicense: string
  transferDate: string | null
  packageCount: number
  confidence: 'confirmed' | 'likely'
}

/**
 * Correlate a package to incoming and outgoing transfers.
 * O(I + O) where I = incoming transfers, O = outgoing transfers.
 */
export function correlateTransfers(
  pkg: MetrcPackage,
  incomingTransfers: MetrcTransfer[],
  outgoingTransfers: MetrcTransfer[],
): TransferLink[] {
  const links: TransferLink[] = []

  // --- Incoming correlation (high confidence) ---
  // Direct match on ReceivedFromManifestNumber — authoritative Metrc field
  if (pkg.ReceivedFromManifestNumber) {
    const matched = incomingTransfers.find(
      (t) => t.ManifestNumber === pkg.ReceivedFromManifestNumber,
    )
    if (matched) {
      links.push({
        packageLabel: pkg.Label,
        direction: 'incoming',
        manifestNumber: matched.ManifestNumber,
        counterpartyFacility: matched.ShipperFacilityName,
        counterpartyLicense: matched.ShipperFacilityLicenseNumber,
        transferDate: matched.ReceivedDateTime ?? matched.EstimatedArrivalDateTime,
        packageCount: matched.PackageCount,
        confidence: 'confirmed',
      })
    } else {
      // Manifest number exists but no matching transfer in our data —
      // still report what we know from the package fields
      links.push({
        packageLabel: pkg.Label,
        direction: 'incoming',
        manifestNumber: pkg.ReceivedFromManifestNumber,
        counterpartyFacility: pkg.ReceivedFromFacilityName ?? 'Unknown',
        counterpartyLicense: pkg.ReceivedFromFacilityLicenseNumber ?? 'Unknown',
        transferDate: pkg.ReceivedDateTime ?? null,
        packageCount: 1,
        confidence: 'confirmed',
      })
    }
  }

  // --- Outgoing correlation (heuristic) ---
  // For fully consumed packages (Quantity === 0), look for outgoing transfers
  // near the package's last modified date. This is approximate.
  if (pkg.Quantity === 0 && pkg.LastModified && outgoingTransfers.length > 0) {
    const pkgDate = new Date(pkg.LastModified).getTime()
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

    for (const transfer of outgoingTransfers) {
      const transferDate = new Date(
        transfer.EstimatedDepartureDateTime ?? transfer.CreatedDateTime,
      ).getTime()
      if (Math.abs(pkgDate - transferDate) <= THREE_DAYS_MS) {
        links.push({
          packageLabel: pkg.Label,
          direction: 'outgoing',
          manifestNumber: transfer.ManifestNumber,
          counterpartyFacility: transfer.ReceiverFacilityName,
          counterpartyLicense: transfer.ReceiverFacilityLicenseNumber,
          transferDate:
            transfer.EstimatedDepartureDateTime || transfer.CreatedDateTime,
          packageCount: transfer.PackageCount,
          confidence: 'likely',
        })
        // Heuristic: take the first transfer within the 3-day window.
        // This is intentionally approximate — outgoing correlation is best-effort.
        break
      }
    }
  }

  return links
}
