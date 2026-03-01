// ── IndexedDB ──
const DB_NAME='IssueFlowDB', DB_VER=1;
let db, projects=[], issues=[], comments=[];
let activeProjId=null, sideFilter='all', activeTab='board';

function idb(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('projects'))d.createObjectStore('projects',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('issues')){const s=d.createObjectStore('issues',{keyPath:'id',autoIncrement:true});s.createIndex('projectId','projectId',{unique:false});}
      if(!d.objectStoreNames.contains('comments')){const s=d.createObjectStore('comments',{keyPath:'id',autoIncrement:true});s.createIndex('issueId','issueId',{unique:false});}
    };
    r.onsuccess=e=>{db=e.target.result;res()};
    r.onerror=()=>rej(r.error);
  });
}
const dba=store=>new Promise((res,rej)=>{const r=db.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej()});
const dbp=(store,item)=>new Promise((res,rej)=>{const r=db.transaction(store,'readwrite').objectStore(store).put(item);r.onsuccess=()=>res(r.result);r.onerror=()=>rej()});
const dbd=(store,id)=>new Promise((res,rej)=>{const r=db.transaction(store,'readwrite').objectStore(store).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej()});

async function loadAll(){
  [projects,issues,comments]=await Promise.all([dba('projects'),dba('issues'),dba('comments')]);
  buildProjSel();
}

