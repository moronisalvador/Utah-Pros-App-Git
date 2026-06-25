/**
 * ════════════════════════════════════════════════
 * FILE: WidgetBoundary.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A safety net around a single dashboard card. If one card hits a rendering
 *   error, this catches it and shows a small "card hit an error" message in just
 *   that spot — the other nine cards keep working instead of the whole dashboard
 *   going blank.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (wrapper)
 *   Rendered by:  src/pages/Dashboard.jsx (wraps each grid item)
 *
 * DEPENDS ON:
 *   Packages:  react · Internal: none · Data: none
 *
 * NOTES / GOTCHAS:
 *   - Must be a class component — React error boundaries can't be hooks/functions.
 * ════════════════════════════════════════════════
 */

import { Component } from 'react';

export class WidgetBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Non-fatal: log for debugging; the fallback below keeps the rest of the grid alive.
    console.error('Overview widget crashed:', error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          className="ovw-card"
          style={{ height: '100%', alignItems: 'center', justifyContent: 'center', color: '#98a2b3', fontSize: 12.5, fontWeight: 500, textAlign: 'center' }}
        >
          This card hit an error.
        </div>
      );
    }
    return this.props.children;
  }
}
