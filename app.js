// Interfaccia ULTIMOKM. Aprire con ?demo=1 per provarla senza dispositivo.
import {
  API_OUTCOMES, DECISIONS, FakeFirmware, WIFI_STATES, connectBluetooth, messageFor,
} from './protocol.js';

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has('demo');

let device = null;
let link = null;
let busy = false;            // un'operazione lunga in corso (sospende l'aggiornamento stato)
let pollTimer = null;
let selectedSsid = '';
let hello = null;
let manualDisconnect = false;

// ------------------------------------------------------------------ utilita'

function show(el, visible) { el.hidden = !visible; }

function setMsg(el, text, kind = '') {
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
  show(el, !!text);
}

function errText(e) {
  if (e && e.code) return e.message;
  if (e && e.name === 'NotFoundError') return 'Nessun dispositivo selezionato.';
  if (e && e.name === 'SecurityError') return 'Permesso Bluetooth negato.';
  if (e && e.name === 'NetworkError')
    return 'Collegamento non riuscito. Se il dispositivo è stato ripristinato, su iPhone apri ' +
      'Impostazioni › Bluetooth, tocca ⓘ accanto al dispositivo, scegli "Dissocia questo dispositivo" e riprova.';
  return (e && e.message) || String(e);
}

function setPill(text, cls) {
  const p = $('conn-pill');
  p.textContent = text;
  p.className = 'pill ' + cls;
}

function screen(name) {
  show($('screen-connect'), name === 'connect');
  show($('screen-claim'), name === 'claim');
  show($('screen-main'), name === 'main');
}

