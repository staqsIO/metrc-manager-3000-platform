export function getEnvironmentDotColor(env: string, isActive?: boolean): string {
  if (env === 'production') return 'bg-emerald-500'
  if (env === 'sandbox') return 'bg-blue-500'
  if (env === 'none') return 'bg-zinc-400'
  if (isActive === false) return 'bg-red-500'
  return 'bg-yellow-500'
}

export function getEnvironmentLabel(env: string): string {
  if (env === 'production') return 'Production'
  if (env === 'sandbox') return 'Sandbox'
  if (env === 'none') return 'None'
  return 'Mock'
}

export function getEnvironmentBadgeClasses(env: string): string {
  if (env === 'production') return 'status-active'
  if (env === 'sandbox') return 'status-info'
  if (env === 'none') return 'bg-zinc-400/20 text-zinc-400 border border-zinc-400/30'
  return 'status-warning'
}

export function getEnvironmentPillClasses(env: string): string {
  if (env === 'production') return 'ring-emerald-500/20 bg-emerald-500/10 text-emerald-500'
  if (env === 'sandbox') return 'ring-blue-500/20 bg-blue-500/10 text-blue-500'
  if (env === 'none') return 'ring-zinc-400/20 bg-zinc-400/10 text-zinc-400'
  return 'ring-yellow-500/20 bg-yellow-500/10 text-yellow-500'
}
