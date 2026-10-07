import { getBrand } from '@/lib/brand';

/** Logo image for the configured brand. Works in server and client components (brand is a build-time setting via NEXT_PUBLIC_BRAND_*). */
export function BrandMark({ className = 'h-12 w-12' }: { className?: string }) {
  const brand = getBrand();
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={brand.logoUrl} alt={brand.name} className={className} />;
}
