'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { RulesEditor } from '@/features/settings/components/RulesEditor'
import { Shield, Building2, Loader2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'

export default function BusinessRulesPage() {
  const { data: facilities, isLoading } = trpc.facility.list.useQuery()
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null)

  // Auto-select first facility once loaded
  const facilityId = selectedFacilityId ?? facilities?.[0]?.id ?? null

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Business Rules</h1>
          <p className="text-muted-foreground mt-1">
            Configurable business rules for compliance, aging, and inventory
          </p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!facilities || facilities.length === 0) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Business Rules</h1>
          <p className="text-muted-foreground mt-1">
            Configurable business rules for compliance, aging, and inventory
          </p>
        </div>
        <div className="card-modern p-12 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Facilities Found</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Add a facility first before configuring business rules. Business
            rules are scoped to individual facilities.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Business Rules</h1>
          <p className="text-muted-foreground mt-1">
            Configurable business rules for compliance, aging, and inventory
          </p>
        </div>

        {facilities.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Facility:</span>
            <Select
              value={facilityId ?? undefined}
              onValueChange={(val) => setSelectedFacilityId(val)}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select facility" />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((f: { id: string; name: string; licenseNumber: string }) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {facilityId ? (
        <RulesEditor facilityId={facilityId} />
      ) : (
        <div className="card-modern p-12 text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Select a Facility</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Choose a facility from the dropdown above to view and manage its
            business rules.
          </p>
        </div>
      )}
    </div>
  )
}
