export default function Loading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-7 bg-muted rounded w-48 mb-2" />
          <div className="h-4 bg-muted rounded w-72" />
        </div>
      </div>

      {/* Summary cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card-modern p-4">
            <div className="h-3 bg-muted rounded w-20 mb-2" />
            <div className="h-7 bg-muted rounded w-16" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="card-modern">
        <div className="border-b border-border px-6 py-3 flex gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 bg-muted rounded w-24" />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b border-border px-6 py-4 flex gap-6">
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="h-4 bg-muted rounded w-24" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
