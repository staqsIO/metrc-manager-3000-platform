export function groupFacilitiesByState<T extends { stateCode: string }>(
  facilities: T[]
): [string, T[]][] {
  const grouped = new Map<string, T[]>()
  for (const f of facilities) {
    const arr = grouped.get(f.stateCode)
    if (arr) arr.push(f)
    else grouped.set(f.stateCode, [f])
  }
  return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
}
