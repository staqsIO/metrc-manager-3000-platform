/**
 * Pure formatting helpers — display only, no state. Shared across Copilot
 * surfaces so future canvas/full-page layouts use identical human-readable
 * timestamps and model labels.
 */

export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function deriveDisplayName(modelId: string): string {
  const raw = modelId.split('/').pop() || modelId;
  return raw.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A persisted model choice is only valid while some enabled provider still offers it; otherwise
 * fall back to the default (''). While the list is loading (undefined) keep the choice.
 */
export function reconcileSelectedModel(selected: string, available: ReadonlyArray<{ model_id: string }> | undefined): string {
  if (!selected || !available) return selected;
  return available.some((m) => m.model_id === selected) ? selected : '';
}
