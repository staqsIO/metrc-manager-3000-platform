export interface CalcResult {
  inputWeight: number
  outputWeight: number
  processingFee: number
  totalFees: number
  yieldPercentage: number
  lossPercentage: number
  costPerGramInput: number
  costPerGramOutput: number
}

export interface AgreementItem {
  id: string
  partnerName: string
  partnerLicense: string | null
  agreementType: string
  status: string
  startDate: string
  endDate: string | null
  inputWeight: number | null
  outputWeight: number | null
  processingFee: number | null
  totalFees: number | null
  billingMode: string
  createdAt: string
}

export interface BatchRow {
  id: string
  status: string
  inputWeight: number | null
  outputWeight: number | null
  expectedYieldPct: number | null
  actualYieldPct: number | null
  yieldVariance: number | null
  wasteWeight: number | null
  wastePct: number | null
  inputPackageIds: string[]
  outputPackageIds: string[]
  lifecycleStage: string
  commencedAt: string | null
  startedAt: string | Date
  agreement: {
    partnerName: string
    agreementType: string
  } | null
}

export interface AvailablePackage {
  label: string
  itemName: string
  category: string
  quantity: number
  unit: string
  labTestingState: string
  packagedDate: string
  strain: string
}

export interface FeeLine {
  feeType: 'FLAT' | 'PER_UNIT' | 'PERCENTAGE' | 'ROYALTY' | 'TRANSPORT' | 'TESTING'
  label: string
  rate: number
  basis: 'input_weight' | 'output_weight' | 'revenue' | 'fixed'
  minFee?: number
  maxFee?: number
}

export interface PartnerScenario {
  partnerName: string
  feeStructure: FeeLine[]
  inputWeight: number
  expectedYieldPct: number
  revenue?: number
}

export type Tab = 'dashboard' | 'calculator' | 'advanced' | 'agreements' | 'batches' | 'compare' | 'breakeven' | 'reconciliation'

export const FEE_TYPES = ['FLAT', 'PER_UNIT', 'PERCENTAGE', 'ROYALTY', 'TRANSPORT', 'TESTING'] as const
export const BASIS_OPTIONS = ['input_weight', 'output_weight', 'revenue', 'fixed'] as const

export const emptyFeeLine = (): FeeLine => ({
  feeType: 'PER_UNIT',
  label: '',
  rate: 0,
  basis: 'input_weight',
})
