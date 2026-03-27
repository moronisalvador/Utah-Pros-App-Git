// Run once: node patch_claim_links.js
const fs = require('fs');
const path = require('path');

const BASE = __dirname;

function patch(rel, replacements) {
  const full = path.join(BASE, rel);
  let src = fs.readFileSync(full, 'utf8');
  let changed = 0;
  for (const [old, neu] of replacements) {
    if (src.includes(old)) {
      src = src.replace(old, neu);
      changed++;
      console.log(`  ✓  ${rel}: patched [${old.slice(0, 60)}...]`);
    } else {
      console.log(`  ⚠  ${rel}: NOT FOUND [${old.slice(0, 60)}...]`);
    }
  }
  if (changed) fs.writeFileSync(full, src, 'utf8');
}

// ── 1. JobPage.jsx: wire onNavigateClaim ─────────────────────────────────────
patch('src/pages/JobPage.jsx', [
  // OverviewTab render call
  [
    `onNavigateJob={id=>navigate(\`/jobs/\${id}\`)} onNavigateCustomer={id=>navigate(\`/customers/\${id}\`)}/>}`,
    `onNavigateJob={id=>navigate(\`/jobs/\${id}\`)} onNavigateCustomer={id=>navigate(\`/customers/\${id}\`)} onNavigateClaim={id=>navigate(\`/claims/\${id}\`)}/>}`
  ],
  // OverviewTab signature
  [
    `function OverviewTab({job,employees,saveBatch,fmtDate,claimData,siblingJobs,onAddRelatedJob,onNavigateJob,onNavigateCustomer}){`,
    `function OverviewTab({job,employees,saveBatch,fmtDate,claimData,siblingJobs,onAddRelatedJob,onNavigateJob,onNavigateCustomer,onNavigateClaim}){`
  ],
  // RelatedJobsSection call inside OverviewTab
  [
    `{claimData&&<RelatedJobsSection claimData={claimData} siblingJobs={siblingJobs} onAddRelatedJob={onAddRelatedJob} onNavigateJob={onNavigateJob}/>}`,
    `{claimData&&<RelatedJobsSection claimData={claimData} siblingJobs={siblingJobs} onAddRelatedJob={onAddRelatedJob} onNavigateJob={onNavigateJob} onNavigateClaim={onNavigateClaim}/>}`
  ],
  // RelatedJobsSection function signature
  [
    `function RelatedJobsSection({claimData,siblingJobs,onAddRelatedJob,onNavigateJob}){`,
    `function RelatedJobsSection({claimData,siblingJobs,onAddRelatedJob,onNavigateJob,onNavigateClaim}){`
  ],
  // Replace plain claim_number span with View Claim button + span
  [
    `<span style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',fontStyle:'normal',textTransform:'none',letterSpacing:0}}>{claimData.claim_number}</span>`,
    `<div style={{display:'flex',alignItems:'center',gap:6}}>{claimData?.id&&<button className="btn btn-ghost btn-sm" onClick={()=>onNavigateClaim?.(claimData.id)} style={{fontSize:11,height:22,padding:'0 8px',color:'var(--brand-primary)'}}>📋 View Claim</button>}<span style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',fontStyle:'normal',textTransform:'none',letterSpacing:0}}>{claimData.claim_number}</span></div>`
  ],
]);

// ── 2. Collections.jsx: add View Claim to ARRow menu ─────────────────────────
patch('src/pages/Collections.jsx', [
  [
    `                {isInsurance && b.deductible > 0 && !job.deductible_collected && (\n                  <button className="ar-action-item" onClick={() => { onMarkDedPaid(); setMenuOpen(false); }}>\n                    ✓ Mark Deductible Received\n                  </button>\n                )}`,
    `                {isInsurance && b.deductible > 0 && !job.deductible_collected && (\n                  <button className="ar-action-item" onClick={() => { onMarkDedPaid(); setMenuOpen(false); }}>\n                    ✓ Mark Deductible Received\n                  </button>\n                )}\n                {job.claim_id && (\n                  <button className="ar-action-item" onClick={() => { navigate(\`/claims/\${job.claim_id}\`); setMenuOpen(false); }}>\n                    📋 View Claim\n                  </button>\n                )}`
  ],
]);

console.log('\nDone. Commit and push.');
