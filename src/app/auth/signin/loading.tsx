export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center animate-pulse">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border bg-card p-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-muted mb-4" />
          <div className="h-6 bg-muted rounded w-56 mx-auto mb-2" />
          <div className="h-4 bg-muted rounded w-72 mx-auto" />
        </div>
        <div className="h-11 bg-muted rounded-xl w-full" />
        <div className="h-3 bg-muted rounded w-60 mx-auto" />
      </div>
    </div>
  )
}
