import { useState, useRef, useCallback, useEffect } from 'react';

const THRESHOLD = 70;   // px to pull before triggering refresh
const MAX_PULL = 120;   // max visible pull distance
const RESISTANCE = 2.5; // pull resistance factor

function getScrollParent(el) {
  let node = el.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

export default function PullToRefresh({ onRefresh, onScroll, children, className, style }) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef(null);
  const scrollParentRef = useRef(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const isPulling = useRef(false);

  // Cache the scroll parent on mount + attach onScroll
  useEffect(() => {
    if (containerRef.current) {
      scrollParentRef.current = getScrollParent(containerRef.current);
    }
    const sp = scrollParentRef.current;
    if (onScroll && sp) {
      sp.addEventListener('scroll', onScroll, { passive: true });
      return () => sp.removeEventListener('scroll', onScroll);
    }
  }, [onScroll]);

  const getScrollTop = useCallback(() => {
    const sp = scrollParentRef.current;
    return sp ? sp.scrollTop : 0;
  }, []);

  const handleTouchStart = useCallback((e) => {
    if (!containerRef.current || refreshing) return;

    // Only activate if scroll parent is at or near the top
    if (getScrollTop() > 5) return;

    startY.current = e.touches[0].clientY;
    isPulling.current = true;
  }, [refreshing, getScrollTop]);

  const handleTouchMove = useCallback((e) => {
    if (!isPulling.current || refreshing) return;

    // Double-check scroll parent is still at top
    if (getScrollTop() > 5) {
      isPulling.current = false;
      setPulling(false);
      setPullDistance(0);
      return;
    }

    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;

    if (diff > 0) {
      // Pulling down — apply resistance curve
      const distance = Math.min(diff / RESISTANCE, MAX_PULL);
      setPullDistance(distance);
      setPulling(true);

      // Prevent default scroll to avoid browser's native pull-to-refresh
      if (diff > 20) {
        e.preventDefault();
      }
    } else {
      // Scrolling up — cancel pull and let normal scroll happen
      isPulling.current = false;
      setPulling(false);
      setPullDistance(0);
    }
  }, [refreshing, getScrollTop]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance >= THRESHOLD / RESISTANCE && onRefresh) {
      // Trigger refresh
      setRefreshing(true);
      setPullDistance(50); // Hold at indicator position
      try {
        await onRefresh();
      } catch (err) {
        console.error('Refresh error:', err);
      }
      setRefreshing(false);
    }

    // Animate back
    setPulling(false);
    setPullDistance(0);
  }, [pullDistance, onRefresh]);

  const showIndicator = pulling || refreshing;
  const pastThreshold = pullDistance >= THRESHOLD / RESISTANCE;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        ...style,
        position: 'relative',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="ptr-indicator"
        style={{
          height: showIndicator ? pullDistance : 0,
          opacity: showIndicator ? 1 : 0,
          transition: pulling ? 'none' : 'all 300ms ease',
        }}
      >
        <div
          className={`ptr-spinner${refreshing ? ' spinning' : ''}`}
          style={{
            transform: refreshing
              ? 'rotate(0deg)'
              : `rotate(${pullDistance * 3}deg)`,
            opacity: Math.min(pullDistance / (THRESHOLD / RESISTANCE), 1),
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </div>
        {!refreshing && pastThreshold && (
          <div className="ptr-text">Release to refresh</div>
        )}
      </div>

      {/* Content with pull offset */}
      <div
        style={{
          transform: showIndicator ? `translateY(${pullDistance}px)` : 'translateY(0)',
          transition: pulling ? 'none' : 'transform 300ms ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}
