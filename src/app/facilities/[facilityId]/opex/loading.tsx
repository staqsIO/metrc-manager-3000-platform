export default function OpExLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-7 bg-muted rounded w-48 mb-2" />
          <div className="h-4 bg-muted rounded w-72" />
        </div>
        <div className="h-10 bg-muted rounded-lg w-32" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-modern p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="h-5 bg-muted rounded w-40" />
              <div className="h-5 bg-muted rounded w-16" />
            </div>
            <div className="h-3 bg-muted rounded w-32 mb-6" />
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j}>
                  <div className="h-2.5 bg-muted rounded w-12 mb-1" />
                  <div className="h-5 bg-muted rounded w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
