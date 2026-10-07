'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Plus,
  Copy,
  Camera,
  MoreHorizontal,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelSummary {
  id: string
  name: string
  status: string
}

interface OpExModelSwitcherProps {
  facilityId: string
  currentModelId: string
  currentModelName: string
  currentModelStatus: string
  models: ModelSummary[]
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
    case 'DRAFT':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
    case 'ARCHIVED':
      return 'bg-gray-500/10 text-gray-500 border-gray-500/20'
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OpExModelSwitcher({
  facilityId,
  currentModelId,
  currentModelName,
  currentModelStatus,
  models,
}: OpExModelSwitcherProps) {
  const router = useRouter()
  const utils = trpc.useUtils()

  // Dialog states
  const [showCreate, setShowCreate] = useState(false)
  const [showDuplicate, setShowDuplicate] = useState(false)
  const [showSnapshot, setShowSnapshot] = useState(false)

  // Form state
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [dupName, setDupName] = useState('')
  const [snapName, setSnapName] = useState('')
  const [snapNotes, setSnapNotes] = useState('')

  // Mutations
  const createMutation = trpc.opex.createModel.useMutation({
    onSuccess: (model) => {
      utils.opex.listModels.invalidate({ facilityId })
      setShowCreate(false)
      setNewName('')
      setNewDescription('')
      router.push(`/facilities/${facilityId}/opex/${model.id}`)
    },
  })

  const duplicateMutation = trpc.opex.duplicateModel.useMutation({
    onSuccess: (model) => {
      utils.opex.listModels.invalidate({ facilityId })
      setShowDuplicate(false)
      setDupName('')
      router.push(`/facilities/${facilityId}/opex/${model.id}`)
    },
  })

  const snapshotMutation = trpc.opex.saveSnapshot.useMutation({
    onSuccess: () => {
      setShowSnapshot(false)
      setSnapName('')
      setSnapNotes('')
    },
  })

  const handleModelSwitch = (modelId: string) => {
    if (modelId !== currentModelId) {
      router.push(`/facilities/${facilityId}/opex/${modelId}`)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50">
      {/* Model Selector */}
      <Select value={currentModelId} onValueChange={handleModelSwitch}>
        <SelectTrigger className="w-64 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <span className="flex items-center gap-2">
                {m.name}
                <Badge
                  variant="outline"
                  className={cn('text-[10px] py-0 px-1.5', statusBadgeClass(m.status))}
                >
                  {m.status}
                </Badge>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status Badge */}
      <Badge
        variant="outline"
        className={cn('text-xs', statusBadgeClass(currentModelStatus))}
      >
        {currentModelStatus}
      </Badge>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action Buttons */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowSnapshot(true)}
        className="gap-1.5"
      >
        <Camera className="h-3.5 w-3.5" />
        Snapshot
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Model
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setDupName(currentModelName + ' (Copy)')
            setShowDuplicate(true)
          }}>
            <Copy className="h-4 w-4 mr-2" />
            Duplicate Model
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowSnapshot(true)}>
            <Camera className="h-4 w-4 mr-2" />
            Save Snapshot
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Model Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New OpEx Model</DialogTitle>
            <DialogDescription>
              A new model will be created from the default cannabis operations template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Model Name</label>
              <input
                type="text"
                className="w-full p-2 rounded-md border border-border bg-background text-sm"
                placeholder="e.g. Q1 2025 Forecast"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Description (optional)</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                placeholder="Brief description of this model..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({ facilityId, name: newName, description: newDescription || undefined })}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Model'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Model Dialog */}
      <Dialog open={showDuplicate} onOpenChange={setShowDuplicate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate Model</DialogTitle>
            <DialogDescription>
              Create a copy of &quot;{currentModelName}&quot; with all current values.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm text-muted-foreground block mb-1">New Name</label>
            <input
              type="text"
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDuplicate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => duplicateMutation.mutate({ facilityId, modelId: currentModelId, newName: dupName })}
              disabled={!dupName.trim() || duplicateMutation.isPending}
            >
              {duplicateMutation.isPending ? 'Duplicating...' : 'Duplicate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Snapshot Dialog */}
      <Dialog open={showSnapshot} onOpenChange={setShowSnapshot}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Snapshot</DialogTitle>
            <DialogDescription>
              Save the current state of all values for future reference.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Snapshot Name</label>
              <input
                type="text"
                className="w-full p-2 rounded-md border border-border bg-background text-sm"
                placeholder="e.g. Baseline - Jan 2025"
                value={snapName}
                onChange={(e) => setSnapName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Notes (optional)</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                placeholder="What changed or why you are saving this snapshot..."
                value={snapNotes}
                onChange={(e) => setSnapNotes(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSnapshot(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => snapshotMutation.mutate({ facilityId, modelId: currentModelId, name: snapName, notes: snapNotes || undefined })}
              disabled={!snapName.trim() || snapshotMutation.isPending}
            >
              {snapshotMutation.isPending ? 'Saving...' : 'Save Snapshot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
