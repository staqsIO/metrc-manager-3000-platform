'use client'

import { useState, useCallback } from 'react'
import { trpc } from '@/lib/trpc-client'
import type { BulkActionState, BulkActionType, AdjustmentInput, AdjustmentPreview, FinishPreview } from '@/services/actions/action-types'

const initialState: BulkActionState = {
  type: null,
  status: 'idle',
  selectedLabels: [],
  previews: [],
  error: null,
}

export function useBulkAction(facilityId: string) {
  const [state, setState] = useState<BulkActionState>(initialState)
  const utils = trpc.useUtils()

  const adjustMutation = trpc.inventory.adjustPackages.useMutation({
    onSuccess: () => {
      utils.inventory.getActive.invalidate()
      utils.inventory.getAgingSummary.invalidate()
    },
  })

  const finishMutation = trpc.inventory.finishPackages.useMutation({
    onSuccess: () => {
      utils.inventory.getActive.invalidate()
      utils.inventory.getAgingSummary.invalidate()
    },
  })

  const startAction = useCallback((type: BulkActionType, labels: string[]) => {
    setState({
      type,
      status: 'previewing',
      selectedLabels: labels,
      previews: [],
      error: null,
    })
  }, [])

  const preview = useCallback(async (adjustments?: AdjustmentInput[]) => {
    try {
      if (state.type === 'adjust' && adjustments) {
        const result = await adjustMutation.mutateAsync({
          facilityId,
          adjustments,
          confirmed: false,
        })
        if (result.status === 'preview') {
          setState(prev => ({
            ...prev,
            status: 'confirming',
            previews: result.previews as AdjustmentPreview[],
          }))
        }
      } else if (state.type === 'finish') {
        const result = await finishMutation.mutateAsync({
          facilityId,
          labels: state.selectedLabels,
          confirmed: false,
        })
        if (result.status === 'preview') {
          setState(prev => ({
            ...prev,
            status: 'confirming',
            previews: result.previews as FinishPreview[],
          }))
        }
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'Preview failed',
      }))
    }
  }, [state.type, state.selectedLabels, facilityId, adjustMutation, finishMutation])

  const confirm = useCallback(async (adjustments?: AdjustmentInput[]) => {
    setState(prev => ({ ...prev, status: 'executing' }))
    try {
      let verified: boolean | undefined;
      if (state.type === 'adjust' && adjustments) {
        const result = await adjustMutation.mutateAsync({
          facilityId,
          adjustments,
          confirmed: true,
        })
        if ('verified' in result) verified = result.verified ?? undefined;
      } else if (state.type === 'finish') {
        const result = await finishMutation.mutateAsync({
          facilityId,
          labels: state.selectedLabels,
          confirmed: true,
        })
        if ('verified' in result) verified = result.verified ?? undefined;
      }
      setState(prev => ({
        ...prev,
        status: verified === true ? 'verified' : verified === false ? 'unverified' : 'completed',
        verified,
      }))
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'Execution failed',
      }))
    }
  }, [state.type, state.selectedLabels, facilityId, adjustMutation, finishMutation])

  const reset = useCallback(() => {
    setState(initialState)
  }, [])

  return {
    ...state,
    isLoading: adjustMutation.isPending || finishMutation.isPending,
    startAction,
    preview,
    confirm,
    reset,
  }
}
