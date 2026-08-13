/* ═══════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════ */
let cfg={
  url:'', domains:[], pin:'',
  quickNavBtns:[],
  disableRightClick:true, disableZoom:true, disableSelect:false,
  disableShortcuts:true, blockPopups:true,
  strictMode:true, idleTimeout:0, hideToolbar:false,
  vkEnabled:true, vkAutoShow:true, vkMode:'fixed', vkLayout:'en', vkWidth:100, vkHeight:56, vkFont:20,
  vkFloatX:20, vkFloatY:null,
};
let activityLog=[];
let pinBuffer='', pinPurpose='';
let idleTimer=null, ict=null;
let navHistory=[], navIndex=-1;
// Whether the guard overlay is enabled
let guardActive=false;
let adminTapCount=0;
let adminTapLastTouch=0;
let vkTarget=null;
let vkFrameFocused=false;
let vkIframeDoc=null;
let vkShift=false;
let vkHideTimer=null;
let vkDragging=false;
let vkDragOffsetX=0;
let vkDragOffsetY=0;
let vkKeepVisibleUntil=0;
let vkLastReason='init';
let vkManualHidden=false;
let vkManualHideTimer=null;
let vkLastPointerIntentAt=0;
let vkProbeTimer=null;
let vkForcedOpen=false;
let vkStateCheckPending=false;


/* ═══════════════════════════════════════════════════
   PERSISTENCE
═══════════════════════════════════════════════════ */
function loadCfg(){try{const s=localStorage.getItem('ks_cfg');if(s)cfg={...cfg,...JSON.parse(s)}}catch(e){}try{const l=localStorage.getItem('ks_log');if(l)activityLog=JSON.parse(l)}catch(e){}}
function saveCfg(){try{localStorage.setItem('ks_cfg',JSON.stringify(cfg))}catch(e){}}
function saveLog(){try{localStorage.setItem('ks_log',JSON.stringify(activityLog))}catch(e){}}

/* ═══════════════════════════════════════════════════
   ACTIVITY LOG
═══════════════════════════════════════════════════ */
function log(type,msg){const ts=new Date().toTimeString().slice(0,8);activityLog.push({ts,type,msg});if(activityLog.length>300)activityLog=activityLog.slice(-300);saveLog()}
function renderLog(){const el=document.getElementById('activity-log');if(!activityLog.length){el.innerHTML='<div class="log-entry"><span class="log-info">No activity yet.</span></div>';return}el.innerHTML=activityLog.slice().reverse().slice(0,150).map(e=>`<div class="log-entry"><span class="log-time">${e.ts}</span><span class="log-${e.type}">${e.msg.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span></div>`).join('')}
function clearActivity(){activityLog=[];saveLog();renderLog();showToast('Log cleared','ok')}

/* ═══════════════════════════════════════════════════
   SETTINGS TABS
═══════════════════════════════════════════════════ */
let activeTab=0;
function switchTab(i){activeTab=i;document.querySelectorAll('.sp-tab').forEach((t,ti)=>t.classList.toggle('active',ti===i));document.querySelectorAll('.sp-pane').forEach((p,pi)=>p.classList.toggle('active',pi===i));if(i===5)renderLog();if(i===1)renderQNavList();if(i===3)renderDomainList();if(i===4)renderVirtualKeyboardSettings()}
function tryOpenSettings(){if(cfg.pin)showPIN('settings');else openSettings()}
function openSettings(){
  document.getElementById('cfg-url').value=cfg.url;
  document.getElementById('cfg-idle').value=cfg.idleTimeout||0;
  document.getElementById('tog-rightclick').checked=cfg.disableRightClick;
  document.getElementById('tog-zoom').checked=cfg.disableZoom;
  document.getElementById('tog-select').checked=cfg.disableSelect;
  document.getElementById('tog-shortcuts').checked=cfg.disableShortcuts;
  document.getElementById('tog-popups').checked=cfg.blockPopups;
  document.getElementById('tog-strict').checked=cfg.strictMode;
  document.getElementById('tog-hide-toolbar').checked=cfg.hideToolbar;
  document.getElementById('tog-vk-enabled').checked=cfg.vkEnabled;
  document.getElementById('tog-vk-autoshow').checked=cfg.vkAutoShow!==false;
  document.getElementById('cfg-vk-mode').value=cfg.vkMode||'fixed';
  document.getElementById('cfg-vk-layout').value=cfg.vkLayout||'en';
  document.getElementById('cfg-pin').value='';
  document.getElementById('cfg-pin-new').value='';
  document.getElementById('cfg-pin-confirm').value='';
  renderDomainList();renderQNavList();renderVirtualKeyboardSettings();refreshUpdateState();switchTab(0);
  document.getElementById('settings-overlay').classList.add('open');
}
function closeSettings(){document.getElementById('settings-overlay').classList.remove('open');syncVirtualKeyboardToFocus()}
function saveSettings(){
  const newUrl=document.getElementById('cfg-url').value.trim();
  cfg.disableRightClick=document.getElementById('tog-rightclick').checked;
  cfg.disableZoom=document.getElementById('tog-zoom').checked;
  cfg.disableSelect=document.getElementById('tog-select').checked;
  cfg.disableShortcuts=document.getElementById('tog-shortcuts').checked;
  cfg.blockPopups=document.getElementById('tog-popups').checked;
  cfg.strictMode=document.getElementById('tog-strict').checked;
  cfg.hideToolbar=document.getElementById('tog-hide-toolbar').checked;
  cfg.vkEnabled=document.getElementById('tog-vk-enabled').checked;
  cfg.vkAutoShow=document.getElementById('tog-vk-autoshow').checked;
  cfg.vkMode=document.getElementById('cfg-vk-mode').value;
  cfg.vkLayout=document.getElementById('cfg-vk-layout').value;
  cfg.vkWidth=parseInt(document.getElementById('cfg-vk-width').value)||100;
  cfg.vkHeight=parseInt(document.getElementById('cfg-vk-height').value)||56;
  cfg.vkFont=parseInt(document.getElementById('cfg-vk-font').value)||20;
  cfg.idleTimeout=parseInt(document.getElementById('cfg-idle').value)||0;
  saveCfg();applySettings();closeSettings();
  if(newUrl&&newUrl!==cfg.url){cfg.url=newUrl;saveCfg();navigateTo(newUrl)}
  log('info','Settings saved');showToast('Settings saved','ok');
}

/* ═══════════════════════════════════════════════════
   APPLY SETTINGS
═══════════════════════════════════════════════════ */
function applySettings(){
  document.oncontextmenu=cfg.disableRightClick?e=>{e.preventDefault();return false}:null;
  document.querySelector('meta[name=viewport]').content=cfg.disableZoom
    ?'width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no'
    :'width=device-width,initial-scale=1.0';
  document.body.style.userSelect=cfg.disableSelect?'none':'';
  document.body.style.webkitUserSelect=cfg.disableSelect?'none':'';
  document.getElementById('app').classList.toggle('toolbar-hidden',!!cfg.hideToolbar);
  applyVirtualKeyboardStyle();
  resetIdleTimer();
  updateUrlBar(cfg.url||'');
  document.getElementById('status-dot').className=cfg.url?'live':'';
  renderQuickNavBtns();
  // Guard overlay: active whenever domain list is non-empty
  updateGuard();
  if(!cfg.vkEnabled)hideVirtualKeyboard(true);else syncVirtualKeyboardToFocus();
}

