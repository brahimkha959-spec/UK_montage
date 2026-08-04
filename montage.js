let video, overlayCanvas, octx;
let duration = 0;
let clipStart = 0, clipEnd = 0;
let overlays = [];
let selectedId = null;
let musicFile = null;
let pendingImageEl = null;
let currentProjectId = null;
let currentProjectName = 'مشروع بدون عنوان';

/* ---------------- تخزين المشاريع (IndexedDB) ---------------- */
function idbOpen(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open('unteckMontageDB', 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore('projects', {keyPath:'id'}); };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function idbPut(project){
  const db = await idbOpen();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('projects','readwrite');
    tx.objectStore('projects').put(project);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}
async function idbGetAll(){
  const db = await idbOpen();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('projects','readonly');
    const req = tx.objectStore('projects').getAll();
    req.onsuccess = ()=>resolve(req.result || []);
    req.onerror = ()=>reject(req.error);
  });
}
async function idbGet(id){
  const db = await idbOpen();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('projects','readonly');
    const req = tx.objectStore('projects').get(id);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function idbDelete(id){
  const db = await idbOpen();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('projects','readwrite');
    tx.objectStore('projects').delete(id);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}

/* ---------------- شاشة المشاريع ---------------- */
const projectsSection = document.getElementById('projectsSection');
const newProjectForm = document.getElementById('newProjectForm');
document.getElementById('newProjectBtn').addEventListener('click', ()=>{
  projectsSection.style.display = 'none';
  newProjectForm.style.display = 'block';
});
document.getElementById('backToListBtn').addEventListener('click', ()=>{
  newProjectForm.style.display = 'none';
  projectsSection.style.display = 'block';
});
document.getElementById('myProjectsBtn').addEventListener('click', ()=>{
  document.getElementById('workspace').style.display = 'none';
  document.getElementById('landing').style.display = 'flex';
  newProjectForm.style.display = 'none';
  projectsSection.style.display = 'block';
  renderProjectsList();
});

function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

async function renderProjectsList(){
  const list = document.getElementById('projectsList');
  const noProjects = document.getElementById('noProjects');
  list.innerHTML = '';
  let projects = [];
  try{ projects = await idbGetAll(); }catch(e){ projects = []; }
  projects.sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));
  if(projects.length===0){ noProjects.style.display='block'; return; }
  noProjects.style.display='none';
  projects.forEach(p=>{
    const card = document.createElement('div');
    card.className = 'proj-card';
    const thumbSrc = p.thumbnail || '';
    card.innerHTML = `<img class="proj-thumb" src="${thumbSrc}">
      <div class="proj-info"><div class="pname">${escapeHtml(p.name)}</div><div class="pdate">${new Date(p.updatedAt).toLocaleString('ar')}</div></div>
      <button class="proj-del" title="حذف">✕</button>`;
    card.addEventListener('click', e=>{
      if(e.target.closest('.proj-del')) return;
      openProject(p.id);
    });
    card.querySelector('.proj-del').addEventListener('click', async e=>{
      e.stopPropagation();
      if(confirm('حذف هذا المشروع نهائيًا؟')){
        await idbDelete(p.id);
        renderProjectsList();
      }
    });
    list.appendChild(card);
  });
}

async function openProject(id){
  const p = await idbGet(id);
  if(!p) return;
  currentProjectId = p.id;
  currentProjectName = p.name;
  document.getElementById('projTitle').textContent = p.name;
  document.getElementById('landing').style.display = 'none';
  document.getElementById('workspace').style.display = 'flex';
  overlays = []; selectedId = null; musicFile = null;
  loadVideo(p.videoBlob, p.state || null);
}

