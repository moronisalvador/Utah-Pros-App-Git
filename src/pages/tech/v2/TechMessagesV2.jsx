/**
 * ════════════════════════════════════════════════
 * FILE: TechMessagesV2.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The rebuilt text-messaging screen a field tech uses — a native-feeling inbox and
 *   thread that stays alive in the background so switching tabs is instant. This file
 *   is the F-M FOUNDATION STUB: it only proves the plumbing works (the pane covers
 *   /tech/conversations when the page:tech_msgs_v2 flag is on, and the legacy shared
 *   Conversations screen never mounts underneath it; with the flag off, legacy is
 *   byte-identical). The real list, thread, composer, and send flow land in Phase B1.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/conversations (behind page:tech_msgs_v2; legacy otherwise)
 *   Rendered by:  TechLayout pane host (persistent, flag-gated pane)
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  ./messages/TechMsgsPane (two-layer host), @/components/tech/v2
 *              (SkeletonList), i18n msgs namespace
 *   Data:      none yet (B1 wires useTechConversations + useThread)
 *
 * NOTES / GOTCHAS:
 *   - The `active` prop (pane is the visible tab) is threaded straight into
 *     TechMsgsPane; the badge freshness + convos cache live in useTechConversations
 *     (mounted by the TechLayout Messages-tab badge), not here.
 *   - Owned by the tech-messages-v2 initiative (F-M ships the stub; B1/B2 fill it) —
 *     .claude/rules/tech-messages-v2-wave-ownership.md §2.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonList } from '@/components/tech/v2';
import TechMsgsPane from './messages/TechMsgsPane.jsx';

export default function TechMessagesV2({ active = true }) {
  const { t } = useTranslation('msgs');

  // F-M stub: a skeleton list in the list layer proves the pane covers + falls back
  // both ways. Thread layer stays empty (threadOpen is always false until B1).
  return (
    <TechMsgsPane
      active={active}
      threadOpen={false}
      list={
        <div className="tv2-msgs-list" role="region" aria-label={t('list.title')}>
          <SkeletonList rows={7} />
        </div>
      }
    />
  );
}