/* ═══════════════════════════════════════════════════
   DOMAIN GUARD OVERLAY
   The transparent overlay originally intercepted every iframe tap, but that
   prevents inputs and links from receiving focus/clicks. Domain enforcement is
   handled by navigation checks instead, so the overlay stays disabled.
═══════════════════════════════════════════════════ */
function updateGuard(){
  guardActive = false;
  document.getElementById('click-guard').classList.remove('active');
}

// Called when a click hits the guard overlay
function guardClick(e){
  if(e)e.preventDefault();
}

/* ═══════════════════════════════════════════════════
   PIN
═══════════════════════════════════════════════════ */
function showPIN(purpose){hideVirtualKeyboard(true);pinPurpose=purpose;pinBuffer='';renderPinDots();document.getElementById('pin-hint').textContent='Enter 4-digit PIN';document.getElementById('pin-cancel-btn').style.display=purpose==='idle'?'none':'';document.getElementById('pin-overlay').classList.add('show')}
function pinCancel(){document.getElementById('pin-overlay').classList.remove('show');syncVirtualKeyboardToFocus()}
function pinKey(k){if(k==='clear')pinBuffer='';else if(k==='back')pinBuffer=pinBuffer.slice(0,-1);else if(pinBuffer.length<4)pinBuffer+=k;renderPinDots();if(pinBuffer.length===4)setTimeout(checkPin,100)}
function renderPinDots(err){for(let i=0;i<4;i++){const d=document.getElementById('pd'+i);d.className='pin-dot'+(i<pinBuffer.length?' filled':'')+(err?' error':'')}}
function checkPin(){if(pinBuffer===cfg.pin){document.getElementById('pin-overlay').classList.remove('show');if(pinPurpose==='settings')openSettings();if(pinPurpose==='idle')wakeFromIdle();pinBuffer=''}else{renderPinDots(true);document.getElementById('pin-hint').textContent='Incorrect PIN';setTimeout(()=>{pinBuffer='';renderPinDots();document.getElementById('pin-hint').textContent='Enter 4-digit PIN'},800);log('block','Wrong PIN')}}
function savePIN(){const cur=document.getElementById('cfg-pin').value,nw=document.getElementById('cfg-pin-new').value,cf=document.getElementById('cfg-pin-confirm').value;if(cfg.pin&&cur!==cfg.pin){showToast('Current PIN incorrect','error');return}if(nw&&nw.length!==4){showToast('PIN must be 4 digits','error');return}if(nw!==cf){showToast('PINs do not match','error');return}cfg.pin=nw;saveCfg();showToast(nw?'PIN updated':'PIN removed','ok');log('info',nw?'PIN updated':'PIN removed')}

/* ═══════════════════════════════════════════════════
   HIDDEN ADMIN GESTURE
═══════════════════════════════════════════════════ */
function onAdminTriggerTouch(){
  const now=Date.now();
  if(now-adminTapLastTouch>1000){
    adminTapCount=0;
  }
  adminTapLastTouch=now;
  adminTapCount++;

  resetVirtualKeyboardManualHide();
  if(document.getElementById('settings-overlay').classList.contains('open'))return;
  if(document.getElementById('pin-overlay').classList.contains('show'))return;
  if(document.getElementById('idle-screen').classList.contains('show'))return;

  if(adminTapCount>=5){
    adminTapCount=0;
    tryOpenSettings();
  }
}

/* ═══════════════════════════════════════════════════
   VIRTUAL KEYBOARD
═══════════════════════════════════════════════════ */
const VK_LAYOUTS={
  en:{
    default:[['1','2','3','4','5','6','7','8','9','0'],['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l','Bksp'],['Shift','z','x','c','v','b','n','m','.','Enter'],['Hide','Space','Left','Right']],
    shift:[['!','@','#','$','%','^','&','*','(',')'],['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L','Bksp'],['Shift','Z','X','C','V','B','N','M','?','Enter'],['Hide','Space','Left','Right']]
  },
  numeric:{
    default:[['1','2','3'],['4','5','6'],['7','8','9'],['-','0','.'],['Hide','Bksp','Enter']]
  },
  fr:{
    default:[['1','2','3','4','5','6','7','8','9','0'],['a','z','e','r','t','y','u','i','o','p'],['q','s','d','f','g','h','j','k','l','m'],['Shift','w','x','c','v','b','n',',','.','Enter'],['Hide','Space','Left','Right']],
    shift:[['!','@','#','$','%','^','&','*','(',')'],['A','Z','E','R','T','Y','U','I','O','P'],['Q','S','D','F','G','H','J','K','L','M'],['Shift','W','X','C','V','B','N',';','?','Enter'],['Hide','Space','Left','Right']]
  },
  de:{
    default:[['1','2','3','4','5','6','7','8','9','0'],['q','w','e','r','t','z','u','i','o','p'],['a','s','d','f','g','h','j','k','l','ö'],['Shift','y','x','c','v','b','n','m','ü','Enter'],['Hide','Space','Left','Right']],
    shift:[['!','"','§','$','%','&','/','(',')','='],['Q','W','E','R','T','Z','U','I','O','P'],['A','S','D','F','G','H','J','K','L','Ö'],['Shift','Y','X','C','V','B','N','M','Ü','Enter'],['Hide','Space','Left','Right']]
  },
  es:{
    default:[['1','2','3','4','5','6','7','8','9','0'],['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l','ñ'],['Shift','z','x','c','v','b','n','m',',','Enter'],['Hide','Space','Left','Right']],
    shift:[['!','"','#','$','%','&','/','(',')','='],['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L','Ñ'],['Shift','Z','X','C','V','B','N','M',';','Enter'],['Hide','Space','Left','Right']]
  }
};

function renderVirtualKeyboardSettings(){
  const width=document.getElementById('cfg-vk-width');
  const height=document.getElementById('cfg-vk-height');
  const font=document.getElementById('cfg-vk-font');
  if(!width||!height||!font)return;
  width.value=cfg.vkWidth||100;
  height.value=cfg.vkHeight||56;
  font.value=cfg.vkFont||20;
  document.getElementById('cfg-vk-width-val').textContent=`${width.value}%`;
  document.getElementById('cfg-vk-height-val').textContent=`${height.value}px`;
  document.getElementById('cfg-vk-font-val').textContent=`${font.value}px`;
  width.oninput=()=>document.getElementById('cfg-vk-width-val').textContent=`${width.value}%`;
  height.oninput=()=>document.getElementById('cfg-vk-height-val').textContent=`${height.value}px`;
  font.oninput=()=>document.getElementById('cfg-vk-font-val').textContent=`${font.value}px`;
}

function getCurrentVkLayout(){
  const layout=VK_LAYOUTS[cfg.vkLayout]||VK_LAYOUTS.en;
  return vkShift&&layout.shift?layout.shift:layout.default;
}

