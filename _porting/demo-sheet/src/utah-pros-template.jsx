import { useState } from "react";

// ── Theme ─────────────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg:         "#0b0f14",
    card:       "#141920",
    cardAlt:    "#1a2030",
    border:     "#252d3a",
    text:       "#dde4f0",
    muted:      "#5a6a80",
    accent:     "#e07b20",
    accentDim:  "#e07b2015",
    green:      "#2ea043",
    greenDim:   "#2ea04315",
    red:        "#e74c3c",
    redDim:     "#e74c3c15",
    input:      "#0b0f14",
    headerBg:   "#080c10",
  },
  light: {
    bg:         "#f0f2f5",
    card:       "#ffffff",
    cardAlt:    "#f7f8fa",
    border:     "#dde2ea",
    text:       "#1a2030",
    muted:      "#7a8a9a",
    accent:     "#e07b20",
    accentDim:  "#e07b2015",
    green:      "#1a7a34",
    greenDim:   "#1a7a3415",
    red:        "#c0392b",
    redDim:     "#c0392b15",
    input:      "#ffffff",
    headerBg:   "#ffffff",
  },
};

// ── Base Styles (functions so they pick up theme) ─────────────────────────────
const mkStyles = (C) => ({
  label: {
    fontSize: 10, color: C.muted, textTransform: "uppercase",
    letterSpacing: "0.1em", fontWeight: 700, marginBottom: 5, display: "block",
  },
  input: {
    background: C.input, border: `1.5px solid ${C.border}`, borderRadius: 8,
    color: C.text, fontSize: 16, padding: "12px 13px", width: "100%",
    outline: "none", WebkitAppearance: "none", boxSizing: "border-box",
  },
  card: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: "16px 14px", marginBottom: 12,
  },
  textarea: {
    background: C.input, border: `1.5px solid ${C.border}`, borderRadius: 8,
    color: C.text, fontSize: 15, padding: "12px 13px", width: "100%",
    outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5,
  },
});

// ── Stepper ───────────────────────────────────────────────────────────────────
// Use for: numeric inputs (LF, SF, hours, quantities)
function Stepper({ value, onChange, step = 1, unit, small, C }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const sz = small ? 42 : 50;
  const start = () => { setRaw(value === 0 ? "" : String(value)); setEditing(true); };
  const finish = () => { const p = parseFloat(raw); onChange(isNaN(p) || p < 0 ? 0 : p); setEditing(false); };
  return (
    <div style={{ display: "flex", alignItems: "center", borderRadius: 8, overflow: "hidden", border: `1.5px solid ${C.border}`, background: C.input }}>
      <button onClick={() => onChange(Math.max(0, value - step))} style={{ width: sz, height: sz, background: "transparent", border: "none", color: C.muted, fontSize: small ? 20 : 22, cursor: "pointer", flexShrink: 0 }}>−</button>
      <div style={{ flex: 1, textAlign: "center" }}>
        {editing
          ? <input ref={el => el?.select()} type="number" inputMode="decimal" value={raw} onChange={e => setRaw(e.target.value)} onBlur={finish} onKeyDown={e => e.key === "Enter" && finish()} style={{ background: "transparent", border: "none", color: C.text, fontSize: small ? 15 : 17, fontWeight: 700, width: "100%", textAlign: "center", outline: "none" }} autoFocus />
          : <div onClick={start} style={{ fontSize: small ? 15 : 17, fontWeight: 700, color: value > 0 ? C.text : C.muted, padding: `${small ? 10 : 13}px 0`, cursor: "pointer", userSelect: "none" }}>
              {value > 0 ? value.toLocaleString() : "0"}{unit && <span style={{ fontSize: 10, color: C.muted, fontWeight: 400, marginLeft: 3 }}>{unit}</span>}
            </div>}
      </div>
      <button onClick={() => onChange(value + step)} style={{ width: sz, height: sz, background: "transparent", border: "none", color: C.accent, fontSize: small ? 20 : 22, cursor: "pointer", flexShrink: 0 }}>+</button>
    </div>
  );
}

// ── Chip ──────────────────────────────────────────────────────────────────────
// Use for: single or multi select options
function Chip({ label, selected, onToggle, C }) {
  return (
    <button onClick={onToggle} style={{ background: selected ? C.accentDim : C.input, border: `1.5px solid ${selected ? C.accent : C.border}`, borderRadius: 8, color: selected ? C.accent : C.muted, fontSize: 12, fontWeight: selected ? 700 : 400, padding: "10px 6px", cursor: "pointer", textAlign: "center", transition: "all 0.1s" }}>
      {label}
    </button>
  );
}

// SingleChips — one selection at a time
function SingleChips({ options, value, onChange, cols = 2, C }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap: 6 }}>
      {options.map(o => <Chip key={o} label={o} selected={value === o} onToggle={() => onChange(value === o ? "" : o)} C={C} />)}
    </div>
  );
}

