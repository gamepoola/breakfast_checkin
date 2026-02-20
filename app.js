const ROOM_RE = /^(?:[A-Z]\d{3,4}|\d{4,5})$/;

const els = {
  btnLoadInh: document.getElementById('btnLoadInh'),
  fileInh: document.getElementById('fileInh'),
  btnExport: document.getElementById('btnExport'),
  btnImport: document.getElementById('btnImport'),
  fileLog: document.getElementById('fileLog'),
  btnClear: document.getElementById('btnClear'),
  inhStatus: document.getElementById('inhStatus'),
  inhMeta: document.getElementById('inhMeta'),

  room: document.getElementById('room'),
  guests: document.getElementById('guests'),
  btnSave: document.getElementById('btnSave'),
  btnRefresh: document.getElementById('btnRefresh'),

  recent: document.getElementById('recent'),
  today: document.getElementById('today'),

  overlay: document.getElementById('overlay'),
  mTitle: document.getElementById('mTitle'),
  mBody: document.getElementById('mBody'),
  mRo: document.getElementById('mRo'),
  mActions: document.getElementById('mActions'),
};

function pad(n){return String(n).padStart(2,'0');}
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function nowISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function normRoom(s){
  let t = String(s ?? '').toUpperCase().trim();
  t = t.replace(/\s+/g,'');
  if (t.includes('/')) t = t.split('/')[0];
  return t;
}
function normName(s){
  let t = String(s ?? '').trim().replace(/\s+/g,' ');
  t = t.replace(/^\*+/, '').trim();
  if (t.includes(',')){
    const parts = t.split(',').map(x=>x.trim()).filter(Boolean);
    if (parts.length >= 2){
      const last = parts[0];
      const given = parts.slice(1).join(' ').trim();
      if (given) return `${given} ${last}`.replace(/\s+/g,' ').trim();
      return last;
    }
  }
  return t;
}