/* ---------------- شاشة إنشاء المشروع ---------------- */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
dropzone.addEventListener('click', ()=>fileInput.click());
dropzone.addEventListener('dragover', e=>{ e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', ()=> dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e=>{
  e.preventDefault(); dropzone.classList.remove('drag');
  if(e.dataTransfer.files[0]) startProject(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e=>{
  if(e.target.files[0]) startProject(e.target.files[0]);
});

async function startProject(file){
  const name = document.getElementById('projectName').value.trim() || 'مشروع بدون عنوان';
  currentProjectId = 'p_' + Date.now();
  currentProjectName = name;
  document.getElementById('projTitle').textContent = name;
  document.getElementById('landing').style.display = 'none';
  document.getElementById('workspace').style.display = 'flex';
  overlays = []; selectedId = null; musicFile = null;
  loadVideo(file);
  try{
    await idbPut({ id: currentProjectId, name, videoBlob: file, thumbnail:null, state:null, updatedAt: Date.now() });
  }catch(e){ console.warn('تعذر حفظ المشروع تلقائيًا', e); }
}

/* ---------------- حفظ المشروع الحالي ---------------- */
document.getElementById('saveProjectBtn').addEventListener('click', saveCurrentProject);
async function saveCurrentProject(){
  if(!video || !currentProjectId) return;
  const status = document.getElementById('status');
  const btn = document.getElementById('saveProjectBtn');
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = '...جارِ الحفظ';
  try{
    const existing = await idbGet(currentProjectId);
    const videoBlob = existing ? existing.videoBlob : null;

    const serializedOverlays = [];
    for(const o of overlays){
      if(o.type==='text'){
        serializedOverlays.push({ type:'text', text:o.text, color:o.color, size:o.size, x:o.x, y:o.y });
      } else if(o.type==='image'){
        const blob = await imageElementToBlob(o.img);
        serializedOverlays.push({ type:'image', name:o.name, x:o.x, y:o.y, w:o.w, h:o.h, imgBlob:blob });
      }
    }

    const thumbnail = await captureCurrentThumbnail();

    const state = {
      clipStart, clipEnd,
      filters: {
        speed: document.getElementById('speed').value,
        brightness: document.getElementById('brightness').value,
        contrast: document.getElementById('contrast').value,
        saturate: document.getElementById('saturate').value,
        volume: document.getElementById('volume').value
      },
      musicBlob: musicFile || null,
      musicName: musicFile ? musicFile.name : null,
      musicVolume: document.getElementById('musicVolume').value,
      overlays: serializedOverlays
    };

    await idbPut({
      id: currentProjectId,
      name: currentProjectName,
      videoBlob,
      thumbnail,
      state,
      updatedAt: Date.now()
    });
    if(status) status.textContent = '';
  }catch(e){
    console.error(e);
    alert('تعذر حفظ المشروع');
  }
  btn.disabled = false;
  btn.textContent = oldLabel;
}
function imageElementToBlob(img){
  return fetch(img.src).then(r=>r.blob());
}
function captureCurrentThumbnail(){
  return new Promise(resolve=>{
    try{
      const c = document.createElement('canvas');
      c.width = 160; c.height = 90;
      c.getContext('2d').drawImage(video, 0, 0, 160, 90);
      resolve(c.toDataURL('image/jpeg', 0.6));
    }catch(e){ resolve(null); }
  });
}

renderProjectsList();

/* ---------------- تحميل الفيديو ---------------- */
function loadVideo(file, savedState){
  const stageInner = document.getElementById('stageInner');
  stageInner.innerHTML = '';
  video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.playsInline = true;
  stageInner.appendChild(video);

  overlayCanvas = document.createElement('canvas');
  overlayCanvas.id = 'overlayCanvas';
  stageInner.appendChild(overlayCanvas);
  octx = overlayCanvas.getContext('2d');

  video.addEventListener('loadedmetadata', ()=>{
    duration = video.duration;
    clipStart = savedState ? Math.min(savedState.clipStart ?? 0, duration) : 0;
    clipEnd = savedState ? Math.min(savedState.clipEnd ?? duration, duration) : duration;
    document.getElementById('startRange').max = duration;
    document.getElementById('endRange').max = duration;
    document.getElementById('endRange').value = clipEnd;
    document.getElementById('startRange').value = clipStart;
    document.getElementById('tcStart').textContent = fmt(clipStart);
    document.getElementById('tcEnd').textContent = fmt(clipEnd);
    updateRangeSelect();
    overlayCanvas.width = video.videoWidth;
    overlayCanvas.height = video.videoHeight;
    positionOverlayCanvas();

    // بعض المتصفحات لا ترسم أول إطار إلا بعد بدء التشغيل مرة، لهذا نشغّل
    // الفيديو كتمًا للحظة ثم نوقفه فورًا لضمان ظهور الصورة بدل شاشة سوداء
    const wasMuted = video.muted;
    video.muted = true;
    const playPromise = video.play();
    const finish = ()=>{
      video.muted = wasMuted;
      drawOverlay();
      generateThumbnails();
      if(savedState) applySavedState(savedState);
    };
    if(playPromise && playPromise.then){
      playPromise.then(()=>{
        video.pause();
        video.currentTime = clipStart;
        finish();
      }).catch(finish);
    } else {
      finish();
    }
  });

  window.addEventListener('resize', positionOverlayCanvas);

  video.addEventListener('timeupdate', ()=>{
    document.getElementById('tcCurrent').textContent = fmt(video.currentTime);
    const pct = (video.currentTime/duration)*100;
    document.getElementById('playhead').style.left = pct+'%';
    if(video.currentTime >= clipEnd){ video.pause(); document.getElementById('playBtn').textContent='▶ تشغيل'; }
    drawOverlay();
  });

  applyFilters();
  setupOverlayDrag();
}

/* ---------------- استرجاع حالة مشروع محفوظ ---------------- */
async function applySavedState(state){
  if(state.filters){
    const f = state.filters;
    if(f.speed!=null){ document.getElementById('speed').value = f.speed; document.getElementById('speedVal').textContent = parseFloat(f.speed).toFixed(2)+'x'; }
    if(f.brightness!=null){ document.getElementById('brightness').value = f.brightness; document.getElementById('brightnessVal').textContent = f.brightness+'%'; }
    if(f.contrast!=null){ document.getElementById('contrast').value = f.contrast; document.getElementById('contrastVal').textContent = f.contrast+'%'; }
    if(f.saturate!=null){ document.getElementById('saturate').value = f.saturate; document.getElementById('saturateVal').textContent = f.saturate+'%'; }
    if(f.volume!=null){ document.getElementById('volume').value = f.volume; document.getElementById('volumeVal').textContent = f.volume+'%'; }
    applyFilters();
  }
  if(state.musicBlob){
    musicFile = state.musicBlob;
    document.getElementById('musicName').textContent = 'الملف: ' + (state.musicName || 'موسيقى الخلفية');
    document.getElementById('musicVolRow').style.display = 'flex';
    if(state.musicVolume!=null){
      document.getElementById('musicVolume').value = state.musicVolume;
      document.getElementById('musicVolumeVal').textContent = state.musicVolume+'%';
    }
  }
  overlays = [];
  if(Array.isArray(state.overlays)){
    for(const o of state.overlays){
      if(o.type==='text'){
        overlays.push(Object.assign({}, o));
      } else if(o.type==='image' && o.imgBlob){
        const img = await blobToImage(o.imgBlob);
        overlays.push(Object.assign({}, o, {img}));
      }
    }
  }
  renderList();
  drawOverlay();
}
function blobToImage(blob){
  return new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.src = URL.createObjectURL(blob);
  });
}

