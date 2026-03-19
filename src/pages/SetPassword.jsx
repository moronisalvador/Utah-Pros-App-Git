import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { realtimeClient } from '@/lib/realtime';

export default function SetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Check URL hash for recovery token (backup for race condition)
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setRecovery(true);
      setChecking(false);
    }

    // Listen for PASSWORD_RECOVERY event from Supabase
    const { data: { subscription } } = realtimeClient.auth.onAuthStateChange(
      (event) => {
        if (event === 'PASSWORD_RECOVERY') {
          setRecovery(true);
          setChecking(false);
        }
      }
    );

    // Fallback timeout — if no recovery event after 4s, show invalid state
    const timeout = setTimeout(() => {
      setChecking(prev => {
        // Only set to false if still checking
        return false;
      });
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async () => {
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await realtimeClient.auth.updateUser({
        password: password,
      });
      if (updateErr) throw updateErr;

      setSuccess(true);
      // Already has a valid session — redirect to dashboard
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && password && confirm && !loading) {
      handleSubmit();
    }
  };

  // ── Loading: verifying recovery token ──
  if (checking) {
    return (
      <div className="set-pw-page">
        <div className="set-pw-card">
          <div className="set-pw-logo">U</div>
          <div className="set-pw-checking">Verifying your link…</div>
        </div>
      </div>
    );
  }

  // ── Invalid/expired link ──
  if (!recovery) {
    return (
      <div className="set-pw-page">
        <div className="set-pw-card">
          <div className="set-pw-logo">U</div>
          <h2 className="set-pw-title">Invalid or Expired Link</h2>
          <p className="set-pw-subtitle">
            This link may have expired or already been used. Contact your administrator for a new one.
          </p>
          <button
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: 'var(--space-4)' }}
            onClick={() => navigate('/login')}
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  // ── Success ──
  if (success) {
    return (
      <div className="set-pw-page">
        <div className="set-pw-card">
          <div className="set-pw-logo">U</div>
          <h2 className="set-pw-title">Password Set!</h2>
          <p className="set-pw-subtitle">
            You're all set. Redirecting to the platform…
          </p>
        </div>
      </div>
    );
  }

  // ── Set password form ──
  return (
    <div className="set-pw-page">
      <div className="set-pw-card">
        <div className="set-pw-logo">U</div>
        <h2 className="set-pw-title">Welcome to UPR Platform</h2>
        <p className="set-pw-subtitle">Set your password to get started.</p>

        {error && <div className="set-pw-error">{error}</div>}

        <div className="set-pw-field">
          <label className="label">New Password</label>
          <div className="admin-password-wrap">
            <input
              className="input admin-password-input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Min 6 characters"
              autoComplete="new-password"
              autoFocus
            />
            <button
              type="button"
              className="admin-password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="set-pw-field">
          <label className="label">Confirm Password</label>
          <input
            className="input"
            type={showPassword ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Re-enter password"
            autoComplete="new-password"
          />
        </div>

        {password && confirm && password === confirm && (
          <div className="set-pw-match">Passwords match</div>
        )}
        {password && confirm && password !== confirm && (
          <div className="set-pw-mismatch">Passwords don't match</div>
        )}

        <button
          className="btn btn-primary btn-lg"
          style={{ width: '100%', marginTop: 'var(--space-4)' }}
          onClick={handleSubmit}
          disabled={loading || !password || !confirm}
        >
          {loading ? 'Setting Password…' : 'Set Password & Continue'}
        </button>
      </div>
    </div>
  );
}
