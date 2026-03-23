import { Component } from 'react';

/**
 * ErrorBoundary — catches render errors in any child tree.
 * Shows a recovery UI instead of a white screen.
 * Wrap each major route section in App.jsx with this.
 *
 * Usage:
 *   <ErrorBoundary section="Jobs">
 *     <Jobs />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to console — swap for a real error reporting service later
    console.error(`[ErrorBoundary:${this.props.section || 'App'}]`, error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const section = this.props.section || 'This page';

    return (
      <div style={{
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
          Something unexpected happened. Your data is safe — this is just a display error.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={this.handleReset}
            style={{
              padding: '10px 20px', borderRadius: 'var(--radius-md)',
              background: 'var(--accent)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              fontFamily: 'var(--font-sans)',
            }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '10px 20px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
            }}
          >
            Go to Dashboard
          </button>
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