function positionOverlayCanvas(){
  if(!video || !overlayCanvas) return;
  const w = video.clientWidth, h = video.clientHeight;
  if(w && h){
    overlayCanvas.style.width = w+'px';
    overlayCanvas.style.height = h+'px';
    overlayCanvas.style.left = (video.offsetLeft)+'px';
    overlayCanvas.style.top = (video.offsetTop)+'px';
  }
}

function fmt(t){
  const m = Math.floor(t/60);
  const s = (t%60).toFixed(1);
  return String(m).padStart(2,'0')+':'+String(s).padStart(4,'0');
}
async function generateThumbnails(){
  const row = document.getElementById('thumbRow');
  row.innerHTML = '';
  const count = window.innerWidth < 640 ? 8 : 14;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 80; thumbCanvas.height = 80;
  const tctx = thumbCanvas.getContext('2d');
  const wasTime = video.currentTime;
  const wasPaused = video.paused;
  video.pause();
  for(let i=0;i<count;i++){
    const t = (duration/count) * i + 0.05;
    await new Promise(res=>{
      const onSeek = ()=>{ video.removeEventListener('seeked', onSeek); res(); };
      video.addEventListener('seeked', onSeek);
      video.currentTime = Math.min(t, duration-0.05);
    });
    tctx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const c = document.createElement('canvas');
    c.width = 80; c.height = 80;
    c.getContext('2d').drawImage(thumbCanvas, 0, 0);
    row.appendChild(c);
  }
  video.currentTime = wasTime;
  if(!wasPaused) video.play();
}