// ── Helpers ──
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const priOrder={critical:0,high:1,medium:2,low:3};
const typeIcon={bug:'🐛',feature:'✨',enhancement:'⚡',task:'📝'};
function fmtDate(d){if(!d)return'—';return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function toast(msg,type='ok'){
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  const ico=type==='ok'?'✅':type==='err'?'❌':type==='info'?'ℹ️':'⏳';
  el.innerHTML=`<span>${ico}</span><span>${msg}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),4000);
}
function issueNum(i){return`#${String(i.id).padStart(3,'0')}`;}
function priClass(p){return`pri-${p}`;}
function getProj(){return projects.find(p=>p.id===activeProjId);}
function projIssues(){return issues.filter(i=>i.projectId===activeProjId);}

function filtered(list){
  const sf=sideFilter;
  if(sf==='all')return list;
  const proj=getProj();
  const wf=proj?.workflow||[];
  const wfIds=wf.map(w=>w.id);
  if(wfIds.includes(sf))return list.filter(i=>i.status===sf);
  if(sf==='open')return list.filter(i=>i.status===(wf[0]?.id||'open'));
  if(sf==='in-progress'){const mid=wf.filter((_,idx,arr)=>idx>0&&idx<arr.length-1).map(w=>w.id);return list.filter(i=>mid.includes(i.status));}
  if(sf==='done'){return list.filter(i=>i.status===(wf[wf.length-1]?.id||'done'));}
  if(['critical','high','medium','low'].includes(sf))return list.filter(i=>i.priority===sf);
  if(sf==='local')return list.filter(i=>!i.jiraKey);
  if(sf==='jira')return list.filter(i=>!!i.jiraKey);
  return list.filter(i=>i.type===sf);
}

// ── Project Select ──
function buildProjSel(){
  const sel=document.getElementById('projSel');
  if(!projects.length){sel.innerHTML='<option value="">No projects — create one</option>';activeProjId=null;render();return;}
  sel.innerHTML=projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if(!activeProjId||!projects.find(p=>p.id===activeProjId))activeProjId=projects[0].id;
  sel.value=activeProjId;
  const proj=getProj();
  document.getElementById('jiraSyncBtn').style.display=proj?.jira?.enabled?'inline-flex':'none';
  render();
}
function onProjChange(){activeProjId=parseInt(document.getElementById('projSel').value)||null;sideFilter='all';document.querySelectorAll('.sbi').forEach(x=>x.classList.toggle('active',x.dataset.sf==='all'));buildProjSel();}

// ── Tabs / Sidebar ──
function setTab(t){
  activeTab=t;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===t));
  document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${t}`));
  render();
}
function setSF(f,el){sideFilter=f;document.querySelectorAll('.sbi').forEach(x=>x.classList.remove('active'));el.classList.add('active');render();}

// ── Render ──
function render(){
  updateSidebar();
  if(activeTab==='board')renderBoard();
  else if(activeTab==='issues')renderIssues();
  else if(activeTab==='dashboard')renderDash();
  else if(activeTab==='settings')renderSettings();
}

function updateSidebar(){
  const pi=projIssues();
  const proj=getProj();
  const wf=proj?.workflow||[];
  const counts={all:pi.length,open:0,'in-progress':0,done:0,critical:0,high:0,medium:0,low:0,local:0,jira:0,bug:0,feature:0,task:0,enhancement:0};
  pi.forEach(i=>{
    counts[i.priority]=(counts[i.priority]||0)+1;
    counts[i.type]=(counts[i.type]||0)+1;
    if(i.jiraKey)counts.jira++;else counts.local++;
    if(i.status===wf[0]?.id)counts.open++;
    else if(i.status===wf[wf.length-1]?.id)counts.done++;
    else counts['in-progress']++;
  });
  Object.keys(counts).forEach(k=>{const el=document.getElementById(`sf-${k}`);if(el)el.textContent=counts[k];});
}

// ── BOARD ──
function renderBoard(){
  const proj=getProj();
  if(!proj){document.getElementById('kanban-board').innerHTML=`<div class="empty"><div class="empty-ico">🗂️</div><div class="empty-ttl">No project selected</div><div>Create a project to get started</div></div>`;return;}
  const wf=proj.workflow||defaultWorkflow();
  const pi=filtered(projIssues());
  const board=document.getElementById('kanban-board');
  board.innerHTML=wf.map(stage=>{
    const cards=pi.filter(i=>i.status===stage.id).sort((a,b)=>(priOrder[a.priority]||0)-(priOrder[b.priority]||0));
    return`<div class="col">
      <div class="col-hdr">
        <span class="col-title"><span style="width:8px;height:8px;border-radius:50%;background:${stage.color};display:inline-block"></span>${esc(stage.label)}</span>
        <div style="display:flex;align-items:center;gap:5px">
          <span class="col-cnt">${cards.length}</span>
          <button class="ibtn" title="Add issue here" onclick="openModal('issue','${stage.id}')">+</button>
        </div>
      </div>
      <div class="col-body">
        ${cards.length?cards.map(i=>`
          <div class="kcard" onclick="openDetail(${i.id})">
            <div class="kcard-title">${esc(i.title)}</div>
            <div class="kcard-foot">
              <div style="display:flex;align-items:center;gap:5px">
                <span class="kcard-id">${issueNum(i)}</span>
                ${i.jiraKey?`<span class="jira-badge">🔗 ${esc(i.jiraKey)}</span>`:''}
              </div>
              <div style="display:flex;align-items:center;gap:5px">
                ${i.assignee?`<span style="font-size:.68rem;color:var(--muted)">${esc(i.assignee)}</span>`:''}
                <span class="pri ${priClass(i.priority)}">${i.priority}</span>
              </div>
            </div>
          </div>`).join(''):`<div style="text-align:center;padding:18px;color:var(--dim);font-size:.78rem">Empty</div>`}
      </div>
    </div>`;
  }).join('');
}

// ── ISSUES LIST ──
function renderIssues(){
  const q=document.getElementById('srchInput').value.trim().toLowerCase();
  const tf=document.getElementById('typeFil').value;
  const sort=document.getElementById('sortSel').value;
  let list=filtered(projIssues());
  if(q)list=list.filter(i=>i.title.toLowerCase().includes(q)||(i.description||'').toLowerCase().includes(q));
  if(tf)list=list.filter(i=>i.type===tf);
  list.sort((a,b)=>sort==='priority'?(priOrder[a.priority]||0)-(priOrder[b.priority]||0):sort==='title'?a.title.localeCompare(b.title):b.createdAt.localeCompare(a.createdAt));
  const sfLabels={all:'All Issues',open:'Open','in-progress':'In Progress',done:'Done',critical:'Critical',high:'High Priority',medium:'Medium',low:'Low',local:'Local Issues',jira:'Jira Issues',bug:'Bugs',feature:'Features',task:'Tasks',enhancement:'Enhancements'};
  document.getElementById('issues-ttl').textContent=sfLabels[sideFilter]||sideFilter;
  document.getElementById('issues-cnt').textContent=`${list.length} issue${list.length!==1?'s':''}`;
  const wf=getProj()?.workflow||[];
  const statusLabel=s=>wf.find(w=>w.id===s)?.label||s;
  const statusColor=s=>wf.find(w=>w.id===s)?.color||'var(--muted)';
  const el=document.getElementById('issue-list');
  if(!list.length){el.innerHTML=`<div class="empty"><div class="empty-ico">🎉</div><div class="empty-ttl">No issues found</div></div>`;return;}
  el.innerHTML=`<div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th><th>Type</th><th>Assignee</th><th>Source</th></tr></thead><tbody>${list.map(i=>`
    <tr class="hr" onclick="openDetail(${i.id})">
      <td style="color:var(--muted);font-size:.7rem;font-weight:700">${issueNum(i)}</td>
      <td style="font-weight:500;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.title)}</td>
      <td><span style="font-size:.72rem;font-weight:700;color:${statusColor(i.status)}">${esc(statusLabel(i.status))}</span></td>
      <td><span class="pri ${priClass(i.priority)}">${i.priority}</span></td>
      <td>${typeIcon[i.type]||'📝'} ${i.type||'—'}</td>
      <td style="color:var(--muted);font-size:.78rem">${esc(i.assignee||'—')}</td>
      <td>${i.jiraKey?`<span class="jira-badge">🔗 ${esc(i.jiraKey)}</span>`:'<span style="font-size:.7rem;color:var(--dim)">Local</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ── DASHBOARD ──
function renderDash(){
  const pi=projIssues();
  const proj=getProj();
  const wf=proj?.workflow||[];
  const jiraCount=pi.filter(i=>i.jiraKey).length;
  document.getElementById('db-stats').innerHTML=`
    <div class="stat"><div class="stat-lbl">Total</div><div class="stat-val" style="color:var(--accent)">${pi.length}</div></div>
    <div class="stat"><div class="stat-lbl">Jira Issues</div><div class="stat-val" style="color:var(--sky)">${jiraCount}</div></div>
    <div class="stat"><div class="stat-lbl">Local Issues</div><div class="stat-val" style="color:var(--purple)">${pi.length-jiraCount}</div></div>
    <div class="stat"><div class="stat-lbl">Critical</div><div class="stat-val" style="color:var(--rose)">${pi.filter(i=>i.priority==='critical').length}</div></div>
    <div class="stat"><div class="stat-lbl">Bugs</div><div class="stat-val" style="color:var(--orange)">${pi.filter(i=>i.type==='bug').length}</div></div>`;
  const recent=[...pi].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,8);
  const statusLabel=s=>wf.find(w=>w.id===s)?.label||s;
  const statusColor=s=>wf.find(w=>w.id===s)?.color||'var(--muted)';
  document.getElementById('db-recent').innerHTML=recent.length?recent.map(i=>`
    <tr class="hr" onclick="openDetail(${i.id})">
      <td style="color:var(--muted);font-size:.7rem;font-weight:700">${issueNum(i)}</td>
      <td>${esc(i.title)}</td>
      <td><span style="font-size:.72rem;font-weight:600;color:${statusColor(i.status)}">${esc(statusLabel(i.status))}</span></td>
      <td><span class="pri ${priClass(i.priority)}">${i.priority}</span></td>
      <td>${i.jiraKey?`<span class="jira-badge">🔗</span>`:''}</td>
    </tr>`).join(''):`<tr><td colspan="5"><div class="empty">No issues</div></td></tr>`;
  const pris=['critical','high','medium','low'];
  const pColors={critical:'var(--rose)',high:'var(--orange)',medium:'var(--amber)',low:'var(--sky)'};
  const maxP=Math.max(1,...pris.map(p=>pi.filter(i=>i.priority===p).length));
  document.getElementById('db-pri-chart').innerHTML=pris.map(p=>{
    const cnt=pi.filter(i=>i.priority===p).length;
    return`<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <span style="font-size:.72rem;font-weight:600;color:${pColors[p]};min-width:52px">${p}</span>
      <div style="flex:1;height:7px;background:var(--s4);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.round(cnt/maxP*100)}%;background:${pColors[p]};border-radius:4px;transition:width .4s"></div></div>
      <span style="font-size:.72rem;font-weight:700;color:${pColors[p]};min-width:16px;text-align:right">${cnt}</span>
    </div>`;
  }).join('');
  document.getElementById('db-workflow').innerHTML=`<div class="tbl-wrap"><table><thead><tr><th>Stage</th><th>Count</th><th>Progress</th></tr></thead><tbody>${wf.map(stage=>{
    const cnt=pi.filter(i=>i.status===stage.id).length;
    const pct=pi.length?Math.round(cnt/pi.length*100):0;
    return`<tr><td><span style="display:inline-flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:50%;background:${stage.color}"></span>${esc(stage.label)}</span></td>
      <td style="font-weight:700">${cnt}</td>
      <td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:5px;background:var(--s4);border-radius:4px;overflow:hidden;min-width:80px"><div style="height:100%;width:${pct}%;background:${stage.color};border-radius:4px"></div></div><span style="font-size:.72rem;color:var(--muted)">${pct}%</span></div></td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

// ── SETTINGS ──
function renderSettings(){
  const grid=document.getElementById('settings-grid');
  if(!projects.length){grid.innerHTML=`<div class="empty"><div class="empty-ico">⚙️</div><div class="empty-ttl">No projects yet</div></div>`;return;}
  grid.innerHTML=projects.map(p=>{
    const pi=issues.filter(i=>i.projectId===p.id);
    const jira=p.jira||{};
    const connected=jira.enabled&&jira.baseUrl&&jira.apiToken;
    const lastSync=jira.lastSync?`Last synced ${fmtDate(jira.lastSync)}`:'Never synced';
    return`<div class="set-card">
      <div class="set-card-hdr">
        <div class="set-card-title"><span style="width:10px;height:10px;border-radius:50%;background:${p.color}"></span>${esc(p.name)}</div>
        <div style="display:flex;gap:5px">
          <button class="btn btn-ghost btn-xs" onclick="openModal('project',${p.id})">Edit</button>
          <button class="ibtn del" onclick="delProject(${p.id})">🗑️</button>
        </div>
      </div>
      <div style="font-size:.78rem;color:var(--muted)">📋 ${pi.length} issues &nbsp;|&nbsp; 🔗 ${pi.filter(i=>i.jiraKey).length} from Jira</div>
      <div style="border-top:1px solid var(--border);padding-top:10px">
        <div style="font-size:.75rem;font-weight:700;color:var(--muted);margin-bottom:7px;text-transform:uppercase;letter-spacing:.6px">Jira Integration (Read-Only)</div>
        <div class="conn-status" style="margin-bottom:8px">
          <span class="conn-dot ${connected?'ok':'none'}"></span>
          <span>${connected?'Connected':'Not configured'}</span>
          ${connected?`<span style="color:var(--dim)">· ${lastSync}</span>`:''}
        </div>
        ${connected?`<div style="font-size:.75rem;color:var(--muted);margin-bottom:8px">Project: <strong style="color:var(--text)">${esc(jira.projectKey)}</strong> · ${jira.baseUrl?new URL(jira.baseUrl).hostname:''}</div>`:''}
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-xs" onclick="openJiraSettings(${p.id})">⚙️ Configure</button>
          ${connected?`<button class="btn btn-teal btn-xs" onclick="jiraSyncProject(${p.id})">🔄 Sync Now</button>`:''}
        </div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:10px">
        <div style="font-size:.75rem;font-weight:700;color:var(--muted);margin-bottom:7px;text-transform:uppercase;letter-spacing:.6px">Custom Workflow (${(p.workflow||defaultWorkflow()).length} stages)</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px">${(p.workflow||defaultWorkflow()).map(s=>`<span class="tag" style="border-left:3px solid ${s.color}">${esc(s.label)}</span>`).join('')}</div>
        <button class="btn btn-ghost btn-xs" onclick="openWorkflowModal(${p.id})">✏️ Edit Workflow</button>
      </div>
    </div>`;
  }).join('');
}

// ── DEFAULT WORKFLOW ──
function defaultWorkflow(){
  return[
    {id:'backlog',label:'Backlog',color:'#6b7280'},
    {id:'open',label:'Open',color:'#6d28d9'},
    {id:'in-progress',label:'In Progress',color:'#f59e0b'},
    {id:'in-review',label:'In Review',color:'#3b82f6'},
    {id:'done',label:'Done',color:'#10b981'}
  ];
}

// ── MODALS ──
let mType=null, mEditId=null, mInitStatus=null;

function openModal(type, editIdOrStatus=null){
  mType=type;
  if(type==='issue'){
    if(typeof editIdOrStatus==='number'){mEditId=editIdOrStatus;mInitStatus=null;}
    else{mEditId=null;mInitStatus=editIdOrStatus;}
  } else {
    mEditId=typeof editIdOrStatus==='number'?editIdOrStatus:null;
  }
  const body=document.getElementById('mbody'), foot=document.getElementById('mfoot');
  document.getElementById('modal').className='modal';

  if(type==='project'){
    const p=mEditId?projects.find(x=>x.id===mEditId):null;
    document.getElementById('mtitle').textContent=mEditId?'Edit Project':'New Project';
    const colors=['#6d28d9','#10b981','#f59e0b','#f43f5e','#38bdf8','#f97316','#a855f7','#ec4899'];
    body.innerHTML=`
      <div class="fg"><label>Project Name *</label><input type="text" id="m-pname" value="${esc(p?.name||'')}" placeholder="e.g. Mobile App"/></div>
      <div class="fg"><label>Color</label><div style="display:flex;gap:7px;flex-wrap:wrap">${colors.map(c=>`<button onclick="selectColor('${c}')" style="width:24px;height:24px;border-radius:50%;background:${c};border:2px solid ${(p?.color===c||(!p&&c===colors[0]))?'#fff':'transparent'};cursor:pointer;flex-shrink:0" data-color="${c}"></button>`).join('')}</div><input type="hidden" id="m-pcolor" value="${p?.color||colors[0]}"/></div>
      <div class="fg"><label>Description</label><textarea id="m-pdesc" placeholder="What is this project about?">${esc(p?.description||'')}</textarea></div>`;
    foot.innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>${mEditId?`<button class="btn btn-danger" onclick="delProject(${mEditId})">Delete</button>`:''}<button class="btn btn-primary" onclick="saveProject()">Save</button>`;

  } else if(type==='issue'){
    const iss=mEditId?issues.find(x=>x.id===mEditId):null;
    const proj=getProj(), wf=proj?.workflow||defaultWorkflow();
    const pOpts=projects.map(p=>`<option value="${p.id}" ${(iss?.projectId||activeProjId)===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
    const initStat=iss?.status||mInitStatus||wf[0]?.id;
    const wfOpts=wf.map(s=>`<option value="${s.id}" ${initStat===s.id?'selected':''}>${esc(s.label)}</option>`).join('');
    document.getElementById('mtitle').textContent=mEditId?`Edit ${issueNum(iss)}`:'New Issue';
    body.innerHTML=`
      <div class="fg"><label>Title *</label><input type="text" id="m-ititle" value="${esc(iss?.title||'')}" placeholder="Brief descriptive title…"/></div>
      <div class="fg3">
        <div class="fg"><label>Type</label><select id="m-itype">${['bug','feature','enhancement','task'].map(t=>`<option value="${t}" ${(iss?.type||'bug')===t?'selected':''}>${typeIcon[t]} ${t}</option>`).join('')}</select></div>
        <div class="fg"><label>Priority</label><select id="m-ipri">${['critical','high','medium','low'].map(p=>`<option value="${p}" ${(iss?.priority||'medium')===p?'selected':''}>${p}</option>`).join('')}</select></div>
        <div class="fg"><label>Status</label><select id="m-istat">${wfOpts}</select></div>
      </div>
      <div class="fg2">
        <div class="fg"><label>Assignee</label><input type="text" id="m-iassign" value="${esc(iss?.assignee||'')}" placeholder="Name…"/></div>
        <div class="fg"><label>Due Date</label><input type="date" id="m-idue" value="${iss?.dueDate||''}"/></div>
      </div>
      <div class="fg"><label>Project</label><select id="m-iproj">${pOpts}</select></div>
      <div class="fg"><label>Description</label><textarea id="m-idesc" placeholder="Steps to reproduce, context…">${esc(iss?.description||'')}</textarea></div>`;
    foot.innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>${mEditId?`<button class="btn btn-danger" onclick="delIssue(${mEditId},true)">Delete</button>`:''}<button class="btn btn-primary" onclick="saveIssue()">Save</button>`;
  }
  document.getElementById('ov').classList.add('open');
  setTimeout(()=>{const f=document.querySelector('#mbody input[type=text]');if(f)f.focus();},80);
}

function selectColor(c){
  document.getElementById('m-pcolor').value=c;
  document.querySelectorAll('[data-color]').forEach(b=>b.style.borderColor=b.dataset.color===c?'#fff':'transparent');
}

function openDetail(id){
  const iss=issues.find(x=>x.id===id); if(!iss)return;
  const proj=getProj(), wf=proj?.workflow||defaultWorkflow();
  const ics=comments.filter(c=>c.issueId===id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const stageLabel=s=>wf.find(w=>w.id===s)?.label||s;
  const stageColor=s=>wf.find(w=>w.id===s)?.color||'var(--muted)';
  document.getElementById('mtitle').textContent=`${issueNum(iss)}${iss.jiraKey?` · 🔗 ${iss.jiraKey}`:''}`;
  document.getElementById('modal').classList.add('modal-wide');
  document.getElementById('mbody').innerHTML=`
    <div class="det-grid">
      <div>
        <div style="font-size:1rem;font-weight:700;margin-bottom:10px;line-height:1.3">${esc(iss.title)}</div>
        <div class="fg" style="margin-bottom:12px"><label>Description</label><div class="desc-box">${esc(iss.description||'No description provided.')}</div></div>
        <div style="font-size:.85rem;font-weight:700;margin-bottom:8px">💬 Comments (${ics.length})</div>
        ${ics.map(c=>`<div class="cmt"><div class="cmt-hdr"><span class="cmt-author">${esc(c.author)}</span><span class="cmt-date">${fmtDate(c.createdAt)}</span></div><div class="cmt-text">${esc(c.text)}</div></div>`).join('')||'<p style="font-size:.8rem;color:var(--muted);margin-bottom:10px">No comments yet.</p>'}
        ${iss.jiraKey
          ?`<div style="background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.15);border-radius:var(--r2);padding:10px;font-size:.78rem;color:var(--sky)">🔗 Imported from Jira (<strong>${esc(iss.jiraKey)}</strong>). Local comments only — nothing written back to Jira.</div>`
          :`<div style="display:flex;gap:7px;margin-top:8px"><textarea id="cmt-text" placeholder="Add a comment…" style="flex:1;min-height:52px"></textarea><button class="btn btn-primary btn-sm" style="align-self:flex-end" onclick="addComment(${id})">Post</button></div>`}
      </div>
      <div class="det-meta">
        <div><div class="dm-lbl">Status</div><div class="dm-val" style="margin-bottom:5px"><span style="color:${stageColor(iss.status)};font-weight:700">${stageLabel(iss.status)}</span></div>
          <select class="fsel" style="font-size:.76rem;width:100%" onchange="quickStatus(${id},this.value)">${wf.map(s=>`<option value="${s.id}" ${iss.status===s.id?'selected':''}>${esc(s.label)}</option>`).join('')}</select>
        </div>
        <div><div class="dm-lbl">Priority</div><div class="dm-val" style="margin-bottom:5px"><span class="pri ${priClass(iss.priority)}">${iss.priority}</span></div>
          <select class="fsel" style="font-size:.76rem;width:100%" onchange="quickPri(${id},this.value)">${['critical','high','medium','low'].map(p=>`<option value="${p}" ${iss.priority===p?'selected':''}>${p}</option>`).join('')}</select>
        </div>
        <div><div class="dm-lbl">Type</div><div class="dm-val">${typeIcon[iss.type]||''} ${iss.type}</div></div>
        <div><div class="dm-lbl">Assignee</div><div class="dm-val">${esc(iss.assignee||'Unassigned')}</div></div>
        <div><div class="dm-lbl">Due Date</div><div class="dm-val">${fmtDate(iss.dueDate)}</div></div>
        <div><div class="dm-lbl">Source</div><div class="dm-val">${iss.jiraKey?`<span class="jira-badge">🔗 Jira</span>`:'💾 Local'}</div></div>
        <div><div class="dm-lbl">Created</div><div class="dm-val">${fmtDate(iss.createdAt)}</div></div>
      </div>
    </div>`;
  document.getElementById('mfoot').innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Close</button><button class="btn btn-danger btn-sm" onclick="delIssue(${id},true)">Delete</button><button class="btn btn-primary" onclick="openModal('issue',${id});closeModal()">Edit</button>`;
  mType='detail';
  document.getElementById('ov').classList.add('open');
}

function closeModal(){document.getElementById('ov').classList.remove('open');mType=mEditId=mInitStatus=null;}
function onOv(e){if(e.target===e.currentTarget)closeModal();}

// ── JIRA SETTINGS ──
function openJiraSettings(projId){
  const p=projects.find(x=>x.id===projId); if(!p)return;
  const j=p.jira||{};
  document.getElementById('mtitle').textContent=`🔗 Jira Settings — ${esc(p.name)}`;
  document.getElementById('modal').className='modal';
  document.getElementById('mbody').innerHTML=`
    <div style="background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.15);border-radius:var(--r2);padding:10px;font-size:.78rem;color:var(--sky)">
      📖 <strong>Read-Only:</strong> Issues are pulled from Jira and cached locally. Nothing is written back to Jira.
    </div>
    <div class="fg"><label>Jira Base URL</label><input type="text" id="j-url" value="${esc(j.baseUrl||'')}" placeholder="https://yourcompany.atlassian.net"/></div>
    <div class="fg"><label>Email / Username</label><input type="text" id="j-email" value="${esc(j.email||'')}" placeholder="you@company.com"/></div>
    <div class="fg"><label>API Token <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" style="color:var(--sky);font-size:.7rem">(get token ↗)</a></label><input type="password" id="j-token" value="${esc(j.apiToken||'')}" placeholder="Your Jira API token…"/></div>
    <div class="fg2">
      <div class="fg"><label>Jira Project Key</label><input type="text" id="j-key" value="${esc(j.projectKey||'')}" placeholder="e.g. PROJ"/></div>
      <div class="fg"><label>Max Issues</label><input type="text" id="j-max" value="${j.maxResults||50}"/></div>
    </div>
    <div class="fg"><label>JQL Filter (optional)</label><input type="text" id="j-jql" value="${esc(j.jql||'')}" placeholder='status != Done ORDER BY created DESC'/></div>
    <div id="j-test-result" style="font-size:.78rem;min-height:18px"></div>`;
  document.getElementById('mfoot').innerHTML=`
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-ghost" onclick="testJira(${projId})">🔌 Test Connection</button>
    <button class="btn btn-primary" onclick="saveJira(${projId})">Save</button>`;
  document.getElementById('ov').classList.add('open');
}

async function testJira(projId){
  const url=document.getElementById('j-url').value.trim();
  const email=document.getElementById('j-email').value.trim();
  const token=document.getElementById('j-token').value.trim();
  const resEl=document.getElementById('j-test-result');
  if(!url||!email||!token){resEl.innerHTML='<span style="color:var(--rose)">Fill in all fields first.</span>';return;}
  resEl.innerHTML='<span class="spin">⏳</span> Testing…';
  try{
    const base=url.replace(/\/$/,'');
    const auth=btoa(`${email}:${token}`);
    const r=await fetch(`${base}/rest/api/3/myself`,{headers:{'Authorization':`Basic ${auth}`,'Accept':'application/json'}});
    if(r.ok){const d=await r.json();resEl.innerHTML=`<span style="color:var(--teal)">✅ Connected as <strong>${esc(d.displayName||email)}</strong></span>`;}
    else resEl.innerHTML=`<span style="color:var(--rose)">❌ ${r.status}: ${r.statusText}</span>`;
  }catch(e){resEl.innerHTML=`<span style="color:var(--rose)">❌ Network error – CORS may block direct browser requests. Try a CORS proxy.</span>`;}
}

async function saveJira(projId){
  const p=projects.find(x=>x.id===projId); if(!p)return;
  p.jira={enabled:true,baseUrl:document.getElementById('j-url').value.trim(),email:document.getElementById('j-email').value.trim(),apiToken:document.getElementById('j-token').value.trim(),projectKey:document.getElementById('j-key').value.trim().toUpperCase(),maxResults:parseInt(document.getElementById('j-max').value)||50,jql:document.getElementById('j-jql').value.trim()};
  await dbp('projects',p);await loadAll();closeModal();toast('Jira settings saved!');
}

async function jiraSync(){const proj=getProj();if(!proj?.jira?.enabled){toast('Configure Jira first in Settings','info');return;}await jiraSyncProject(activeProjId);}

async function jiraSyncProject(projId){
  const p=projects.find(x=>x.id===projId); if(!p?.jira?.enabled)return;
  const j=p.jira;
  toast('🔄 Syncing from Jira…','info');
  try{
    const base=j.baseUrl.replace(/\/$/,'');
    const auth=btoa(`${j.email}:${j.apiToken}`);
    const jql=j.jql||`project=${j.projectKey} ORDER BY created DESC`;
    const url=`${base}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${j.maxResults}&fields=summary,description,status,priority,assignee,issuetype,duedate,created,updated`;
    const r=await fetch(url,{headers:{'Authorization':`Basic ${auth}`,'Accept':'application/json'}});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    const data=await r.json();
    const wf=p.workflow||defaultWorkflow();
    let imported=0,updated=0;
    for(const ji of (data.issues||[])){
      const jiraKey=ji.key;
      const existing=issues.find(i=>i.jiraKey===jiraKey&&i.projectId===projId);
      const jiraStatus=(ji.fields.status?.name||'').toLowerCase();
      let mappedStatus=wf[0]?.id||'open';
      for(const stage of wf){if(stage.label.toLowerCase()===jiraStatus||stage.id===jiraStatus){mappedStatus=stage.id;break;}}
      const jiraPri=(ji.fields.priority?.name||'medium').toLowerCase();
      const priMap={'highest':'critical','high':'high','medium':'medium','low':'low','lowest':'low'};
      const priority=priMap[jiraPri]||'medium';
      const jiraType=(ji.fields.issuetype?.name||'Task').toLowerCase();
      const typeMap={bug:'bug',story:'feature',epic:'feature',task:'task',subtask:'task','new feature':'feature',improvement:'enhancement'};
      const type=typeMap[jiraType]||'task';
      let desc='';
      const rawDesc=ji.fields.description;
      if(rawDesc?.content){desc=rawDesc.content.flatMap(b=>b.content?.map(c=>c.text)||[b.text||'']).join('\n').trim();}
      const item={projectId:projId,title:ji.fields.summary||jiraKey,description:desc,status:mappedStatus,priority,type,assignee:ji.fields.assignee?.displayName||'',dueDate:ji.fields.duedate||'',jiraKey,jiraStatus:ji.fields.status?.name||'',updatedAt:ji.fields.updated||new Date().toISOString(),createdAt:ji.fields.created||new Date().toISOString()};
      if(existing){item.id=existing.id;updated++;}else imported++;
      await dbp('issues',item);
    }
    p.jira.lastSync=new Date().toISOString();
    await dbp('projects',p);await loadAll();
    toast(`✅ Jira sync: ${imported} new, ${updated} updated`);
  }catch(e){toast(`❌ Sync failed: ${e.message}`,'err');console.error(e);}
}

// ── WORKFLOW MODAL ──
function openWorkflowModal(projId){
  const p=projects.find(x=>x.id===projId); if(!p)return;
  const wf=p.workflow||defaultWorkflow();
  document.getElementById('mtitle').textContent=`✏️ Edit Workflow — ${esc(p.name)}`;
  document.getElementById('modal').className='modal';
  const buildRows=stages=>stages.map((s,i)=>`
    <div class="wf-row" data-idx="${i}">
      <input type="color" class="wf-color" value="${s.color}"/>
      <input type="text" class="wf-stage" value="${esc(s.label)}" placeholder="Stage name"/>
      <input type="hidden" class="wf-id" value="${esc(s.id)}"/>
      <button class="ibtn del" onclick="this.closest('.wf-row').remove()">✕</button>
    </div>`).join('');
  document.getElementById('mbody').innerHTML=`
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:8px">Define stages for this project. Issues move left → right through the board.</div>
    <div id="wf-rows">${buildRows(wf)}</div>
    <button class="btn btn-ghost btn-sm" onclick="addWfRow()" style="align-self:flex-start;margin-top:4px">+ Add Stage</button>
    <div style="border-top:1px solid var(--border);padding-top:10px">
      <div style="font-size:.73rem;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.6px">Templates</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-xs" onclick="loadTemplate('software')">🖥️ Software Dev</button>
        <button class="btn btn-ghost btn-xs" onclick="loadTemplate('scrum')">🏃 Scrum</button>
        <button class="btn btn-ghost btn-xs" onclick="loadTemplate('bugtracking')">🐛 Bug Tracking</button>
        <button class="btn btn-ghost btn-xs" onclick="loadTemplate('kanban')">📋 Simple Kanban</button>
      </div>
    </div>`;
  document.getElementById('mfoot').innerHTML=`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveWorkflow(${projId})">Save Workflow</button>`;
  document.getElementById('ov').classList.add('open');
}

function addWfRow(){
  const cols=['#6d28d9','#f59e0b','#10b981','#3b82f6','#f43f5e','#a855f7'];
  const idx=document.querySelectorAll('.wf-row').length;
  const el=document.createElement('div');
  el.className='wf-row';
  el.innerHTML=`<input type="color" class="wf-color" value="${cols[idx%cols.length]}"/><input type="text" class="wf-stage" placeholder="Stage name"/><input type="hidden" class="wf-id" value="stage-${Date.now()}"/><button class="ibtn del" onclick="this.closest('.wf-row').remove()">✕</button>`;
  document.getElementById('wf-rows').appendChild(el);
}

const wfTemplates={
  software:[{id:'backlog',label:'Backlog',color:'#6b7280'},{id:'open',label:'Open',color:'#6d28d9'},{id:'in-progress',label:'In Progress',color:'#f59e0b'},{id:'in-review',label:'In Review',color:'#3b82f6'},{id:'done',label:'Done',color:'#10b981'}],
  scrum:[{id:'product-backlog',label:'Product Backlog',color:'#6b7280'},{id:'sprint-backlog',label:'Sprint Backlog',color:'#6d28d9'},{id:'in-progress',label:'In Progress',color:'#f59e0b'},{id:'testing',label:'Testing',color:'#a855f7'},{id:'done',label:'Done',color:'#10b981'}],
  bugtracking:[{id:'open',label:'Open',color:'#f43f5e'},{id:'triaged',label:'Triaged',color:'#f97316'},{id:'fixing',label:'Fixing',color:'#f59e0b'},{id:'testing',label:'Testing',color:'#a855f7'},{id:'resolved',label:'Resolved',color:'#10b981'},{id:'closed',label:'Closed',color:'#6b7280'}],
  kanban:[{id:'todo',label:'To Do',color:'#6d28d9'},{id:'in-progress',label:'In Progress',color:'#f59e0b'},{id:'done',label:'Done',color:'#10b981'}]
};

function loadTemplate(name){
  const tpl=wfTemplates[name]||wfTemplates.software;
  document.getElementById('wf-rows').innerHTML=tpl.map((s,i)=>`
    <div class="wf-row" data-idx="${i}">
      <input type="color" class="wf-color" value="${s.color}"/>
      <input type="text" class="wf-stage" value="${esc(s.label)}" placeholder="Stage name"/>
      <input type="hidden" class="wf-id" value="${esc(s.id)}"/>
      <button class="ibtn del" onclick="this.closest('.wf-row').remove()">✕</button>
    </div>`).join('');
}

async function saveWorkflow(projId){
  const p=projects.find(x=>x.id===projId); if(!p)return;
  const rows=document.querySelectorAll('.wf-row');
  const wf=[...rows].map(r=>({label:r.querySelector('.wf-stage').value.trim(),id:r.querySelector('.wf-id').value||r.querySelector('.wf-stage').value.toLowerCase().replace(/\s+/g,'-'),color:r.querySelector('.wf-color').value})).filter(s=>s.label);
  if(!wf.length){toast('Add at least one stage','err');return;}
  p.workflow=wf;await dbp('projects',p);await loadAll();closeModal();toast('Workflow saved!');
}

// ── CRUD ──
async function saveProject(){
  const name=document.getElementById('m-pname').value.trim();
  if(!name)return toast('Project name required','err');
  const item={name,color:document.getElementById('m-pcolor').value,description:document.getElementById('m-pdesc').value.trim(),workflow:mEditId?projects.find(p=>p.id===mEditId)?.workflow:defaultWorkflow(),createdAt:new Date().toISOString()};
  if(mEditId)item.id=mEditId;
  const id=await dbp('projects',item);
  if(!mEditId)activeProjId=id;
  await loadAll();closeModal();toast(mEditId?'Updated!':'Project created!');
}
async function delProject(id){
  if(!confirm('Delete project + all issues?'))return;
  const pi=issues.filter(i=>i.projectId===id);
  for(const i of pi){for(const c of comments.filter(c=>c.issueId===i.id))await dbd('comments',c.id);await dbd('issues',i.id);}
  await dbd('projects',id);activeProjId=null;await loadAll();closeModal();toast('Deleted','err');
}
async function saveIssue(){
  const title=document.getElementById('m-ititle').value.trim();
  if(!title)return toast('Title required','err');
  const ex=mEditId?issues.find(x=>x.id===mEditId):null;
  const item={title,type:document.getElementById('m-itype').value,priority:document.getElementById('m-ipri').value,status:document.getElementById('m-istat').value,assignee:document.getElementById('m-iassign').value.trim(),dueDate:document.getElementById('m-idue').value,projectId:parseInt(document.getElementById('m-iproj').value),description:document.getElementById('m-idesc').value.trim(),updatedAt:new Date().toISOString(),jiraKey:ex?.jiraKey||null,createdAt:ex?.createdAt||new Date().toISOString()};
  if(mEditId)item.id=mEditId;
  await dbp('issues',item);await loadAll();closeModal();toast(mEditId?'Updated!':'Issue created!');
}
async function delIssue(id,fromModal=false){
  if(!confirm('Delete this issue?'))return;
  for(const c of comments.filter(c=>c.issueId===id))await dbd('comments',c.id);
  await dbd('issues',id);await loadAll();if(fromModal)closeModal();toast('Deleted','err');
}
async function quickStatus(id,val){const iss=issues.find(x=>x.id===id);if(!iss)return;iss.status=val;iss.updatedAt=new Date().toISOString();await dbp('issues',iss);await loadAll();openDetail(id);toast('Status updated!');}
async function quickPri(id,val){const iss=issues.find(x=>x.id===id);if(!iss)return;iss.priority=val;iss.updatedAt=new Date().toISOString();await dbp('issues',iss);await loadAll();openDetail(id);toast('Priority updated!');}
async function addComment(issueId){const txt=document.getElementById('cmt-text').value.trim();if(!txt)return;await dbp('comments',{issueId,author:'You',text:txt,createdAt:new Date().toISOString()});await loadAll();openDetail(issueId);toast('Comment added!');}

// ── SEED ──
async function seed(){
  const ps=await dba('projects');if(ps.length)return;
  const now=()=>new Date().toISOString();
  const addD=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().split('T')[0];};
  const pid1=await dbp('projects',{name:'Frontend App',color:'#6d28d9',description:'React web application',workflow:wfTemplates.software,createdAt:now()});
  const pid2=await dbp('projects',{name:'API Service',color:'#10b981',description:'Backend REST API',workflow:wfTemplates.bugtracking,createdAt:now()});
  const s1=[
    {title:'Login crashes on Safari',type:'bug',priority:'critical',status:'in-progress',assignee:'Alice',dueDate:addD(2),description:'iOS Safari users see blank screen after login.'},
    {title:'Dashboard slow with large datasets',type:'bug',priority:'high',status:'open',assignee:'Bob',dueDate:addD(5),description:'10k+ records causes 3-5s freeze.'},
    {title:'Add dark mode',type:'feature',priority:'medium',status:'backlog',assignee:'Carol',dueDate:addD(14),description:'Respect prefers-color-scheme.'},
    {title:'CSV export empty file',type:'bug',priority:'high',status:'open',assignee:'Alice',dueDate:addD(3),description:'Regression since v2.3.'},
    {title:'Upgrade to React 19',type:'task',priority:'low',status:'backlog',assignee:'',dueDate:addD(30),description:'Evaluate breaking changes.'},
    {title:'Keyboard shortcuts',type:'enhancement',priority:'medium',status:'done',assignee:'Alice',dueDate:addD(-5),description:'Shipped in v2.4. Cmd+K, Esc to close.'},
  ];
  for(const s of s1)await dbp('issues',{...s,projectId:pid1,createdAt:now(),updatedAt:now()});
  const s2=[
    {title:'Rate limiter too aggressive',type:'bug',priority:'critical',status:'open',assignee:'Dave',dueDate:addD(1),description:'Burst traffic causes false positives.'},
    {title:'Auth token not refreshing',type:'bug',priority:'high',status:'triaged',assignee:'Eve',dueDate:addD(3),description:'Silent 401 errors on expiry.'},
    {title:'Add GraphQL endpoint',type:'feature',priority:'medium',status:'open',assignee:'',dueDate:addD(20),description:'Expose REST resources via GraphQL.'},
    {title:'Write OpenAPI spec',type:'task',priority:'medium',status:'fixing',assignee:'Dave',dueDate:addD(7),description:'Document all v3 endpoints.'},
  ];
  for(const s of s2)await dbp('issues',{...s,projectId:pid2,createdAt:now(),updatedAt:now()});
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openModal('issue');}
});

idb().then(async()=>{await seed();await loadAll();}).catch(e=>{console.error(e);toast('DB error','err');});
