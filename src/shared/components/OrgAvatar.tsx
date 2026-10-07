'use client'

import { Avatar, AvatarImage, AvatarFallback } from '@/shared/components/ui/avatar'
import { cn } from '@/lib/utils'

/** Derive a hue (0-360) from a string for the initials fallback background. */
function nameToHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
}

interface OrgAvatarProps {
  name: string
  logoUrl?: string | null
  /** Pixel size (default 20) */
  size?: number
  className?: string
}

export function OrgAvatar({ name, logoUrl, size = 20, className }: OrgAvatarProps) {
  const hue = nameToHue(name)
  const initials = name.charAt(0).toUpperCase()

  return (
    <Avatar
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {logoUrl && (
        <AvatarImage src={logoUrl} alt={name} className="object-cover" />
      )}
      <AvatarFallback
        className="text-white font-semibold"
        style={{
          backgroundColor: `hsl(${hue}, 55%, 45%)`,
          fontSize: size * 0.45,
        }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
