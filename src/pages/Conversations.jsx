import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToMessages, subscribeToConversations } from '@/lib/realtime';
import { IconSend, IconSearch, IconNote } from '@/components/Icons';

// ═══════════════════════════════════════════════════════════════════
// INLINE ICONS
// ═══════════════════════════════════════════════════════════════════

function IconBack(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="15 18 9 12 15 6" /></svg>);
}
function IconInfo(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>);
}
function IconPhone(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.88.36 1.72.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c1.09.34 1.93.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>);
}
function IconX(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}
function IconLink(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>);
}
function IconPlus(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
}
function IconClock(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>);
}
function IconTemplate(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>);
}
function IconDots(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>);
}
function IconCheck(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="20 6 9 17 4 12" /></svg>);
}
function IconCheckAll(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="18 6 7 17 2 12" /><polyline points="22 6 11 17" /></svg>);
}
function IconPaperclip(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>);
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function formatListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
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
function cleanName(title) { return (title || 'Unknown').replace(/\s*\[DEMO\]\s*/g, ''); }

const STATUS_MAP = {
  needs_response: { label: 'Needs Response', cls: 'status-needs-response' },
  waiting_on_client: { label: 'Waiting', cls: 'status-waiting' },
  resolved: { label: 'Resolved', cls: 'status-resolved' },
};
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'needs_response', label: 'Needs Response' },
  { key: 'waiting_on_client', label: 'Waiting' },
  { key: 'resolved', label: 'Resolved' },
];
const TEMPLATE_CATEGORIES = {
  scheduling: '📅 Scheduling', insurance: '🛡️ Insurance', drying: '💧 Drying',
  reconstruction: '🏗️ Reconstruction', closeout: '✅ Closeout', follow_up: '🔁 Follow Up',
  auto: '🤖 Auto', general: '📝 General',
};

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function Conversations() {
  const { db, employee } = useAuth();

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [linkedJob, setLinkedJob] = useState(null);

  const [mobileView, setMobileView] = useState('list');
  const [showInfo, setShowInfo] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [compose, setCompose] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [contextMenu, setContextMenu] = useState(null);
  const [showNewConv, setShowNewConv] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [creatingConv, setCreatingConv] = useState(false);

  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [showComposeActions, setShowComposeActions] = useState(false);

  const messagesEndRef = useRef(null);
  const composeRef = useRef(null);

  // ═══ DATA ═══

  const loadConversations = useCallback(async () => {
    try {
      const data = await db.select('conversations',
        'select=*,conversation_participants(contact_id,phone,role,contacts(id,name,phone,email,company,role))&order=last_message_at.desc.nullslast'
      );
      setConversations(data);
    } catch (err) { console.error('Load conversations error:', err); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    const unsubscribe = subscribeToConversations((payload) => {
      if (payload.eventType === 'UPDATE' && payload.new) {
        setConversations(prev =>
          prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c)
            .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))
        );
      } else if (payload.eventType === 'INSERT') { loadConversations(); }
    });
    return unsubscribe;
  }, [loadConversations]);

  useEffect(() => {
    if (!activeId) { setMessages([]); setLinkedJob(null); return; }
    let cancelled = false;
    const load = async () => {
      setMsgLoading(true);
      try {
        const msgs = await db.select('messages',
          `conversation_id=eq.${activeId}&order=created_at.asc&select=id,type,body,status,sent_by,sender_contact_id,media_urls,created_at`
        );
        if (!cancelled) setMessages(msgs);
        const conv = conversations.find(c => c.id === activeId);
        if (conv?.unread_count > 0) {
          await db.update('conversations', `id=eq.${activeId}`, { unread_count: 0 });
          setConversations(prev => prev.map(c => c.id === activeId ? { ...c, unread_count: 0 } : c));
        }
        if (conv?.job_id) {
          try {
            const jobs = await db.select('jobs', `id=eq.${conv.job_id}&select=id,job_number,insured_name,phase,division&limit=1`);
            if (!cancelled && jobs.length > 0) setLinkedJob(jobs[0]); else if (!cancelled) setLinkedJob(null);
          } catch { if (!cancelled) setLinkedJob(null); }
        } else { if (!cancelled) setLinkedJob(null); }
      } catch (err) { console.error('Load messages error:', err); }
      finally { if (!cancelled) setMsgLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [activeId, db]);

  useEffect(() => {
    if (!activeId) return;
    const unsubscribe = subscribeToMessages(activeId, (newMsg, eventType) => {
      if (eventType === 'update') setMessages(prev => prev.map(m => m.id === newMsg.id ? newMsg : m));
      else setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
    });
    return unsubscribe;
  }, [activeId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ═══ DERIVED ═══

  const activeConv = useMemo(() => conversations.find(c => c.id === activeId) || null, [conversations, activeId]);
  const activeContact = useMemo(() => {
    if (!activeConv?.conversation_participants?.length) return null;
    const p = activeConv.conversation_participants.find(p => p.role === 'primary') || activeConv.conversation_participants[0];
    return p?.contacts || null;
  }, [activeConv]);

  const filtered = useMemo(() => {
    let list = conversations;
    if (filter === 'unread') list = list.filter(c => c.unread_count > 0);
    else if (filter !== 'all') list = list.filter(c => c.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => c.title?.toLowerCase().includes(q) || c.last_message_preview?.toLowerCase().includes(q));
    }
    return list;
  }, [conversations, filter, search]);

  const statusCounts = useMemo(() => {
    const c = { all: conversations.length, unread: 0, needs_response: 0, waiting_on_client: 0, resolved: 0 };
    conversations.forEach(cv => { if (cv.unread_count > 0) c.unread++; if (c[cv.status] !== undefined) c[cv.status]++; });
    return c;
  }, [conversations]);

  const groupedMessages = useMemo(() => {
    const g = []; let cur = null;
    messages.forEach(msg => {
      const l = getDateLabel(msg.created_at);
      if (l !== cur) { cur = l; g.push({ type: 'date', label: l }); }
      g.push({ type: 'msg', data: msg });
    });
    return g;
  }, [messages]);

  const templatesByCategory = useMemo(() => {
    const g = {};
    templates.forEach(t => { if (!g[t.category]) g[t.category] = []; g[t.category].push(t); });
    return g;
  }, [templates]);

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.company?.toLowerCase().includes(q));
  }, [contacts, contactSearch]);

  // ═══ ACTIONS ═══

  const selectConversation = (id) => {
    setActiveId(id); setMobileView('thread'); setShowInfo(false);
    setCompose(''); setIsNote(false); setShowTemplates(false); setShowSchedule(false); setContextMenu(null); setShowComposeActions(false);
  };
  const goBackToList = () => { setMobileView('list'); setShowInfo(false); setShowTemplates(false); setShowSchedule(false); };

  const markAsUnread = async (convId) => {
    setContextMenu(null);
    try { await db.update('conversations', `id=eq.${convId}`, { unread_count: 1 }); setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread_count: 1 } : c)); }
    catch (err) { console.error('Mark unread error:', err); }
  };
  const markAsRead = async (convId) => {
    setContextMenu(null);
    try { await db.update('conversations', `id=eq.${convId}`, { unread_count: 0 }); setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread_count: 0 } : c)); }
    catch (err) { console.error('Mark read error:', err); }
  };
  const readAll = async () => {
    const unread = conversations.filter(c => c.unread_count > 0);
    if (!unread.length) return;
    try { await Promise.all(unread.map(c => db.update('conversations', `id=eq.${c.id}`, { unread_count: 0 }))); setConversations(prev => prev.map(c => ({ ...c, unread_count: 0 }))); }
    catch (err) { console.error('Read all error:', err); }
  };

  const handleSend = async () => {
    const text = compose.trim();
    if (!text || sending || !activeId) return;

    // Scheduled
    if (showSchedule && scheduleDate && scheduleTime) {
      setSending(true);
      try {
        const sendAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
        await db.insert('scheduled_messages', { conversation_id: activeId, body: text, send_at: sendAt, status: 'pending', created_by: employee?.id || null });
        setCompose(''); setShowSchedule(false); setScheduleDate(''); setScheduleTime('');
      } catch (err) { console.error('Schedule error:', err); }
      finally { setSending(false); }
      return;
    }

    // Immediate
    setSending(true);
    try {
      const msgData = { conversation_id: activeId, type: isNote ? 'internal_note' : 'sms_outbound', body: text, status: isNote ? 'received' : 'queued', sent_by: employee?.id || null };
      const [newMsg] = await db.insert('messages', msgData);
      setMessages(prev => [...prev, newMsg]);
      const preview = isNote ? `[Note] ${text.substring(0, 80)}` : text.substring(0, 100);
      const upd = { last_message_at: new Date().toISOString(), last_message_preview: preview, updated_at: new Date().toISOString() };
      if (!isNote && activeConv?.status === 'needs_response') {
        upd.status = 'waiting_on_client'; upd.status_changed_at = new Date().toISOString();
        if (!activeConv.first_response_at) upd.first_response_at = new Date().toISOString();
      }
      await db.update('conversations', `id=eq.${activeId}`, upd);
      setConversations(prev => prev.map(c => c.id === activeId ? { ...c, ...upd } : c));
      setCompose(''); setIsNote(false); composeRef.current?.focus();
    } catch (err) { console.error('Send error:', err); }
    finally { setSending(false); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };
  const handleComposeInput = (e) => { setCompose(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; };

  const openNewConvModal = async () => {
    setShowNewConv(true); setContactSearch('');
    try { const data = await db.select('contacts', 'select=id,name,phone,email,company,role&order=name.asc'); setContacts(data); }
    catch (err) { console.error('Load contacts error:', err); }
  };
  const createNewConversation = async (contact) => {
    if (creatingConv) return;
    const existing = conversations.find(c => c.conversation_participants?.some(p => p.contact_id === contact.id));
    if (existing) { setShowNewConv(false); selectConversation(existing.id); return; }
    setCreatingConv(true);
    try {
      const title = contact.company ? `${contact.name} — ${contact.company}` : contact.name;
      const [conv] = await db.insert('conversations', { type: 'direct', title, status: 'needs_response' });
      await db.insert('conversation_participants', { conversation_id: conv.id, contact_id: contact.id, phone: contact.phone, role: 'primary' });
      setShowNewConv(false); await loadConversations(); selectConversation(conv.id);
    } catch (err) { console.error('Create conversation error:', err); }
    finally { setCreatingConv(false); }
  };

  const openTemplates = async () => {
    setShowTemplates(!showTemplates); setShowSchedule(false);
    if (templates.length === 0) {
      try { const data = await db.select('message_templates', 'is_active=eq.true&order=category.asc,title.asc'); setTemplates(data); }
      catch (err) { console.error('Load templates error:', err); }
    }
  };
  const insertTemplate = (tmpl) => { setCompose(tmpl.body); setShowTemplates(false); composeRef.current?.focus(); };

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // ═══ RENDER ═══

  return (
    <div className={`conversations-layout${mobileView === 'thread' ? ' mobile-thread' : ''}`}>

      {/* ═══ LEFT: Conversation List ═══ */}
      <div className="conv-list-panel">
        <div className="conv-list-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="conv-list-title">Messages</div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {statusCounts.unread > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={readAll} title="Mark all as read"><IconCheckAll style={{ width: 16, height: 16 }} /></button>
              )}
              <button className="btn btn-sm btn-primary" onClick={openNewConvModal} title="New conversation"><IconPlus style={{ width: 14, height: 14 }} /></button>
            </div>
          </div>
          <div className="conv-search-wrap">
            <IconSearch className="conv-search-icon" style={{ width: 14, height: 14 }} />
            <input className="conv-search" placeholder="Search conversations..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="conv-filters">
          {FILTERS.map(f => (
            <button key={f.key} className={`conv-filter-btn${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
              {statusCounts[f.key] > 0 && <span className="conv-filter-count">{statusCounts[f.key]}</span>}
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
              <div className="empty-state-text">{search || filter !== 'all' ? 'Try adjusting your filters' : 'Messages will appear when they come in'}</div>
            </div>
          ) : filtered.map(conv => {
            const isActive = conv.id === activeId;
            const hasUnread = conv.unread_count > 0;
            const si = STATUS_MAP[conv.status] || {};
            return (
              <div key={conv.id} className={`conv-item${isActive ? ' active' : ''}${hasUnread ? ' unread' : ''}`}
                onClick={() => selectConversation(conv.id)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ convId: conv.id, x: e.clientX, y: e.clientY }); }}>
                <div className="conv-item-avatar">{getInitials(conv.title)}</div>
                <div className="conv-item-content">
                  <div className="conv-item-top">
                    <span className="conv-item-name">{cleanName(conv.title)}</span>
                    <span className="conv-item-time">{formatListTime(conv.last_message_at)}</span>
                  </div>
                  <div className="conv-item-preview">{conv.last_message_preview || 'No messages yet'}</div>
                  <div className="conv-item-meta">
                    <span className={`status-badge ${si.cls || ''}`}>{si.label || conv.status?.replace(/_/g, ' ')}</span>
                    {hasUnread && <span className="conv-unread-badge">{conv.unread_count}</span>}
                  </div>
                </div>
                <button className="conv-item-action" onClick={(e) => { e.stopPropagation(); setContextMenu({ convId: conv.id, x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().top }); }} aria-label="More">
                  <IconDots style={{ width: 16, height: 16 }} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ CENTER: Thread ═══ */}
      <div className="conv-thread-panel">
        {!activeId ? (
          <div className="conv-empty-thread"><div className="empty-state-icon">💬</div><div className="empty-state-title">Select a conversation</div><div className="empty-state-text">Choose from the list to view messages</div></div>
        ) : (
          <>
            <div className="conv-thread-header">
              <div className="conv-thread-header-left">
                <button className="conv-back-btn" onClick={goBackToList} aria-label="Back"><IconBack style={{ width: 20, height: 20 }} /></button>
                <div style={{ minWidth: 0 }}>
                  <div className="conv-thread-title">{cleanName(activeConv?.title)}</div>
                  {activeContact?.phone && <div className="conv-thread-subtitle">{activeContact.phone}</div>}
                </div>
              </div>
              <div className="conv-thread-header-right">
                {linkedJob && (
                  <a href={`/jobs/${linkedJob.id}`} className="btn btn-sm btn-secondary conv-job-link" title={linkedJob.job_number}>
                    <span className="conv-job-link-num">{linkedJob.job_number}</span><IconLink style={{ width: 12, height: 12 }} />
                  </a>
                )}
                <button className="conv-info-btn" onClick={() => setShowInfo(!showInfo)} aria-label="Contact info"><IconInfo style={{ width: 18, height: 18 }} /></button>
              </div>
            </div>

            <div className="conv-messages">
              {msgLoading ? (<div className="loading-page"><div className="spinner" /></div>
              ) : messages.length === 0 ? (
                <div className="empty-state" style={{ flex: 1 }}><div className="empty-state-text">No messages yet. Send the first one below.</div></div>
              ) : groupedMessages.map((item, i) => {
                if (item.type === 'date') return <div key={`d-${i}`} className="conv-date-sep"><span>{item.label}</span></div>;
                const msg = item.data;
                const cls = `message ${msg.type === 'sms_inbound' ? 'inbound' : msg.type === 'internal_note' ? 'internal-note' : 'outbound'}`;
                return (
                  <div key={msg.id} className={cls}>
                    <div className="message-bubble">
                      {msg.type === 'internal_note' && <span className="msg-note-label">📝 Note</span>}
                      {msg.body}
                    </div>
                    <div className="message-meta">
                      <span>{formatMsgTime(msg.created_at)}</span>
                      {msg.type === 'sms_outbound' && msg.status && <span className="msg-status-tag">{msg.status}</span>}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Template picker */}
            {showTemplates && (
              <div className="conv-template-picker">
                <div className="conv-template-header">
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Templates</span>
                  <button className="conv-detail-close-btn" onClick={() => setShowTemplates(false)}><IconX style={{ width: 16, height: 16 }} /></button>
                </div>
                <div className="conv-template-list">
                  {Object.entries(templatesByCategory).map(([cat, tmpls]) => (
                    <div key={cat}>
                      <div className="conv-template-cat">{TEMPLATE_CATEGORIES[cat] || cat}</div>
                      {tmpls.map(t => (
                        <button key={t.id} className="conv-template-item" onClick={() => insertTemplate(t)}>
                          <div className="conv-template-title">{t.title}</div>
                          <div className="conv-template-body">{t.body.substring(0, 80)}{t.body.length > 80 ? '...' : ''}</div>
                        </button>
                      ))}
                    </div>
                  ))}
                  {templates.length === 0 && <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>No templates found</div>}
                </div>
              </div>
            )}

            {/* Schedule picker */}
            {showSchedule && (
              <div className="conv-schedule-picker">
                <div className="conv-template-header">
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Schedule Message</span>
                  <button className="conv-detail-close-btn" onClick={() => { setShowSchedule(false); setScheduleDate(''); setScheduleTime(''); }}><IconX style={{ width: 16, height: 16 }} /></button>
                </div>
                <div style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
                  <input type="date" className="input" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} style={{ flex: 1 }} min={new Date().toISOString().split('T')[0]} />
                  <input type="time" className="input" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={{ width: 120 }} />
                </div>
                {scheduleDate && scheduleTime && (
                  <div style={{ padding: '0 var(--space-4) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    Will send {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                  </div>
                )}
              </div>
            )}

            {/* ── Compose Actions Sheet ── */}
            {showComposeActions && (
              <div className="conv-actions-sheet">
                <button className="conv-action-item" onClick={() => { setIsNote(!isNote); setShowSchedule(false); setScheduleDate(''); setScheduleTime(''); setShowTemplates(false); setShowComposeActions(false); }}>
                  <span className="conv-action-icon" style={{ background: isNote ? '#fef9c3' : 'var(--bg-tertiary)' }}><IconNote style={{ width: 18, height: 18, color: isNote ? '#92400e' : 'var(--text-secondary)' }} /></span>
                  <div><div className="conv-action-label">{isNote ? 'Switch to Message' : 'Internal Note'}</div><div className="conv-action-desc">{isNote ? 'Send as SMS to contact' : 'Only visible to your team'}</div></div>
                </button>
                <button className="conv-action-item" onClick={() => { setIsNote(false); setShowSchedule(false); setScheduleDate(''); setScheduleTime(''); openTemplates(); setShowComposeActions(false); }}>
                  <span className="conv-action-icon"><IconTemplate style={{ width: 18, height: 18 }} /></span>
                  <div><div className="conv-action-label">Templates</div><div className="conv-action-desc">Insert a saved message template</div></div>
                </button>
                <button className="conv-action-item" onClick={() => { setIsNote(false); setShowSchedule(!showSchedule); if (showSchedule) { setScheduleDate(''); setScheduleTime(''); } setShowTemplates(false); setShowComposeActions(false); }}>
                  <span className="conv-action-icon" style={{ background: showSchedule ? 'var(--accent-light)' : 'var(--bg-tertiary)' }}><IconClock style={{ width: 18, height: 18, color: showSchedule ? 'var(--accent)' : 'var(--text-secondary)' }} /></span>
                  <div><div className="conv-action-label">{showSchedule ? 'Cancel Schedule' : 'Schedule Message'}</div><div className="conv-action-desc">{showSchedule ? 'Send immediately instead' : 'Choose when to send'}</div></div>
                </button>
                <button className="conv-action-item" onClick={() => setShowComposeActions(false)} disabled>
                  <span className="conv-action-icon"><IconPaperclip style={{ width: 18, height: 18 }} /></span>
                  <div><div className="conv-action-label">Attach File</div><div className="conv-action-desc">Photos, documents — coming soon</div></div>
                </button>
              </div>
            )}

            {/* ── Compose bar: [+] [input] [send] ── */}
            <div className={`conv-compose${isNote ? ' note-mode' : ''}${showSchedule && scheduleDate && scheduleTime ? ' schedule-mode' : ''}`}>
              <button className={`conv-plus-btn${showComposeActions ? ' active' : ''}${isNote ? ' note-active' : ''}`} onClick={() => setShowComposeActions(!showComposeActions)} aria-label="More actions">
                <IconPlus style={{ width: 18, height: 18, transition: 'transform 200ms ease', transform: showComposeActions ? 'rotate(45deg)' : 'none' }} />
              </button>
              {/* Active mode chips */}
              {isNote && !showComposeActions && <span className="conv-mode-chip note">📝 Note</span>}
              {showSchedule && scheduleDate && scheduleTime && !showComposeActions && <span className="conv-mode-chip schedule">🕐 Scheduled</span>}
              <textarea ref={composeRef} className="conv-compose-input" placeholder={isNote ? 'Write an internal note...' : showSchedule && scheduleDate ? 'Write scheduled message...' : 'Type a message...'} value={compose} onChange={handleComposeInput} onKeyDown={handleKeyDown} rows={1} />
              <button className={`btn conv-send-btn ${showSchedule && scheduleDate && scheduleTime ? 'btn-schedule' : 'btn-primary'}`} onClick={handleSend} disabled={!compose.trim() || sending || (showSchedule && (!scheduleDate || !scheduleTime))} aria-label="Send">
                {sending ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: '2px' }} /> : showSchedule && scheduleDate && scheduleTime ? <IconClock style={{ width: 16, height: 16 }} /> : <IconSend style={{ width: 16, height: 16 }} />}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ═══ RIGHT: Detail ═══ */}
      {showInfo && <div className="conv-info-backdrop" onClick={() => setShowInfo(false)} />}
      <div className={`conv-detail-panel${showInfo ? ' open' : ''}`}>
        {activeConv ? (
          <>
            <div className="conv-detail-close-row"><button className="conv-detail-close-btn" onClick={() => setShowInfo(false)}><IconX style={{ width: 18, height: 18 }} /></button></div>
            <div className="conv-detail-section" style={{ textAlign: 'center' }}>
              <div className="conv-detail-avatar-lg">{getInitials(activeContact?.name || activeConv.title)}</div>
              <div className="conv-detail-name">{cleanName(activeContact?.name || activeConv.title)}</div>
              {activeContact?.company && <div className="conv-detail-company">{activeContact.company}</div>}
              {activeContact?.role && <span className="conv-detail-role-tag">{activeContact.role.replace(/_/g, ' ')}</span>}
            </div>
            <div className="conv-detail-section">
              <div className="conv-detail-label">Contact</div>
              {activeContact?.phone && <div className="conv-detail-row"><IconPhone style={{ width: 14, height: 14, color: 'var(--text-tertiary)', flexShrink: 0 }} /><a href={`tel:${activeContact.phone}`} className="conv-detail-link">{activeContact.phone}</a></div>}
              {activeContact?.email && <div className="conv-detail-row"><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', width: 14, textAlign: 'center', flexShrink: 0 }}>@</span><a href={`mailto:${activeContact.email}`} className="conv-detail-link">{activeContact.email}</a></div>}
            </div>
            {linkedJob && (
              <div className="conv-detail-section">
                <div className="conv-detail-label">Linked Job</div>
                <a href={`/jobs/${linkedJob.id}`} className="conv-detail-job-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="conv-detail-job-num">{linkedJob.job_number}</span>
                    {linkedJob.division && <span className="division-badge" data-division={linkedJob.division}>{linkedJob.division}</span>}
                  </div>
                  {linkedJob.insured_name && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>{linkedJob.insured_name}</div>}
                </a>
              </div>
            )}
            <div className="conv-detail-section">
              <div className="conv-detail-label">Conversation</div>
              <div className="conv-detail-meta-row"><span>Status</span><span className={`status-badge ${STATUS_MAP[activeConv.status]?.cls || ''}`}>{STATUS_MAP[activeConv.status]?.label || activeConv.status?.replace(/_/g, ' ')}</span></div>
              <div className="conv-detail-meta-row"><span>Type</span><span style={{ textTransform: 'capitalize' }}>{activeConv.type || '—'}</span></div>
              <div className="conv-detail-meta-row"><span>Created</span><span>{activeConv.created_at ? new Date(activeConv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span></div>
            </div>
            <div className="conv-detail-section">
              <div className="conv-detail-label">Actions</div>
              <button className="btn btn-sm btn-secondary" style={{ width: '100%' }} onClick={() => markAsUnread(activeId)}>Mark as unread</button>
            </div>
          </>
        ) : (<div className="conv-detail-section" style={{ color: 'var(--text-tertiary)', textAlign: 'center', paddingTop: 40 }}>Select a conversation</div>)}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="conv-context-menu" style={{ top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 180) }}>
          {conversations.find(c => c.id === contextMenu.convId)?.unread_count > 0
            ? <button className="conv-context-item" onClick={() => markAsRead(contextMenu.convId)}><IconCheck style={{ width: 14, height: 14 }} /> Mark as read</button>
            : <button className="conv-context-item" onClick={() => markAsUnread(contextMenu.convId)}><span className="conv-ctx-unread-dot" /> Mark as unread</button>
          }
        </div>
      )}

      {/* New Conversation Modal */}
      {showNewConv && (
        <div className="conv-modal-backdrop" onClick={() => setShowNewConv(false)}>
          <div className="conv-modal" onClick={e => e.stopPropagation()}>
            <div className="conv-modal-header">
              <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>New Conversation</span>
              <button className="conv-detail-close-btn" onClick={() => setShowNewConv(false)}><IconX style={{ width: 18, height: 18 }} /></button>
            </div>
            <div style={{ padding: 'var(--space-4)' }}>
              <input className="input" placeholder="Search contacts by name, phone, or company..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} autoFocus />
            </div>
            <div className="conv-modal-list">
              {filteredContacts.length === 0 ? (
                <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>{contactSearch ? 'No contacts found' : 'Loading contacts...'}</div>
              ) : filteredContacts.map(contact => (
                <button key={contact.id} className="conv-contact-item" onClick={() => createNewConversation(contact)} disabled={creatingConv}>
                  <div className="conv-item-avatar" style={{ width: 36, height: 36, fontSize: 'var(--text-xs)' }}>{getInitials(contact.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{contact.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'flex', gap: 'var(--space-2)' }}>
                      <span>{contact.phone}</span>{contact.company && <span>· {contact.company}</span>}
                    </div>
                  </div>
                  <span className="conv-detail-role-tag" style={{ fontSize: '10px' }}>{contact.role?.replace(/_/g, ' ')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