async function run(button, msgEl, fn, okText) {
  if (button) button.disabled = true;
  if (msgEl) setMsg(msgEl, '');
  try {
    const r = await fn();
    if (msgEl && okText) setMsg(msgEl, typeof okText === 'function' ? okText(r) : okText, 'ok');
    return r;
  } catch (e) {
    if (msgEl) setMsg(msgEl, errText(e), 'err');
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function fmtAgo(s) {
  if (s < 0) return 'mai';
  if (s < 60) return `${s} s fa`;
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  return `${Math.floor(s / 3600)} h fa`;
}

function fmtDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
}

function signalBars(rssi) {
  if (rssi >= -55) return '▂▄▆█';
  if (rssi >= -67) return '▂▄▆';
  if (rssi >= -78) return '▂▄';
  return '▂';
}

// ------------------------------------------------------------------ connessione

async function connect(reuse = false) {
  const msg = $('connect-msg');
  setMsg(msg, 'Connessione…');
  setPill('Connessione…', 'pill-busy');
  try {
    if (demo) {
      link = new FakeFirmware({ owner: false, pairing: true }).link();
      await link.start();
      device = { name: 'ULTIMOKM-DEMO', gatt: { disconnect() {} } };
    } else {
      const r = await connectBluetooth(reuse ? device : null, onDisconnected);
      device = r.device;
      link = r.link;
    }
    // Il primo comando su collegamento cifrato fa comparire su iPhone la richiesta di abbinamento.
    hello = await requestWithRetry('hello', {}, 30000);
    setMsg(msg, '');
    show($('banner'), false);
    setPill(hello.n || device.name || 'Connesso', 'pill-on');
    if (!hello.own && hello.pw > 0) {
      await link.request('claim');
      hello.own = true;
    }
    if (hello.own) await enterMain();
    else screen('claim');
  } catch (e) {
    setPill('Non connesso', 'pill-off');
    setMsg(msg, errText(e), 'err');
    screen('connect');
  }
}

async function requestWithRetry(c, params, timeoutMs) {
  try {
    return await link.request(c, params, timeoutMs);
  } catch (e) {
    // Subito dopo l'abbinamento la prima scrittura puo' fallire: un secondo tentativo.
    if (e.code) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    return link.request(c, params, timeoutMs);
  }
}

function onDisconnected() {
  stopPolling();
  link = null;
  if (manualDisconnect) {
    manualDisconnect = false;
    return;
  }
  setPill('Disconnesso', 'pill-off');
  const b = $('banner');
  b.innerHTML = '';
  b.append('Dispositivo disconnesso. ');
  const btn = document.createElement('button');
  btn.className = 'btn small';
  btn.textContent = 'Riconnetti';
  btn.onclick = () => connect(true);
  b.append(btn);
  show(b, true);
}

async function enterMain() {
  screen('main');
  $('dev-name').textContent = hello.n || '—';
  $('dev-fw').textContent = hello.v || '—';
  await loadConfig();
  if (!hello.cfg) selectTab('wifi');
  startPolling();
}

// ------------------------------------------------------------------ stato

function startPolling() {
  stopPolling();
  refreshStatus();
  pollTimer = setInterval(refreshStatus, 3000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function refreshStatus() {
  if (!link || busy) return;
  try {
    const s = await link.request('status');
    const d = await link.request('ids');
    renderStatus(s, d);
  } catch (e) {
    if (e.code === 'non_autorizzato') screen('claim');
  }
}

function renderStatus(s, d) {
  $('led1').classList.toggle('on', !!s.l.o1);
  $('led2').classList.toggle('on', !!s.l.o2);
  let sig = 'Spenti';
  if (s.l.t) sig = 'Prova faretti in corso';
  else if (s.l.s) sig = `Nuovo ordine! Segnalazione ancora per ${s.l.r} s` + (s.l.q ? ` (+${s.l.q} in coda)` : '');
  $('st-signal').textContent = sig;
  show($('btn-stop-main'), s.l.s || s.l.t);

  $('st-wifi').textContent = WIFI_STATES[s.w.st] || s.w.st;
  $('st-ssid').textContent = s.w.ss || '—';
  $('st-ip').textContent = s.w.ip || '—';
  $('st-rssi').textContent = s.w.st === 'connesso' ? `${signalBars(s.w.rs)} ${s.w.rs} dBm` : '—';
  setMsg($('st-wifi-err'), s.w.e && s.w.st !== 'connesso' ? messageFor(s.w.e) : '', 'err');

  const a = s.a;
  $('st-api').textContent = a.bz ? 'in corso…' : fmtAgo(a.ago);
  let res = API_OUTCOMES[a.st] || a.st;
  if (a.st === 'http' || a.st === 'auth') res += ` (HTTP ${a.h})`;
  $('st-api-res').textContent = res;
  $('st-api-res').className = a.st === 'ok' ? 'ok-text' : '';
  $('st-api-next').textContent = a.nx >= 0 ? `tra ${a.nx} s` : 'in attesa del Wi-Fi';
  $('st-api-fail').textContent = String(a.f);
  setMsg($('st-api-detail'), d.dt ? `Dettaglio tecnico: ${d.dt}` : '', 'small');

  $('st-saved').textContent = d.sv || '(nessuno)';
  $('st-rx').textContent = d.rx || '—';
  $('st-decision').textContent = (DECISIONS[d.d] || d.d) + (d.pe ? ' — salvataggio in attesa' : '');

  $('dev-up').textContent = fmtDuration(s.up);
  $('dev-heap').textContent = `${Math.round(d.hp / 1024)} KB`;
  $('wifi-current').textContent = s.w.ss
    ? `${s.w.ss} — ${WIFI_STATES[s.w.st] || s.w.st}` : 'Nessuna rete configurata';
}

// ------------------------------------------------------------------ configurazione

async function loadConfig() {
  const c = await link.request('config');
  $('api-url').value = c.u;
  $('api-interval').value = c.i;
  $('api-backoff').value = c.b;
  $('sig-mode').value = c.m;
  $('sig-dur').value = c.d;
  $('sig-blink').value = c.k;
  $('sig-onnew').value = c.n;
  show($('blink-row'), c.m === 'blink');
  $('wifi-current').textContent = c.ws ? c.ws + (c.wh ? ' (nascosta)' : '') : 'Nessuna rete configurata';
}

async function scanNetworks() {
  const list = $('net-list');
  list.innerHTML = '<li>Ricerca in corso…</li>';
  busy = true;
  try {
    await link.request('scan', {}, 20000);
    const nets = [];
    let offset = 0;
    while (offset >= 0 && nets.length < 60) {
      const p = await link.request('scan_page', { o: offset });
      nets.push(...p.nets);
      offset = p.next;
    }
    list.innerHTML = '';
    if (!nets.length) list.innerHTML = '<li>Nessuna rete trovata</li>';
    for (const n of nets) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = n.s || `Rete nascosta${n.h > 1 ? ` (${n.h})` : ''}`;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${n.o ? '' : '🔒 '}${signalBars(n.r)}`;
      li.append(name, meta);
      li.onclick = () => {
        [...list.children].forEach((x) => x.classList.remove('sel'));
        li.classList.add('sel');
        if (n.s) {
          $('wifi-manual').checked = false;
          selectedSsid = n.s;
        } else {
          $('wifi-manual').checked = true;
          selectedSsid = '';
        }
        updateSsidUi();
        if (!n.s) $('wifi-ssid').focus();
        else if (!n.o) $('wifi-pass').focus();
      };
      list.append(li);
    }
  } catch (e) {
    list.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = errText(e);
    list.append(li);
  } finally {
    busy = false;
  }
}

function updateSsidUi() {
  const manual = $('wifi-manual').checked;
  show($('ssid-row'), manual);
  const sel = $('wifi-selected');
  sel.textContent = !manual && selectedSsid ? `Rete scelta: ${selectedSsid}` : '';
  show(sel, !manual && !!selectedSsid);
}

async function saveWifi() {
  const manual = $('wifi-manual').checked;
  const ssid = manual ? $('wifi-ssid').value : selectedSsid;
  const pass = $('wifi-pass').value;
  const msg = $('wifi-msg');
  if (!ssid) return setMsg(msg, messageFor('ssid_vuoto'), 'err');
  busy = true;
  setPill('Verifica rete…', 'pill-busy');
  setMsg(msg, `Verifica della rete "${ssid}" in corso (fino a 30 secondi)…`);
  $('btn-wifi').disabled = true;
  try {
    const r = await link.request('wifi', { s: ssid, p: pass, h: manual }, 45000);
    setMsg(msg, `Connesso a "${ssid}" (IP ${r.ip}). Configurazione salvata.` +
      (r.w ? ' Attenzione: ' + messageFor(r.w) : ''), 'ok');
    $('wifi-pass').value = '';
    await loadConfig();
  } catch (e) {
    setMsg(msg, errText(e) + ' La configurazione precedente non è stata modificata.', 'err');
  } finally {
    busy = false;
    $('btn-wifi').disabled = false;
    setPill(hello?.n || 'Connesso', 'pill-on');
  }
}

function num(id) { return Number($(id).value); }

// ------------------------------------------------------------------ eventi

function selectTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => show(p, p.id === 'tab-' + name));
  if (name === 'stato') refreshStatus();
}

function confirmThen(text, fn) {
  return () => { if (confirm(text)) fn(); };
}

function wire() {
  if (!navigator.bluetooth && !demo) show($('no-bt'), true);
  if (demo) setMsg($('connect-msg'), 'Modalità dimostrativa: nessun dispositivo reale.', 'ok');

  $('btn-connect').onclick = () => connect(false);
  $('btn-claim').onclick = () => run($('btn-claim'), $('claim-msg'), async () => {
    await link.request('claim');
    hello.own = true;
    await enterMain();
  });

  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => selectTab(t.dataset.tab); });

  $('btn-poll').onclick = () => run($('btn-poll'), $('st-api-detail'),
    () => link.request('poll'), 'Richiesta inviata.');
  const stop = () => link.request('stop').then(refreshStatus);
  $('btn-stop-main').onclick = stop;

  $('btn-scan').onclick = () => run($('btn-scan'), null, scanNetworks);
  $('wifi-manual').onchange = updateSsidUi;
  $('btn-showpw').onclick = () => {
    const p = $('wifi-pass');
    p.type = p.type === 'password' ? 'text' : 'password';
    $('btn-showpw').textContent = p.type === 'password' ? 'Mostra' : 'Nascondi';
  };
  $('btn-wifi').onclick = saveWifi;

  $('btn-api').onclick = () => run($('btn-api'), $('api-msg'), () => link.request('api', {
    u: $('api-url').value.trim(), i: num('api-interval'), b: num('api-backoff'),
  }), 'Salvato. Nuova richiesta in corso.');

  $('sig-mode').onchange = () => show($('blink-row'), $('sig-mode').value === 'blink');
  $('btn-sig').onclick = () => run($('btn-sig'), $('sig-msg'), () => link.request('sig', {
    m: $('sig-mode').value, d: num('sig-dur'), k: num('sig-blink'), n: $('sig-onnew').value,
  }), 'Salvato.');

  document.querySelectorAll('[data-test]').forEach((b) => {
    b.onclick = () => run(b, $('test-msg'), () => link.request('test', { t: b.dataset.test }),
      b.dataset.test === 'off' ? 'Prova terminata.' : 'Prova in corso per 10 secondi.');
  });
  $('btn-sigtest').onclick = () => run($('btn-sigtest'), $('test-msg'), () => link.request('sig_test'),
    'Segnalazione avviata (l\'ID di riferimento non cambia).');
  $('btn-stop').onclick = () => run($('btn-stop'), $('test-msg'), stop, 'Faretti spenti.');

  const altro = $('altro-msg');
  $('btn-pair').onclick = () => run($('btn-pair'), altro, () => link.request('pair_open'),
    'Per 5 minuti un altro telefono può collegarsi e diventare autorizzato.');
  $('btn-unpair').onclick = confirmThen('Rimuovere tutti gli altri telefoni autorizzati?',
    () => run($('btn-unpair'), altro, () => link.request('unpair_others'), 'Ora solo questo telefono è autorizzato.'));
  $('btn-forget').onclick = confirmThen('Il dispositivo si scollegherà dal Wi-Fi e smetterà di controllare gli ordini. Continuare?',
    () => run($('btn-forget'), altro, async () => { await link.request('wifi_forget'); await loadConfig(); },
      'Rete dimenticata. Configurane una nuova nella scheda Wi-Fi.'));
  $('btn-idclear').onclick = confirmThen('Azzerare l\'ID di riferimento?',
    () => run($('btn-idclear'), altro, () => link.request('id_clear'), 'ID di riferimento azzerato.'));
  $('btn-factory').onclick = confirmThen(
    'Ripristinare la configurazione? Wi-Fi, servizio, impostazioni dei faretti e telefoni autorizzati verranno cancellati.',
    () => run($('btn-factory'), altro, async () => {
      await link.request('factory');
      stopPolling();
    }, 'Ripristino eseguito, il dispositivo si riavvia. Su iPhone dissocia ora il dispositivo in Impostazioni › Bluetooth.'));
  $('btn-disconnect').onclick = () => {
    stopPolling();
    manualDisconnect = true;
    if (device && device.gatt && device.gatt.connected !== false) device.gatt.disconnect();
    link = null;
    setPill('Non connesso', 'pill-off');
    screen('connect');
  };
}

wire();
