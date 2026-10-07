export type { DomainClaim, DomainMatchService } from './types'
export { createDomainMatchService, normalizeEmailDomain, parentDomains } from './domain-match-service'
export {
  claimDomain,
  confirmChallenge,
  revokeDomain,
  type ClaimDomainParams,
  type ClaimDomainResult,
  type ConfirmChallengeParams,
  type ConfirmChallengeResult,
  type RevokeDomainParams,
} from './domain-verification-service'