function vkKeySpan(key){
  if(key==='Space')return 4;
  if(['Hide','Shift','Bksp','Enter'].includes(key))return 2;
  return 1;
}

function vkKeyLabel(key){
  return {Bksp:'⌫',Enter:'↵',Left:'←',Right:'→',Hide:'Hide',Shift:'Shift',Space:'Space'}[key]||key;
}

function renderVirtualKeyboard(force=false){
  const rowsEl=document.getElementById('vk-rows');
  const badge=document.getElementById('vk-layout-badge');
  if(!rowsEl||!badge)return;
  const signature=`${cfg.vkLayout||'en'}|${cfg.vkMode||'fixed'}|${vkShift?'1':'0'}`;
  if(!force&&rowsEl.dataset.signature===signature&&rowsEl.children.length){
    badge.textContent=`${(cfg.vkLayout||'en').toUpperCase()} / ${(cfg.vkMode||'fixed').toUpperCase()}`;
    return;
  }
  rowsEl.dataset.signature=signature;
  rowsEl.innerHTML='';
  badge.textContent=`${(cfg.vkLayout||'en').toUpperCase()} / ${(cfg.vkMode||'fixed').toUpperCase()}`;
  getCurrentVkLayout().forEach(row=>{
    const rowEl=document.createElement('div');
    rowEl.className='vk-row';
    rowEl.style.gridTemplateColumns=`repeat(${row.reduce((sum,key)=>sum+vkKeySpan(key),0)}, minmax(0, 1fr))`;
    row.forEach(key=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='vk-key';
      if(['Hide','Shift','Bksp','Enter'].includes(key))btn.classList.add('utility');
      if(key==='Enter'||key==='Shift')btn.classList.add('primary');
      if(key==='Shift'&&vkShift)btn.classList.add('active');
      btn.style.gridColumn=`span ${vkKeySpan(key)}`;
      btn.textContent=vkKeyLabel(key);
      btn.addEventListener('pointerdown',e=>{
        e.preventDefault();
        handleVirtualKey(key);
      });
      rowEl.appendChild(btn);
    });
    rowsEl.appendChild(rowEl);
  });
}

function applyVirtualKeyboardStyle(){
  const vk=document.getElementById('vk-overlay');
  if(!vk)return;
  vk.classList.toggle('floating',cfg.vkMode==='floating');
  let style=document.getElementById('vk-dynamic-style');
  if(!style){
    style=document.createElement('style');
    style.id='vk-dynamic-style';
    document.head.appendChild(style);
  }
  style.textContent=`#vk-overlay{width:${cfg.vkWidth||100}%} .vk-key{min-height:${cfg.vkHeight||56}px;font-size:${cfg.vkFont||20}px}`;
  if(cfg.vkMode==='floating'){
    const top=cfg.vkFloatY==null?Math.max(80,window.innerHeight-380):cfg.vkFloatY;
    const left=cfg.vkFloatX==null?20:cfg.vkFloatX;
    vk.style.left=`${left}px`;
    vk.style.top=`${top}px`;
    vk.style.bottom='auto';
    vk.style.transform='none';
  }else{
    vk.style.left='50%';
    vk.style.top='auto';
    vk.style.bottom='0';
    vk.style.transform=vk.classList.contains('visible')?'translate(-50%,0)':'translate(-50%,105%)';
  }
}

function isVirtualKeyboardInput(el){
  if(!el||!el.isConnected)return false;
  if(el.closest('#vk-overlay')||el.closest('#pin-overlay'))return false;
  if(el.matches('textarea'))return !el.readOnly&&!el.disabled;
  if(el.matches('input')){
    const type=(el.type||'text').toLowerCase();
    if(['button','checkbox','color','file','hidden','image','radio','range','reset','submit'].includes(type))return false;
    return !el.readOnly&&!el.disabled;
  }
  return !!el.isContentEditable;
}

function getIframeVirtualKeyboardTarget(){
  setupIframeKeyboardTracking();
  try{
    const doc=frame.contentDocument;
    if(!doc)return null;
    const el=doc.activeElement;
    return isVirtualKeyboardInput(el)?el:null;
  }catch(e){
    return null;
  }
}

function setupIframeKeyboardTracking(){
  try{
    const doc=frame.contentDocument;
    if(!doc||vkIframeDoc===doc||doc.__ksVkTracking)return;
    doc.__ksVkTracking=true;
    vkIframeDoc=doc;
    const syncFromIframe=()=>{
      const active=doc.activeElement;
      if(isVirtualKeyboardInput(active)){
        vkTarget=active;
        vkFrameFocused=true;
        vkKeepVisibleUntil=Date.now()+1500;
        clearTimeout(vkHideTimer);
        if(cfg.vkEnabled&&cfg.vkAutoShow&&(hasRecentVirtualKeyboardPointerIntent()||isVirtualKeyboardVisible()))showVirtualKeyboard('iframe-active');
        return;
      }
      if(vkTarget&&vkTarget.ownerDocument===doc)vkTarget=null;
      vkFrameFocused=false;
      queueVirtualKeyboardHide();
    };
    doc.addEventListener('focusin',e=>{
      if(isVirtualKeyboardInput(e.target)){
        vkTarget=e.target;
        vkFrameFocused=true;
        vkKeepVisibleUntil=Date.now()+1500;
        clearTimeout(vkHideTimer);
        if(cfg.vkEnabled&&cfg.vkAutoShow&&(hasRecentVirtualKeyboardPointerIntent()||isVirtualKeyboardVisible()))showVirtualKeyboard('iframe-focusin');
      }
    },true);
    doc.addEventListener('focusout',e=>{
      if(isVirtualKeyboardInput(e.target))setTimeout(syncFromIframe,80);
    },true);
    doc.addEventListener('pointerdown',e=>{
      const target=e.target;
      if(isVirtualKeyboardInput(target)){
        resetVirtualKeyboardManualHide();
        markVirtualKeyboardPointerIntent();
        vkTarget=target;
        vkFrameFocused=true;
        vkKeepVisibleUntil=Date.now()+1500;
        clearTimeout(vkHideTimer);
        if(cfg.vkEnabled&&cfg.vkAutoShow)showVirtualKeyboard('iframe-pointerdown');
        return;
      }
      setTimeout(syncFromIframe,0);
    },true);
    doc.addEventListener('mousedown',e=>{
      const target=e.target;
      if(isVirtualKeyboardInput(target)){
        markVirtualKeyboardPointerIntent();
        vkTarget=target;
        vkFrameFocused=true;
        vkKeepVisibleUntil=Date.now()+1500;
        clearTimeout(vkHideTimer);
        if(cfg.vkEnabled&&cfg.vkAutoShow)showVirtualKeyboard('iframe-mousedown');
      }
    },true);
  }catch(e){}
}

function getVirtualKeyboardTarget(){
  if(isVirtualKeyboardInput(vkTarget))return vkTarget;
  const iframeTarget=getIframeVirtualKeyboardTarget();
  if(iframeTarget)return iframeTarget;
  return isVirtualKeyboardInput(document.activeElement)?document.activeElement:null;
}

