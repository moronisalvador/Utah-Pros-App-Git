import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToMessages, subscribeToConversations } from '@/lib/realtime';
import { IconSend, IconSearch, IconNote } from '@/components/Icons';

// ── Inline icons (can move to Icons.jsx later) ──────────────────

function IconBack(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconInfo(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function IconPhone(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.88.36 1.72.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c1.09.34 1.93.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconX(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconLink(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}


// ── Time / display helpers ────────────────────────────────────────

function formatListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMsgTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - msgDay) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getInitials(name) {
  if (!name) return '?';
  const clean = name.replace(/\s*\[DEMO\]\s*/g, '').trim();
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function displayName(title) {
  return (title || 'Unknown').replace(/\s*\[DEMO\]\s*/g, '');
}


// ── Status config ─────────────────────────────────────────────────

const STATUS_MAP = {
  needs_response: { label: 'Needs Response', cls: 'status-needs-response' },
  waiting_on_client: { label: 'Waiting', cls: 'status-waiting' },
  resolved: { label: 'Resolved', cls: 'status-resolved' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs_response', label: 'Needs Response' },
  { key: 'waiting_on_client', label: 'Waiting' },
  { key: 'resolved', label: 'Resolved' },
];


// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function Conversations() {
  const { db, employee } = useAuth();

  // ── Core state ──
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [linkedJob, setLinkedJob] = useState(null);

  // ── UI state ──
  const [mobileView, setMobileView] = useState('list'); // 'list' | 'thread'
  const [showInfo, setShowInfo] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [compose, setCompose] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef(null);
  const composeRef = useRef(null);


  // ═══ DATA LOADING ═══════════════════════════════════════════════

  // Load conversations with embedded participant→contact data
  const loadConversations = useCallback(async () => {
    try {
      const data = await db.select(
        'conversations',
        'select=*,conversation_participants(contact_id,phone,role,contacts(id,name,phone,email,company,role))&order=last_message_at.desc.nullslast'
      );
      setConversations(data);
    } catch (err) {
      console.error('Load conversations error:', err);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { loadConversations(); }, [loadConversations]);


  // Realtime: conversation list updates
  useEffect(() => {
    const unsubscribe = subscribeToConversations((payload) => {
      if (payload.eventType === 'UPDATE' && payload.new) {
        setConversations(prev =>
          prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c)
            .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))
        );
      } else if (payload.eventType === 'INSERT' && payload.new) {
        // New conversation — reload to get embedded data
        loadConversations();
      }
    });
    return unsubscribe;
  }, [loadConversations]);


  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeId) { setMessages([]); setLinkedJob(null); return; }

    let cancelled = false;
    const load = async () => {
      setMsgLoading(true);
      try {
        const msgs = await db.select(
          'messages',
          `conversation_id=eq.${activeId}&order=created_at.asc&select=id,type,body,status,sent_by,sender_contact_id,media_urls,created_at`
        );
        if (!cancelled) setMessages(msgs);

        // Mark as read
        const conv = conversations.find(c => c.id === activeId);
        if (conv?.unread_count > 0) {
          await db.update('conversations', `id=eq.${activeId}`, { unread_count: 0 });
          setConversations(prev =>
            prev.map(c => c.id === activeId ? { ...c, unread_count: 0 } : c)
          );
        }

        // Fetch linked job
        if (conv?.job_id) {
          try {
            const jobs = await db.select(
              'jobs',
              `id=eq.${conv.job_id}&select=id,job_number,insured_name,phase,division&limit=1`
            );
            if (!cancelled && jobs.length > 0) setLinkedJob(jobs[0]);
            else if (!cancelled) setLinkedJob(null);
          } catch { if (!cancelled) setLinkedJob(null); }
        } else {
          if (!cancelled) setLinkedJob(null);
        }
      } catch (err) {
        console.error('Load messages error:', err);
      } finally {
        if (!cancelled) setMsgLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeId, db]);


  // Realtime: messages in active conversation
  useEffect(() => {
    if (!activeId) return;
    const unsubscribe = subscribeToMessages(activeId, (newMsg, eventType) => {
      if (eventType === 'update') {
        setMessages(prev => prev.map(m => m.id === newMsg.id ? newMsg : m));
      } else {
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      }
    });
    return unsubscribe;
  }, [activeId]);


  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


  // ═══ DERIVED DATA ═══════════════════════════════════════════════

  const activeConv = useMemo(
    () => conversations.find(c => c.id === activeId) || null,
    [conversations, activeId]
  );

  const activeContact = useMemo(() => {
    if (!activeConv?.conversation_participants?.length) return null;
    const primary = activeConv.conversation_participants.find(p => p.role === 'primary')
      || activeConv.conversation_participants[0];
    return primary?.contacts || null;
  }, [activeConv]);

  // Filtered + searched list
  const filtered = useMemo(() => {
    let list = conversations;
    if (filter !== 'all') list = list.filter(c => c.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.last_message_preview?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [conversations, filter, search]);

  // Status counts for filter badges
  const statusCounts = useMemo(() => {
    const counts = { all: conversations.length, needs_response: 0, waiting_on_client: 0, resolved: 0 };
    conversations.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++; });
    return counts;
  }, [conversations]);

  // Total unread for nav badge
  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    [conversations]
  );

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups = [];
    let currentLabel = null;
    messages.forEach(msg => {
      const label = getDateLabel(msg.created_at);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ type: 'date', label });
      }
      groups.push({ type: 'msg', data: msg });
    });
    return groups;
  }, [messages]);


  // ═══ ACTIONS ════════════════════════════════════════════════════

  const selectConversation = (id) => {
    setActiveId(id);
    setMobileView('thread');
    setShowInfo(false);
    setCompose('');
    setIsNote(false);
  };

  const goBackToList = () => {
    setMobileView('list');
    setShowInfo(false);
  };

  // Send message or internal note
  const handleSend = async () => {
    const text = compose.trim();
    if (!text || sending || !activeId) return;

    setSending(true);
    try {
      // ── Direct Supabase insert ──
      // TODO: Switch to POST /api/send-message worker when Twilio ID verification clears.
      // The worker handles: Twilio send, sender name prefix, status callback URL.
      // For now, direct insert works for demo and internal notes.
      const msgData = {
        conversation_id: activeId,
        type: isNote ? 'internal_note' : 'sms_outbound',
        body: text,
        status: isNote ? 'received' : 'queued',
        sent_by: employee?.id || null,
      };
      const [newMsg] = await db.insert('messages', msgData);
      setMessages(prev => [...prev, newMsg]);

      // Update conversation metadata
      const preview = isNote ? `[Note] ${text.substring(0, 80)}` : text.substring(0, 100);
      const convUpdate = {
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
        updated_at: new Date().toISOString(),
      };

      // Flip status on first outbound reply
      if (!isNote && activeConv?.status === 'needs_response') {
        convUpdate.status = 'waiting_on_client';
        convUpdate.status_changed_at = new Date().toISOString();
        if (!activeConv.first_response_at) {
          convUpdate.first_response_at = new Date().toISOString();
        }
      }

      await db.update('conversations', `id=eq.${activeId}`, convUpdate);
      setConversations(prev =>
        prev.map(c => c.id === activeId ? { ...c, ...convUpdate } : c)
      );

      setCompose('');
      setIsNote(false);
      composeRef.current?.focus();
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize compose textarea
  const handleComposeInput = (e) => {
    setCompose(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };


  // ═══ RENDER ═════════════════════════════════════════════════════

  return (
    <div className={`conversations-layout${mobileView === 'thread' ? ' mobile-thread' : ''}`}>

      {/* ═══ LEFT: Conversation List ═══ */}
      <div className="conv-list-panel">
        <div className="conv-list-header">
          <div className="conv-list-title">Messages</div>
          <div className="conv-search-wrap">
            <IconSearch className="conv-search-icon" style={{ width: 14, height: 14 }} />
            <input
              className="conv-search"
              placeholder="Search conversations..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="conv-filters">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`conv-filter-btn${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {statusCounts[f.key] > 0 && (
                <span className="conv-filter-count">{statusCounts[f.key]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="conv-list-items">
          {loading ? (
            <div className="loading-page"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon">💬</div>
              <div className="empty-state-title">No conversations</div>
              <div className="empty-state-text">
                {search || filter !== 'all' ? 'Try adjusting your filters' : 'Messages will appear when they come in'}
              </div>
            </div>
          ) : (
            filtered.map(conv => {
              const isActive = conv.id === activeId;
              const hasUnread = conv.unread_count > 0;
              const statusInfo = STATUS_MAP[conv.status] || {};
              return (
                <div
                  key={conv.id}
                  className={`conv-item${isActive ? ' active' : ''}${hasUnread ? ' unread' : ''}`}
                  onClick={() => selectConversation(conv.id)}
                >
                  <div className="conv-item-avatar">{getInitials(conv.title)}</div>
                  <div className="conv-item-content">
                    <div className="conv-item-top">
                      <span className="conv-item-name">{displayName(conv.title)}</span>
                      <span className="conv-item-time">{formatListTime(conv.last_message_at)}</span>
                    </div>
                    <div className="conv-item-preview">{conv.last_message_preview || 'No messages yet'}</div>
                    <div className="conv-item-meta">
                      <span className={`status-badge ${statusInfo.cls || ''}`}>
                        {statusInfo.label || conv.status?.replace(/_/g, ' ') || 'open'}
                      </span>
                      {hasUnread && (
                        <span className="conv-unread-badge">{conv.unread_count}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ═══ CENTER: Message Thread ═══ */}
      <div className="conv-thread-panel">
        {!activeId ? (
          <div className="conv-empty-thread">
            <div className="empty-state-icon">💬</div>
            <div className="empty-state-title">Select a conversation</div>
            <div className="empty-state-text">Choose from the list to view messages</div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="conv-thread-header">
              <div className="conv-thread-header-left">
                <button className="conv-back-btn" onClick={goBackToList} aria-label="Back to list">
                  <IconBack style={{ width: 20, height: 20 }} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div className="conv-thread-title">{displayName(activeConv?.title)}</div>
                  {activeContact?.phone && (
                    <div className="conv-thread-subtitle">{activeContact.phone}</div>
                  )}
                </div>
              </div>
              <div className="conv-thread-header-right">
                {linkedJob && (
                  <a href={`/jobs/${linkedJob.id}`} className="btn btn-sm btn-secondary conv-job-link" title={`Open ${linkedJob.job_number}`}>
                    <span className="conv-job-link-num">{linkedJob.job_number}</span>
                    <IconLink style={{ width: 12, height: 12 }} />
                  </a>
                )}
                <button className="conv-info-btn" onClick={() => setShowInfo(!showInfo)} aria-label="Contact info">
                  <IconInfo style={{ width: 18, height: 18 }} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="conv-messages">
              {msgLoading ? (
                <div className="loading-page"><div className="spinner" /></div>
              ) : messages.length === 0 ? (
                <div className="empty-state" style={{ flex: 1 }}>
                  <div className="empty-state-text">No messages yet. Send the first one below.</div>
                </div>
              ) : (
                groupedMessages.map((item, i) => {
                  if (item.type === 'date') {
                    return (
                      <div key={`date-${i}`} className="conv-date-sep">
                        <span>{item.label}</span>
                      </div>
                    );
                  }
                  const msg = item.data;
                  const isInbound = msg.type === 'sms_inbound';
                  const isOutbound = msg.type === 'sms_outbound';
                  const isNoteMsg = msg.type === 'internal_note';

                  let cls = 'message';
                  if (isInbound) cls += ' inbound';
                  else if (isOutbound) cls += ' outbound';
                  else if (isNoteMsg) cls += ' internal-note';

                  return (
                    <div key={msg.id} className={cls}>
                      <div className="message-bubble">
                        {isNoteMsg && <span className="msg-note-label">📝 Note</span>}
                        {msg.body}
                      </div>
                      <div className="message-meta">
                        <span>{formatMsgTime(msg.created_at)}</span>
                        {isOutbound && msg.status && (
                          <span className="msg-status-tag">{msg.status}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose bar */}
            <div className={`conv-compose${isNote ? ' note-mode' : ''}`}>
              <button
                className={`conv-note-toggle${isNote ? ' active' : ''}`}
                onClick={() => setIsNote(!isNote)}
                title={isNote ? 'Switch to message' : 'Internal note'}
              >
                <IconNote style={{ width: 18, height: 18 }} />
              </button>
              <textarea
                ref={composeRef}
                className="conv-compose-input"
                placeholder={isNote ? 'Write an internal note...' : 'Type a message...'}
                value={compose}
                onChange={handleComposeInput}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button
                className="btn btn-primary conv-send-btn"
                onClick={handleSend}
                disabled={!compose.trim() || sending}
                aria-label="Send"
              >
                {sending ? (
                  <div className="spinner" style={{ width: 16, height: 16, borderWidth: '2px' }} />
                ) : (
                  <IconSend style={{ width: 16, height: 16 }} />
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ═══ RIGHT: Contact / Detail Panel ═══ */}
      {showInfo && <div className="conv-info-backdrop" onClick={() => setShowInfo(false)} />}
      <div className={`conv-detail-panel${showInfo ? ' open' : ''}`}>
        {activeConv ? (
          <>
            <div className="conv-detail-close-row">
              <button className="conv-detail-close-btn" onClick={() => setShowInfo(false)} aria-label="Close">
                <IconX style={{ width: 18, height: 18 }} />
              </button>
            </div>

            {/* Avatar + name block */}
            <div className="conv-detail-section" style={{ textAlign: 'center' }}>
              <div className="conv-detail-avatar-lg">{getInitials(activeContact?.name || activeConv.title)}</div>
              <div className="conv-detail-name">{displayName(activeContact?.name || activeConv.title)}</div>
              {activeContact?.company && <div className="conv-detail-company">{activeContact.company}</div>}
              {activeContact?.role && (
                <span className="conv-detail-role-tag">{activeContact.role.replace(/_/g, ' ')}</span>
              )}
            </div>

            {/* Contact details */}
            <div className="conv-detail-section">
              <div className="conv-detail-label">Contact</div>
              {activeContact?.phone && (
                <div className="conv-detail-row">
                  <IconPhone style={{ width: 14, height: 14, color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  <a href={`tel:${activeContact.phone}`} className="conv-detail-link">{activeContact.phone}</a>
                </div>
              )}
              {activeContact?.email && (
                <div className="conv-detail-row">
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', width: 14, textAlign: 'center', flexShrink: 0 }}>@</span>
                  <a href={`mailto:${activeContact.email}`} className="conv-detail-link">{activeContact.email}</a>
                </div>
              )}
              {!activeContact?.phone && !activeContact?.email && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>No contact info available</div>
              )}
            </div>

            {/* Linked job */}
            {linkedJob && (
              <div className="conv-detail-section">
                <div className="conv-detail-label">Linked Job</div>
                <a href={`/jobs/${linkedJob.id}`} className="conv-detail-job-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="conv-detail-job-num">{linkedJob.job_number}</span>
                    {linkedJob.division && (
                      <span className="division-badge" data-division={linkedJob.division}>{linkedJob.division}</span>
                    )}
                  </div>
                  {linkedJob.insured_name && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>{linkedJob.insured_name}</div>
                  )}
                  {linkedJob.phase && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2, textTransform: 'capitalize' }}>
                      {linkedJob.phase.replace(/_/g, ' ')}
                    </div>
                  )}
                </a>
              </div>
            )}

            {/* Conversation meta */}
            <div className="conv-detail-section">
              <div className="conv-detail-label">Conversation</div>
              <div className="conv-detail-meta-row">
                <span>Status</span>
                <span className={`status-badge ${STATUS_MAP[activeConv.status]?.cls || ''}`}>
                  {STATUS_MAP[activeConv.status]?.label || activeConv.status?.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="conv-detail-meta-row">
                <span>Type</span>
                <span style={{ textTransform: 'capitalize' }}>{activeConv.type || '—'}</span>
              </div>
              <div className="conv-detail-meta-row">
                <span>Created</span>
                <span>{activeConv.created_at ? new Date(activeConv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
              </div>
              {activeConv.first_response_at && (
                <div className="conv-detail-meta-row">
                  <span>First reply</span>
                  <span>{formatListTime(activeConv.first_response_at)}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="conv-detail-section" style={{ color: 'var(--text-tertiary)', textAlign: 'center', paddingTop: 40 }}>
            Select a conversation to see details
          </div>
        )}
      </div>
    </div>
  );
}
