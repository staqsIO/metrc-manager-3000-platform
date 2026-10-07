import { describe, it, expect } from 'vitest';
import { parseSuggestions, getFallbackSuggestions } from './suggestions';

describe('parseSuggestions', () => {
  it('extracts suggestions from the HTML-comment contract and strips it from content', () => {
    const input = 'Here is the answer.\n\n<!--suggestions:["Show details","Drill into A"]-->';
    const { cleanContent, suggestions } = parseSuggestions(input);
    expect(cleanContent).toBe('Here is the answer.');
    expect(suggestions).toEqual(['Show details', 'Drill into A']);
  });

  it('tolerates whitespace inside the comment marker', () => {
    const input = 'foo<!--   suggestions:   ["a", "b"]   -->';
    const { suggestions } = parseSuggestions(input);
    expect(suggestions).toEqual(['a', 'b']);
  });

  it('returns the original content unchanged when no suggestion comment is present', () => {
    const input = 'Just text, no suggestions.';
    const { cleanContent, suggestions } = parseSuggestions(input);
    expect(cleanContent).toBe('Just text, no suggestions.');
    expect(suggestions).toEqual([]);
  });

  it('falls back to original content + empty suggestions when JSON is malformed', () => {
    const input = 'foo<!--suggestions:[not-json]-->';
    const { cleanContent, suggestions } = parseSuggestions(input);
    expect(cleanContent).toBe(input);
    expect(suggestions).toEqual([]);
  });

  it('handles multi-line JSON arrays in the comment', () => {
    const input = `Done.\n<!--suggestions:[\n  "first",\n  "second"\n]-->`;
    const { cleanContent, suggestions } = parseSuggestions(input);
    expect(suggestions).toEqual(['first', 'second']);
    expect(cleanContent).toBe('Done.');
  });
});

describe('getFallbackSuggestions', () => {
  it('returns empty array when no tools were used', () => {
    expect(getFallbackSuggestions(undefined)).toEqual([]);
    expect(getFallbackSuggestions([])).toEqual([]);
  });

  it('returns suggestions for known tools', () => {
    const out = getFallbackSuggestions(['analyze_aging']);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('Show FIFO violations');
  });

  it('deduplicates across multiple tools and caps at 4', () => {
    const out = getFallbackSuggestions([
      'analyze_aging',
      'detect_fifo_violations',
      'run_compliance_audit',
      'get_inventory_overview',
      'detect_slow_moving',
    ]);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(new Set(out).size).toBe(out.length);
  });

  it('returns empty for unknown tool names', () => {
    expect(getFallbackSuggestions(['nonexistent_tool'])).toEqual([]);
  });
});