function isIframeElementActive(){
  return document.activeElement===frame;
}

function resetVirtualKeyboardManualHide(){
  clearTimeout(vkManualHideTimer);
  vkManualHideTimer=null;
  vkManualHidden=false;
  
}

function clearVirtualKeyboardFocusState(){
  try{
    if(isVirtualKeyboardInput(vkTarget))vkTarget.blur?.();
  }catch(e){}
  vkTarget=null;
  vkFrameFocused=false;
  vkKeepVisibleUntil=0;
  try{
    if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur?.();
  }catch(e){}
  try{frame.blur();}catch(e){}
}

function markVirtualKeyboardPointerIntent(){
  vkLastPointerIntentAt=Date.now();
}

function hasRecentVirtualKeyboardPointerIntent(){
  return Date.now()-vkLastPointerIntentAt<1500;
}

function isVirtualKeyboardVisible(){
  return !!document.getElementById('vk-overlay')?.classList.contains('visible');
}

function updateVirtualKeyboardTriggerButton(){
  const btn=document.getElementById('vk-trigger');
  if(btn)btn.classList.toggle('active',vkForcedOpen||isVirtualKeyboardVisible());
}

function cancelVirtualKeyboardProbe(){
  clearTimeout(vkProbeTimer);
  vkProbeTimer=null;
}

function scheduleIframeKeyboardProbe(attempt=0){
  cancelVirtualKeyboardProbe();
  if(!cfg.vkEnabled||!cfg.vkAutoShow||vkManualHidden)return;
  Promise.resolve(window.kioskElectron?.getVirtualKeyState?.())
    .then(state=>{
      const target=getIframeVirtualKeyboardTarget();
      const hasEditable=!!target||!!state?.hasEditable;
      const recentClick=!!state?.recentClick||hasRecentVirtualKeyboardPointerIntent();
      if(hasEditable){
        if(target)vkTarget=target;
        vkFrameFocused=true;
        vkKeepVisibleUntil=Date.now()+1200;
        clearTimeout(vkHideTimer);
        if(recentClick||isVirtualKeyboardVisible())showVirtualKeyboard('iframe-probe');
        return;
      }
      if(attempt>=6||!hasRecentVirtualKeyboardPointerIntent()){
        if(!isVirtualKeyboardVisible()){
          vkFrameFocused=false;
          queueVirtualKeyboardHide();
        }
        return;
      }
      vkProbeTimer=setTimeout(()=>scheduleIframeKeyboardProbe(attempt+1),80);
    })
    .catch(()=>{
      if(attempt>=6||!hasRecentVirtualKeyboardPointerIntent()){
        if(!isVirtualKeyboardVisible()){
          vkFrameFocused=false;
          queueVirtualKeyboardHide();
        }
        return;
      }
      vkProbeTimer=setTimeout(()=>scheduleIframeKeyboardProbe(attempt+1),80);
    });
}

function sendVirtualKeyboardInput(payload){
  try{
    if(window.kioskElectron?.sendVirtualKey){
      window.kioskElectron.sendVirtualKey(payload);
      return true;
    }
  }catch(e){}
  return false;
}



function showVirtualKeyboard(reason='show'){
  vkLastReason=reason;
  if(!cfg.vkEnabled){return;}
  cancelVirtualKeyboardProbe();
  const vk=document.getElementById('vk-overlay');
  if(!vk){return;}
  renderVirtualKeyboard();
  applyVirtualKeyboardStyle();
  vk.style.display='flex';
  vk.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>{
    vk.classList.add('visible');
    if(cfg.vkMode!=='floating')vk.style.transform='translate(-50%,0)';
    updateVirtualKeyboardTriggerButton();
    
  });
}

function hideVirtualKeyboard(immediate=false,reason='hide'){
  vkLastReason=reason;
  if(reason==='manual-toggle')vkForcedOpen=false;
  if(reason==='manual-hide'){
    clearTimeout(vkManualHideTimer);
    vkManualHidden=true;
    clearVirtualKeyboardFocusState();
    cancelVirtualKeyboardProbe();
    vkManualHideTimer=setTimeout(()=>{
      vkManualHidden=false;
      
    },1200);
  }
  const vk=document.getElementById('vk-overlay');
  if(!vk)return;
  clearTimeout(vkHideTimer);
  vkHideTimer=null;
  vkShift=false;
  renderVirtualKeyboard();
  vk.classList.remove('visible');
  vk.setAttribute('aria-hidden','true');
  if(cfg.vkMode!=='floating')vk.style.transform='translate(-50%,105%)';
  const done=()=>{if(!vk.classList.contains('visible'))vk.style.display='none';updateVirtualKeyboardTriggerButton();};
  if(immediate)done(); else setTimeout(done,220);
}

function toggleManualVirtualKeyboard(){
  if(vkForcedOpen||isVirtualKeyboardVisible()){
    vkForcedOpen=false;
    hideVirtualKeyboard(false,'manual-toggle');
    return;
  }
  vkForcedOpen=true;
  resetVirtualKeyboardManualHide();
  markVirtualKeyboardPointerIntent();
  clearTimeout(vkHideTimer);
  vkKeepVisibleUntil=Date.now()+5000;
  showVirtualKeyboard('manual-trigger');
}

function syncVirtualKeyboardToFocus(){
  if(!cfg.vkEnabled){hideVirtualKeyboard(true,'disabled');return;}
  if(vkForcedOpen){showVirtualKeyboard('forced-open');return;}
  if(!cfg.vkAutoShow){hideVirtualKeyboard(true,'autoshow-off');return;}
  if(vkManualHidden){hideVirtualKeyboard(true,'manual-latched');return;}
  const target=getVirtualKeyboardTarget();
  if(target&&(hasRecentVirtualKeyboardPointerIntent()||isVirtualKeyboardVisible()||Date.now()<vkKeepVisibleUntil))showVirtualKeyboard('sync-focus');
  else hideVirtualKeyboard(true,'sync-hide');
}

function queueVirtualKeyboardHide(){
  clearTimeout(vkHideTimer);
  vkHideTimer=setTimeout(()=>{
    if(vkForcedOpen){
      showVirtualKeyboard('forced-open');
      return;
    }
    if(vkManualHidden){
      vkFrameFocused=false;
      hideVirtualKeyboard(false,'manual-latched');
      return;
    }
    const target=getVirtualKeyboardTarget();
    if(target&&(hasRecentVirtualKeyboardPointerIntent()||isVirtualKeyboardVisible()||Date.now()<vkKeepVisibleUntil)){
      showVirtualKeyboard('hide-cancelled');
      return;
    }
    vkFrameFocused=false;
    hideVirtualKeyboard(false,'queued-hide');
  },120);
}

function typeIntoField(el,text){
  if(el.matches('input,textarea')){
    const start=el.selectionStart??el.value.length;
    const end=el.selectionEnd??start;
    el.value=el.value.slice(0,start)+text+el.value.slice(end);
    const next=start+text.length;
    try{el.setSelectionRange(next,next)}catch(e){}
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }else if(el.isContentEditable){
    document.execCommand('insertText',false,text);
  }
}

