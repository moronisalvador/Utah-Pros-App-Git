// Supabase JS client — ONLY for Realtime subscriptions
// All data operations go through REST (see supabase.js)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Get Authorization header from current session (for worker fetch calls) */
export async function getAuthHeader() {
  const { data: { session } } = await realtimeClient.auth.getSession();
  const token = session?.access_token;
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export const realtimeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  // Disable all non-realtime features to keep this lean
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

/**
 * Subscribe to new messages in a conversation
 * Returns unsubscribe function
 */
export function subscribeToMessages(conversationId, callback) {
  const channel = realtimeClient
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => callback(payload.new)
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => callback(payload.new, 'update')
    )
    .subscribe();

  return () => {
    realtimeClient.removeChannel(channel);
  };
}

/**
 * Subscribe to conversation list updates (new messages, status changes)
 * Returns unsubscribe function
 */
export function subscribeToConversations(callback) {
  const channel = realtimeClient
    .channel('conversations:all')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversations',
      },
      (payload) => callback(payload)
    )
    .subscribe();

  return () => {
    realtimeClient.removeChannel(channel);
  };
}
