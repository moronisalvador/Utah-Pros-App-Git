import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sendMessage } from '@/lib/api';
import { subscribeToMessages, subscribeToConversations } from '@/lib/realtime';
import { IconSend, IconSearch, IconNote } from '@/components/Icons';

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs_response', label: 'Needs Response' },
  { key: 'waiting_on_client', label: 'Waiting' },
  { key: 'resolved', label: 'Resolved' },
];

export default function Conversations() {
  const { db, employee } = useAuth();

  // ── State ──
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [convDetail, setConvDetail] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [composeText, setComposeText] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const messagesEndRef = useRef(null);
  const composeRef = useRef(null);

  // ── Load conversations ──
  const loadConversations = useCallback(async () => {
    try {
      let query = 'select=id,title,status,last_message_at,last_message_preview,unread_count,type,assigned_to&order=last_message_at.desc.nullslast';
      if (filter !== 'all') {
        query += `&status=eq.${filter}`;
      }
      const data = await db.select('conversations', query);
      setConversations(data);
    } catch (err) {
      console.error('Load conversations error:', err);
    } finally {
      setLoadingConvs(false);
    }
  }, [db, filter]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ── Realtime: conversation list updates ──
  useEffect(() => {
    const unsubscribe = subscribeToConversations((payload) => {
      if (payload.eventType === 'UPDATE' && payload.new) {
        setConversations(prev =>
          prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c)
            .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))
        );
      } else if (payload.eventType === 'INSERT' && payload.new) {
        setConversations(prev => [payload.new, ...prev]);
      }
    });
    return unsubscribe;
  }, []);

  // ── Load messages for active conversation ──
  const loadMessages = useCallback(async (convId) => {
    if (!convId) return;
    setLoadingMsgs(true);
    try {
      const data = await db.select(
        'messages',
        `conversation_id=eq.${convId}&order=created_at.asc&select=id,type,body,status,sent_by,sender_phone,sender_contact_id,media_urls,created_at,read_at`
      );
      setMessages(data);

      // Load conversation detail
      const [conv] = await db.select('conversations', `id=eq.${convId}`);
      setConvDetail(conv);

      // Mark as read — reset unread count
      if (conv?.unread_count > 0) {
        await db.update('conversations', `id=eq.${convId}`, { unread_count: 0 });
      }
    } catch (err) {
      console.error('Load messages error:', err);
    } finally {
      setLoadingMsgs(false);
    }
  }, [db]);

  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    }
  }, [activeConvId, loadMessages]);

  // ── Realtime: messages in active conversation ──
  useEffect(() => {
    if (!activeConvId) return;
    const unsubscribe = subscribeToMessages(activeConvId, (newMsg, eventType) => {
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
  }, [activeConvId]);

  // ── Auto-scroll to bottom on new messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ──
  const handleSend = async () => {
    const text = composeText.trim();
    if (!text || !activeConvId || sending) return;

    setSending(true);
    try {
      await sendMessage({
        conversation_id: activeConvId,
        body: text,
        sent_by: employee?.id,
        is_internal_note: isNote,
      });
      setComposeText('');
      setIsNote(false);
      composeRef.current?.focus();
    } catch (err) {
      console.error('Send error:', err);
      alert('Failed to send: ' + err.message);
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

  // ── Filter conversations by search ──
  const filteredConvs = conversations.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.title || '').toLowerCase().includes(q) ||
           (c.last_message_preview || '').toLowerCase().includes(q);
  });

  // ── Helpers ──
  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getInitials = (title) => {
    if (!title) return '?';
    return title.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className="conversations-layout">
      {/* ═══ LEFT: Conversation List ═══ */}
      <div className="conv-list-panel">
        <div className="conv-list-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 className="conv-list-title">Conversations</h2>
            {/* TODO: New conversation button */}
          </div>
          <div style={{ position: 'relative' }}>
            <IconSearch className="nav-icon" style={{ position: 'absolute', left: 8, top: 7, width: 16, height: 16, color: 'var(--text-tertiary)' }} />
            <input
              className="conv-search"
              style={{ paddingLeft: 30 }}
              placeholder="Search conversations..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="conv-filters">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              className={`conv-filter-btn${filter === f.key ? ' active' : ''}`}
              onClick={() => { setFilter(f.key); setLoadingConvs(true); }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="conv-list-items">
          {loadingConvs ? (
            <div className="loading-page"><div className="spinner" /></div>
          ) : filteredConvs.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No conversations</p>
              <p className="empty-state-text">
                {filter !== 'all' ? 'Try a different filter.' : 'Conversations will appear when messages come in.'}
              </p>
            </div>
          ) : (
            filteredConvs.map(conv => (
              <div
                key={conv.id}
                className={`conv-item${activeConvId === conv.id ? ' active' : ''}`}
                onClick={() => setActiveConvId(conv.id)}
              >
                <div className="conv-item-avatar">{getInitials(conv.title)}</div>
                <div className="conv-item-content">
                  <div className="conv-item-top">
                    <span className="conv-item-name">{conv.title || 'Unknown'}</span>
                    <span className="conv-item-time">{formatTime(conv.last_message_at)}</span>
                  </div>
                  <div className="conv-item-preview">{conv.last_message_preview || 'No messages yet'}</div>
                  <div className="conv-item-meta">
                    {conv.unread_count > 0 && <span className="conv-unread-dot" />}
                    <span className={`status-badge status-${conv.status === 'needs_response' ? 'needs-response' : conv.status === 'waiting_on_client' ? 'waiting' : conv.status === 'resolved' ? 'resolved' : 'active'}`}>
                      {conv.status?.replace(/_/g, ' ') || 'open'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ═══ CENTER: Message Thread ═══ */}
      <div className="conv-thread-panel">
        {!activeConvId ? (
          <div className="loading-page">
            <div className="empty-state">
              <p className="empty-state-title">Select a conversation</p>
              <p className="empty-state-text">Choose a conversation from the list to start messaging.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="conv-thread-header">
              <span className="conv-thread-title">{convDetail?.title || 'Conversation'}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {convDetail?.status && (
                  <span className={`status-badge status-${convDetail.status === 'needs_response' ? 'needs-response' : convDetail.status === 'waiting_on_client' ? 'waiting' : convDetail.status === 'resolved' ? 'resolved' : 'active'}`}>
                    {convDetail.status.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>

            <div className="conv-messages">
              {loadingMsgs ? (
                <div className="loading-page"><div className="spinner" /></div>
              ) : messages.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state-text">No messages yet. Send the first one below.</p>
                </div>
              ) : (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`message ${msg.type === 'sms_inbound' ? 'inbound' : msg.type === 'internal_note' ? 'internal-note' : 'outbound'}`}
                  >
                    <div className="message-bubble">
                      {msg.type === 'internal_note' && <strong>[Note] </strong>}
                      {msg.body}
                    </div>
                    <div className="message-meta">
                      <span>{formatTime(msg.created_at)}</span>
                      {msg.type === 'sms_outbound' && msg.status && (
                        <span className="message-status">{msg.status}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="conv-compose">
              <button
                className={`btn btn-sm ${isNote ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setIsNote(!isNote)}
                title={isNote ? 'Switch to message' : 'Switch to internal note'}
                style={{ flexShrink: 0 }}
              >
                <IconNote style={{ width: 14, height: 14 }} />
              </button>
              <textarea
                ref={composeRef}
                className="conv-compose-input"
                placeholder={isNote ? 'Write an internal note...' : 'Type a message...'}
                value={composeText}
                onChange={e => setComposeText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                style={isNote ? { borderColor: '#fbbf24', background: '#fffbeb' } : undefined}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSend}
                disabled={!composeText.trim() || sending}
                style={{ flexShrink: 0 }}
              >
                <IconSend style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* ═══ RIGHT: Contact/Job Detail Panel ═══ */}
      <div className="conv-detail-panel">
        {convDetail ? (
          <>
            <div className="conv-detail-section">
              <div className="conv-detail-label">Contact</div>
              <div className="conv-detail-value" style={{ fontWeight: 600 }}>
                {convDetail.title || 'Unknown'}
              </div>
            </div>

            <div className="conv-detail-section">
              <div className="conv-detail-label">Status</div>
              <div className="conv-detail-value">
                <span className={`status-badge status-${convDetail.status === 'needs_response' ? 'needs-response' : convDetail.status === 'waiting_on_client' ? 'waiting' : convDetail.status === 'resolved' ? 'resolved' : 'active'}`}>
                  {convDetail.status?.replace(/_/g, ' ') || 'open'}
                </span>
              </div>
            </div>

            <div className="conv-detail-section">
              <div className="conv-detail-label">Type</div>
              <div className="conv-detail-value">{convDetail.type || '—'}</div>
            </div>

            <div className="conv-detail-section">
              <div className="conv-detail-label">Assigned To</div>
              <div className="conv-detail-value">{convDetail.assigned_to || 'Unassigned'}</div>
            </div>

            <div className="conv-detail-section">
              <div className="conv-detail-label">Created</div>
              <div className="conv-detail-value">
                {convDetail.created_at ? new Date(convDetail.created_at).toLocaleDateString() : '—'}
              </div>
            </div>

            {/* TODO: Linked jobs, participant list, tags */}
            <div className="conv-detail-section">
              <div className="conv-detail-label">Linked Jobs</div>
              <div className="conv-detail-value" style={{ color: 'var(--text-tertiary)' }}>
                No linked jobs yet
              </div>
            </div>
          </>
        ) : (
          <div className="conv-detail-section">
            <div className="conv-detail-value" style={{ color: 'var(--text-tertiary)' }}>
              Select a conversation to see details.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