function backspaceField(el){
  if(el.matches('input,textarea')){
    const start=el.selectionStart??0;
    const end=el.selectionEnd??start;
    if(start!==end)el.value=el.value.slice(0,start)+el.value.slice(end);
    else if(start>0)el.value=el.value.slice(0,start-1)+el.value.slice(start);
    const next=start!==end?start:Math.max(0,start-1);
    try{el.setSelectionRange(next,next)}catch(e){}
    el.dispatchEvent(new Event('input',{bubbles:true}));
  }else if(el.isContentEditable){
    document.execCommand('delete',false);
  }
}

function moveCursor(el,delta){
  if(!el.matches('input,textarea'))return;
  const pos=Math.max(0,(el.selectionStart??0)+delta);
  try{el.setSelectionRange(pos,pos)}catch(e){}
}

function handleVirtualKey(key){
  if(key==='Hide'){hideVirtualKeyboard(false,'manual-hide');return;}
  if(key==='Shift'){vkShift=!vkShift;renderVirtualKeyboard();return;}
  const target=getVirtualKeyboardTarget();
  if(!target){
    if(isIframeElementActive()){
      let sent=false;
      if(key==='Bksp')sent=sendVirtualKeyboardInput({ type:'backspace' });
      else if(key==='Enter')sent=sendVirtualKeyboardInput({ type:'enter' });
      else if(key==='Space')sent=sendVirtualKeyboardInput({ type:'text', text:' ' });
      else if(key==='Left')sent=sendVirtualKeyboardInput({ type:'left' });
      else if(key==='Right')sent=sendVirtualKeyboardInput({ type:'right' });
      else sent=sendVirtualKeyboardInput({ type:'text', text:key });
      if(sent){
        vkKeepVisibleUntil=Date.now()+1500;
        vkLastReason='electron-key';
        
      }else{
        hideVirtualKeyboard(false,'missing-target');
      }
      if(vkShift&&cfg.vkLayout!=='numeric'&&!['Shift'].includes(key)){
        vkShift=false;
        renderVirtualKeyboard();
      }
      return;
    }
    hideVirtualKeyboard(false,'missing-target');
    return;
  }
  target.focus({preventScroll:true});
  if(key==='Bksp')backspaceField(target);
  else if(key==='Enter'){
    if(target.matches('textarea'))typeIntoField(target,'\n');
    else target.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  }else if(key==='Space')typeIntoField(target,' ');
  else if(key==='Left')moveCursor(target,-1);
  else if(key==='Right')moveCursor(target,1);
  else typeIntoField(target,key);
  if(vkShift&&cfg.vkLayout!=='numeric'&&!['Shift'].includes(key)){
    vkShift=false;
    renderVirtualKeyboard();
  }
}

/* ═══════════════════════════════════════════════════
   DOMAIN LIST
═══════════════════════════════════════════════════ */
function renderDomainList(){
  const el=document.getElementById('domain-list');
  const implicit=getImplicitDomains();
  let html='';
  if(implicit.length)html+=implicit.map(d=>`<div class="domain-tag" style="opacity:.55;cursor:default"><div class="dt-info"><span>&#10003; ${escH(d)}</span><span class="dt-sub">auto</span></div></div>`).join('');
  if(!cfg.domains.length){el.innerHTML=html||(html+'<div class="domain-empty">No domains added — all navigation allowed.</div>');return}
  html+=cfg.domains.map((d,i)=>`<div class="domain-tag"><div class="dt-info"><span>&#10003; ${escH(d)}</span><span class="dt-sub">+subdomains</span></div><button onclick="removeDomain(${i})" title="Remove">&#x2715;</button></div>`).join('');
  el.innerHTML=html;
}
function addDomain(){let v=document.getElementById('domain-input').value.trim().toLowerCase();if(!v)return;v=v.replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'');if(cfg.domains.includes(v)){showToast('Already in list','error');return}cfg.domains.push(v);document.getElementById('domain-input').value='';renderDomainList()}
function removeDomain(i){cfg.domains.splice(i,1);renderDomainList()}

/* ═══════════════════════════════════════════════════
   QUICK-NAV BUTTONS
═══════════════════════════════════════════════════ */
function addQNav(){
  const emoji=document.getElementById('qn-emoji').value.trim()||'&#127760;';
  const label=document.getElementById('qn-label').value.trim();
  const url=document.getElementById('qn-url').value.trim();
  if(!label||!url){showToast('Label and URL required','error');return}
  cfg.quickNavBtns.push({id:Date.now(),label,url,emoji});
  document.getElementById('qn-emoji').value='';
  document.getElementById('qn-label').value='';
  document.getElementById('qn-url').value='';
  renderQNavList();
}
function removeQNav(id){cfg.quickNavBtns=cfg.quickNavBtns.filter(b=>b.id!==id);renderQNavList()}

function renderQNavList(){
  const el=document.getElementById('qnav-list');
  if(!cfg.quickNavBtns.length){el.innerHTML='<div class="domain-empty">No buttons added yet.</div>';return}
  el.innerHTML='';
  cfg.quickNavBtns.forEach((btn,i)=>{
    const row=document.createElement('div');
    row.className='qnav-item';
    row.draggable=true;
    row.dataset.i=i;
    row.innerHTML=`<span class="qnav-drag-handle" title="Drag to reorder">&#8597;</span><span class="qnav-item-emoji">${btn.emoji}</span><span class="qnav-item-label">${escH(btn.label)}</span><span class="qnav-item-url">${escH(btn.url)}</span><button onclick="removeQNav(${btn.id})" title="Remove">&#x2715;</button>`;
    row.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',i);row.classList.add('dragging')});
    row.addEventListener('dragend',()=>row.classList.remove('dragging'));
    row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drag-over')});
    row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
    row.addEventListener('drop',e=>{
      e.preventDefault();row.classList.remove('drag-over');
      const from=parseInt(e.dataTransfer.getData('text/plain'));
      const to=parseInt(row.dataset.i);
      if(from===to)return;
      const moved=cfg.quickNavBtns.splice(from,1)[0];
      cfg.quickNavBtns.splice(to,0,moved);
      renderQNavList();
    });
    el.appendChild(row);
  });
}

