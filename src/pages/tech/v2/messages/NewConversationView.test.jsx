/**
 * Focused render and endpoint-contract coverage for the mobile conversation picker.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({ Authorization: 'Bearer test' }) }));
vi.mock('@/lib/toast', () => ({ err: vi.fn() }));

import NewConversationView from './NewConversationView';

const source = readFileSync(fileURLToPath(new URL('./NewConversationView.jsx', import.meta.url)), 'utf8');

afterEach(() => { i18n.changeLanguage('en'); });

describe('NewConversationView', () => {
  it('renders as a translated full-screen picker with an accessible Back action', () => {
    i18n.changeLanguage('en');
    const output = renderToStaticMarkup(
      <NewConversationView onBack={() => {}} onStarted={() => {}} />,
    );

    expect(output).toContain('New conversation');
    expect(output).toContain('Search contacts');
    expect(output).toContain('aria-label="Back"');
    expect(output).toContain('Type at least 2 characters');
  });

  it('uses only the capability-gated search and start endpoint contract', () => {
    expect(source).toContain('`/api/message-conversations?q=${encodeURIComponent(query)}`');
    expect(source).toContain("fetch('/api/message-conversations'");
    expect(source).toContain('JSON.stringify({ contact_id: contact.id })');
    expect(source).toContain('const conversation = data.conversation || null');
  });

  it.each([
    ['es', 'Nueva conversación', 'Buscar contactos'],
    ['pt', 'Nova conversa', 'Buscar contatos'],
  ])('renders the %s translation', (language, title, search) => {
    i18n.changeLanguage(language);
    const output = renderToStaticMarkup(
      <NewConversationView onBack={() => {}} onStarted={() => {}} />,
    );
    expect(output).toContain(title);
    expect(output).toContain(search);
  });
});
