// Centralized feature flags. Single switch per concern so re-enabling for the
// next phase is one line, not a hunt across the codebase.
//
// ACTIONS_ENABLED gates every mutation surface that originates from a user
// action (inventory bulk panel, aging recommendations actions, Copilot action
// tools that mutate Metrc/Dutchie/Canix). Read paths and analytics are NOT
// gated. Backend tRPC mutations that the cron and integrations rely on are
// also NOT gated — only user-initiated mutation surfaces.

export const ACTIONS_ENABLED = false;
