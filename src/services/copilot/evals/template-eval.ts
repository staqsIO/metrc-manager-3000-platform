#!/usr/bin/env tsx
/**
 * Template-eval — verifies Phase 2A response shape locks fire end-to-end.
 *
 * For each templated skill (responseTemplate set in COPILOT_SKILLS), runs the
 * skill's first trigger phrase through executeCopilotQuery WITH skillId set
 * and asserts the response matches the templated shape.
 *
 * Distinct from runner.ts (general-purpose) — this is purpose-built for
 * skill-shape verification and exits 1 if any template doesn't take.
 *
 * Usage:
 *   FACILITY_ID=<cuid> USER_ID=<id> npx tsx src/services/copilot/evals/template-eval.ts
 */

import { prisma, dashboardPrisma } from '../../../lib/prisma'
import { executeCopilotQuery, COPILOT_SKILLS } from '../copilot-service'
import type { MetrcFacility } from '@prisma/client'

interface ShapeAssertion {
  /** Required regex matches in the response (all must match) */
  mustMatch: RegExp[]
  /** Forbidden regex (any match = fail) */
  mustNotMatch?: RegExp[]
}

// Per-skill expected shape — one assertion set per templated skill.
// Patterns intentionally loose so we test SHAPE, not exact text.
const skillAssertions: Record<string, ShapeAssertion> = {
  'audit-ready-snapshot': {
    // "81/100 — Ready" or similar score-led headline
    mustMatch: [/\d{1,3}\/100/, /(Ready|Watch|Not Ready)/i],
  },
  'audit-readiness': {
    mustMatch: [/\d{1,3}\/100/, /Component Scores|Critical Findings|Recommended Remediation/i],
  },
  'morning-check': {
    // Bold headline + sections — at least one of these section labels
    mustMatch: [/Today's Numbers|What Changed Overnight|Top.*Actions/i, /\*\*[^*]+\*\*/],
  },
  'inventory-summary': {
    // Bold headline + Snapshot table + Aging Distribution table
    mustMatch: [/Snapshot/, /Aging Distribution/i, /\|.*\|/],
  },
  'farm-to-cash': {
    mustMatch: [/Pipeline Stages|Conversion Rate|Where to Focus/i, /\|.*\|/],
  },
}

interface SkillResult {
  skillId: string
  question: string
  durationMs: number
  responseChars: number
  toolsUsed: string[]
  passed: boolean
  failures: string[]
  responseHead: string
}

async function main(): Promise<number> {
  const userId = process.env.USER_ID
  const facilityId = process.env.FACILITY_ID
  if (!userId || !facilityId) {
    console.error('USER_ID and FACILITY_ID required')
    return 2
  }

  const facility = await prisma.metrcFacility.findUnique({ where: { id: facilityId } })
  if (!facility) {
    console.error(`Facility not found: ${facilityId}`)
    return 2
  }

  const templatedSkills = COPILOT_SKILLS.filter(s => s.responseTemplate)
  console.log(`Found ${templatedSkills.length} templated skills`)
  console.log(`Facility: ${facility.name} (${facility.facilityType})`)
  console.log()

  const results: SkillResult[] = []

  for (const skill of templatedSkills) {
    const question = skill.triggerPhrases[0]!
    const assertions = skillAssertions[skill.id]
    process.stdout.write(`  ${skill.id.padEnd(28)} `)

    const start = Date.now()
    let response = ''
    const toolsUsed: string[] = []
    let execError: string | null = null

    try {
      const result = await executeCopilotQuery({
        facility: facility as MetrcFacility,
        message: question,
        history: [],
        userId,
        prisma,
        dashboardPrisma,
        skillId: skill.id,
        onToolCall: (evt) => {
          if (evt.status === 'start' && !evt.tool.startsWith('_')) toolsUsed.push(evt.tool)
        },
      })
      response = result.content
    } catch (err) {
      execError = err instanceof Error ? err.message : String(err)
    }

    const durationMs = Date.now() - start
    const failures: string[] = []

    if (execError) {
      failures.push(`exec error: ${execError}`)
    } else if (!assertions) {
      failures.push(`no assertions defined for ${skill.id}`)
    } else {
      for (const re of assertions.mustMatch) {
        if (!re.test(response)) failures.push(`missing pattern: ${re.source}`)
      }
      for (const re of assertions.mustNotMatch ?? []) {
        if (re.test(response)) failures.push(`forbidden pattern matched: ${re.source}`)
      }
    }

    const passed = failures.length === 0
    process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${durationMs}ms\n`)
    if (failures.length > 0) {
      for (const f of failures) console.log(`    · ${f}`)
    }

    results.push({
      skillId: skill.id,
      question,
      durationMs,
      responseChars: response.length,
      toolsUsed,
      passed,
      failures,
      responseHead: response.slice(0, 240).replace(/\n/g, ' '),
    })
  }

  console.log()
  console.log('='.repeat(70))
  const pass = results.filter(r => r.passed).length
  const fail = results.length - pass
  console.log(`Summary: ${pass} pass, ${fail} fail (${Math.round((pass / results.length) * 100)}%)`)
  console.log()

  // Dump first 240 chars of each response for visual inspection
  console.log('Response heads:')
  for (const r of results) {
    console.log(`  [${r.passed ? '✓' : '✗'}] ${r.skillId}`)
    console.log(`      ${r.responseHead}`)
  }

  await prisma.$disconnect()
  await dashboardPrisma.$disconnect()
  return fail > 0 ? 1 : 0
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('Crashed:', err)
    process.exit(2)
  })
