/**
 * Metrc Web UI URL Construction
 *
 * Best-effort deep links to the Metrc web application.
 * The Metrc web UI is separate from the API; URL patterns are based on
 * known state-specific domains and may change without notice.
 */

type MetrcWebSection = 'transfers-incoming' | 'transfers-outgoing'

// Metrc web UI base URLs by state (production only -- sandbox web UI unverified)
const METRC_WEB_DOMAINS: Record<string, string> = {
  CO: 'co.metrc.com',
  CA: 'ca.metrc.com',
  MA: 'ma.metrc.com',
  OK: 'ok.metrc.com',
  OR: 'or.metrc.com',
  MI: 'mi.metrc.com',
  MD: 'md.metrc.com',
  MO: 'mo.metrc.com',
  ME: 'me.metrc.com',
  MT: 'mt.metrc.com',
  NV: 'nv.metrc.com',
  OH: 'oh.metrc.com',
  AK: 'ak.metrc.com',
  WV: 'wv.metrc.com',
  LA: 'la.metrc.com',
  DC: 'dc.metrc.com',
}

const SECTION_PATHS: Record<MetrcWebSection, string> = {
  'transfers-incoming': '/industry/{license}/transfers/licensed/incoming',
  'transfers-outgoing': '/industry/{license}/transfers/licensed/outgoing',
}

export function getMetrcWebUrl(params: {
  stateCode: string
  environment: string // 'mock' | 'sandbox' | 'production'
  licenseNumber: string
  section: MetrcWebSection
}): string | null {
  // No web UI for mock or sandbox environments
  if (params.environment !== 'production') return null

  const domain = METRC_WEB_DOMAINS[params.stateCode.toUpperCase()]
  if (!domain) return null

  const path = SECTION_PATHS[params.section].replace('{license}', encodeURIComponent(params.licenseNumber))
  return `https://${domain}${path}`
}
