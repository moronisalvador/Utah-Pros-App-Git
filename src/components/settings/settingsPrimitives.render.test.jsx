/**
 * Render smoke-tests for the Settings Overhaul Phase F shared primitives. Uses
 * renderToStaticMarkup (no jsdom — vitest runs in plain node here) to prove the
 * real components mount and emit their data, plus unit assertions on the plain
 * data modules (navKeys, owner). Guards the extraction, not the polish.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import SettingsSection from '@/components/settings/SettingsSection';
import LookupTable from '@/components/settings/LookupTable';
import TabLoading from '@/components/TabLoading';
import { NAV_KEYS, PAGE_ACCESS_KEYS, ROLES, roleLabel } from '@/lib/navKeys';
import { isMoroni, OWNER_EMAIL } from '@/lib/owner';

describe('Settings shared primitives render', () => {
  it('SettingsPageHeader shows title + subtitle', () => {
    const out = renderToStaticMarkup(<SettingsPageHeader title="Carriers" subtitle="3 carriers" />);
    expect(out).toContain('Carriers');
    expect(out).toContain('3 carriers');
  });

  it('SettingsSection shows title + description + children', () => {
    const out = renderToStaticMarkup(
      <SettingsSection title="Payroll" description="Set rates">
        <span>child-content</span>
      </SettingsSection>,
    );
    expect(out).toContain('Payroll');
    expect(out).toContain('Set rates');
    expect(out).toContain('child-content');
  });

  it('TabLoading shows its label', () => {
    expect(renderToStaticMarkup(<TabLoading label="Loading carriers…" />)).toContain('Loading carriers…');
  });

  it('LookupTable renders title, subtitle and its rows', () => {
    const out = renderToStaticMarkup(
      <LookupTable
        title="Insurance Carriers"
        subtitle="2 carriers"
        items={[{ id: '1', name: 'State Farm', short_name: 'SF' }, { id: '2', name: 'Allstate', short_name: 'AS' }]}
        onSave={() => true}
        onDelete={() => {}}
        columns={[{ key: 'name', label: 'Carrier Name', flex: 3, required: true }, { key: 'short_name', label: 'Code', flex: 1 }]}
        newItemDefaults={{ name: '', short_name: '' }}
      />,
    );
    expect(out).toContain('Insurance Carriers');
    expect(out).toContain('State Farm');
    expect(out).toContain('Allstate');
  });

  it('LookupTable shows an empty state when there are no items', () => {
    const out = renderToStaticMarkup(
      <LookupTable title="Referral Sources" subtitle="0 sources" items={[]} onSave={() => true} onDelete={() => {}}
        columns={[{ key: 'name', label: 'Source Name', required: true }]} newItemDefaults={{ name: '' }} />,
    );
    expect(out).toContain('No items yet');
  });
});

describe('navKeys registry', () => {
  it('exposes the settings + admin_panel system keys', () => {
    const keys = NAV_KEYS.map(k => k.key);
    expect(keys).toContain('settings');
    expect(keys).toContain('admin_panel');
  });
  it('PAGE_ACCESS_KEYS includes collections (per-employee grantable)', () => {
    expect(PAGE_ACCESS_KEYS.map(k => k.key)).toContain('collections');
  });
  it('roleLabel maps known roles and falls back to the raw key', () => {
    expect(roleLabel('crm_partner')).toBe('CRM Partner (external)');
    expect(roleLabel('field_tech')).toBe('Field Tech');
    expect(roleLabel('unknown_role')).toBe('unknown_role');
    expect(ROLES.length).toBeGreaterThan(0);
  });
});

describe('owner helper', () => {
  it('recognizes the owner and rejects the test account', () => {
    expect(OWNER_EMAIL).toBe('moroni@utah-pros.com');
    expect(isMoroni({ email: 'moroni@utah-pros.com' })).toBe(true);
    expect(isMoroni({ email: 'moroni.s@utah-pros.com' })).toBe(false);
    expect(isMoroni(null)).toBe(false);
  });
});
