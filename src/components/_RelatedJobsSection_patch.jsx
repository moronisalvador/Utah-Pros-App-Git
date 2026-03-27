/* === RELATED JOBS SECTION === */
function RelatedJobsSection({claimData,siblingJobs,onAddRelatedJob,onNavigateJob,onNavigateClaim}){
  return(
    <div className="job-page-section job-page-section-full">
      <div className="job-page-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span>Related Jobs</span>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {claimData?.id&&(
            <button className="btn btn-ghost btn-sm" onClick={()=>onNavigateClaim?.(claimData.id)} style={{fontSize:11,height:24,padding:'0 8px',color:'var(--brand-primary)',gap:3}}>
              📋 View Claim
            </button>
          )}
          <span style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',fontStyle:'normal',textTransform:'none',letterSpacing:0}}>{claimData?.claim_number}</span>
        </div>
      </div>
      {siblingJobs&&siblingJobs.length>0?(
        <div style={{display:'flex',flexDirection:'column',gap:'var(--space-2)'}}>
          {siblingJobs.map(sj=>{const dc=DIVISION_COLORS[sj.division]||'#6b7280';const de=DIVISION_EMOJI[sj.division]||'\u{1F4C1}';
            return(<div key={sj.id} onClick={()=>onNavigateJob?.(sj.id)} style={{display:'flex',alignItems:'center',gap:'var(--space-3)',padding:'var(--space-2) var(--space-3)',background:'var(--bg-secondary)',borderRadius:'var(--radius-md)',border:'1px solid var(--border-light)',borderLeft:`3px solid ${dc}`,cursor:'pointer'}}>
              <span style={{fontSize:16}}>{de}</span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:'var(--text-primary)'}}>{sj.job_number||'New Job'} — {sj.division?.replace(/_/g,' ')}</div><div style={{fontSize:11,color:'var(--text-tertiary)',marginTop:1}}>{sj.phase?.replace(/_/g,' ')}</div></div>
              <span style={{fontSize:11,color:'var(--brand-primary)',fontWeight:600}}>{'\u2192'}</span>
            </div>);})}
        </div>
      ):(<div style={{fontSize:'var(--text-sm)',color:'var(--text-tertiary)',padding:'var(--space-2) 0'}}>No other jobs under this claim yet</div>)}
      <button className="btn btn-secondary btn-sm" onClick={onAddRelatedJob} style={{marginTop:'var(--space-3)',gap:4,width:'100%',justifyContent:'center'}}>+ Add Related Job</button>
    </div>);}
