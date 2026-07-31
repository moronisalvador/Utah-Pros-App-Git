/**
 * ════════════════════════════════════════════════
 * FILE: useUnsavedNavigationGuard.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps a dirty form on its current SPA route until the user explicitly
 *   confirms an in-app link or browser/native Back navigation.
 *
 * DEPENDS ON:
 *   Packages:  React, react-router-dom navigation supplied by the caller
 *   Internal:  none
 *   Data:      reads  → browser history state
 *              writes → a mount-specific, same-URL browser history sentinel
 *
 * NOTES / GOTCHAS:
 *   - The app uses BrowserRouter, so React Router's data-router useBlocker hook
 *     is unavailable. The sentinel is a duplicate of the current URL; Back is
 *     immediately restored before the inline confirmation is shown.
 *   - Confirmed path navigation replaces only the sentinel, preserving one
 *     clean calculator/builder entry in browser history.
 * ════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_KEY = 'uprUnsavedNavigationGuard';
let fallbackGuardSequence = 0;

function guardToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackGuardSequence += 1;
  return `upr-unsaved-${fallbackGuardSequence}`;
}

function stateWithoutGuard(state) {
  const next = { ...(state || {}) };
  delete next[HISTORY_KEY];
  return next;
}

export function useUnsavedNavigationGuard({ dirty, navigate }) {
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const tokenRef = useRef(guardToken());
  const dirtyRef = useRef(dirty);
  const activeRef = useRef(false);
  const restoringRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const stripCurrentMarker = useCallback(() => {
    if (window.history.state?.[HISTORY_KEY] !== tokenRef.current) return false;
    window.history.replaceState(
      stateWithoutGuard(window.history.state),
      '',
      window.location.href,
    );
    return true;
  }, []);

  const stay = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  const leaveBack = useCallback(() => {
    const onSentinel = activeRef.current
      && window.history.state?.[HISTORY_KEY] === tokenRef.current;
    activeRef.current = false;
    restoringRef.current = false;
    setPendingNavigation(null);
    navigate(onSentinel ? -2 : -1);
  }, [navigate]);

  const confirmNavigation = useCallback(() => {
    const pending = pendingNavigation;
    if (!pending) return;
    if (pending.type === 'history') {
      leaveBack();
      return;
    }

    const onSentinel = activeRef.current
      && window.history.state?.[HISTORY_KEY] === tokenRef.current;
    activeRef.current = false;
    restoringRef.current = false;
    setPendingNavigation(null);
    stripCurrentMarker();
    navigate(pending.target, onSentinel ? { replace: true } : undefined);
  }, [leaveBack, navigate, pendingNavigation, stripCurrentMarker]);

  useEffect(() => {
    const existingState = window.history.state;
    if (existingState?.[HISTORY_KEY]) {
      window.history.replaceState(
        stateWithoutGuard(existingState),
        '',
        window.location.href,
      );
    }

    return () => {
      activeRef.current = false;
      restoringRef.current = false;
      stripCurrentMarker();
    };
  }, [stripCurrentMarker]);

  useEffect(() => {
    const guard = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  useEffect(() => {
    const guardInternalNavigation = (event) => {
      if (
        !dirty
        || event.defaultPrevented
        || (event.button != null && event.button !== 0)
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return;

      const link = event.target.closest?.('a[href]');
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;

      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation({
        type: 'path',
        target: `${destination.pathname}${destination.search}${destination.hash}`,
      });
    };

    document.addEventListener('click', guardInternalNavigation, true);
    return () => document.removeEventListener('click', guardInternalNavigation, true);
  }, [dirty]);

  useEffect(() => {
    const marker = tokenRef.current;
    if (!dirty) {
      queueMicrotask(() => {
        if (!dirtyRef.current) setPendingNavigation(null);
      });
      if (activeRef.current && window.history.state?.[HISTORY_KEY] === marker) {
        activeRef.current = false;
        restoringRef.current = false;
        window.history.back();
      } else {
        activeRef.current = false;
        restoringRef.current = false;
      }
      return undefined;
    }

    if (window.history.state?.[HISTORY_KEY] !== marker) {
      window.history.pushState(
        { ...(window.history.state || {}), [HISTORY_KEY]: marker },
        '',
        window.location.href,
      );
    }
    activeRef.current = true;

    const guardHistoryBack = () => {
      if (!dirtyRef.current || !activeRef.current) return;
      if (restoringRef.current) {
        if (window.history.state?.[HISTORY_KEY] === marker) restoringRef.current = false;
        return;
      }

      // Back moved from the same-URL sentinel to the real form entry. Restore
      // the sentinel before offering the inline discard choice.
      restoringRef.current = true;
      window.history.forward();
      setPendingNavigation({ type: 'history' });
    };

    window.addEventListener('popstate', guardHistoryBack);
    return () => window.removeEventListener('popstate', guardHistoryBack);
  }, [dirty]);

  return {
    pendingNavigation,
    stay,
    confirmNavigation,
    leaveBack,
  };
}

export default useUnsavedNavigationGuard;