function renderQuickNavBtns(){
  const area=document.getElementById('quicknav-area');
  const sep=document.getElementById('qnav-sep');
  area.innerHTML='';
  if(!cfg.quickNavBtns.length){sep.style.display='none';return}
  sep.style.display='';
  cfg.quickNavBtns.forEach((btn,i)=>{
    const b=document.createElement('button');
    b.className='qnav-btn';
    b.title=btn.url;
    b.innerHTML=`<span class="qn-icon">${btn.emoji}</span>${escH(btn.label)}`;
    b.addEventListener('click',()=>{
      const d=extractDomain(btn.url);
      if(!isDomainAllowed(d)){showBlockScreen(d);log('block','Quick-nav blocked: '+btn.url);return}
      navigateTo(btn.url);
    });
    // Drag-to-reorder in topbar
    b.draggable=true;
    b.dataset.i=i;
    b.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',i);b.classList.add('dragging')});
    b.addEventListener('dragend',()=>b.classList.remove('dragging'));
    b.addEventListener('dragover',e=>{e.preventDefault();b.classList.add('drag-over')});
    b.addEventListener('dragleave',()=>b.classList.remove('drag-over'));
    b.addEventListener('drop',e=>{
      e.preventDefault();b.classList.remove('drag-over');
      const from=parseInt(e.dataTransfer.getData('text/plain'));
      const to=parseInt(b.dataset.i);
      if(from===to)return;
      const moved=cfg.quickNavBtns.splice(from,1)[0];
      cfg.quickNavBtns.splice(to,0,moved);
      saveCfg();renderQuickNavBtns();
    });
    area.appendChild(b);
  });
}