function updateRangeSelect(){
  const rs = document.getElementById('rangeSelect');
  rs.style.left = (clipStart/duration*100)+'%';
  rs.style.width = ((clipEnd-clipStart)/duration*100)+'%';
}

document.getElementById('startRange').addEventListener('input', e=>{
  clipStart = Math.min(parseFloat(e.target.value), clipEnd-0.1);
  e.target.value = clipStart;
  document.getElementById('tcStart').textContent = fmt(clipStart);
  updateRangeSelect();
});
document.getElementById('endRange').addEventListener('input', e=>{
  clipEnd = Math.max(parseFloat(e.target.value), clipStart+0.1);
  e.target.value = clipEnd;
  document.getElementById('tcEnd').textContent = fmt(clipEnd);
  updateRangeSelect();
});
document.getElementById('setStartBtn').addEventListener('click', ()=>{
  if(!video) return;
  clipStart = video.currentTime;
  document.getElementById('startRange').value = clipStart;
  document.getElementById('tcStart').textContent = fmt(clipStart);
  updateRangeSelect();
});
document.getElementById('setEndBtn').addEventListener('click', ()=>{
  if(!video) return;
  clipEnd = video.currentTime;
  document.getElementById('endRange').value = clipEnd;
  document.getElementById('tcEnd').textContent = fmt(clipEnd);
  updateRangeSelect();
});
document.getElementById('playBtn').addEventListener('click', ()=>{
  if(!video) return;
  if(video.paused){
    if(video.currentTime < clipStart || video.currentTime >= clipEnd) video.currentTime = clipStart;
    video.play();
    document.getElementById('playBtn').textContent = '⏸ إيقاف';
  } else {
    video.pause();
    document.getElementById('playBtn').textContent = '▶ تشغيل';
  }
});
document.getElementById('strip').addEventListener('click', e=>{
  if(!video) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left)/rect.width;
  video.currentTime = pct*duration;
});

/* ---------------- شريط الأدوات ---------------- */
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const panelName = btn.dataset.panel;
    const toolPanel = document.getElementById('toolPanel');
    const isSame = btn.classList.contains('active');
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tool-content').forEach(p=>p.style.display='none');
    if(isSame){
      toolPanel.classList.remove('open');
    } else {
      btn.classList.add('active');
      document.getElementById('panel-'+panelName).style.display = 'block';
      toolPanel.classList.add('open');
    }
  });
});

/* ---------------- الألوان والسرعة ---------------- */
function applyFilters(){
  if(!video) return;
  const b = document.getElementById('brightness').value;
  const c = document.getElementById('contrast').value;
  const s = document.getElementById('saturate').value;
  video.style.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
  video.volume = document.getElementById('volume').value/100;
  video.playbackRate = parseFloat(document.getElementById('speed').value);
}
['brightness','contrast','saturate'].forEach(id=>{
  document.getElementById(id).addEventListener('input', e=>{
    document.getElementById(id+'Val').textContent = e.target.value+'%';
    applyFilters();
  });
});
document.getElementById('volume').addEventListener('input', e=>{
  document.getElementById('volumeVal').textContent = e.target.value+'%';
  applyFilters();
});
document.getElementById('speed').addEventListener('input', e=>{
  document.getElementById('speedVal').textContent = parseFloat(e.target.value).toFixed(2)+'x';
  applyFilters();
});
document.getElementById('textSize').addEventListener('input', e=>{
  document.getElementById('textSizeVal').textContent = e.target.value;
});

