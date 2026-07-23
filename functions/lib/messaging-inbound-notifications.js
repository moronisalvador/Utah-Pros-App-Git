/**
 * Provider-neutral construction of the existing message.inbound notification.
 * The route injects the dispatcher so this flat library has no API dependency.
 */
export async function notifyInboundMessage({
  db,
  env,
  conversation,
  contact,
  from,
  text,
  dispatchImpl,
}) {
  if (typeof dispatchImpl !== 'function') return;
  try {
    const assignedTo = conversation?.assigned_to || null;
    const who = (contact?.name && String(contact.name).trim()) || from;
    const preview = (text || '').trim().slice(0, 140);
    await dispatchImpl({
      db,
      env,
      typeKey: 'message.inbound',
      body: {
        title: `New text from ${who}`,
        body: preview || '[Media]',
        link: '/conversations',
        entity_type: 'conversation',
        entity_id: conversation?.id || null,
        recipient_ids: assignedTo ? [assignedTo] : undefined,
        data: { conversation_id: conversation?.id || null, route: '/conversations' },
      },
    });
  } catch {
    // Notification delivery remains best-effort and never breaks message ingest.
  }
}
