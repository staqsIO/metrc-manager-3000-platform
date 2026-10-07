export function isMetrcPlatformEnabled(): boolean {
  return process.env.METRC_PLATFORM_ENABLED !== 'false'
}
