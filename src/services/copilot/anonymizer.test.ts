import { describe, it, expect } from 'vitest';
import { createAnonymizer } from './anonymizer';

const FIXTURE_CONTEXT = {
  facilityName: 'Example Farms Northfield',
  licenseNumber: 'MR000104',
  stateCode: 'MA',
  orgName: 'Example Farms',
  orgFacilities: [
    { name: 'Example Farms Northfield', licenseNumber: 'MR000104' },
    { name: 'Example Farms Eastport', licenseNumber: 'MP000102' },
    { name: 'Example Farms Westbrook', licenseNumber: 'MC000101' },
  ],
  strains: ['Blue Dream', 'Wedding Cake', 'GMO', 'Sour Diesel'],
};

const REALISTIC_TOOL_RESULT = JSON.stringify({
  facility: 'Example Farms Northfield',
  licenseNumber: 'MR000104',
  packages: [
    { tag: '1A40A0300003F49000194712', strainName: 'Blue Dream', quantity: 1500 },
    { tag: '1A40A0300003F49000194713', strainName: 'Wedding Cake', quantity: 750 },
  ],
  transfers: [
    { manifestNumber: '0123456789', from: 'Example Farms Northfield', to: 'Example Farms Eastport' },
    { manifestNumber: '9876543210', from: 'Example Farms Westbrook', to: 'Example Farms Northfield' },
  ],
  patientNote: 'Sold under PatientLicenseNumber: MA-PAT-12345',
});

