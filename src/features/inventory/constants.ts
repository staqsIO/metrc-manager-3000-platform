export type AgeCategory = 'fresh' | 'normal' | 'aging' | 'critical'

export const AGE_BADGE_STYLES: Record<AgeCategory, string> = {
  fresh: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  normal: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  aging: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  critical: 'bg-red-500/10 text-red-500 border-red-500/20',
}