/* ---------------- الموسيقى ---------------- */
document.getElementById('musicInput').addEventListener('change', e=>{
  const f = e.target.files[0];
  if(!f) return;
  musicFile = f;
  document.getElementById('musicName').textContent = 'الملف: ' + f.name;
  document.getElementById('musicVolRow').style.display = 'flex';
});
document.getElementById('musicVolume').addEventListener('input', e=>{
  document.getElementById('musicVolumeVal').textContent = e.target.value+'%';
});

/* ---------------- النصوص والصور ---------------- */
document.getElementById('addTextBtn').addEventListener('click', ()=>{
  const val = document.getElementById('textInput').value.trim();
  if(!val || !overlayCanvas) return;
  overlays.push({
    id: Date.now(), type: 'text', text: val,
    color: document.getElementById('textColor').value,
    size: parseInt(document.getElementById('textSize').value),
    x: overlayCanvas.width/2, y: overlayCanvas.height - 40
  });
  document.getElementById('textInput').value = '';
  renderList(); drawOverlay();
});
document.getElementById('imageInput').addEventListener('change', e=>{
  const f = e.target.files[0];
  if(!f) return;
  const img = new Image();
  img.onload = ()=>{ pendingImageEl = img; addImageOverlay(); };
  img.src = URL.createObjectURL(f);
});
document.getElementById('addImageBtn').addEventListener('click', ()=>{
  if(!pendingImageEl){ document.getElementById('imageInput').click(); return; }
  addImageOverlay();
});
function addImageOverlay(){
  if(!pendingImageEl || !overlayCanvas) return;
  const w = Math.min(overlayCanvas.width*0.4, pendingImageEl.width);
  const h = w * (pendingImageEl.height/pendingImageEl.width);
  overlays.push({
    id: Date.now(), type: 'image', img: pendingImageEl, name:'صورة',
    x: overlayCanvas.width/2, y: overlayCanvas.height/2, w, h
  });
  pendingImageEl = null;
  renderList(); drawOverlay();
}

function renderList(){
  const list = document.getElementById('textList');
  list.innerHTML = '';
  overlays.forEach(item=>{
    const div = document.createElement('div');
    div.className = 'ov-item' + (item.id===selectedId ? ' selected':'');
    const label = item.type==='text' ? item.text : (item.name || 'صورة/GIF');
    div.innerHTML = `<span style="color:${item.type==='text'?item.color:'var(--text)'}">${label}</span>
      <button data-act="dup">نسخ</button>
      <button data-act="del">حذف</button>`;
    div.querySelector('[data-act="del"]').addEventListener('click', ()=>{
      overlays = overlays.filter(t=>t.id!==item.id);
      renderList(); drawOverlay();
    });
    div.querySelector('[data-act="dup"]').addEventListener('click', ()=>{
      const copy = Object.assign({}, item, {id: Date.now(), x: item.x+20, y: item.y+20});
      overlays.push(copy);
      renderList(); drawOverlay();
    });
    div.addEventListener('click', ()=>{ selectedId = item.id; renderList(); drawOverlay(); });
    list.appendChild(div);
  });
}

function drawOverlay(){
  if(!octx) return;
  octx.clearRect(0,0,overlayCanvas.width, overlayCanvas.height);
  overlays.forEach(item=>{
    if(item.type==='text'){
      octx.font = `bold ${item.size}px sans-serif`;
      octx.fillStyle = item.color;
      octx.textAlign = 'center';
      octx.strokeStyle = 'rgba(0,0,0,0.6)';
      octx.lineWidth = 3;
      octx.strokeText(item.text, item.x, item.y);
      octx.fillText(item.text, item.x, item.y);
      if(item.id===selectedId){
        const w = octx.measureText(item.text).width;
        octx.strokeStyle = '#2DD4BF'; octx.lineWidth = 1;
        octx.strokeRect(item.x-w/2-6, item.y-item.size-4, w+12, item.size+14);
      }
    } else if(item.type==='image'){
      octx.drawImage(item.img, item.x-item.w/2, item.y-item.h/2, item.w, item.h);
      if(item.id===selectedId){
        octx.strokeStyle = '#2DD4BF'; octx.lineWidth = 1;
        octx.strokeRect(item.x-item.w/2, item.y-item.h/2, item.w, item.h);
      }
    }
  });
}

