/**
 * ════════════════════════════════════════════════
 * FILE: NewConversationView.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES:
 *   Full-screen mobile contact picker for starting or reopening a direct conversation.
 *   Search and creation stay behind the server's messaging authorization boundary.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAuthHeader } from '@/lib/realtime';
import { err } from '@/lib/toast';

function IconBack(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="15 18 9 12 15 6" /></svg>);
}
function IconSearch(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>);
}

export default function NewConversationView({ onBack, onStarted }) {
  const { t } = useTranslation('msgs');
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    if (query.length < 2) {
      setContacts([]);
      setLoading(false);
      setLoadError(null);
      return undefined;
    }
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const authHeader = await getAuthHeader();
        const response = await fetch(
          `/api/message-conversations?q=${encodeURIComponent(query)}`,
          { headers: authHeader, signal: controller.signal },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || t('newConversation.loadError'));
        if (current) setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      } catch (error) {
        if (error.name !== 'AbortError' && current) {
          setContacts([]);
          setLoadError(error.message || t('newConversation.loadError'));
        }
      } finally {
        if (current) setLoading(false);
      }
    })();

    return () => {
      current = false;
      controller.abort();
    };
  }, [query, reloadKey, t]);

  const startConversation = async (contact) => {
    if (!contact?.id || startingId) return;
    setStartingId(contact.id);
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch('/api/message-conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ contact_id: contact.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('newConversation.startError'));
      const conversation = data.conversation || null;
      if (!conversation?.id) throw new Error(t('newConversation.startError'));
      onStarted?.(conversation);
    } catch (error) {
      err(error.message || t('newConversation.startError'));
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="tv2-msgs-new">
      <header className="tv2-msgs-thread__bar">
        <button type="button" className="tv2-msgs-thread__back" aria-label={t('thread.back')} onClick={onBack}>
          <IconBack width={24} height={24} />
        </button>
        <div className="tv2-msgs-thread__title">{t('newConversation.title')}</div>
        <div className="tv2-msgs-thread__bar-spacer" aria-hidden="true" />
      </header>

      <div className="tv2-msgs-new__search">
        <div className="tv2-msgs-search">
          <IconSearch className="tv2-msgs-search__icon" width={16} height={16} aria-hidden="true" />
          <input
            className="tv2-msgs-search__input"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('newConversation.searchPlaceholder')}
            enterKeyHint="search"
            aria-label={t('newConversation.searchPlaceholder')}
            autoFocus
          />
        </div>
      </div>

      <div className="tv2-msgs-new__body">
        {loading ? (
          <div className="tv2-msgs-new__state">{t('newConversation.loading')}</div>
        ) : loadError ? (
          <div className="tv2-msgs-thread__error">
            <div className="tv2-msgs-thread__empty">{loadError}</div>
            <button type="button" className="tv2-msgs-retry-btn" onClick={() => setReloadKey((key) => key + 1)}>
              {t('states.retry')}
            </button>
          </div>
        ) : contacts.length === 0 ? (
          <div className="tv2-msgs-new__state">
            {query.length < 2 ? t('newConversation.typeHint') : t('newConversation.empty')}
          </div>
        ) : (
          <div className="tv2-msgs-new__rows">
            {contacts.map((contact) => (
              <button
                key={contact.id}
                type="button"
                className="tv2-msgs-new__contact"
                onClick={() => startConversation(contact)}
                disabled={!!startingId}
              >
                <span className="tv2-msgs-row__avatar" aria-hidden="true">
                  {(contact.name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                </span>
                <span className="tv2-msgs-new__contact-main">
                  <span className="tv2-msgs-row__name">{contact.name || t('newConversation.unnamed')}</span>
                  <span className="tv2-msgs-row__preview">
                    {contact.phone}{contact.company ? ` · ${contact.company}` : ''}
                  </span>
                </span>
                {startingId === contact.id && <span className="tv2-msgs-new__starting">{t('newConversation.starting')}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
