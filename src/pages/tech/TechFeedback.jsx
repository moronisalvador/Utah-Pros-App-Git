import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';

const MAX_PHOTOS = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const inputStyle = {
  width: '100%', height: 48, padding: '0 14px',
  fontSize: 16, borderRadius: 'var(--tech-radius-button)',
  border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'var(--font-sans)',
};

const labelStyle = {
  fontSize: 'var(--tech-text-label)', fontWeight: 600, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6,
};

export default function TechFeedback() {
  const navigate = useNavigate();
  const { employee, db } = useAuth();
  const fileRef = useRef(null);

  const [type, setType] = useState(null);       // 'bug' | 'feature'
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState([]);      // [{ path, url, uploading }]
  const [submitting, setSubmitting] = useState(false);

  /* ── Photo capture ── */
  const handleAddPhoto = () => {
    if (photos.length >= MAX_PHOTOS) {
      toast(`Maximum ${MAX_PHOTOS} screenshots`, 'warning');
      return;
    }
    fileRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > MAX_FILE_SIZE) {
      toast('Photo is too large (max 10 MB)', 'error');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast('Only image files are allowed', 'error');
      return;
    }

    // Create a local preview URL
    const previewUrl = URL.createObjectURL(file);
    const idx = photos.length;
    setPhotos(prev => [...prev, { path: null, url: previewUrl, uploading: true }]);

    try {
      const ts = Date.now();
      const storagePath = `feedback/${employee.id}/${ts}-${file.name}`;
      const res = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${storagePath}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${db.apiKey}`, 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error('Upload failed');

      setPhotos(prev => prev.map((p, i) =>
        i === idx ? { ...p, path: `job-files/${storagePath}`, uploading: false } : p
      ));
      toast('Screenshot added');
    } catch (err) {
      toast('Upload failed: ' + err.message, 'error');
      setPhotos(prev => prev.filter((_, i) => i !== idx));
      URL.revokeObjectURL(previewUrl);
    }
  };

  const removePhoto = (idx) => {
    setPhotos(prev => {
      const removed = prev[idx];
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  /* ── Submit ── */
  const canSubmit = type && title.trim().length >= 3 && !submitting && !photos.some(p => p.uploading);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const screenshotPaths = photos.filter(p => p.path).map(p => p.path);
      await db.rpc('insert_tech_feedback', {
        p_employee_id: employee.id,
        p_type: type,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_screenshots: JSON.stringify(screenshotPaths),
      });
      toast('Feedback submitted — thank you!');
      navigate('/tech');
    } catch (err) {
      toast('Failed to submit: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="tech-page" style={{ padding: 'var(--space-4)', paddingBottom: 'calc(var(--tech-nav-height) + 40px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => navigate('/tech')}
          style={{
            width: 40, height: 40, borderRadius: 'var(--tech-radius-button)',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0, touchAction: 'manipulation',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <div style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, color: 'var(--text-primary)' }}>
            Send Feedback
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Report a bug or request a feature
          </div>
        </div>
      </div>

      {/* Type selector — two big tap targets */}
      <div style={{ ...labelStyle, marginBottom: 10 }}>What type of feedback?</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => setType('bug')}
          style={{
            height: 80, borderRadius: 'var(--tech-radius-card)',
            border: `2px solid ${type === 'bug' ? '#dc2626' : 'var(--border-color)'}`,
            background: type === 'bug' ? '#fef2f2' : 'var(--bg-primary)',
            cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6,
            touchAction: 'manipulation', transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={type === 'bug' ? '#dc2626' : 'var(--text-tertiary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{
            fontSize: 15, fontWeight: 700,
            color: type === 'bug' ? '#dc2626' : 'var(--text-secondary)',
          }}>
            Bug Report
          </span>
        </button>

        <button
          onClick={() => setType('feature')}
          style={{
            height: 80, borderRadius: 'var(--tech-radius-card)',
            border: `2px solid ${type === 'feature' ? '#2563eb' : 'var(--border-color)'}`,
            background: type === 'feature' ? '#eff6ff' : 'var(--bg-primary)',
            cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6,
            touchAction: 'manipulation', transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={type === 'feature' ? '#2563eb' : 'var(--text-tertiary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span style={{
            fontSize: 15, fontWeight: 700,
            color: type === 'feature' ? '#2563eb' : 'var(--text-secondary)',
          }}>
            Feature Request
          </span>
        </button>
      </div>

      {/* Title */}
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>
          {type === 'bug' ? "What's the problem?" : type === 'feature' ? "What would you like?" : "Short title"}
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={type === 'bug' ? 'e.g. Photos not saving' : type === 'feature' ? 'e.g. Add dark mode' : 'Give it a short title'}
          maxLength={120}
          style={inputStyle}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Details (optional)</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={type === 'bug' ? 'What happened? What did you expect?' : 'Any extra details...'}
          maxLength={2000}
          rows={4}
          style={{
            ...inputStyle,
            height: 'auto', padding: '12px 14px',
            resize: 'vertical', minHeight: 100,
            lineHeight: 1.5,
          }}
        />
      </div>

      {/* Screenshots */}
      <div style={{ marginBottom: 28 }}>
        <label style={labelStyle}>Screenshots (optional)</label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {photos.map((photo, idx) => (
            <div key={idx} style={{
              position: 'relative', width: 88, height: 88,
              borderRadius: 'var(--radius-lg)', overflow: 'hidden',
              border: '1px solid var(--border-color)',
            }}>
              <img
                src={photo.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {photo.uploading && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.4)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{
                    width: 24, height: 24, border: '3px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff', borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                </div>
              )}
              {!photo.uploading && (
                <button
                  onClick={() => removePhoto(idx)}
                  style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)', color: '#fff',
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, lineHeight: 1, touchAction: 'manipulation',
                  }}
                >
                  {'\u2715'}
                </button>
              )}
            </div>
          ))}

          {photos.length < MAX_PHOTOS && (
            <button
              onClick={handleAddPhoto}
              style={{
                width: 88, height: 88, borderRadius: 'var(--radius-lg)',
                border: '2px dashed var(--border-color)', background: 'var(--bg-secondary)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                touchAction: 'manipulation',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Add</span>
            </button>
          )}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          width: '100%', height: 56, borderRadius: 'var(--tech-radius-button)',
          background: canSubmit ? 'var(--accent)' : 'var(--bg-tertiary)',
          color: canSubmit ? '#fff' : 'var(--text-tertiary)',
          border: 'none', fontSize: 17, fontWeight: 700,
          cursor: canSubmit ? 'pointer' : 'default',
          fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {submitting ? 'Sending...' : 'Submit Feedback'}
      </button>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
