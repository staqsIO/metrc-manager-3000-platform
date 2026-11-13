# METRC Manager 3000 — Integration Guide

## What is this?

METRC Manager 3000 is a compliance and inventory intelligence dashboard for cannabis facilities. It connects to **Metrc** (the state-mandated track-and-trace system) and provides:

- Real-time inventory visibility with aging analysis
- Harvest tracking through drying, packaging, and waste recording
- Plant batch lifecycle management (seed/clone through harvest)
- Processing workflows (package-to-package transformations)
- Compliance alerts and audit trails
- AI-powered copilot for natural-language queries and bulk actions
- Transfer risk assessment and fulfillment analytics

---

## How It Connects to Metrc

### The Metrc API

Metrc is the regulatory track-and-trace system used by most US cannabis markets. Every licensed facility must report inventory movements — packages created, transfers sent, waste recorded, harvests finished — through Metrc.

METRC Manager 3000 connects to Metrc's REST API to **read** facility data and **execute** compliance-critical write operations. All communication uses HMAC-SHA256 authenticated requests with per-facility credentials.

### What Metrc Data We Access

| Metrc Resource | Read Operations | Write Operations |
|---------------|-----------------|------------------|
| **Packages** | Active packages, individual lookup, package types | Adjust quantity, create packages, finish, change notes, remediate |
| **Plants** | Active plants, individual lookup | — |
| **Plant Batches** | Active/inactive batches, individual lookup | Create plantings, destroy, change growth phase |
| **Harvests** | Active/on-hold/inactive harvests, waste records | Finish harvests, create packages from harvest, record waste |
| **Processing** | (Uses package data) | Create packages from source packages (extraction, infusion, repackaging) |
| **Transfers** | Incoming and outgoing transfers | — |
| **Sales** | Sales receipts | — |
| **Lab Tests** | Test results | — |
| **Strains** | Active strains | — |
| **Items** | Active item definitions | — |

### Authentication

Each facility has two API keys stored encrypted (AES-256-GCM) in the database:

- **Vendor API Key** — Identifies your software vendor registration
- **User API Key** — Identifies the specific facility/user

Keys are decrypted only at request time and never persist in memory. Every API request includes an HMAC-SHA256 signature for integrity verification.

---

## Architecture Overview

```
┌──────────────┐     tRPC      ┌──────────────────────┐
│   Browser    │ ◄──────────► │   Next.js Server     │
│  (Dashboard) │              │   (tRPC Routers)     │
└──────────────┘              └──────────┬───────────┘
                                         │
                              ┌──────────▼───────────┐
                              │   Client Factory     │
                              │  getMetrcClient()    │
                              └──┬─────────────────┬─┘
                                 │                 │
                    ┌────────────▼──┐     ┌───────▼────────────┐
                    │  Mock Client  │     │    Real Client      │
                    │ (In-memory)   │     │ (Metrc REST API)    │
                    └────────────┬──┘     └───────┬────────────┘
                                 │                 │
                              ┌──▼─────────────────▼──┐
                              │     Cache Layer       │
                              │  (TTL: 5s mock/30s)   │
                              └───────────────────────┘
                                         │
                              ┌──────────▼───────────┐
                              │    Rate Limiter      │
                              │ (50 burst, 1/sec)    │
                              └──────────────────────┘
```

### Environment Modes (Mock → Sandbox → Production)

Every facility has a `metrcEnvironment` field with three possible values:

- **Mock** (`"mock"`): Uses an in-memory client with ~500 generated packages, 30 harvests, and 40 plant batches. Perfect for demos, training, and development. Mutations modify in-memory state so the UI stays consistent within a session. State resets on server restart.

- **Sandbox** (`"sandbox"`): Connects to the Metrc sandbox API (`https://sandbox-api-{state}.metrc.com`) using sandbox-specific credentials. Ideal for integration testing against the real Metrc API without affecting production data. Sandbox and production credentials are stored separately.

- **Production** (`"production"`): Connects to the production Metrc API (`https://api-{state}.metrc.com`) with production credentials. Includes a 30-second TTL cache to reduce API calls and a token-bucket rate limiter (50 burst, 1 token/second refill) to stay within Metrc's rate limits.

Switching environments is a per-facility admin setting. Credentials must be configured for the target environment before switching. The client cache is isolated per environment to prevent stale data.

### Infrastructure Layers

