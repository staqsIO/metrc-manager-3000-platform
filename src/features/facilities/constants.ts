import type { MetrcEnvironment } from '@/lib/facility-context'

export const ENV_CONFIG: Record<MetrcEnvironment, { label: string; color: string; bgColor: string; dotColor: string }> = {
  none: { label: 'None', color: 'text-zinc-400', bgColor: 'bg-zinc-400/10', dotColor: 'bg-zinc-400' },
  mock: { label: 'Mock', color: 'text-yellow-500', bgColor: 'bg-yellow-500/10', dotColor: 'bg-yellow-500' },
  sandbox: { label: 'Sandbox', color: 'text-blue-500', bgColor: 'bg-blue-500/10', dotColor: 'bg-blue-500' },
  production: { label: 'Production', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10', dotColor: 'bg-emerald-500' },
}

export const US_STATES = [
  'AZ', 'CA', 'CO', 'MA', 'MD', 'MI', 'MT', 'NJ', 'NV', 'OK', 'OR', 'UT', 'VT',
] as const