function setupOverlayDrag(){
  let dragging = null, offX=0, offY=0;
  function toCanvasCoords(e){
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width/rect.width;
    const scaleY = overlayCanvas.height/rect.height;
    return { x:(e.clientX-rect.left)*scaleX, y:(e.clientY-rect.top)*scaleY };
  }
  function hitTest(x,y){
    for(let i=overlays.length-1;i>=0;i--){
      const item = overlays[i];
      if(item.type==='image'){
        if(x>item.x-item.w/2 && x<item.x+item.w/2 && y>item.y-item.h/2 && y<item.y+item.h/2) return item;
      } else {
        octx.font = `bold ${item.size}px sans-serif`;
        const w = octx.measureText(item.text).width;
        if(x>item.x-w/2-6 && x<item.x+w/2+6 && y>item.y-item.size-4 && y<item.y+14) return item;
      }
    }
    return null;
  }
  overlayCanvas.addEventListener('mousedown', e=>{
    const {x,y} = toCanvasCoords(e);
    const hit = hitTest(x,y);
    if(hit){
      dragging = hit; offX = x-hit.x; offY = y-hit.y;
      selectedId = hit.id; renderList();
      overlayCanvas.classList.add('dragging');
    }
  });
  window.addEventListener('mousemove', e=>{
    if(!dragging) return;
    const {x,y} = toCanvasCoords(e);
    dragging.x = x-offX; dragging.y = y-offY;
    drawOverlay();
  });
  window.addEventListener('mouseup', ()=>{ dragging=null; overlayCanvas.classList.remove('dragging'); });
  overlayCanvas.addEventListener('dblclick', e=>{
    const {x,y} = toCanvasCoords(e);
    const hit = hitTest(x,y);
    if(hit && hit.type==='text'){
      const val = prompt('تعديل النص:', hit.text);
      if(val!==null && val.trim()!==''){ hit.text = val.trim(); drawOverlay(); renderList(); }
    }
  });

  // دعم اللمس على الهاتف
  let lastTap = 0;
  function touchPoint(e){
    const t = e.touches[0] || e.changedTouches[0];
    return { clientX:t.clientX, clientY:t.clientY };
  }
  overlayCanvas.addEventListener('touchstart', e=>{
    const {x,y} = toCanvasCoords(touchPoint(e));
    const hit = hitTest(x,y);
    const now = Date.now();
    if(hit && now - lastTap < 300 && hit.type==='text'){
      const val = prompt('تعديل النص:', hit.text);
      if(val!==null && val.trim()!==''){ hit.text = val.trim(); drawOverlay(); renderList(); }
      lastTap = 0;
      return;
    }
    lastTap = now;
    if(hit){
      dragging = hit; offX = x-hit.x; offY = y-hit.y;
      selectedId = hit.id; renderList();
      e.preventDefault();
    }
  }, {passive:false});
  overlayCanvas.addEventListener('touchmove', e=>{
    if(!dragging) return;
    e.preventDefault();
    const {x,y} = toCanvasCoords(touchPoint(e));
    dragging.x = x-offX; dragging.y = y-offY;
    drawOverlay();
  }, {passive:false});
  overlayCanvas.addEventListener('touchend', ()=>{ dragging=null; });
}

