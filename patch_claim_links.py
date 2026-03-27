"""
Run once from the repo root: python patch_claim_links.py
"""
import os, sys

BASE = os.path.dirname(os.path.abspath(__file__))

def patch(rel_path, replacements):
    full = os.path.join(BASE, rel_path)
    with open(full, 'r', encoding='utf-8') as f:
        src = f.read()
    changed = 0
    for old, new in replacements:
        if old in src:
            src = src.replace(old, new, 1)
            changed += 1
            print(f"  ✓  {rel_path}: patched [{repr(old[:70])}]")
        else:
            print(f"  ⚠  {rel_path}: NOT FOUND [{repr(old[:70])}]")
    if changed:
        with open(full, 'w', encoding='utf-8') as f:
            f.write(src)
    return changed

# ── ClaimPage.jsx: add CSS import ────────────────────────────────────────────
patch('src/pages/ClaimPage.jsx', [
    (
        "import { useAuth } from '@/contexts/AuthContext';",
        "import { useAuth } from '@/contexts/AuthContext';\nimport '@/claim-page.css';"
    ),
])

# ── JobPage.jsx: wire onNavigateClaim through ────────────────────────────────
patch('src/pages/JobPage.jsx', [
    # 1. OverviewTab render: add onNavigateClaim prop
    (
        "onNavigateJob={id=>navigate(`/jobs/${id}`)} onNavigateCustomer={id=>navigate(`/customers/${id}`)}/>}",
        "onNavigateJob={id=>navigate(`/jobs/${id}`)} onNavigateCustomer={id=>navigate(`/customers/${id}`)} onNavigateClaim={id=>navigate(`/claims/${id}`)}/>}"
    ),
    # 2. OverviewTab signature
    (
        "function OverviewTab({job,employees,saveBatch,fmtDate,claimData,siblingJobs,onAddRelatedJob,onNavigateJob,onNavigateCustomer}){",
        "function OverviewTab({job,employees,saveBatch,fmtDate,claimData,siblingJobs,onAddRelatedJob,onNavigateJob,onNavigateCustomer,onNavigateClaim}){"
    ),
    # 3. RelatedJobsSection call: pass onNavigateClaim
    (
        "{claimData&&<RelatedJobsSection claimData={claimData} siblingJobs={siblingJobs} onAddRelatedJob={onAddRelatedJob} onNavigateJob={onNavigateJob}/>}",
        "{claimData&&<RelatedJobsSection claimData={claimData} siblingJobs={siblingJobs} onAddRelatedJob={onAddRelatedJob} onNavigateJob={onNavigateJob} onNavigateClaim={onNavigateClaim}/>}"
    ),
    # 4. RelatedJobsSection function signature
    (
        "function RelatedJobsSection({claimData,siblingJobs,onAddRelatedJob,onNavigateJob}){",
        "function RelatedJobsSection({claimData,siblingJobs,onAddRelatedJob,onNavigateJob,onNavigateClaim}){"
    ),
    # 5. Replace the plain claim_number span with one that includes View Claim button
    (
        "<span style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',fontStyle:'normal',textTransform:'none',letterSpacing:0}}>{claimData.claim_number}</span>",
        "<div style={{display:'flex',alignItems:'center',gap:6}}>"
        "{claimData?.id&&<button className=\"btn btn-ghost btn-sm\" onClick={()=>onNavigateClaim?.(claimData.id)} style={{fontSize:11,height:22,padding:'0 7px',color:'var(--brand-primary)'}}>📋 Claim</button>}"
        "<span style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',fontStyle:'normal',textTransform:'none',letterSpacing:0}}>{claimData.claim_number}</span>"
        "</div>"
    ),
])

# ── Collections.jsx: add View Claim to ARRow action menu ─────────────────────
patch('src/pages/Collections.jsx', [
    (
        "                {isInsurance && b.deductible > 0 && !job.deductible_collected && (\n"
        "                  <button className=\"ar-action-item\" onClick={() => { onMarkDedPaid(); setMenuOpen(false); }}>\n"
        "                    ✓ Mark Deductible Received\n"
        "                  </button>\n"
        "                )}",
        "                {isInsurance && b.deductible > 0 && !job.deductible_collected && (\n"
        "                  <button className=\"ar-action-item\" onClick={() => { onMarkDedPaid(); setMenuOpen(false); }}>\n"
        "                    ✓ Mark Deductible Received\n"
        "                  </button>\n"
        "                )}\n"
        "                {job.claim_id && (\n"
        "                  <button className=\"ar-action-item\" onClick={() => { navigate(`/claims/${job.claim_id}`); setMenuOpen(false); }}>\n"
        "                    📋 View Claim\n"
        "                  </button>\n"
        "                )}"
    ),
])

print("\nAll done. Commit and push.")
