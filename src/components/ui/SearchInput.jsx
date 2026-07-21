/**
 * ════════════════════════════════════════════════
 * FILE: SearchInput.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The standard search box — a magnifying-glass icon, a text field, and a little
 *   ✕ to clear it once you've typed. It's a controlled input: you give it the
 *   current text and a function to call when it changes, and it handles the icon,
 *   padding, and clear button so every search bar in the app looks and behaves the
 *   same.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  list/filter bars across the app (import from '@/components/ui')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  IconSearch (@/components/Icons); styles in src/index.css (.ui-search, .input)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Controlled: pass `value` + `onChange(nextString)` (onChange gets the STRING,
 *     not the event). The clear button calls onChange('').
 *   - Reuses the shared `.input` class (so the iOS 16px-font zoom guard applies) —
 *     don't set a smaller font-size.
 *   - `aria-label` defaults to the placeholder so the field is always named.
 * ════════════════════════════════════════════════
 */

import { IconSearch } from '@/components/Icons';

export default function SearchInput({
  value = '',
  onChange,
  placeholder = 'Search…',
  onClear,
  className = '',
  inputClassName = '',
  ...rest
}) {
  const handleClear = () => {
    onClear ? onClear() : onChange?.('');
  };
  return (
    <div className={`ui-search${className ? ' ' + className : ''}`}>
      <span className="ui-search-icon" aria-hidden="true">
        <IconSearch style={{ width: 15, height: 15 }} />
      </span>
      <input
        type="search"
        className={`input ui-search-input${inputClassName ? ' ' + inputClassName : ''}`}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        aria-label={rest['aria-label'] || placeholder}
        {...rest}
      />
      {value && (
        <button type="button" className="ui-search-clear" aria-label="Clear search" onClick={handleClear}>
          ✕
        </button>
      )}
    </div>
  );
}