/* ---------------- التصدير ---------------- */
async function runExport(){
  if(!video) return;
  const status = document.getElementById('status');
  const bar = document.getElementById('progressBar');
  const fill = document.getElementById('progressFill');
  document.getElementById('exportBtn').disabled = true;
  document.getElementById('exportBtn2').disabled = true;
  bar.style.display = 'block';
  status.textContent = 'جارِ التحضير...';

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = video.videoWidth;
  exportCanvas.height = video.videoHeight;
  const ectx = exportCanvas.getContext('2d');
  const canvasStream = exportCanvas.captureStream(30);

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();
  try{
    const videoSource = audioCtx.createMediaElementSource(video);
    const videoGain = audioCtx.createGain();
    videoGain.gain.value = parseFloat(document.getElementById('volume').value)/100;
    videoSource.connect(videoGain);
    videoGain.connect(dest);
    videoGain.connect(audioCtx.destination);
  }catch(e){}

  let musicEl = null;
  if(musicFile){
    musicEl = new Audio(URL.createObjectURL(musicFile));
    musicEl.crossOrigin = 'anonymous';
    await new Promise(r=>{ musicEl.oncanplay = r; musicEl.load(); });
    const musicSource = audioCtx.createMediaElementSource(musicEl);
    const musicGain = audioCtx.createGain();
    musicGain.gain.value = parseFloat(document.getElementById('musicVolume').value)/100;
    musicSource.connect(musicGain);
    musicGain.connect(dest);
  }

  const tracks = [...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const combined = new MediaStream(tracks);
  let mimeType = 'video/webm;codecs=vp9,opus';
  if(!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
  const recorder = new MediaRecorder(combined, { mimeType });
  const chunks = [];
  recorder.ondataavailable = e=>{ if(e.data.size>0) chunks.push(e.data); };
  recorder.onstop = ()=>{
    const blob = new Blob(chunks, {type:'video/webm'});
    const url = URL.createObjectURL(blob);
    const link = document.getElementById('downloadLink');
    link.href = url;
    link.download = (document.getElementById('projTitle').textContent || 'montage-export') + '.webm';
    link.click();
    status.textContent = 'تم التصدير بنجاح.';
    bar.style.display = 'none';
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('exportBtn2').disabled = false;
    if(musicEl) musicEl.pause();
  };

  video.pause();
  video.currentTime = clipStart;
  await new Promise(r=>{ video.onseeked = r; });
  video.playbackRate = parseFloat(document.getElementById('speed').value);

  const b = document.getElementById('brightness').value;
  const c = document.getElementById('contrast').value;
  const s = document.getElementById('saturate').value;
  ectx.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;

  recorder.start();
  video.play();
  if(musicEl){ musicEl.currentTime = 0; musicEl.play(); }

  function renderFrame(){
    if(video.currentTime >= clipEnd || video.ended){
      video.pause();
      recorder.stop();
      return;
    }
    ectx.drawImage(video, 0, 0, exportCanvas.width, exportCanvas.height);
    overlays.forEach(item=>{
      ectx.save();
      ectx.filter = 'none';
      if(item.type==='text'){
        ectx.font = `bold ${item.size}px sans-serif`;
        ectx.fillStyle = item.color;
        ectx.textAlign = 'center';
        ectx.strokeStyle = 'rgba(0,0,0,0.6)';
        ectx.lineWidth = 3;
        ectx.strokeText(item.text, item.x, item.y);
        ectx.fillText(item.text, item.x, item.y);
      } else if(item.type==='image'){
        ectx.drawImage(item.img, item.x-item.w/2, item.y-item.h/2, item.w, item.h);
      }
      ectx.restore();
    });
    const pct = Math.min(100, ((video.currentTime-clipStart)/(clipEnd-clipStart))*100);
    fill.style.width = pct+'%';
    status.textContent = 'جارِ التصدير... ' + Math.round(pct) + '%';
    requestAnimationFrame(renderFrame);
  }
  renderFrame();
}
document.getElementById('exportBtn').addEventListener('click', ()=>{
  // فتح لوحة التصدير أيضًا لعرض التقدم
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tool-content').forEach(p=>p.style.display='none');
  document.querySelector('[data-panel="export"]').classList.add('active');
  document.getElementById('panel-export').style.display = 'block';
  document.getElementById('toolPanel').classList.add('open');
  runExport();
});
document.getElementById('exportBtn2').addEventListener('click', runExport);