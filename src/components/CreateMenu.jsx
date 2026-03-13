import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const CREATE_OPTIONS = [
  {
    key: 'job',
    label: 'New Job',
    emoji: '🔧',
    description: 'Create a new job',
  },
  {
    key: 'estimate',
    label: 'New Estimate',
    emoji: '📋',
    description: 'Write a new estimate',
  },
  {
    key: 'customer',
    label: 'New Customer',
    emoji: '👤',
    description: 'Add a new customer',
  },
];

export default function CreateMenu({ onAction }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleSelect = (key) => {
    setOpen(false);
    if (onAction) {
      onAction(key);
    } else {
      // Default navigation
      switch (key) {
        case 'job': navigate('/jobs/new'); break;
        case 'estimate': navigate('/estimates/new'); break;
        case 'customer': navigate('/customers/new'); break;
      }
    }
  };

  return (
    <div className="create-menu-container" ref={menuRef}>
      {/* Popup menu */}
      {open && (
        <>
          <div className="create-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="create-menu-popup">
            <div className="create-menu-header">Create New</div>
            {CREATE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className="create-menu-item"
                onClick={() => handleSelect(opt.key)}
              >
                <span className="create-menu-item-emoji">{opt.emoji}</span>
                <div className="create-menu-item-text">
                  <span className="create-menu-item-label">{opt.label}</span>
                  <span className="create-menu-item-desc">{opt.description}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* FAB button */}
      <button
        className={`create-menu-fab${open ? ' active' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label="Create new"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="create-menu-fab-icon">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
