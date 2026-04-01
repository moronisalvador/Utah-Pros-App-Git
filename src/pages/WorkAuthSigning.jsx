import { useState, useRef, useEffect, useCallback } from "react";
import { Check, ChevronDown, ChevronUp, AlertCircle, FileText, Shield, Droplets, Pen, X } from "lucide-react";

// ─── Sample data (your system replaces this from Supabase) ─────────
const SAMPLE_CLAIM = {
  homeowner_name: "John & Maria Thompson",
  co_owner_name: "",
  service_address: "1847 Maple Ridge Drive",
  city: "Orem",
  state: "UT",
  zip: "84057",
  phone: "(385) 555-0142",
  email: "thompson.john84@gmail.com",
  insurance_company: "State Farm",
  claim_number: "4521-FL-2026-08841",
  date_of_loss: "03/28/2026",
  company_rep: "Utah Pros Restoration",
  document_id: "WA-2026-00347",
};

// ─── Signature Pad Component ───────────────────────────────────────
function SignaturePad({ onSignatureChange }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const lastPoint = useRef(null);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2;
  }, []);

  useEffect(() => {
    setupCanvas();
    window.addEventListener("resize", setupCanvas);
    return () => window.removeEventListener("resize", setupCanvas);
  }, [setupCanvas]);

  const getPoint = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    lastPoint.current = getPoint(e);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const point = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint.current = point;
    if (!hasSignature) setHasSignature(true);
  };

  const stopDrawing = (e) => {
    if (e) e.preventDefault();
    if (isDrawing && hasSignature) {
      onSignatureChange(canvasRef.current.toDataURL("image/png"));
    }
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onSignatureChange(null);
    setupCanvas();
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl bg-white cursor-crosshair touch-none"
        style={{ height: 160 }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      {!hasSignature && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-gray-400">
            <Pen size={18} />
            <span className="text-sm">Sign here</span>
          </div>
        </div>
      )}
      {hasSignature && (
        <button
          onClick={clearSignature}
          className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow-md border border-gray-200 text-gray-500 hover:text-red-500 transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ─── Expandable Section ────────────────────────────────────────────
function Expandable({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">{icon}</div>
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
        </div>
        {open ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ─── Info Row ──────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-medium text-gray-800 text-right max-w-[60%]">{value}</span>
    </div>
  );
}

// ─── Checkbox ──────────────────────────────────────────────────────
function ConsentCheck({ checked, onChange, children }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-2">
      <div
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${ checked ? "bg-amber-500 border-amber-500" : "border-gray-300 bg-white" }`}
        onClick={() => onChange(!checked)}
      >
        {checked && <Check size={13} className="text-white" strokeWidth={3} />}
      </div>
      <span className="text-sm text-gray-700 leading-relaxed">{children}</span>
    </label>
  );
}

// ─── Auth Item ─────────────────────────────────────────────────────
function AuthItem({ text }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
        <Check size={10} className="text-emerald-600" strokeWidth={3} />
      </div>
      <span className="text-sm text-gray-700 leading-relaxed">{text}</span>
    </div>
  );
}

// ─── T&C Content ───────────────────────────────────────────────────
function TermsContent() {
  const s = "text-sm text-gray-600 leading-relaxed mb-3";
  const h = "text-sm font-bold text-gray-800 mt-4 mb-1.5 pb-1 border-b border-amber-200";
  return (
    <div className="mt-3">
      <p className={h}>1. Scope of Work</p>
      <p className={s}>Company will perform water damage mitigation including inspection, demolition of non-salvageable materials, cleaning, disinfecting, deodorizing, antimicrobial treatment, drying equipment installation and monitoring, and content manipulation as needed. Work is performed per IICRC S500 (Water Damage), S520 (Mold Remediation), and S700 (Contents Restoration) as applicable. Company determines salvageability in its professional judgment consistent with these standards.</p>
      <p className={s}>The final scope and cost will be documented in a Xactimate estimate prepared after mitigation is substantially complete. That estimate and any approved supplements become part of this Agreement by reference. Reconstruction, if needed, will be addressed under a separate agreement.</p>

      <p className={h}>2. Chemical Use & Safety</p>
      <p className={s}>Company uses EPA-registered antimicrobial agents, disinfectants, and deodorizing compounds per IICRC standards. Homeowner must notify Company of any chemical sensitivities, allergies, or health conditions affecting occupants. If Company recommends vacating during application, Homeowner agrees to comply. Company cannot guarantee no occupant will experience sensitivity to products used.</p>

      <p className={h}>3. Hidden & Additional Damage</p>
      <p className={s}>It is often impossible to identify all damage until demolition is underway. Company will make reasonable efforts but does not guarantee discovery of all affected areas. If additional damage is found, Company will document it and prepare a supplemental estimate. Homeowner authorizes Company to submit supplements to the insurance carrier. Supplemental work requires authorization, except where delay would cause further damage, in which case Company may take reasonable protective measures.</p>

      <p className={h}>4. Liability Limitations</p>
      <p className={s}><strong>Company's total liability is limited to the amount charged for services performed. Company shall not be liable for indirect, incidental, special, punitive, or consequential damages,</strong> including loss of use, lost profits, mold growth after drying completion, damage to property outside the scope of work, or diminished property value. Water damage restoration involves inherent uncertainties and Company does not guarantee specific outcomes.</p>

      <p className={h}>5. Mold & Microbial Disclosure</p>
      <p className={s}>Water damage can cause mold growth within 24–48 hours. Antimicrobial treatments during mitigation do not guarantee mold prevention. If mold is discovered, Company will notify Homeowner and may recommend remediation under IICRC S520 as a separate scope with additional costs, containment, and possible third-party testing. Mold remediation is a separate service from water damage mitigation.</p>

      <p className={h}>6. Stop Work & Hold Harmless</p>
      <p className={s}>If Company is prevented from completing recommended procedures, or if drying equipment is removed, turned off, or interfered with by Homeowner, occupants, insurance carrier, or any third party, Homeowner agrees to release, hold harmless, and indemnify Company against all resulting claims and damages. This includes scope reductions or denials directed by insurance where Homeowner elects not to proceed at own expense.</p>

      <p className={h}>7. Drying Equipment & Responsibilities</p>
      <p className={s}>Air movers and dehumidifiers will be installed. Target humidity is 25–35%. Drying may take several days. Do not turn off, unplug, or move equipment without calling Company. Keep windows and doors closed unless directed otherwise. Keep children and pets away from equipment. Homeowner is responsible for loss, theft, or damage to equipment while at the property; replacement costs will be invoiced.</p>

      <p className={h}>8. Safety</p>
      <p className={s}>Floors may be slippery when wet. Exposed tack strip is sharp even when covered. Equipment must be shut off and unplugged before moving. Company is not responsible for injuries from failure to follow these precautions.</p>

      <p className={h}>9. Hazardous Materials</p>
      <p className={s}>If the property was built before 1978, work may disturb lead-based paint (EPA RRP Rule). If asbestos, lead, or other hazardous substances are discovered, Company may stop work until a safe protocol is established. Hazardous material handling costs are separate from the original scope.</p>

      <p className={h}>10. Payment Terms</p>
      <p className={s}>(a) Company prepares a Xactimate estimate after mitigation documenting all work, equipment, and materials. (b) Homeowner must ensure payment to Company within 15 days of insurance issuing the check or direct deposit. (c) Homeowner is responsible for the deductible, depreciation, and non-covered amounts. Deductible is due at start of work or upon invoicing at Company's discretion. (d) If insurance has not paid within 30 days of estimate submission, Homeowner accepts personal responsibility and must pay Company within 60 days of invoice regardless of insurance status. (e) Unpaid balances accrue interest at 1.5%/month (18% per annum). Company may recover all collection costs including attorney fees. (f) Non-insurance work: payment due within 15 days of invoice. Deposit or credit card authorization may be required.</p>

      <p className={h}>11. Direction to Pay</p>
      <p className={s}>Homeowner irrevocably directs their insurance company to issue all covered payments to Company at 1055 N State St, Orem, UT 84057. If a joint check is issued, Homeowner will endorse and deliver it within 5 business days. Homeowner shall not negotiate, deposit, or cash insurance proceeds related to this work without Company's written consent. This direction is irrevocable once work commences and remains effective until all amounts are paid.</p>

      <p className={h}>12. Lien Rights</p>
      <p className={s}>Under Utah Code §38-1a-101 et seq., Company has the right to file a mechanic's lien for unpaid amounts. Homeowner acknowledges these rights and authorizes Company to file a Preliminary Notice. Lien filing is a last resort and Company will communicate with Homeowner before doing so.</p>

      <p className={h}>13. Property Access & Documentation</p>
      <p className={s}>Homeowner authorizes Company and subcontractors to access the property for work, monitoring, and equipment retrieval. Homeowner is responsible for providing access. Homeowner consents to photographs, video, and moisture documentation, which may be shared with insurance carriers and subcontractors as needed.</p>

      <p className={h}>14. Warranty</p>
      <p className={s}>Company warrants workmanship consistent with IICRC standards for one (1) year from completion. This warranty does not cover pre-existing conditions, subsequent water intrusion, mold growth after drying, homeowner actions, or conditions outside Company's control. Defects must be reported in writing within 7 days of completion.</p>

      <p className={h}>15. Dispute Resolution</p>
      <p className={s}>(a) Direct discussion within 10 business days. (b) If unresolved, mediation in Utah County, costs shared equally. (c) If mediation fails within 30 days, binding arbitration under AAA rules in Utah County. (d) Prevailing party in any proceeding recovers reasonable attorney fees, costs, and expenses.</p>

      <p className={h}>16. General Provisions</p>
      <p className={s}><strong>Governing Law:</strong> State of Utah. <strong>Entire Agreement:</strong> This Agreement, including estimates, supplements, and addenda, is the entire agreement. <strong>Amendments:</strong> Written and signed by both parties. <strong>Severability:</strong> Unenforceable provisions do not affect the remainder. <strong>Force Majeure:</strong> Company not liable for delays beyond its control. <strong>Assignment:</strong> No assignment without consent; Company may assign to affiliates. <strong>Electronic Signatures:</strong> Electronic signatures are valid and binding under Utah Code §46-4-101 et seq. and the federal E-SIGN Act.</p>
    </div>
  );
}

// ─── Success Screen ────────────────────────────────────────────────
function SuccessScreen({ claim }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "linear-gradient(135deg, #fefce8 0%, #ffffff 50%, #f0fdf4 100%)" }}>
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
          <Check size={32} className="text-emerald-600" strokeWidth={2.5} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Authorization Signed</h1>
        <p className="text-gray-600 mb-6">
          Thank you, {claim.homeowner_name.split(" ")[0]}. Our team is on it. We'll be in touch shortly.
        </p>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-left mb-6">
          <div className="flex justify-between py-1.5 text-sm">
            <span className="text-gray-500">Document ID</span>
            <span className="font-mono text-gray-800">{claim.document_id}</span>
          </div>
          <div className="flex justify-between py-1.5 text-sm">
            <span className="text-gray-500">Signed</span>
            <span className="text-gray-800">{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div className="flex justify-between py-1.5 text-sm">
            <span className="text-gray-500">Property</span>
            <span className="text-gray-800 text-right">{claim.service_address}</span>
          </div>
        </div>
        <p className="text-xs text-gray-400">A copy of this agreement has been sent to {claim.email}</p>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────
export default function WorkAuthSigning() {
  const [claim] = useState(SAMPLE_CLAIM);
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentEsign, setConsentEsign] = useState(false);
  const [consentAuthority, setConsentAuthority] = useState(false);
  const [signature, setSignature] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = consentTerms && consentEsign && consentAuthority && signature;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    // ── Supabase integration point ──
    // const { data, error } = await supabase
    //   .from('signed_authorizations')
    //   .insert({
    //     document_id: claim.document_id,
    //     claim_number: claim.claim_number,
    //     homeowner_name: claim.homeowner_name,
    //     service_address: claim.service_address,
    //     signature_data: signature,
    //     signed_at: new Date().toISOString(),
    //     ip_address: /* capture from request */,
    //     user_agent: navigator.userAgent,
    //     consent_terms: consentTerms,
    //     consent_esign: consentEsign,
    //     consent_authority: consentAuthority,
    //   });

    await new Promise((r) => setTimeout(r, 1500));
    setSubmitting(false);
    setSubmitted(true);
  };

  if (submitted) return <SuccessScreen claim={claim} />;

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #fffbeb 0%, #ffffff 15%)" }}>
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div>
            <div className="font-bold text-gray-900 text-sm tracking-tight">Utah Pros Restoration</div>
            <div className="text-xs text-gray-400">Work Authorization</div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full">
            <Shield size={12} />
            <span>Secure</span>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 pb-32">
        {/* ── Intro ── */}
        <div className="mb-5">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="p-2 rounded-xl bg-amber-100">
              <Droplets size={20} className="text-amber-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Work Authorization</h1>
              <p className="text-xs text-gray-500">Water Damage Mitigation & Cleaning</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed mt-3">
            We know this is a stressful time. This form authorizes us to begin restoring your property and explains how payment works.
          </p>
        </div>

        {/* ── Property Info ── */}
        <Expandable title="Property & Insurance Info" icon={<FileText size={16} />} defaultOpen={true}>
          <div className="mt-2">
            <InfoRow label="Address" value={`${claim.service_address}, ${claim.city}, ${claim.state} ${claim.zip}`} />
            <InfoRow label="Homeowner" value={claim.homeowner_name} />
            {claim.co_owner_name && <InfoRow label="Co-Owner" value={claim.co_owner_name} />}
            <InfoRow label="Phone" value={claim.phone} />
            <InfoRow label="Email" value={claim.email} />
            <InfoRow label="Insurance" value={claim.insurance_company} />
            <InfoRow label="Claim #" value={claim.claim_number} />
            <InfoRow label="Date of Loss" value={claim.date_of_loss} />
          </div>
        </Expandable>

        {/* ── What You're Authorizing ── */}
        <Expandable title="What You're Authorizing" icon={<Check size={16} />} defaultOpen={true}>
          <div className="mt-2">
            <p className="text-xs text-gray-500 mb-2">By signing, you authorize Utah Pros to:</p>
            <AuthItem text="Begin water damage mitigation: demolition, cleaning, drying, and treatment" />
            <AuthItem text="Determine what materials are non-salvageable per IICRC S500/S520/S700 standards" />
            <AuthItem text="Prepare a Xactimate estimate after work is complete and submit it to your insurer" />
            <AuthItem text="Prepare reconstruction estimates and submit supplements as needed" />
            <AuthItem text="Photograph and document property conditions for the insurance claim" />
            <AuthItem text="File a Preliminary Notice on the property per Utah lien law (§38-1a)" />
          </div>
        </Expandable>

        {/* ── Payment ── */}
        <Expandable title="Payment" icon={<Shield size={16} />} defaultOpen={true}>
          <div className="mt-2 space-y-3">
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">Direction to Pay</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                You irrevocably direct your insurance company to pay all covered amounts directly to Utah Pros at 1055 N State St, Orem, UT 84057. If a joint check is issued, you will endorse and deliver it within 5 business days.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-800 mb-1">Your Responsibility</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                You are responsible for your deductible, depreciation, and any amounts not covered by insurance. If your insurance carrier has not paid within 30 days of estimate submission, you accept responsibility to pursue payment and pay Utah Pros within 60 days of invoice, regardless of insurance status.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-800 mb-1">Late Payments</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Unpaid balances accrue interest at 1.5%/month. Utah Pros may recover attorney fees and collection costs.
              </p>
            </div>
          </div>
        </Expandable>

        {/* ── Terms & Conditions ── */}
        <Expandable title="Terms & Conditions (16 Sections)" icon={<FileText size={16} />} defaultOpen={false}>
          <TermsContent />
        </Expandable>

        {/* ── Consent Checkboxes ── */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Required Acknowledgments</p>
          <ConsentCheck checked={consentTerms} onChange={setConsentTerms}>
            I have read and agree to the <span className="font-semibold text-amber-700">Terms & Conditions</span> attached to this authorization.
          </ConsentCheck>
          <ConsentCheck checked={consentEsign} onChange={setConsentEsign}>
            I consent to <span className="font-semibold text-amber-700">electronic signature</span> under the Utah UETA and federal E-SIGN Act. I agree my electronic signature carries the same legal effect as a handwritten signature.
          </ConsentCheck>
          <ConsentCheck checked={consentAuthority} onChange={setConsentAuthority}>
            I confirm I am the <span className="font-semibold text-amber-700">property owner or authorized representative</span> and have authority to authorize this work and payment terms.
          </ConsentCheck>
        </div>

        {/* ── Signature ── */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Your Signature</p>
          <SignaturePad onSignatureChange={setSignature} />
          <p className="text-xs text-gray-400 mt-2 text-center">
            {claim.homeowner_name} · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>

        {/* ── Document ID ── */}
        <div className="text-center mb-4">
          <span className="text-xs text-gray-400 font-mono">Document ID: {claim.document_id}</span>
        </div>
      </div>

      {/* ── Sticky Submit ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 p-4 z-20">
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
              canSubmit && !submitting
                ? "bg-amber-500 text-white shadow-lg shadow-amber-200 hover:bg-amber-600 active:scale-[0.98]"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Pen size={16} />
                Sign & Authorize Work
              </>
            )}
          </button>
          {!canSubmit && !submitting && (
            <div className="flex items-center justify-center gap-1.5 mt-2">
              <AlertCircle size={12} className="text-gray-400" />
              <p className="text-xs text-gray-400">
                {!consentTerms || !consentEsign || !consentAuthority
                  ? "Check all acknowledgments above"
                  : "Add your signature above"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
