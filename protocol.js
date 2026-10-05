// Protocollo BLE di ULTIMOKM: richieste JSON sulla caratteristica COMANDO,
// risposte sulla caratteristica RISPOSTA (notifica breve "r:<id>" + lettura).
// Nessuna dipendenza dal browser: usato dall'app e dai test con Node.

export const SERVICE_UUID = '112447d0-e0f2-49bc-9586-ed01084cdb83';
export const COMMAND_UUID = 'a3aa5cd7-84b3-4486-a8d8-85753511cb6f';
export const RESPONSE_UUID = '99797cb3-3b6d-49ac-b967-36943cc3879b';
export const NAME_PREFIX = 'ULTIMOKM-';
export const MAX_COMMAND_BYTES = 512;

// Codici restituiti dal firmware -> testo per l'utente.
export const MESSAGES = {
  // Collegamento e autorizzazione
  non_autorizzato: 'Questo telefono non è autorizzato a modificare il dispositivo.',
  associazione_chiusa:
    'Associazione chiusa. Premi brevemente il pulsante BOOT sulla scheda e riprova entro 5 minuti.',
  troppi_telefoni:
    'Ci sono già 2 telefoni autorizzati. Da un telefono autorizzato usa "Rimuovi gli altri telefoni", oppure esegui il ripristino.',
  collegamento_non_cifrato: 'Il collegamento non è cifrato: accetta la richiesta di abbinamento Bluetooth e riprova.',
  timeout_dispositivo: 'Il dispositivo non ha risposto in tempo.',
  comando_troppo_lungo: 'Dati troppo lunghi da inviare.',
  comando_non_valido: 'Comando non valido.',
  comando_sconosciuto: 'Comando non supportato da questo firmware.',
  risposta_troppo_grande: 'Risposta del dispositivo troppo grande.',
  occupato: 'Il dispositivo sta verificando una rete: attendi qualche secondo.',
  salvataggio_fallito: 'Salvataggio nella memoria del dispositivo non riuscito.',
  disconnesso: 'Dispositivo disconnesso.',
  // Wi-Fi
  ssid_vuoto: 'Inserisci il nome della rete.',
  ssid_troppo_lungo: 'Il nome della rete può avere al massimo 32 caratteri.',
  password_lunghezza: 'La password deve avere da 8 a 63 caratteri (lasciala vuota solo per reti aperte).',
  password_non_valida: 'Password non valida.',
  rete_non_trovata:
    'Rete non trovata. Controlla il nome (maiuscole comprese), che sia una rete a 2,4 GHz e che il dispositivo sia nel raggio del router.',
  password_errata: 'Password errata.',
  router_non_risponde: 'Il router non risponde. Avvicina il dispositivo al router e riprova.',
  router_rifiuta: 'Il router ha rifiutato la connessione (troppi dispositivi collegati o filtro sugli indirizzi?).',
  segnale_perso: 'Segnale Wi-Fi perso.',
  ip_non_ottenuto: 'Collegato al router ma nessun indirizzo IP ricevuto (DHCP).',
  timeout: 'La rete non ha risposto entro il tempo previsto.',
  connessione_persa: 'Connessione Wi-Fi persa.',
  wifi_errore: 'Errore Wi-Fi.',
  wifi_non_connesso: 'Il dispositivo non è connesso al Wi-Fi.',
  scansione_fallita: 'Ricerca delle reti non riuscita. Riprova.',
  // Servizio web
  url_vuoto: "Inserisci l'indirizzo del servizio.",
  url_troppo_lungo: 'Indirizzo troppo lungo (massimo 256 caratteri).',
  url_caratteri_non_validi: "L'indirizzo contiene spazi o caratteri non ammessi.",
  url_non_https: "L'indirizzo deve iniziare con https://",
  url_senza_host: "Nell'indirizzo manca il nome del server.",
  url_credenziali_non_ammesse: "Non inserire nome utente o password nell'indirizzo.",
  intervallo_non_valido: "L'intervallo deve essere tra 5 e 3600 secondi.",
  attesa_massima_non_valida: "L'attesa massima deve essere tra l'intervallo e 3600 secondi.",
  // Segnalazione
  modalita_non_valida: 'Modalità non valida.',
  durata_non_valida: 'La durata deve essere tra 1 e 3600 secondi.',
  lampeggio_non_valido: 'La velocità di lampeggio deve essere tra 100 e 5000 ms.',
  comportamento_non_valido: 'Comportamento non valido.',
};