// MultiChips — multiple selections
function MultiChips({ options, selected, onChange, C }) {
  const toggle = o => onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {options.map(o => <Chip key={o} label={o} selected={selected.includes(o)} onToggle={() => toggle(o)} C={C} />)}
    </div>
  );
}

// ── CheckRow ──────────────────────────────────────────────────────────────────
// Use for: boolean toggles (Yes/No checkboxes)
function CheckRow({ label, checked, onChange, C }) {
  return (
    <button onClick={() => onChange(!checked)} style={{ display: "flex", alignItems: "center", gap: 10, background: checked ? C.accentDim : C.input, border: `1.5px solid ${checked ? C.accent : C.border}`, borderRadius: 8, padding: "12px 13px", cursor: "pointer", width: "100%", marginBottom: 6 }}>
      <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${checked ? C.accent : C.border}`, background: checked ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {checked && <span style={{ color: "#000", fontSize: 12, fontWeight: 800 }}>✓</span>}
      </div>
      <span style={{ fontSize: 14, color: checked ? C.accent : C.muted, fontWeight: checked ? 700 : 400 }}>{label}</span>
    </button>
  );
}

// ── YesNo ─────────────────────────────────────────────────────────────────────
// Use for: binary gate questions (flood cuts? insulation? etc.)
function YesNo({ onNo, onYes, C }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingTop: 12 }}>
      <button onClick={onNo} style={{ background: C.redDim, border: `1.5px solid ${C.red}55`, borderRadius: 8, color: C.red, fontSize: 15, fontWeight: 700, padding: "14px", cursor: "pointer" }}>✗ No</button>
      <button onClick={onYes} style={{ background: C.accentDim, border: `1.5px solid ${C.accent}`, borderRadius: 8, color: C.accent, fontSize: 15, fontWeight: 700, padding: "14px", cursor: "pointer" }}>✓ Yes</button>
    </div>
  );
}

// ── Section Accordion ─────────────────────────────────────────────────────────
// Use for: collapsible form sections with status indicators
function Section({ icon, label, status, open, onToggle, locked, children, C }) {
  let borderColor = C.border, headerBg = C.card;
  if (status === "done-yes") { borderColor = C.green + "55"; headerBg = C.greenDim; }
  if (open) { borderColor = C.accent; headerBg = C.accentDim; }
  return (
    <div style={{ border: `1.5px solid ${borderColor}`, borderRadius: 10, marginBottom: 8, overflow: "hidden", opacity: locked ? 0.38 : 1, transition: "opacity 0.2s,border-color 0.2s" }}>
      <button onClick={() => !locked && onToggle()} disabled={locked} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: headerBg, border: "none", padding: "13px 14px", cursor: locked ? "default" : "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: locked ? C.muted : C.text }}>{label}</span>
        {status === "done-no"  && <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, background: C.cardAlt, padding: "3px 8px", borderRadius: 20 }}>N/A</span>}
        {status === "done-yes" && <span style={{ fontSize: 11, color: C.green, fontWeight: 700, background: C.greenDim, padding: "3px 8px", borderRadius: 20 }}>✓ Done</span>}
        {!locked && <span style={{ fontSize: 11, color: open ? C.accent : C.muted, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>}
      </button>
      {open && <div style={{ padding: "0 14px 14px", background: C.card }}>{children}</div>}
    </div>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────
// Primary CTA — orange, full width
function PrimaryBtn({ label, onClick, disabled, C }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: "100%", background: disabled ? C.muted : C.accent, border: "none", borderRadius: 8, color: "#000", fontSize: 14, fontWeight: 800, padding: "13px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      {label}
    </button>
  );
}

// Next/Done button — advances to next section
function NextBtn({ onClick, label = "Done → Next", C }) {
  return (
    <button onClick={onClick} style={{ width: "100%", marginTop: 14, background: C.accent, border: "none", borderRadius: 8, color: "#000", fontSize: 14, fontWeight: 800, padding: "13px", cursor: "pointer" }}>
      {label} →
    </button>
  );
}

// Add button — dashed, for adding list items
function AddBtn({ label, onClick, C }) {
  return (
    <button onClick={onClick} style={{ width: "100%", background: "transparent", border: `1.5px dashed ${C.border}`, borderRadius: 8, color: C.muted, padding: "10px", fontSize: 13, cursor: "pointer", marginTop: 4 }}>
      + {label}
    </button>
  );
}

// Change/reset button — small, for undoing a gate answer
function ChangeBtn({ onClick, C }) {
  return (
    <button onClick={onClick} style={{ fontSize: 11, color: C.muted, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", marginBottom: 10 }}>
      ↩ Change answer
    </button>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
// Use for: showing completion % of a multi-step form
function ProgressBar({ value, total, C }) {
  const pct = Math.round((value / total) * 100);
  const color = pct === 100 ? C.green : pct > 50 ? C.accent : C.muted;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 700, flexShrink: 0, minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────
// Use for: showing success/error/info states
function StatusBadge({ type, message, C }) {
  const styles = {
    success: { bg: C.greenDim, border: C.green, color: C.green },
    error:   { bg: C.redDim,   border: C.red,   color: C.red   },
    info:    { bg: C.accentDim,border: C.accent, color: C.accent},
  };
  const s = styles[type] || styles.info;
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: "9px 12px", marginBottom: 9, color: s.color, fontSize: 13, fontWeight: 700, textAlign: "center" }}>
      {message}
    </div>
  );
}

// ── Theme Toggle ──────────────────────────────────────────────────────────────
function ThemeToggle({ theme, onToggle, C }) {
  return (
    <button onClick={onToggle} style={{ background: C.cardAlt, border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 16, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

// ── Page Header ───────────────────────────────────────────────────────────────
// Sticky top bar — paste into every tool
function PageHeader({ title, subtitle, right, theme, onThemeToggle, C }) {
  return (
    <div style={{ background: C.headerBg, borderBottom: `1px solid ${C.border}`, padding: "14px 16px 12px", position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9, color: C.accent, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 1 }}>Utah Pros Restoration</div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: C.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{subtitle}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {right}
          <ThemeToggle theme={theme} onToggle={onThemeToggle} C={C} />
        </div>
      </div>
    </div>
  );
}

// ── Bottom Action Bar ─────────────────────────────────────────────────────────
// Fixed footer — paste into every tool
function BottomBar({ children, C }) {
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.headerBg, borderTop: `1px solid ${C.border}`, padding: "11px 13px 15px", zIndex: 30 }}>
      {children}
    </div>
  );
}

// ── Section Label ─────────────────────────────────────────────────────────────
// Orange uppercase label for grouping fields inside a card
function SectionLabel({ label, C }) {
  return (
    <div style={{ fontSize: 9, color: C.accent, textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 800, marginBottom: 14 }}>
      {label}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── TEMPLATE APP — shows all components in action ────────────────────────────
// Delete everything below this line and replace with your tool
// ─────────────────────────────────────────────────────────────────────────────
export default function UtahProsTemplate() {
  const [theme, setTheme] = useState("dark");
  const C = THEMES[theme];
  const S = mkStyles(C);

  // Example state — replace with your tool's state
  const [stepperVal, setStepperVal] = useState(0);
  const [singleVal, setSingleVal] = useState("");
  const [multiVal, setMultiVal] = useState([]);
  const [checked, setChecked] = useState(false);
  const [yesNo, setYesNo] = useState(null);
  const [openSection, setOpenSection] = useState("basics");
  const [progress] = useState(3);

  const SAMPLE_OPTIONS = ["Option A", "Option B", "Option C", "Option D"];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, paddingBottom: 130 }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, select, textarea { -webkit-appearance: none; appearance: none; }
        input:focus, select:focus, textarea:focus { border-color: #e07b20 !important; outline: none; }
        button:active { opacity: 0.7; transform: scale(0.97); }
        select option { background: ${C.card}; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
      `}</style>

      {/* ── Header ── */}
      <PageHeader
        title="Tool Name"
        subtitle="Short description"
        theme={theme}
        onThemeToggle={() => setTheme(t => t === "dark" ? "light" : "dark")}
        C={C}
        right={
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.muted }}>Progress</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.accent }}>{progress}<span style={{ fontSize: 12, color: C.muted, fontWeight: 400 }}>/5</span></div>
          </div>
        }
      />

      <div style={{ padding: "14px 13px 0" }}>

        {/* ── Card with fields ── */}
        <div style={S.card}>
          <SectionLabel label="Job Info" C={C} />

          <label style={S.label}>Text Input</label>
          <input placeholder="Type something…" style={{ ...S.input, marginBottom: 12 }} />

          <label style={S.label}>Date Input</label>
          <input type="date" style={{ ...S.input, marginBottom: 12 }} />

          <label style={S.label}>Select / Dropdown</label>
          <select style={{ ...S.input, marginBottom: 12 }}>
            <option value="">— Choose —</option>
            <option>Choice 1</option>
            <option>Choice 2</option>
          </select>

          <label style={S.label}>Textarea</label>
          <textarea rows={3} placeholder="Notes…" style={{ ...S.textarea, marginBottom: 12 }} />
        </div>

        {/* ── Stepper ── */}
        <div style={S.card}>
          <SectionLabel label="Numeric Inputs" C={C} />
          <label style={S.label}>Stepper (LF)</label>
          <Stepper value={stepperVal} onChange={setStepperVal} step={1} unit="LF" C={C} />
          <div style={{ height: 10 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={S.label}>Small Stepper</label>
              <Stepper value={stepperVal} onChange={setStepperVal} step={0.5} unit="hrs" small C={C} />
            </div>
            <div>
              <label style={S.label}>Small Stepper</label>
              <Stepper value={stepperVal} onChange={setStepperVal} step={1} unit="ea" small C={C} />
            </div>
          </div>
        </div>

        {/* ── Chips ── */}
        <div style={S.card}>
          <SectionLabel label="Chip Selectors" C={C} />
          <label style={S.label}>Single Select</label>
          <SingleChips options={SAMPLE_OPTIONS} value={singleVal} onChange={setSingleVal} C={C} />
          <div style={{ height: 12 }} />
          <label style={S.label}>Multi Select</label>
          <MultiChips options={SAMPLE_OPTIONS} selected={multiVal} onChange={setMultiVal} C={C} />
        </div>

        {/* ── CheckRow ── */}
        <div style={S.card}>
          <SectionLabel label="Checkboxes" C={C} />
          <CheckRow label="Toggle this option" checked={checked} onChange={setChecked} C={C} />
          <CheckRow label="Another option" checked={false} onChange={() => {}} C={C} />
        </div>

        {/* ── Yes/No gate ── */}
        <div style={S.card}>
          <SectionLabel label="Yes / No Gate" C={C} />
          <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 4 }}>Was this step completed?</div>
          {yesNo === null && <YesNo onNo={() => setYesNo(false)} onYes={() => setYesNo(true)} C={C} />}
          {yesNo !== null && (
            <>
              <ChangeBtn onClick={() => setYesNo(null)} C={C} />
              <div style={{ fontSize: 13, color: yesNo ? C.green : C.muted, fontWeight: 700 }}>
                {yesNo ? "✓ Yes — show follow-up fields here" : "✗ No — skipped"}
              </div>
            </>
          )}
        </div>

        {/* ── Progress bar ── */}
        <div style={S.card}>
          <SectionLabel label="Progress Bar" C={C} />
          <ProgressBar value={3} total={5} C={C} />
          <ProgressBar value={5} total={5} C={C} />
          <ProgressBar value={1} total={5} C={C} />
        </div>

        {/* ── Status badges ── */}
        <div style={S.card}>
          <SectionLabel label="Status Badges" C={C} />
          <StatusBadge type="success" message="✓ Successfully submitted" C={C} />
          <StatusBadge type="error" message="✗ Something went wrong — try again" C={C} />
          <StatusBadge type="info" message="ℹ Pending confirmation" C={C} />
        </div>

        {/* ── Section accordions ── */}
        <div style={S.card}>
          <SectionLabel label="Section Accordions" C={C} />
          <ProgressBar value={1} total={3} C={C} />
          {[
            { key: "basics", icon: "📋", label: "Basic Info", status: "done-yes" },
            { key: "details", icon: "🔧", label: "Details", status: null },
            { key: "notes", icon: "📝", label: "Notes", status: "done-no" },
          ].map(sec => (
            <Section key={sec.key} icon={sec.icon} label={sec.label} status={sec.status} open={openSection === sec.key} onToggle={() => setOpenSection(openSection === sec.key ? null : sec.key)} locked={false} C={C}>
              <div style={{ height: 12 }} />
              <label style={S.label}>Field inside section</label>
              <input placeholder="Enter value…" style={S.input} />
              <NextBtn onClick={() => setOpenSection("notes")} label="Save & Continue" C={C} />
            </Section>
          ))}
          <AddBtn label="Add another item" onClick={() => {}} C={C} />
        </div>

        {/* ── Tech selector (3-col chip grid) ── */}
        <div style={S.card}>
          <SectionLabel label="Technician Selector" C={C} />
          <label style={S.label}>Technician</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7 }}>
            {["Matheus","Nano","Juani","Ben","Moroni","Marcelo"].map(name => (
              <button key={name} onClick={() => setSingleVal(singleVal === name ? "" : name)} style={{ background: singleVal === name ? C.accentDim : C.input, border: `1.5px solid ${singleVal === name ? C.accent : C.border}`, borderRadius: 8, color: singleVal === name ? C.accent : C.muted, fontSize: 13, fontWeight: singleVal === name ? 700 : 400, padding: "13px 4px", cursor: "pointer" }}>
                {name}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* ── Bottom Bar ── */}
      <BottomBar C={C}>
        <div style={{ display: "flex", gap: 9 }}>
          <button style={{ flex: 1, background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 600, padding: "14px", cursor: "pointer" }}>
            Secondary
          </button>
          <PrimaryBtn label="✓ Submit" onClick={() => {}} C={C} />
        </div>
      </BottomBar>
    </div>
  );
}
