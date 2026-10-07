/** Abbreviate a 24-char Metrc tag label to its last 6 digits for display. */
export function abbreviateTag(label: string): string {
  return '...' + label.slice(-6)
}
