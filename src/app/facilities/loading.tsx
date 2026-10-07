export default function Loading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-7 bg-muted rounded w-32 mb-2" />
          <div className="h-4 bg-muted rounded w-64" />
        </div>
        <div className="h-9 bg-muted rounded-lg w-32" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-modern p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-muted" />
                <div className="h-5 bg-muted rounded w-32" />
              </div>
              <div className="h-5 bg-muted rounded-full w-20" />
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-muted rounded w-40" />
              <div className="h-4 bg-muted rounded w-32" />
              <div className="h-4 bg-muted rounded w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
