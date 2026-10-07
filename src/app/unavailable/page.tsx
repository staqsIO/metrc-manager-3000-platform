import { getBrand } from '@/lib/brand'
import { BrandMark } from '@/shared/components/BrandMark'

export default function UnavailablePage() {
  const brand = getBrand()
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border bg-card p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
            <BrandMark />
          </div>
          <h2 className="text-2xl font-bold">Platform Unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The {brand.name} Metrc Platform is currently unavailable. We&apos;re working on
            bringing it online. Please check back soon.
          </p>
        </div>

        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-4 py-3 text-sm text-yellow-400 text-center">
          This platform is under active development.
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Questions? Contact{' '}
          <a href={`mailto:${brand.supportEmail}`} className="text-primary hover:underline">
            {brand.supportEmail}
          </a>
        </p>
      </div>
    </div>
  )
}
