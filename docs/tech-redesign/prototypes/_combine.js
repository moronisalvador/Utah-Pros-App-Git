const fs=require('fs');
const dir='/home/user/Utah-Pros-App-Git/docs/tech-redesign/prototypes/';
const files=['schedule.html','job-hub.html','new-job-flow.html'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(dir+f,'utf8')]));

function styleOf(s){ const m=s.match(/<style>([\s\S]*?)<\/style>/); return m?m[1]:''; }
function spriteOf(s){ const m=s.match(/<svg\b[^>]*>\s*(?:<defs>\s*)?<symbol[\s\S]*?<\/svg>/); return m?m[0]:''; }
function scriptsOf(s){ return (s.match(/<script>[\s\S]*?<\/script>/g)||[]); }
// robust: extract each .screen as a balanced <div>…</div> via depth counting
function extractScreens(html){
  const out=[];
  const head=/<div class="screen(?: on)?" id="s-[a-z0-9-]+">/g;
  let m;
  while((m=head.exec(html))){
    const start=m.index;
    const tag=/<div\b|<\/div>/g; tag.lastIndex=start;
    let depth=0,end=-1,t;
    while((t=tag.exec(html))){
      if(t[0]==='</div>'){ if(--depth===0){ end=tag.lastIndex; break; } } else depth++;
    }
    if(end>-1) out.push(html.slice(start,end));
    head.lastIndex=end>-1?end:head.lastIndex;
  }
  return out;
}

const sprite=spriteOf(src['job-hub.html']);
// job-hub's <style> is a VERIFIED SUPERSET of schedule's + new-job's (which are byte-identical to
// each other): it defines every selector all three flows use (0 missing) plus its own hub extras.
// So we ship ONE copy, not three. This cuts combined CSS ~338KB → ~121KB and kills the multi-second
// style-recalc freeze on the heaviest screen (Add visit, 558 nodes matched against a 3× selector set).
const css=styleOf(src['job-hub.html'])
  +'\n.step-sep{color:#8A8D96;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:0 6px 0 10px;white-space:nowrap;}\n.step-bar{flex-wrap:nowrap;}';
const jhScripts=scriptsOf(src['job-hub.html']);
const harness=jhScripts[0];
const extras=[...scriptsOf(src['schedule.html']).slice(1), ...scriptsOf(src['new-job-flow.html']).slice(1), ...jhScripts.slice(1)];

let all=[];
for(const f of files){ all.push(...extractScreens(src[f])); }
console.error('extracted screens:', all.length, '=', files.map(f=>f+':'+extractScreens(src[f]).length).join(' '));
let screens=all.join('\n');
screens=screens.replace(/class="screen on"/g,'class="screen"');
screens=screens.replace('<div class="screen" id="s-month">','<div class="screen on" id="s-month">');
// cross-flow wiring
screens=screens.replace(/<button class="tab active" type="button" aria-current="page"><svg class="ic" width="24" height="24"><use href="#i-cal"\/><\/svg><span class="tab-label">Schedule<\/span><\/button>/g,
  '<button class="tab active" type="button" aria-current="page" data-go="s-month"><svg class="ic" width="24" height="24"><use href="#i-cal"/></svg><span class="tab-label">Schedule</span></button>');
screens=screens.replace(/<button class="backbtn" type="button" aria-label="Back to schedule">/g,'<button class="backbtn" type="button" data-go="s-month" aria-label="Back to schedule">');
screens=screens.split('data-toast data-toast-kind="info" data-toast-title="Opens the job"').join('data-go="s-working"');

const stepBar=`  <div class="step-bar" id="stepBar">
    <button type="button" data-theme-toggle class="step-theme">Light</button>
    <span class="step-sep">Schedule</span><button type="button" data-go="s-month">Month</button><button type="button" data-go="s-day">Day</button><button type="button" data-go="s-search">Search</button><button type="button" data-go="s-addvisit">Add visit</button>
    <span class="step-sep">Job Hub</span><button type="button" data-go="s-scheduled">Scheduled</button><button type="button" data-go="s-omw">OMW</button><button type="button" data-go="s-working">Working</button><button type="button" data-go="s-paused">Paused</button><button type="button" data-go="s-done">Done</button><button type="button" data-go="s-job">Job view</button><button type="button" data-go="s-room">Room</button><button type="button" data-go="s-notes">Notes</button><button type="button" data-go="s-docs">Docs</button><button type="button" data-go="s-activity">Activity</button>
    <span class="step-sep">New Job</span><button type="button" data-go="s-fab">Create</button><button type="button" data-go="s-step1">Customer</button><button type="button" data-go="s-step2">Type</button><button type="button" data-go="s-step3">Claim</button><button type="button" data-go="s-review">Review</button>
  </div>`;
const out=`<!-- ═══ UPR Tech PWA — COMBINED clickable prototype ═══ -->
<style>${css}</style>
${sprite}
<div class="stage" id="stage" data-theme="light">
  <div class="device">
${screens}
  </div>
${stepBar}
</div>
${harness}
${extras.join('\n')}
`;
fs.writeFileSync(dir+'full-app.html',out);
console.log('bytes:',out.length,'| screens:',(out.match(/class="screen[" ]/g)||[]).length);