describe('createAnonymizer', () => {
  describe('static field replacement', () => {
    it('replaces facility name with __FAC_NNN__ token', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('The current facility is Example Farms Northfield.');
      expect(out).not.toContain('Example Farms Northfield');
      expect(out).toMatch(/__FAC_\d{3}__/);
    });

    it('replaces license numbers with __LIC_NNN__ tokens', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('License MR000104 transferred to MP000102.');
      expect(out).not.toContain('MR000104');
      expect(out).not.toContain('MP000102');
      expect(out.match(/__LIC_\d{3}__/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('replaces strain names with __STRAIN_NNN__ tokens', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('Top sellers: Blue Dream, Wedding Cake, GMO.');
      expect(out).not.toContain('Blue Dream');
      expect(out).not.toContain('Wedding Cake');
      expect(out).not.toContain('GMO');
      expect(out.match(/__STRAIN_\d{3}__/g)?.length).toBe(3);
    });

    it('uses consistent tokens across multiple references', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('Example Farms Northfield reports… Example Farms Northfield audit complete.');
      const tokens = out.match(/__FAC_\d{3}__/g) ?? [];
      expect(tokens.length).toBe(2);
      expect(tokens[0]).toBe(tokens[1]);
    });
  });

  describe('dynamic Metrc tag capture', () => {
    it('replaces 24-char Metrc package tags with __TAG_NNNN__', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('Package 1A40A0300003F49000194712 is awaiting QA.');
      expect(out).not.toContain('1A40A0300003F49000194712');
      expect(out).toMatch(/__TAG_\d{4}__/);
    });

    it('uses consistent tokens for the same tag across calls', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const tag = '1A40A0300003F49000194712';
      const out1 = a.anonymize(`tag=${tag}`);
      const out2 = a.anonymize(`see ${tag} again`);
      const t1 = out1.match(/__TAG_\d{4}__/)?.[0];
      const t2 = out2.match(/__TAG_\d{4}__/)?.[0];
      expect(t1).toBe(t2);
    });
  });

  describe('manifest number capture', () => {
    it('replaces manifestNumber field values', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('{"manifestNumber":"0123456789"}');
      expect(out).not.toContain('0123456789');
      expect(out).toMatch(/__MFST_\d{3}__/);
    });

    it('replaces "Manifest #" and "Manifest:" patterns', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      expect(a.anonymize('Manifest #0123456789 inbound')).toMatch(/__MFST_\d{3}__/);
      expect(a.anonymize('Manifest: 9876543210 outbound')).toMatch(/__MFST_\d{3}__/);
    });

    it('does NOT false-positive on bare numeric quantities or prices', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('Package quantity is 1500 units priced at $1234567890.');
      expect(out).not.toMatch(/__MFST_/);
      expect(out).toContain('1500');
      expect(out).toContain('1234567890');
    });
  });

  describe('patient license stripping (defense-in-depth)', () => {
    it('redacts XX-PAT- pattern', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('Sold to MA-PAT-12345 today.');
      expect(out).not.toContain('MA-PAT-12345');
      expect(out).toContain('__PAT_REDACTED__');
    });

    it('redacts PatientLicenseNumber JSON field values', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const out = a.anonymize('{"PatientLicenseNumber":"PAT123456789"}');
      expect(out).not.toContain('PAT123456789');
      expect(out).toContain('__PAT_REDACTED__');
    });
  });

  describe('round-trip integrity', () => {
    it('deanonymize() restores original values', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      // Prime the dynamic maps (tags + manifests) by anonymizing a tool result
      a.anonymize(REALISTIC_TOOL_RESULT);
      // LLM "echoes" the structure as a summary
      const llmReply = `Summary for ${a.anonymize('Example Farms Northfield')}: 2 packages of ${a.anonymize('Blue Dream')} and ${a.anonymize('Wedding Cake')} totalling 2,250 units. Outbound manifest ${a.anonymize('Manifest #0123456789')} sent.`;
      const restored = a.deanonymize(llmReply);
      expect(restored).toContain('Example Farms Northfield');
      expect(restored).toContain('Blue Dream');
      expect(restored).toContain('Wedding Cake');
      expect(restored).toContain('0123456789');
      expect(restored).not.toMatch(/__(FAC|LIC|TAG|MFST|STRAIN|ORG|STATE)_\d+__/);
    });

    it('end-to-end on a realistic tool result has zero leaked sensitive values when sent', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const sent = a.anonymize(REALISTIC_TOOL_RESULT);
      const sensitive = [
        'Example Farms Northfield',
        'Example Farms Eastport',
        'Example Farms Westbrook',
        'MR000104',
        'MP000102',
        'MC000101',
        '1A40A0300003F49000194712',
        '1A40A0300003F49000194713',
        '0123456789',
        '9876543210',
        'Blue Dream',
        'Wedding Cake',
        'MA-PAT-12345',
      ];
      for (const value of sensitive) {
        expect(sent, `expected "${value}" to be replaced before being sent to LLM`).not.toContain(value);
      }
    });
  });

  describe('markdown-escaped token deanonymization', () => {
    it('restores tokens that the LLM escaped to avoid bold rendering', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      a.anonymize(REALISTIC_TOOL_RESULT);
      // Sonnet/GPT-4o sometimes emit `\_\_TAG\_0017\_\_` inside table cells
      // so the renderer doesn't treat `__...__` as bold formatting.
      const escapedReply = '| \\_\\_TAG\\_0001\\_\\_ | Distillate | 0.5g | 865d |';
      const restored = a.deanonymize(escapedReply);
      expect(restored).toContain('1A40A0300003F49000194712');
      expect(restored).not.toMatch(/TAG_\d+/);
    });

    it('restores facility names emitted as escaped italic', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      const reply = 'The \\_\\_FAC\\_001\\_\\_ inventory is up.';
      const restored = a.deanonymize(reply);
      expect(restored).toContain('Example Farms Northfield');
      expect(restored).not.toContain('FAC_001');
    });
  });

  describe('fuzzy fallback for LLM-mangled tokens', () => {
    it('restores tokens truncated with a Unicode ellipsis prefix', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      a.anonymize(REALISTIC_TOOL_RESULT);
      const reply = '| …TAG_0001__ | Distillate | 0.5g | 865d |';
      const restored = a.deanonymize(reply);
      expect(restored).toContain('1A40A0300003F49000194712');
      expect(restored).not.toMatch(/TAG_\d+/);
    });

    it('restores tokens with ASCII dots and a space prefix', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      a.anonymize(REALISTIC_TOOL_RESULT);
      const reply = '| ... TAG_0001__ | Distillate | 0.5g | 865d |';
      const restored = a.deanonymize(reply);
      expect(restored).toContain('1A40A0300003F49000194712');
      expect(restored).not.toMatch(/TAG_\d+/);
    });

    it('restores tokens with missing leading or trailing underscores', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      a.anonymize(REALISTIC_TOOL_RESULT);
      // Missing trailing underscores (e.g. "TAG_0001 stayed in inventory")
      const trailingDropped = a.deanonymize('Package TAG_0001 stayed in inventory.');
      expect(trailingDropped).toContain('1A40A0300003F49000194712');
      // Missing leading underscores
      const leadingDropped = a.deanonymize('Package TAG_0001__ stayed in inventory.');
      expect(leadingDropped).toContain('1A40A0300003F49000194712');
    });

    it('does not false-positive on real text that resembles a token', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      // ORG_001 is a defined token, but TAG_9999 isn't — should be left alone
      a.anonymize(REALISTIC_TOOL_RESULT);
      const reply = 'See ticket TAG_9999 for details (not in our map).';
      const restored = a.deanonymize(reply);
      expect(restored).toContain('TAG_9999');
    });
  });

  describe('mapping snapshot for audit UI', () => {
    it('exposes the real→token mapping with type tags', () => {
      const a = createAnonymizer(FIXTURE_CONTEXT);
      a.anonymize(REALISTIC_TOOL_RESULT);
      const mappings = a.getMappings();
      const types = new Set(mappings.map(m => m.type));
      expect(types.has('facility')).toBe(true);
      expect(types.has('license')).toBe(true);
      expect(types.has('strain')).toBe(true);
      expect(types.has('tag')).toBe(true);
      expect(types.has('manifest')).toBe(true);
    });
  });
});
