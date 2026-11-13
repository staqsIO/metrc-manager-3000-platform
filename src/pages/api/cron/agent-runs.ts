/**
 * Phase 3 — Scheduled Copilot runs cron worker.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        $BASE_URL/api/cron/agent-runs
 *
 * Schedule (GitHub Actions): every 15 min.
 *
 * Walks every Run with status='scheduled' and a scheduleSpec.cron, evaluates
 * whether the next firing is due (relative to scheduleSpec.lastRunAt or the
 * Run.createdAt baseline), re-executes the original prompt against the
 * stored facility/org scope, appends a new ArtifactVersion to the anchor
 * Artifact, and — when scheduleSpec.triggerOn === 'change' — emits a
 * Notification only if the findings materially differ from the previous
 * version.
 *
 * Failure model: each due run is processed in isolation. A failure on one
 * does not block others. Per-run errors are logged and the schedule keeps
 * advancing — we don't want a single broken Metrc connection to back up
 * the whole queue.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { verifyCronSecret } from '@/lib/cron-auth'
import { isDemoMode } from '@/services/copilot/demo-quota'
import { CronExpressionParser } from 'cron-parser'
import { prisma, dashboardPrisma } from '@/lib/prisma'
import { getProductionOrgIds } from '@/services/tenant';
import { executeCopilotQuery } from '@/services/copilot/copilot-service'
import type { MetrcFacility } from '@prisma/client'

interface ScheduleSpec {
  cron: string
  triggerOn?: 'change' | 'always'
  lastRunAt?: string
  timezone?: string
}

function parseScheduleSpec(raw: unknown): ScheduleSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const spec = raw as Record<string, unknown>
  if (typeof spec.cron !== 'string' || !spec.cron) return null
  return {
    cron: spec.cron,
    triggerOn: spec.triggerOn === 'always' ? 'always' : 'change',
    lastRunAt: typeof spec.lastRunAt === 'string' ? spec.lastRunAt : undefined,
    timezone: typeof spec.timezone === 'string' ? spec.timezone : undefined,
  }
}

function isDue(spec: ScheduleSpec, anchor: Date, now: Date): boolean {
  // Compute the next firing AFTER the anchor (lastRunAt or run creation).
  // If that next firing is <= now, the run is due.
  try {
    const interval = CronExpressionParser.parse(spec.cron, {
      currentDate: anchor,
      ...(spec.timezone ? { tz: spec.timezone } : {}),
    })
    const next = interval.next().toDate()
    return next.getTime() <= now.getTime()
  } catch {
    // Invalid cron expression — leave the schedule alone, surface in logs.
    return false
  }
}

interface VersionContent {
  content?: string
  toolsUsed?: string[]
  toolResults?: Record<string, unknown>
}

/**
 * Compare two versions to decide whether to fire a "findings changed"
 * notification. Today this is a structural comparison on the captured
 * tool results (most informative signal); falls back to content-string
 * compare when no toolResults exist.
 */
function findingsDiffer(prev: VersionContent | null, next: VersionContent): boolean {
  if (!prev) return true
  const prevTools = JSON.stringify(prev.toolResults ?? null)
  const nextTools = JSON.stringify(next.toolResults ?? null)
  if (prevTools !== nextTools) return true
  // Coarser fallback: compare the narrative body verbatim. If the LLM rewrote
  // narrative copy without any structured-data change, suppress.
  return (prev.content ?? '') !== (next.content ?? '')
}

interface RunRecord {
  id: string
  organizationId: string
  facilityId: string | null
  userId: string
  prompt: string
  model: string | null
  skillId: string | null
  scheduleSpec: unknown
  currentArtifactId: string | null
  conversationId: string | null
  createdAt: Date
}