export const WIFI_STATES = {
  non_configurato: 'Non configurato',
  connessione: 'Connessione in corso…',
  connesso: 'Connesso',
  attesa_riprova: 'Disconnesso, nuovo tentativo a breve',
  prova: 'Verifica della nuova rete…',
};

export const API_OUTCOMES = {
  ok: 'Risposta valida',
  attesa: 'Nessuna richiesta ancora eseguita',
  rete: 'Server non raggiungibile (rete o DNS)',
  timeout: 'Il server non ha risposto in tempo',
  tls: 'Connessione sicura non riuscita (certificato non valido?)',
  auth: 'Accesso negato dal server (autenticazione)',
  http: 'Errore del server',
  troppo_grande: 'Risposta troppo grande',
  json_malformato: 'Risposta non in formato JSON valido',
  json_non_oggetto: 'Risposta JSON con struttura inattesa',
  id_mancante: 'Campo "id" assente nella risposta',
  id_nullo: 'Campo "id" nullo',
  id_non_stringa: 'Il campo "id" non è una stringa',
  id_vuoto: 'Campo "id" vuoto',
  id_troppo_lungo: 'Campo "id" troppo lungo',
};

export const DECISIONS = {
  nessuna: '—',
  primo_riferimento: 'Primo ID registrato come riferimento (nessuna segnalazione)',
  invariato: 'Nessun nuovo ordine',
  nuovo_ordine: 'Nuovo ordine rilevato',
};

export function messageFor(code) {
  return MESSAGES[code] || `Errore: ${code}`;
}

export class DeviceError extends Error {
  constructor(code) {
    super(messageFor(code));
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Canale richiesta/risposta sopra due caratteristiche GATT (reali o simulate).
// Le richieste sono serializzate: una sola alla volta, cosi' la risposta
// letta appartiene sempre alla richiesta in corso.
export class Link {
  constructor(command, response) {
    this.command = command;
    this.response = response;
    this.queue = Promise.resolve();
    this.rid = 1 + Math.floor(Math.random() * 1_000_000);
    this.notified = new Set();
    this.waiter = null;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this.onNotify = (event) => {
      const text = this.decoder.decode(event.target.value);
      const m = /^r:(\d+)$/.exec(text);
      if (!m) return;
      const rid = Number(m[1]);
      this.notified.add(rid);
      if (this.waiter && this.waiter.rid === rid) this.waiter.resolve();
    };
  }

  async start() {
    this.response.addEventListener('characteristicvaluechanged', this.onNotify);
    try {
      await this.response.startNotifications();
    } catch (e) {
      // Senza notifiche il canale funziona comunque leggendo periodicamente.
      console.warn('Notifiche non disponibili, uso la lettura periodica', e);
    }
  }

  request(c, params = {}, timeoutMs = 8000) {
    const run = () => this.#exchange(c, params, timeoutMs);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async #exchange(c, params, timeoutMs) {
    const rid = this.rid++;
    const bytes = this.encoder.encode(JSON.stringify({ c, r: rid, ...params }));
    if (bytes.length > MAX_COMMAND_BYTES) throw new DeviceError('comando_troppo_lungo');
    const w = this.command.writeValueWithResponse
      ? this.command.writeValueWithResponse(bytes)
      : this.command.writeValue(bytes);
    await w;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.#waitNotify(rid, Math.min(700, Math.max(0, deadline - Date.now())));
      const res = await this.#read();
      if (res && res.r === rid) {
        this.notified.delete(rid);
        if (!res.ok) throw new DeviceError(res.e || 'errore');
        return res;
      }
    }
    throw new DeviceError('timeout_dispositivo');
  }

  #waitNotify(rid, ms) {
    if (this.notified.has(rid)) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(t);
        if (self.waiter && self.waiter.rid === rid) self.waiter = null;
        resolve();
      }
      this.waiter = { rid, resolve: done };
    });
  }

  async #read() {
    try {
      const v = await this.response.readValue();
      return JSON.parse(this.decoder.decode(v));
    } catch {
      return null;  // lettura parziale o JSON non ancora completo: si riprova
    }
  }
}

