import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Cannabis industry margin color thresholds. */
export function marginColor(percent: number) {
  if (percent >= 50) return 'text-emerald-500'
  if (percent >= 30) return 'text-blue-500'
  if (percent >= 15) return 'text-yellow-500'
  return 'text-red-500'
}