async function executeScheduledRun(run: RunRecord, now: Date): Promise<{
  status: 'executed' | 'unchanged' | 'skipped' | 'failed'
  reason?: string
}> {
  // Resolve the run's scope: facility-mode if facilityId is set, otherwise
  // org-mode using all currently-active facilities for that org.
  let facility: MetrcFacility | null = null
  let orgFacilities: MetrcFacility[] | null = null
  if (run.facilityId) {
    facility = await prisma.metrcFacility.findFirst({
      where: { id: run.facilityId, organizationId: run.organizationId, isActive: true },
    })
    if (!facility) return { status: 'skipped', reason: 'facility_inactive_or_missing' }
  } else {
    orgFacilities = await prisma.metrcFacility.findMany({
      where: { organizationId: run.organizationId, isActive: true },
    })
    if (orgFacilities.length === 0) return { status: 'skipped', reason: 'no_active_org_facilities' }
  }

  let result
  try {
    result = await executeCopilotQuery({
      ...(facility ? { facility } : {}),
      ...(orgFacilities ? { orgFacilities } : {}),
      message: run.prompt,
      userId: run.userId,
      prisma,
      dashboardPrisma,
      ...(run.model ? { model: run.model } : {}),
      ...(run.skillId ? { skillId: run.skillId } : {}),
      // Don't link this auto-execution to the original Conversation — it
      // would silently appear in the user's chat thread without context.
      // The Notification deep-links into the artifact instead.
      conversationId: null,
    })
  } catch (err) {
    console.error('[agent-runs] execute failed', { runId: run.id, err: err instanceof Error ? err.message : err })
    return { status: 'failed', reason: err instanceof Error ? err.message : 'unknown_error' }
  }

  // Pull the previous version content (if any) for the change-detection diff.
  let previousVersion: VersionContent | null = null
  if (run.currentArtifactId) {
    const artifact = await prisma.artifact.findUnique({
      where: { id: run.currentArtifactId },
      select: { currentVersionId: true },
    })
    if (artifact?.currentVersionId) {
      const v = await prisma.artifactVersion.findUnique({
        where: { id: artifact.currentVersionId },
        select: { content: true },
      })
      if (v) previousVersion = (v.content ?? null) as VersionContent | null
    }
  }

  const newVersion: VersionContent = result as unknown as VersionContent
  const spec = parseScheduleSpec(run.scheduleSpec)
  const triggerOn = spec?.triggerOn ?? 'change'
  const changed = findingsDiffer(previousVersion, newVersion)

  // Always advance the schedule cursor so the next firing is computed
  // relative to this execution.
  const newSpec: ScheduleSpec = {
    cron: spec?.cron ?? '',
    triggerOn,
    lastRunAt: now.toISOString(),
    ...(spec?.timezone ? { timezone: spec.timezone } : {}),
  }
  await prisma.run.update({
    where: { id: run.id },
    data: {
      scheduleSpec: newSpec as unknown as object,
      // Keep status='scheduled' so the next cron tick re-considers the run.
      status: 'scheduled',
    },
  })

  if (!changed && triggerOn === 'change') {
    // Findings unchanged — no new artifact version, no notification.
    return { status: 'unchanged' }
  }

  // Emit a Notification (best-effort) and notify only on first execution
  // when there's no prior version to compare against.
  const severity = previousVersion ? 'info' : 'info'
  const titleVerb = previousVersion ? 'Update' : 'New finding'
  await prisma.notification
    .create({
      data: {
        userId: run.userId,
        organizationId: run.organizationId,
        runId: run.id,
        artifactId: run.currentArtifactId,
        type: 'scheduled_run',
        severity,
        title: `${titleVerb}: ${run.prompt.slice(0, 80)}`,
        body: triggerOn === 'change'
          ? 'Findings changed since the last scheduled run.'
          : 'Scheduled Copilot run completed.',
      },
    })
    .catch((err) => {
      console.error('[agent-runs] notification create failed', err instanceof Error ? err.message : err)
    })

  return { status: 'executed' }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifyCronSecret(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  // The public demo's house key is for counted free questions; visitors' scheduled runs would spend it uncounted.
  if (isDemoMode()) return res.status(200).json({ skipped: 'demo mode' })

  const now = new Date()
  // Tenant gate: only process scheduled runs belonging to PRODUCTION orgs.
  // Defense-in-depth on top of the run-creation procedure. See ADR-020 Phase 3.
  const prodOrgIds = await getProductionOrgIds(dashboardPrisma)
  // Pull every scheduled run with a non-null scheduleSpec — the JSON shape
  // check happens in-memory because Prisma can't index into JSONB across
  // both PG dialects identically and the table is bounded.
  const candidates = await prisma.run.findMany({
    where: {
      status: 'scheduled',
      scheduleSpec: { not: undefined },
      organizationId: { in: prodOrgIds },
    },
    select: {
      id: true,
      organizationId: true,
      facilityId: true,
      userId: true,
      prompt: true,
      model: true,
      skillId: true,
      scheduleSpec: true,
      currentArtifactId: true,
      conversationId: true,
      createdAt: true,
    },
    take: 200,
  })

  let executed = 0
  let unchanged = 0
  let skipped = 0
  let failed = 0
  const dueRuns: RunRecord[] = []

  for (const run of candidates) {
    const spec = parseScheduleSpec(run.scheduleSpec)
    if (!spec) {
      skipped += 1
      continue
    }
    const anchor = spec.lastRunAt ? new Date(spec.lastRunAt) : run.createdAt
    if (!isDue(spec, anchor, now)) continue
    dueRuns.push(run as RunRecord)
  }

  // Process serially. Parallelizing risks Metrc rate-limit collisions and
  // the concurrent-OpenRouter cost is not justified at this scale yet.
  for (const run of dueRuns) {
    const result = await executeScheduledRun(run, new Date())
    if (result.status === 'executed') executed += 1
    else if (result.status === 'unchanged') unchanged += 1
    else if (result.status === 'skipped') skipped += 1
    else failed += 1
  }

  return res.status(200).json({
    ok: true,
    candidates: candidates.length,
    due: dueRuns.length,
    executed,
    unchanged,
    skipped,
    failed,
    runAt: now.toISOString(),
  })
}