// Collegamento reale tramite Web Bluetooth (Bluefy su iPhone, Chrome su Android/PC).
export async function connectBluetooth(existingDevice, onDisconnect) {
  if (!navigator.bluetooth) throw new Error('bluetooth_non_supportato');
  const device =
    existingDevice ||
    (await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }, { namePrefix: NAME_PREFIX }],
      optionalServices: [SERVICE_UUID],
    }));
  if (!existingDevice && onDisconnect) device.addEventListener('gattserverdisconnected', onDisconnect);
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const command = await service.getCharacteristic(COMMAND_UUID);
  const response = await service.getCharacteristic(RESPONSE_UUID);
  const link = new Link(command, response);
  await link.start();
  return { device, link };
}

// ---------------------------------------------------------------------------
// Dispositivo simulato: stesso protocollo del firmware, per provare l'app
// senza hardware (?demo=1) e per i test automatici.

class FakeCharacteristic extends EventTarget {
  constructor(onWrite) {
    super();
    this.value = new DataView(new ArrayBuffer(0));
    this.onWrite = onWrite;
    this.notifications = false;
  }
  async writeValueWithResponse(bytes) {
    await sleep(5);
    this.onWrite(new TextDecoder().decode(bytes));
  }
  async readValue() {
    await sleep(5);
    return this.value;
  }
  async startNotifications() {
    this.notifications = true;
  }
  setValue(text) {
    const b = new TextEncoder().encode(text);
    this.value = new DataView(b.buffer);
  }
  notify(text) {
    if (!this.notifications) return;
    const ev = new Event('characteristicvaluechanged');
    const b = new TextEncoder().encode(text);
    Object.defineProperty(ev, 'target', { value: { value: new DataView(b.buffer) } });
    this.dispatchEvent(ev);
  }
}

export class FakeFirmware {
  constructor({ owner = false, pairing = true, delayMs = 20 } = {}) {
    this.delayMs = delayMs;
    this.owner = owner;
    this.pairing = pairing;
    this.cfg = { ws: '', wh: false, wp: false, u: 'https://www.ultimo-km.it/api/ordini/ultimo', i: 10, b: 300,
      m: 'blink', d: 60, k: 500, n: 'restart', http: false };
    this.saved = '';
    this.received = '';
    this.decision = 'nessuna';
    this.wifi = { st: 'non_configurato', ss: '', ip: '', rs: 0, e: '' };
    this.led = { s: false, r: 0, q: 0, t: false, o1: false, o2: false };
    this.nets = [
      { s: 'Negozio-WiFi', r: -48, o: false },
      { s: 'FRITZ!Box 7530', r: -63, o: false },
      { s: 'Ospiti', r: -71, o: true },
      { s: '', r: -80, o: false, h: 1 },
    ];
    this.passwords = { 'Negozio-WiFi': 'password123', 'FRITZ!Box 7530': 'segreto-lungo', Ospiti: '' };
    this.command = new FakeCharacteristic((t) => this.#handle(t));
    this.response = new FakeCharacteristic(() => {});
  }

  #reply(r, body) {
    setTimeout(() => {
      this.response.setValue(JSON.stringify({ r, ...body }));
      this.response.notify(`r:${r}`);
    }, this.delayMs);
  }

