/**
 * ════════════════════════════════════════════════
 * FILE: Conversations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The team's text-message inbox. On the left is the list of conversations; tap one
 *   and the middle shows the back-and-forth thread with a box to type a reply. It
 *   feels like iMessage/WhatsApp: a reply appears instantly as "Sending…" and then
 *   flips to Sent → Delivered → Read (or Failed, with a one-tap Retry), you can attach
 *   photos, it counts how many texts a long message will cost, remembers a half-typed
 *   draft per conversation, and loads older messages as you scroll up. The same screen
 *   runs on the web, the field-tech phone app, and inside the CRM.
 *
 * WHERE IT LIVES:
 *   Route:        /conversations (web) · /tech/conversations (iOS) · /crm/conversations
 *   Rendered by:  Layout / TechLayout / CrmConversations
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/lib/realtime (subscriptions + auth header),
 *              @/lib/messageMedia (image attach), @/components/conversations/*,
 *              @/components/Icons, @/components/DatePicker, @/components/ui,
 *              @/components/TabLoading, @/hooks/useResumeRefetch,
 *              @/lib/nativeHaptics, @/lib/reducedMotion, @/lib/toast,
 *              @/lib/scheduledMessageOperation
 *   Data:      reads  → conversations, conversation_participants, messages, jobs,
 *                       message_templates, service_sms_consents and
 *                       message_provider_events through GET /api/attest-sms-consent
 *              writes → conversation unread state through
 *                       set_my_conversation_unread_state; contact search and atomic
 *                       conversation creation through /api/message-conversations;
 *                       scheduled_messages through create_scheduled_message;
 *                       contacts (dnd), sms_consent_log,
 *                       service_sms_consents and service_sms_consent_attestations through
 *                       POST /api/attest-sms-consent,
 *                       private message-attachments storage (MMS attachments). Outbound SMS/MMS is sent
 *                       ONLY through POST /api/send-message — the worker is the sole
 *                       writer of any sms_* message row; the client inserts nothing
 *                       into `messages` (not even notes — the worker owns that too).
 *
 * NOTES / GOTCHAS:
 *   - Optimistic bubbles carry a temporary id ("pending-N") + `_clientId`; they are
 *     reconciled against the worker's returned row AND the realtime INSERT (whichever
 *     arrives first), matching by _clientId then by body to avoid a duplicate.
 *   - All message-state mutations are guarded by activeIdRef so a reply that resolves
 *     after the user switches threads never lands in the wrong thread.
 *   - Toasts go through `@/lib/toast` (Rule 2) — no page-local dispatch path.
 *   - Capacitor suspends the webview; useResumeRefetch silently merges missed rows
 *     without replacing loaded history, refreshes consent, and does not touch the
 *     frozen realtime.js.
 *   - Access lease, EXPIRED ≠ DENIED (2026-08-14): the 30s lease aging out is a
 *     clock event, not a server verdict. It hides everything the server owns
 *     (inbox row, thread, member/author caches) and re-proves, keeping the
 *     employee's own draft/attachments and the ?c= route so the thread restores in
 *     place. Only a proven denial — a successful refresh that omits the row, or a
 *     401/403 — revokes the route and erases the draft. Hiding the tab for 30s used
 *     to run the denial path and destroy every draft.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import useLookup from '@/hooks/useLookup';
import { subscribeToMessages, subscribeToConversations, getAuthHeader } from '@/lib/realtime';
import {
  attachEmployeeDirectory,
  employeeDirectoryMap,
  loadMessageAuthorDirectory,
  missingMessageAuthorMessageIds,
} from '@/lib/employeeDirectory';
import { IconSend, IconSearch, IconNote } from '@/components/Icons';
import DatePicker from '@/components/DatePicker';
import {
  MAX_MESSAGE_ATTACHMENTS,
  uploadConversationMedia,
  validateMessageFile,
} from '@/lib/messageMedia';
import MessageBubble from '@/components/conversations/MessageBubble';
import ConversationMemberEditor from '@/components/conversations/ConversationMemberEditor';
import LeaveConversationButton from '@/components/conversations/LeaveConversationButton';
import {
  createConversationAccessRequestGuard,
  conversationAccessLeaseIsFresh,
  expireStaleConversationAccessLeases,
  hasConversationAccess,
  reconcileAccessibleConversations,
  revalidateConversationAccessAfterResume,
  revokeConversationsOmittedFromProof,
  runConversationAccessProbe,
  scheduleConversationAccessExpiry,
} from '@/components/conversations/conversationAccessState';
import {
  captureVisibleMessageAnchor,
  countNewCanonicalMessages,
  findOptimisticMessageMatchIndex,
  mergeNewestMessages,
  repinThreadAfterLayout,
  restoreVisibleMessageAnchor,
} from '@/components/conversations/threadScroll';
import SmsConsentAttestationModal from '@/components/conversations/SmsConsentAttestationModal';
import { ErrorState, Modal } from '@/components/ui';
import TabLoading from '@/components/TabLoading';
import useResumeRefetch from '@/hooks/useResumeRefetch';
import { impact } from '@/lib/nativeHaptics';
import { scrollBehavior } from '@/lib/reducedMotion';
import { toast as emitToast, err as showError } from '@/lib/toast';
import { partialSendNotice } from '@/lib/sendResult';
import { setMyConversationUnreadState } from '@/lib/conversationUnread';
import { resolveConversationId } from '@/lib/openInAppThread';
import {
  clearScheduledMessageOperation,
  getScheduledMessageOperation,
} from '@/lib/scheduledMessageOperation';
import {
  getDraft,
  setDraft,
  clearDraft,
  parseMediaUrls,
  isRetryableMediaReference,
  getServiceConsentUiState,
  withoutSupersededFailures,
} from '@/components/conversations/messageUtils';

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
function IconArrowDown(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>);
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

function HapticRetryButton({ onRetry }) {
  return (
    <button
      type="button"
      className="btn btn-primary"
      onPointerUp={() => impact('light')}
      onClick={onRetry}
    >
      Try again
    </button>
  );
}

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

const MSG_COLS = 'id,type,body,status,sent_by,sender_contact_id,media_urls,error_code,error_message,num_segments,client_request_id,created_at';
const PAGE = 30;         // messages fetched per thread page
const LIST_PAGE = 40;    // conversations fetched per list page

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function Conversations({ replyAssist } = {}) {
  const { db, employee, pwaOwnerLease } = useAuth();
  const queryClient = useQueryClient();
  const { data: employeeDirectory = [] } = useLookup('employees');
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeAccessAuthorized, setActiveAccessAuthorized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [linkedJob, setLinkedJob] = useState(null);

  const [mobileView, setMobileView] = useState('list');
  const [showInfo, setShowInfo] = useState(false);
  const [memberEditorOpen, setMemberEditorOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [compose, setCompose] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [accessProofUnverified, setAccessProofUnverified] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [messageLoadError, setMessageLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [listLimit, setListLimit] = useState(LIST_PAGE);

  const [contextMenu, setContextMenu] = useState(null);
  const [showNewConv, setShowNewConv] = useState(false);
  const newConvSearchRef = useRef(null);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsLoadError, setContactsLoadError] = useState(null);
  const [contactSearch, setContactSearch] = useState('');
  const [contactSearchRetry, setContactSearchRetry] = useState(0);
  const [creatingConv, setCreatingConv] = useState(false);

  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [showComposeActions, setShowComposeActions] = useState(false);
  const [consentPrompt, setConsentPrompt] = useState(null);
  const [serviceConsentStatus, setServiceConsentStatus] = useState({
    contactId: null,
    phone: null,
    allowed: false,
    loading: false,
    checked: false,
    error: null,
    code: null,
    source: null,
  });

  const [attachments, setAttachments] = useState([]);    // { clientId, name, url, localPreview, uploading, error }
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [newInThread, setNewInThread] = useState(0);      // messages arrived while scrolled up
  const [atBottom, setAtBottom] = useState(true);

  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const composeRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeIdRef = useRef(null);
  const conversationsRef = useRef([]);
  const conversationAccessLeasesRef = useRef(new Map());
  const conversationInboxAccessVerifiedAtRef = useRef(0);
  const conversationAccessRequestGuardRef = useRef(
    createConversationAccessRequestGuard(),
  );
  const atBottomRef = useRef(true);
  const attachCounter = useRef(0);
  const contactSearchRequestRef = useRef(0);
  const scheduleSendingRef = useRef(false);
  const scheduledMessageOperationsRef = useRef(new Map());
  const retryStore = useRef({});          // clientId -> { text, media_urls, isNote }
  const prevLastIdRef = useRef(undefined); // last message id seen (tail-growth detector)
  const justOpenedRef = useRef(false);     // force instant scroll on thread open
  // Which thread's messages are currently loaded. Distinguishes "the user picked a
  // different thread" (cold open) from "the same thread's access was re-proven"
  // (silent restore) — one boolean could not tell those apart, which is what put a
  // spinner and a scroll jump on every resume.
  const lastLoadedThreadIdRef = useRef(null);
  const prependAnchorRef = useRef(null);   // first-visible message anchor for history/image layout
  const isPrependingRef = useRef(false);

  const unresolvedMessageAuthorIds = useMemo(
    () => missingMessageAuthorMessageIds(messages, employeeDirectory),
    [messages, employeeDirectory],
  );
  const { data: historicalMessageAuthors = [] } = useQuery({
    queryKey: [
      'message-author-directory',
      employee?.id || 'signed-out',
      unresolvedMessageAuthorIds,
    ],
    queryFn: () => loadMessageAuthorDirectory(
      db,
      unresolvedMessageAuthorIds,
    ),
    enabled: !!db && unresolvedMessageAuthorIds.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const attachmentsRef = useRef([]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { atBottomRef.current = atBottom; }, [atBottom]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => () => {
    conversationAccessRequestGuardRef.current.invalidate();
  }, [db, employee?.id]);

  // Revoke any object-URL previews and empty the tray (prevents a blob-URL leak).
  const clearAttachments = useCallback(() => {
    attachmentsRef.current.forEach(a => { if (a.localPreview) { try { URL.revokeObjectURL(a.localPreview); } catch { /* ignore */ } } });
    setAttachments([]);
  }, []);
  // Revoke on unmount too.
  useEffect(() => () => {
    attachmentsRef.current.forEach(a => { if (a.localPreview) { try { URL.revokeObjectURL(a.localPreview); } catch { /* ignore */ } } });
  }, []);

  // Everything the SERVER owns for one conversation leaves the screen: its inbox
  // row (title + preview), the member/author directories, and the open thread.
  // This is the half that EXPIRY and DENIAL share. It deliberately leaves the
  // employee's OWN unsent work — draft, attachments, retry payloads, composer text
  // — and the ?c= route alone; only revokeConversationAccess destroys those.
  const hideConversationAccess = useCallback((conversationId) => {
    queryClient.removeQueries({
      predicate: (query) => (
        query.queryKey?.[0] === 'conversation-members'
        && query.queryKey?.[2] === conversationId
      ),
    });
    queryClient.removeQueries({ queryKey: ['message-author-directory'] });
    conversationsRef.current = conversationsRef.current.filter(
      (conversation) => conversation.id !== conversationId,
    );
    setConversations((current) => current.filter(
      (conversation) => conversation.id !== conversationId,
    ));
    if (activeIdRef.current !== conversationId) return;
    setActiveAccessAuthorized(false);
    setMessages([]);
    setLinkedJob(null);
    setHasMoreMessages(false);
    setMsgLoading(false);
    setMessageLoadError(null);
    setShowTemplates(false);
    setConsentPrompt(null);
    setContextMenu(null);
    setMemberEditorOpen(false);
    setShowInfo(false);
    setNewInThread(0);
    setAtBottom(true);
  }, [queryClient]);

  // EXPIRED ≠ DENIED (2026-08-14). A lease aging out is a CLOCK event — the server
  // has said nothing. Hide the protected content synchronously (before any
  // revalidation promise can exist) but keep the draft, the attachments and ?c=,
  // and keep the now-stale lease entry so a later successful refresh that omits
  // this row can still deny it properly. The re-proof restores the thread in
  // place. This path used to call revokeConversationAccess, so hiding the tab for
  // 30s destroyed every draft and exited the open thread on resume
  // (page-lifecycle.md's minimize test: no route loss, no lost form input).
  //
  // Same name, same rule as the tech pane's recordConversationAccessExpired
  // (`src/pages/tech/v2/messages/accessRevocation.js`, #645) — one mechanism in
  // two shells. Its `purgeConversationAccess(..., { preserveDraft: true })` flag
  // is here the hide/revoke split instead, because this screen keeps its inbox in
  // component state rather than a React Query cache and so has no tombstone to
  // mark; `hideConversationAccess` is the preserveDraft:true half.
  const recordConversationAccessExpired = useCallback((conversationId) => {
    if (!conversationId) return;
    hideConversationAccess(conversationId);
  }, [hideConversationAccess]);

  const revokeConversationAccess = useCallback((
    conversationId,
    { announce = true } = {},
  ) => {
    if (!conversationId) return;
    const wasActive = activeIdRef.current === conversationId;
    conversationAccessLeasesRef.current.delete(conversationId);
    clearDraft(conversationId);
    hideConversationAccess(conversationId);

    if (wasActive) {
      activeIdRef.current = null;
      lastLoadedThreadIdRef.current = null;
      retryStore.current = {};
      clearAttachments();
      setActiveId(null);
      setCompose('');
      setIsNote(false);
      setShowSchedule(false);
      setScheduleDate('');
      setScheduleTime('');
      setShowComposeActions(false);
      setMobileView('list');
      if (composeRef.current) composeRef.current.innerText = '';
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (next.get('c') === conversationId) next.delete('c');
      return next;
    }, { replace: true });
    if (announce) emitToast('You no longer have access to this chat', 'info');
  }, [clearAttachments, hideConversationAccess, setSearchParams]);

  const restoreAuthorizedDraft = useCallback((conversationId) => {
    if (!conversationId || activeIdRef.current !== conversationId) return;
    const draft = getDraft(conversationId);
    setCompose(draft);
    const el = composeRef.current;
    if (!el) return;
    // This runs on every silent access-lease poll (5s with a thread open), not
    // just on thread open. Rewriting a contentEditable's text resets the caret
    // to position 0, so never clobber a composer the user is typing in — the
    // input handler already persists each keystroke into the draft — and skip
    // the write entirely when the text is already identical.
    if (el === document.activeElement || el.contains(document.activeElement)) return;
    if ((el.innerText || '') === draft) return;
    el.innerText = draft;
  }, []);

  const purgeExpiredConversationAccess = useCallback(() => {
    const inboxProofExpired = !conversationAccessLeaseIsFresh(
      conversationInboxAccessVerifiedAtRef.current,
    );
    if (inboxProofExpired) {
      conversationInboxAccessVerifiedAtRef.current = 0;
      setAccessProofUnverified(true);
    }
    // Hide, do not destroy: the clock cannot prove a denial, and this sweep runs
    // on every resume. Revoking here erased every draft on the tab. The policy
    // itself lives in conversationAccessState.js so it can be asserted directly
    // rather than only read as source — this callback is now just its effect.
    expireStaleConversationAccessLeases({
      cachedConversationIds: [
        ...conversationsRef.current.map((conversation) => conversation?.id),
        ...conversationAccessLeasesRef.current.keys(),
      ],
      leases: conversationAccessLeasesRef.current,
      onExpire: recordConversationAccessExpired,
    });
    return inboxProofExpired;
  }, [recordConversationAccessExpired]);

  // ─── SECTION: Data fetching ──────────────

  const loadConversations = useCallback(async ({ silent = false } = {}) => {
    let requestIsCurrent = true;
    try {
      const proof = await runConversationAccessProbe({
        request: () => db.select('conversations',
          'select=*,conversation_participants(contact_id,phone,role,contacts(id,name,phone,email,company,role,dnd,dnd_at,opt_in_status,opt_in_source,opt_in_at,opt_out_at,opt_out_reason))&order=last_message_at.desc.nullslast'
        ),
        requestGuard: conversationAccessRequestGuardRef.current,
        onExpired: purgeExpiredConversationAccess,
      });
      if (proof.superseded) {
        requestIsCurrent = false;
        return null;
      }
      if (!proof.accepted) {
        setLoadError('Could not confirm conversation access. Check your connection and try again.');
        return null;
      }
      const rows = proof.value;
      const data = Array.isArray(rows) ? rows : [];
      const openBeforeRefresh = activeIdRef.current;
      revokeConversationsOmittedFromProof({
        cachedConversations: conversationsRef.current,
        authorizedConversations: data,
        leasedConversationIds: conversationAccessLeasesRef.current.keys(),
        onRevoke: (conversationId) => {
          revokeConversationAccess(conversationId, {
            announce: conversationId === openBeforeRefresh,
          });
        },
      });
      const verifiedAt = proof.requestStartedAt;
      conversationInboxAccessVerifiedAtRef.current = verifiedAt;
      data.forEach((conversation) => {
        if (conversation?.id) conversationAccessLeasesRef.current.set(conversation.id, verifiedAt);
      });
      setLoadError(null);
      setAccessProofUnverified(false);
      setConversations((previous) => {
        const next = reconcileAccessibleConversations(previous, data, silent);
        conversationsRef.current = next;
        return next;
      });
      const openConversationId = activeIdRef.current;
      if (
        openConversationId
        && !hasConversationAccess(data, openConversationId)
      ) {
        revokeConversationAccess(openConversationId);
      } else if (openConversationId) {
        setActiveAccessAuthorized(true);
        restoreAuthorizedDraft(openConversationId);
      }
      return data;
    } catch (error) {
      purgeExpiredConversationAccess();
      console.error('Load conversations error:', error);
      setLoadError('Could not load conversations. Check your connection and try again.');
      return null;
    } finally {
      if (requestIsCurrent) setLoading(false);
    }
  }, [
    db,
    purgeExpiredConversationAccess,
    restoreAuthorizedDraft,
    revokeConversationAccess,
  ]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Inbox labels and previews are private too. Track the list proof independently
  // from row leases so an accepted empty list also becomes "unverified" at expiry
  // instead of rendering a false-success empty state while resume I/O is pending.
  useEffect(() => {
    const verifiedAt = conversationInboxAccessVerifiedAtRef.current;
    if (!verifiedAt || accessProofUnverified) return undefined;
    return scheduleConversationAccessExpiry({
      verifiedAt,
      onExpire: purgeExpiredConversationAccess,
    });
  }, [accessProofUnverified, conversations, purgeExpiredConversationAccess]);

  // Idempotent "this thread is read now" — clears the badge locally + server-side.
  const markActiveRead = useCallback(async (convId) => {
    if (!convId) return;
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread_count: 0 } : c));
    try {
      await setMyConversationUnreadState(db, [convId], false);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        revokeConversationAccess(convId);
        return;
      }
      console.error('Mark active read error:', error);
    }
  }, [db, revokeConversationAccess]);

  // Refetch the newest page for the OPEN thread, preserving any un-reconciled
  // optimistic bubbles. Used by the Capacitor suspend/focus recovery.
  // The linked-job badge carries the customer's name, so the hide path clears it
  // and both load paths have to put it back. Shared so the silent restore cannot
  // drift from the cold open.
  const loadLinkedJob = useCallback(async (conversationId, isCancelled = () => false) => {
    const conversation = conversationsRef.current.find((row) => row.id === conversationId);
    if (!conversation?.job_id) {
      if (!isCancelled()) setLinkedJob(null);
      return;
    }
    try {
      const jobs = await db.select('jobs', `id=eq.${conversation.job_id}&select=id,job_number,insured_name,phase,division&limit=1`);
      if (!isCancelled() && activeIdRef.current === conversationId) {
        setLinkedJob(jobs.length > 0 ? jobs[0] : null);
      }
    } catch (error) {
      console.error('Load linked job error:', error);
      if (!isCancelled()) setLinkedJob(null);
    }
  }, [db]);

  const reloadActiveMessages = useCallback(async () => {
    const convId = activeIdRef.current;
    if (!convId) return;
    try {
      const rows = await db.select('messages', `conversation_id=eq.${convId}&order=created_at.desc&limit=${PAGE}&select=${MSG_COLS}`);
      if (activeIdRef.current !== convId) return;
      const asc = rows.slice().reverse();
      // Merge the refreshed tail into the rendered thread. Older pages and unresolved
      // optimistic bubbles stay mounted, so a reader's history position cannot clamp.
      setMessages(prev => mergeNewestMessages(prev, asc));
      setHasMoreMessages(rows.length === PAGE);
      setMessageLoadError(null);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        revokeConversationAccess(convId);
        return;
      }
      console.error('Reload messages error:', error);
      setMessageLoadError('Could not refresh this conversation. Existing messages are still shown.');
    }
  }, [db, revokeConversationAccess]);

  // Deep-link: open a conversation for a contact passed via location.state, or via
  // the ?c=<conversationId> query param (push-notification / shareable URL).
  useEffect(() => {
    if (loading || deepLinkHandled.current) return;
    const targetContactId = location.state?.contactId;
    const targetConvId = searchParams.get('c');

    if (targetConvId) {
      deepLinkHandled.current = true;
      if (hasConversationAccess(conversations, targetConvId)) {
        selectConversation(targetConvId);
      } else if (!loadError) {
        revokeConversationAccess(targetConvId);
      }
      return;
    }
    if (!targetContactId) return;
    deepLinkHandled.current = true;
    const existing = conversations.find(c => c.conversation_participants?.some(p => p.contact_id === targetContactId));
    if (existing) { selectConversation(existing.id); return; }
    // No existing conversation — ask the capability-checked Worker to atomically
    // find or create it. The browser must never leave a recipient-less thread.
    (async () => {
      try {
        const conversationId = await resolveConversationId(targetContactId);
        if (!conversationId) throw new Error('Could not open this conversation');
        const refreshed = await loadConversations({ silent: true });
        if (!hasConversationAccess(refreshed, conversationId)) {
          throw new Error('Created conversation was not returned by the inbox refresh');
        }
        selectConversation(conversationId);
      } catch (error) {
        console.error('Deep-link conversation error:', error);
        showError(error?.message || 'Could not open this conversation');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    conversations,
    loadError,
    loading,
    location.state,
    revokeConversationAccess,
    searchParams,
  ]);

  // Conversation-list realtime. Guards the open+visible thread from a server-side
  // unread bump re-marking it unread under the reader (the unread-desync fix).
  useEffect(() => {
    const unsubscribe = subscribeToConversations((payload) => {
      if (payload.eventType === 'UPDATE' && payload.new) {
        const isActiveVisible = payload.new.id === activeIdRef.current
          && (typeof document === 'undefined' || document.visibilityState === 'visible');
        setConversations(prev =>
          prev.map(c => {
            if (c.id !== payload.new.id) return c;
            const merged = { ...c, ...payload.new };
            if (isActiveVisible) merged.unread_count = 0;
            return merged;
          }).sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))
        );
        if (isActiveVisible && payload.new.unread_count > 0) markActiveRead(payload.new.id);
      } else if (payload.eventType === 'INSERT') { loadConversations({ silent: true }); }
    });
    return unsubscribe;
  }, [loadConversations, markActiveRead]);

  // Participant changes do not mutate the conversation row, so realtime alone
  // cannot renew either the inbox-preview lease or an open thread. Recheck the
  // visible inbox before expiry; an active thread uses the tighter cadence.
  useEffect(() => {
    const accessTimer = window.setInterval(
      () => {
        if (document.hidden) return;
        if (activeId) {
          const verifiedAt = conversationAccessLeasesRef.current.get(activeId) || 0;
          if (!conversationAccessLeaseIsFresh(verifiedAt)) {
            // EXPIRED ≠ DENIED: hide the thread, then fall through and re-prove
            // it on this same tick. This used to revoke — with a toast claiming
            // lost access — so an idle desktop tab exited the thread and threw
            // away the half-typed reply purely because 30s had passed.
            recordConversationAccessExpired(activeId);
          }
        }
        loadConversations({ silent: true });
      },
      activeId ? 5_000 : 15_000,
    );
    return () => window.clearInterval(accessTimer);
  }, [activeId, recordConversationAccessExpired, loadConversations]);

  // Load the newest page of messages when a thread opens.
  useEffect(() => {
    if (!activeId || !activeAccessAuthorized) {
      setMessages([]);
      setLinkedJob(null);
      setHasMoreMessages(false);
      setMessageLoadError(null);
      return;
    }
    // Access RE-PROVEN for the thread that is already open — a resume after the
    // 30s lease aged out, not a thread switch. The cold-open path below would
    // flip msgLoading (a third spinner, on top of the two the hide already
    // showed), rearm justOpenedRef, and hard-replace the message array, which
    // snapped the reader to the bottom of a thread they had scrolled up in.
    // Restore through the silent merge instead: it leaves prevLastIdRef
    // meaningful, so the scroll layout effect below stays a no-op when nothing
    // new arrived, and behaves like an ordinary live update when it did.
    // page-lifecycle.md §1-2, and useResumeRefetch's own contract: never flip a
    // page-level loading flag on resume.
    if (lastLoadedThreadIdRef.current === activeId) {
      // This effect re-runs on any identity change among its deps, so a cold
      // load can be cancelled mid-flight and land here on the next run. That
      // cancelled run's `finally` is skipped, so it leaves msgLoading true —
      // and a silent restore never sets it. Owning the flag here is what keeps
      // the spinner from being stranded over the thread permanently.
      setMsgLoading(false);
      reloadActiveMessages();
      loadLinkedJob(activeId);
      return;
    }
    let cancelled = false;
    prevLastIdRef.current = undefined;
    justOpenedRef.current = true;
    setMsgLoading(true);
    setMessageLoadError(null);
    const load = async () => {
      try {
        const rows = await db.select('messages',
          `conversation_id=eq.${activeId}&order=created_at.desc&limit=${PAGE}&select=${MSG_COLS}`);
        if (cancelled) return;
        setMessages(rows.slice().reverse());
        // Claim the thread only now. Marking it loaded before the response
        // lands means a re-render that re-fires this effect (setSearchParams
        // changes identity on navigation, so this runs twice on every open)
        // takes the silent-restore branch below while run #1 is already
        // cancelled — and its finally never clears msgLoading, stranding the
        // spinner over the thread forever.
        lastLoadedThreadIdRef.current = activeId;
        setHasMoreMessages(rows.length === PAGE);
        setNewInThread(0);
        const conv = conversations.find(c => c.id === activeId);
        if (conv?.unread_count > 0) markActiveRead(activeId);
        await loadLinkedJob(activeId, () => cancelled);
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          revokeConversationAccess(activeId);
          return;
        }
        console.error('Load messages error:', error);
        if (!cancelled) {
          setMessageLoadError('Could not load messages for this conversation. Try again.');
        }
      }
      finally { if (!cancelled) setMsgLoading(false); }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccessAuthorized, activeId, db, loadLinkedJob, reloadActiveMessages, revokeConversationAccess]);

  // Put the parked draft back in the composer once access is proven again. The
  // restore inside loadConversations cannot do it on this path: it runs in the
  // same tick that authorizes the thread, while the composer is still unmounted
  // and composeRef is null. Running it after the commit that remounts the
  // composer is what makes an expired-then-re-proven thread come back with the
  // reply still in it. Idempotent — restoreAuthorizedDraft skips a focused or
  // already-matching composer, so this never disturbs someone mid-sentence.
  useEffect(() => {
    if (!activeId || !activeAccessAuthorized) return;
    restoreAuthorizedDraft(activeId);
  }, [activeAccessAuthorized, activeId, restoreAuthorizedDraft]);

  // Per-thread message realtime. Reconciles inserts against optimistic bubbles and
  // keeps the open thread marked read when an inbound arrives.
  useEffect(() => {
    if (!activeId || !activeAccessAuthorized) return;
    const convId = activeId;
    const unsubscribe = subscribeToMessages(convId, (newMsg, eventType) => {
      // A realtime frame already in flight can fire after a thread switch but before
      // the channel tears down — drop it so it can't inject into the new thread.
      if (activeIdRef.current !== convId) return;
      if (eventType === 'update') {
        setMessages(prev => prev.map(m => m.id === newMsg.id ? { ...newMsg, employees: m.employees || newMsg.employees } : m));
        return;
      }
      setMessages(prev => {
        if (prev.some(m => m.id === newMsg.id)) return prev;                 // already have real row
        const isOutbound = newMsg.type === 'sms_outbound' || newMsg.type === 'internal_note';
        if (isOutbound) {
          // Reconcile an optimistic bubble (pending OR already-marked-failed — the
          // worker can insert the row yet return an error, then deliver it here).
          const idx = findOptimisticMessageMatchIndex(prev, newMsg);
          if (idx !== -1) {
            const cid = prev[idx]._clientId;
            if (cid) delete retryStore.current[cid];
          }
        }
        return mergeNewestMessages(prev, [newMsg]);
      });
      if (newMsg.type === 'sms_inbound' && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
        markActiveRead(convId);
      }
    });
    return unsubscribe;
  }, [activeAccessAuthorized, activeId, markActiveRead]);

  // ─── SECTION: Scroll management ──────────────

  const scrollToBottom = useCallback((smooth = true) => {
    const doScroll = () => messagesEndRef.current?.scrollIntoView({
      behavior: scrollBehavior(smooth ? 'smooth' : 'instant'),
    });
    doScroll();
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) {
      prependAnchorRef.current = null;
      setNewInThread(0);
    } else {
      prependAnchorRef.current = captureVisibleMessageAnchor(el);
    }
  }, []);

  const handleMediaLayout = useCallback(() => {
    const el = messagesScrollRef.current;
    if (prependAnchorRef.current) {
      if (!restoreVisibleMessageAnchor(el, prependAnchorRef.current)) {
        prependAnchorRef.current = null;
      }
      return;
    }
    repinThreadAfterLayout({
      scrollElement: el,
      wasAtBottom: atBottomRef.current,
      isPrepending: isPrependingRef.current,
    });
  }, []);

  // Preserve the first visible message when older rows are prepended. Keep the
  // anchor afterward so delayed attachment layout above it is corrected too.
  useLayoutEffect(() => {
    if (prependAnchorRef.current) {
      if (!restoreVisibleMessageAnchor(messagesScrollRef.current, prependAnchorRef.current)) {
        prependAnchorRef.current = null;
      }
    }
    if (isPrependingRef.current && !loadingEarlier) {
      isPrependingRef.current = false;
    }
  }, [messages, loadingEarlier]);

  // Auto-scroll on tail growth: snap to bottom on thread open, follow new messages
  // only if the reader is already near the bottom, else bump the jump-to-latest pill.
  useLayoutEffect(() => {
    if (msgLoading || isPrependingRef.current) return;
    // An emptied thread has nothing to scroll to, and treating it as a tail
    // change would clear prevLastIdRef — making the NEXT paint look like a
    // first paint and snapping a returning reader to the bottom. A genuine
    // thread switch resets prevLastIdRef itself, so nothing is lost here.
    if (messages.length === 0) return;
    const lastId = messages[messages.length - 1]?.id;
    if (lastId === prevLastIdRef.current) return;
    const previousLastId = prevLastIdRef.current;
    const wasFirstPaint = previousLastId === undefined;
    const newCount = countNewCanonicalMessages(messages, previousLastId);
    prevLastIdRef.current = lastId;
    if (justOpenedRef.current || wasFirstPaint) {
      justOpenedRef.current = false;
      setNewInThread(0);
      scrollToBottom(false);
      return;
    }
    if (atBottomRef.current) { scrollToBottom(true); setNewInThread(0); }
    else setNewInThread(n => n + newCount);
  }, [messages, msgLoading, loadingEarlier, scrollToBottom]);

  const loadEarlier = useCallback(async () => {
    const convId = activeIdRef.current;
    if (!convId || loadingEarlier || !hasMoreMessages) return;
    const oldest = messages.find(m => !m._pending && !m._failed);
    if (!oldest?.created_at) return;
    setLoadingEarlier(true);
    try {
      const rows = await db.select('messages',
        `conversation_id=eq.${convId}&created_at=lt.${encodeURIComponent(oldest.created_at)}&order=created_at.desc&limit=${PAGE}&select=${MSG_COLS}`);
      if (activeIdRef.current !== convId) return;
      const older = rows.slice().reverse();
      if (older.length) {
        prependAnchorRef.current = captureVisibleMessageAnchor(messagesScrollRef.current);
        isPrependingRef.current = true;
        setMessages(prev => {
          const existing = new Set(prev.map(m => m.id));
          const fresh = older.filter(m => !existing.has(m.id));
          return [...fresh, ...prev];
        });
      }
      setHasMoreMessages(rows.length === PAGE);
    } catch (error) {
      console.error('Load earlier error:', error);
      showError('Could not load earlier messages');
    }
    finally { setLoadingEarlier(false); }
  }, [db, messages, loadingEarlier, hasMoreMessages]);

  // ─── SECTION: Lifecycle — keyboard ──────────────

  // Lift the composer above the on-screen keyboard using the visual viewport.
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--conv-kb-offset', `${offset}px`);
      setKbOpen(offset > 80);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
      document.documentElement.style.removeProperty('--conv-kb-offset');
    };
  }, []);

  // ─── SECTION: Derived ──────────────

  const activeConv = useMemo(() => conversations.find(c => c.id === activeId) || null, [conversations, activeId]);
  const activeContact = useMemo(() => {
    if (!activeConv?.conversation_participants?.length) return null;
    const p = activeConv.conversation_participants.find(p => p.role === 'primary') || activeConv.conversation_participants[0];
    return p?.contacts || null;
  }, [activeConv]);
  const canAttestPriorConsent = (
    activeConv?.type === 'direct'
    && (employee?.role === 'admin' || employee?.role === 'office')
  ) && employee?.is_external !== true;
  // Only `matches` is still consumed. The checking/canAttest/suppressionCopy
  // fields described the removed pre-flight fetch (2026-07-28) and have no
  // remaining render path.
  const { matches: statusMatchesActive } = getServiceConsentUiState({
    status: serviceConsentStatus,
    contact: activeContact,
  });
  const hasExplicitSmsOptOut = !!activeContact?.opt_out_at
    || (statusMatchesActive
      && (serviceConsentStatus.code === 'CONTACT_OPTED_OUT'
        || serviceConsentStatus.source === 'explicit_opt_out'));
  const hasPendingSmsStop = statusMatchesActive
    && (serviceConsentStatus.code === 'CONTACT_PENDING_STOP'
      || serviceConsentStatus.source === 'pending_stop');
  const hasEffectiveDnd = !!activeContact?.dnd
    || (statusMatchesActive && serviceConsentStatus.code === 'DND_ACTIVE');

  // CHANGED 2026-07-28 (owner-directed, adversarially narrowed): permission is
  // implied only for a direct staff-written service message. Scheduled traffic
  // still requires global opt-in, and neither path performs the removed
  // per-thread pre-flight request.
  const hasNoSmsObjection = !hasEffectiveDnd && !hasExplicitSmsOptOut && !hasPendingSmsStop;
  const hasGlobalSmsPermission = activeContact?.opt_in_status === true
    || (statusMatchesActive && serviceConsentStatus.code === 'GLOBAL_OPT_IN');
  const customerSmsBlocked = !!activeContact && (
    !hasNoSmsObjection
    || (showSchedule && !hasGlobalSmsPermission)
  );

  const loadServiceConsentStatus = useCallback(() => {
    const contactId = activeContact?.id;
    const phone = activeContact?.phone || null;

    // CHANGED 2026-07-28 (owner-directed): this used to fetch
    // GET /api/attest-sms-consent on every thread open, which rendered
    // "Checking SMS permission…" and held the composer. It now derives the
    // answer synchronously from the contact row already on screen. The server
    // is still the authority — POST /api/send-message runs the real gate and
    // refuses with a reason, which is what onConsentRequired surfaces.
    setServiceConsentStatus({
      contactId: contactId || null,
      phone,
      allowed: !!contactId
        && !activeContact?.dnd
        && !activeContact?.opt_out_at,
      loading: false,
      checked: !!contactId,
      error: null,
      code: !contactId
        ? null
        : activeContact?.dnd
          ? 'DND_ACTIVE'
          : activeContact?.opt_out_at
            ? 'NO_CONSENT'
            : activeContact?.opt_in_status === true
              ? 'GLOBAL_OPT_IN'
              : 'IMPLIED_CONSENT',
      source: activeContact?.opt_out_at ? 'explicit_opt_out' : null,
    });
  }, [
    activeContact?.id,
    activeContact?.phone,
    activeContact?.dnd,
    activeContact?.opt_out_at,
    activeContact?.opt_in_status,
  ]);

  useEffect(() => {
    loadServiceConsentStatus();
  }, [loadServiceConsentStatus]);

  const refreshAfterResume = useCallback(() => (
    revalidateConversationAccessAfterResume({
      // This runs synchronously on hidden→visible, including when there is no
      // selected thread, so expired titles/previews/drafts disappear before I/O.
      purgeExpired: purgeExpiredConversationAccess,
      revalidate: async () => {
        const refreshed = await loadConversations({ silent: true });
        const openConversationId = activeIdRef.current;
        if (
          refreshed
          && openConversationId
          && hasConversationAccess(refreshed, openConversationId)
        ) {
          await reloadActiveMessages();
        }
        loadServiceConsentStatus();
      },
    })
  ), [
    loadConversations,
    reloadActiveMessages,
    loadServiceConsentStatus,
    purgeExpiredConversationAccess,
  ]);

  useResumeRefetch({
    onResume: refreshAfterResume,
    hiddenEdgeOnly: true,
  });

  const replyContext = useMemo(() => {
    const lastInbound = [...messages].reverse().find(m => m.type === 'sms_inbound');
    return {
      lastMessage: lastInbound?.body || '',
      contactName: activeContact?.name || activeConv?.title || '',
      leadStatus: activeConv?.status || '',
      channel: 'sms',
    };
  }, [messages, activeContact, activeConv]);

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

  const visibleConvs = useMemo(() => filtered.slice(0, listLimit), [filtered, listLimit]);

  const statusCounts = useMemo(() => {
    const c = { all: conversations.length, unread: 0, needs_response: 0, waiting_on_client: 0, resolved: 0 };
    conversations.forEach(cv => { if (cv.unread_count > 0) c.unread++; if (c[cv.status] !== undefined) c[cv.status]++; });
    return c;
  }, [conversations]);

  const directoryById = useMemo(
    () => employeeDirectoryMap([
      ...employeeDirectory,
      ...historicalMessageAuthors,
    ]),
    [employeeDirectory, historicalMessageAuthors],
  );

  const groupedMessages = useMemo(() => {
    const g = []; let cur = null;
    // A retry is the same logical message. Preserve current-origin deduplication,
    // then enrich the surviving row with the authenticated employee directory.
    withoutSupersededFailures(messages).forEach(msg => {
      const l = getDateLabel(msg.created_at);
      if (l !== cur) { cur = l; g.push({ type: 'date', label: l }); }
      g.push({
        type: 'msg',
        data: attachEmployeeDirectory(msg, directoryById),
      });
    });
    return g;
  }, [messages, directoryById]);

  const templatesByCategory = useMemo(() => {
    const g = {};
    templates.forEach(t => { if (!g[t.category]) g[t.category] = []; g[t.category].push(t); });
    return g;
  }, [templates]);

  const filteredContacts = contacts;

  const uploadingAttachment = attachments.some(a => a.uploading);

  // ─── SECTION: Event handlers — navigation ──────────────

  const syncDeepLinkParam = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('c', id); else next.delete('c');
    setSearchParams(next, { replace: true });
  };

  const selectConversation = (id) => {
    atBottomRef.current = true;
    prependAnchorRef.current = null;
    isPrependingRef.current = false;
    setAtBottom(true);
    setNewInThread(0);
    const verifiedAt = conversationAccessLeasesRef.current.get(id) || 0;
    const hasFreshAccessLease = conversationAccessLeaseIsFresh(verifiedAt);
    // The silent actor-scoped recheck below can resolve before React commits the
    // activeId state. Keep the authorization target synchronous so that success
    // renews this exact thread rather than leaving an expired deep link covered.
    activeIdRef.current = id;
    setActiveAccessAuthorized(hasFreshAccessLease);
    setActiveId(id); setMobileView('thread'); setShowInfo(false);
    setConsentPrompt(null);
    clearComposeState();
    setMessages([]);
    setLinkedJob(null);
    setHasMoreMessages(false);
    setMessageLoadError(null);
    setCompose('');
    if (composeRef.current) composeRef.current.innerText = '';
    setContextMenu(null); setShowComposeActions(false);
    setListLimit(LIST_PAGE);
    // A cached draft is private content. It may return only with a current
    // actor-scoped proof, never merely because the selected row still exists.
    if (hasFreshAccessLease) restoreAuthorizedDraft(id);
    syncDeepLinkParam(id);
    if (!hasFreshAccessLease) loadConversations({ silent: true });
  };
  const goBackToList = () => {
    setMobileView('list'); setShowInfo(false); setShowTemplates(false); setShowSchedule(false);
    syncDeepLinkParam(null);
  };

  // Reset per-thread composer sub-state (note/templates/schedule/attachments).
  const clearComposeState = () => {
    setIsNote(false); setShowTemplates(false); setShowSchedule(false);
    setScheduleDate(''); setScheduleTime(''); clearAttachments();
  };

  // ─── SECTION: Event handlers — read/unread + DND ──────────────

  const markAsUnread = async (convId) => {
    setContextMenu(null);
    try {
      await setMyConversationUnreadState(db, [convId], true);
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread_count: 1 } : c));
      emitToast('Marked as unread', 'info');
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        revokeConversationAccess(convId);
        return;
      }
      console.error('Mark unread error:', error);
      showError('Could not mark this conversation as unread');
    }
  };
  const markAsRead = async (convId) => {
    setContextMenu(null);
    try {
      await setMyConversationUnreadState(db, [convId], false);
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread_count: 0 } : c));
      emitToast('Marked as read', 'info');
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        revokeConversationAccess(convId);
        return;
      }
      console.error('Mark read error:', error);
      showError('Could not mark this conversation as read');
    }
  };
  const readAll = async () => {
    const unread = conversations.filter(c => c.unread_count > 0);
    if (!unread.length) return;
    try {
      await setMyConversationUnreadState(db, null, false);
      setConversations(prev => prev.map(c => ({ ...c, unread_count: 0 })));
      emitToast(`${unread.length} conversations marked as read`, 'success');
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        await loadConversations({ silent: true });
        return;
      }
      console.error('Read all error:', error);
      showError('Could not mark all conversations as read');
    }
  };

  const toggleDnd = async (contactId, currentDnd) => {
    const newDnd = !currentDnd;
    try {
      await db.update('contacts', `id=eq.${contactId}`, {
        dnd: newDnd,
        dnd_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await db.insert('sms_consent_log', {
        contact_id: contactId,
        phone: activeContact?.phone || '',
        event_type: newDnd ? 'dnd_on' : 'dnd_off',
        source: 'manual',
        details: `DND ${newDnd ? 'enabled' : 'disabled'} by team member via conversations UI.`,
        performed_by: employee?.id || null,
      });
      setConversations(prev => prev.map(c => ({
        ...c,
        conversation_participants: c.conversation_participants?.map(p =>
          p.contact_id === contactId
            ? { ...p, contacts: { ...p.contacts, dnd: newDnd, dnd_at: new Date().toISOString() } }
            : p
        ),
      })));
      emitToast(newDnd ? 'DND enabled — messaging blocked' : 'DND disabled — messaging allowed', 'info');
    } catch (err) {
      console.error('Toggle DND error:', err);
      emitToast('Could not update DND', 'error');
    }
  };

  // ─── SECTION: Event handlers — attachments (MMS) ──────────────

  const onPickFiles = () => { if (!isNote) fileInputRef.current?.click(); };

  const handleFilesSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const convId = activeIdRef.current;
    if (!convId) return;
    let count = attachmentsRef.current.length;
    for (const file of files) {
      if (count >= MAX_MESSAGE_ATTACHMENTS) {
        emitToast(`Up to ${MAX_MESSAGE_ATTACHMENTS} photos per message`, 'info');
        break;
      }
      const check = validateMessageFile(file);
      if (!check.ok) {
        emitToast(check.reason, 'error');
        continue;
      }
      count += 1;
      const clientId = `att-${++attachCounter.current}`;
      let localPreview = null;
      try { localPreview = URL.createObjectURL(file); } catch { /* non-fatal */ }
      setAttachments(prev => [...prev, { clientId, name: file.name, url: null, localPreview, uploading: true, error: false }]);
      try {
        const { url } = await uploadConversationMedia(db, convId, file);
        setAttachments(prev => prev.map(a => a.clientId === clientId ? { ...a, uploading: false, url } : a));
      } catch (err) {
        console.error('Attachment upload error:', err);
        setAttachments(prev => prev.map(a => a.clientId === clientId ? { ...a, uploading: false, error: true } : a));
        emitToast(`Couldn't attach ${file.name}`, 'error');
      }
    }
  };

  const removeAttachment = (clientId) => {
    const gone = attachmentsRef.current.find(a => a.clientId === clientId);
    if (gone?.localPreview) { try { URL.revokeObjectURL(gone.localPreview); } catch { /* ignore */ } }
    setAttachments(prev => prev.filter(a => a.clientId !== clientId));
  };

  // ─── SECTION: Event handlers — send (optimistic + reconcile + retry) ──────────────

  const applyConvMeta = (convId, wasNote, preview) => {
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const upd = { ...c, last_message_at: new Date().toISOString(), last_message_preview: preview };
      if (!wasNote && c.status === 'needs_response') {
        upd.status = 'waiting_on_client'; upd.status_changed_at = new Date().toISOString();
        if (!c.first_response_at) upd.first_response_at = new Date().toISOString();
      }
      return upd;
    }));
  };

  const dispatchSend = useCallback(async ({ clientId, convId, text, media_urls, isNote: note }) => {
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          conversation_id: convId,
          body: text,
          sent_by: employee?.id || null,
          client_request_id: clientId,
          is_internal_note: note,
          ...(media_urls && media_urls.length ? { media_urls } : {}),
        }),
      });

      if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch { /* non-JSON error body */ }
        if (res.status === 401 || data.code === 'CONVERSATION_NOT_AUTHORIZED') {
          revokeConversationAccess(convId);
          return;
        }
        const reason = data.code === 'DND_ACTIVE' ? 'Contact has Do Not Disturb enabled'
          : data.code === 'NO_CONSENT' ? 'Contact has not opted in to SMS'
            : (data.error || `Message not sent (${res.status})`);
        if (
          data.code === 'NO_CONSENT'
          && data.contact_id
          && canAttestPriorConsent
          && activeIdRef.current === convId
        ) {
          setConsentPrompt({
            contactId: data.contact_id,
            convId,
          });
        }
        // Mark the optimistic bubble failed (if still on this thread) — keep it for retry.
        if (activeIdRef.current === convId) {
          setMessages(prev => prev.map(m => m._clientId === clientId
            ? { ...m, _pending: false, _failed: true, status: 'failed', error_message: reason, error_code: data.code || m.error_code }
            : m));
        }
        emitToast(reason, 'error');
        return;
      }

      const data = await res.json();
      // A 201 does NOT mean everything landed. The worker answers success for a
      // partly-delivered send, because the parts that DID go out are real: a
      // group/broadcast can skip recipients for consent, and a multi-photo
      // CallRail split can lose parts. `data.message` is only the FIRST row, so
      // reading it alone would show a clean send and leave the failures to
      // surface minutes later as Failed bubbles over realtime. Office staff send
      // the most customer photo messages, so this is the surface where a silent
      // partial failure costs the most (AGENTS.md §17). Shared with the
      // field-tech thread so the two can never word the same result differently.
      const notice = partialSendNotice(data.twilio);
      if (notice) emitToast(notice.message, notice.type);
      const real = data.message;
      if (real && activeIdRef.current === convId) {
        real.employees = employee ? { full_name: employee.full_name } : (real.employees || null);
        setMessages(prev => {
          const hasReal = prev.some(m => m.id === real.id);
          const next = prev.filter(m => m._clientId !== clientId);
          return hasReal ? next : [...next, real];
        });
      }
      if (clientId) delete retryStore.current[clientId];
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        revokeConversationAccess(convId);
        return;
      }
      console.error('Send error:', err);
      if (activeIdRef.current === convId) {
        setMessages(prev => prev.map(m => m._clientId === clientId
          ? { ...m, _pending: false, _failed: true, status: 'failed', error_message: 'Network error — message not sent' }
          : m));
      }
      emitToast('Network error — message not sent', 'error');
    }
  }, [employee, canAttestPriorConsent, revokeConversationAccess]);

  const handleSend = async () => {
    if (!activeId) return;
    // Read the live composer text (source of truth) so a second Enter in the SAME
    // tick — before React re-renders — sees the box we blank below and no-ops.
    const el = composeRef.current;
    const text = (el ? (el.innerText || '') : compose).trim();

    if (!isNote && customerSmsBlocked) {
      const reason = hasExplicitSmsOptOut
        ? 'Contact opted out of SMS'
        : hasPendingSmsStop
          ? 'A STOP request is still being processed'
          : hasEffectiveDnd
            ? 'Contact has Do Not Disturb enabled'
            : showSchedule && !hasGlobalSmsPermission
              ? 'Scheduled SMS requires the contact’s full SMS opt-in'
              : 'Outbound SMS is blocked for this contact';
      emitToast(reason, 'error');
      return;
    }

    // ── Scheduled message path (unchanged; text-only) ──
    if (showSchedule && scheduleDate && scheduleTime) {
      if (!text) return;
      // Synchronous guard: Enter bypasses the disabled button, so a same-tick
      // double-Enter would otherwise create two scheduled rows before `sending` flips.
      if (scheduleSendingRef.current) return;
      const sendAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      if (new Date(sendAt) <= new Date()) { emitToast('Scheduled time must be in the future', 'error'); return; }
      // Keep this operation id after an ambiguous/lost response. The same exact
      // conversation/body/time retry then reaches the RPC with the same id
      // instead of creating a second scheduled row.
      const scheduledOperation = getScheduledMessageOperation(
        scheduledMessageOperationsRef.current,
        { conversationId: activeId, body: text, sendAt },
        { ownerLease: pwaOwnerLease },
      );
      scheduleSendingRef.current = true;
      setSending(true);
      try {
        await db.rpc('create_scheduled_message', {
          p_id: scheduledOperation.id,
          p_conversation_id: activeId,
          p_body: text,
          p_send_at: sendAt,
        });
        clearScheduledMessageOperation(
          scheduledMessageOperationsRef.current,
          scheduledOperation,
        );
        clearCompose(); clearDraft(activeId); setShowSchedule(false); setScheduleDate(''); setScheduleTime('');
        emitToast('Message scheduled', 'success');
      } catch (err) {
        console.error('Schedule error:', err);
        const scheduleError = `${err?.code || ''} ${err?.message || ''}`.toLowerCase();
        const message = scheduleError.includes('exactly one')
          || scheduleError.includes('ambiguous')
          || scheduleError.includes('group')
          || scheduleError.includes('broadcast')
          ? 'Scheduled messages are only available for one-to-one conversations'
          : scheduleError.includes('42501')
              || scheduleError.includes('not_authorized')
              || scheduleError.includes('access denied')
              || scheduleError.includes('messages access')
            ? 'You no longer have access to this conversation'
            : 'Failed to schedule';
        emitToast(message, 'error');
      }
      finally { setSending(false); scheduleSendingRef.current = false; }
      return;
    }

    if (uploadingAttachment) { emitToast('Attachment still uploading…', 'info'); return; }
    const readyMedia = attachments.filter(a => a.url).map(a => a.url);
    if (!text && readyMedia.length === 0) return;
    if (activeContact?.dnd && !isNote) return;       // guarded by the compose UI too

    // Blank the composer synchronously (before the async optimistic append) so a
    // rapid double-Enter cannot fire a second identical send.
    if (el) el.innerText = '';

    const convId = activeId;
    const wasNote = isNote;
    const previewMedia = attachments.map(a => a.url || a.localPreview).filter(Boolean);
    const clientId = crypto.randomUUID();
    const optimistic = {
      id: clientId,
      _clientId: clientId,
      _pending: true,
      type: wasNote ? 'internal_note' : 'sms_outbound',
      body: text,
      status: 'pending',
      media_urls: (readyMedia.length ? readyMedia : previewMedia).length
        ? JSON.stringify(readyMedia.length ? readyMedia : previewMedia) : null,
      created_at: new Date().toISOString(),
      employees: employee ? { full_name: employee.full_name } : null,
    };
    retryStore.current[clientId] = { text, media_urls: readyMedia, isNote: wasNote };

    setMessages(prev => [...prev, optimistic]);
    atBottomRef.current = true; setAtBottom(true); setNewInThread(0);

    // Optimistic UI reset + conversation-list metadata bump.
    clearCompose(); clearDraft(convId); clearAttachments(); setIsNote(false);
    const preview = wasNote
      ? `[Note] ${text.substring(0, 80)}`
      : (text || '[Photo]').substring(0, 100);
    applyConvMeta(convId, wasNote, preview);

    dispatchSend({ clientId, convId, text, media_urls: readyMedia, isNote: wasNote });
    composeRef.current?.focus();
  };

  const retryMessage = useCallback((msg) => {
    const convId = activeIdRef.current;
    // Optimistic send-time failures keep their payload in retryStore; a carrier-level
    // failure (status webhook flipped a confirmed row to 'failed', no _clientId) is
    // reconstructed from the row itself (drop blob: previews, keep real media URLs).
    const stored = msg._clientId ? retryStore.current[msg._clientId] : null;
    const payload = stored || {
      text: msg.body || '',
      media_urls: parseMediaUrls(msg.media_urls).filter(isRetryableMediaReference),
      isNote: msg.type === 'internal_note',
    };
    if (!payload.text && !payload.media_urls.length) { emitToast('Cannot retry this message', 'error'); return; }
    // Flip this exact bubble back to pending. Match by _clientId (optimistic) OR by
    // id (real row) — never `undefined === undefined`, which would hit every row.
    // A fetch-level retry keeps the original request id. A user-requested retry
    // of a persisted failed carrier row is a new provider attempt.
    const matchKey = msg._clientId || crypto.randomUUID();
    retryStore.current[matchKey] = payload;
    setMessages(prev => prev.map(m => ((m._clientId && m._clientId === msg._clientId) || m.id === msg.id)
      ? { ...m, _clientId: matchKey, _pending: true, _failed: false, status: 'pending', error_message: null, error_code: null }
      : m));
    dispatchSend({ clientId: matchKey, convId, text: payload.text, media_urls: payload.media_urls, isNote: payload.isNote });
  }, [dispatchSend]);

  const handleConsentRecorded = useCallback((record) => {
    const prompt = consentPrompt;
    if (!prompt || !record?.contact_id) return;

    setServiceConsentStatus({
      contactId: record.contact_id,
      phone: activeContact?.phone || null,
      allowed: record.service_sms_consent === true,
      loading: false,
      checked: true,
      error: null,
      code: record.service_sms_consent === true ? 'SERVICE_CONSENT' : 'NO_CONSENT',
      source: null,
    });
    setConsentPrompt(null);
  }, [consentPrompt, activeContact?.phone]);

  // ─── SECTION: Event handlers — composer input ──────────────

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  const handleComposeInput = () => {
    const el = composeRef.current;
    if (!el) return;
    const text = el.innerText || '';
    setCompose(text);
    setDraft(activeIdRef.current, text);   // persist draft per thread
  };
  const clearCompose = () => {
    setCompose('');
    if (composeRef.current) composeRef.current.innerText = '';
  };
  const handlePaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  // ─── SECTION: Event handlers — new conversation / templates ──────────────

  const loadContacts = useCallback(async (query, signal) => {
    const requestId = contactSearchRequestRef.current + 1;
    contactSearchRequestRef.current = requestId;
    setContactsLoading(true);
    setContactsLoadError(null);
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch(
        `/api/message-conversations?q=${encodeURIComponent(query)}`,
        { headers: authHeader, signal },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not search contacts');
      if (requestId === contactSearchRequestRef.current) {
        setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (requestId !== contactSearchRequestRef.current) return;
      console.error('Load contacts error:', error);
      setContacts([]);
      setContactsLoadError('Could not load contacts. Check your connection and try again.');
      showError('Could not load contacts');
    } finally {
      if (!signal?.aborted && requestId === contactSearchRequestRef.current) {
        setContactsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!showNewConv) return undefined;
    const query = contactSearch.trim();
    if (query.length < 2) {
      setContacts([]);
      setContactsLoading(false);
      setContactsLoadError(null);
      return undefined;
    }
    const controller = new AbortController();
    setContacts([]);
    setContactsLoading(true);
    setContactsLoadError(null);
    const searchTimer = window.setTimeout(
      () => loadContacts(query, controller.signal),
      200,
    );
    return () => {
      contactSearchRequestRef.current += 1;
      window.clearTimeout(searchTimer);
      controller.abort();
    };
  }, [contactSearch, contactSearchRetry, loadContacts, showNewConv]);

  // The shared Modal focuses the first focusable in its panel — the ✕ — so a plain
  // `autoFocus` on the search field never wins. This parent effect runs after Modal's
  // own (child effects fire first), which puts the caret back in the search box.
  useEffect(() => {
    if (showNewConv) newConvSearchRef.current?.focus();
  }, [showNewConv]);

  const openNewConvModal = () => {
    setShowNewConv(true);
    setContactSearch('');
    setContacts([]);
    setContactsLoadError(null);
  };
  const createNewConversation = async (contact) => {
    if (creatingConv) return;
    const existing = conversations.find(c => c.conversation_participants?.some(p => p.contact_id === contact.id));
    if (existing) { setShowNewConv(false); selectConversation(existing.id); return; }
    setCreatingConv(true);
    try {
      const conversationId = await resolveConversationId(contact.id);
      if (!conversationId) throw new Error('Could not start this conversation');
      const refreshed = await loadConversations({ silent: true });
      if (!hasConversationAccess(refreshed, conversationId)) {
        throw new Error('Created conversation was not returned by the inbox refresh');
      }
      setShowNewConv(false);
      selectConversation(conversationId);
    } catch (err) { console.error('Create conversation error:', err); emitToast('Could not start conversation', 'error'); }
    finally { setCreatingConv(false); }
  };

  const openTemplates = async () => {
    setShowTemplates(!showTemplates); setShowSchedule(false);
    if (templates.length === 0) {
      try { const data = await db.select('message_templates', 'is_active=eq.true&order=category.asc,title.asc'); setTemplates(data); }
      catch (error) {
        console.error('Load templates error:', error);
        showError('Could not load message templates');
      }
    }
  };
  const insertTemplate = (tmpl) => {
    setCompose(tmpl.body);
    if (composeRef.current) composeRef.current.innerText = tmpl.body;
    setDraft(activeIdRef.current, tmpl.body);
    setShowTemplates(false);
    composeRef.current?.focus();
  };

  const insertDraft = useCallback((text) => {
    setCompose(text || '');
    if (composeRef.current) composeRef.current.innerText = text || '';
    setDraft(activeIdRef.current, text || '');
    composeRef.current?.focus();
  }, []);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // ─── SECTION: Render ──────────────

  return (
    <div className={`conversations-layout${mobileView === 'thread' ? ' mobile-thread' : ''}${kbOpen ? ' conv-kb-open' : ''}`}>

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
          ) : accessProofUnverified && loadError ? (
            <ErrorState
              message={loadError}
              secondary={(
                <HapticRetryButton
                  onRetry={() => loadConversations({ silent: true })}
                />
              )}
            />
          ) : accessProofUnverified ? (
            <TabLoading label="Verifying conversation access…" />
          ) : loadError && conversations.length === 0 ? (
            <ErrorState
              message={loadError}
              secondary={<HapticRetryButton onRetry={() => loadConversations()} />}
            />
          ) : (
            <>
              {loadError && (
                <ErrorState
                  className="conv-inline-error"
                  message={loadError}
                  secondary={(
                    <HapticRetryButton
                      onRetry={() => loadConversations({ silent: true })}
                    />
                  )}
                />
              )}
              {filtered.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-state-icon">💬</div>
                  <div className="empty-state-title">No conversations</div>
                  <div className="empty-state-text">{search || filter !== 'all' ? 'Try adjusting your filters' : 'Messages will appear when they come in'}</div>
                </div>
              ) : (<>
                {visibleConvs.map(conv => {
                  const isActive = conv.id === activeId;
                  const hasUnread = conv.unread_count > 0;
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
                        {/* Status pills removed from rows (owner, 2026-08-06) — the
                            filter chips carry status; rows keep only the unread count. */}
                        {hasUnread && (
                          <div className="conv-item-meta">
                            <span className="conv-unread-badge">{conv.unread_count}</span>
                          </div>
                        )}
                      </div>
                      <button className="conv-item-action" onClick={(e) => { e.stopPropagation(); setContextMenu({ convId: conv.id, x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().top }); }} aria-label="More">
                        <IconDots style={{ width: 16, height: 16 }} />
                      </button>
                    </div>
                  );
                })}
                {filtered.length > visibleConvs.length && (
                  <button className="conv-load-more" onClick={() => setListLimit(n => n + LIST_PAGE)}>
                    Load {Math.min(LIST_PAGE, filtered.length - visibleConvs.length)} more
                  </button>
                )}
              </>)}
            </>
          )}
        </div>
      </div>

      {/* ═══ CENTER: Thread ═══ */}
      <div className="conv-thread-panel">
        {!activeId ? (
          <div className="conv-empty-thread"><div className="empty-state-icon">💬</div><div className="empty-state-title">Select a conversation</div><div className="empty-state-text">Choose from the list to view messages</div></div>
        ) : !activeAccessAuthorized || !activeConv ? (
          <TabLoading label="Verifying conversation access…" />
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
                <button
                  className="conv-info-btn"
                  onClick={() => activeConv?.unread_count > 0 ? markAsRead(activeId) : markAsUnread(activeId)}
                  title={activeConv?.unread_count > 0 ? 'Mark as read' : 'Mark as unread'}
                >
                  {activeConv?.unread_count > 0
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 19, height: 19 }}>
                        <path d="M21.2 8L12 13 2.8 8" />
                        <path d="M2 8v10c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V8" />
                        <path d="M2 8l10-5 10 5" />
                      </svg>
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 19, height: 19 }}>
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <polyline points="22,4 12,13 2,4" />
                      </svg>
                  }
                </button>
                {linkedJob && (
                  <Link to={`/jobs/${linkedJob.id}`} className="btn btn-sm btn-secondary conv-job-link" title={linkedJob.job_number}>
                    <span className="conv-job-link-num">{linkedJob.job_number}</span><IconLink style={{ width: 12, height: 12 }} />
                  </Link>
                )}
                <button className="conv-info-btn" onClick={() => setShowInfo(!showInfo)} aria-label="Contact info"><IconInfo style={{ width: 18, height: 18 }} /></button>
              </div>
            </div>

            <div className="conv-messages" ref={messagesScrollRef} onScroll={handleMessagesScroll}>
              {msgLoading ? (<div className="loading-page"><div className="spinner" /></div>
              ) : messageLoadError && messages.length === 0 ? (
                <ErrorState
                  message={messageLoadError}
                  secondary={<HapticRetryButton onRetry={reloadActiveMessages} />}
                />
              ) : (
                <>
                  {messageLoadError && (
                    <ErrorState
                      className="conv-inline-error"
                      message={messageLoadError}
                      secondary={<HapticRetryButton onRetry={reloadActiveMessages} />}
                    />
                  )}
                  {messages.length === 0 ? (
                    <div className="empty-state" style={{ flex: 1 }}><div className="empty-state-text">No messages yet. Send the first one below.</div></div>
                  ) : (<>
                    {hasMoreMessages && (
                      <button className="conv-load-earlier" onClick={loadEarlier} disabled={loadingEarlier}>
                        {loadingEarlier
                          ? <><span className="spinner" style={{ width: 14, height: 14 }} aria-hidden="true" /> Loading earlier messages…</>
                          : 'Load earlier messages'}
                      </button>
                    )}
                    {groupedMessages.map((item, i) => {
                      if (item.type === 'date') return <div key={`d-${i}`} className="conv-date-sep"><span>{item.label}</span></div>;
                      return (
                        <MessageBubble
                          key={item.data.id}
                          msg={item.data}
                          participants={activeConv?.conversation_participants || []}
                          isMultiConversation={
                            activeConv?.type === 'group'
                            || activeConv?.type === 'broadcast'
                            || (activeConv?.conversation_participants?.length || 0) > 1
                          }
                          onRetry={retryMessage}
                          onMediaLayout={handleMediaLayout}
                        />
                      );
                    })}
                  </>)}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Jump-to-latest pill */}
            {!atBottom && messages.length > 0 && (
              <button className="conv-jump-latest" onClick={() => { scrollToBottom(true); setNewInThread(0); }}>
                {newInThread > 0 && <span className="conv-jump-count">{newInThread}</span>}
                <IconArrowDown style={{ width: 16, height: 16 }} />
              </button>
            )}

            {/* Template picker */}
            {showTemplates && (
              <div className="conv-template-picker">
                <div className="conv-template-header">
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Templates</span>
                  <button className="conv-detail-close-btn" aria-label="Close" onClick={() => setShowTemplates(false)}><IconX style={{ width: 16, height: 16 }} /></button>
                </div>
                <div className="conv-template-list">
                  {Object.entries(templatesByCategory).map(([cat, tmpls]) => (
                    <div key={cat}>
                      <div className="conv-template-cat">{TEMPLATE_CATEGORIES[cat] || cat}</div>
                      {tmpls.map(t => (
                        <button key={t.id} className="conv-template-item" onClick={() => insertTemplate(t)}>
                          <div className="conv-template-title">{t.title}</div>
                          <div className="conv-template-body">{t.body}</div>
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
                  <button className="conv-detail-close-btn" aria-label="Close" onClick={() => { setShowSchedule(false); setScheduleDate(''); setScheduleTime(''); }}><IconX style={{ width: 16, height: 16 }} /></button>
                </div>
                <div style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
                  <DatePicker value={scheduleDate} onChange={v => setScheduleDate(v)} min={new Date().toISOString().split('T')[0]} style={{ flex: 1 }} />
                  <input type="time" className="input" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={{ width: 120 }} />
                </div>
                {scheduleDate && scheduleTime && (
                  <div style={{ padding: '0 var(--space-4) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    Will send {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                  </div>
                )}
              </div>
            )}

            {/* ── DND Banner ── */}
            {activeContact?.dnd && !isNote && (
              <div className="conv-dnd-banner">
                <span>🚫</span> DND is on — outbound messages blocked. Switch to internal note or disable DND in contact info.
              </div>
            )}
            {/* Opt-out is always actionable. Missing global opt-in is surfaced
                only after staff explicitly opens scheduling because immediate
                direct 1:1 service SMS uses the reviewed implied-permission
                exception. A pending STOP remains silently server-enforced. */}
            {activeContact
              && !hasEffectiveDnd
              && (hasExplicitSmsOptOut || (showSchedule && !hasGlobalSmsPermission))
              && !isNote && (
              <div className="conv-consent-banner" role="status" aria-live="polite">
                <div>
                  <strong>
                    {hasExplicitSmsOptOut
                      ? 'This contact opted out of SMS'
                      : 'Scheduled SMS requires full opt-in'}
                  </strong>
                  <span>
                    {hasExplicitSmsOptOut
                      ? 'They must text START before staff can send another message.'
                      : 'Send a direct service reply now, or record full SMS opt-in before scheduling.'}
                  </span>
                </div>
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
                <button className="conv-action-item" onClick={() => { setShowComposeActions(false); onPickFiles(); }} disabled={isNote}>
                  <span className="conv-action-icon"><IconPaperclip style={{ width: 18, height: 18 }} /></span>
                  <div><div className="conv-action-label">Attach Photo</div><div className="conv-action-desc">{isNote ? 'Not available for notes' : 'Send a photo as MMS'}</div></div>
                </button>
              </div>
            )}

            {replyAssist && activeConv && !isNote && (
              <div className="crm-reply-assist-slot">{replyAssist(replyContext, insertDraft)}</div>
            )}

            {/* Attachment tray */}
            {attachments.length > 0 && (
              <div className="conv-attach-tray">
                {attachments.map(a => (
                  <div key={a.clientId} className={`conv-attach-chip${a.error ? ' error' : ''}`}>
                    {a.localPreview || a.url
                      ? <img src={a.url || a.localPreview} alt={a.name} />
                      : <span className="conv-attach-icon"><IconPaperclip style={{ width: 16, height: 16 }} /></span>}
                    {a.uploading && <span className="conv-attach-uploading"><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /></span>}
                    {a.error && <span className="conv-attach-err">!</span>}
                    <button className="conv-attach-remove" onClick={() => removeAttachment(a.clientId)} aria-label={`Remove ${a.name}`}><IconX style={{ width: 12, height: 12 }} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Compose bar: [+] [input] [send] ── */}
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFilesSelected} />
            <div className={`conv-compose${isNote ? ' note-mode' : ''}${showSchedule && scheduleDate && scheduleTime ? ' schedule-mode' : ''}`}>
              <button className={`conv-plus-btn${showComposeActions ? ' active' : ''}${isNote ? ' note-active' : ''}`} onClick={() => setShowComposeActions(!showComposeActions)} aria-label="More actions">
                <IconPlus style={{ width: 18, height: 18, transition: 'transform 200ms ease', transform: showComposeActions ? 'rotate(45deg)' : 'none' }} />
              </button>
              {isNote && !showComposeActions && <span className="conv-mode-chip note">📝 Note</span>}
              {showSchedule && scheduleDate && scheduleTime && !showComposeActions && <span className="conv-mode-chip schedule">🕐 Scheduled</span>}
              <div className="conv-compose-mid">
                <div
                  ref={composeRef}
                  className="conv-compose-input"
                  contentEditable
                  role="textbox"
                  aria-label={isNote ? 'Internal note' : 'Message'}
                  data-placeholder={isNote ? 'Write an internal note...' : activeContact?.dnd ? 'DND is on — use internal note' : showSchedule && scheduleDate ? 'Write scheduled message...' : 'Type a message...'}
                  onInput={handleComposeInput}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  enterKeyHint="send"
                  suppressContentEditableWarning
                />
              </div>
              <button className={`btn conv-send-btn ${showSchedule && scheduleDate && scheduleTime ? 'btn-schedule' : 'btn-primary'}`} onClick={handleSend} disabled={(!compose.trim() && (isNote || !attachments.some(a => a.url))) || uploadingAttachment || (showSchedule && (!scheduleDate || !scheduleTime || !compose.trim())) || (customerSmsBlocked && !isNote) || (sending && showSchedule)} aria-label="Send">
                {(sending && showSchedule) ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: '2px' }} /> : showSchedule && scheduleDate && scheduleTime ? <IconClock style={{ width: 16, height: 16 }} /> : <IconSend style={{ width: 16, height: 16 }} />}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ═══ RIGHT: Detail ═══ */}
      {showInfo && <div className="conv-info-backdrop" onClick={() => setShowInfo(false)} />}
      <div className={`conv-detail-panel${showInfo ? ' open' : ''}`}>
        {activeAccessAuthorized && activeConv ? (
          <>
            <div className="conv-detail-close-row"><button className="conv-detail-close-btn" aria-label="Close" onClick={() => setShowInfo(false)}><IconX style={{ width: 18, height: 18 }} /></button></div>

            <div className="conv-detail-section" style={{ textAlign: 'center' }}>
              {activeContact ? (
                <Link to={`/contacts/${activeContact.id}`} className="conv-detail-profile-link">
                  <div className="conv-detail-avatar-lg">{getInitials(activeContact.name || activeConv.title)}</div>
                  <div className="conv-detail-name">{cleanName(activeContact.name || activeConv.title)}</div>
                  {activeContact.company && <div className="conv-detail-company">{activeContact.company}</div>}
                </Link>
              ) : (
                <div className="conv-detail-profile-link">
                  <div className="conv-detail-avatar-lg">{getInitials(activeConv.title)}</div>
                  <div className="conv-detail-name">{cleanName(activeConv.title)}</div>
                </div>
              )}
              {activeContact?.role && <span className="conv-detail-role-tag">{activeContact.role.replace(/_/g, ' ')}</span>}
              {activeContact && (
                <div className="conv-detail-view-profile">
                  <Link to={`/contacts/${activeContact.id}`}>View full profile →</Link>
                </div>
              )}
            </div>

            {activeContact && (
              <div className="conv-detail-section">
                <div className="conv-detail-label">Messaging</div>
                <div className="conv-dnd-row">
                  <div className="conv-dnd-info">
                    <div className="conv-dnd-title">Do Not Disturb</div>
                    <div className="conv-dnd-desc">
                      {activeContact.dnd
                        ? 'All outbound messages blocked'
                        : hasExplicitSmsOptOut
                          ? 'DND off, but this contact opted out of SMS'
                          : 'DND off — outbound messages allowed'}
                    </div>
                  </div>
                  <button
                    className={`conv-dnd-toggle${activeContact.dnd ? ' on' : ''}`}
                    onClick={() => toggleDnd(activeContact.id, activeContact.dnd)}
                    role="switch"
                    aria-checked={activeContact.dnd}
                    aria-label="Do Not Disturb"
                  >
                    <span className="conv-dnd-knob" />
                  </button>
                </div>
                {activeContact.dnd && activeContact.dnd_at && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--status-needs-response)', marginTop: 'var(--space-2)' }}>
                    Enabled {new Date(activeContact.dnd_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                )}
              </div>
            )}

            <div className="conv-detail-section">
              <div className="conv-detail-label">Contact</div>
              {activeContact?.phone && <div className="conv-detail-row"><IconPhone style={{ width: 14, height: 14, color: 'var(--text-tertiary)', flexShrink: 0 }} /><a href={`tel:${activeContact.phone}`} className="conv-detail-link">{activeContact.phone}</a></div>}
              {activeContact?.email && <div className="conv-detail-row"><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', width: 14, textAlign: 'center', flexShrink: 0 }}>@</span><a href={`mailto:${activeContact.email}`} className="conv-detail-link">{activeContact.email}</a></div>}
            </div>
            {linkedJob && (
              <div className="conv-detail-section">
                <div className="conv-detail-label">Linked Job</div>
                <Link to={`/jobs/${linkedJob.id}`} className="conv-detail-job-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="conv-detail-job-num">{linkedJob.job_number}</span>
                    {linkedJob.division && <span className="division-badge" data-division={linkedJob.division}>{linkedJob.division}</span>}
                  </div>
                  {linkedJob.insured_name && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>{linkedJob.insured_name}</div>}
                </Link>
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
              {employee?.role === 'admin' && employee?.is_external !== true && (
                <button
                  className="btn btn-secondary conversation-members__launch"
                  style={{ width: '100%', marginTop: 'var(--space-2)' }}
                  onPointerUp={() => impact('light')}
                  onClick={() => setMemberEditorOpen(true)}
                >
                  Manage chat participants
                </button>
              )}
              <LeaveConversationButton
                conversationId={activeId}
                className="btn btn-sm"
                onLeft={(conversationId) => revokeConversationAccess(
                  conversationId,
                  { announce: false },
                )}
              />
            </div>
          </>
        ) : (<div className="conv-detail-section" style={{ color: 'var(--text-tertiary)', textAlign: 'center', paddingTop: 40 }}>Select a conversation</div>)}
      </div>

      <ConversationMemberEditor
        open={memberEditorOpen && activeAccessAuthorized}
        onClose={() => setMemberEditorOpen(false)}
        conversationId={activeId}
        conversationTitle={activeAccessAuthorized ? cleanName(activeConv?.title) : ''}
      />

      {/* Context menu */}
      {contextMenu && (
        <div className="conv-context-menu" style={{ top: Math.min(contextMenu.y, window.innerHeight - 100), left: Math.min(contextMenu.x, window.innerWidth - 180) }}>
          {conversations.find(c => c.id === contextMenu.convId)?.unread_count > 0
            ? <button className="conv-context-item" onClick={() => markAsRead(contextMenu.convId)}><IconCheck style={{ width: 14, height: 14 }} /> Mark as read</button>
            : <button className="conv-context-item" onClick={() => markAsUnread(contextMenu.convId)}><span className="conv-ctx-unread-dot" /> Mark as unread</button>
          }
        </div>
      )}

      {/* New Conversation Modal — shared <Modal> owns role=dialog, focus trap, ESC/overlay close */}
      <Modal
        open={showNewConv}
        onClose={() => setShowNewConv(false)}
        title="New Conversation"
        size="sm"
        className="conv-new-modal"
      >
        <div className="conv-new-modal__search">
          <input
            ref={newConvSearchRef}
            className="input"
            placeholder="Search contacts by name, phone, or company..."
            aria-label="Search contacts"
            value={contactSearch}
            onChange={e => setContactSearch(e.target.value)}
          />
        </div>
        <div className="conv-new-modal__list">
          {contactsLoading ? (
            <TabLoading label="Loading contacts…" />
          ) : contactsLoadError ? (
            <ErrorState
              message={contactsLoadError}
              secondary={(
                <HapticRetryButton
                  onRetry={() => setContactSearchRetry((current) => current + 1)}
                />
              )}
            />
          ) : filteredContacts.length === 0 ? (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              {contactSearch.trim().length >= 2 ? 'No contacts found' : 'Type at least 2 characters to search'}
            </div>
          ) : filteredContacts.map(contact => (
            <button key={contact.id} className="conv-contact-item" onClick={() => createNewConversation(contact)} disabled={creatingConv}>
              <div className="conv-item-avatar" style={{ width: 36, height: 36, fontSize: 'var(--text-xs)' }}>{getInitials(contact.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{contact.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'flex', gap: 'var(--space-2)' }}>
                  <span>{contact.phone}</span>{contact.company && <span>· {contact.company}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      <SmsConsentAttestationModal
        open={!!consentPrompt}
        contactId={consentPrompt?.contactId || null}
        contactName={activeContact?.name || activeConv?.title || ''}
        onClose={() => setConsentPrompt(null)}
        onRecorded={handleConsentRecorded}
      />
    </div>
  );
}