| Layer | Purpose |
|-------|---------|
| **Retry with Backoff** | Automatically retries failed requests (3 attempts, exponential backoff with jitter). Respects `Retry-After` headers from Metrc. |
| **Rate Limiter** | Token-bucket algorithm, per-facility tracking. Prevents hitting Metrc's rate limits. Queues excess requests with a 30-second max wait. |
| **Cache** | TTL-based cache for GET responses. Write operations pass through and invalidate related cache entries. Cross-resource invalidation (e.g., packaging from a harvest invalidates both harvest and package caches). |
| **Typed Errors** | Specific error types for rate limiting (429), auth failures (401/403), validation (400), and not-found (404). Each carries contextual information for debugging. |

---

## Dashboard Modules

### Inventory (`/facilities/[id]/inventory`)

View all active packages with real-time data from Metrc. Features:
- Search and filter by item name, category, strain, label
- Aging analysis (fresh/normal/aging/critical categories)
- FIFO violation detection
- Bulk actions: adjust quantities, change notes, flag for discount/testing

### Harvests (`/facilities/[id]/harvests`)

Track harvests from start through drying and packaging:
- Active, on-hold, and finished harvest views
- Waste recording with weight tracking
- Summary dashboard: total weight, waste ratios, strain breakdown
- Finish harvests and create packages from harvest weight

### Plant Batches (`/facilities/[id]/plant-batches`)

Manage plant groups from seed/clone through their lifecycle:
- Active and inactive batch views with strain filtering
- Count tracking: total, tracked, untracked, packaged, harvested, destroyed
- Destroy plants with compliance logging
- Growth phase transitions

### Processing (`/facilities/[id]/processing`)

Package-to-package transformations:
- Source package selection (active, non-hold packages only)
- Category-based filtering for input selection
- Multi-source → single output workflows (extraction, infusion, repackaging)
- Validation: checks source packages exist and have sufficient quantity

### Other Modules

- **Compliance** — Automated rule evaluation against Metrc data, alert management
- **Analytics** — Strain performance, yield analysis, trends
- **Operations** — Employee pattern analysis, reconciliation
- **Fulfillment** — Transfer risk assessment
- **Tolling** — Economics calculator for tolling arrangements
- **Reports** — Configurable compliance and operations reports

---

## Write Operations: Preview → Confirm → Execute

All write operations that touch Metrc follow a strict three-step pattern:

```
1. PREVIEW  → User submits form (confirmed: false)
              System validates against live Metrc data
              Returns detailed preview of what will change
              Logs to ActionLog with status: PREVIEWING

2. CONFIRM  → User reviews the preview and clicks Confirm

3. EXECUTE  → User resubmits (confirmed: true)
              System calls the Metrc API
              Logs to ActionLog with status: COMPLETED
              Cache invalidated for affected resources
```

This means:
- **No accidental writes** — Every mutation shows exactly what will happen before it executes
- **Full audit trail** — Every preview and execution is logged with user ID, facility, timestamp, and target records
- **Live validation** — Preview checks current Metrc state (quantities, hold status, existence) before allowing execution

### Example: Adjusting Package Quantities

1. User selects 5 packages and enters adjustment amounts
2. System fetches current package data from Metrc, validates all packages exist and aren't on hold
3. Preview shows: "Package ABC-123: 100g → 95g (adjust -5g)" for each package
4. User confirms
5. System sends `POST /packages/v1/adjust` to Metrc
6. ActionLog records the completed adjustment

---

## AI Copilot

The copilot is an AI assistant (powered by OpenRouter) that can query facility data and execute actions using natural language.

### What the Copilot Can Read

| Tool | What It Does |
|------|-------------|
| `get_inventory_summary` | Package counts, categories, aging breakdown |
| `get_active_packages` | Search/filter active packages by name, category, strain |
| `get_aging_analysis` | FIFO violations, slow movers, aging distribution |
| `get_compliance_snapshot` | Audit results, rule violations, risk scores |
| `get_fulfillment_risk` | Transfer risk assessment |
| `get_operations_analysis` | Employee patterns, training needs |
| `get_harvest_summary` | Harvest counts, weights, strain breakdown |
| `get_active_harvests` | Search/filter active harvests |
| `get_plant_batch_summary` | Batch counts, tracking stats, strain breakdown |
| `get_active_plant_batches` | Search/filter active plant batches |

### What the Copilot Can Do (Actions)

| Action Tool | What It Does |
|------------|-------------|
| `flag_packages_for_discount` | Adds discount note to aging packages in Metrc |
| `flag_packages_for_testing` | Adds "Expedite lab testing" note in Metrc |
| `remediate_packages_action` | Flags packages for remediation in Metrc |
| `finish_harvests_action` | Finishes harvests in Metrc (marks as complete) |

Action tools require explicit user confirmation before executing.

### Example Copilot Conversations

