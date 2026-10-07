import { describe, it, expect } from 'vitest'
import { parseCOAText } from './coa-parsing-engine'
import type { COAParseResult } from './coa-parsing-engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal COA text block for testing specific compounds */
function coaBlock(lines: string[]): string {
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe('parseCOAText', () => {
  it('returns empty results for empty input', () => {
    const result = parseCOAText('')
    expect(result.terpenes).toHaveLength(0)
    expect(result.cannabinoids).toHaveLength(0)
    expect(result.overallConfidence).toBe(0)
    expect(result.warnings).toContain('No text content found in document.')
    expect(result.tier).toBe('regex')
  })

  it('returns empty results for whitespace-only input', () => {
    const result = parseCOAText('   \n  \n  ')
    expect(result.terpenes).toHaveLength(0)
    expect(result.cannabinoids).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // Cannabinoid extraction
  // ---------------------------------------------------------------------------

  describe('cannabinoids', () => {
    it('extracts basic cannabinoid values', () => {
      const result = parseCOAText(coaBlock([
        'THC 22.5%',
        'CBD 0.15%',
        'CBG 1.2%',
      ]))
      expect(result.cannabinoids).toHaveLength(3)
      expect(result.cannabinoids.find(c => c.name === 'THC')?.value).toBe(22.5)
      expect(result.cannabinoids.find(c => c.name === 'CBD')?.value).toBe(0.15)
      expect(result.cannabinoids.find(c => c.name === 'CBG')?.value).toBe(1.2)
    })

    it('separates THCA and THC (no double-match)', () => {
      const result = parseCOAText(coaBlock([
        'THCA          24.31%',
        'THC           0.82%',
      ]))
      expect(result.cannabinoids).toHaveLength(2)
      const thca = result.cannabinoids.find(c => c.name === 'THCA')
      const thc = result.cannabinoids.find(c => c.name === 'THC')
      expect(thca).toBeDefined()
      expect(thc).toBeDefined()
      expect(thca!.value).toBe(24.31)
      expect(thc!.value).toBe(0.82)
    })

    it('separates CBDA and CBD (no double-match)', () => {
      const result = parseCOAText(coaBlock([
        'CBDA  0.45%',
        'CBD   0.12%',
      ]))
      expect(result.cannabinoids).toHaveLength(2)
      expect(result.cannabinoids.find(c => c.name === 'CBDA')?.value).toBe(0.45)
      expect(result.cannabinoids.find(c => c.name === 'CBD')?.value).toBe(0.12)
    })

    it('handles THCA on same line as THC without collision', () => {
      // Some COAs put "THCA" and "THC" on adjacent columns
      const result = parseCOAText(coaBlock([
        'THCA 24.31%',
        'THC 0.82%',
        'CBDA 0.05%',
        'CBD 0.12%',
        'CBG 0.41%',
        'CBN 0.03%',
      ]))
      expect(result.cannabinoids).toHaveLength(6)
      // Verify no duplicate THC entries
      const thcEntries = result.cannabinoids.filter(c => c.name === 'THC')
      expect(thcEntries).toHaveLength(1)
    })

    it('extracts delta-8-THC without matching plain THC', () => {
      const result = parseCOAText(coaBlock([
        'delta-8-THC  1.5%',
        'THC          0.3%',
      ]))
      expect(result.cannabinoids.find(c => c.name === 'delta-8-THC')?.value).toBe(1.5)
      expect(result.cannabinoids.find(c => c.name === 'THC')?.value).toBe(0.3)
    })

    it('extracts THCV and CBDV', () => {
      const result = parseCOAText(coaBlock([
        'THCV  0.08%',
        'CBDV  0.02%',
      ]))
      expect(result.cannabinoids.find(c => c.name === 'THCV')?.value).toBe(0.08)
      expect(result.cannabinoids.find(c => c.name === 'CBDV')?.value).toBe(0.02)
    })

    it('handles colon-separated values', () => {
      const result = parseCOAText(coaBlock([
        'THC: 18.5%',
        'CBD: 0.3%',
      ]))
      expect(result.cannabinoids.find(c => c.name === 'THC')?.value).toBe(18.5)
    })

    it('handles values without explicit unit (defaults to %)', () => {
      const result = parseCOAText(coaBlock([
        'THC  22.5',
        'CBD  0.15',
      ]))
      expect(result.cannabinoids).toHaveLength(2)
      expect(result.cannabinoids[0].unit).toBe('%')
    })

    it('handles mg/g units', () => {
      const result = parseCOAText(coaBlock([
        'THC  225.3 mg/g',
      ]))
      const thc = result.cannabinoids.find(c => c.name === 'THC')
      expect(thc?.value).toBe(225.3)
      expect(thc?.unit).toBe('mg/g')
    })

    it('computes totalCannabinoids as sum', () => {
      const result = parseCOAText(coaBlock([
        'THC 20.0%',
        'CBD 1.0%',
        'CBG 0.5%',
      ]))
      expect(result.totalCannabinoids).toBe(21.5)
    })

    it('warns when THC exceeds 40%', () => {
      const result = parseCOAText(coaBlock([
        'THC 45.0%',
      ]))
      expect(result.warnings.some(w => w.includes('exceeds 40%'))).toBe(true)
    })

    it('warns when no cannabinoids found', () => {
      const result = parseCOAText(coaBlock([
        'Some random text with no compounds',
      ]))
      expect(result.warnings).toContain('No cannabinoid data found in document.')
    })
  })

  // ---------------------------------------------------------------------------
  // Terpene extraction
  // ---------------------------------------------------------------------------

  describe('terpenes', () => {
    it('extracts basic terpene values', () => {
      const result = parseCOAText(coaBlock([
        'Myrcene  0.87%',
        'Limonene 0.62%',
        'Linalool 0.29%',
      ]))
      expect(result.terpenes).toHaveLength(3)
      expect(result.terpenes.find(t => t.name === 'Myrcene')?.value).toBe(0.87)
      expect(result.terpenes.find(t => t.name === 'Limonene')?.value).toBe(0.62)
      expect(result.terpenes.find(t => t.name === 'Linalool')?.value).toBe(0.29)
    })

    it('keeps alpha-Pinene and beta-Pinene SEPARATE', () => {
      const result = parseCOAText(coaBlock([
        'alpha-Pinene  0.31%',
        'beta-Pinene   0.18%',
      ]))
      expect(result.terpenes).toHaveLength(2)
      const alpha = result.terpenes.find(t => t.name === 'alpha-Pinene')
      const beta = result.terpenes.find(t => t.name === 'beta-Pinene')
      expect(alpha).toBeDefined()
      expect(beta).toBeDefined()
      expect(alpha!.value).toBe(0.31)
      expect(beta!.value).toBe(0.18)
    })

    it('handles Greek letter prefixes', () => {
      const result = parseCOAText(coaBlock([
        'β-Myrcene  0.87%',
        'α-Pinene   0.31%',
        'β-Pinene   0.18%',
      ]))
      expect(result.terpenes.find(t => t.name === 'Myrcene')?.value).toBe(0.87)
      expect(result.terpenes.find(t => t.name === 'alpha-Pinene')?.value).toBe(0.31)
      expect(result.terpenes.find(t => t.name === 'beta-Pinene')?.value).toBe(0.18)
    })

    it('maps caryophyllene to beta-Caryophyllene', () => {
      const result = parseCOAText(coaBlock([
        'Caryophyllene  0.45%',
      ]))
      expect(result.terpenes.find(t => t.name === 'beta-Caryophyllene')?.value).toBe(0.45)
    })

    it('maps humulene to alpha-Humulene', () => {
      const result = parseCOAText(coaBlock([
        'Humulene  0.15%',
      ]))
      expect(result.terpenes.find(t => t.name === 'alpha-Humulene')?.value).toBe(0.15)
    })

    it('extracts trans-Ocimene and cis-Ocimene separately', () => {
      const result = parseCOAText(coaBlock([
        'trans-Ocimene  0.12%',
        'cis-Ocimene    0.03%',
      ]))
      expect(result.terpenes).toHaveLength(2)
      expect(result.terpenes.find(t => t.name === 'trans-Ocimene')?.value).toBe(0.12)
      expect(result.terpenes.find(t => t.name === 'cis-Ocimene')?.value).toBe(0.03)
    })

    it('does not duplicate generic Ocimene when trans/cis already matched', () => {
      const result = parseCOAText(coaBlock([
        'trans-Ocimene  0.12%',
        'Ocimene        0.15%',
      ]))
      // Should have trans-Ocimene but skip generic Ocimene
      expect(result.terpenes.find(t => t.name === 'trans-Ocimene')).toBeDefined()
      expect(result.terpenes.find(t => t.name === 'Ocimene')).toBeUndefined()
    })

    it('computes totalTerpenes as sum', () => {
      const result = parseCOAText(coaBlock([
        'Myrcene   1.0%',
        'Limonene  0.5%',
        'Linalool  0.3%',
      ]))
      expect(result.totalTerpenes).toBe(1.8)
    })

    it('warns when total terpenes exceeds 15%', () => {
      const lines = [
        'Myrcene   8.0%',
        'Limonene  5.0%',
        'Linalool  3.0%',
      ]
      const result = parseCOAText(coaBlock(lines))
      expect(result.warnings.some(w => w.includes('exceeds 15%'))).toBe(true)
    })

    it('warns for out-of-range terpene values', () => {
      const result = parseCOAText(coaBlock([
        'Myrcene  15.0%',
      ]))
      expect(result.warnings.some(w => w.includes('outside expected range'))).toBe(true)
    })

    it('warns when no terpenes found', () => {
      const result = parseCOAText(coaBlock([
        'THC 22.5%',
      ]))
      expect(result.warnings).toContain('No terpene data found in document.')
    })
  })

  // ---------------------------------------------------------------------------
  // Lab info extraction
  // ---------------------------------------------------------------------------

  describe('labInfo', () => {
    it('extracts lab name', () => {
      const result = parseCOAText(coaBlock([
        'Laboratory: SC Labs',
        'THC 22.5%',
      ]))
      expect(result.labInfo.labName).toBe('SC Labs')
    })

    it('recognizes known lab names directly', () => {
      const result = parseCOAText(coaBlock([
        'Kaycha Labs',
        'THC 22.5%',
      ]))
      expect(result.labInfo.labName).toBe('Kaycha')
    })

    it('extracts license number', () => {
      const result = parseCOAText(coaBlock([
        'License: C8-0000012-LIC',
        'THC 22.5%',
      ]))
      expect(result.labInfo.licenseNumber).toBe('C8-0000012-LIC')
    })

    it('extracts test date in MM/DD/YYYY format', () => {
      const result = parseCOAText(coaBlock([
        'Test Date: 01/15/2026',
        'THC 22.5%',
      ]))
      expect(result.labInfo.testDate).toBe('01/15/2026')
    })

    it('extracts test date in ISO format', () => {
      const result = parseCOAText(coaBlock([
        'Analysis Date: 2026-01-15',
        'THC 22.5%',
      ]))
      expect(result.labInfo.testDate).toBe('2026-01-15')
    })

    it('has higher confidence when more fields found', () => {
      const full = parseCOAText(coaBlock([
        'Laboratory: SC Labs',
        'License: ABC-123',
        'Test Date: 01/15/2026',
        'THC 22.5%',
      ]))
      const partial = parseCOAText(coaBlock([
        'Laboratory: SC Labs',
        'THC 22.5%',
      ]))
      expect(full.labInfo.confidence).toBeGreaterThan(partial.labInfo.confidence)
    })
  })

  // ---------------------------------------------------------------------------
  // Batch info extraction
  // ---------------------------------------------------------------------------

  describe('batchInfo', () => {
    it('extracts batch number', () => {
      const result = parseCOAText(coaBlock([
        'Batch Number: BT-2026-0042',
        'THC 22.5%',
      ]))
      expect(result.batchInfo.batchNumber).toBe('BT-2026-0042')
    })

    it('extracts lot number as batch', () => {
      const result = parseCOAText(coaBlock([
        'Lot #: LOT-789',
        'THC 22.5%',
      ]))
      expect(result.batchInfo.batchNumber).toBe('LOT-789')
    })

    it('extracts sample ID', () => {
      const result = parseCOAText(coaBlock([
        'Sample ID: SL-240115-001',
        'THC 22.5%',
      ]))
      expect(result.batchInfo.sampleId).toBe('SL-240115-001')
    })

    it('extracts product name', () => {
      const result = parseCOAText(coaBlock([
        'Product Name: Blue Dream Flower',
        'THC 22.5%',
      ]))
      expect(result.batchInfo.productName).toBe('Blue Dream Flower')
    })
  })

  // ---------------------------------------------------------------------------
  // Confidence scoring
  // ---------------------------------------------------------------------------

  describe('confidence', () => {
    it('scores higher with explicit units', () => {
      const withUnit = parseCOAText(coaBlock(['THC 22.5%']))
      const withoutUnit = parseCOAText(coaBlock(['THC 22.5']))
      // Both should parse, but the one with % should have >= confidence
      expect(withUnit.cannabinoids[0].confidence).toBeGreaterThanOrEqual(
        withoutUnit.cannabinoids[0].confidence
      )
    })

    it('penalizes out-of-range values', () => {
      const normal = parseCOAText(coaBlock(['Myrcene 0.87%']))
      const outOfRange = parseCOAText(coaBlock(['Myrcene 25.0%']))
      expect(normal.terpenes[0].confidence).toBeGreaterThan(
        outOfRange.terpenes[0].confidence
      )
    })

    it('overall confidence factors in all sections', () => {
      const result = parseCOAText(coaBlock([
        'Laboratory: SC Labs',
        'License: ABC-123',
        'Test Date: 01/15/2026',
        'Batch Number: BT-001',
        'Sample ID: SL-001',
        'Product Name: Blue Dream',
        'THC 22.5%',
        'CBD 0.15%',
        'Myrcene 0.87%',
        'Limonene 0.62%',
      ]))
      expect(result.overallConfidence).toBeGreaterThan(0.5)
    })

    it('overall confidence is 0 when nothing found', () => {
      const result = parseCOAText('random text with no compounds')
      expect(result.overallConfidence).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Full COA document
  // ---------------------------------------------------------------------------

  describe('full document parsing', () => {
    const fullCOA = `
Certificate of Analysis
Lab: SC Labs
License Number: C8-0000012-LIC
Test Date: 01/15/2026
Batch Number: BT-2026-0042
Sample ID: SL-240115-001
Product Name: Blue Dream Flower

Cannabinoid Profile
THCA          24.31%
THC           0.82%
CBDA          0.05%
CBD           0.12%
CBG           0.41%
CBN           0.03%

Terpene Profile
Myrcene              0.87%
Limonene             0.62%
alpha-Pinene         0.31%
beta-Pinene          0.18%
beta-Caryophyllene   0.45%
Linalool             0.29%
alpha-Humulene       0.15%
Terpinolene          0.08%
Ocimene              0.04%
`

    let result: COAParseResult

    it('parses without errors', () => {
      result = parseCOAText(fullCOA)
      expect(result).toBeDefined()
      expect(result.tier).toBe('regex')
    })

    it('finds all 6 cannabinoids', () => {
      result = parseCOAText(fullCOA)
      expect(result.cannabinoids).toHaveLength(6)
      const names = result.cannabinoids.map(c => c.name)
      expect(names).toContain('THCA')
      expect(names).toContain('THC')
      expect(names).toContain('CBDA')
      expect(names).toContain('CBD')
      expect(names).toContain('CBG')
      expect(names).toContain('CBN')
    })

    it('finds all 9 terpenes', () => {
      result = parseCOAText(fullCOA)
      expect(result.terpenes).toHaveLength(9)
    })

    it('extracts all lab info fields', () => {
      result = parseCOAText(fullCOA)
      expect(result.labInfo.labName).toBeTruthy()
      expect(result.labInfo.licenseNumber).toBeTruthy()
      expect(result.labInfo.testDate).toBeTruthy()
    })

    it('extracts all batch info fields', () => {
      result = parseCOAText(fullCOA)
      expect(result.batchInfo.batchNumber).toBe('BT-2026-0042')
      expect(result.batchInfo.sampleId).toBe('SL-240115-001')
      expect(result.batchInfo.productName).toBe('Blue Dream Flower')
    })

    it('has high overall confidence', () => {
      result = parseCOAText(fullCOA)
      expect(result.overallConfidence).toBeGreaterThan(0.7)
    })

    it('has no warnings on valid data', () => {
      result = parseCOAText(fullCOA)
      expect(result.warnings).toHaveLength(0)
    })

    it('computes correct totals', () => {
      result = parseCOAText(fullCOA)
      expect(result.totalCannabinoids).toBeGreaterThan(25)
      expect(result.totalTerpenes).toBeGreaterThan(2.5)
    })
  })
})