function escH(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

/* ═══════════════════════════════════════════════════
   NAVIGATION & DOMAIN GUARD
═══════════════════════════════════════════════════ */
function normalizeUrl(u){return(u.startsWith('http://')||u.startsWith('https://'))?u:'https://'+u}
function extractDomain(u){try{return new URL(normalizeUrl(u)).hostname.replace(/^www\./,'')}catch(e){return u}}
function getImplicitDomains(){const s=new Set();if(cfg.url){try{s.add(new URL(normalizeUrl(cfg.url)).hostname.replace(/^www\./,''))}catch(e){}}cfg.quickNavBtns.forEach(b=>{try{s.add(new URL(normalizeUrl(b.url)).hostname.replace(/^www\./,''))}catch(e){}});return[...s].filter(Boolean)}
function isDomainAllowed(d){if(!cfg.domains.length)return true;if(getImplicitDomains().some(x=>d===x||d.endsWith('.'+x)))return true;return cfg.domains.some(x=>d===x||d.endsWith('.'+x))}

function applyUrl(){const v=document.getElementById('cfg-url').value.trim();if(!v)return;cfg.url=v;saveCfg();navigateTo(v)}
function navigateTo(url){
  vkLastPointerIntentAt = 0;
  url=normalizeUrl(url);
  const domain=extractDomain(url);
  if(!isDomainAllowed(domain)){showBlockScreen(domain);log('block','Blocked: '+url);return}
  dismissBlock(false);startLoadBar();
  document.getElementById('site-frame').src=url;
  updateUrlBar(url);
  document.getElementById('status-dot').className='loading';
  navHistory=navHistory.slice(0,navIndex+1);navHistory.push(url);navIndex=navHistory.length-1;
  updateNavButtons();log('ok','Loaded: '+url);
}
function historyBack(){vkLastPointerIntentAt=0;if(navIndex<=0)return;navIndex--;const u=navHistory[navIndex];startLoadBar();document.getElementById('site-frame').src=u;updateUrlBar(u);updateNavButtons()}
function historyFwd(){vkLastPointerIntentAt=0;if(navIndex>=navHistory.length-1)return;navIndex++;const u=navHistory[navIndex];startLoadBar();document.getElementById('site-frame').src=u;updateUrlBar(u);updateNavButtons()}
function reloadFrame(){vkLastPointerIntentAt=0;const f=document.getElementById('site-frame');startLoadBar();try{f.contentWindow.location.reload()}catch(e){f.src=f.src}}
function updateNavButtons(){document.getElementById('nav-back').disabled=navIndex<=0;document.getElementById('nav-fwd').disabled=navIndex>=navHistory.length-1}

const frame=document.getElementById('site-frame');

frame.addEventListener('load',()=>{
  stopLoadBar();document.getElementById('status-dot').className='live';
  vkFrameFocused=false;
  vkIframeDoc=null;
  setTimeout(setupIframeKeyboardTracking,120);
  if(cfg.strictMode){
    try{
      const loc=frame.contentWindow.location.href;
      if(loc&&loc!=='about:blank'){
        const d=extractDomain(loc);
        if(!isDomainAllowed(d)){
          // Immediately navigate back to safe URL and show block screen
          frame.src=cfg.url?normalizeUrl(cfg.url):'about:blank';
          showBlockScreen(d);log('block','Frame nav blocked: '+loc);return;
        }
        updateUrlBar(loc);
        if(navHistory[navIndex]!==loc){navHistory=navHistory.slice(0,navIndex+1);navHistory.push(loc);navIndex=navHistory.length-1;updateNavButtons()}
      }
    }catch(e){/* cross-origin */}
    // Patch popup blocker on same-origin frames
    if(cfg.blockPopups){try{const iw=frame.contentWindow;iw.open=(url)=>{if(url){const d=extractDomain(url);if(isDomainAllowed(d))navigateTo(url);else showBlockScreen(d)}return null}}catch(e){}}
  }
});

frame.addEventListener('error',()=>{stopLoadBar();document.getElementById('status-dot').className='blocked';showToast('Failed to load','error')});
window.addEventListener('message',e=>{
  const data=e.data;
  if(!data||typeof data!=='object'||typeof data.type!=='string')return;
  if(data.type==='ks_navigate'){
    const d=extractDomain(data.url);
    if(!isDomainAllowed(d)){showBlockScreen(d);log('block','postMsg blocked: '+e.data.url)}
  }
  if(data.type==='vk-focus'){
    vkFrameFocused=!!data.focused;
    if(vkFrameFocused&&(hasRecentVirtualKeyboardPointerIntent()||isVirtualKeyboardVisible())){
      resetVirtualKeyboardManualHide();
      vkKeepVisibleUntil=Date.now()+1500;
      showVirtualKeyboard('message-focus');
    }
    else queueVirtualKeyboardHide();
  }
});

function showBlockScreen(d){
  document.getElementById('bs-domain-msg').textContent='"'+d+'" is not in the allow list.';
  document.getElementById('block-screen').classList.add('show');
  document.getElementById('status-dot').className='blocked';
  showToast('Blocked: '+d,'error');
}
function dismissBlock(reload){
  document.getElementById('block-screen').classList.remove('show');
  if(reload!==false&&cfg.url){
    document.getElementById('site-frame').src=normalizeUrl(cfg.url);
    updateUrlBar(cfg.url);
    document.getElementById('status-dot').className='live';
  }
}

function updateUrlBar(url){
  try{const u=new URL(normalizeUrl(url));document.getElementById('url-bar-protocol').textContent=u.protocol+'//';document.getElementById('url-bar-domain').textContent=u.hostname.replace(/^www\./,'');document.getElementById('url-bar-path').textContent=(u.pathname==='/'?'':u.pathname)+u.search}
  catch(e){document.getElementById('url-bar-protocol').textContent='';document.getElementById('url-bar-domain').textContent=url||'No URL set';document.getElementById('url-bar-path').textContent=''}
}

/* ═══════════════════════════════════════════════════
   LOAD BAR
═══════════════════════════════════════════════════ */
let lbt;
function startLoadBar(){const b=document.getElementById('load-bar');b.style.transition='none';b.style.width='0%';b.classList.add('active');clearTimeout(lbt);requestAnimationFrame(()=>{b.style.transition='width 2s ease';b.style.width='82%'})}
function stopLoadBar(){const b=document.getElementById('load-bar');b.style.transition='width .3s ease';b.style.width='100%';lbt=setTimeout(()=>{b.classList.remove('active');b.style.width='0%'},400)}


/* ═══════════════════════════════════════════════════
   SECURITY GUARDS
═══════════════════════════════════════════════════ */
document.addEventListener('touchstart',e=>{if(cfg.disableZoom&&e.touches.length>1)e.preventDefault()},{passive:false});
document.addEventListener('wheel',e=>{if(cfg.disableZoom&&e.ctrlKey)e.preventDefault()},{passive:false});
document.addEventListener('keydown',e=>{
  if(cfg.disableZoom&&e.ctrlKey&&['+','-','=','0'].includes(e.key)){e.preventDefault();return}
  if(cfg.disableShortcuts){
    if(['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'].includes(e.key)){e.preventDefault();return}
    if(e.ctrlKey&&'rRtTwWnNlLuUpPsS'.includes(e.key)){e.preventDefault();return}
    if(e.altKey&&['F4','Left','Right'].includes(e.key)){e.preventDefault();return}
  }
});
document.addEventListener('focusin',e=>{
  if(!cfg.vkEnabled||!cfg.vkAutoShow)return;
  if(isVirtualKeyboardInput(e.target)){
    vkTarget=e.target;
    vkKeepVisibleUntil=Date.now()+1500;
    clearTimeout(vkHideTimer);
    if(hasRecentVirtualKeyboardPointerIntent()||isVirtualKeyboardVisible())showVirtualKeyboard('host-focusin');
  }
},true);
document.addEventListener('focusout',e=>{
  if(e.target===vkTarget||isVirtualKeyboardInput(e.target))queueVirtualKeyboardHide();
},true);
document.addEventListener('pointerdown',e=>{
  const vk=document.getElementById('vk-overlay');
  if(vk.contains(e.target))return;
  if(e.target.closest('#vk-trigger'))return;
  if(isVirtualKeyboardInput(e.target)){
    resetVirtualKeyboardManualHide();
    markVirtualKeyboardPointerIntent();
    vkTarget=e.target;
    clearTimeout(vkHideTimer);
    if(cfg.vkEnabled&&cfg.vkAutoShow){
      vkKeepVisibleUntil=Date.now()+1500;
      showVirtualKeyboard('host-pointerdown');
    }
    return;
  }
  if(e.target===frame){
    clearTimeout(vkHideTimer);
    resetVirtualKeyboardManualHide();
    markVirtualKeyboardPointerIntent();
    setTimeout(()=>{
      setupIframeKeyboardTracking();
      scheduleIframeKeyboardProbe();
      syncVirtualKeyboardToFocus();
    },100);
    return;
  }
  vkTarget=null;
  vkFrameFocused=false;
  queueVirtualKeyboardHide();
},true);
frame.addEventListener('focus',()=>{
  markVirtualKeyboardPointerIntent();
  setTimeout(()=>{
    setupIframeKeyboardTracking();
    scheduleIframeKeyboardProbe();
    syncVirtualKeyboardToFocus();
  },80);
});
frame.addEventListener('blur',()=>{
  cancelVirtualKeyboardProbe();
  vkFrameFocused=false;
  queueVirtualKeyboardHide();
});
document.querySelectorAll('.admin-trigger').forEach(el=>{
  const trigger=e=>{
    e.preventDefault();
    e.stopPropagation();
    onAdminTriggerTouch();
  };
  el.addEventListener('pointerdown',trigger);
  el.addEventListener('touchstart',trigger,{passive:false});
  el.addEventListener('mousedown',trigger);
});
document.getElementById('logo').addEventListener('pointerdown', e => {
  e.preventDefault();
  e.stopPropagation();
  onAdminTriggerTouch();
});
document.getElementById('vk-toolbar').addEventListener('pointerdown',e=>{
  if(cfg.vkMode!=='floating')return;
  if(e.target.id==='vk-close')return;
  const vk=document.getElementById('vk-overlay');
  const rect=vk.getBoundingClientRect();
  vkDragging=true;
  vkDragOffsetX=e.clientX-rect.left;
  vkDragOffsetY=e.clientY-rect.top;
  vk.classList.add('dragging');
});
document.addEventListener('pointermove',e=>{
  if(!vkDragging||cfg.vkMode!=='floating')return;
  const vk=document.getElementById('vk-overlay');
  const maxX=Math.max(0,window.innerWidth-vk.offsetWidth);
  const maxY=Math.max(0,window.innerHeight-vk.offsetHeight);
  cfg.vkFloatX=Math.max(0,Math.min(maxX,e.clientX-vkDragOffsetX));
  cfg.vkFloatY=Math.max(0,Math.min(maxY,e.clientY-vkDragOffsetY));
  vk.style.left=`${cfg.vkFloatX}px`;
  vk.style.top=`${cfg.vkFloatY}px`;
});
document.addEventListener('pointerup',()=>{
  if(!vkDragging)return;
  vkDragging=false;
  document.getElementById('vk-overlay').classList.remove('dragging');
  saveCfg();
});
{
  const vkTrigger=document.getElementById('vk-trigger');
  const onVkTrigger=e=>{
    e.preventDefault();
    e.stopPropagation();
    toggleManualVirtualKeyboard();
  };
  vkTrigger.addEventListener('pointerdown',onVkTrigger);
  vkTrigger.addEventListener('touchstart',onVkTrigger,{passive:false});
}
window.addEventListener('resize',()=>applyVirtualKeyboardStyle());

/* Cross-origin iframe content can't be observed via contentDocument (site
   isolation) and the host only gets a 'focus' event on the *transition*
   into the frame, not on every click of a different field inside it once
   focused. Poll the main process (which can inspect frames regardless of
   origin) while the iframe holds focus so switching fields still shows/hides
   the keyboard correctly. */
setInterval(()=>{
  if(!cfg.vkEnabled||!cfg.vkAutoShow||vkManualHidden)return;
  if(vkStateCheckPending)return;
  if(document.getElementById('settings-overlay')?.classList.contains('open'))return;
  if(document.getElementById('pin-overlay')?.classList.contains('show'))return;
  if(document.activeElement!==frame)return;
  if(!isVirtualKeyboardVisible()&&!vkFrameFocused&&!vkForcedOpen&&!hasRecentVirtualKeyboardPointerIntent())return;
  vkStateCheckPending=true;
  window.kioskElectron?.getVirtualKeyState?.().then(state=>{
    if(document.activeElement!==frame)return;
    if(state?.hasEditable){
      vkFrameFocused=true;
      vkKeepVisibleUntil=Date.now()+1200;
      const recentClick=!!state?.recentClick||hasRecentVirtualKeyboardPointerIntent();
      if(!isVirtualKeyboardVisible() && recentClick)showVirtualKeyboard('iframe-poll');
    }else if(vkFrameFocused&&!vkForcedOpen){
      vkFrameFocused=false;
      queueVirtualKeyboardHide();
    }
  }).catch(()=>{}).finally(()=>{vkStateCheckPending=false;});
},1000);

/* ═══════════════════════════════════════════════════
   IDLE
═══════════════════════════════════════════════════ */
function resetIdleTimer(){clearTimeout(idleTimer);if(cfg.idleTimeout>0)idleTimer=setTimeout(showIdle,cfg.idleTimeout*1000)}
['mousemove','mousedown','keydown','touchstart','scroll'].forEach(ev=>document.addEventListener(ev,resetIdleTimer,{passive:true}));
function showIdle(){
  document.getElementById('idle-clock').textContent=new Date().toTimeString().slice(0,8);
  document.getElementById('idle-date').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase();
  document.getElementById('idle-screen').classList.add('show');
  clearInterval(ict);ict=setInterval(()=>{document.getElementById('idle-clock').textContent=new Date().toTimeString().slice(0,8);document.getElementById('idle-date').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase()},1000);
  document.getElementById('idle-screen').onclick=()=>{if(cfg.pin)showPIN('idle');else wakeFromIdle()};
  log('info','Screensaver on');
}
function wakeFromIdle(){clearInterval(ict);document.getElementById('idle-screen').classList.remove('show');resetIdleTimer()}

/* ═══════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════ */
let tt;
function showToast(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className='show'+(type?' '+type:'');clearTimeout(tt);tt=setTimeout(()=>{t.className=''},3000)}

/* ═══════════════════════════════════════════════════
   FACTORY RESET
═══════════════════════════════════════════════════ */
function factoryReset(){if(!confirm('Reset all KioskShell settings? This cannot be undone.'))return;localStorage.removeItem('ks_cfg');localStorage.removeItem('ks_log');location.reload()}

/* ═══════════════════════════════════════════════════
   DIAGNOSTICS / DATA WIPE
═══════════════════════════════════════════════════ */
function hardRefresh(){
  log('info','Hard refresh triggered');
  if(window.kioskElectron?.hardRefresh)window.kioskElectron.hardRefresh();
  else location.reload();
}

function renderUpdateState(state={}){
  const statusEl=document.getElementById('update-status');
  const progressEl=document.getElementById('update-progress');
  const checkBtn=document.getElementById('update-check-btn');
  const downloadBtn=document.getElementById('update-download-btn');
  const installBtn=document.getElementById('update-install-btn');
  if(!statusEl||!progressEl||!checkBtn||!downloadBtn||!installBtn)return;

  const version=state.version||'unknown';
  const target=state.availableVersion?` -> ${state.availableVersion}`:'';
  const progress=Math.max(0,Math.min(100,parseInt(state.progress)||0));
  const labels={
    idle:`Current version: ${version}`,
    checking:`Checking for updates... Current version: ${version}`,
    available:`Update available: ${version}${target}`,
    downloading:`Downloading update: ${progress}%`,
    ready:`Update ready: ${version}${target}. Restart to install.`,
    none:`No update available. Current version: ${version}`,
    installing:'Installing update and restarting...',
    error:`Update error: ${state.error||'Unknown error'}`
  };

  statusEl.textContent=labels[state.status]||labels.idle;
  progressEl.style.width=state.status==='downloading'||state.status==='ready'?`${progress}%`:'0%';
  checkBtn.disabled=['checking','downloading','installing'].includes(state.status);
  downloadBtn.style.display=state.status==='available'?'':'none';
  downloadBtn.disabled=state.status!=='available';
  installBtn.style.display=state.status==='ready'?'':'none';
  installBtn.disabled=state.status!=='ready';
}

async function refreshUpdateState(){
  if(!window.kioskElectron?.getUpdateState){renderUpdateState({status:'error',error:'Updater unavailable in browser preview'});return}
  renderUpdateState(await window.kioskElectron.getUpdateState());
}

async function checkForSoftwareUpdate(){
  if(!window.kioskElectron?.checkForUpdate){showToast('Updater unavailable','error');return}
  log('info','Update check requested');
  renderUpdateState({status:'checking'});
  try{renderUpdateState(await window.kioskElectron.checkForUpdate())}
  catch(e){renderUpdateState({status:'error',error:e.message||String(e)})}
}

async function downloadSoftwareUpdate(){
  if(!window.kioskElectron?.downloadUpdate){showToast('Updater unavailable','error');return}
  log('info','Update download requested');
  renderUpdateState({status:'downloading',progress:0});
  try{renderUpdateState(await window.kioskElectron.downloadUpdate())}
  catch(e){renderUpdateState({status:'error',error:e.message||String(e)})}
}

async function installSoftwareUpdate(){
  if(!confirm('Restart KIOCAST KioskShell and install the downloaded update now?'))return;
  if(!window.kioskElectron?.installUpdate){showToast('Updater unavailable','error');return}
  log('info','Update install requested');
  renderUpdateState({status:'installing'});
  await window.kioskElectron.installUpdate();
}

function toggleDevTools(){
  log('info','DevTools toggled');
  window.kioskElectron?.toggleDevTools?.();
}
async function clearCacheOnly(){
  if(!window.kioskElectron?.clearCache){showToast('Cache clear unavailable','error');return}
  await window.kioskElectron.clearCache();
  log('info','Cache cleared');
  showToast('Cache cleared','ok');
}
async function wipeAllData(){
  if(!confirm('Wipe ALL personal data? This clears cookies, cache, and storage for the kiosked site, plus all KioskShell settings. Cannot be undone.'))return;
  if(window.kioskElectron?.wipeData)await window.kioskElectron.wipeData();
  localStorage.removeItem('ks_cfg');localStorage.removeItem('ks_log');
  location.reload();
}

async function lockdownWindows() {
  if (!window.kioskElectron?.lockdownWindows) {
    showToast('Lockdown unavailable', 'error');
    return;
  }
  if (!confirm('This will modify Windows Registry and Services to disable the native touch keyboard and multi-finger gestures. A Windows UAC Administrator prompt will appear. Proceed?')) return;
  
  log('info', 'Windows lockdown requested');
  try {
    await window.kioskElectron.lockdownWindows();
    showToast('Lockdown script started. Please accept the UAC prompt.', 'ok');
    setTimeout(() => {
      alert('Windows Lockdown applied! Please RESTART your computer for all registry changes (like 4-finger gestures) to take full effect.');
    }, 2000);
  } catch (e) {
    showToast('Lockdown failed', 'error');
  }
}

async function exitApplication(){
  if(!confirm('Exit KioskShell and return to the operating system?'))return;
  if(!window.kioskElectron?.exitApp){showToast('Exit unavailable','error');return}
  await window.kioskElectron.exitApp();
}

/* ═══════════════════════════════════════════════════
   SERVICE WORKER
═══════════════════════════════════════════════════ */
if(!window.kioskElectron&&'serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

/* ═══════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════ */
loadCfg();applySettings();updateNavButtons();
if(window.kioskElectron?.onUpdateState)window.kioskElectron.onUpdateState(renderUpdateState);
refreshUpdateState();
if(cfg.url)navigateTo(cfg.url);else openSettings();