  #handle(text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return this.#reply(0, { ok: false, e: 'comando_non_valido' });
    }
    const r = m.r;
    const ok = (extra = {}) => this.#reply(r, { ok: true, ...extra });
    const err = (e) => this.#reply(r, { ok: false, e });
    if (m.c === 'hello') return ok({ n: 'ULTIMOKM-DEMO', v: '1.0.0', own: this.owner, pw: this.pairing ? 300 : 0,
      no: this.owner ? 1 : 0, cfg: !!this.cfg.ws });
    if (m.c === 'claim') {
      if (this.owner) return ok();
      if (!this.pairing) return err('associazione_chiusa');
      this.owner = true;
      this.pairing = false;
      return ok();
    }
    if (!this.owner) return err('non_autorizzato');
    switch (m.c) {
      case 'status':
        return ok({ v: '1.0.0', up: 1234, own: true, pw: 0, w: this.wifi,
          a: this.wifi.st === 'connesso' ? { st: 'ok', h: 200, ago: 3, nx: 7, f: 0, bz: false }
            : { st: 'attesa', h: 0, ago: -1, nx: -1, f: 0, bz: false },
          l: this.led });
      case 'ids':
        return ok({ sv: this.saved, rx: this.received, d: this.decision, pe: false, ms: 240, dt: '', rc: 0, hp: 120000 });
      case 'config':
        return ok(this.cfg);
      case 'scan':
        return setTimeout(() => ok({ n: this.nets.length }), 1500);
      case 'scan_page': {
        const o = m.o || 0;
        const page = this.nets.slice(o, o + 3);
        return ok({ nets: page, next: o + 3 < this.nets.length ? o + 3 : -1 });
      }
      case 'wifi': {
        if (!m.s) return err('ssid_vuoto');
        if (m.p && (m.p.length < 8 || m.p.length > 63)) return err('password_lunghezza');
        this.wifi = { ...this.wifi, st: 'prova' };
        return setTimeout(() => {
          const known = Object.prototype.hasOwnProperty.call(this.passwords, m.s);
          if (!known && !m.h) { this.wifi.st = this.cfg.ws ? 'connesso' : 'non_configurato'; return err('rete_non_trovata'); }
          if (known && this.passwords[m.s] !== (m.p || '')) {
            this.wifi.st = this.cfg.ws ? 'connesso' : 'non_configurato';
            return err('password_errata');
          }
          this.cfg = { ...this.cfg, ws: m.s, wh: !!m.h, wp: !!m.p };
          this.wifi = { st: 'connesso', ss: m.s, ip: '192.168.1.57', rs: -55, e: '' };
          if (!this.saved) { this.saved = this.received = '9285079f-f42d-465f-884d-11cceed327c8'; this.decision = 'primo_riferimento'; }
          ok({ ip: '192.168.1.57' });
        }, 2500);
      }
      case 'wifi_forget':
        this.cfg = { ...this.cfg, ws: '', wp: false };
        this.wifi = { st: 'non_configurato', ss: '', ip: '', rs: 0, e: '' };
        return ok();
      case 'api':
        if (!/^https:\/\/[^/]+/.test(m.u || '')) return err('url_non_https');
        if (m.i < 5 || m.i > 3600) return err('intervallo_non_valido');
        if (m.b < m.i || m.b > 3600) return err('attesa_massima_non_valida');
        Object.assign(this.cfg, { u: m.u, i: m.i, b: m.b });
        return ok();
      case 'sig':
        if (m.d < 1 || m.d > 3600) return err('durata_non_valida');
        if (m.k < 100 || m.k > 5000) return err('lampeggio_non_valido');
        Object.assign(this.cfg, { m: m.m, d: m.d, k: m.k, n: m.n });
        return ok();
      case 'test':
        this.led = { ...this.led, t: m.t !== 'off', o1: m.t === '1' || m.t === 'both', o2: m.t === '2' || m.t === 'both' };
        return ok();
      case 'sig_test':
        this.led = { ...this.led, s: true, r: this.cfg.d, o1: true, o2: true };
        return ok({ t: 'avviata' });
      case 'stop':
        this.led = { s: false, r: 0, q: 0, t: false, o1: false, o2: false };
        return ok();
      case 'poll':
        return this.wifi.st === 'connesso' ? ok() : err('wifi_non_connesso');
      case 'id_clear':
        this.saved = '';
        return ok();
      case 'pair_open':
        this.pairing = true;
        return ok();
      case 'unpair_others':
      case 'factory':
        return ok();
      default:
        return err('comando_sconosciuto');
    }
  }

  link() {
    return new Link(this.command, this.response);
  }
}
