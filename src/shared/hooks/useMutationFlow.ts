'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

export type MutationStep = 'idle' | 'form' | 'previewing' | 'confirming' | 'executing' | 'completed' | 'error'

export interface UseMutationFlowOptions<TInput, TPreview> {
  /** Call the mutation — must accept { ...input, confirmed: boolean } */
  mutationFn: (input: TInput & { confirmed: boolean }) => Promise<unknown>
  /** Extract previews from the mutation result when confirmed=false */
  getPreview: (result: unknown) => TPreview[]
  onSuccess?: () => void
  onError?: (error: string) => void
  /** Auto-close delay in ms after completion (default 1500) */
  autoCloseMs?: number
}

export interface MutationFlowState<TInput, TPreview> {
  step: MutationStep
  previews: TPreview[] | null
  error: string | null
  isLoading: boolean
  input: Partial<TInput> | null
  open: (initialInput?: Partial<TInput>) => void
  preview: (input: TInput) => void
  confirm: () => void
  reset: () => void
}

export function useMutationFlow<TInput, TPreview>(
  options: UseMutationFlowOptions<TInput, TPreview>,
): MutationFlowState<TInput, TPreview> {
  const [step, setStep] = useState<MutationStep>('idle')
  const [previews, setPreviews] = useState<TPreview[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [input, setInput] = useState<Partial<TInput> | null>(null)
  const lastInputRef = useRef<TInput | null>(null)
  const executingRef = useRef(false)

  // Stable refs for callbacks to avoid stale closures in timers and memoized functions
  const optionsRef = useRef(options)
  optionsRef.current = options

  const { autoCloseMs = 1500 } = options

  // Auto-close after completion
  useEffect(() => {
    if (step === 'completed') {
      const timer = setTimeout(() => {
        setStep('idle')
        setPreviews(null)
        setInput(null)
        optionsRef.current.onSuccess?.()
      }, autoCloseMs)
      return () => clearTimeout(timer)
    }
  }, [step, autoCloseMs])

  const open = useCallback((initialInput?: Partial<TInput>) => {
    setStep('form')
    setError(null)
    setPreviews(null)
    setInput(initialInput ?? null)
    lastInputRef.current = null
  }, [])

  const preview = useCallback(async (formInput: TInput) => {
    if (executingRef.current) return
    executingRef.current = true
    setStep('previewing')
    setIsLoading(true)
    setError(null)
    lastInputRef.current = formInput

    try {
      const result = await optionsRef.current.mutationFn({ ...formInput, confirmed: false })
      const previewData = optionsRef.current.getPreview(result)
      setPreviews(previewData)
      setStep('confirming')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Preview failed'
      setError(msg)
      setStep('error')
      optionsRef.current.onError?.(msg)
    } finally {
      setIsLoading(false)
      executingRef.current = false
    }
  }, [])

  const confirm = useCallback(async () => {
    if (!lastInputRef.current || executingRef.current) return
    executingRef.current = true
    setStep('executing')
    setIsLoading(true)
    setError(null)

    try {
      await optionsRef.current.mutationFn({ ...lastInputRef.current, confirmed: true })
      setStep('completed')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution failed'
      setError(msg)
      setStep('error')
      optionsRef.current.onError?.(msg)
    } finally {
      setIsLoading(false)
      executingRef.current = false
    }
  }, [])

  const reset = useCallback(() => {
    setStep('idle')
    setPreviews(null)
    setError(null)
    setIsLoading(false)
    setInput(null)
    lastInputRef.current = null
    executingRef.current = false
  }, [])

  return {
    step,
    previews,
    error,
    isLoading,
    input,
    open,
    preview,
    confirm,
    reset,
  }
}
