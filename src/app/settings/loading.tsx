export default function Loading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="mb-8">
        <div className="h-7 bg-muted rounded w-28 mb-2" />
        <div className="h-4 bg-muted rounded w-52" />
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-border pb-2">
        <div className="h-4 bg-muted rounded w-16" />
        <div className="h-4 bg-muted rounded w-20" />
        <div className="h-4 bg-muted rounded w-16" />
      </div>

      {/* Content */}
      <div className="max-w-2xl space-y-6">
        <div className="card-modern p-6">
          <div className="h-5 bg-muted rounded w-20 mb-4" />
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded w-48" />
            <div className="h-4 bg-muted rounded w-56" />
            <div className="h-4 bg-muted rounded w-40" />
          </div>
        </div>
        <div className="card-modern p-6">
          <div className="h-5 bg-muted rounded w-24 mb-4" />
          <div className="h-9 bg-muted rounded-lg w-28" />
        </div>
      </div>
    </div>
  )
}