// Minimal CSV parser supporting quotes
function csvParse(text){
  const rows = [];
  let i=0, field='', row=[], inQ=false;
  while (i < text.length){
    const c = text[i];
    if (inQ){
      if (c === '"'){
        if (text[i+1] === '"'){ field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ','){ row.push(field); field=''; }
      else if (c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if (c === '\r'){ /* ignore */ }
      else field += c;
    }
    i++;
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows.map(r=>r.map(x=>String(x ?? '').trim()));
}

function saveLocal(key,val){ localStorage.setItem(key, JSON.stringify(val)); }
function loadLocal(key,fallback){
  const s = localStorage.getItem(key);
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function setInhStatus(loaded, meta=''){
  if (loaded){
    els.inhStatus.textContent = 'โหลดแล้ว';
    els.inhStatus.className = 'pill ok';
    els.inhMeta.textContent = meta ? ` — ${meta}` : '';
  } else {
    els.inhStatus.textContent = 'ยังไม่ได้โหลด';
    els.inhStatus.className = 'pill no';
    els.inhMeta.textContent = '';
  }
}

function showModal({title='แจ้งเตือน', body='', isRO=false, ask=false}){
  els.mTitle.textContent = title;
  els.mBody.textContent = body;
  els.mRo.style.display = isRO ? 'block' : 'none';
  els.mActions.innerHTML = '';
  return new Promise((resolve)=>{
    const close = (val)=>{
      els.overlay.style.display = 'none';
      resolve(val);
    };
    if (ask){
      const btnNo = document.createElement('button');
      btnNo.className = 'secondary';
      btnNo.textContent = 'ยกเลิก';
      btnNo.onclick = ()=>close(false);

      const btnYes = document.createElement('button');
      btnYes.textContent = 'ตกลง';
      btnYes.onclick = ()=>close(true);

      els.mActions.appendChild(btnNo);
      els.mActions.appendChild(btnYes);
    } else {
      const btnOK = document.createElement('button');
      btnOK.textContent = 'OK';
      btnOK.onclick = ()=>close(true);
      els.mActions.appendChild(btnOK);
    }
    els.overlay.style.display = 'flex';
    const onKey = (e)=>{
      if (e.key === 'Escape'){ window.removeEventListener('keydown', onKey); close(false); }
      if (e.key === 'Enter'){ window.removeEventListener('keydown', onKey); close(true); }
    };
    window.addEventListener('keydown', onKey);
  });
}

// INH: room -> {name, pkg}
let inhMap = loadLocal('inhMap', null);
let inhMeta = loadLocal('inhMeta', null);
if (inhMap && inhMeta) setInhStatus(true, `Rooms: ${inhMeta.rooms} | RO: ${inhMeta.ro} | ${inhMeta.file}`);
else setInhStatus(false);

function buildInhMapFromCsv(text, filename){
  const rows = csvParse(text).filter(r=>r.some(x=>x));
  if (rows.length < 2) throw new Error('CSV ว่างหรือรูปแบบไม่ถูกต้อง');

  const header = rows[0].map(h=>h.trim());
  const H = header.map(h=>h.toUpperCase());

  const idx = (cands)=>{
    for (const c of cands){
      const i = H.indexOf(c.toUpperCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const iRoom = idx(['ROOM','ห้อง']);
  const iPkg  = idx(['PACKAGE','PKG','แพคเกจ','MEALPLAN','MEALPLAN_OR_COMMENT']);
  const iName = idx(['GUEST FULL NAME','NAME','ชื่อ-นามสกุล','ALLNAMES','PRIMARYNAME']);

  if (iRoom === -1) throw new Error('ไม่พบคอลัมน์ "Room/ห้อง"');
  if (iName === -1) throw new Error('ไม่พบคอลัมน์ "Guest Full Name/ชื่อ-นามสกุล"');
  if (iPkg === -1) throw new Error('ไม่พบคอลัมน์ "Package/แพคเกจ"');

  const map = {};
  let rooms=0, ro=0;

  for (let r=1;r<rows.length;r++){
    const row = rows[r];
    const room = normRoom(row[iRoom] || '');
    if (!ROOM_RE.test(room)) continue;

    const name = normName(row[iName] || '') || '-';
    let pkg = String(row[iPkg] || '').trim().toUpperCase();
    pkg = (pkg === 'RO' || pkg.startsWith('RO')) ? 'RO' : 'RB';

    if (!map[room]){
      map[room] = {name, pkg};
      rooms++;
      if (pkg === 'RO') ro++;
    } else {
      if (name !== '-' && map[room].name !== name){
        const parts = map[room].name.split(';').map(x=>x.trim()).filter(Boolean);
        if (!parts.includes(name)) map[room].name = map[room].name + '; ' + name;
      }
      if (map[room].pkg !== 'RO' && pkg === 'RO'){ map[room].pkg='RO'; ro++; }
    }
  }

  inhMap = map;
  inhMeta = {rooms, ro, file: filename, loadedAt: nowISO()};
  saveLocal('inhMap', inhMap);
  saveLocal('inhMeta', inhMeta);
  setInhStatus(true, `Rooms: ${rooms} | RO: ${ro} | ${filename}`);
}

function getLogs(){
  const t = todayISO();
  return loadLocal('logs_' + t, []);
}
function setLogs(logs){
  const t = todayISO();
  saveLocal('logs_' + t, logs);
}
function findLogToday(room){
  const logs = getLogs();
  for (let i=logs.length-1;i>=0;i--){
    if (logs[i].Room === room) return logs[i];
  }
  return null;
}

function renderRecent(){
  const t = todayISO();
  els.today.textContent = t;

  const logs = getLogs().slice(-40).reverse();
  if (!logs.length){
    els.recent.textContent = 'วันนี้ยังไม่มีรายการ';
    return;
  }
  const lines = logs.map(l=>{
    const pay = l.NeedPayment === 'YES' ? 'PAY' : 'OK';
    return `${l.DateTime} | ${l.Room} | ${l.Guests} | ${l.GuestName} | ${l.Package} | ${pay}`;
  });
  els.recent.textContent = lines.join('\n');
}

function exportLogsCSV(){
  const t = todayISO();
  const logs = getLogs();
  if (!logs.length){ showModal({title:'ยังไม่มีข้อมูล', body:'วันนี้ยังไม่มีรายการให้ export'}); return; }

  const headers = ['DateTime','Date','Room','Guests','GuestName','Package','NeedPayment','InhFound'];
  const esc = (v)=>{
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const csv = [headers.join(',')]
    .concat(logs.map(l=>headers.map(h=>esc(h==='Date'?t:l[h])).join(',')))
    .join('\n');

  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `breakfast_checkins_${t}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importLogsCSV(file){
  const text = await file.text();
  const rows = csvParse(text).filter(r=>r.some(x=>x));
  if (rows.length < 2) throw new Error('ไฟล์ Logs ว่าง');
  const H = rows[0].map(x=>x.trim().toUpperCase());
  const idx = (name)=> H.indexOf(name.toUpperCase());

  const iDT = idx('DateTime');
  const iDate = idx('Date');
  const iRoom = idx('Room');
  const iGuests = idx('Guests');
  const iName = idx('GuestName');
  const iPkg = idx('Package');
  const iPay = idx('NeedPayment');
  const iFound = idx('InhFound');

  if (iDate === -1 || iRoom === -1) throw new Error('Logs CSV ต้องมีคอลัมน์ Date และ Room');

  // group by date
  const byDate = new Map();
  for (let r=1;r<rows.length;r++){
    const row = rows[r];
    const d = row[iDate] || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const room = normRoom(row[iRoom] || '');
    if (!room) continue;
    const item = {
      DateTime: row[iDT] || nowISO(),
      Room: room,
      Guests: parseInt(row[iGuests] || '1',10) || 1,
      GuestName: row[iName] || '-',
      Package: (String(row[iPkg]||'RB').toUpperCase()==='RO')?'RO':'RB',
      NeedPayment: (String(row[iPay]||'NO').toUpperCase()==='YES')?'YES':'NO',
      InhFound: (String(row[iFound]||'NO').toUpperCase()==='YES')?'YES':'NO',
    };
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(item);
  }

  for (const [d, arr] of byDate.entries()){
    const key = 'logs_' + d;
    const existing = loadLocal(key, []);
    const sig = new Set(existing.map(x=>`${x.DateTime}|${x.Room}|${x.Guests}`));
    for (const it of arr){
      const s = `${it.DateTime}|${it.Room}|${it.Guests}`;
      if (!sig.has(s)){
        existing.push(it);
        sig.add(s);
      }
    }
    existing.sort((a,b)=>String(a.DateTime).localeCompare(String(b.DateTime)));
    saveLocal(key, existing);
  }
}

els.btnLoadInh.addEventListener('click', ()=>els.fileInh.click());
els.fileInh.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const text = await file.text();
    buildInhMapFromCsv(text, file.name);
    await showModal({title:'สำเร็จ', body:'โหลด INH เรียบร้อย'});
  }catch(err){
    await showModal({title:'โหลด INH ไม่สำเร็จ', body: err?.message || String(err)});
  }finally{
    els.fileInh.value = '';
  }
});

els.btnExport.addEventListener('click', exportLogsCSV);

els.btnImport.addEventListener('click', ()=>els.fileLog.click());
els.fileLog.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    await importLogsCSV(file);
    await showModal({title:'นำเข้าเสร็จ', body:'Import Logs สำเร็จ'});
    renderRecent();
  }catch(err){
    await showModal({title:'Import ไม่สำเร็จ', body: err?.message || String(err)});
  }finally{
    els.fileLog.value = '';
  }
});

els.btnClear.addEventListener('click', async ()=>{
  const ok = await showModal({title:'ล้าง Logs', body:'ต้องการล้าง Logs ของ “วันนี้” หรือไม่?', ask:true});
  if (!ok) return;
  setLogs([]);
  renderRecent();
});

els.btnSave.addEventListener('click', saveFlow);
els.btnRefresh.addEventListener('click', renderRecent);

// Enter flow
els.room.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter'){ e.preventDefault(); els.guests.focus(); }
});
els.guests.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter'){ e.preventDefault(); saveFlow(); }
});

async function saveFlow(){
  const room = normRoom(els.room.value);
  const guestsTxt = String(els.guests.value || '').trim();

  if (!room) { await showModal({title:'ข้อมูลไม่ครบ', body:'กรุณาใส่เลขห้อง'}); return; }
  if (!ROOM_RE.test(room)) { await showModal({title:'เลขห้องไม่ถูกต้อง', body:'ตัวอย่าง: A203, D610, 8224'}); return; }
  if (!/^[0-9]+$/.test(guestsTxt)) { await showModal({title:'จำนวนท่านไม่ถูกต้อง', body:'จำนวนท่านต้องเป็นตัวเลข'}); return; }

  const guests = parseInt(guestsTxt,10);
  if (guests <= 0 || guests > 20){ await showModal({title:'จำนวนท่านไม่ถูกต้อง', body:'จำนวนท่านต้องอยู่ระหว่าง 1-20'}); return; }

  const hasInh = !!inhMap;
  const inhFound = (hasInh && inhMap[room]) ? 'YES' : 'NO';
  const guestName = (hasInh && inhMap[room]) ? (inhMap[room].name || '-') : '-';
  const pkg = (hasInh && inhMap[room]) ? (inhMap[room].pkg || 'RB') : 'RB';
  const needPay = (pkg === 'RO') ? 'YES' : 'NO';

  const last = findLogToday(room);
  if (last){
    const ok = await showModal({title:'ห้องนี้เช็คอินแล้ว', body:`ชื่อ: ${guestName}\nห้อง: ${room}\nเวลา: ${last.DateTime}\nต้องการบันทึกซ้ำหรือไม่?`, ask:true});
    if (!ok) return;
  }

  if (!hasInh){
    const ok = await showModal({title:'ยังไม่ได้โหลด INH', body:'ต้องการบันทึกต่อหรือไม่?', ask:true});
    if (!ok) return;
  }

  if (needPay === 'YES'){
    await showModal({
      title:'RO - ต้องเก็บเงิน',
      body:`ชื่อ: ${guestName}\nห้อง: ${room}\nกรุณาเก็บเงินอาหารเช้าก่อนให้เข้าห้องอาหาร`,
      isRO:true
    });
  }

  const logs = getLogs();
  logs.push({
    DateTime: nowISO(),
    Room: room,
    Guests: guests,
    GuestName: guestName,
    Package: (pkg === 'RO') ? 'RO' : 'RB',
    NeedPayment: needPay,
    InhFound: inhFound
  });
  setLogs(logs);

  await showModal({title:'บันทึกแล้ว', body:`ชื่อ: ${guestName}\nห้อง: ${room}\nจำนวน: ${guests} ท่าน\nแพคเกจ: ${(pkg==='RO')?'RO':'RB'}`, isRO:(pkg==='RO')});

  els.room.value = '';
  els.guests.value = '';
  els.room.focus();
  renderRecent();
}

renderRecent();
