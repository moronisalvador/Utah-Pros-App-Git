import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { realtimeClient } from '@/lib/realtime';
import { db } from '@/lib/supabase';

export default function Login() {
  const { login, devLogin, isAuthenticated, isDev, error: authError } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Dev mode: list employees for quick select
  const [employees, setEmployees] = useState([]);
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (isDev) {
      db.select('employees', 'select=id,full_name,email,role&order=full_name.asc')
        .then(setEmployees)
        .catch(() => {});
    }
  }, [isDev]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Enter your email address above first.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { error: resetErr } = await realtimeClient.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: window.location.origin + '/set-password' }
      );
      if (resetErr) throw resetErr;
      setResetSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async (emp) => {
    setLoading(true);
    try {
      await devLogin(emp.email);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">U</div>
          <span className="login-logo-text">UPR Platform</span>
        </div>

        {(error || authError) && (
          <div className="login-error">{error || authError}</div>
        )}

        {/* ── Dev mode: quick employee selector ── */}
        {isDev && devMode && (
          <div>
            <p style={{ fontSize: 13, color: '#5f6672', marginBottom: 12 }}>
              Dev Mode — Select an employee:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {employees.map(emp => (
                <button
                  key={emp.id}
                  className="btn btn-secondary"
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => handleDevLogin(emp)}
                  disabled={loading}
                >
                  <span style={{ fontWeight: 600 }}>{emp.full_name}</span>
                  <span style={{ color: '#8b929e', marginLeft: 'auto', fontSize: 11 }}>{emp.role}</span>
                </button>
              ))}
              {employees.length === 0 && (
                <p style={{ fontSize: 13, color: '#8b929e' }}>
                  No employees found. Check Supabase connection.
                </p>
              )}
            </div>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => setDevMode(false)}
            >
              Use email login instead
            </button>
          </div>
        )}

        {/* ── Forgot password: reset sent confirmation ── */}
        {resetSent && (
          <div>
            <div className="login-reset-sent">
              <span style={{ fontSize: 24 }}>✉️</span>
              <p style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginTop: 'var(--space-3)' }}>
                Check your email
              </p>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
                We sent a password reset link to <strong>{email}</strong>. Click the link in the email to set a new password.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 'var(--space-4)' }}
              onClick={() => { setResetSent(false); setForgotMode(false); }}
            >
              Back to Sign In
            </button>
          </div>
        )}

        {/* ── Forgot password form ── */}
        {forgotMode && !resetSent && (!isDev || !devMode) && (
          <form onSubmit={handleForgotPassword}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              Enter your email and we'll send you a link to reset your password.
            </p>
            <div className="form-group">
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@utahpros.com"
                required
                autoComplete="email"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              disabled={loading || !email.trim()}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 'var(--space-3)' }}
              onClick={() => { setForgotMode(false); setError(''); }}
            >
              Back to Sign In
            </button>
          </form>
        )}

        {/* ── Standard email/password login ── */}
        {!forgotMode && !resetSent && (!isDev || !devMode) && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@utahpros.com"
                required
                autoComplete="email"
              />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <button
              type="button"
              className="login-forgot-link"
              onClick={() => { setForgotMode(true); setError(''); }}
            >
              Forgot password?
            </button>

            {isDev && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%', marginTop: 'var(--space-2)' }}
                onClick={() => setDevMode(true)}
              >
                Dev Mode: Select Employee
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
