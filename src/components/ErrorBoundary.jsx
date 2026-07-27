/**
 * ════════════════════════════════════════════════
 * FILE: ErrorBoundary.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Contains a React render failure so one route or persistent mobile pane does
 *   not blank the whole application. It records only privacy-redacted local
 *   diagnostics and offers bounded retry/reset navigation.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  lib/staleChunkReload, lib/pwaDiagnostics, lib/releaseIdentity
 *   Data:      writes → local session diagnostics only
 * ════════════════════════════════════════════════
 */
import { Component } from 'react';
import { buildResetUrl } from '@/lib/staleChunkReload';
import { recordPwaDiagnostic } from '@/lib/pwaDiagnostics';
import { RELEASE } from '@/lib/releaseIdentity';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    const diagnostic = recordPwaDiagnostic('react-boundary', {
      section: this.props.section || 'App',
      error,
    });
    if (import.meta.env.DEV) {
      console.error(`[ErrorBoundary:${this.props.section || 'App'}]`, error, info.componentStack);
    } else {
      console.error('[ErrorBoundary]', diagnostic);
    }
    this.props.onError?.(error);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const section = this.props.section || 'This page';

    return (
      <div hidden={this.props.hidden} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '60vh',
        padding: '32px 24px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.4 }}>⚠️</div>
        <div style={{
          fontSize: 16, fontWeight: 700, color: 'var(--text-primary)',
          marginBottom: 8,
        }}>
          {section} ran into a problem
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text-tertiary)',
          marginBottom: 24, maxWidth: 320, lineHeight: 1.5,
        }}>
          This screen stopped before it could finish rendering. Try again, or reload a fresh copy.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={this.handleReset}
            style={{
              padding: '10px 20px', borderRadius: 'var(--radius-md)',
              background: 'var(--accent)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              fontFamily: 'var(--font-sans)', minHeight: 44,
            }}
          >
            Try again
          </button>
          {/* Hard-recovery for a stale/poisoned build (common cause of this
              screen, esp. in an installed PWA where there's no address bar to
              reach /reset). buildResetUrl → /reset is served with
              Clear-Site-Data:"cache", evicting the cached shell, then returns
              here. Login is preserved ("cache" only). */}
          <button
            onClick={() => window.location.href = buildResetUrl(window.location.pathname + window.location.search)}
            style={{
              padding: '10px 20px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
              minHeight: 44,
            }}
          >
            Clear cache &amp; reload
          </button>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '10px 20px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
              minHeight: 44,
            }}
          >
            Go to Dashboard
          </button>
        </div>
        <div style={{
          marginTop: 16, fontSize: 11, color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
        }}>
          Support code: {RELEASE.releaseId}
        </div>
        {import.meta.env.DEV && this.state.error && (
          <details style={{
            marginTop: 24, textAlign: 'left', maxWidth: 480,
            fontSize: 11, color: 'var(--text-tertiary)',
            background: 'var(--bg-tertiary)', padding: 12,
            borderRadius: 'var(--radius-md)', cursor: 'pointer',
          }}>
            <summary style={{ fontWeight: 600, marginBottom: 6 }}>
              Error details (dev only)
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
              {this.state.error.toString()}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
