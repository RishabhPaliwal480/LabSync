(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const contextPath = ($('meta[name="context-path"]')?.content || '').replace(/\/$/, '');
  const storeKey = 'labsync-demo-state-v1';
  let backendMode = false;
  let backendReady = Promise.resolve();
  let currentUser = null;
  let activeView = 'overview';
  let searchText = '';
  let categoryFilter = 'all';
  let issueFilter = 'all';

  const isoDate = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const localSeed = () => ({
    resources: [
      {id:1,name:'Raspberry Pi 5 Kit',category:'IoT & Embedded',lab:'IoT Studio',location:'Shelf A · Kit 04',description:'Pi 5 board, power supply, camera cable and case.',status:'AVAILABLE',active:true},
      {id:2,name:'GPU Workstation 03',category:'Computing',lab:'AI Lab',location:'Row B · Seat 03',description:'GPU-enabled workstation for model training and simulation.',status:'AVAILABLE',active:true},
      {id:3,name:'Arduino Mega Kit',category:'IoT & Embedded',lab:'Embedded Systems Lab',location:'Cabinet C · Kit 02',description:'Arduino Mega board, USB cable and sensor bundle.',status:'AVAILABLE',active:true},
      {id:4,name:'Network Analyzer NA-02',category:'Networking',lab:'Network Lab',location:'Bench 02',description:'Network analysis kit. Reported for a faulty display cable.',status:'MAINTENANCE',active:true},
      {id:5,name:'Epson Projector P-01',category:'AV Equipment',lab:'Seminar Room',location:'Wall cabinet · 01',description:'Portable projector and HDMI adapter.',status:'AVAILABLE',active:true},
      {id:6,name:'Logic Analyzer LA-01',category:'Digital Electronics',lab:'Digital Lab',location:'Bench 05',description:'16-channel logic analyzer for digital circuit debugging.',status:'UNAVAILABLE',active:true}
    ],
    bookings: [
      {id:1,userId:2,resourceId:1,date:isoDate(1),startTime:'10:00',endTime:'11:00',purpose:'IoT sensor integration',status:'CONFIRMED',resourceName:'Raspberry Pi 5 Kit',category:'IoT & Embedded',lab:'IoT Studio',userName:'Aarav Sharma'},
      {id:2,userId:2,resourceId:3,date:isoDate(3),startTime:'13:30',endTime:'14:30',purpose:'Embedded systems practical',status:'CONFIRMED',resourceName:'Arduino Mega Kit',category:'IoT & Embedded',lab:'Embedded Systems Lab',userName:'Aarav Sharma'},
      {id:3,userId:3,resourceId:5,date:isoDate(-2),startTime:'09:00',endTime:'10:00',purpose:'Seminar presentation',status:'COMPLETED',resourceName:'Epson Projector P-01',category:'AV Equipment',lab:'Seminar Room',userName:'Meera Joshi'}
    ],
    issues: [
      {id:1,resourceId:4,reporterId:2,title:'Display cable intermittently disconnects',description:'The analyzer display loses signal when the cable is moved. Please check the connector before the next lab session.',severity:'MEDIUM',status:'IN_PROGRESS',createdAt:new Date().toISOString(),resourceName:'Network Analyzer NA-02',lab:'Network Lab',reporterName:'Aarav Sharma'}
    ],
    nextResourceId:7, nextBookingId:4, nextIssueId:2
  });
  function loadLocal() {
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) { const seed = localSeed(); localStorage.setItem(storeKey, JSON.stringify(seed)); return seed; }
      const data = JSON.parse(raw);
      if (!data.resources || !data.bookings || !data.issues) throw new Error('Invalid demo state');
      return data;
    } catch (_) { return localSeed(); }
  }
  let data = loadLocal();
  function saveLocal() { try { localStorage.setItem(storeKey, JSON.stringify(data)); } catch (_) { /* private browsing may disable storage */ } }
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const titleCase = value => String(value || '').toLowerCase().replace(/(^|[_\s-])\w/g, s => s.toUpperCase()).replace('_',' ');
  const initials = name => String(name || 'LS').split(/\s+/).slice(0,2).map(s => s[0] || '').join('').toUpperCase();
  const todayText = () => new Date().toLocaleDateString('en-IN',{weekday:'long',month:'long',day:'numeric'});
  const monthName = date => { const d = new Date(`${date}T12:00:00`); return d.toLocaleDateString('en-US',{month:'short'}).toUpperCase(); };
  const dayName = date => { const d = new Date(`${date}T12:00:00`); return String(d.getDate()).padStart(2,'0'); };
  const timeLabel = t => { if(!t) return ''; const [h,m]=t.split(':').map(Number); const suffix=h>=12?'PM':'AM'; const hh=((h+11)%12)+1; return `${hh}:${String(m).padStart(2,'0')} ${suffix}`; };
  const isAdmin = () => currentUser?.role === 'ADMIN';
  const userBookings = () => data.bookings.filter(b => isAdmin() || Number(b.userId) === Number(currentUser?.id));
  const userIssues = () => data.issues.filter(i => isAdmin() || Number(i.reporterId) === Number(currentUser?.id));
  const openIssues = () => data.issues.filter(i => i.status !== 'RESOLVED');
  const availableResources = () => data.resources.filter(r => r.active !== false && r.status === 'AVAILABLE' && !openIssues().some(i => Number(i.resourceId) === Number(r.id)));
  const statusLabel = status => ({AVAILABLE:'Available',MAINTENANCE:'Maintenance',UNAVAILABLE:'Unavailable',CONFIRMED:'Confirmed',CANCELLED:'Cancelled',COMPLETED:'Completed',OPEN:'Open',IN_PROGRESS:'In repair',RESOLVED:'Resolved'})[status] || titleCase(status);
  const statusClass = status => `status-${String(status || '').toLowerCase()}`;
  const categoryIcon = category => {
    const text = String(category || '').toLowerCase();
    if (text.includes('comput') || text.includes('gpu') || text.includes('ai')) return 'GPU';
    if (text.includes('network')) return 'NET';
    if (text.includes('av') || text.includes('project')) return 'AV';
    if (text.includes('digital') || text.includes('logic')) return 'IO';
    if (text.includes('iot') || text.includes('embedded') || text.includes('arduino')) return 'IoT';
    return 'LAB';
  };

  async function fetchApi(path, method = 'GET', body = undefined) {
    const response = await fetch(`${contextPath}/api${path}`, {
      method,
      credentials:'same-origin',
      headers: body === undefined ? {'Accept':'application/json'} : {'Accept':'application/json','Content-Type':'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let result = {};
    try { result = await response.json(); } catch (_) { result = {}; }
    if (!response.ok) { const error = new Error(result.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
    return result;
  }
  async function checkBackend() {
    try {
      await fetchApi('/status'); backendMode = true;
      const me = await fetchApi('/auth/me');
      if (me.authenticated) { currentUser = me; await refreshServerData(); enterWorkspace(); }
      $('#connectionLabel').textContent = 'Connected to Java server';
    } catch (_) {
      backendMode = false;
      $('#connectionLabel').textContent = 'Demo workspace';
    }
  }
  async function refreshServerData() {
    const [resources, bookings, issues] = await Promise.all([fetchApi('/resources'), fetchApi('/bookings'), fetchApi('/issues')]);
    data.resources = resources; data.bookings = bookings; data.issues = issues;
    if (isAdmin()) data.adminSummary = await fetchApi('/admin/summary');
  }
  async function trySignIn(email, password) {
    await backendReady;
    if (backendMode) {
      try {
        currentUser = await fetchApi('/auth/login','POST',{email,password});
        await refreshServerData();
        saveLocal(); enterWorkspace(); closeAuth(); toast(`Welcome back, ${currentUser.name.split(' ')[0]}.`); return true;
      } catch (err) { if (err.status !== undefined) throw err; backendMode = false; }
    }
    const normalized = email.trim().toLowerCase();
    let role, name, id;
    if (normalized === 'admin@labsync.local' && password === 'admin123') { role='ADMIN';name='LabSync Administrator';id=1; }
    else if (['student@labsync.local','meera@labsync.local'].includes(normalized) && password === 'student123') { role='STUDENT';name=normalized.startsWith('meera')?'Meera Joshi':'Aarav Sharma';id=normalized.startsWith('meera')?3:2; }
    else throw new Error('Use one of the demo credentials shown below, or deploy the Java backend.');
    currentUser={authenticated:true,id,name,email:normalized,role};
    $('#connectionLabel').textContent = 'Demo workspace';
    enterWorkspace(); closeAuth(); toast(`Welcome back, ${name.split(' ')[0]}.`); return true;
  }
  async function quickDemo(role) {
    await backendReady;
    if (backendMode) {
      try {
        const credentials = role === 'ADMIN' ? {email:'admin@labsync.local',password:'admin123'} : {email:'student@labsync.local',password:'student123'};
        currentUser = await fetchApi('/auth/login','POST',credentials);
        await refreshServerData();
        $('#connectionLabel').textContent = 'Connected to Java server';
        enterWorkspace(); closeAuth(); toast(`Demo opened as ${currentUser.role === 'ADMIN' ? 'administrator' : 'student'}.`); return;
      } catch (err) { if (err.status !== undefined) { toast(err.message,'error'); return; } backendMode=false; }
    }
    currentUser = role === 'ADMIN'
      ? {authenticated:true,id:1,name:'LabSync Administrator',email:'admin@labsync.local',role:'ADMIN'}
      : {authenticated:true,id:2,name:'Aarav Sharma',email:'student@labsync.local',role:'STUDENT'};
    $('#connectionLabel').textContent = 'Demo workspace';
    enterWorkspace(); closeAuth(); toast(`Demo opened as ${role === 'ADMIN' ? 'administrator' : 'student'}.`);
  }

  function enterWorkspace() {
    $('#landing').hidden = true; $('#workspace').hidden = false;
    $('#sidebarUserName').textContent = currentUser.name;
    $('#sidebarUserRole').textContent = isAdmin() ? 'Administrator' : 'Student';
    $('#userAvatar').textContent = initials(currentUser.name); $('#topbarAvatar').textContent = initials(currentUser.name);
    const issueLink = $('[data-view="issues"]'); if (issueLink) issueLink.innerHTML = `<span>⌁</span>${isAdmin()?'Issues & repairs':'Report an issue'}`;
    const bookingLink = $('[data-view="bookings"]'); if (bookingLink) bookingLink.innerHTML = `<span>◷</span>${isAdmin()?'All bookings':'My bookings'}`;
    renderView();
    window.scrollTo({top:0,behavior:'instant'});
  }
  function showLanding() { $('#workspace').hidden = true; $('#landing').hidden = false; window.scrollTo({top:0,behavior:'smooth'}); }
  function closeAuth(){ $('#authModal').hidden=true; $('#loginError').hidden=true; }
  function openAuth(){ $('#authModal').hidden=false; setTimeout(()=>$('#loginEmail').focus(),80); }
  function showAction(html){ $('#actionModalContent').innerHTML=html; $('#actionModal').hidden=false; }
  function closeAction(){ $('#actionModal').hidden=true; $('#actionModalContent').innerHTML=''; }
  function toast(message, type='success'){
    const node=document.createElement('div');node.className=`toast ${type==='error'?'error':''}`;node.innerHTML=`<span>${type==='error'?'!':'✓'}</span><div>${escapeHtml(message)}</div>`;
    $('#toastRegion').appendChild(node);setTimeout(()=>{node.style.opacity='0';node.style.transform='translateY(5px)';setTimeout(()=>node.remove(),250)},3500);
  }
  function navigate(view){activeView=view;searchText='';categoryFilter='all';issueFilter='all';$$('[data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));renderView();}
  function renderView(){
    if (!currentUser) return;
    const names={overview:'Overview',resources:isAdmin()?'Resource inventory':'Resources',bookings:isAdmin()?'All bookings':'My bookings',issues:isAdmin()?'Issues & repairs':'Report an issue'};
    $('#currentCrumb').textContent=names[activeView]||'Overview';
    if(activeView==='overview') $('#view').innerHTML=renderOverview();
    if(activeView==='resources') $('#view').innerHTML=renderResources();
    if(activeView==='bookings') $('#view').innerHTML=renderBookings();
    if(activeView==='issues') $('#view').innerHTML=renderIssues();
    syncSideNav();
  }
  function syncSideNav(){ $$('[data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===activeView)); }
  function renderOverview(){
    const resources=data.resources.filter(r=>r.active!==false), bookings=userBookings(), upcoming=bookings.filter(b=>b.status==='CONFIRMED'&&b.date>=isoDate(0)).sort((a,b)=>(a.date+a.startTime).localeCompare(b.date+b.startTime));
    const ready=availableResources().length, issues=openIssues();
    const metrics=isAdmin()?[
      ['Active resources',resources.length,'in your inventory','▦',false],['Ready to book',ready,'available right now','↗',true],['Upcoming bookings',bookings.filter(b=>b.status==='CONFIRMED'&&b.date>=isoDate(0)).length,'confirmed time slots','◷',false],['Open issues',issues.length,'need a follow-up','!',false]
    ]:[['Ready to book',ready,'resources available now','↗',true],['Your bookings',upcoming.length,'upcoming sessions','◷',false],['Open lab issues',issues.length,'across all resources','!',false],['Labs represented',new Set(resources.map(r=>r.lab)).size,'connected spaces','⌘',false]];
    const topResources=resources.slice().sort((a,b)=>{const rank=s=>s.status==='AVAILABLE'?0:s.status==='MAINTENANCE'?1:2;return rank(a.status)-rank(b.status)}).slice(0,4);
    const shownBookings=(isAdmin()?bookings:upcoming).slice().sort((a,b)=>(a.date+a.startTime).localeCompare(b.date+b.startTime)).slice(0,4);
    return `<div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-number">${isAdmin()?'ADMIN':'STUDENT'} / 01</span> ${todayText().toUpperCase()}</div><h1>${greeting()}, <em>${escapeHtml(currentUser.name.split(' ')[0])}.</em></h1><p>${isAdmin()?'Here is the current pulse of your lab. Spot an issue, check a booking, or keep resources ready.':'Your next practical should be about the work—not finding equipment. Here is your lab at a glance.'}</p></div><div class="heading-actions"><button class="button button-dark" data-action="quick-book">＋ Book a resource</button></div></div>
    <div class="metric-grid">${metrics.map((m,i)=>`<div class="metric-card ${m[4]?'metric-dark':''}"><div class="metric-label">${m[0]}<span>${m[3]}</span></div><div class="metric-value">${m[1].toString().padStart(2,'0')} <small>${i===0&&isAdmin()?'/ total':''}</small></div><div class="metric-foot">${m[2]}</div></div>`).join('')}</div>
    ${isAdmin()?`<div class="admin-banner"><div><strong>Administrator workspace</strong><p>Inventory status and maintenance are connected. Resolve open issues to make resources bookable again.</p></div><span>CONTROL ROOM ↗</span></div>`:''}
    <div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-heading">Resource pulse</div><div class="panel-subheading">The equipment most likely to need your attention</div></div><button class="panel-action" data-view="resources">${isAdmin()?'Manage inventory':'View all resources'} ↗</button></div><div class="panel-body">${topResources.map(r=>`<div class="resource-line"><div class="resource-icon ${iconTone(r.category)}">${escapeHtml(categoryIcon(r.category))}</div><div class="resource-line-main"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.lab)} · ${escapeHtml(r.location||'')}</small></div><span class="status-pill ${statusClass(r.status)}">${statusLabel(r.status)}</span></div>`).join('')}</div></section>
    <section class="panel"><div class="panel-header"><div><div class="panel-heading">${isAdmin()?'Next bookings':'Coming up next'}</div><div class="panel-subheading">${isAdmin()?'Upcoming reservations across the labs':'Your confirmed time slots'}</div></div><button class="panel-action" data-view="bookings">View ${isAdmin()?'all':'bookings'} ↗</button></div><div class="panel-body">${shownBookings.length?shownBookings.map(bookingRow).join(''):`<div class="empty-state"><div class="empty-glyph">◷</div><strong>No upcoming bookings</strong><p>Reserve a resource for your next practical session.</p><button class="small-button" data-action="quick-book">Book a resource ↗</button></div>`}</div></section></div>
    <section class="panel"><div class="panel-header"><div><div class="panel-heading">What needs attention</div><div class="panel-subheading">Latest reports from the lab floor</div></div><button class="panel-action" data-view="issues">Open issue desk ↗</button></div><div class="panel-body">${issues.length?issues.slice(0,3).map(activityRow).join(''):`<div class="empty-state"><div class="empty-glyph">✳</div><strong>All clear for now</strong><p>No open maintenance issues. If something breaks, report it before the next booking.</p></div>`}</div></section>`;
  }
  function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<17?'Good afternoon':'Good evening';}
  function iconTone(cat){const x=String(cat||'').toLowerCase();return x.includes('network')?'network':x.includes('comput')?'computing':(x.includes('digital')||x.includes('hardware'))?'hardware':'';}
  function bookingRow(b){return `<div class="booking-row"><div class="date-box"><span>${monthName(b.date)}</span><strong>${dayName(b.date)}</strong></div><div class="booking-main"><strong>${escapeHtml(b.resourceName||resourceName(b.resourceId))}</strong><small>${escapeHtml(b.lab||'Lab resource')} · ${escapeHtml(b.purpose||'Practical session')}</small></div><div class="booking-time">${timeLabel(b.startTime)}<br /><span class="status-pill ${statusClass(b.status)}">${statusLabel(b.status)}</span></div></div>`;}
  function activityRow(issue){return `<div class="activity-row"><i class="activity-dot ${['HIGH','CRITICAL'].includes(issue.severity)?'orange':''}"></i><div><strong>${escapeHtml(issue.title)}</strong><p>${escapeHtml(issue.resourceName||resourceName(issue.resourceId))} · ${escapeHtml(issue.description)}</p></div><time>${statusLabel(issue.status)}</time></div>`;}
  function resourceName(id){return data.resources.find(r=>Number(r.id)===Number(id))?.name||'Lab resource';}
  function renderResources(){
    const resources=data.resources.filter(r=>r.active!==false).filter(r=>(r.name+' '+r.category+' '+r.lab+' '+r.location).toLowerCase().includes(searchText.toLowerCase())).filter(r=>categoryFilter==='all'||r.category===categoryFilter);
    const cats=[...new Set(data.resources.map(r=>r.category).filter(Boolean))];
    return `<div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-number">02</span> INVENTORY / ${String(data.resources.length).padStart(2,'0')} ITEMS</div><h1>${isAdmin()?'Keep the lab <em>ready.</em>':'Find your <em>next tool.</em>'}</h1><p>${isAdmin()?'Manage your shared kit and update equipment status. Unresolved issues keep resources out of the booking pool.':'Search by equipment or lab. Every resource shows whether it is ready, in maintenance, or unavailable.'}</p></div><div class="heading-actions">${isAdmin()?'<button class="button button-dark" data-action="add-resource">＋ Add resource</button>':'<button class="button button-dark" data-action="quick-book">＋ Quick book</button>'}</div></div>
    <div class="resource-toolbar"><div class="search-field"><input type="search" id="resourceSearch" value="${escapeHtml(searchText)}" placeholder="Search resource, category, or lab…" aria-label="Search resources" /></div><select id="categoryFilter" aria-label="Filter category"><option value="all">All categories</option>${cats.map(c=>`<option value="${escapeHtml(c)}" ${categoryFilter===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select><span class="server-pill"><i></i>${availableResources().length} resources ready</span></div>
    <div class="resource-grid">${resources.length?resources.map(resourceCard).join(''):`<div class="panel empty-large"><div class="empty-state"><div class="empty-glyph">⌕</div><strong>No matches found</strong><p>Try another search term or clear the category filter.</p><button class="small-button" data-action="clear-resource-filters">Clear filters</button></div></div>`}</div>
    ${isAdmin()?`<section class="panel"><div class="panel-header"><div><div class="panel-heading">Inventory controls</div><div class="panel-subheading">Set a resource's operational status</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>RESOURCE</th><th>LAB</th><th>STATUS</th><th>CHANGE STATUS</th></tr></thead><tbody>${data.resources.filter(r=>r.active!==false).map(r=>`<tr><td><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.category)}</small></td><td>${escapeHtml(r.lab)}</td><td><span class="status-pill ${statusClass(r.status)}">${statusLabel(r.status)}</span></td><td><select class="inline-select" data-resource-status="${r.id}" aria-label="Set status for ${escapeHtml(r.name)}"><option value="AVAILABLE" ${r.status==='AVAILABLE'?'selected':''}>Available</option><option value="MAINTENANCE" ${r.status==='MAINTENANCE'?'selected':''}>Maintenance</option><option value="UNAVAILABLE" ${r.status==='UNAVAILABLE'?'selected':''}>Unavailable</option></select></td></tr>`).join('')}</tbody></table></div></section>`:''}`;
  }
  function resourceCard(r){
    const blocked=r.status!=='AVAILABLE'||openIssues().some(i=>Number(i.resourceId)===Number(r.id));
    return `<article class="resource-card"><div class="resource-card-top"><div class="resource-card-icon ${iconTone(r.category)}">${escapeHtml(categoryIcon(r.category))}</div><span class="status-pill ${statusClass(r.status)}">${statusLabel(r.status)}</span></div><div class="resource-category">${escapeHtml(r.category)}</div><h3>${escapeHtml(r.name)}</h3><div class="resource-line-main"><small>${escapeHtml(r.lab)} · ${escapeHtml(r.location||'')}</small></div><p>${escapeHtml(r.description||'Shared resource available for lab sessions.')}</p><div class="resource-card-foot"><small>${blocked?'Not bookable right now':'Ready for a practical'}</small><button class="small-button" ${isAdmin()?`data-resource-details="${r.id}"`:`data-book="${r.id}"`} ${blocked?'disabled':''}>${isAdmin()?'View details':'Book resource'} ↗</button></div></article>`;
  }
  function renderBookings(){
    const list=userBookings().slice().sort((a,b)=>(b.date+b.startTime).localeCompare(a.date+a.startTime));
    const active=list.filter(b=>b.status==='CONFIRMED'), history=list.filter(b=>b.status!=='CONFIRMED');
    return `<div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-number">03</span> ${isAdmin()?'RESERVATION LOG':'YOUR SCHEDULE'}</div><h1>${isAdmin()?'Every session, <em>in sync.</em>':'Your time, <em>well spent.</em>'}</h1><p>${isAdmin()?'Review reservations across all students and cancel a slot if plans change.':'Your reservations in one tidy place. Please cancel a slot if you no longer need it.'}</p></div><div class="heading-actions"><button class="button button-dark" data-action="quick-book">＋ New booking</button></div></div>
    <div class="filter-tabs" style="margin-bottom:16px"><button class="filter-tab active" data-bookings-filter="active">Confirmed · ${active.length}</button><button class="filter-tab" data-bookings-filter="history">Past & cancelled · ${history.length}</button><button class="filter-tab" data-bookings-filter="all">All bookings · ${list.length}</button></div>
    <section class="panel"><div class="panel-header"><div><div class="panel-heading" id="bookingTableHeading">Confirmed bookings</div><div class="panel-subheading">Time-slot clashes are blocked when a booking is created</div></div><span class="server-pill"><i></i>${list.length} records</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>RESOURCE / STUDENT</th><th>DATE</th><th>TIME</th><th>PURPOSE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody id="bookingRows">${bookingTableRows(active)}</tbody></table></div></section>
    <div class="page-note" style="margin-top:15px"><b>Booking rule</b> A resource must be available, free in the selected time slot, and clear of unresolved issues.</div>`;
  }
  function bookingTableRows(list){if(!list.length)return `<tr><td colspan="6"><div class="empty-state"><div class="empty-glyph">◷</div><strong>No bookings in this view</strong><p>Create a booking for your next practical session.</p></div></td></tr>`;return list.map(b=>`<tr><td><strong>${escapeHtml(b.resourceName||resourceName(b.resourceId))}</strong><small>${isAdmin()?escapeHtml(b.userName||'Student')+' · ':''}${escapeHtml(b.lab||'Lab resource')}</small></td><td>${escapeHtml(b.date)}</td><td>${timeLabel(b.startTime)} – ${timeLabel(b.endTime)}</td><td>${escapeHtml(b.purpose)}</td><td><span class="status-pill ${statusClass(b.status)}">${statusLabel(b.status)}</span></td><td>${b.status==='CONFIRMED'?`<button class="table-action" data-cancel="${b.id}">Cancel ↗</button>`:'—'}</td></tr>`).join('');}
  function renderIssues(){
    const list=userIssues().filter(i=>issueFilter==='all'||(issueFilter==='open'?i.status!=='RESOLVED':i.status==='RESOLVED')).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    const openCount=userIssues().filter(i=>i.status!=='RESOLVED').length;
    return `<div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-number">04</span> MAINTENANCE / ISSUE DESK</div><h1>${isAdmin()?'Keep the lab <em>healthy.</em>':'Flag it. <em>Fix it.</em>'}</h1><p>${isAdmin()?'Triage reported faults and close them when the equipment is ready. Resolving the last open issue restores bookability unless the resource was manually marked unavailable.':'Report faulty equipment so nobody books a resource that is not ready. Track your reports here.'}</p></div><div class="heading-actions">${isAdmin()?`<span class="status-pill status-open">${openCount} open issues</span>`:'<button class="button button-dark" data-action="report-issue">＋ Report an issue</button>'}</div></div>
    ${!isAdmin()?`<div class="page-note"><b>Good to know</b> Reporting a fault flags the resource for maintenance, preventing new bookings until the issue is resolved.</div>`:`<div class="admin-banner"><div><strong>Maintenance queue</strong><p>Keep statuses current. Mark a ticket resolved only when the equipment has been checked.</p></div><span>${openCount} OPEN ↗</span></div>`}
    <div class="filter-tabs" style="margin-bottom:15px"><button class="filter-tab ${issueFilter==='all'?'active':''}" data-issues-filter="all">All reports</button><button class="filter-tab ${issueFilter==='open'?'active':''}" data-issues-filter="open">Open · ${openCount}</button><button class="filter-tab ${issueFilter==='resolved'?'active':''}" data-issues-filter="resolved">Resolved</button></div>
    <section class="panel"><div class="panel-header"><div><div class="panel-heading">${isAdmin()?'Reported issues':'Your reports'}</div><div class="panel-subheading">${list.length} ${list.length===1?'ticket':'tickets'} in this view</div></div></div>${list.length?list.map(issueCard).join(''):`<div class="empty-state empty-large"><div class="empty-glyph">✳</div><strong>${issueFilter==='resolved'?'No resolved reports here':'Nothing to see here'}</strong><p>${isAdmin()?'No issue matches this filter.':'Your reported issues will show up here.'}</p>${!isAdmin()?'<button class="small-button" data-action="report-issue">Report an issue ↗</button>':''}</div>`}</section>`;
  }
  function issueCard(i){return `<article class="issue-card"><div class="issue-severity ${String(i.severity).toLowerCase()}">${['HIGH','CRITICAL'].includes(i.severity)?'!':'⌁'}</div><div class="issue-main"><h3>${escapeHtml(i.title)}</h3><div class="issue-meta">${escapeHtml(i.resourceName||resourceName(i.resourceId))} · ${escapeHtml(i.lab||'Lab')} · Reported by ${escapeHtml(i.reporterName||'you')}</div><p>${escapeHtml(i.description)}</p></div><div class="issue-actions"><span class="status-pill ${statusClass(i.severity)}">${titleCase(i.severity)} priority</span><span class="status-pill ${statusClass(i.status)}">${statusLabel(i.status)}</span>${isAdmin()&&i.status!=='RESOLVED'?`<select class="inline-select" data-issue-status="${i.id}" aria-label="Update issue status"><option value="OPEN" ${i.status==='OPEN'?'selected':''}>Open</option><option value="IN_PROGRESS" ${i.status==='IN_PROGRESS'?'selected':''}>In repair</option><option value="RESOLVED">Resolved</option></select>`:''}</div></article>`;}
  function renderBookingModal(preselectedId){
    const ready=availableResources();
    if(!ready.length){showAction(`<div class="modal-kicker">NO RESOURCES READY</div><h2>Nothing to book<br><em>just yet.</em></h2><p class="modal-description">Every resource is either reserved for maintenance or unavailable. Check again after a repair is resolved.</p><div class="modal-footer"><button class="button button-secondary" data-action="close-action">Close</button><button class="button button-dark" data-action="go-issues">View issue desk ↗</button></div>`);return;}
    showAction(`<div class="modal-kicker">RESOURCE RESERVATION</div><h2>Make some<br><em>lab time.</em></h2><p class="modal-description">Pick a resource and a time slot. LabSync checks for conflicts before saving.</p><form id="bookingForm" class="form-stack"><div><label class="field-label" for="bookingResource">Resource</label><select id="bookingResource" name="resourceId" required class="field-control">${ready.map(r=>`<option value="${r.id}" ${Number(preselectedId)===Number(r.id)?'selected':''}>${escapeHtml(r.name)} · ${escapeHtml(r.lab)}</option>`).join('')}</select></div><div class="form-grid-two"><label>Date<input type="date" name="date" min="${isoDate(0)}" value="${isoDate(1)}" required /></label><label>Purpose<input name="purpose" maxlength="250" placeholder="e.g. IoT practical" required /></label><label>Start time<input type="time" name="startTime" value="10:00" required /></label><label>End time<input type="time" name="endTime" value="11:00" required /></label></div><div class="form-error" id="bookingError" hidden></div><div class="modal-footer"><button type="button" class="button button-secondary" data-action="close-action">Not now</button><button class="button button-dark" type="submit">Confirm booking <span>↗</span></button></div></form>`);
  }
  function renderIssueModal(preselectedId){
    const res=data.resources.filter(r=>r.active!==false);
    showAction(`<div class="modal-kicker">MAINTENANCE REQUEST</div><h2>Something not<br><em>working right?</em></h2><p class="modal-description">Give the lab team enough detail to find and fix the fault.</p><form id="issueForm" class="form-stack"><label>Resource<select class="field-control" name="resourceId" required>${res.map(r=>`<option value="${r.id}" ${Number(preselectedId)===Number(r.id)?'selected':''}>${escapeHtml(r.name)} · ${escapeHtml(r.lab)}</option>`).join('')}</select></label><label>What is the issue?<input name="title" required maxlength="160" placeholder="e.g. Power cable is damaged" /></label><label>Details<textarea name="description" required maxlength="800" placeholder="What happened? When does it occur? Any error shown?"></textarea></label><label>Priority<select class="field-control" name="severity"><option value="LOW">Low — minor inconvenience</option><option value="MEDIUM" selected>Medium — affects use</option><option value="HIGH">High — blocks practical work</option><option value="CRITICAL">Critical — safety or lab-wide impact</option></select></label><div class="form-error" id="issueError" hidden></div><div class="modal-footer"><button type="button" class="button button-secondary" data-action="close-action">Cancel</button><button class="button button-dark" type="submit">Submit report <span>↗</span></button></div></form>`);
  }
  function renderResourceModal(){showAction(`<div class="modal-kicker">INVENTORY / NEW ITEM</div><h2>Add a lab<br><em>resource.</em></h2><p class="modal-description">Keep the record specific so students can find the right equipment.</p><form id="resourceForm" class="form-stack"><label>Resource name<input name="name" maxlength="140" required placeholder="e.g. Digital Multimeter DM-01" /></label><div class="form-grid-two"><label>Category<select class="field-control" name="category" required><option>IoT & Embedded</option><option>Computing</option><option>Networking</option><option>AV Equipment</option><option>Digital Electronics</option><option>Hardware</option><option>Other</option></select></label><label>Lab / room<input name="lab" maxlength="100" required placeholder="e.g. Digital Lab" /></label></div><label>Location label<input name="location" maxlength="100" required placeholder="e.g. Bench 04" /></label><label>Description<textarea name="description" maxlength="500" placeholder="What's included and any notes?"></textarea></label><div class="modal-footer"><button type="button" class="button button-secondary" data-action="close-action">Cancel</button><button class="button button-dark" type="submit">Add resource <span>↗</span></button></div></form>`);}

  async function submitBooking(form){
    const fd=new FormData(form);const payload={resourceId:Number(fd.get('resourceId')),date:String(fd.get('date')),startTime:String(fd.get('startTime')),endTime:String(fd.get('endTime')),purpose:String(fd.get('purpose')).trim()};
    if(payload.endTime<=payload.startTime){$('#bookingError').textContent='The end time must be after the start time.';$('#bookingError').hidden=false;return;}
    if(payload.date===isoDate(0)&&payload.startTime<new Date().toTimeString().slice(0,5)){toast('Choose a future time.','error');return;}
    const resource=data.resources.find(r=>Number(r.id)===payload.resourceId);if(!resource||resource.status!=='AVAILABLE'||openIssues().some(i=>Number(i.resourceId)===payload.resourceId)){$('#bookingError').textContent='This resource is not bookable while it is unavailable or has an open issue.';$('#bookingError').hidden=false;return;}
    if(!backendMode){const conflict=data.bookings.some(b=>Number(b.resourceId)===payload.resourceId&&b.date===payload.date&&b.status==='CONFIRMED'&&payload.startTime<b.endTime&&payload.endTime>b.startTime);if(conflict){$('#bookingError').textContent='That time slot is already booked. Choose another time.';$('#bookingError').hidden=false;return;}}
    try{
      if(backendMode){await fetchApi('/bookings','POST',payload);await refreshServerData();}
      else{const record={id:data.nextBookingId++,userId:currentUser.id,resourceId:payload.resourceId,date:payload.date,startTime:payload.startTime,endTime:payload.endTime,purpose:payload.purpose,status:'CONFIRMED',resourceName:resource.name,category:resource.category,lab:resource.lab,userName:currentUser.name};data.bookings.push(record);saveLocal();}
      closeAction();navigate('bookings');toast('Booking confirmed. Your time slot is saved.');
    }catch(err){$('#bookingError').textContent=err.message;$('#bookingError').hidden=false;}
  }
  async function submitIssue(form){
    const fd=new FormData(form);const payload={resourceId:Number(fd.get('resourceId')),title:String(fd.get('title')).trim(),description:String(fd.get('description')).trim(),severity:String(fd.get('severity'))};
    try{
      if(backendMode){await fetchApi('/issues','POST',payload);await refreshServerData();}
      else{const r=data.resources.find(r=>Number(r.id)===payload.resourceId);const record={id:data.nextIssueId++,resourceId:payload.resourceId,reporterId:currentUser.id,title:payload.title,description:payload.description,severity:payload.severity,status:'OPEN',createdAt:new Date().toISOString(),resourceName:r.name,lab:r.lab,reporterName:currentUser.name};data.issues.unshift(record);if(r.status!=='UNAVAILABLE')r.status='MAINTENANCE';saveLocal();}
      closeAction();navigate('issues');toast('Issue reported. The resource is flagged for maintenance.');
    }catch(err){$('#issueError').textContent=err.message;$('#issueError').hidden=false;}
  }
  async function submitResource(form){
    const fd=new FormData(form);const payload={name:String(fd.get('name')).trim(),category:String(fd.get('category')),lab:String(fd.get('lab')).trim(),location:String(fd.get('location')).trim(),description:String(fd.get('description')||'').trim()};
    try{
      if(backendMode){await fetchApi('/resources','POST',payload);await refreshServerData();}
      else{data.resources.push({id:data.nextResourceId++,...payload,status:'AVAILABLE',active:true});saveLocal();}
      closeAction();navigate('resources');toast('Resource added to inventory.');
    }catch(err){toast(err.message,'error');}
  }
  async function cancelBooking(id){
    const b=data.bookings.find(x=>Number(x.id)===Number(id));if(!b)return;if(!confirm(`Cancel booking for ${b.resourceName||resourceName(b.resourceId)} on ${b.date}?`))return;
    try{if(backendMode){await fetchApi(`/bookings/${id}/cancel`,'POST',{});await refreshServerData();}else{b.status='CANCELLED';saveLocal();}renderView();toast('Booking cancelled.');}
    catch(err){toast(err.message,'error');}
  }
  async function updateResourceStatus(id,status){
    const resource=data.resources.find(r=>Number(r.id)===Number(id));if(!resource)return;
    try{if(backendMode){await fetchApi(`/resources/${id}/status`,'POST',{status});await refreshServerData();}else{if(status==='AVAILABLE'&&openIssues().some(i=>Number(i.resourceId)===Number(resource.id)))throw new Error('Resolve the open issue before making this resource available.');resource.status=status;saveLocal();}renderView();toast(`${resource.name} is now ${statusLabel(status).toLowerCase()}.`);}
    catch(err){toast(err.message,'error');renderView();}
  }
  async function updateIssueStatus(id,status){
    const issue=data.issues.find(i=>Number(i.id)===Number(id));if(!issue)return;
    try{
      if(backendMode){await fetchApi(`/issues/${id}/status`,'POST',{status});await refreshServerData();}
      else{issue.status=status;const resource=data.resources.find(r=>Number(r.id)===Number(issue.resourceId));if(resource){const stillOpen=data.issues.some(i=>Number(i.resourceId)===Number(resource.id)&&i.status!=='RESOLVED');if(status!=='RESOLVED'&&resource.status!=='UNAVAILABLE')resource.status='MAINTENANCE';else if(!stillOpen&&resource.status==='MAINTENANCE')resource.status='AVAILABLE';}saveLocal();}
      renderView();toast('Issue status updated.');
    }catch(err){toast(err.message,'error');renderView();}
  }

  document.addEventListener('click', async event => {
    const actionEl=event.target.closest('[data-action]');
    if(actionEl){
      const action=actionEl.dataset.action;
      if(action==='login')openAuth();
      else if(action==='close-auth')closeAuth();
      else if(action==='close-action')closeAction();
      else if(action==='demo-student')await quickDemo('STUDENT');
      else if(action==='demo-admin')await quickDemo('ADMIN');
      else if(action==='logout'){if(backendMode){try{await fetchApi('/auth/logout','POST',{});}catch(_){}}currentUser=null;activeView='overview';showLanding();toast('You have signed out.');}
      else if(action==='home')showLanding();
      else if(action==='quick-book')renderBookingModal();
      else if(action==='report-issue')renderIssueModal();
      else if(action==='add-resource')renderResourceModal();
      else if(action==='go-issues'){closeAction();navigate('issues');}
      else if(action==='clear-resource-filters'){searchText='';categoryFilter='all';renderView();}
      else if(action==='profile')toast(`${currentUser.name} · ${currentUser.email}`);
      return;
    }
    const viewEl=event.target.closest('[data-view]');if(viewEl){event.preventDefault();navigate(viewEl.dataset.view);return;}
    const bookEl=event.target.closest('[data-book]');if(bookEl){renderBookingModal(bookEl.dataset.book);return;}
    const resourceDetailsEl=event.target.closest('[data-resource-details]');if(resourceDetailsEl){const r=data.resources.find(x=>Number(x.id)===Number(resourceDetailsEl.dataset.resourceDetails));if(r)toast(`${r.name} · ${r.lab} · ${statusLabel(r.status)}${openIssues().some(i=>Number(i.resourceId)===Number(r.id))?' · open maintenance issue':''}`);return;}
    const cancelEl=event.target.closest('[data-cancel]');if(cancelEl){await cancelBooking(cancelEl.dataset.cancel);return;}
    const filterEl=event.target.closest('[data-bookings-filter]');if(filterEl){$$('[data-bookings-filter]').forEach(b=>b.classList.toggle('active',b===filterEl));const filter=filterEl.dataset.bookingsFilter;const list=userBookings().slice().sort((a,b)=>(b.date+b.startTime).localeCompare(a.date+a.startTime));const chosen=filter==='active'?list.filter(b=>b.status==='CONFIRMED'):filter==='history'?list.filter(b=>b.status!=='CONFIRMED'):list;$('#bookingRows').innerHTML=bookingTableRows(chosen);$('#bookingTableHeading').textContent=filter==='active'?'Confirmed bookings':filter==='history'?'Past & cancelled bookings':'All bookings';return;}
    const issueFilterEl=event.target.closest('[data-issues-filter]');if(issueFilterEl){issueFilter=issueFilterEl.dataset.issuesFilter;$('#view').innerHTML=renderIssues();return;}
  });
  document.addEventListener('submit', async event => {
    if(event.target.id==='loginForm'){
      event.preventDefault();const email=$('#loginEmail').value,password=$('#loginPassword').value;$('#loginError').hidden=true;
      try{await trySignIn(email,password);}catch(err){$('#loginError').textContent=err.message;$('#loginError').hidden=false;}return;
    }
    if(event.target.id==='bookingForm'){event.preventDefault();await submitBooking(event.target);return;}
    if(event.target.id==='issueForm'){event.preventDefault();await submitIssue(event.target);return;}
    if(event.target.id==='resourceForm'){event.preventDefault();await submitResource(event.target);return;}
  });
  document.addEventListener('input',event=>{if(event.target.id==='resourceSearch'){searchText=event.target.value;const resourceGrid=$('.resource-grid');if(resourceGrid){resourceGrid.innerHTML=data.resources.filter(r=>r.active!==false).filter(r=>(r.name+' '+r.category+' '+r.lab+' '+r.location).toLowerCase().includes(searchText.toLowerCase())).filter(r=>categoryFilter==='all'||r.category===categoryFilter).map(resourceCard).join('')||`<div class="panel empty-large"><div class="empty-state"><div class="empty-glyph">⌕</div><strong>No matches found</strong><p>Try another search term or clear the category filter.</p><button class="small-button" data-action="clear-resource-filters">Clear filters</button></div></div>`;}}});
  document.addEventListener('change',async event=>{
    if(event.target.id==='categoryFilter'){categoryFilter=event.target.value;renderView();return;}
    if(event.target.matches('[data-resource-status]')){await updateResourceStatus(event.target.dataset.resourceStatus,event.target.value);return;}
    if(event.target.matches('[data-issue-status]')){await updateIssueStatus(event.target.dataset.issueStatus,event.target.value);return;}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeAuth();closeAction();}});
  $('#authModal').addEventListener('click',event=>{if(event.target===$('#authModal'))closeAuth();});
  $('#actionModal').addEventListener('click',event=>{if(event.target===$('#actionModal'))closeAction();});

  // Startup: use the real servlet/JDBC API when this page is deployed to Tomcat;
  // if opened directly from disk, the same UI runs in persistent browser-demo mode.
  backendReady = checkBackend();
})();