> **User**: "How many packages are aging past 60 days?"
> **Copilot**: Calls `get_aging_analysis` → "You have 23 packages in the 'aging' category (61-90 days) and 8 in 'critical' (90+ days). The top aging strains are Blue Dream (12 packages) and OG Kush (7 packages)."

> **User**: "Flag the critical packages for discount"
> **Copilot**: Calls `flag_packages_for_discount` with the 8 critical package labels → "I've flagged 8 packages for discount in Metrc. Their notes now read 'DISCOUNT - Aging inventory flagged for markdown'."

---

## Metrc API Endpoints Used

Below is the complete list of Metrc API endpoints that METRC Manager 3000 calls:

### GET (Read) Endpoints

```
GET /plants/v1/active
GET /plants/v1/{id}
GET /packages/v1/active
GET /packages/v1/{id}
GET /packages/v1/types
GET /transfers/v1/incoming
GET /transfers/v1/outgoing
GET /sales/v1/receipts
GET /labtests/v1/results
GET /strains/v1/active
GET /items/v1/active
GET /harvests/v2/active
GET /harvests/v2/onhold
GET /harvests/v2/inactive
GET /harvests/v2/{id}
GET /harvests/v2/waste
GET /plantbatches/v1/active
GET /plantbatches/v1/inactive
GET /plantbatches/v1/{id}
```

### POST (Write) Endpoints

```
POST /packages/v1/adjust              — Adjust package quantities
POST /packages/v1/create/plantings    — Create packages from plantings
POST /packages/v1/create              — Create packages from source packages (processing)
POST /packages/v1/finish              — Finish/close packages
POST /packages/v1/change/note         — Change package notes
POST /packages/v1/remediate           — Remediate packages
POST /harvests/v2/finish              — Finish harvests
POST /harvests/v2/packages            — Create packages from harvest
POST /harvests/v2/waste               — Record harvest waste
POST /plantbatches/v1/createplantings — Create plant batches
POST /plantbatches/v1/destroy         — Destroy plants in batch
POST /plantbatches/v1/changegrowthphase — Change growth phase
```

All endpoints include `?licenseNumber={license}` as a query parameter.

---

## Data Flow Example: Harvest to Package

Here's how data flows through the system for a common workflow — creating retail packages from a harvest:

```
1. Plants harvested → Metrc creates Harvest record
   (GET /harvests/v2/active shows it in METRC Manager 3000)

2. Operator records waste during drying
   → METRC Manager 3000 UI: Enter waste weight → Preview → Confirm
   → POST /harvests/v2/waste (Metrc API)
   → Harvest.TotalWasteWeight updated

3. Operator creates packages from dried harvest
   → METRC Manager 3000 UI: Select harvest, enter output package details → Preview → Confirm
   → POST /harvests/v2/packages (Metrc API)
   → New packages appear in GET /packages/v1/active
   → Harvest.PackageCount and TotalPackagedWeight updated

4. Operator finishes harvest (all weight accounted for)
   → METRC Manager 3000 UI: Select harvest → Preview → Confirm
   → POST /harvests/v2/finish (Metrc API)
   → Harvest moves from active to inactive

5. New packages visible in Inventory module
   → Aging clock starts
   → Compliance rules evaluated automatically
   → Copilot can query and act on these packages
```

---

## Security Model

| Concern | How It's Handled |
|---------|-----------------|
| API key storage | AES-256-GCM encrypted at rest, decrypted only at request time |
| Authentication | NextAuth session required for all tRPC procedures |
| Facility access | `facilityProcedure` middleware validates user has access to the requested facility |
| Write safety | Preview → Confirm → Execute pattern prevents accidental writes |
| Audit trail | Every write operation logged to `ActionLog` table with user ID, facility, timestamp |
| Rate limiting | Token-bucket limiter prevents exceeding Metrc API rate limits |
| Copilot actions | Action tools require explicit user confirmation before executing |

---

## Glossary

| Term | Definition |
|------|-----------|
| **Package** | A Metrc-tracked container of cannabis product with a unique tag/label |
| **Plant Batch** | A group of plants tracked together (from seed or clone) |
| **Harvest** | The event of cutting plants, tracked through drying and packaging |
| **Processing** | Transforming one or more source packages into a new output package (extraction, infusion, repackaging) |
| **Tag/Label** | Unique identifier assigned to each Metrc-tracked item (e.g., `1A40F0000001234`) |
| **FIFO** | First-In-First-Out — packages should be used/sold in order of creation date |
| **Remediation** | Re-processing a package that failed lab testing |
| **Tolling** | A contract arrangement where one facility processes product for another |
| **Mock Mode** | Demo mode using generated data instead of the live Metrc API |
| **ActionLog** | Database table recording every preview and execution of write operations |
