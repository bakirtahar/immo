(function () {
'use strict';
/* ==========================================================================
   immo (CTB) — noyau : état, stockage, sécurité, coquille
   ========================================================================== */
const EN = window.Engine;
const fmt = EN.fmtNum, fdate = EN.fmtDate, r3 = EN.r3, num = EN.num;

const ADMIN_DEFAULT = { email: '' };
const SCHEMA = 2;
/** Version GitHub + Supabase Auth (config.js présent) ou version de démonstration claude.ai. */
const SUPA = !!window.IMMO_CONFIG;
// Signature des catégories livrées avec la première version (pour les remplacer si l'administrateur ne les a pas modifiées)
const OLD_CAT_SIGNATURE = '01:0:0|02:5:5|03:10:10|04:10:10|05:15:15|06:10:10|07:10:10|08:20:20|09:20:20|10:20:20|11:20:20|12:33.33:33.33|13:15:15|14:15:15|15:33.33:33.33|19:0:0|20:33.33:33.33|21:20:20|22:5:0|23:5:0|24:20:20';
const OLD_SORTIES = 'Cession (vente)|Mise au rebut / casse|Vol|Perte / manquant à l\'inventaire|Sinistre (destruction)|Don|Apport en société|Autre';
const OLD_ETATS = 'Bon|Moyen|Mauvais|Hors service';

function defaultConfig() {
  return {
    schema: SCHEMA,
    appName: 'immo',
    tagline: 'Gestion des immobilisations corporelles et incorporelles',
    logo: null,
    colors: { bg: '#22073F', accent: '#7542E5', soft: '#D9CCFF' },
    loginMessage: 'Espace réservé aux clients du Cabinet Tahar Bakir. Connectez-vous avec l\'adresse e-mail invitée par le cabinet.',
    reportFooter: 'immo – application propriété de CTB – Cabinet Tahar Bakir',
    codeSep: '-',
    counterScope: 'prefix',
    prorata: 'jours',
    fiscal: JSON.parse(JSON.stringify(EN.DEFAULT_FISCAL)),
    comptes: JSON.parse(JSON.stringify(EN.DEFAULT_COMPTES)),
    categories: JSON.parse(JSON.stringify(EN.DEFAULT_CATEGORIES)),
    sorties: EN.DEFAULT_SORTIES.slice(),
    etats: EN.DEFAULT_ETATS.slice(),
    customFields: [],
    modules: { inventaire: true, etiquettes: true, import: true, fiscal: true }
  };
}

/* ---------------- État global ---------------- */
const S = {
  cfg: defaultConfig(),
  adminAuth: null,
  session: null,
  registry: [],
  tenants: {},
  tenant: null, tenantId: null,
  assets: [], inventories: [],
  view: 'dash', arg: null,
  year: new Date().getFullYear(),
  ui: {},
  ready: false,
  failures: 0, lockUntil: 0
};

/* ---------------- Utilitaires ---------------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function money(v) { return fmt(v, 3); }
function sel(v, cur) { return String(v) === String(cur) ? ' selected' : ''; }
function chk(b) { return b ? ' checked' : ''; }
function opt(list, cur, labelFn) { return list.map((x) => { const v = typeof x === 'object' ? x.v : x; const l = typeof x === 'object' ? x.l : x; return '<option value="' + esc(v) + '"' + sel(v, cur) + '>' + esc(labelFn ? labelFn(x) : l) + '</option>'; }).join(''); }
function yrs(v) { return EN.fmtYears(v) || '—'; }

function referentiel() { return (S.tenant && S.tenant.referentiel) === 'FISCAL' ? 'FISCAL' : 'NC05'; }
function engineCfg() {
  const t = S.tenant || {};
  return { prorata: t.prorata || S.cfg.prorata || 'jours', clotureMois: Number(t.clotureMois) || 12, clotureJour: Number(t.clotureJour) || 31, fiscal: S.cfg.fiscal, comptes: S.cfg.comptes, referentiel: referentiel(), ecartVirement: t.ecartVirement || 'sortie' };
}
function cats() { return (S.tenant && S.tenant.categories) || S.cfg.categories; }
function catOf(code) { return cats().find((c) => c.code === code); }
function emps() { return (S.tenant && S.tenant.emplacements) || []; }
function empOf(code) { return emps().find((e) => e.code === code); }
function empLabel(code) { const e = empOf(code); return e ? e.code + ' – ' + e.libelle : (code || '—'); }
function catLabel(code) { const c = catOf(code); return c ? c.code + ' – ' + c.libelle : (code || '—'); }
function codeTxt(code) { return EN.fmtCode(code, S.cfg.codeSep); }
const schedCache = new Map();
function sched(a) {
  const key = a.id + '|' + (a.updatedAt || '') + '|' + JSON.stringify(engineCfg()) + '|' + JSON.stringify(catOf(a.categorie) || {});
  if (schedCache.has(key)) return schedCache.get(key);
  const s = EN.schedule(a, catOf(a.categorie), engineCfg());
  if (schedCache.size > 4000) schedCache.clear();
  schedCache.set(key, s);
  return s;
}
function currentExo() { return EN.exoOf(EN.today(), engineCfg()); }
function assetById(id) { return S.assets.find((a) => a.id === id); }

/* ---------------- Mises à niveau des données ---------------- */
function catSignature(list) { return (list || []).map((c) => c.code + ':' + c.taux + ':' + c.tauxFiscal).join('|'); }
function upgradeConfig(c) {
  const out = c;
  if (!(Number(out.schema) >= 2)) {
    out.categories = catSignature(out.categories) === OLD_CAT_SIGNATURE ? clone(EN.DEFAULT_CATEGORIES) : (out.categories || []).map(EN.upgradeCategory);
    if ((out.sorties || []).join('|') === OLD_SORTIES) out.sorties = EN.DEFAULT_SORTIES.slice();
    if ((out.etats || []).join('|') === OLD_ETATS) out.etats = EN.DEFAULT_ETATS.slice();
    out.schema = SCHEMA;
  } else out.categories = (out.categories || []).map(EN.upgradeCategory);
  return out;
}
function upgradeTenant(t) {
  if (!t) return t;
  t.categories = (t.categories || clone(S.cfg.categories)).map(EN.upgradeCategory);
  if (!t.referentiel) t.referentiel = 'NC05';
  if (!t.ecartVirement) t.ecartVirement = 'sortie';
  t.evaluation = t.evaluation || {};
  t.notesInfo = t.notesInfo || {};
  return t;
}

/* ---------------- Notifications ---------------- */
function toast(msg, kind) {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 4200);
}

/* ---------------- Fenêtre modale ---------------- */
let modalState = null;
function openModal(o) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = '<div class="modal ' + (o.size || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
    '<div class="modal-h"><h3>' + esc(o.title) + '</h3><button class="x" data-act="modal-close" aria-label="Fermer">×</button></div>' +
    '<div class="modal-b">' + o.body + '</div>' +
    (o.foot === false ? '' : '<div class="modal-f">' + (o.foot || '<button class="btn ghost" data-act="modal-close">Fermer</button>') + '</div>') + '</div>';
  document.body.appendChild(bg);
  modalState = { el: bg, opts: o };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg && !o.sticky) closeModal(); });
  if (o.mount) o.mount(bg);
  const first = bg.querySelector('[autofocus]') || bg.querySelector('input,select,textarea,button.btn');
  if (first) setTimeout(() => first.focus(), 30);
  return bg;
}
function closeModal() { if (modalState) { modalState.el.remove(); modalState = null; } }
function confirmBox(title, html, okLabel, danger) {
  return new Promise((resolve) => {
    openModal({
      title: title, size: 'narrow', body: '<div class="form">' + html + '</div>',
      foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn ' + (danger ? 'danger' : '') + '" id="cfm-ok">' + esc(okLabel || 'Confirmer') + '</button>',
      mount: (el) => {
        el.querySelector('#cfm-ok').addEventListener('click', () => { const ok = el.querySelector('#cfm-input'); const v = ok ? ok.value : true; closeModal(); resolve(v); });
        el.querySelectorAll('[data-act="modal-close"]').forEach((b) => b.addEventListener('click', () => resolve(false)));
      }
    });
  });
}

/* ---------------- Stockage (base partagée ou navigateur) ---------------- */
const Store = {
  mode: 'pending', db: null, ready: null, canWrite: null, isOwner: null, runtime: false,
  queues: new Map(),
  init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      try {
        if (window.claude && typeof window.claude.use === 'function') {
          this.runtime = true;
          const db = await window.claude.use('db');
          if (db) {
            this.db = db; this.mode = 'db';
            try {
              const u = await window.claude.use('user');
              if (u) { this.isOwner = await u.isOwner(); this.canWrite = await u.can('data.write'); }
            } catch (e) { /* sans effet */ }
            return;
          }
        }
      } catch (e) { /* bascule en local */ }
      this.mode = 'local';
    })();
    return this.ready;
  },
  lsKey(p) { return 'ctbimmo::' + p; },
  async get(path) {
    await this.init();
    if (this.mode === 'db') {
      const snap = await this.retry(() => this.db.doc(path).get());
      return snap && snap.exists ? clone(snap.data()) : null;
    }
    try { const v = localStorage.getItem(this.lsKey(path)); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  },
  async list(col) {
    await this.init();
    if (this.mode === 'db') {
      const snap = await this.retry(() => this.db.collection(col).get());
      return snap.docs.filter((d) => d.exists).map((d) => Object.assign(clone(d.data()), { id: d.id }));
    }
    const out = [];
    try {
      const pre = this.lsKey(col + '/');
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') === -1) {
          const v = JSON.parse(localStorage.getItem(k));
          if (v) out.push(Object.assign(v, { id: k.slice(pre.length) }));
        }
      }
    } catch (e) { /* stockage indisponible */ }
    return out;
  },
  set(path, data) { return this.enqueue(path, () => this._write(path, data)); },
  del(path) { return this.enqueue(path, () => this._del(path)); },
  enqueue(path, fn) {
    const prev = this.queues.get(path) || Promise.resolve();
    const p = prev.catch(() => {}).then(fn);
    this.queues.set(path, p);
    return p;
  },
  async _write(path, data) {
    await this.init();
    const body = clone(data); delete body.id;
    if (this.mode === 'db') return this.retry(() => this.db.doc(path).set(body));
    try { localStorage.setItem(this.lsKey(path), JSON.stringify(body)); }
    catch (e) { throw { code: 'quota_exceeded', message: 'Espace de stockage du navigateur saturé.' }; }
  },
  async _del(path) {
    await this.init();
    if (this.mode === 'db') return this.retry(() => this.db.doc(path).delete());
    try { localStorage.removeItem(this.lsKey(path)); } catch (e) { /* rien */ }
  },
  async retry(fn) {
    let wait = 600;
    for (let i = 0; i < 5; i++) {
      try { return await fn(); }
      catch (e) {
        const c = e && e.code;
        if ((c === 'unavailable' || c === 'resource_exhausted') && i < 4) { await sleep(wait + Math.random() * 300); wait *= 2; continue; }
        throw e;
      }
    }
  }
};
function storeError(e, what) {
  const c = e && e.code;
  let m = 'Enregistrement impossible' + (what ? ' (' + what + ')' : '') + '.';
  if (c === 'invalid_argument') m = 'Action refusée : votre accès à cette application ne permet pas de modifier ces données. Demandez au cabinet un accès en écriture.';
  else if (c === 'quota_exceeded') m = 'Capacité de stockage atteinte. Supprimez des données anciennes ou contactez le cabinet.';
  else if (c === 'revoked') m = 'Votre accès a été retiré pendant la session.';
  else if (e && e.message) m += ' ' + e.message;
  toast(m, 'bad');
  console.error(e);
}

/* ---------------- Chemins ---------------- */
const P = {
  config: 'app/config', admin: 'app/admin',
  clients: 'clients', client: (id) => 'clients/' + id,
  tenant: (id) => 'tenants/' + id,
  assets: (id) => 'tenants/' + id + '/assets', asset: (id, aid) => 'tenants/' + id + '/assets/' + aid,
  invs: (id) => 'tenants/' + id + '/inventories', inv: (id, iid) => 'tenants/' + id + '/inventories/' + iid
};

/* ---------------- Configuration & thème ---------------- */
function mergeConfig(c) {
  const d = defaultConfig();
  if (!c) return d;
  const src = upgradeConfig(clone(c));
  if (!src.appName || src.appName === 'CTB Immobilisations') src.appName = 'immo';
  if (!src.reportFooter || src.reportFooter === 'CTB Immobilisations – application propriété de CTB – Cabinet Tahar Bakir') src.reportFooter = 'immo – application propriété de CTB – Cabinet Tahar Bakir';
  const out = Object.assign(d, src);
  out.colors = Object.assign(defaultConfig().colors, src.colors || {});
  out.fiscal = Object.assign(JSON.parse(JSON.stringify(EN.DEFAULT_FISCAL)), src.fiscal || {});
  out.comptes = EN.comptesOf({ fiscal: src.fiscal, comptes: src.comptes });
  out.modules = Object.assign(defaultConfig().modules, src.modules || {});
  return out;
}
function applyTheme() {
  const r = document.documentElement.style;
  const c = S.cfg.colors || {};
  if (c.bg) { r.setProperty('--bg', c.bg); r.setProperty('--bg-2', shade(c.bg, 0.08)); r.setProperty('--bg-3', shade(c.bg, 0.16)); }
  if (c.accent) { r.setProperty('--accent', c.accent); r.setProperty('--accent-2', shade(c.accent, 0.28)); }
  if (c.soft) { r.setProperty('--soft', c.soft); }
  document.title = S.cfg.appName || 'immo';
}
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  const n = parseInt(m[1], 16); let rr = n >> 16, g = (n >> 8) & 255, b = n & 255;
  rr = Math.round(rr + (255 - rr) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
  return '#' + ((1 << 24) + (rr << 16) + (g << 8) + b).toString(16).slice(1);
}
function logoSrc() { return S.cfg.logo || window.CTB_LOGO || ''; }
function brandHtml(logoOnly) {
  return '<div class="brand"><img src="' + esc(logoSrc()) + '" alt="CTB – Cabinet Tahar Bakir">' + (logoOnly ? '' : '<span class="brand-app">' + esc(S.cfg.appName || 'immo') + '</span>') + '</div>';
}
/** Avertissement lorsque l'application tourne dans claude.ai mais sans accès à la base partagée (page ouverte seule dans un onglet). */
function storeWarn() {
  if (Store.mode !== 'local' || !Store.runtime) return '';
  return '<div class="store-warn" role="status"><b>Base partagée indisponible dans cet affichage.</b> Les données saisies ici restent dans ce navigateur : elles ne sont visibles ni par les clients ni sur un autre appareil. Ouvrez immo par son lien claude.ai (vue de l\'application), et non comme page seule dans un nouvel onglet.</div>';
}
function storeBadge() {
  if (Store.mode === 'db') return '<span class="store-badge db" title="Les données sont enregistrées dans la base partagée de l\'application.">Base partagée</span>';
  if (Store.mode === 'local') return '<span class="store-badge" title="Les données sont enregistrées dans ce navigateur uniquement.">Stockage local (ce navigateur)' + (Store.runtime ? ' – base partagée indisponible' : '') + '</span>';
  return '<span class="store-badge">Connexion à la base…</span>';
}

/* ---------------- Session ---------------- */
function saveSession() { try { if (S.session) sessionStorage.setItem('ctbimmo.session', JSON.stringify(S.session)); else sessionStorage.removeItem('ctbimmo.session'); } catch (e) { /* rien */ } }
function readSession() { try { const v = sessionStorage.getItem('ctbimmo.session'); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

async function loadAdminAuth() {
  const a = await Store.get(P.admin);
  S.adminAuth = a && a.hash ? a : clone(ADMIN_DEFAULT);
}
async function loadRegistry() {
  S.registry = (await Store.list(P.clients)).sort((a, b) => String(a.raison).localeCompare(String(b.raison), 'fr'));
}
async function loadTenant(id) {
  const [t, assets, invs] = await Promise.all([Store.get(P.tenant(id)), Store.list(P.assets(id)), Store.list(P.invs(id))]);
  if (!t) throw { message: 'Environnement client introuvable.' };
  S.tenant = upgradeTenant(t); S.tenantId = id;
  S.assets = assets.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  S.inventories = invs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  schedCache.clear();
  S.year = currentExo();
}
async function saveTenant(silent) {
  S.tenant.updatedAt = nowIso();
  S.tenant.stats = computeStats();
  try { await Store.set(P.tenant(S.tenantId), S.tenant); if (!silent) toast('Environnement enregistré.', 'ok'); return true; }
  catch (e) { storeError(e, 'environnement'); return false; }
}
function computeStats() {
  const y = currentExo(); let vb = 0, vnc = 0, nb = 0;
  for (const a of S.assets) {
    const v = EN.yearValues(a, sched(a), y, engineCfg());
    if (v.vbFin > 0) { nb++; vb += v.vbFin; vnc += v.vncFin; }
  }
  return { nb: nb, vb: r3(vb), vnc: r3(vnc), year: y, updatedAt: nowIso() };
}
async function saveAsset(a, silent) {
  a.updatedAt = nowIso();
  try {
    await Store.set(P.asset(S.tenantId, a.id), a);
    const i = S.assets.findIndex((x) => x.id === a.id);
    if (i >= 0) S.assets[i] = a; else S.assets.push(a);
    S.assets.sort((x, y) => String(x.code).localeCompare(String(y.code)));
    if (!silent) toast('Immobilisation enregistrée.', 'ok');
    await saveTenant(true);
    return true;
  } catch (e) { storeError(e, 'immobilisation'); return false; }
}

/* ---------------- Connexion ---------------- */
async function doLogin(login, pwd) {
  if (Date.now() < S.lockUntil) { toast('Trop de tentatives. Réessayez dans quelques secondes.', 'bad'); return; }
  await Store.init();
  const id = String(login || '').trim().toLowerCase();
  if (!id || !pwd) { toast('Saisissez votre identifiant et votre mot de passe.', 'bad'); return; }
  await loadAdminAuth();
  if (id === String(S.adminAuth.email).toLowerCase()) {
    if (EN.hashPassword(pwd, S.adminAuth.salt) === S.adminAuth.hash) {
      S.failures = 0;
      S.session = { role: 'admin', name: 'Administrateur' };
      saveSession();
      await enterAdmin();
      if (S.adminAuth.isDefault) toast('Pensez à remplacer le mot de passe initial dans Sécurité.', '');
      return;
    }
    return failLogin();
  }
  await loadRegistry();
  const c = S.registry.find((x) => String(x.login || '').toLowerCase() === id);
  if (!c) return failLogin();
  if (c.actif === false) { toast('Cet accès est désactivé. Contactez le cabinet CTB.', 'bad'); return; }
  const t = await Store.get(P.tenant(c.id));
  if (!t || !t.auth || EN.hashPassword(pwd, t.auth.salt) !== t.auth.hash) return failLogin();
  S.failures = 0;
  S.session = { role: 'client', clientId: c.id, name: c.raison };
  saveSession();
  await enterTenant(c.id);
}
function failLogin() {
  S.failures++;
  if (S.failures >= 5) { S.lockUntil = Date.now() + 30000; S.failures = 0; }
  toast('Identifiant ou mot de passe incorrect.', 'bad');
}
function logout() {
  S.session = null; S.tenant = null; S.tenantId = null; S.assets = []; S.inventories = []; S.ui = {}; S.view = 'dash';
  saveSession(); closeModal(); render();
}
async function enterAdmin() {
  S.tenant = null; S.tenantId = null;
  await loadRegistry();
  S.view = 'adm-dash'; render();
  loadAllTenants().then(() => { if (S.view === 'adm-dash' || S.view === 'adm-clients') render(); });
}
async function loadAllTenants() {
  const out = {};
  await Promise.all(S.registry.map(async (c) => { out[c.id] = await Store.get(P.tenant(c.id)); }));
  S.tenants = out;
}
async function enterTenant(id) {
  showLoading('Chargement de l\'environnement…');
  try { await loadTenant(id); }
  catch (e) { toast((e && e.message) || 'Chargement impossible.', 'bad'); if (S.session.role === 'admin') { S.view = 'adm-clients'; render(); } else logout(); return; }
  S.view = 'dash'; S.arg = null; render();
}
function showLoading(msg) {
  const root = $('#app');
  root.innerHTML = '<div class="loading"><div class="spin"></div><div>' + esc(msg || 'Chargement…') + '</div></div>';
}

/* ---------------- Icônes ---------------- */
const IC = {
  dash: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  out: '<path d="M10 17l5-5-5-5M15 12H3M21 3v18"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  home: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0zM8 21h8"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>'
};
function icon(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

/* ---------------- Rendu principal ---------------- */
const VIEWS = {};
const TITLES = {};
function go(view, arg) { S.view = view; S.arg = arg === undefined ? null : arg; render(); window.scrollTo({ top: 0 }); }

function render() {
  applyTheme();
  const root = $('#app');
  if (!S.session) {
    root.innerHTML = loginView(); bindLogin(); return;
  }
  const isAdmin = S.session.role === 'admin';
  const inTenant = !!S.tenant;
  const v = VIEWS[S.view];
  if (!v || (!inTenant && TITLES[S.view] && TITLES[S.view].tenant)) { S.view = inTenant ? 'dash' : 'adm-dash'; return render(); }
  let body = '';
  try { body = v(); } catch (e) { console.error(e); body = '<div class="panel"><div class="empty"><b>Cet écran n\'a pas pu s\'afficher.</b><span>' + esc(e.message || e) + '</span></div></div>'; }
  const t = TITLES[S.view] || {};
  const crumb = inTenant ? esc(S.tenant.raison) + ' · code société <b class="mono">' + esc(S.tenant.codeSociete) + '</b> · ' + (referentiel() === 'FISCAL' ? 'amortissements aux taux fiscaux' : 'référentiel NC 05') : 'Administration CTB';
  root.innerHTML = '<div class="shell"><aside class="side">' + brandHtml() + navHtml(isAdmin, inTenant) +
    '<div class="side-foot">' + storeBadge() + '<span>' + esc(S.cfg.appName) + ' · propriété de CTB</span></div></aside>' +
    '<div class="main">' + storeWarn() +
    (isAdmin && inTenant ? '<div class="impersonate"><b>Mode administrateur</b><span>Vous travaillez dans l\'environnement de ' + esc(S.tenant.raison) + '.</span><button class="btn sm" data-act="leave-tenant">' + icon('back') + 'Retour à l\'administration</button></div>' : '') +
    '<header class="top"><div class="top-title"><div class="crumb">' + crumb + '</div><h1>' + esc(t.title || '') + '</h1></div><div class="top-tools">' +
    (inTenant && t.year ? yearSelect() : '') +
    '<button class="chip-user" data-act="account"><span class="av">' + esc((S.session.name || '?').slice(0, 1).toUpperCase()) + '</span>' + esc(isAdmin ? 'Administrateur' : S.session.name) + '</button>' +
    '<button class="btn ghost sm" data-act="logout">' + icon('exit') + 'Déconnexion</button></div></header>' +
    '<section class="content">' + body + '</section></div></div>';
  if (v.after) try { v.after(); } catch (e) { console.error(e); }
}
function yearSelect() {
  const cur = currentExo(); const years = new Set([cur + 1, cur]);
  for (const a of S.assets) { if (a.dateAcq && EN.isValidIso(a.dateAcq)) years.add(EN.exoOf(a.dateAcq, engineCfg())); }
  for (let y = Math.min.apply(null, Array.from(years)); y <= cur; y++) years.add(y);
  const list = Array.from(years).sort((a, b) => b - a).slice(0, 40);
  return '<label class="field" style="min-width:150px"><span style="color:var(--on-dark-2)">Exercice</span><select id="year-sel" data-change="year">' + list.map((y) => '<option value="' + y + '"' + sel(y, S.year) + '>' + esc(EN.exoLabel(y, engineCfg())) + '</option>').join('') + '</select></label>';
}
function navHtml(isAdmin, inTenant) {
  const alias = { asset: 'assets', inventaire: 'inventaires' };
  const b = (v, ic, l) => '<button data-act="nav" data-view="' + v + '" class="' + (S.view === v || alias[S.view] === v ? 'on' : '') + '">' + icon(ic) + l + '</button>';
  let h = '<nav class="nav" aria-label="Navigation">';
  if (inTenant) {
    const m = S.cfg.modules;
    h += '<div class="nav-sep">Patrimoine</div>' + b('dash', 'dash', 'Tableau de bord') + b('assets', 'list', 'Immobilisations') + b('eval', 'scale', 'Évaluation NC 05') + b('sorties', 'out', 'Sorties') +
      (m.inventaire ? b('inventaires', 'scan', 'Inventaires physiques') : '') + '<div class="nav-sep">Restitution</div>' + b('rapports', 'doc', 'Rapports et notes') +
      (m.etiquettes ? b('etiquettes', 'tag', 'Étiquettes') : '') + '<div class="nav-sep">Environnement</div>' + b('env', 'home', 'Paramètres société') + b('codification', 'hash', 'Logique de la codification') + (isAdmin ? '' : b('compte', 'user', 'Mon compte')) + b('manuel', 'book', 'Manuel');
  }
  if (isAdmin && !inTenant) {
    h += '<div class="nav-sep">Administration</div>' + b('adm-dash', 'dash', 'Vue d\'ensemble') + b('adm-clients', 'users', 'Clients') + b('adm-param', 'cog', 'Paramétrage') + b('adm-secu', 'lock', 'Sécurité') + b('adm-backup', 'db', 'Sauvegarde') + '<div class="nav-sep">Aide</div>' + b('codification', 'hash', 'Logique de la codification') + b('manuel', 'book', 'Manuel');
  }
  return h + '</nav>';
}

/* ---------------- Écran de connexion ---------------- */
function loginView() {
  return '<div class="glow" aria-hidden="true"></div><div class="login">' +
    '<div class="login-pitch">' + brandHtml(true) +
    '<div class="eyebrow" style="margin-top:34px">' + esc(S.cfg.tagline) + '</div>' +
    '<h1>' + esc(S.cfg.appName) + '</h1>' +
    '<p>Registre des immobilisations tenu selon la norme comptable NC 05 : coût d\'entrée, composants, amortissement sur la durée d\'utilité, révisions d\'estimations, tests de dépréciation et réévaluations. La fiscalité tunisienne est traitée à part, dans le passage comptable / fiscal.</p>' +
    '</div>' +
    '<form class="login-card" id="login-form" autocomplete="on"><h2>Connexion</h2><p class="sub">' + esc(S.cfg.loginMessage) + '</p>' + storeWarn() +
    '<div class="form"><label class="field"><span>Identifiant (e-mail)</span><input id="lg-login" type="email" autocomplete="username" required autofocus></label>' +
    '<label class="field"><span>Mot de passe</span><input id="lg-pwd" type="password" autocomplete="current-password" required></label>' +
    '<button class="btn" type="submit" id="lg-btn">Se connecter</button>' +
    '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--ink-2)"><span>Mot de passe oublié : contactez le cabinet CTB.</span>' + storeBadge().replace('store-badge', 'store-badge" style="color:var(--ink-2)') + '</div></div></form></div>';
}
function bindLogin() {
  const f = $('#login-form');
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#lg-btn'); btn.disabled = true; btn.textContent = 'Vérification…';
    try { await doLogin($('#lg-login').value, $('#lg-pwd').value); }
    catch (err) { console.error(err); toast('Connexion impossible : ' + ((err && err.message) || 'erreur inconnue'), 'bad'); }
    finally { const b = $('#lg-btn'); if (b) { b.disabled = false; b.textContent = 'Se connecter'; } }
  });
}

/* ---------------- Délégation d'événements ---------------- */
const ACT = {};
const CHANGE = {};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const fn = CHANGE[el.dataset.change];
  if (fn) fn(el, e);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalState && !modalState.opts.sticky) closeModal(); });

ACT['modal-close'] = () => closeModal();
ACT.logout = () => logout();
ACT.nav = (el) => go(el.dataset.view);
ACT['leave-tenant'] = () => enterAdmin();
ACT.account = () => { if (S.session.role === 'admin') { if (S.tenant) enterAdmin().then(() => go('adm-secu')); else go('adm-secu'); } else go('compte'); };
CHANGE.year = (el) => { S.year = Number(el.value); render(); };

/* ---------------- Fichiers (téléchargements) ---------------- */
let dlPromise = null;
async function saveFile(name, blob) {
  try {
    if (!dlPromise) dlPromise = (window.claude && window.claude.use) ? window.claude.use('downloads') : Promise.resolve(null);
    const dl = await dlPromise;
    if (dl) {
      await dl.save({ filename: name, data: blob });
      toast('Fichier enregistré : ' + name, 'ok');
      return;
    }
  } catch (e) {
    if (e && e.code === 'declined') { toast('Téléchargement annulé.'); return; }
    if (e && e.code === 'rate_limited') { toast('Une demande de téléchargement est déjà ouverte.', 'bad'); return; }
    if (e && e.code && ['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].indexOf(e.code) === -1) { toast('Téléchargement impossible (' + e.code + ').', 'bad'); return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
function readFile(file, asText) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; if (asText) r.readAsText(file); else r.readAsArrayBuffer(file); });
}

/* ==========================================================================
   Tableau de bord, registre, fiche immobilisation, événements NC 05, sorties
   ========================================================================== */

/* ---------------- Tableau de bord client ---------------- */
TITLES.dash = { title: 'Tableau de bord', year: true, tenant: true };
VIEWS.dash = function () {
  const y = S.year, cfg = engineCfg();
  let vb = 0, am = 0, pv = 0, vnc = 0, dot = 0, pertes = 0, reint = 0, ded = 0, nb = 0, acq = 0, sorties = 0, totAm = 0, ecart = 0;
  const byCat = {};
  for (const a of S.assets) {
    const v = EN.yearValues(a, sched(a), y, cfg);
    if (!v.exists) continue;
    dot += v.dotation; pertes += v.pertesNettes; reint += v.reint + v.reintAutres; ded += v.dedAnt + v.dedAutres; acq += v.acquisitions + v.entrees; sorties += v.sorties;
    if (v.vbFin > 0) {
      nb++; vb += v.vbFin; am += v.amFinA; pv += v.pvFin; vnc += v.vncFin; ecart += v.ecartFin;
      const k = EN.catAt(a, EN.exo(y, cfg).end); byCat[k] = byCat[k] || { vb: 0, vnc: 0 }; byCat[k].vb += v.vbFin; byCat[k].vnc += v.vncFin;
      const c = catOf(a.categorie);
      if (c && c.amortissable && v.vncFin - num(a.vr) <= 0.001 && sched(a).mode !== 'N') totAm++;
    }
  }
  if (!S.assets.length) {
    return '<div class="panel"><div class="empty"><b>Aucune immobilisation enregistrée pour ' + esc(S.tenant.raison) + '.</b>' +
      '<span>Commencez par vérifier vos emplacements, vos catégories et le référentiel d\'amortissement, puis saisissez vos biens un par un ou importez votre registre existant depuis Excel.</span>' +
      '<div class="actions"><button class="btn" data-act="asset-new">' + icon('plus') + 'Nouvelle immobilisation</button><button class="btn ghost" data-act="nav" data-view="env">Paramètres société</button>' +
      (S.cfg.modules.import ? '<button class="btn ghost" data-act="env-tab" data-tab="import">' + icon('up') + 'Importer un registre Excel</button>' : '') + '<button class="btn ghost" data-act="nav" data-view="manuel">' + icon('book') + 'Manuel</button></div></div></div>';
  }
  const maxVb = Math.max.apply(null, Object.values(byCat).map((x) => x.vb).concat([1]));
  const bars = Object.keys(byCat).sort().map((k) => {
    const x = byCat[k];
    return '<div class="bar-row"><div class="lab" title="' + esc(catLabel(k)) + '">' + esc(catLabel(k)) + '</div><div class="bar-track"><div class="bar-vb" style="width:' + (x.vb / maxVb * 100).toFixed(2) + '%"></div><div class="bar-vnc" style="width:' + (Math.max(0, x.vnc) / maxVb * 100).toFixed(2) + '%"></div></div><div class="num">' + money(x.vb) + '</div></div>';
  }).join('');
  const k = (l, v, s, hero) => '<div class="kpi' + (hero ? ' hero' : '') + '"><span class="l">' + l + '</span><span class="v">' + v + '</span>' + (s ? '<span class="s">' + s + '</span>' : '') + '</div>';
  const nk = 6;
  return '<div class="kpis k' + nk + '" style="--n:' + nk + '">' +
    k('Valeur brute au ' + fdate(EN.exo(y, cfg).end), money(vb), nb + ' bien' + (nb > 1 ? 's' : '') + ' en service · DT', true) +
    k('Amortissements et pertes de valeur', money(am + pv), vb ? EN.fmtPct((am + pv) / vb) + ' de la valeur brute' + (pv > 0 ? ' · dont pertes ' + money(pv) : '') : '') +
    k('Valeur nette comptable', money(vnc), ecart > 0 ? 'dont écart de réévaluation ' + money(ecart) : 'DT') +
    k('Dotation de l\'exercice', money(dot), 'compte 6811' + (Math.abs(pertes) > 0.0005 ? ' · pertes nettes ' + money(pertes) : '')) +
    (S.cfg.modules.fiscal ? k('Réintégrations fiscales', money(reint), ded > 0 ? 'déductions : ' + money(ded) + ' DT' : 'tableau de passage') : k('Écart de réévaluation', money(ecart), 'capitaux propres')) +
    k('Entrées ' + y, money(acq), 'sorties : ' + money(sorties) + ' DT (valeur brute)') +
    '</div><div class="grid-2"><div class="panel"><div class="panel-head"><h3>Répartition par catégorie</h3><div class="legend"><span><i style="background:var(--soft)"></i>Valeur brute</span><span><i style="background:var(--accent)"></i>VNC</span></div></div><div class="bars">' + (bars || '<span class="muted">Aucun bien en service à la clôture.</span>') + '</div></div>' +
    '<div class="panel"><h3>Points d\'attention</h3><div class="alerts">' + dashAlerts(y, totAm, reint) + '</div><div class="actions" style="margin-top:14px"><button class="btn" data-act="asset-new">' + icon('plus') + 'Nouvelle immobilisation</button><button class="btn ghost" data-act="nav" data-view="eval">Évaluation NC 05</button><button class="btn ghost" data-act="nav" data-view="rapports">Rapports ' + y + '</button></div></div></div>' +
    recentPanel();
};
function dashAlerts(y, totAm, reint) {
  const out = [];
  const a = (cls, t) => out.push('<div class="alert ' + cls + '"><span class="dot"></span><div>' + t + '</div></div>');
  const ev = (S.tenant.evaluation || {})[y] || {};
  if (referentiel() === 'FISCAL') a('', 'La société amortit ses biens aux taux fiscaux maximum : une note spécifique figure dans les notes aux états financiers.');
  if (!ev.indices || !ev.indices.date) a('warn', 'Indices de perte de valeur de l\'exercice ' + y + ' non documentés (NC 05 §55 et §57). <button class="link" data-act="eval-tab" data-tab="revue">Faire la revue</button>');
  else if (ev.indices.conclusion === 'indices') a('warn', 'Des indices de perte de valeur ont été relevés : réalisez les tests de dépréciation des biens concernés.');
  if (!ev.revue || !ev.revue.date) a('', 'Revue annuelle des durées d\'utilité, valeurs résiduelles et modes non enregistrée (§51 et §54).');
  const due = reevalDue(y);
  if (due.length) a('warn', 'Réévaluation à actualiser : ' + due.map((d) => esc(d.c.libelle)).join(', ') + ' (§33).');
  const open = S.inventories.filter((i) => i.statut !== 'cloture');
  if (open.length) a('', 'Inventaire en cours : <button class="link" data-act="inv-open" data-id="' + esc(open[0].id) + '">' + esc(open[0].libelle) + '</button>.');
  if (S.cfg.modules.inventaire) {
    const lastInv = S.inventories.filter((i) => i.statut === 'cloture').sort((p, q) => String(q.date).localeCompare(String(p.date)))[0];
    if (!lastInv) a('warn', 'Aucun inventaire physique clôturé. Un inventaire annuel des immobilisations est recommandé avant l\'arrêté des comptes.');
    else if (EN.monthsFrac(EN.dn(lastInv.date), EN.dn(EN.today())) > 12) a('warn', 'Dernier inventaire physique le ' + fdate(lastInv.date) + ' (plus de 12 mois).');
  }
  if (totAm) a('', totAm + ' bien' + (totAm > 1 ? 's' : '') + ' totalement amorti' + (totAm > 1 ? 's' : '') + ' encore en service : à mentionner en note (§107) et à confronter à la durée d\'utilité retenue.');
  if (reint > 0) a('warn', 'Réintégrations fiscales de ' + money(reint) + ' DT sur l\'exercice.');
  const vp = S.assets.filter((x) => !x.sortie && sched(x).regime.raison === 'VP').length;
  if (vp) a('', vp + ' voiture' + (vp > 1 ? 's' : '') + ' de tourisme de plus de ' + S.cfg.fiscal.seuilCV + ' CV : amortissement non déductible.');
  const today = EN.today(), horizon = EN.iso(EN.dn(today) + 90);
  const gar = S.assets.filter((x) => { if (x.sortie) return false; const f = EN.garantieFin(x); return f && f >= today && f <= horizon; });
  if (gar.length) a('', gar.length + ' garantie' + (gar.length > 1 ? 's' : '') + ' fournisseur expire' + (gar.length > 1 ? 'nt' : '') + ' dans les 90 jours : ' + gar.slice(0, 4).map((x) => '<button class="link" data-act="asset-open" data-id="' + esc(x.id) + '">' + esc(codeTxt(x.code)) + '</button> (' + fdate(EN.garantieFin(x)) + ')').join(', ') + (gar.length > 4 ? '…' : '') + '.');
  const sansPiece = yearMovements(y).filter((m) => m.compta && !m.piece).length;
  if (sansPiece) a('warn', sansPiece + ' mouvement' + (sansPiece > 1 ? 's' : '') + ' de l\'exercice sans référence de pièce comptable. <button class="link" data-act="rep-open" data-rep="mouvements">Voir l\'état des mouvements</button>');
  const noEmp = S.assets.filter((x) => !x.sortie && !empOf(x.emplacement)).length;
  if (noEmp) a('bad', noEmp + ' bien' + (noEmp > 1 ? 's' : '') + ' rattaché' + (noEmp > 1 ? 's' : '') + ' à un emplacement supprimé.');
  if (!out.length) a('ok', 'Aucune anomalie détectée sur l\'exercice.');
  return out.join('');
}
/** Catégories au modèle de la réévaluation dont la dernière réévaluation dépasse la fréquence prévue. */
function reevalDue(y) {
  const E = EN.exo(y, engineCfg());
  return cats().filter((c) => c.modele === 'reevaluation' && c.type !== 'I').map((c) => {
    const list = S.assets.filter((a) => a.categorie === c.code && !(a.sortie && a.sortie.date <= E.end) && a.dateAcq <= E.end);
    if (!list.length) return null;
    let last = null;
    list.forEach((a) => (a.events || []).forEach((ev) => { if (ev.type === 'reevaluation' && ev.date <= E.end && (!last || ev.date > last)) last = ev.date; }));
    const yearsSince = last ? (EN.dn(E.end) - EN.dn(last)) / 365.25 : Infinity;
    return { c: c, last: last, n: list.length, due: yearsSince > num(c.frequenceReeval || 5) + 0.01 };
  }).filter((x) => x && x.due);
}
function recentPanel() {
  const rec = S.assets.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 6);
  return '<div class="panel"><div class="panel-head"><h3>Dernières mises à jour</h3><button class="btn ghost sm" data-act="nav" data-view="assets">Voir le registre</button></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Désignation</th><th>Catégorie</th><th class="num">Valeur brute</th><th>Statut</th></tr></thead><tbody>' +
    rec.map((a) => '<tr class="click" data-act="asset-open" data-id="' + esc(a.id) + '"><td class="code">' + esc(codeTxt(a.code)) + '</td><td>' + esc(a.designation) + '</td><td>' + esc(catLabel(a.categorie)) + '</td><td class="num">' + money(a.valeur) + '</td><td>' + statusPill(a) + '</td></tr>').join('') + '</tbody></table></div></div>';
}
function statusPill(a) {
  if (a.sortie) return '<span class="pill grey">Sorti le ' + fdate(a.sortie.date) + '</span>';
  const c = catOf(a.categorie);
  if (c && c.enCours) return '<span class="pill">En cours</span>';
  const s = sched(a);
  if (s.mode === 'N') return '<span class="pill">Non amortissable</span>';
  const v = EN.yearValues(a, s, S.year, engineCfg());
  if (!v.exists) return '<span class="pill">Acquis ultérieurement</span>';
  if (v.vncFin - num(a.vr) <= 0.001) return '<span class="pill warn">Totalement amorti</span>';
  if (v.pvFin > 0) return '<span class="pill warn">Déprécié</span>';
  return '<span class="pill ok">En service</span>';
}

/* ---------------- Registre ---------------- */
TITLES.assets = { title: 'Immobilisations', year: true, tenant: true };
VIEWS.assets = function () {
  const f = S.ui.af || (S.ui.af = { q: '', cat: '', emp: '', st: 'actifs' });
  const y = S.year, cfg = engineCfg();
  const q = f.q.trim().toLowerCase(), qc = EN.normCode(f.q);
  const list = S.assets.filter((a) => {
    if (f.cat && a.categorie !== f.cat) return false;
    if (f.emp && a.emplacement !== f.emp) return false;
    if (f.st === 'actifs' && a.sortie) return false;
    if (f.st === 'sortis' && !a.sortie) return false;
    if (q && !(String(a.designation || '').toLowerCase().includes(q) || (qc && String(a.code).includes(qc)) || searchText(a).includes(q))) return false;
    return true;
  });
  let tVb = 0, tAm = 0, tVnc = 0, tDot = 0;
  const rows = list.map((a) => {
    const s = sched(a), v = EN.yearValues(a, s, y, cfg);
    const vbv = v.exists ? (v.vbFin || v.sorties) : num(a.valeur);
    const amv = v.exists ? (v.vbFin ? v.amFin : v.amSorties) : 0;
    const vncv = r3(vbv - amv);
    tVb += vbv; tAm += amv; tVnc += vncv; tDot += v.dotation;
    const parent = a.parentId ? assetById(a.parentId) : null;
    return '<tr class="click" data-act="asset-open" data-id="' + esc(a.id) + '"><td class="code">' + esc(codeTxt(a.code)) + '</td><td>' + esc(a.designation) + (parent ? '<div class="muted" style="font-size:11.5px">Composant de ' + esc(codeTxt(parent.code)) + '</div>' : (identLine(a) ? '<div class="muted" style="font-size:11.5px">' + esc(identLine(a)) + '</div>' : '')) + '</td><td>' + esc(catLabel(a.categorie)) + '</td><td>' + esc(empLabel(a.emplacement)) + '</td><td>' + fdate(a.dateMES || a.dateAcq) + '</td><td class="num">' + money(vbv) + '</td><td>' + esc(EN.MODES[s.mode] || '') + (s.dureeAns && s.mode !== 'N' && s.mode !== 'UO' && s.mode !== 'I' ? ' · ' + esc(yrs(s.dureeEffective || s.dureeAns)) : '') + '</td><td class="num">' + money(v.dotation) + '</td><td class="num">' + money(amv) + '</td><td class="num">' + money(vncv) + '</td><td>' + statusPill(a) + '</td></tr>';
  }).join('');
  return '<div class="page-head"><div><h2>Registre des immobilisations</h2><p>' + S.assets.length + ' biens enregistrés · valeurs à la clôture de l\'exercice ' + esc(EN.exoLabel(y, cfg)) + ' (ou à la date de sortie).</p></div><div class="actions">' +
    (S.cfg.modules.import ? '<button class="btn ghost" data-act="env-tab" data-tab="import">' + icon('up') + 'Importer</button>' : '') +
    '<button class="btn ghost" data-act="assets-xlsx">' + icon('dl') + 'Excel</button><button class="btn" data-act="asset-new">' + icon('plus') + 'Nouvelle immobilisation</button></div></div>' +
    '<div class="panel"><div class="toolbar" style="margin-bottom:14px"><label class="field wide"><span>Recherche</span><input id="af-q" value="' + esc(f.q) + '" placeholder="Code, désignation, n° de série, immatriculation, contrat, pièce…"></label>' +
    '<label class="field"><span>Catégorie</span><select data-change="af-cat"><option value="">Toutes</option>' + cats().map((c) => '<option value="' + esc(c.code) + '"' + sel(c.code, f.cat) + '>' + esc(c.code + ' – ' + c.libelle) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Emplacement</span><select data-change="af-emp"><option value="">Tous</option>' + emps().map((e) => '<option value="' + esc(e.code) + '"' + sel(e.code, f.emp) + '>' + esc(e.code + ' – ' + e.libelle) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Statut</span><select data-change="af-st">' + opt([{ v: 'actifs', l: 'En service' }, { v: 'sortis', l: 'Sortis' }, { v: 'tous', l: 'Tous' }], f.st) + '</select></label></div>' +
    (list.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Désignation</th><th>Catégorie</th><th>Emplacement</th><th>Mise en service</th><th class="num">Valeur brute</th><th>Mode · durée</th><th class="num">Dotation ' + y + '</th><th class="num">Amort. et pertes</th><th class="num">VNC</th><th>Statut</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td colspan="5">Total (' + list.length + ')</td><td class="num">' + money(tVb) + '</td><td></td><td class="num">' + money(tDot) + '</td><td class="num">' + money(tAm) + '</td><td class="num">' + money(tVnc) + '</td><td></td></tr></tfoot></table></div>'
      : '<div class="empty"><b>Aucune immobilisation ne correspond à ces critères.</b><button class="btn" data-act="asset-new">' + icon('plus') + 'Nouvelle immobilisation</button></div>') + '</div>';
};
VIEWS.assets.after = function () {
  const i = $('#af-q');
  if (i) {
    let t;
    i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.ui.af.q = i.value; const pos = i.selectionStart; render(); const j = $('#af-q'); if (j) { j.focus(); j.setSelectionRange(pos, pos); } }, 250); });
  }
};
CHANGE['af-cat'] = (el) => { S.ui.af.cat = el.value; render(); };
CHANGE['af-emp'] = (el) => { S.ui.af.emp = el.value; render(); };
CHANGE['af-st'] = (el) => { S.ui.af.st = el.value; render(); };
ACT['asset-open'] = (el) => go('asset', el.dataset.id);
ACT['assets-xlsx'] = () => exportReport('registre', 'xlsx');

/* ---------------- Formulaire immobilisation (NC 05 §19 à §27) ---------------- */
const COST_PARTS = [
  ['prixAchat', 'Prix d\'achat HT', 1], ['remises', 'Remises et rabais commerciaux (à déduire)', -1], ['droits', 'Droits et taxes non récupérables', 1],
  ['transport', 'Livraison, transport et manutention', 1], ['installation', 'Installation, montage et essais', 1], ['honoraires', 'Honoraires, commissions, architectes et ingénieurs', 1],
  ['preparation', 'Préparation du site, démolition', 1], ['autres', 'Autres frais directement attribuables', 1]
];
const ENTREE_HINT = {
  achat: 'Coût = prix d\'achat net des remises + droits et taxes non récupérables + frais directement attribuables à la mise en état d\'utilisation (§20). Les frais généraux, frais de démarrage et pertes initiales restent en charges (§22).',
  production: 'Coût de production : mêmes principes que pour une acquisition ; les profits internes et les coûts anormaux (gaspillage, main-d\'œuvre) sont exclus (§23). Charges d\'emprunt : NC 13.',
  echange: 'Échange d\'actifs de nature différente : juste valeur de l\'actif reçu, ajustée de la soulte. Actifs similaires : valeur comptable de l\'actif cédé, sans résultat (§25). Constatez aussi la sortie de l\'actif cédé (nature « Échange »).',
  apport: 'Apport en nature : valeur d\'apport retenue dans le traité d\'apport, augmentée des frais directement attribuables.',
  leasing: 'Location-financement : traitement selon la NC 41 (montant le plus faible entre la juste valeur et la valeur actualisée des paiements minimaux).',
  autre: 'Indiquez dans les observations la base retenue pour le coût d\'entrée.'
};
ACT['asset-new'] = () => assetForm(null);
ACT['asset-edit'] = (el) => assetForm(assetById(el.dataset.id));

/* ---------------- Identification, contrats enregistrés, garantie, pièces comptables ---------------- */
const CONTRAT_TYPES = ['Acte d\'acquisition de terrain', 'Acte d\'acquisition d\'immeuble ou de local', 'Contrat de travaux (entreprise de construction)', 'Contrat de leasing', 'Contrat de location (bail)', 'Autre contrat enregistré'];
function contratRow(c) {
  c = c || {};
  const types = CONTRAT_TYPES.indexOf(c.type) >= 0 || !c.type ? CONTRAT_TYPES : CONTRAT_TYPES.concat([c.type]);
  return '<div class="ctr-row"><label class="field"><span>Nature du contrat</span><select class="ctr-type">' + opt(types, c.type || CONTRAT_TYPES[5]) + '</select></label>' +
    '<label class="field"><span>N° d\'enregistrement</span><input class="ctr-num" value="' + esc(c.numero || '') + '" placeholder="N° de quittance / d\'enregistrement"></label>' +
    '<label class="field"><span>Date d\'enregistrement</span><input class="ctr-date" type="date" value="' + esc(c.date || '') + '"></label>' +
    '<label class="field"><span>Recette des finances</span><input class="ctr-rec" value="' + esc(c.recette || '') + '" placeholder="Ex. Tunis – Ennasr"></label>' +
    '<label class="field"><span>Cocontractant</span><input class="ctr-tiers" value="' + esc(c.cocontractant || '') + '" placeholder="Vendeur, entreprise, société de leasing…"></label>' +
    '<button type="button" class="btn ghost sm ctr-del" aria-label="Retirer ce contrat">' + icon('trash') + '</button></div>';
}
/** Le n° de série a-t-il un sens pour cette catégorie (matériel, informatique, équipements) ? */
function serieRelevant(cat) { const c = cat || {}; return !c.roulant && c.type !== 'I' && !c.enCours && !/^22[12]/.test(String(c.cptImmo || '')); }
function pieceField(id, v, hint) {
  return '<label class="field"><span>Réf. pièce comptable</span><input id="' + id + '" value="' + esc(v || '') + '" placeholder="Ex. OD-' + S.year + '-0042"><small>' + esc(hint || 'N° de la pièce ou de l\'écriture comptable') + '</small></label>';
}
function pieceOf(m, id) { const x = m.querySelector('#' + id); return x ? x.value.trim() : ''; }
function identLine(a) {
  const c = catOf(a.categorie) || {};
  const p = [];
  if (a.immatriculation) p.push('Immat. ' + a.immatriculation);
  if (a.chassis && (c.roulant || !a.numSerie)) p.push('Châssis ' + a.chassis);
  if (a.numSerie && !(c.roulant && (a.immatriculation || a.chassis))) p.push('N° série ' + a.numSerie);
  return p.join(' · ');
}
function searchText(a) {
  return [a.numSerie, a.immatriculation, a.chassis, a.fournisseur, a.facture, a.pieceCompta, a.marque, a.sortie && a.sortie.pieceCompta, a.sortie && a.sortie.piece]
    .concat((a.contrats || []).map((c) => c.numero + ' ' + (c.cocontractant || '')))
    .concat((a.events || []).map((e) => e.pieceCompta || '')).filter(Boolean).join(' ').toLowerCase();
}
/**
 * Mouvements d'un bien avec leur référence de pièce comptable.
 * compta = mouvement qui donne lieu à une écriture (la pièce est attendue).
 */
function assetMovements(a) {
  const s = sched(a), out = [];
  const evr = (id) => s.events.find((e) => e.id === id) || {};
  out.push({ a: a, date: a.dateAcq, kind: 'entree', label: 'Entrée – ' + (EN.ENTREES[a.entree || 'achat'] || 'achat'), montant: num(a.valeur), piece: a.pieceCompta || '', justif: [a.facture ? 'Facture ' + a.facture : ''].concat((a.contrats || []).map((c) => (c.type || 'Contrat') + ' ' + (c.numero || ''))).filter(Boolean).join(' ; '), compta: true });
  (a.events || []).forEach((ev) => {
    if (a.sortie && ev.date > a.sortie.date) return;
    const r = evr(ev.id);
    let label = EN.EVENT_TYPES[ev.type] || ev.type, montant = '';
    const compta = evNeedsPiece(ev, r);
    if (ev.type === 'complement') montant = num(ev.montant);
    else if (ev.type === 'reevaluation') montant = r3(r.ecart || 0);
    else if (ev.type === 'test') montant = r.resultat === 'perte' ? -r.perte : r.resultat === 'reprise' ? r.reprise : 0;
    else if (ev.type === 'demantelement') montant = r3(r.delta || 0);
    else if (ev.type === 'transfert') label = ev.motif === 'Mise en service' ? 'Mise en service' : 'Reclassement de catégorie';
    out.push({ a: a, date: ev.date, kind: ev.type, ev: ev, label: label, montant: montant, piece: ev.pieceCompta || '', justif: ev.type === 'transfert' ? catLabel(ev.de) + ' → ' + catLabel(ev.vers) : (ev.libelle || ev.motif || ''), compta: compta });
  });
  (a.history || []).forEach((h) => { if (/^Transfert/.test(h.action || '')) out.push({ a: a, date: h.date, kind: 'emplacement', label: 'Transfert d\'emplacement', montant: '', piece: h.piece || '', justif: h.detail || '', compta: false }); });
  if (a.sortie) out.push({ a: a, date: a.sortie.date, kind: 'sortie', label: 'Sortie – ' + (a.sortie.type || ''), montant: -EN.sortieCalc(a, catOf(a.categorie) || {}, engineCfg()).gross, piece: a.sortie.pieceCompta || '', justif: a.sortie.piece || '', compta: true });
  return out;
}
/** Un événement donne-t-il lieu à une écriture (et donc à une pièce attendue) ? */
function evNeedsPiece(ev, r) {
  if (ev.type === 'revision') return false;
  if (ev.type === 'test') return r.resultat === 'perte' || r.resultat === 'reprise';
  if (ev.type === 'demantelement') return Math.abs(num(r.delta)) > 0.0005;
  return true;
}
function yearMovements(y, filter) {
  const E = EN.exo(y, engineCfg());
  const list = [];
  S.assets.filter(filter || (() => true)).forEach((a) => assetMovements(a).forEach((m) => { if (m.date >= E.start && m.date <= E.end) list.push(m); }));
  return list.sort((p, q) => String(p.date).localeCompare(String(q.date)) || String(p.a.code).localeCompare(String(q.a.code)));
}
ACT['ev-piece'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  const kind = el.dataset.kind, ev = kind === 'ev' ? (a.events || []).find((x) => x.id === el.dataset.ev) : null;
  const cur = kind === 'sortie' ? (a.sortie || {}).pieceCompta : kind === 'entree' ? a.pieceCompta : ev && ev.pieceCompta;
  const what = kind === 'sortie' ? 'la sortie du ' + fdate(a.sortie.date) : kind === 'entree' ? 'l\'entrée du ' + fdate(a.dateAcq) : '« ' + (EN.EVENT_TYPES[ev.type] || '') + ' » du ' + fdate(ev.date);
  openModal({
    title: 'Pièce comptable – ' + codeTxt(a.code), size: 'narrow',
    body: '<div class="form"><p style="margin:0">Référence de l\'écriture comptable de ' + esc(what) + '.</p>' + pieceField('pc-ref', cur) + '</div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="pc-ok">Enregistrer</button>',
    mount: (m) => m.querySelector('#pc-ok').addEventListener('click', async () => {
      const v = pieceOf(m, 'pc-ref'), b = clone(a);
      if (kind === 'sortie') b.sortie.pieceCompta = v;
      else if (kind === 'entree') b.pieceCompta = v;
      else { const e = b.events.find((x) => x.id === ev.id); if (e) e.pieceCompta = v; }
      b.history = (b.history || []).concat([{ date: EN.today(), at: nowIso(), action: 'Référence de pièce comptable', detail: what, piece: v }]);
      if (await saveAsset(b, true)) { toast('Référence enregistrée.', 'ok'); closeModal(); render(); }
    })
  });
};
function pieceTag(a, kind, ev, v, optional) {
  return '<span class="piece-tag' + (v ? '' : optional ? ' optional' : ' missing') + '"><span class="pv">' + (v ? 'Pièce ' + esc(v) : optional ? 'Pièce comptable facultative' : 'Pièce comptable à renseigner') + '</span> <button class="link" data-act="ev-piece" data-id="' + esc(a.id) + '" data-kind="' + kind + '"' + (ev ? ' data-ev="' + esc(ev.id) + '"' : '') + '>' + (v ? 'modifier' : 'saisir') + '</button></span>';
}

function assetForm(a, preset) {
  if (!emps().length) { toast('Créez d\'abord au moins un emplacement dans Paramètres société.', 'bad'); S.ui.envTab = 'emp'; go('env'); return; }
  const isNew = !a;
  const firstCat = (cats().find((c) => !c.enCours) || cats()[0] || {}).code;
  const d = a ? clone(a) : Object.assign({ id: uid(), designation: '', categorie: firstCat, emplacement: emps()[0].code, entree: 'achat', dateAcq: EN.today(), dateMES: '', valeur: '', vr: 0, mode: '', duree: '', fiscal: { regime: 'auto', taux: '' }, quantite: 1, etat: (S.cfg.etats || [])[0] || 'Bon', custom: {}, history: [], events: [] }, preset || {});
  if (!isNew && !EN.has(d.duree) && EN.has(d.taux) && num(d.taux) > 0) d.duree = EN.normYears(100 / num(d.taux));
  const etats = S.cfg.etats || EN.DEFAULT_ETATS;
  const cf = S.cfg.customFields || [];
  const cd = d.coutDetail || null;
  const parents = S.assets.filter((x) => x.id !== d.id && !x.parentId && !x.sortie);
  const fisc = S.cfg.modules.fiscal;
  const body = '<form class="form" id="af"><fieldset class="fs"><legend>Identification</legend>' +
    '<div class="row"><label class="field" style="grid-column:1/-1"><span>Désignation <em>*</em></span><input id="f-des" required value="' + esc(d.designation) + '" placeholder="Ex. Ordinateur portable Dell Latitude 5440"></label></div>' +
    '<div class="row"><label class="field"><span>Catégorie <em>*</em></span><select id="f-cat">' + cats().map((c) => '<option value="' + esc(c.code) + '"' + sel(c.code, d.categorie) + '>' + esc(c.code + ' – ' + c.libelle) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Emplacement <em>*</em></span><select id="f-emp">' + emps().map((e) => '<option value="' + esc(e.code) + '"' + sel(e.code, d.emplacement) + '>' + esc(e.code + ' – ' + e.libelle) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>État</span><select id="f-etat">' + opt(etats, d.etat) + '</select></label><label class="field"><span>Quantité</span><input id="f-qte" type="number" min="1" step="1" value="' + esc(d.quantite || 1) + '"></label></div>' +
    (isNew ? '' : '<div class="row hidden" id="f-reclass-box"><label class="field"><span>Date du reclassement</span><input id="f-reclass" type="date" value="' + esc(EN.today()) + '"><small>La catégorie change : le reclassement apparaît en « virements » dans le tableau des immobilisations.</small></label>' + pieceField('f-reclass-piece', '', 'Écriture de virement de compte à compte') + '</div>') +
    '<div class="row"><label class="field"><span>Marque / modèle</span><input id="f-marque" value="' + esc(d.marque || '') + '"></label>' +
    '<label class="field f-nonroulant"><span>N° de série</span><input id="f-serie" value="' + esc(d.numSerie || '') + '" placeholder="Matériel, informatique, équipement…"></label>' +
    '<label class="field f-roulant"><span>Immatriculation (N° matricule)</span><input id="f-immat" value="' + esc(d.immatriculation || '') + '" placeholder="Ex. 215 TU 4587"></label>' +
    '<label class="field f-roulant"><span>N° de châssis (VIN)</span><input id="f-chassis" value="' + esc(d.chassis || '') + '" placeholder="17 caractères"></label>' +
    '<label class="field"><span>Composant de (NC 05 §12)</span><select id="f-parent"><option value="">— Bien principal —</option>' + parents.map((p) => '<option value="' + esc(p.id) + '"' + sel(p.id, d.parentId) + '>' + esc(codeTxt(p.code) + ' – ' + p.designation) + '</option>').join('') + '</select><small>Un composant à durée d\'utilité différente est amorti séparément.</small></label></div>' +
    '<div class="note" id="f-code-box"></div></fieldset>' +
    '<fieldset class="fs"><legend>Coût d\'entrée (NC 05 §19 à §27)</legend><div class="row">' +
    '<label class="field"><span>Mode d\'entrée</span><select id="f-entree">' + opt(Object.keys(EN.ENTREES).map((k) => ({ v: k, l: EN.ENTREES[k] })), d.entree || 'achat') + '</select></label>' +
    '<label class="field"><span>Date d\'acquisition <em>*</em></span><input id="f-dacq" type="date" required value="' + esc(d.dateAcq) + '"></label>' +
    '<label class="field"><span>Date de mise en service</span><input id="f-dmes" type="date" value="' + esc(d.dateMES || '') + '"><small>Début de l\'amortissement ; vide = date d\'acquisition</small></label></div>' +
    '<div class="note" id="f-entree-hint"></div>' +
    '<label class="check"><input type="checkbox" id="f-detail"' + chk(cd) + '> Détailler les composantes du coût (§20)</label>' +
    '<div id="f-detail-box" class="subgrid">' + COST_PARTS.map((p) => '<label class="field"><span>' + esc(p[1]) + '</span><input class="f-cd" data-k="' + p[0] + '" inputmode="decimal" value="' + esc(cd && EN.has(cd[p[0]]) ? cd[p[0]] : '') + '"></label>').join('') + '</div>' +
    '<div class="row"><label class="field"><span>Coût d\'entrée HT (DT) <em>*</em></span><input id="f-val" inputmode="decimal" value="' + esc(d.valeur) + '" placeholder="0,000"><small id="f-val-help">Y compris l\'estimation actualisée du démantèlement</small></label>' +
    '<label class="field"><span>dont démantèlement et remise en état (valeur actualisée)</span><input id="f-dem" inputmode="decimal" value="' + esc(d.demantelement ? d.demantelement.montant : '') + '"><small>§20 c ; provision au compte ' + esc(S.cfg.comptes.provDemantelement) + '</small></label>' +
    '<label class="field f-dem2"><span>Taux d\'actualisation (%)</span><input id="f-demt" inputmode="decimal" value="' + esc(d.demantelement ? d.demantelement.taux : '') + '"></label>' +
    '<label class="field f-dem2"><span>Échéance du démantèlement</span><input id="f-deme" type="date" value="' + esc(d.demantelement ? d.demantelement.echeance : '') + '"></label></div>' +
    '<div class="row"><label class="field"><span>Fournisseur</span><input id="f-four" value="' + esc(d.fournisseur || '') + '"></label><label class="field"><span>N° de facture</span><input id="f-fact" value="' + esc(d.facture || '') + '"></label>' +
    pieceField('f-piece', d.pieceCompta, 'Écriture d\'entrée : journal des achats, OD d\'apport…') +
    '<label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="f-esp"' + chk(d.especes) + '> Réglé en espèces</label></div></fieldset>' +
    '<fieldset class="fs"><legend>Contrats et actes enregistrés</legend><p class="muted" style="margin:0 0 10px;font-size:12.5px">Acte d\'acquisition d\'un terrain ou d\'un immeuble, contrat avec une entreprise de travaux, contrat de leasing ou tout autre contrat enregistré à la recette des finances.</p>' +
    '<div id="f-ctr-list" class="ctr-list">' + (d.contrats || []).map(contratRow).join('') + '</div><button type="button" class="btn ghost sm" id="f-ctr-add">' + icon('plus') + 'Ajouter un contrat</button></fieldset>' +
    '<fieldset class="fs"><legend>Garantie</legend><div class="row">' +
    '<label class="field"><span>Durée de la garantie</span><input id="f-gd" inputmode="decimal" value="' + esc(d.garantie && EN.has(d.garantie.duree) ? String(d.garantie.duree).replace('.', ',') : '') + '" placeholder="Aucune"></label>' +
    '<label class="field"><span>Unité</span><select id="f-gu">' + opt([{ v: 'mois', l: 'Mois' }, { v: 'ans', l: 'Années' }], (d.garantie && d.garantie.unite) || 'mois') + '</select></label>' +
    '<label class="field"><span>Point de départ</span><input id="f-gdeb" type="date" value="' + esc((d.garantie && d.garantie.debut) || '') + '"><small>Vide = date de mise en service</small></label>' +
    '<label class="field"><span>Garant et conditions</span><input id="f-gcond" value="' + esc((d.garantie && d.garantie.conditions) || '') + '" placeholder="Fournisseur, constructeur, pièces et main-d\'œuvre…"></label></div><div class="note" id="f-gfin"></div></fieldset>' +
    '<fieldset class="fs"><legend>Amortissement comptable (NC 05 §42 à §50)</legend><div class="row">' +
    '<label class="field"><span>Mode</span><select id="f-mode"></select><small>Le mode reflète le rythme de consommation des avantages économiques (§49).</small></label>' +
    '<label class="field"><span>Durée d\'utilité (années)</span><input id="f-duree" inputmode="decimal" value="' + esc(EN.has(d.duree) ? String(d.duree).replace('.', ',') : '') + '"><small id="f-duree-help"></small></label>' +
    '<label class="field"><span>Valeur résiduelle (DT)</span><input id="f-vr" inputmode="decimal" value="' + esc(d.vr || 0) + '"><small>Montant net de sortie estimé en fin d\'utilisation (§48)</small></label>' +
    '<label class="field" id="f-eq-box"><span>Utilisation en équipes</span><select id="f-eq">' + opt([{ v: '', l: 'Une équipe' }, { v: '2', l: 'Deux équipes (coef. ' + String(S.cfg.fiscal.coefDeux).replace('.', ',') + ')' }, { v: '3', l: 'Trois équipes (coef. ' + String(S.cfg.fiscal.coefTrois).replace('.', ',') + ')' }], d.equipes || '') + '</select><small>Décret n° 2008-492, art. 2</small></label></div>' +
    '<div id="f-uo-box" class="row"><label class="field"><span>Total d\'unités d\'œuvre prévues</span><input id="f-uot" inputmode="decimal" value="' + esc(d.uoTotal || '') + '"><small>Heures machine, kilomètres, unités produites…</small></label>' +
    '<label class="field" style="grid-column:span 2"><span>Unités par exercice (une ligne AAAA=quantité)</span><textarea id="f-uoy" rows="3" placeholder="2026=1200&#10;2027=1500">' + esc(Object.keys(d.uoParAnnee || {}).map((k) => k + '=' + d.uoParAnnee[k]).join('\n')) + '</textarea></label></div></fieldset>' +
    (fisc ? '<fieldset class="fs"><legend>Traitement fiscal (note distincte)</legend><div class="row">' +
      '<label class="field"><span>Plafond fiscal</span><select id="f-reg">' + opt([{ v: 'auto', l: 'Automatique (recommandé)' }].concat(Object.keys(EN.REGIMES).filter((k) => k !== 'D' || S.cfg.fiscal.degressifAutorise).map((k) => ({ v: k, l: EN.REGIMES[k] }))), (d.fiscal && d.fiscal.regime) || 'auto') + '</select></label>' +
      '<label class="field"><span>Taux maximum (%)</span><input id="f-tf" inputmode="decimal" value="' + esc(d.fiscal && EN.has(d.fiscal.taux) ? d.fiscal.taux : '') + '"><small id="f-tf-help"></small></label></div>' +
      '<div class="row" id="f-vp-box"><label class="check"><input type="checkbox" id="f-vpt"' + chk(!d.vehicule || d.vehicule.tourisme !== false) + '> Voiture de tourisme</label><label class="field"><span>Puissance fiscale (CV)</span><input id="f-cv" type="number" min="0" value="' + esc((d.vehicule && d.vehicule.cv) || '') + '"></label><label class="check"><input type="checkbox" id="f-vpo"' + chk(d.vehicule && d.vehicule.objetPrincipal) + '> Objet principal de l\'exploitation (location…)</label></div>' +
      '<div class="note" id="f-fisc-box"></div></fieldset>' : '') +
    '<fieldset class="fs"><legend>Informations à fournir (§101, NC 12)</legend><div class="row">' +
    '<label class="field"><span>Subvention d\'investissement obtenue (DT)</span><input id="f-sub" inputmode="decimal" value="' + esc(d.subvention ? d.subvention.montant : '') + '"><small>Non déduite du coût (§27) ; virée au résultat au rythme des amortissements</small></label>' +
    '<label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="f-nanti"' + chk(d.nanti) + '> Donné en nantissement ou garantie</label>' +
    '<label class="field"><span>Détail de la garantie</span><input id="f-nantid" value="' + esc(d.nantiDetail || '') + '"></label></div></fieldset>' +
    '<fieldset class="fs"><legend>Reprise d\'un registre antérieur</legend><label class="check"><input type="checkbox" id="f-rep"' + chk(d.reprise) + '> Ce bien est repris avec un historique d\'amortissement</label>' +
    '<div class="row" id="f-rep-box"><label class="field"><span>Date de reprise (ouverture d\'exercice)</span><input id="f-repd" type="date" value="' + esc((d.reprise && d.reprise.date) || EN.exo(currentExo(), engineCfg()).start) + '"></label><label class="field"><span>Amortissements cumulés à cette date</span><input id="f-repc" inputmode="decimal" value="' + esc((d.reprise && d.reprise.cumul) || '') + '"></label>' +
    '<label class="field"><span>Pertes de valeur cumulées</span><input id="f-repp" inputmode="decimal" value="' + esc((d.reprise && d.reprise.pertes) || '') + '"></label><label class="field"><span>Écart de réévaluation restant</span><input id="f-repe" inputmode="decimal" value="' + esc((d.reprise && d.reprise.ecart) || '') + '"></label>' +
    '<label class="field"><span>Durée résiduelle (années)</span><input id="f-repr" inputmode="decimal" value="' + esc((d.reprise && d.reprise.dureeRestante) || '') + '"><small>Vide = poursuite du plan d\'origine</small></label><label class="field"><span>Amortissements déduits fiscalement</span><input id="f-repf" inputmode="decimal" value="' + esc((d.reprise && EN.has(d.reprise.cumulFiscal)) ? d.reprise.cumulFiscal : '') + '"><small>Vide = égal au cumul comptable</small></label></div></fieldset>' +
    (cf.length ? '<fieldset class="fs"><legend>Informations complémentaires</legend><div class="row">' + cf.map((c) => customInput(c, (d.custom || {})[c.key])).join('') + '</div></fieldset>' : '') +
    '<label class="field"><span>Observations</span><textarea id="f-obs" rows="2">' + esc(d.observations || '') + '</textarea></label>' +
    '<div class="note" id="f-preview"></div></form>';
  openModal({
    title: isNew ? (d.parentId ? 'Nouveau composant' : 'Nouvelle immobilisation') : 'Modifier ' + codeTxt(d.code), size: 'wide', sticky: true, body: body,
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="f-save">' + (isNew ? 'Créer l\'immobilisation' : 'Enregistrer') + '</button>',
    mount: (el) => {
      const upd = () => assetFormPreview(el, d, isNew);
      el.querySelectorAll('input,select,textarea').forEach((i) => i.addEventListener('input', upd));
      el.querySelectorAll('select,input[type=checkbox]').forEach((i) => i.addEventListener('change', upd));
      el.querySelector('#f-cat').addEventListener('change', () => { el.querySelector('#f-duree').value = ''; if (el.querySelector('#f-tf')) el.querySelector('#f-tf').value = ''; fillModes(el, d, true); upd(); });
      fillModes(el, d, false);
      const list = el.querySelector('#f-ctr-list');
      el.querySelector('#f-ctr-add').addEventListener('click', () => {
        const c = catOf(el.querySelector('#f-cat').value) || {}, ent = el.querySelector('#f-entree').value;
        const ci = String(c.cptImmo || '');
        const t = ent === 'leasing' ? CONTRAT_TYPES[3] : /^221/.test(ci) ? CONTRAT_TYPES[0] : c.enCours || (/^222/.test(ci) && ent === 'production') ? CONTRAT_TYPES[2] : /^222/.test(ci) ? CONTRAT_TYPES[1] : /^216/.test(ci) ? CONTRAT_TYPES[4] : CONTRAT_TYPES[5];
        list.insertAdjacentHTML('beforeend', contratRow({ type: t }));
        const last = list.lastElementChild; last.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', upd)); last.querySelector('.ctr-num').focus();
      });
      list.addEventListener('click', (e) => { const b = e.target.closest('.ctr-del'); if (b) { b.closest('.ctr-row').remove(); upd(); } });
      upd();
      el.querySelector('#f-save').addEventListener('click', () => submitAssetForm(el, d, isNew, preset));
    }
  });
}
function modeChoices(cat, valeur) {
  if (!cat || !cat.amortissable) return ['N'];
  if (referentiel() === 'FISCAL') {
    const l = ['L'];
    if (cat.equipesEligible) l.push('A');
    if (S.cfg.fiscal.degressifAutorise && cat.degressifEligible) l.push('D');
    l.push('I', 'N');
    return l;
  }
  return ['L', 'D', 'UO', 'N'];
}
function fillModes(el, d, reset) {
  const cat = catOf(el.querySelector('#f-cat').value) || {};
  const m = el.querySelector('#f-mode');
  const ch = modeChoices(cat);
  const cur = reset ? '' : (m.value || d.mode || '');
  m.innerHTML = ch.map((k) => '<option value="' + k + '"' + sel(k, cur) + '>' + esc(EN.MODES[k]) + '</option>').join('');
  if (!ch.includes(cur)) m.value = ch[0];
}
function customInput(c, v) {
  const id = esc('cf-' + c.key);
  if (c.type === 'select') return '<label class="field"><span>' + esc(c.label) + '</span><select id="' + id + '"><option value=""></option>' + opt(String(c.options || '').split(',').map((s) => s.trim()).filter(Boolean), v) + '</select></label>';
  return '<label class="field"><span>' + esc(c.label) + '</span><input id="' + id + '" type="' + (c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text') + '" value="' + esc(v || '') + '"></label>';
}
function readAssetForm(el, d) {
  const g = (id) => { const x = el.querySelector('#' + id); return x ? x.value : ''; };
  const c = (id) => { const x = el.querySelector('#' + id); return !!(x && x.checked); };
  const out = clone(d);
  out.designation = g('f-des').trim(); out.categorie = g('f-cat'); out.emplacement = g('f-emp'); out.etat = g('f-etat'); out.quantite = Math.max(1, parseInt(g('f-qte'), 10) || 1);
  out.marque = g('f-marque').trim(); out.numSerie = g('f-serie').trim(); out.immatriculation = g('f-immat').trim(); out.chassis = g('f-chassis').trim().toUpperCase(); out.parentId = g('f-parent') || null;
  out.entree = g('f-entree'); out.dateAcq = g('f-dacq'); out.dateMES = g('f-dmes');
  const dem = r3(num(g('f-dem')));
  if (c('f-detail')) {
    const cd = {}; let tot = 0;
    COST_PARTS.forEach((p) => { const v = el.querySelector('.f-cd[data-k="' + p[0] + '"]').value; if (v !== '') { cd[p[0]] = r3(num(v)); tot += p[2] * num(v); } });
    out.coutDetail = cd; out.valeur = r3(tot + dem);
  } else { delete out.coutDetail; out.valeur = r3(num(g('f-val'))); }
  out.demantelement = dem > 0 ? { montant: dem, taux: num(g('f-demt')), echeance: g('f-deme') } : null;
  out.vr = r3(num(g('f-vr')));
  out.fournisseur = g('f-four').trim(); out.facture = g('f-fact').trim(); out.pieceCompta = g('f-piece').trim(); out.especes = c('f-esp');
  out.contrats = $$('.ctr-row', el).map((r) => ({ type: r.querySelector('.ctr-type').value, numero: r.querySelector('.ctr-num').value.trim(), date: r.querySelector('.ctr-date').value, recette: r.querySelector('.ctr-rec').value.trim(), cocontractant: r.querySelector('.ctr-tiers').value.trim() })).filter((x) => x.numero || x.date || x.cocontractant);
  out.garantie = num(g('f-gd')) > 0 ? { duree: num(g('f-gd')), unite: g('f-gu') === 'ans' ? 'ans' : 'mois', debut: g('f-gdeb'), conditions: g('f-gcond').trim() } : null;
  const cat = catOf(out.categorie) || {};
  out.mode = g('f-mode') || (cat.amortissable ? 'L' : 'N');
  out.duree = g('f-duree').trim() === '' ? '' : num(g('f-duree'));
  delete out.taux;
  out.equipes = g('f-eq');
  out.uoTotal = num(g('f-uot'));
  const uo = {}; g('f-uoy').split(/\n+/).forEach((l) => { const m = l.split('='); if (m.length === 2 && /^\d{4}$/.test(m[0].trim())) uo[m[0].trim()] = num(m[1]); });
  out.uoParAnnee = uo;
  if (el.querySelector('#f-reg')) {
    out.fiscal = { regime: g('f-reg'), taux: g('f-tf') === '' ? '' : num(g('f-tf')), equipes: out.equipes };
    out.vehicule = cat.vehicule ? { tourisme: c('f-vpt'), cv: num(g('f-cv')), objetPrincipal: c('f-vpo') } : null;
  }
  const sub = r3(num(g('f-sub')));
  out.subvention = sub > 0 ? { montant: sub } : null;
  out.nanti = c('f-nanti'); out.nantiDetail = g('f-nantid').trim();
  out.reprise = c('f-rep') ? { date: g('f-repd'), cumul: r3(num(g('f-repc'))), pertes: r3(num(g('f-repp'))), ecart: r3(num(g('f-repe'))), dureeRestante: g('f-repr') === '' ? '' : num(g('f-repr')), cumulFiscal: g('f-repf') === '' ? '' : r3(num(g('f-repf'))) } : null;
  out.custom = {}; (S.cfg.customFields || []).forEach((cf) => { out.custom[cf.key] = g('cf-' + cf.key); });
  out.observations = g('f-obs');
  return out;
}
function assetFormPreview(el, d, isNew) {
  const a = readAssetForm(el, d);
  const cat = catOf(a.categorie) || {};
  const detail = el.querySelector('#f-detail').checked;
  el.querySelector('#f-detail-box').classList.toggle('hidden', !detail);
  const fv = el.querySelector('#f-val');
  fv.readOnly = detail; if (detail) fv.value = String(a.valeur).replace('.', ',');
  el.querySelector('#f-val-help').textContent = detail ? 'Calculé à partir des composantes, démantèlement compris' : 'Y compris l\'estimation actualisée du démantèlement';
  $$('.f-dem2', el).forEach((x) => x.classList.toggle('hidden', !(num(el.querySelector('#f-dem').value) > 0)));
  el.querySelector('#f-entree-hint').textContent = ENTREE_HINT[a.entree] || '';
  el.querySelector('#f-eq-box').classList.toggle('hidden', !(cat.equipesEligible));
  el.querySelector('#f-uo-box').classList.toggle('hidden', a.mode !== 'UO');
  el.querySelector('#f-rep-box').classList.toggle('hidden', !a.reprise);
  const rb = el.querySelector('#f-reclass-box'); if (rb) rb.classList.toggle('hidden', a.categorie === d.categorie);
  const def = EN.catDuration(cat, engineCfg());
  el.querySelector('#f-duree').placeholder = def ? String(EN.normYears(def)).replace('.', ',') : '';
  el.querySelector('#f-duree-help').textContent = (referentiel() === 'FISCAL' ? 'Référentiel fiscal : ' : 'Catégorie : ') + (def ? yrs(def) : 'non amortissable') + (EN.has(a.duree) ? '' : ' (valeur par défaut)');
  const vpBox = el.querySelector('#f-vp-box'); if (vpBox) vpBox.classList.toggle('hidden', !cat.vehicule);
  $$('.f-roulant', el).forEach((x) => x.classList.toggle('hidden', !cat.roulant && !a.immatriculation && !a.chassis));
  $$('.f-nonroulant', el).forEach((x) => x.classList.toggle('hidden', !!cat.roulant && !a.numSerie));
  const gf = EN.garantieFin(a), gfb = el.querySelector('#f-gfin');
  gfb.classList.toggle('hidden', !a.garantie);
  if (a.garantie) gfb.innerHTML = gf ? 'Garantie jusqu\'au <b>' + fdate(gf) + '</b> inclus' + (gf < EN.today() ? ' <span class="pill grey">expirée</span>' : ' <span class="pill ok">en cours</span>') : 'Renseignez la date d\'acquisition pour calculer la fin de garantie.';
  const tfh = el.querySelector('#f-tf-help'); if (tfh) tfh.textContent = 'Taux maximum de la catégorie : ' + String(cat.tauxFiscal || 0).replace('.', ',') + ' %';
  let codeHtml;
  if (isNew) {
    const pre = EN.codePrefix(S.tenant.codeSociete, a.dateAcq, a.emplacement, a.categorie);
    const code = EN.nextCode(S.assets, pre, S.cfg.counterScope, a.id);
    codeHtml = code ? 'Code attribué à l\'enregistrement : <b class="mono" style="font-size:15px">' + esc(codeTxt(code)) + '</b> &nbsp;<span class="muted">société ' + esc(code.slice(0, 2)) + ' · année ' + esc(code.slice(2, 4)) + ' · emplacement ' + esc(code.slice(4, 6)) + ' · catégorie ' + esc(code.slice(6, 8)) + ' · n° ' + esc(code.slice(8)) + '</span>' : '<b>Compteur saturé (999) pour cette combinaison.</b>';
  } else codeHtml = 'Code : <b class="mono">' + esc(codeTxt(d.code)) + '</b> <span class="muted">— le code reste celui de l\'étiquette d\'origine.</span>';
  el.querySelector('#f-code-box').innerHTML = codeHtml;
  const pv = el.querySelector('#f-preview');
  if (!a.valeur || !a.dateAcq) { pv.innerHTML = 'Saisissez le coût et la date d\'acquisition pour voir le plan d\'amortissement.'; return; }
  const s = EN.schedule(a, cat, engineCfg());
  const fb = el.querySelector('#f-fisc-box');
  if (fb) fb.innerHTML = 'Plafond retenu : <b>' + esc(s.regime.libelle) + '</b>' + (s.regime.taux && ['L', 'A'].includes(s.regime.regime) ? ' · ' + EN.fmtPct(s.regime.taux * (s.regime.regime === 'A' ? EN.coefEquipes(a.equipes, S.cfg.fiscal) : 1)) : '') + (s.regime.alerte ? '<br>' + esc(s.regime.alerte) : '') + (a.demantelement ? '<br>La part « démantèlement » du coût n\'est pas déductible.' : '');
  if (s.erreur) { pv.innerHTML = esc(s.erreur); return; }
  const first = s.rows.find((r) => r.dot > 0);
  if (!first) { pv.innerHTML = s.mode === 'N' ? 'Bien non amortissable.' : 'Aucune dotation calculée.'; return; }
  const last = s.rows.filter((r) => r.dot > 0).pop();
  pv.innerHTML = 'Coût d\'entrée <b>' + money(a.valeur) + ' DT</b> · montant amortissable <b>' + money(a.valeur - a.vr) + '</b> · ' + esc(EN.MODES[s.mode]) + (s.mode === 'L' || s.mode === 'A' || s.mode === 'D' ? ' sur ' + esc(yrs(s.dureeEffective)) + ' (taux ' + EN.fmtPct(s.tauxEffectif) + ')' : '') +
    ' · première dotation ' + first.year + ' : <b>' + money(first.dot) + '</b> · dernière : ' + last.year + (first.reint > 0 ? ' · réintégration fiscale ' + first.year + ' : <b>' + money(first.reint) + '</b>' : '');
}
async function submitAssetForm(el, d, isNew, preset) {
  const a = readAssetForm(el, d);
  const cat = catOf(a.categorie) || {};
  const errs = [];
  if (!a.designation) errs.push('la désignation');
  if (!a.dateAcq || !EN.isValidIso(a.dateAcq)) errs.push('la date d\'acquisition');
  if (!(a.valeur > 0)) errs.push('un coût d\'entrée positif');
  if (a.dateMES && a.dateMES < a.dateAcq) errs.push('une date de mise en service postérieure à l\'acquisition');
  if (a.mode === 'UO' && !(a.uoTotal > 0)) errs.push('le total d\'unités d\'œuvre');
  if (a.vr >= a.valeur && a.valeur > 0 && cat.amortissable) errs.push('une valeur résiduelle inférieure au coût');
  if (a.demantelement && a.demantelement.montant >= a.valeur) errs.push('un démantèlement inférieur au coût total');
  if (['L', 'D'].includes(a.mode) && !(EN.durationOf(a, cat, engineCfg()) > 0)) errs.push('la durée d\'utilité');
  if (errs.length) { toast('Renseignez ' + errs.join(', ') + '.', 'bad'); return; }
  a.events = a.events || [];
  if (isNew) {
    const pre = EN.codePrefix(S.tenant.codeSociete, a.dateAcq, a.emplacement, a.categorie);
    a.code = EN.nextCode(S.assets, pre, S.cfg.counterScope, a.id);
    if (!a.code) { toast('Compteur saturé pour cette combinaison de code.', 'bad'); return; }
    a.createdAt = nowIso();
    a.history = [{ date: a.dateAcq, at: nowIso(), action: a.parentId ? 'Création du composant' : 'Création', detail: (EN.ENTREES[a.entree] || 'Entrée') + ' – emplacement ' + empLabel(a.emplacement), piece: a.pieceCompta || '' }];
  } else {
    a.history = (a.history || []).concat([{ date: EN.today(), at: nowIso(), action: 'Modification', detail: diffText(d, a) }]);
    if (d.emplacement !== a.emplacement) a.history.push({ date: EN.today(), at: nowIso(), action: 'Transfert', detail: empLabel(d.emplacement) + ' → ' + empLabel(a.emplacement) });
    if (d.categorie !== a.categorie) {
      const rd = (el.querySelector('#f-reclass') || {}).value || EN.today();
      a.events.push({ id: uid(), type: 'transfert', date: rd, de: d.categorie, vers: a.categorie, motif: 'Reclassement', pieceCompta: pieceOf(el, 'f-reclass-piece') });
    }
  }
  const btn = el.querySelector('#f-save'); btn.disabled = true;
  if (await saveAsset(a)) {
    if (isNew && preset && preset._remplace) {
      const old = assetById(preset._remplace);
      if (old && !old.sortie) {
        const b = clone(old);
        b.sortie = { type: 'Remplacement de composant', date: a.dateMES || a.dateAcq, prix: 0, indemnite: 0, tiers: '', piece: '', pieceCompta: a.pieceCompta || '', motif: 'Remplacé par ' + a.code + ' (NC 05 §18 et §79)', at: nowIso() };
        b.history = (b.history || []).concat([{ date: b.sortie.date, at: nowIso(), action: 'Sortie (remplacement de composant)', detail: a.code, piece: b.sortie.pieceCompta }]);
        await saveAsset(b, true);
      }
    }
    closeModal(); go('asset', a.id);
  } else btn.disabled = false;
}
function diffText(o, n) {
  const f = [['designation', 'désignation'], ['valeur', 'coût'], ['dateAcq', 'date d\'acquisition'], ['dateMES', 'mise en service'], ['mode', 'mode'], ['duree', 'durée'], ['vr', 'valeur résiduelle'], ['categorie', 'catégorie'], ['etat', 'état'], ['numSerie', 'n° de série'], ['immatriculation', 'immatriculation'], ['chassis', 'n° de châssis'], ['pieceCompta', 'pièce comptable'], ['facture', 'facture'], ['contrats', 'contrats'], ['garantie', 'garantie']];
  const sv = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const ch = f.filter((x) => sv(o[x[0]]) !== sv(n[x[0]]) && !(x[0] === 'contrats' && !(o.contrats || []).length && !(n.contrats || []).length)).map((x) => x[1]);
  return ch.length ? 'Champs modifiés : ' + ch.join(', ') : 'Mise à jour';
}

/* ---------------- Fiche immobilisation ---------------- */
TITLES.asset = { title: 'Fiche immobilisation', year: true, tenant: true };
VIEWS.asset = function () {
  const a = assetById(S.arg);
  if (!a) return '<div class="panel"><div class="empty"><b>Immobilisation introuvable.</b><button class="btn" data-act="nav" data-view="assets">Retour au registre</button></div></div>';
  const s = sched(a), cat = catOf(a.categorie) || {}, cfg = engineCfg();
  const p = EN.parseCode(a.code) || {};
  const tab = S.ui.assetTab || 'plan';
  const v = EN.yearValues(a, s, S.year, cfg);
  const dl = (l, val) => '<div><dt>' + l + '</dt><dd>' + (val === '' || val === null || val === undefined ? '—' : val) + '</dd></div>';
  const custom = (S.cfg.customFields || []).map((c) => dl(esc(c.label), esc((a.custom || {})[c.key] || ''))).join('');
  const parent = a.parentId ? assetById(a.parentId) : null;
  const comps = S.assets.filter((x) => x.parentId === a.id);
  const cd = a.coutDetail;
  const costDetail = cd ? '<details class="more" style="margin-top:12px"><summary>Composantes du coût d\'entrée (§20)</summary>' + COST_PARTS.filter((x) => EN.has(cd[x[0]])).map((x) => '<div class="calc-line"><span>' + esc(x[1]) + '</span><b>' + (x[2] < 0 ? '− ' : '') + money(cd[x[0]]) + '</b></div>').join('') + (a.demantelement ? '<div class="calc-line"><span>Démantèlement et remise en état (valeur actualisée)</span><b>' + money(a.demantelement.montant) + '</b></div>' : '') + '<div class="calc-line total"><span>Coût d\'entrée</span><b>' + money(a.valeur) + '</b></div></details>' : '';
  let sortieBox = '';
  if (a.sortie) {
    const sc = EN.sortieCalc(a, cat, cfg);
    sortieBox = '<div class="panel"><div class="panel-head"><h3>Sortie du patrimoine</h3><div class="actions"><button class="btn ghost sm" data-act="sortie-cancel" data-id="' + esc(a.id) + '">Annuler la sortie</button></div></div><dl class="dl">' +
      dl('Nature', esc(a.sortie.type)) + dl('Date', fdate(a.sortie.date)) + dl('Prix de cession HT', money(sc.prix)) + dl('Indemnité', money(sc.indemnite)) + dl('Dotation complémentaire', money(sc.dotComplementaire)) + dl('Amortissements cumulés', money(sc.cumul)) + dl('Pertes de valeur cumulées', money(sc.prov)) + dl('Valeur comptable', money(sc.vnc)) +
      dl('Résultat comptable', '<span style="color:' + (sc.resCompta < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + money(sc.resCompta) + '</span>') + (sc.ecartVire > 0 ? dl('Écart viré aux résultats reportés', money(sc.ecartVire)) : '') + (S.cfg.modules.fiscal ? dl('Résultat fiscal', money(sc.resFiscal)) : '') + dl('Tiers', esc(a.sortie.tiers || '')) + dl('Justificatif', esc(a.sortie.piece || '')) + dl('Réf. pièce comptable', pieceTag(a, 'sortie', null, a.sortie.pieceCompta)) + '</dl>' + (a.sortie.motif ? '<p class="muted" style="margin:12px 0 0">' + esc(a.sortie.motif) + '</p>' : '') + '</div>';
  }
  const canReeval = cat.modele === 'reevaluation' && cat.type !== 'I';
  const evActions = a.sortie ? '' : '<div class="ev-actions">' +
    (cat.enCours ? '<button class="btn sm" data-act="ev-mes" data-id="' + esc(a.id) + '">Mettre en service</button>' : '') +
    '<button class="btn ghost sm" data-act="ev-revision" data-id="' + esc(a.id) + '">Réviser les estimations</button>' +
    '<button class="btn ghost sm" data-act="ev-test" data-id="' + esc(a.id) + '">Test de dépréciation</button>' +
    (canReeval ? '<button class="btn ghost sm" data-act="ev-reeval" data-id="' + esc(a.id) + '">Réévaluer</button>' : '') +
    '<button class="btn ghost sm" data-act="ev-complement" data-id="' + esc(a.id) + '">Dépense ultérieure</button>' +
    (a.parentId ? '' : '<button class="btn ghost sm" data-act="ev-composant" data-id="' + esc(a.id) + '">Ajouter un composant</button>') +
    (a.demantelement ? '<button class="btn ghost sm" data-act="ev-dem" data-id="' + esc(a.id) + '">Réviser le démantèlement</button>' : '') + '</div>';
  const evs = (a.events || []).slice().sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const evRes = (id) => s.events.find((e) => e.id === id) || {};
  const evHtml = evs.length ? '<div class="ev-list" style="margin-top:12px">' + evs.map((ev) => {
    const r = evRes(ev.id);
    const after = a.sortie && ev.date > a.sortie.date;
    return '<div class="ev"><div class="d">' + fdate(ev.date) + '</div><div><div class="t">' + esc(ev.type === 'transfert' && ev.motif === 'Mise en service' ? 'Mise en service' : (EN.EVENT_TYPES[ev.type] || ev.type)) + (after ? ' <span class="pill warn">postérieur à la sortie : sans effet</span>' : '') + '</div><div class="x2">' + (after ? '' : eventSummary(ev, r)) + '</div>' + (after ? '' : '<div class="x2">' + pieceTag(a, 'ev', ev, ev.pieceCompta, !evNeedsPiece(ev, r)) + '</div>') + '</div>' +
      '<div class="ev-actions"><button class="btn ghost sm" data-act="ev-del" data-id="' + esc(a.id) + '" data-ev="' + esc(ev.id) + '" aria-label="Supprimer l\'événement">' + icon('trash') + '</button></div></div>';
  }).join('') + '</div>' : '<p class="muted" style="margin:10px 0 0">Aucun événement d\'évaluation : le plan d\'origine s\'applique.</p>';
  const planRows = s.rows.map((r) => {
    const pert = r3(r.pvRep - r.pvDot), reev = r3(r.vbReeval + r.amElim + r.pvElim), ent = r3(r.vbComplements + r.vbDem);
    return '<tr' + (r.year === S.year ? ' style="background:#F4EFFF"' : '') + '><td>' + esc(EN.exoLabel(r.year, cfg)) + (r.sortie ? ' <span class="pill grey">sortie</span>' : '') + '</td><td class="num">' + money(r3(r.gDebut - r.amDebut - r.pvDebut)) + '</td><td class="num">' + (ent ? money(ent) : '') + '</td><td class="num"><b>' + money(r.dot) + '</b></td><td class="num" style="color:' + (pert < 0 ? 'var(--bad)' : 'inherit') + '">' + (pert ? money(pert) : '') + '</td><td class="num">' + (reev ? money(reev) : '') + '</td><td class="num">' + money(r.vnc) + '</td><td class="num">' + money(r.amFin) + '</td><td class="num">' + (r.pvFin ? money(r.pvFin) : '') + '</td><td class="num">' + (['L', 'A', 'D'].includes(r.mode) ? esc(yrs(r.remFin)) : '') + '</td></tr>';
  }).join('');
  const fiscRows = s.rows.map((r) => '<tr' + (r.year === S.year ? ' style="background:#F4EFFF"' : '') + '><td>' + esc(EN.exoLabel(r.year, cfg)) + '</td><td class="num">' + money(r.dot) + '</td><td class="num">' + money(r.cap) + '</td><td class="num">' + money(r.ded) + '</td><td class="num" style="color:' + (r.reint > 0 ? 'var(--bad)' : 'inherit') + '">' + money(r.reint) + '</td><td class="num">' + money(r.dedAnt) + '</td><td class="num">' + money(r.reintAutres) + '</td><td class="num">' + money(r.dedAutres) + '</td><td class="num">' + money(r.cumDed) + '</td></tr>').join('');
  const hist = (a.history || []).slice().reverse().map((h) => '<tr><td>' + fdate(h.date) + '</td><td>' + esc(h.action) + '</td><td>' + esc(h.detail || '') + '</td><td class="mono">' + esc(h.piece || '') + '</td></tr>').join('');
  const tabs = '<div class="tabs" role="tablist"><button class="' + (tab === 'plan' ? 'on' : '') + '" data-act="asset-tab" data-tab="plan">Plan d\'amortissement (NC 05)</button>' + (S.cfg.modules.fiscal ? '<button class="' + (tab === 'fisc' ? 'on' : '') + '" data-act="asset-tab" data-tab="fisc">Plan fiscal</button>' : '') + '<button class="' + (tab === 'mvt' ? 'on' : '') + '" data-act="asset-tab" data-tab="mvt">Mouvements et pièces</button><button class="' + (tab === 'hist' ? 'on' : '') + '" data-act="asset-tab" data-tab="hist">Historique</button></div>';
  let tabBody;
  if (tab === 'fisc' && S.cfg.modules.fiscal) tabBody = s.rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Exercice</th><th class="num">Dotation comptable</th><th class="num">Plafond fiscal</th><th class="num">Déductible</th><th class="num">Réintégré</th><th class="num">Déduction des réintégrations antérieures</th><th class="num">Autres réintégrations</th><th class="num">Autres déductions</th><th class="num">Cumul déduit</th></tr></thead><tbody>' + fiscRows + '</tbody></table></div><p class="muted" style="font-size:12px;margin:10px 0 0">Plafond : ' + esc(s.regime.libelle) + '. L\'excédent réintégré est déduit les exercices suivants dans la limite du plafond (note commune n° 22/2008). Pertes de valeur, diminutions de réévaluation et désactualisation : réintégrées ; reprises : déduites.</p>' : '<div class="empty"><b>Aucune donnée fiscale.</b></div>';
  else if (tab === 'hist') tabBody = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Événement</th><th>Détail</th><th>Pièce</th></tr></thead><tbody>' + (hist || '<tr><td colspan="4">Aucun événement.</td></tr>') + '</tbody></table></div>';
  else if (tab === 'mvt') {
    const mv = assetMovements(a).sort((p, q) => String(p.date).localeCompare(String(q.date)));
    tabBody = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Mouvement</th><th class="num">Montant</th><th>Justificatif</th><th>Réf. pièce comptable</th></tr></thead><tbody>' + mv.map((m) => '<tr><td>' + fdate(m.date) + '</td><td>' + esc(m.label) + '</td><td class="num">' + (m.montant === '' ? '' : money(m.montant)) + '</td><td>' + esc(m.justif || '') + '</td><td>' + (m.piece ? '<span class="mono">' + esc(m.piece) + '</span>' : (m.compta ? '<span class="pill warn">à renseigner</span>' : '<span class="muted">—</span>')) + '</td></tr>').join('') + '</tbody></table></div><p class="muted" style="font-size:12px;margin:10px 0 0">Les références se saisissent dans chaque formulaire (entrée, événement, transfert, sortie) ou après coup avec « saisir » sur l\'événement concerné.</p>';
  }
  else tabBody = s.rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Exercice</th><th class="num">VNC début</th><th class="num">Entrées</th><th class="num">Dotation</th><th class="num">Pertes (−) / reprises (+)</th><th class="num">Réévaluation</th><th class="num">VNC fin</th><th class="num">Amort. cumulés</th><th class="num">Pertes cumulées</th><th class="num">Durée résiduelle</th></tr></thead><tbody>' + planRows + '</tbody></table></div>' +
    '<p class="muted" style="font-size:12px;margin:10px 0 0">Amortissement à compter de la mise en service, au prorata ' + esc(prorataLabel(cfg.prorata)) + '. Après une révision, une perte de valeur ou une réévaluation, la valeur comptable restante est répartie sur la durée résiduelle (NC 05 §52, §62 et §70).</p>'
    : '<div class="empty"><b>' + (s.erreur ? esc(s.erreur) : 'Aucune dotation : bien non amortissable.') + '</b></div>';
  return '<div class="page-head"><div><button class="btn ghost sm" data-act="nav" data-view="assets">' + icon('back') + 'Registre</button></div><div class="actions">' +
    '<button class="btn ghost" data-act="asset-pdf" data-id="' + esc(a.id) + '">' + icon('dl') + 'Fiche PDF</button>' +
    (S.cfg.modules.etiquettes ? '<button class="btn ghost" data-act="label-one" data-id="' + esc(a.id) + '">' + icon('tag') + 'Étiquette</button>' : '') +
    (a.sortie ? '' : '<button class="btn ghost" data-act="asset-move" data-id="' + esc(a.id) + '">' + icon('move') + 'Transférer</button><button class="btn ghost" data-act="sortie-new" data-id="' + esc(a.id) + '">' + icon('out') + 'Constater une sortie</button>') +
    '<button class="btn" data-act="asset-edit" data-id="' + esc(a.id) + '">' + icon('edit') + 'Modifier</button></div></div>' +
    '<div class="panel"><div class="asset-head"><div style="min-width:0"><div class="asset-code">' + esc(codeTxt(a.code)) + '</div><h3 style="font-size:28px;margin:6px 0 0">' + esc(a.designation) + '</h3>' +
    '<div class="code-parts"><span>Société <b>' + esc(p.societe || '') + '</b></span><span>Année <b>' + esc(p.annee || '') + '</b></span><span>Emplacement d\'origine <b>' + esc(p.emplacement || '') + '</b></span><span>Catégorie <b>' + esc(p.categorie || '') + '</b></span><span>N° <b>' + esc(p.compteur || '') + '</b></span></div>' +
    (parent ? '<p style="margin:10px 0 0">Composant de <button class="link" data-act="asset-open" data-id="' + esc(parent.id) + '">' + esc(codeTxt(parent.code) + ' – ' + parent.designation) + '</button></p>' : '') + '</div>' +
    '<div style="display:grid;gap:6px;justify-items:end">' + statusPill(a) + '<span class="pill">' + esc(cat.modele === 'reevaluation' ? 'Modèle de la réévaluation' : 'Modèle du coût') + '</span>' + (S.cfg.modules.fiscal ? '<span class="pill grey">Fiscal : ' + esc(s.regime.libelle) + '</span>' : '') + '</div></div>' +
    '<dl class="dl" style="margin-top:18px">' + dl('Catégorie', esc(catLabel(a.categorie))) + dl('Emplacement actuel', esc(empLabel(a.emplacement))) + dl('Mode d\'entrée', esc(EN.ENTREES[a.entree || 'achat'])) + dl('Date d\'acquisition', fdate(a.dateAcq)) + dl('Mise en service', fdate(a.dateMES || a.dateAcq)) +
    dl('Coût d\'entrée HT', money(a.valeur) + ' DT') + dl('Valeur résiduelle', money(a.vr || 0)) + dl('Mode et durée d\'utilité', esc(EN.MODES[s.mode]) + (['L', 'A', 'D'].includes(s.mode) ? ' · ' + esc(yrs(s.dureeEffective)) + ' (' + EN.fmtPct(s.tauxEffectif) + ')' : '')) +
    dl('Valeur comptable au ' + fdate(EN.exo(S.year, cfg).end), v.exists ? money(v.vbFin ? v.vncFin : 0) : '—') + (v.ecartFin > 0 ? dl('Écart de réévaluation', money(v.ecartFin)) : '') + (a.demantelement ? dl('Provision pour démantèlement', money((v.row && v.row.provDemFin) || a.demantelement.montant) + ' · ' + String(a.demantelement.taux || 0).replace('.', ',') + ' %') : '') +
    (a.subvention ? dl('Subvention d\'investissement', money(a.subvention.montant)) : '') + (a.nanti ? dl('Nantissement', esc(a.nantiDetail || 'Oui')) : '') +
    dl('Comptes', esc((cat.cptImmo || '') + ' / ' + (cat.cptAmort || '—') + ' / ' + (cat.cptProv || ''))) + dl('Fournisseur', esc(a.fournisseur || '')) + dl('Facture', esc(a.facture || '')) + dl('Pièce comptable d\'entrée', pieceTag(a, 'entree', null, a.pieceCompta)) + dl('Marque / modèle', esc(a.marque || '')) +
    (cat.roulant || a.immatriculation || a.chassis ? dl('Immatriculation', esc(a.immatriculation || '')) + dl('N° de châssis', esc(a.chassis || '')) : '') + (serieRelevant(cat) || a.numSerie ? dl('N° de série', esc(a.numSerie || '')) : '') +
    dl('Garantie', garantieHtml(a)) + dl('État', esc(a.etat || '')) +
    (a.reprise ? dl('Reprise au ' + fdate(a.reprise.date), money(a.reprise.cumul) + ' DT amortis') : '') + custom + '</dl>' + costDetail +
    ((a.contrats || []).length ? '<div class="fs" style="margin-top:14px"><b>Contrats et actes enregistrés</b><div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Nature</th><th>N° d\'enregistrement</th><th>Date</th><th>Recette des finances</th><th>Cocontractant</th></tr></thead><tbody>' + a.contrats.map((c) => '<tr><td>' + esc(c.type) + '</td><td class="mono">' + esc(c.numero || '') + '</td><td>' + fdate(c.date) + '</td><td>' + esc(c.recette || '') + '</td><td>' + esc(c.cocontractant || '') + '</td></tr>').join('') + '</tbody></table></div></div>' : '') + (a.observations ? '<p class="muted" style="margin:14px 0 0">' + esc(a.observations) + '</p>' : '') +
    (s.regime.alerte ? '<div class="note warn" style="margin-top:12px">' + esc(s.regime.alerte) + '</div>' : '') + (s.erreur ? '<div class="note bad" style="margin-top:12px">' + esc(s.erreur) + '</div>' : '') + '</div>' +
    (comps.length ? '<div class="panel"><h3>Composants (' + comps.length + ')</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Désignation</th><th>Mise en service</th><th class="num">Coût</th><th>Durée</th><th>Statut</th></tr></thead><tbody>' + comps.map((c) => { const cs = sched(c); return '<tr class="click" data-act="asset-open" data-id="' + esc(c.id) + '"><td class="code">' + esc(codeTxt(c.code)) + '</td><td>' + esc(c.designation) + '</td><td>' + fdate(c.dateMES || c.dateAcq) + '</td><td class="num">' + money(c.valeur) + '</td><td>' + esc(yrs(cs.dureeEffective || cs.dureeAns)) + '</td><td>' + statusPill(c) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '') +
    sortieBox +
    '<div class="panel"><div class="panel-head"><h3>Évaluation postérieure (NC 05)</h3>' + evActions + '</div>' + evHtml + '</div>' +
    '<div class="panel">' + tabs + tabBody + '</div>' +
    '<div class="actions"><button class="btn danger sm" data-act="asset-del" data-id="' + esc(a.id) + '">' + icon('trash') + 'Supprimer cette fiche</button><span class="muted" style="font-size:12px">La suppression efface la fiche du registre ; pour un bien vendu, cassé ou volé, utilisez « Constater une sortie ».</span></div>';
};
function garantieHtml(a) {
  const g = a.garantie; if (!g || !(num(g.duree) > 0)) return '';
  const f = EN.garantieFin(a);
  return esc(String(g.duree).replace('.', ',') + ' ' + (g.unite === 'ans' ? (num(g.duree) > 1 ? 'ans' : 'an') : 'mois')) + (f ? ' · jusqu\'au ' + fdate(f) + (f < EN.today() ? ' <span class="pill grey">expirée</span>' : ' <span class="pill ok">en cours</span>') : '') + (g.conditions ? '<br><span class="muted">' + esc(g.conditions) + '</span>' : '');
}
function eventSummary(ev, r) {
  const m = (x) => money(x);
  if (ev.type === 'revision') {
    const parts = [];
    if (EN.has(ev.dureeRestante)) parts.push('durée résiduelle ' + yrs(num(ev.dureeRestante)));
    if (EN.has(ev.vr)) parts.push('valeur résiduelle ' + m(ev.vr));
    if (ev.mode) parts.push('mode ' + (EN.MODES[ev.mode] || ev.mode));
    if (EN.has(ev.uoRestant)) parts.push(ev.uoRestant + ' unités restantes');
    return esc(parts.join(' · ') || 'Révision') + (ev.motif ? ' — ' + esc(ev.motif) : '') + ' <span class="pill">changement d\'estimation, prospectif (NC 11)</span>';
  }
  if (ev.type === 'complement') return 'Montant immobilisé ' + m(ev.montant) + (EN.has(ev.dureeRestante) ? ' · nouvelle durée résiduelle ' + esc(yrs(num(ev.dureeRestante))) : '') + (ev.libelle ? ' — ' + esc(ev.libelle) : '');
  if (ev.type === 'test') {
    const base = r.baseRA === 'vu' ? 'valeur d\'utilité' : 'juste valeur';
    let res = '';
    if (r.resultat === 'perte') res = '<span class="pill bad">Perte de valeur ' + m(r.perte) + '</span>' + (r.imputationEcart > 0 ? ' dont ' + m(r.imputationEcart) + ' sur l\'écart de réévaluation' : '');
    else if (r.resultat === 'reprise') res = '<span class="pill ok">Reprise ' + m(r.reprise) + '</span>' + (r.plafond !== null && r.plafond !== undefined ? ' (plafond ' + m(r.plafond) + ')' : '');
    else if (r.resultat === 'reprise_non_autorisee') res = '<span class="pill warn">Reprise non constatée : aucun changement d\'estimation (§63)</span>';
    else if (r.resultat === 'incomplet') res = '<span class="pill warn">Valeur récupérable non renseignée</span>';
    else res = '<span class="pill ok">Aucune perte de valeur</span>';
    return 'Valeur comptable ' + m(r.ca) + ' · valeur récupérable ' + (r.ra !== undefined ? m(r.ra) + ' (' + base + ')' : '—') + ' · ' + res + ((ev.indices || []).length ? '<br>Indices : ' + esc(ev.indices.map((k) => (EN.INDICES[k] || k).replace(/ \(§57 .\)/, '')).join(' ; ')) : '');
  }
  if (ev.type === 'reevaluation') {
    let x = 'Juste valeur ' + m(ev.justeValeur) + ' · valeur comptable ' + m(r.ca) + ' · ';
    if (r.ecart >= 0) x += 'hausse ' + m(r.ecart) + (r.produit > 0 ? ' (dont ' + m(r.produit) + ' en produit)' : '') + ' en écart de réévaluation';
    else x += 'baisse ' + m(-r.ecart) + (r.imputation > 0 ? ' (dont ' + m(r.imputation) + ' imputée sur l\'écart)' : '') + (r.charge > 0 ? ' · charge ' + m(r.charge) : '');
    return x + (ev.methode ? ' — ' + esc(ev.methode) : '') + (ev.evaluateur ? ', ' + esc(ev.evaluateur) + (ev.independant ? ' (indépendant)' : '') : '');
  }
  if (ev.type === 'transfert') return 'De ' + esc(catLabel(ev.de)) + ' vers ' + esc(catLabel(ev.vers)) + (ev.motif && ev.motif !== 'Mise en service' ? ' — ' + esc(ev.motif) : '');
  if (ev.type === 'demantelement') return 'Nouvelle estimation actualisée ' + m(ev.montant) + ' · variation ' + m(r.delta || 0) + ' (§96)';
  return '';
}
function prorataLabel(p) { return p === 'mois' ? 'des mois entiers' : p === 'j360' ? 'des jours (base 360)' : 'des jours exacts'; }
ACT['asset-tab'] = (el) => { S.ui.assetTab = el.dataset.tab; render(); };
ACT['asset-del'] = async (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  const ok = await confirmBox('Supprimer la fiche', '<p>La fiche <b class="mono">' + esc(codeTxt(a.code)) + '</b> – ' + esc(a.designation) + ' sera supprimée définitivement du registre.</p><div class="note warn">Une suppression n\'est pas une sortie comptable : elle ne génère ni écriture ni résultat de cession.</div>', 'Supprimer', true);
  if (!ok) return;
  try { await Store.del(P.asset(S.tenantId, a.id)); S.assets = S.assets.filter((x) => x.id !== a.id); S.assets.forEach((x) => { if (x.parentId === a.id) x.parentId = null; }); await saveTenant(true); toast('Fiche supprimée.', 'ok'); go('assets'); }
  catch (e) { storeError(e, 'suppression'); }
};
ACT['asset-move'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  openModal({
    title: 'Transférer ' + codeTxt(a.code), size: 'narrow',
    body: '<div class="form"><label class="field"><span>Nouvel emplacement</span><select id="mv-emp">' + emps().filter((e) => e.code !== a.emplacement).map((e) => '<option value="' + esc(e.code) + '">' + esc(e.code + ' – ' + e.libelle) + '</option>').join('') + '</select></label><label class="field"><span>Date du transfert</span><input id="mv-date" type="date" value="' + EN.today() + '"></label><label class="field"><span>Motif</span><input id="mv-motif"></label>' + pieceField('mv-piece', '', 'Bon de transfert ou pièce interne (facultatif)') + '<div class="note">Le code et l\'étiquette restent inchangés ; seul l\'emplacement de rattachement évolue.</div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="mv-ok">Transférer</button>',
    mount: (m) => m.querySelector('#mv-ok').addEventListener('click', async () => {
      const ne = m.querySelector('#mv-emp').value; if (!ne) return;
      const b = clone(a);
      b.history = (b.history || []).concat([{ date: m.querySelector('#mv-date').value || EN.today(), at: nowIso(), action: 'Transfert', detail: empLabel(a.emplacement) + ' → ' + empLabel(ne) + (m.querySelector('#mv-motif').value ? ' (' + m.querySelector('#mv-motif').value + ')' : ''), piece: pieceOf(m, 'mv-piece') }]);
      b.emplacement = ne;
      if (await saveAsset(b, true)) { toast('Transfert enregistré.', 'ok'); closeModal(); render(); }
    })
  });
};

/* ---------------- Événements d'évaluation ---------------- */
function stateAtUI(a, date) { return EN.stateAt(a, catOf(a.categorie), engineCfg(), date); }
function previewEvent(a, ev) {
  const b = Object.assign({}, a, { events: (a.events || []).concat([ev]) });
  const s = EN.schedule(b, catOf(a.categorie), engineCfg());
  return { s: s, r: s.events.find((x) => x.id === ev.id) || null, row: s.rows.find((r) => r.year === EN.exoOf(ev.date, engineCfg())) };
}
async function addEvent(a, ev, histLabel) {
  if (a.sortie && ev.date > a.sortie.date) { toast('Date postérieure à la sortie du bien (' + fdate(a.sortie.date) + ') : l\'événement serait sans effet.', 'bad'); return false; }
  const b = clone(a);
  b.events = (b.events || []).concat([ev]);
  b.history = (b.history || []).concat([{ date: ev.date, at: nowIso(), action: histLabel || EN.EVENT_TYPES[ev.type], detail: ev.motif || ev.libelle || '', piece: ev.pieceCompta || '' }]);
  if (await saveAsset(b, true)) { toast('Événement enregistré : ' + (EN.EVENT_TYPES[ev.type] || '') + '.', 'ok'); closeModal(); render(); return true; }
  return false;
}
function stateBox(st, date) {
  if (!st) return '';
  return '<div class="fs"><b>Situation au ' + fdate(date) + '</b><div class="calc-line"><span>Valeur brute</span><b>' + money(st.gross) + '</b></div><div class="calc-line"><span>Amortissements cumulés</span><b>' + money(st.cum) + '</b></div>' + (st.prov ? '<div class="calc-line"><span>Pertes de valeur cumulées</span><b>' + money(st.prov) + '</b></div>' : '') + '<div class="calc-line total"><span>Valeur comptable</span><b>' + money(st.ca) + '</b></div>' + (['L', 'A', 'D'].includes(st.mode) ? '<div class="calc-line"><span>Durée résiduelle</span><b>' + esc(yrs(st.rem)) + '</b></div>' : '') + (st.surplus ? '<div class="calc-line"><span>Écart de réévaluation</span><b>' + money(st.surplus) + '</b></div>' : '') + '</div>';
}
ACT['ev-del'] = async (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  const ev = (a.events || []).find((x) => x.id === el.dataset.ev); if (!ev) return;
  const ok = await confirmBox('Supprimer l\'événement', '<p>« ' + esc(EN.EVENT_TYPES[ev.type]) + ' » du ' + fdate(ev.date) + ' sera supprimé. Le plan d\'amortissement est recalculé sans cet événement.</p>', 'Supprimer', true);
  if (!ok) return;
  const b = clone(a); b.events = b.events.filter((x) => x.id !== ev.id);
  if (ev.type === 'transfert' && ev.de && b.categorie === ev.vers && !b.events.some((x) => x.type === 'transfert')) { /* le reclassement reste acquis : modifiez la catégorie si nécessaire */ }
  b.history = (b.history || []).concat([{ date: EN.today(), at: nowIso(), action: 'Suppression d\'événement', detail: EN.EVENT_TYPES[ev.type] + ' du ' + fdate(ev.date) }]);
  if (await saveAsset(b, true)) { toast('Événement supprimé.', 'ok'); render(); }
};
ACT['ev-revision'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  const def = EN.exo(S.year, engineCfg()).start;
  const s = sched(a);
  const modes = referentiel() === 'FISCAL' ? modeChoices(catOf(a.categorie)) : ['L', 'D', 'UO'];
  openModal({
    title: 'Réviser les estimations – ' + codeTxt(a.code), sticky: true,
    body: '<div class="form"><div class="note">NC 05 §51 à §54 : la durée d\'utilité, la valeur résiduelle et le mode sont revus périodiquement. Une révision est un changement d\'estimation (NC 11) : elle s\'applique à l\'exercice en cours et aux suivants, sans retraitement du passé.</div>' +
      '<div class="row"><label class="field"><span>À compter du</span><input id="rv-date" type="date" value="' + esc(def) + '"></label><label class="field"><span>Nouvelle durée résiduelle (années)</span><input id="rv-rem" inputmode="decimal" placeholder="inchangée"></label>' +
      '<label class="field"><span>Nouvelle valeur résiduelle (DT)</span><input id="rv-vr" inputmode="decimal" placeholder="inchangée"><small>Modèle du coût : pas de hausse liée aux prix (§48)</small></label>' +
      '<label class="field"><span>Nouveau mode</span><select id="rv-mode"><option value="">Inchangé</option>' + modes.map((k) => '<option value="' + k + '">' + esc(EN.MODES[k]) + '</option>').join('') + '</select></label>' +
      (s.mode === 'UO' ? '<label class="field"><span>Unités d\'œuvre restantes</span><input id="rv-uo" inputmode="decimal"></label>' : '') + pieceField('rv-piece', '', 'Facultatif : la révision n\'entraîne pas d\'écriture immédiate') + '</div>' +
      '<label class="field"><span>Motif de la révision <em>*</em></span><textarea id="rv-motif" rows="2" placeholder="Usure plus rapide, prolongation après rénovation, obsolescence technique…"></textarea></label><div id="rv-prev"></div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="rv-ok">Enregistrer la révision</button>',
    mount: (m) => {
      const read = () => ({ id: uid(), type: 'revision', date: m.querySelector('#rv-date').value, dureeRestante: m.querySelector('#rv-rem').value === '' ? '' : num(m.querySelector('#rv-rem').value), vr: m.querySelector('#rv-vr').value === '' ? '' : r3(num(m.querySelector('#rv-vr').value)), mode: m.querySelector('#rv-mode').value, uoRestant: m.querySelector('#rv-uo') && m.querySelector('#rv-uo').value !== '' ? num(m.querySelector('#rv-uo').value) : '', motif: m.querySelector('#rv-motif').value.trim(), pieceCompta: pieceOf(m, 'rv-piece') });
      const upd = () => {
        const ev = read(); const box = m.querySelector('#rv-prev');
        if (!EN.isValidIso(ev.date)) { box.innerHTML = ''; return; }
        const before = EN.stateAt(a, catOf(a.categorie), engineCfg(), EN.iso(EN.dn(ev.date) - 1));
        const p = previewEvent(a, ev);
        const y = EN.exoOf(ev.date, engineCfg());
        const oldRow = sched(a).rows.find((r) => r.year === y);
        box.innerHTML = '<div class="grid-2">' + stateBox(before, EN.iso(EN.dn(ev.date) - 1)) + '<div class="fs"><b>Effet sur l\'exercice ' + y + '</b><div class="calc-line"><span>Dotation actuelle</span><b>' + money(oldRow ? oldRow.dot : 0) + '</b></div><div class="calc-line total"><span>Dotation après révision</span><b>' + money(p.row ? p.row.dot : 0) + '</b></div></div></div>';
      };
      m.querySelectorAll('input,select,textarea').forEach((i) => i.addEventListener('input', upd)); upd();
      m.querySelector('#rv-ok').addEventListener('click', async () => {
        const ev = read();
        if (!EN.isValidIso(ev.date) || ev.date < (a.dateMES || a.dateAcq)) { toast('Date de révision invalide.', 'bad'); return; }
        if (!EN.has(ev.dureeRestante) && !EN.has(ev.vr) && !ev.mode && !EN.has(ev.uoRestant)) { toast('Indiquez au moins une estimation révisée.', 'bad'); return; }
        if (!ev.motif) { toast('Indiquez le motif de la révision.', 'bad'); return; }
        await addEvent(a, ev, 'Révision des estimations');
      });
    }
  });
};
ACT['ev-test'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  const def = EN.exo(S.year, engineCfg()).end;
  openModal({
    title: 'Test de dépréciation – ' + codeTxt(a.code), size: 'wide', sticky: true,
    body: '<div class="form"><div class="note">NC 05 §55 à §66 : le test est réalisé lorsque des indices laissent penser que la valeur comptable ne sera pas recouvrée. La valeur récupérable est le montant que l\'entreprise compte obtenir de l\'usage futur de l\'actif, y compris sa valeur résiduelle de cession : flux de trésorerie actualisés (valeur d\'utilité) ; à défaut, juste valeur. L\'application retient la plus élevée des valeurs renseignées.</div>' +
      '<div class="row"><label class="field"><span>Date du test</span><input id="ts-date" type="date" value="' + esc(def) + '"></label>' + pieceField('ts-piece', '', 'Écriture de dépréciation ou de reprise (' + S.cfg.comptes.dotProv + ' / ' + S.cfg.comptes.repriseProv + ')') + '</div>' +
      '<div class="field"><span>Indices relevés</span><div class="subgrid">' + Object.keys(EN.INDICES).map((k) => '<label class="check"><input type="checkbox" class="ts-ind" value="' + k + '"> ' + esc(EN.INDICES[k]) + '</label>').join('') + '</div></div>' +
      '<div class="grid-2"><div class="fs"><b>Valeur d\'utilité (flux actualisés)</b><label class="field"><span>Valeur d\'utilité retenue (DT)</span><input id="ts-vu" inputmode="decimal"></label>' +
      '<details class="more"><summary>Calculer par actualisation</summary><div class="form"><label class="field"><span>Flux nets annuels attendus (un par ligne, année 1, 2…)</span><textarea id="ts-flux" rows="4" placeholder="25000&#10;25000&#10;20000"></textarea><small>Hors charges financières, sur la durée d\'utilité restante (§60)</small></label><div class="row"><label class="field"><span>Taux d\'actualisation avant impôt (%)</span><input id="ts-taux" inputmode="decimal" value="10"></label><label class="field"><span>Valeur de sortie en fin de période</span><input id="ts-sortie" inputmode="decimal" value="0"></label></div><button class="btn ghost sm" type="button" id="ts-calc">Calculer et reporter</button></div></details></div>' +
      '<div class="fs"><b>Juste valeur</b><label class="field"><span>Juste valeur (DT)</span><input id="ts-jv" inputmode="decimal"></label><label class="field"><span>Base de la juste valeur (§58)</span><select id="ts-jvb">' + opt(['Prix sur un marché actif', 'Prix d\'un actif équivalent', 'Autre technique d\'évaluation'], '') + '</select></label></div></div>' +
      '<label class="check" id="ts-chg-box"><input type="checkbox" id="ts-chg"> Les estimations ayant servi à la dernière perte de valeur ont changé (condition d\'une reprise, §63 et §64)</label>' +
      '<label class="field"><span>Conclusion et justification</span><textarea id="ts-motif" rows="2"></textarea></label><div id="ts-prev"></div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="ts-ok">Enregistrer le test</button>',
    mount: (m) => {
      const g = (id) => m.querySelector('#' + id).value;
      const read = () => ({ id: uid(), type: 'test', date: g('ts-date'), valeurUtilite: g('ts-vu') === '' ? '' : r3(num(g('ts-vu'))), justeValeur: g('ts-jv') === '' ? '' : r3(num(g('ts-jv'))), baseJV: g('ts-jvb'), indices: $$('.ts-ind:checked', m).map((x) => x.value), changementEstimations: m.querySelector('#ts-chg').checked, tauxActualisation: g('ts-taux'), motif: g('ts-motif').trim(), pieceCompta: pieceOf(m, 'ts-piece') });
      const upd = () => {
        const ev = read(); const box = m.querySelector('#ts-prev');
        if (!EN.isValidIso(ev.date)) { box.innerHTML = ''; return; }
        const st = stateAtUI(a, ev.date);
        m.querySelector('#ts-chg-box').classList.toggle('hidden', !(st && st.prov > 0));
        const p = previewEvent(a, ev); const r = p.r || {};
        let res = '<div class="result">Renseignez la valeur d\'utilité ou la juste valeur.</div>';
        if (r.resultat === 'perte') res = '<div class="result bad">Perte de valeur de <b>' + money(r.perte) + ' DT</b>' + (r.imputationEcart > 0 ? ', dont ' + money(r.imputationEcart) + ' imputée sur l\'écart de réévaluation et ' + money(r.charge) + ' en charge' : ' en charge (compte ' + esc(S.cfg.comptes.dotProv) + ')') + '. Les dotations futures sont calculées sur la valeur comptable révisée (§62).</div>';
        else if (r.resultat === 'reprise') res = '<div class="result ok">Reprise de <b>' + money(r.reprise) + ' DT</b>, plafonnée à la valeur comptable qui aurait existé sans perte de valeur' + (r.plafond !== null && r.plafond !== undefined ? ' (' + money(r.plafond) + ')' : '') + ' (§66).</div>';
        else if (r.resultat === 'reprise_non_autorisee') res = '<div class="result warn">La valeur récupérable dépasse la valeur comptable, mais une reprise n\'est possible qu\'en cas de changement dans les estimations (§63). Le simple passage du temps ne suffit pas (§65).</div>';
        else if (r.resultat === 'aucune') res = '<div class="result ok">Valeur récupérable supérieure ou égale à la valeur comptable : aucune perte de valeur.</div>';
        box.innerHTML = '<div class="grid-2">' + stateBox(st, ev.date) + '<div class="fs"><b>Résultat du test</b><div class="calc-line"><span>Valeur récupérable retenue</span><b>' + (r.ra !== undefined ? money(r.ra) : '—') + '</b></div>' + res + '</div></div>';
      };
      m.querySelectorAll('input,select,textarea').forEach((i) => { i.addEventListener('input', upd); i.addEventListener('change', upd); });
      m.querySelector('#ts-calc').addEventListener('click', () => {
        const flows = g('ts-flux').split(/\n+/).map((x) => x.trim()).filter(Boolean).map(num);
        if (!flows.length) { toast('Saisissez au moins un flux annuel.', 'bad'); return; }
        m.querySelector('#ts-vu').value = String(EN.dcf(flows, g('ts-taux'), g('ts-sortie'))).replace('.', ',');
        upd();
      });
      upd();
      m.querySelector('#ts-ok').addEventListener('click', async () => {
        const ev = read();
        if (!EN.isValidIso(ev.date) || ev.date < a.dateAcq) { toast('Date du test invalide.', 'bad'); return; }
        if (!EN.has(ev.valeurUtilite) && !EN.has(ev.justeValeur)) { toast('Renseignez la valeur d\'utilité ou la juste valeur.', 'bad'); return; }
        await addEvent(a, ev, 'Test de dépréciation');
      });
    }
  });
};
ACT['ev-reeval'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  reevalModal([a], 'Réévaluer ' + codeTxt(a.code));
};
/** Réévaluation d'un ou plusieurs biens d'une même catégorie (§35 : toute la catégorie simultanément). */
function reevalModal(list, title) {
  const def = EN.exo(S.year, engineCfg()).end;
  const rows = list.map((a) => '<tr><td class="code">' + esc(codeTxt(a.code)) + '</td><td>' + esc(a.designation) + '</td><td class="num rv-ca" data-id="' + esc(a.id) + '"></td><td><input class="rv-jv" data-id="' + esc(a.id) + '" inputmode="decimal" style="min-width:120px"></td><td><input class="rv-vr" data-id="' + esc(a.id) + '" inputmode="decimal" placeholder="inchangée" style="min-width:100px"></td><td><input class="rv-rem" data-id="' + esc(a.id) + '" inputmode="decimal" placeholder="inchangée" style="min-width:90px"></td><td class="num rv-d" data-id="' + esc(a.id) + '"></td></tr>').join('');
  openModal({
    title: title, size: 'wide', sticky: true,
    body: '<div class="form"><div class="note">NC 05 §30 à §41 : la valeur réévaluée est la juste valeur à la date de réévaluation. Les amortissements cumulés sont éliminés contre la valeur brute (§34 b). Une hausse est portée en écart de réévaluation (capitaux propres), sauf reprise d\'une baisse antérieurement constatée en charge ; une baisse est imputée sur l\'écart existant du même bien, le solde en charge (§38 et §39). La valeur résiduelle est réestimée (§48).</div>' +
      '<div class="row"><label class="field"><span>Date de réévaluation</span><input id="re-date" type="date" value="' + esc(def) + '"></label><label class="field"><span>Méthode (§31 et §32)</span><select id="re-meth">' + opt(['Prix de marché', 'Expertise', 'Coût de remplacement net d\'amortissement', 'Approche par le résultat'], 'Expertise') + '</select></label>' +
      '<label class="field"><span>Évaluateur</span><input id="re-eval"></label><label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="re-ind" checked> Évaluateur indépendant</label></div>' +
      '<div class="row"><label class="field" style="grid-column:span 2"><span>Hypothèses significatives (§104)</span><input id="re-hyp" placeholder="Références de marché, état, prix au m², indices…"></label>' + pieceField('re-piece', '', 'Écriture de réévaluation (OD)') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Désignation</th><th class="num">Valeur comptable</th><th>Juste valeur</th><th>Valeur résiduelle</th><th>Durée résiduelle (ans)</th><th class="num">Écart</th></tr></thead><tbody>' + rows + '</tbody></table></div><div id="re-tot" class="note"></div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="re-ok">Enregistrer la réévaluation</button>',
    mount: (m) => {
      const date = () => m.querySelector('#re-date').value;
      const upd = () => {
        let tot = 0, up = 0, down = 0;
        list.forEach((a) => {
          const st = EN.isValidIso(date()) ? stateAtUI(a, date()) : null;
          const caCell = m.querySelector('.rv-ca[data-id="' + a.id + '"]'); caCell.textContent = st ? money(st.ca) : '';
          const jv = m.querySelector('.rv-jv[data-id="' + a.id + '"]').value;
          const dCell = m.querySelector('.rv-d[data-id="' + a.id + '"]');
          if (st && jv !== '') { const d = r3(num(jv) - st.ca); dCell.textContent = money(d); dCell.style.color = d < 0 ? 'var(--bad)' : 'var(--ok)'; tot += d; if (d > 0) up += d; else down -= d; } else dCell.textContent = '';
        });
        m.querySelector('#re-tot').innerHTML = 'Écart total : <b>' + money(tot) + ' DT</b> (hausses ' + money(up) + ', baisses ' + money(down) + '). La répartition entre écart de réévaluation et résultat est calculée bien par bien.';
      };
      m.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', upd)); upd();
      m.querySelector('#re-ok').addEventListener('click', async () => {
        const dt = date();
        if (!EN.isValidIso(dt)) { toast('Date de réévaluation invalide.', 'bad'); return; }
        const todo = list.filter((a) => m.querySelector('.rv-jv[data-id="' + a.id + '"]').value !== '');
        if (!todo.length) { toast('Saisissez au moins une juste valeur.', 'bad'); return; }
        if (todo.length < list.length) { const ok = await confirmBox('Réévaluation partielle', '<p>' + (list.length - todo.length) + ' bien(s) de la catégorie n\'ont pas de juste valeur. La NC 05 (§35) impose de réévaluer simultanément toute la catégorie, sauf réévaluation par roulement sur une courte période.</p>', 'Continuer quand même'); if (!ok) return; }
        const common = { methode: m.querySelector('#re-meth').value, evaluateur: m.querySelector('#re-eval').value.trim(), independant: m.querySelector('#re-ind').checked, hypotheses: m.querySelector('#re-hyp').value.trim(), pieceCompta: pieceOf(m, 're-piece') };
        for (const a of todo) {
          const vr = m.querySelector('.rv-vr[data-id="' + a.id + '"]').value, rem = m.querySelector('.rv-rem[data-id="' + a.id + '"]').value;
          const ev = Object.assign({ id: uid(), type: 'reevaluation', date: dt, justeValeur: r3(num(m.querySelector('.rv-jv[data-id="' + a.id + '"]').value)), vr: vr === '' ? '' : r3(num(vr)), dureeRestante: rem === '' ? '' : num(rem), motif: common.methode }, common);
          const b = clone(a); b.events = (b.events || []).concat([ev]);
          b.history = (b.history || []).concat([{ date: dt, at: nowIso(), action: 'Réévaluation', detail: common.methode + ' – juste valeur ' + money(ev.justeValeur), piece: common.pieceCompta }]);
          if (!(await saveAsset(b, true))) return;
        }
        toast(todo.length + ' bien(s) réévalué(s).', 'ok'); closeModal(); render();
      });
    }
  });
}
ACT['ev-complement'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  openModal({
    title: 'Dépense ultérieure – ' + codeTxt(a.code), sticky: true,
    body: '<div class="form"><div class="note">NC 05 §14 à §17 : une dépense ultérieure est immobilisée seulement si elle augmente les avantages économiques au-delà du niveau de performance initial (prolongation de la durée d\'utilité, hausse de capacité, amélioration substantielle de la qualité, réduction substantielle des coûts). L\'entretien et les réparations courantes restent en charges (§16). Le remplacement d\'une pièce majeure se traite comme un composant (§18).</div>' +
      '<div class="row"><label class="field"><span>Date</span><input id="cp-date" type="date" value="' + EN.today() + '"></label><label class="field"><span>Montant immobilisé (DT)</span><input id="cp-mt" inputmode="decimal"></label>' +
      '<label class="field"><span>Nature de l\'amélioration</span><select id="cp-nat">' + opt(['Prolongation de la durée d\'utilité', 'Accroissement de capacité', 'Amélioration substantielle de la qualité', 'Réduction substantielle des coûts d\'exploitation'], '') + '</select></label>' +
      '<label class="field"><span>Nouvelle durée résiduelle (années)</span><input id="cp-rem" inputmode="decimal" placeholder="inchangée"></label></div>' +
      '<div class="row"><label class="field" style="grid-column:span 2"><span>Libellé et justificatif</span><input id="cp-lib" placeholder="Rénovation du moteur – facture F-123"></label>' + pieceField('cp-piece', '', 'Écriture d\'immobilisation de la dépense') + '</div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="cp-ok">Immobiliser la dépense</button>',
    mount: (m) => m.querySelector('#cp-ok').addEventListener('click', async () => {
      const ev = { id: uid(), type: 'complement', date: m.querySelector('#cp-date').value, montant: r3(num(m.querySelector('#cp-mt').value)), nature: m.querySelector('#cp-nat').value, dureeRestante: m.querySelector('#cp-rem').value === '' ? '' : num(m.querySelector('#cp-rem').value), libelle: m.querySelector('#cp-lib').value.trim(), pieceCompta: pieceOf(m, 'cp-piece') };
      if (!EN.isValidIso(ev.date) || ev.date < a.dateAcq) { toast('Date invalide.', 'bad'); return; }
      if (!(ev.montant > 0)) { toast('Indiquez un montant positif.', 'bad'); return; }
      const st = stateAtUI(a, ev.date);
      if (st && ['L', 'A', 'D'].includes(st.mode) && st.rem <= 0.01 && !EN.has(ev.dureeRestante)) { toast('Le bien est arrivé au terme de sa durée : indiquez la nouvelle durée résiduelle.', 'bad'); return; }
      ev.motif = ev.nature + (ev.libelle ? ' – ' + ev.libelle : '');
      await addEvent(a, ev, 'Dépense ultérieure immobilisée');
    })
  });
};
ACT['ev-composant'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  const comps = S.assets.filter((x) => x.parentId === a.id && !x.sortie);
  const ask = () => assetForm(null, { parentId: a.id, categorie: a.categorie, emplacement: a.emplacement, designation: '', dateAcq: EN.today(), entree: 'achat' });
  if (!comps.length) return ask();
  openModal({
    title: 'Ajouter un composant', size: 'narrow',
    body: '<div class="form"><p style="margin:0">Le nouveau composant remplace-t-il un composant existant ? Si oui, l\'ancien est sorti à la date de mise en service du nouveau, pour sa valeur comptable (NC 05 §18 et §79).</p><label class="field"><span>Composant remplacé</span><select id="cpn-rep"><option value="">Aucun (ajout)</option>' + comps.map((c) => '<option value="' + esc(c.id) + '">' + esc(codeTxt(c.code) + ' – ' + c.designation) + '</option>').join('') + '</select></label></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="cpn-ok">Continuer</button>',
    mount: (m) => m.querySelector('#cpn-ok').addEventListener('click', () => {
      const rep = m.querySelector('#cpn-rep').value; closeModal();
      const old = rep ? assetById(rep) : null;
      assetForm(null, { parentId: a.id, categorie: old ? old.categorie : a.categorie, emplacement: a.emplacement, designation: old ? old.designation + ' (remplacement)' : '', dateAcq: EN.today(), entree: 'achat', _remplace: rep || null });
    })
  });
};
ACT['ev-dem'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  openModal({
    title: 'Révision de la provision pour démantèlement', size: 'narrow', sticky: true,
    body: '<div class="form"><div class="note">NC 05 §94 à §98 : sous le modèle du coût, la variation de l\'estimation est ajoutée au coût de l\'actif ou en est déduite ; une baisse supérieure à la valeur comptable est constatée en produit. La désactualisation reste en charges financières (§99).</div><label class="field"><span>Date</span><input id="dm-date" type="date" value="' + esc(EN.exo(S.year, engineCfg()).end) + '"></label><label class="field"><span>Nouvelle valeur actualisée de l\'obligation (DT)</span><input id="dm-mt" inputmode="decimal"></label>' + pieceField('dm-piece', '', 'Écriture d\'ajustement de la provision') + '<div id="dm-prev"></div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="dm-ok">Enregistrer</button>',
    mount: (m) => {
      const upd = () => { const d = m.querySelector('#dm-date').value; const st = EN.isValidIso(d) ? stateAtUI(a, d) : null; m.querySelector('#dm-prev').innerHTML = st ? '<div class="calc-line"><span>Provision à cette date</span><b>' + money(st.provDem) + '</b></div><div class="calc-line"><span>Valeur comptable du bien</span><b>' + money(st.ca) + '</b></div>' : ''; };
      m.querySelectorAll('input').forEach((i) => i.addEventListener('input', upd)); upd();
      m.querySelector('#dm-ok').addEventListener('click', async () => {
        const ev = { id: uid(), type: 'demantelement', date: m.querySelector('#dm-date').value, montant: r3(num(m.querySelector('#dm-mt').value)), motif: 'Nouvelle estimation', pieceCompta: pieceOf(m, 'dm-piece') };
        if (!EN.isValidIso(ev.date)) { toast('Date invalide.', 'bad'); return; }
        await addEvent(a, ev, 'Révision de la provision pour démantèlement');
      });
    }
  });
};
ACT['ev-mes'] = (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  const targets = cats().filter((c) => !c.enCours && c.type === (catOf(a.categorie) || {}).type);
  openModal({
    title: 'Mise en service – ' + codeTxt(a.code), sticky: true,
    body: '<div class="form"><div class="note">L\'immobilisation en cours est virée au compte définitif et commence à s\'amortir à sa mise en service. Le code d\'origine est conservé.</div><div class="row"><label class="field"><span>Date de mise en service</span><input id="ms-date" type="date" value="' + EN.today() + '"></label><label class="field"><span>Catégorie définitive</span><select id="ms-cat">' + targets.map((c) => '<option value="' + esc(c.code) + '">' + esc(c.code + ' – ' + c.libelle) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Mode</span><select id="ms-mode"></select></label><label class="field"><span>Durée d\'utilité (années)</span><input id="ms-duree" inputmode="decimal"></label>' + pieceField('ms-piece', '', 'Écriture de virement du compte d\'immobilisation en cours') + '</div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="ms-ok">Mettre en service</button>',
    mount: (m) => {
      const upd = () => { const c = catOf(m.querySelector('#ms-cat').value) || {}; m.querySelector('#ms-mode').innerHTML = modeChoices(c).map((k) => '<option value="' + k + '">' + esc(EN.MODES[k]) + '</option>').join(''); const dd = EN.catDuration(c, engineCfg()); m.querySelector('#ms-duree').value = dd ? String(EN.normYears(dd)).replace('.', ',') : ''; };
      m.querySelector('#ms-cat').addEventListener('change', upd); upd();
      m.querySelector('#ms-ok').addEventListener('click', async () => {
        const date = m.querySelector('#ms-date').value, vers = m.querySelector('#ms-cat').value;
        if (!EN.isValidIso(date) || date < a.dateAcq) { toast('Date de mise en service invalide.', 'bad'); return; }
        const b = clone(a);
        b.events = (b.events || []).concat([{ id: uid(), type: 'transfert', date: date, de: a.categorie, vers: vers, motif: 'Mise en service', pieceCompta: pieceOf(m, 'ms-piece') }]);
        b.categorie = vers; b.dateMES = date; b.mode = m.querySelector('#ms-mode').value; b.duree = m.querySelector('#ms-duree').value === '' ? '' : num(m.querySelector('#ms-duree').value);
        b.history = (b.history || []).concat([{ date: date, at: nowIso(), action: 'Mise en service', detail: catLabel(a.categorie) + ' → ' + catLabel(vers), piece: pieceOf(m, 'ms-piece') }]);
        if (await saveAsset(b, true)) { toast('Mise en service enregistrée.', 'ok'); closeModal(); render(); }
      });
    }
  });
};

/* ---------------- Sorties (NC 05 §75 à §81) ---------------- */
ACT['sortie-new'] = (el) => sortieForm(assetById(el.dataset.id));
function sortieForm(a, preset) {
  if (!a) return;
  const cat = catOf(a.categorie) || {};
  const types = S.cfg.sorties || EN.DEFAULT_SORTIES;
  const pz = preset || {};
  openModal({
    title: 'Sortie de ' + codeTxt(a.code), size: 'wide', sticky: true,
    body: '<div class="form"><p style="margin:0"><b>' + esc(a.designation) + '</b> · coût ' + money(a.valeur) + ' DT · mis en service le ' + fdate(a.dateMES || a.dateAcq) + '</p>' +
      '<div class="row"><label class="field"><span>Nature de la sortie</span><select id="so-type">' + opt(types, pz.type || types[0]) + '</select></label><label class="field"><span>Date de sortie</span><input id="so-date" type="date" value="' + esc(pz.date || EN.today()) + '"><small>Date du transfert du contrôle (§78)</small></label>' +
      '<label class="field"><span>Prix de cession HT (DT)</span><input id="so-prix" inputmode="decimal" value="' + esc(pz.prix || '') + '"><small>Paiement différé : prix comptant équivalent (§81)</small></label><label class="field"><span>Indemnité d\'assurance (DT)</span><input id="so-ind" inputmode="decimal" value=""><small>En résultat lorsqu\'elle devient exigible (§73)</small></label></div>' +
      '<div class="row"><label class="field"><span>Acquéreur / assureur</span><input id="so-tiers"></label><label class="field"><span>Justificatif (facture de vente, PV de rebut, déclaration de vol)</span><input id="so-piece" value="' + esc(pz.piece || '') + '"></label>' + pieceField('so-pc', pz.pieceCompta, 'Écriture de sortie (OD)') + '</div>' +
      '<label class="field"><span>Motif / constat</span><textarea id="so-motif" rows="2">' + esc(pz.motif || '') + '</textarea></label>' +
      '<div id="so-calc"></div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="so-ok">Enregistrer la sortie</button>',
    mount: (m) => {
      const read = () => ({ type: m.querySelector('#so-type').value, date: m.querySelector('#so-date').value, prix: r3(num(m.querySelector('#so-prix').value)), indemnite: r3(num(m.querySelector('#so-ind').value)), tiers: m.querySelector('#so-tiers').value.trim(), piece: m.querySelector('#so-piece').value.trim(), pieceCompta: pieceOf(m, 'so-pc'), motif: m.querySelector('#so-motif').value.trim() });
      const upd = () => {
        const so = read(); const box = m.querySelector('#so-calc');
        if (!EN.isValidIso(so.date) || so.date < a.dateAcq) { box.innerHTML = '<div class="note bad">La date de sortie doit être postérieure à la date d\'acquisition.</div>'; return; }
        const sc = EN.sortieCalc(a, cat, engineCfg(), so);
        const K = S.cfg.comptes, ac = EN.catAccounts(cat);
        const lines = [];
        if (sc.cumul > 0) lines.push([ac.amort, 'Amortissements cumulés', sc.cumul, 0]);
        if (sc.prov > 0) lines.push([ac.prov, 'Pertes de valeur cumulées', sc.prov, 0]);
        if (sc.prix > 0) lines.push([K.creanceCession, 'Créance sur cession', sc.prix, 0]);
        if (sc.indemnite > 0) lines.push([K.indemnite, 'Indemnité d\'assurance', sc.indemnite, 0]);
        if (sc.resCompta < 0) lines.push([K.cessionCharge, 'Charge nette sur cession', -sc.resCompta, 0]);
        lines.push([ac.immo, 'Valeur brute sortie', 0, sc.gross]);
        if (sc.resCompta > 0) lines.push([K.cessionProduit, 'Produit net sur cession', 0, sc.resCompta]);
        if (sc.ecartVire > 0) { lines.push([K.ecartReeval, 'Écart de réévaluation réalisé', sc.ecartVire, 0]); lines.push([K.resultatsReportes, 'Virement aux résultats reportés (§40)', 0, sc.ecartVire]); }
        if (sc.subRest > 0) { lines.push([K.subvention, 'Solde de subvention', sc.subRest, 0]); lines.push([K.quotePartSub, 'Quote-part de subvention virée', 0, sc.subRest]); }
        box.innerHTML = '<div class="grid-2"><div class="fs"><b>Calcul à la date de sortie</b>' +
          '<div class="calc-line"><span>Dotation complémentaire ' + sc.exitYear + '</span><b>' + money(sc.dotComplementaire) + '</b></div><div class="calc-line"><span>Valeur brute</span><b>' + money(sc.gross) + '</b></div><div class="calc-line"><span>Amortissements cumulés</span><b>' + money(sc.cumul) + '</b></div>' + (sc.prov ? '<div class="calc-line"><span>Pertes de valeur cumulées</span><b>' + money(sc.prov) + '</b></div>' : '') +
          '<div class="calc-line"><span>Valeur comptable</span><b>' + money(sc.vnc) + '</b></div><div class="calc-line"><span>Produit net de sortie</span><b>' + money(sc.produit) + '</b></div>' +
          '<div class="calc-line total"><span>' + (sc.resCompta >= 0 ? 'Profit' : 'Perte') + ' de sortie (§80)</span><b style="color:' + (sc.resCompta < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + money(Math.abs(sc.resCompta)) + '</b></div>' +
          (S.cfg.modules.fiscal ? '<div class="calc-line"><span>Valeur fiscale résiduelle</span><b>' + money(sc.vncFiscal) + '</b></div><div class="calc-line"><span>Résultat fiscal</span><b>' + money(sc.resFiscal) + '</b></div><div class="calc-line"><span>' + (sc.ajustFiscal >= 0 ? 'Réintégration' : 'Déduction') + ' au tableau de passage</span><b>' + money(Math.abs(sc.ajustFiscal)) + '</b></div>' : '') +
          ((a.events || []).some((ev) => ev.date > so.date) ? '<div class="note warn">Des événements d\'évaluation sont datés après la sortie : ils resteront sans effet.</div>' : '') +
          (sc.provDem > 0 ? '<div class="note">Provision pour démantèlement de ' + money(sc.provDem) + ' DT : à maintenir tant que l\'obligation subsiste, ou à reprendre si elle est transférée à l\'acquéreur.</div>' : '') + '</div>' +
          '<div class="fs"><b>Écriture de sortie</b><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Compte</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th></tr></thead><tbody>' +
          lines.map((l) => '<tr><td class="code">' + esc(l[0] || '') + '</td><td>' + esc(l[1]) + '</td><td class="num">' + (l[2] ? money(l[2]) : '') + '</td><td class="num">' + (l[3] ? money(l[3]) : '') + '</td></tr>').join('') + '</tbody></table></div><small class="muted">Passer au préalable la dotation complémentaire (6811 / 28). Vérifier la régularisation éventuelle de la TVA déduite.</small></div></div>';
      };
      m.querySelectorAll('input,select,textarea').forEach((i) => i.addEventListener('input', upd));
      m.querySelector('#so-type').addEventListener('change', upd);
      upd();
      m.querySelector('#so-ok').addEventListener('click', async () => {
        const so = read();
        if (!EN.isValidIso(so.date) || so.date < a.dateAcq) { toast('Date de sortie invalide.', 'bad'); return; }
        const b = clone(a);
        b.sortie = Object.assign(so, { at: nowIso() });
        b.history = (b.history || []).concat([{ date: so.date, at: nowIso(), action: 'Sortie', detail: so.type + (so.prix ? ' – prix ' + money(so.prix) : ''), piece: so.pieceCompta }]);
        if (await saveAsset(b, true)) { toast('Sortie enregistrée.', 'ok'); closeModal(); if (!preset) go('asset', b.id); else render(); }
      });
    }
  });
}
ACT['sortie-cancel'] = async (el) => {
  const a = assetById(el.dataset.id); if (!a) return;
  const ok = await confirmBox('Annuler la sortie', '<p>Le bien redeviendra « en service » et la sortie du ' + fdate(a.sortie.date) + ' sera effacée.</p>', 'Annuler la sortie', true);
  if (!ok) return;
  const b = clone(a); b.history = (b.history || []).concat([{ date: EN.today(), at: nowIso(), action: 'Annulation de sortie', detail: a.sortie.type + ' du ' + fdate(a.sortie.date) }]); delete b.sortie;
  if (await saveAsset(b, true)) { toast('Sortie annulée.', 'ok'); render(); }
};

TITLES.sorties = { title: 'Sorties d\'immobilisations', year: true, tenant: true };
VIEWS.sorties = function () {
  const y = S.year, E = EN.exo(y, engineCfg());
  const list = S.assets.filter((a) => a.sortie && a.sortie.date >= E.start && a.sortie.date <= E.end).sort((a, b) => a.sortie.date.localeCompare(b.sortie.date));
  const t = { base: 0, am: 0, vnc: 0, prod: 0, rc: 0, rf: 0 };
  const fisc = S.cfg.modules.fiscal;
  const rows = list.map((a) => {
    const sc = EN.sortieCalc(a, catOf(a.categorie) || {}, engineCfg());
    t.base += sc.gross; t.am += sc.cumul + sc.prov; t.vnc += sc.vnc; t.prod += sc.produit; t.rc += sc.resCompta; t.rf += sc.resFiscal;
    return '<tr class="click" data-act="asset-open" data-id="' + esc(a.id) + '"><td>' + fdate(a.sortie.date) + '</td><td class="code">' + esc(codeTxt(a.code)) + '</td><td>' + esc(a.designation) + '</td><td>' + esc(a.sortie.type) + '</td><td class="num">' + money(sc.gross) + '</td><td class="num">' + money(sc.cumul + sc.prov) + '</td><td class="num">' + money(sc.vnc) + '</td><td class="num">' + money(sc.produit) + '</td><td class="num" style="color:' + (sc.resCompta < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + money(sc.resCompta) + '</td>' + (fisc ? '<td class="num">' + money(sc.resFiscal) + '</td>' : '') + '</tr>';
  }).join('');
  const actives = S.assets.filter((a) => !a.sortie);
  return '<div class="page-head"><div><h2>Sorties de l\'exercice ' + esc(EN.exoLabel(y, engineCfg())) + '</h2><p>Cessions, mises au rebut, vols, pertes, sinistres et remplacements de composants. Chaque sortie calcule la dotation complémentaire, la valeur comptable, le profit ou la perte (§80) et le résultat fiscal.</p></div>' +
    '<div class="actions"><button class="btn ghost" data-act="rep-quick" data-rep="sorties">' + icon('dl') + 'Exporter</button><button class="btn" data-act="sortie-pick"' + (actives.length ? '' : ' disabled') + '>' + icon('out') + 'Nouvelle sortie</button></div></div>' +
    '<div class="panel">' + (list.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Code</th><th>Désignation</th><th>Nature</th><th class="num">Valeur brute</th><th class="num">Amort. et pertes</th><th class="num">VNC</th><th class="num">Produit de sortie</th><th class="num">Résultat comptable</th>' + (fisc ? '<th class="num">Résultat fiscal</th>' : '') + '</tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td colspan="4">Total (' + list.length + ')</td><td class="num">' + money(t.base) + '</td><td class="num">' + money(t.am) + '</td><td class="num">' + money(t.vnc) + '</td><td class="num">' + money(t.prod) + '</td><td class="num">' + money(t.rc) + '</td>' + (fisc ? '<td class="num">' + money(t.rf) + '</td>' : '') + '</tr></tfoot></table></div>'
      : '<div class="empty"><b>Aucune sortie sur cet exercice.</b><span>Choisissez un bien à sortir du patrimoine, ou changez d\'exercice en haut de l\'écran.</span></div>') + '</div>';
};
ACT['sortie-pick'] = () => {
  const actives = S.assets.filter((a) => !a.sortie);
  openModal({
    title: 'Choisir le bien à sortir', size: 'narrow',
    body: '<div class="form"><label class="field"><span>Code ou désignation</span><input id="sp-q" autofocus placeholder="Scannez ou saisissez un code"></label><label class="field"><span>Bien</span><select id="sp-sel" size="8">' + actives.map((a) => '<option value="' + esc(a.id) + '">' + esc(codeTxt(a.code) + ' – ' + a.designation) + '</option>').join('') + '</select></label></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="sp-ok">Continuer</button>',
    mount: (m) => {
      const q = m.querySelector('#sp-q'), s = m.querySelector('#sp-sel');
      q.addEventListener('input', () => {
        const v = q.value.toLowerCase(), c = EN.normCode(q.value);
        Array.from(s.options).forEach((o) => { const a = actives.find((x) => x.id === o.value); o.hidden = !!v && !(a.designation.toLowerCase().includes(v) || (c && a.code.includes(c))); });
        const first = Array.from(s.options).find((o) => !o.hidden); if (first) s.value = first.value;
      });
      m.querySelector('#sp-ok').addEventListener('click', () => { const id = s.value; if (!id) return; closeModal(); sortieForm(assetById(id)); });
    }
  });
};

/* ==========================================================================
   Évaluation NC 05 : revue annuelle, tests de dépréciation, réévaluations,
   provisions pour démantèlement et subventions
   ========================================================================== */
TITLES.eval = { title: 'Évaluation NC 05', year: true, tenant: true };
ACT['eval-tab'] = (el) => { S.ui.evalTab = el.dataset.tab; if (S.view !== 'eval') go('eval'); else render(); };

function evalYear() { const t = S.tenant; t.evaluation = t.evaluation || {}; t.evaluation[S.year] = t.evaluation[S.year] || {}; return t.evaluation[S.year]; }
function inServiceAt(isoEnd) { return S.assets.filter((a) => a.dateAcq <= isoEnd && !(a.sortie && a.sortie.date <= isoEnd)); }
function pickAsset(title, filter, cb, emptyMsg) {
  const list = S.assets.filter(filter).sort((p, q) => String(p.code).localeCompare(String(q.code)));
  if (!list.length) { toast(emptyMsg || 'Aucune immobilisation en service à la clôture de l\'exercice ' + EN.exoLabel(S.year, engineCfg()) + '.', 'bad'); return; }
  openModal({
    title: title, size: 'narrow',
    body: '<div class="form"><label class="field"><span>Code ou désignation</span><input id="pk-q" autofocus placeholder="Scannez ou saisissez un code"></label><label class="field"><span>Bien</span><select id="pk-sel" size="8">' + list.map((a) => '<option value="' + esc(a.id) + '">' + esc(codeTxt(a.code) + ' – ' + a.designation) + '</option>').join('') + '</select></label></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="pk-ok">Continuer</button>',
    mount: (m) => {
      const q = m.querySelector('#pk-q'), s = m.querySelector('#pk-sel');
      s.value = list[0].id;
      q.addEventListener('input', () => {
        const v = q.value.toLowerCase(), c = EN.normCode(q.value);
        Array.from(s.options).forEach((o) => { const a = list.find((x) => x.id === o.value); o.hidden = !!v && !(a.designation.toLowerCase().includes(v) || (c && a.code.includes(c))); });
        const first = Array.from(s.options).find((o) => !o.hidden); if (first) s.value = first.value;
      });
      m.querySelector('#pk-ok').addEventListener('click', () => { const id = s.value; if (!id) return; closeModal(); cb(assetById(id)); });
    }
  });
}

VIEWS.eval = function () {
  const tab = S.ui.evalTab || 'revue';
  const y = S.year, cfg = engineCfg(), E = EN.exo(y, cfg);
  const ev = evalYear();
  const tabs = [['revue', 'Revue annuelle'], ['tests', 'Tests de dépréciation'], ['reeval', 'Réévaluations'], ['autres', 'Démantèlement et subventions']];
  const enService = inServiceAt(E.end);
  const testsY = [];
  S.assets.forEach((a) => { sched(a).events.filter((e) => e.type === 'test' && e.year === y).forEach((e) => testsY.push({ a: a, e: e })); });
  testsY.sort((p, q) => String(p.e.date).localeCompare(String(q.e.date)));
  const dueR = reevalDue(y);
  const ind0 = ev.indices || {}, rev0 = ev.revue || {};
  const stp = (ok, lab, val, tabKey) => '<button class="step-card ' + (ok === true ? 'ok' : ok === false ? 'todo' : '') + '" data-act="eval-tab" data-tab="' + tabKey + '"><span>' + esc(lab) + '</span><b>' + esc(val) + '</b></button>';
  const strip = '<div class="step-strip">' +
    stp(!!ind0.date, '1. Indices de perte de valeur', ind0.date ? (ind0.conclusion === 'indices' ? 'Indices relevés' : 'Aucun indice') + ' · ' + fdate(ind0.date) : 'À documenter', 'revue') +
    stp(!!rev0.date, '2. Revue des estimations', rev0.date ? 'Revue du ' + fdate(rev0.date) : 'À réaliser', 'revue') +
    stp(ind0.conclusion === 'indices' ? testsY.length > 0 : null, '3. Tests de dépréciation', testsY.length ? testsY.length + ' test(s) sur l\'exercice' : (ind0.conclusion === 'indices' ? 'Tests à réaliser' : 'Non requis sans indice'), 'tests') +
    stp(cats().some((c) => c.modele === 'reevaluation' && c.type !== 'I') ? !dueR.length : null, '4. Réévaluations', cats().some((c) => c.modele === 'reevaluation' && c.type !== 'I') ? (dueR.length ? dueR.length + ' catégorie(s) à réévaluer' : 'À jour') : 'Modèle du coût', 'reeval') +
    '</div>';
  let h = '';
  if (tab === 'revue') {
    const ind = ev.indices || {};
    const rev = ev.revue || {};
    const inService = enService;
    const byCat = {};
    inService.forEach((a) => { const k = a.categorie; byCat[k] = byCat[k] || []; byCat[k].push(a); });
    h = '<div class="eval-stack"><div class="fs"><b>1. Indices de perte de valeur (§55 et §57)</b><p class="muted" style="margin:0">À la clôture, la direction apprécie s\'il existe des circonstances laissant penser que la valeur comptable des immobilisations ne sera pas recouvrée. Le test n\'est requis qu\'en présence d\'indices : les biens concernés sont alors testés dans l\'onglet « Tests de dépréciation » (§58).</p>' +
      '<div class="ind-grid">' + Object.keys(EN.INDICES).map((k) => '<label class="check"><input type="checkbox" class="ri-ind" value="' + k + '"' + chk((ind.items || []).includes(k)) + '> ' + esc(EN.INDICES[k]) + '</label>').join('') + '</div>' +
      '<label class="field"><span>Biens ou activités concernés</span><textarea id="ri-biens" rows="2">' + esc(ind.biens || '') + '</textarea></label>' +
      '<div class="row"><label class="field"><span>Conclusion</span><select id="ri-conc">' + opt([{ v: 'aucun', l: 'Aucun indice relevé' }, { v: 'indices', l: 'Indices relevés' }], ind.conclusion || 'aucun') + '</select></label><label class="field"><span>Date de la revue</span><input id="ri-date" type="date" value="' + esc(ind.date || E.end) + '"></label><label class="field"><span>Responsable</span><input id="ri-resp" value="' + esc(ind.responsable || '') + '"></label></div>' +
      '<div class="actions"><button class="btn" data-act="ri-save">Enregistrer la revue des indices</button>' + (ind.date ? '<span class="pill ok">Documentée le ' + fdate(ind.date) + '</span>' : '<span class="pill warn">Non documentée</span>') + '</div></div>' +
      '<div class="fs"><b>2. Revue des estimations (§51 à §54)</b><p class="muted" style="margin:0">Durées d\'utilité, valeurs résiduelles et modes d\'amortissement sont revus au moins à chaque clôture. Une modification est enregistrée sur la fiche du bien (« Réviser les estimations ») et traitée de manière prospective (NC 11).</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Catégorie</th><th class="num">Biens</th><th>Durée retenue</th><th>Revue</th><th></th></tr></thead><tbody>' +
      (inService.length ? '' : '<tr><td colspan="5" class="muted">Aucune immobilisation en service au ' + fdate(E.end) + ' : la revue porte sur les biens enregistrés au registre.</td></tr>') +
      Object.keys(byCat).sort().map((k) => { const c = catOf(k) || {}; const r = (rev.categories || {})[k] || {}; return '<tr><td>' + esc(catLabel(k)) + '</td><td class="num">' + byCat[k].length + '</td><td>' + esc(c.amortissable ? yrs(EN.catDuration(c, cfg)) : 'non amortissable') + '</td><td><div class="rr-cell"><label class="check"><input type="checkbox" class="rr-ok" data-cat="' + esc(k) + '"' + chk(r.ok) + '> sans changement</label><input class="rr-com" data-cat="' + esc(k) + '" value="' + esc(r.commentaire || '') + '" placeholder="Commentaire" aria-label="Commentaire ' + esc(k) + '"></div></td><td><button class="btn ghost sm" data-act="rr-revise" data-cat="' + esc(k) + '">Réviser un bien</button></td></tr>'; }).join('') +
      '</tbody></table></div><div class="row"><label class="field"><span>Date de la revue</span><input id="rr-date" type="date" value="' + esc(rev.date || E.end) + '"></label><label class="field"><span>Commentaire général</span><input id="rr-com-g" value="' + esc(rev.commentaire || '') + '"></label></div>' +
      '<div class="actions"><button class="btn" data-act="rr-save">Enregistrer la revue des estimations</button>' + (rev.date ? '<span class="pill ok">Revue du ' + fdate(rev.date) + '</span>' : '<span class="pill warn">Non réalisée</span>') + '</div></div></div>';
  } else if (tab === 'tests') {
    const tests = testsY;
    const suspects = enService.filter((a) => ['Mauvais', 'Hors service', 'Temporairement inutilisé'].includes(a.etat));
    const ind = ev.indices || {};
    h = '<div class="panel-head"><div class="muted">Tests réalisés sur l\'exercice ' + esc(EN.exoLabel(y, cfg)) + ' · ' + enService.length + ' immobilisation(s) en service au ' + fdate(E.end) + '</div><button class="btn" data-act="tst-new"' + (enService.length ? '' : ' disabled title="Aucune immobilisation en service à la clôture"') + '>' + icon('plus') + 'Nouveau test</button></div>' +
      (ind.conclusion === 'indices' ? '<div class="note warn" style="margin-bottom:12px"><b>Indices relevés le ' + fdate(ind.date) + '</b> : ' + esc((ind.items || []).map((k) => (EN.INDICES[k] || k).replace(/ \(§57 .\)/, '')).join(' ; ') || 'voir la revue') + (ind.biens ? '<br>Biens ou activités concernés : ' + esc(ind.biens) : '') + '</div>' : '') +
      (tests.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Code</th><th>Désignation</th><th class="num">Valeur comptable</th><th class="num">Valeur récupérable</th><th>Base</th><th>Résultat</th><th class="num">Montant</th></tr></thead><tbody>' +
        tests.map((t) => '<tr class="click" data-act="asset-open" data-id="' + esc(t.a.id) + '"><td>' + fdate(t.e.date) + '</td><td class="code">' + esc(codeTxt(t.a.code)) + '</td><td>' + esc(t.a.designation) + '</td><td class="num">' + money(t.e.ca) + '</td><td class="num">' + (t.e.ra !== undefined ? money(t.e.ra) : '—') + '</td><td>' + (t.e.baseRA === 'vu' ? 'Valeur d\'utilité' : t.e.baseRA === 'jv' ? 'Juste valeur' : '') + '</td><td>' + ({ perte: '<span class="pill bad">Perte de valeur</span>' + (t.e.imputationEcart > 0 ? '<div class="muted" style="font-size:11.5px;margin-top:3px">dont ' + money(t.e.imputationEcart) + ' sur l\'écart de réévaluation</div>' : ''), reprise: '<span class="pill ok">Reprise</span>', aucune: '<span class="pill ok">Aucune perte</span>', reprise_non_autorisee: '<span class="pill warn">Reprise non autorisée</span>', incomplet: '<span class="pill warn">Incomplet</span>' }[t.e.resultat] || '') + '</td><td class="num">' + money(t.e.perte || t.e.reprise || 0) + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="empty"><b>Aucun test de dépréciation sur cet exercice.</b><span>' + (!enService.length ? 'Aucune immobilisation n\'est en service au ' + fdate(E.end) + ' : enregistrez d\'abord les immobilisations de la société, puis revenez ici pour les tester.' : ind.conclusion === 'indices' ? 'Des indices ont été relevés : testez les biens concernés avec « Nouveau test ».' : 'Un test n\'est nécessaire qu\'en présence d\'indices de perte de valeur (§55). Documentez d\'abord la revue des indices dans l\'onglet « Revue annuelle ».') + '</span>' + (!enService.length ? '<button class="btn" data-act="asset-new">' + icon('plus') + 'Nouvelle immobilisation</button>' : ind.date ? '' : '<button class="btn ghost" data-act="eval-tab" data-tab="revue">Faire la revue des indices</button>') + '</div>') +
      (suspects.length ? '<div class="fs" style="margin-top:14px"><b>Biens dont l\'état peut constituer un indice</b><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Désignation</th><th>État</th><th></th></tr></thead><tbody>' + suspects.map((a) => '<tr><td class="code">' + esc(codeTxt(a.code)) + '</td><td>' + esc(a.designation) + '</td><td>' + esc(a.etat) + '</td><td><button class="btn ghost sm" data-act="ev-test" data-id="' + esc(a.id) + '">Tester</button></td></tr>').join('') + '</tbody></table></div></div>' : '');
  } else if (tab === 'reeval') {
    const rc = cats().filter((c) => c.modele === 'reevaluation' && c.type !== 'I');
    if (!rc.length) h = '<div class="empty"><b>Toutes les catégories suivent le modèle du coût.</b><span>Pour appliquer le modèle de la réévaluation à une catégorie entière (§28), choisissez-le dans Paramètres société → Catégories, colonne « Modèle ». Les immobilisations incorporelles restent au modèle du coût (NC 06).</span><button class="btn ghost" data-act="env-tab" data-tab="cat">Ouvrir les catégories</button></div>';
    else {
      h = '<p class="muted" style="margin:0 0 12px">Les réévaluations sont assez régulières pour que la valeur comptable ne diffère pas significativement de la juste valeur à la clôture (§30) : chaque année pour les biens volatils, tous les trois à cinq ans sinon (§33). Toute la catégorie est réévaluée simultanément (§35).</p><div class="status-grid">' +
        rc.map((c) => {
          const list = enService.filter((a) => a.categorie === c.code);
          let last = null; let surplus = 0;
          list.forEach((a) => { (a.events || []).forEach((e) => { if (e.type === 'reevaluation' && e.date <= E.end && (!last || e.date > last)) last = e.date; }); surplus += EN.yearValues(a, sched(a), y, cfg).ecartFin; });
          const since = last ? (EN.dn(E.end) - EN.dn(last)) / 365.25 : null;
          const due = !last || since > num(c.frequenceReeval || 5) + 0.01;
          return '<div class="status-card"><h4>' + esc(c.code + ' – ' + c.libelle) + '</h4><div class="calc-line"><span>Biens en service</span><b>' + list.length + '</b></div><div class="calc-line"><span>Dernière réévaluation</span><b>' + (last ? fdate(last) : 'jamais') + '</b></div><div class="calc-line"><span>Fréquence retenue</span><b>' + esc(c.frequenceReeval || 5) + ' an(s)</b></div><div class="calc-line"><span>Écart de réévaluation</span><b>' + money(surplus) + '</b></div>' +
            (due ? '<span class="pill warn">Réévaluation à réaliser</span>' : '<span class="pill ok">À jour</span>') + '<button class="btn sm" data-act="re-cat" data-cat="' + esc(c.code) + '"' + (list.length ? '' : ' disabled') + '>Réévaluer la catégorie</button></div>';
        }).join('') + '</div>';
    }
  } else {
    const dem = S.assets.filter((a) => a.demantelement).map((a) => ({ a: a, v: EN.yearValues(a, sched(a), y, cfg) })).filter((x) => x.v.exists);
    const sub = S.assets.filter((a) => a.subvention).map((a) => ({ a: a, v: EN.yearValues(a, sched(a), y, cfg) })).filter((x) => x.v.exists);
    h = '<div class="fs"><b>Provisions pour démantèlement et remise en état (§82 à §99)</b>' + (dem.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Désignation</th><th class="num">Provision début</th><th class="num">Désactualisation</th><th class="num">Provision fin</th><th>Taux</th><th>Échéance</th></tr></thead><tbody>' +
      dem.map((x) => { const r = x.v.row; return '<tr class="click" data-act="asset-open" data-id="' + esc(x.a.id) + '"><td class="code">' + esc(codeTxt(x.a.code)) + '</td><td>' + esc(x.a.designation) + '</td><td class="num">' + money(r ? r.provDemDebut : x.a.demantelement.montant) + '</td><td class="num">' + money(r ? r.desact : 0) + '</td><td class="num">' + money(r ? r.provDemFin : x.a.demantelement.montant) + '</td><td>' + esc(String(x.a.demantelement.taux || 0).replace('.', ',')) + ' %</td><td>' + fdate(x.a.demantelement.echeance) + '</td></tr>'; }).join('') + '</tbody></table></div><small class="muted">Désactualisation en charges financières (compte ' + esc(S.cfg.comptes.desactualisation) + ' / ' + esc(S.cfg.comptes.provDemantelement) + ') ; non incorporable au coût (§99).</small>' : '<span class="muted">Aucune obligation de démantèlement enregistrée.</span>') + '</div>' +
      '<div class="fs" style="margin-top:14px"><b>Subventions d\'investissement (NC 12, §27 de la NC 05)</b>' + (sub.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Désignation</th><th class="num">Subvention</th><th class="num">Quote-part de l\'exercice</th><th class="num">Solde à reprendre</th></tr></thead><tbody>' +
      sub.map((x) => { const r = x.v.row; return '<tr class="click" data-act="asset-open" data-id="' + esc(x.a.id) + '"><td class="code">' + esc(codeTxt(x.a.code)) + '</td><td>' + esc(x.a.designation) + '</td><td class="num">' + money(x.a.subvention.montant) + '</td><td class="num">' + money(r ? r.subQP : 0) + '</td><td class="num">' + money(r ? r.subRest : x.a.subvention.montant) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<span class="muted">Aucune subvention enregistrée.</span>') + '</div>';
  }
  return '<div class="page-head"><div><h2>Évaluation postérieure – exercice ' + esc(EN.exoLabel(y, cfg)) + '</h2><p>Tests d\'évaluation périodiques exigés par la NC 05 : revue des indices et des estimations, tests de dépréciation, réévaluations des catégories au modèle de la réévaluation, provisions pour démantèlement.</p></div></div>' +
    strip + '<div class="panel"><div class="tabs">' + tabs.map((x) => '<button class="' + (tab === x[0] ? 'on' : '') + '" data-act="eval-tab" data-tab="' + x[0] + '">' + esc(x[1]) + '</button>').join('') + '</div>' + h + '</div>';
};
ACT['ri-save'] = async () => {
  const ev = evalYear();
  ev.indices = { items: $$('.ri-ind:checked').map((x) => x.value), biens: $('#ri-biens').value.trim(), conclusion: $('#ri-conc').value, date: $('#ri-date').value, responsable: $('#ri-resp').value.trim(), at: nowIso() };
  if (!EN.isValidIso(ev.indices.date)) { toast('Indiquez la date de la revue des indices.', 'bad'); return; }
  if (ev.indices.items.length && ev.indices.conclusion === 'aucun') toast('Des indices sont cochés : la conclusion devrait prévoir des tests.', '');
  if (!ev.indices.items.length && ev.indices.conclusion === 'indices') toast('Conclusion « indices relevés » : cochez les indices constatés.', '');
  if (await saveTenant(true)) { toast('Revue des indices enregistrée.', 'ok'); render(); }
};
ACT['rr-save'] = async () => {
  const ev = evalYear();
  const categories = {};
  $$('.rr-ok').forEach((x) => { const k = x.dataset.cat; categories[k] = { ok: x.checked, commentaire: ($('.rr-com[data-cat="' + k + '"]') || {}).value || '' }; });
  ev.revue = { date: $('#rr-date').value, commentaire: $('#rr-com-g').value.trim(), categories: categories, at: nowIso() };
  if (!EN.isValidIso(ev.revue.date)) { toast('Indiquez la date de la revue des estimations.', 'bad'); return; }
  if (await saveTenant(true)) { toast('Revue des estimations enregistrée.', 'ok'); render(); }
};
ACT['rr-revise'] = (el) => {
  const E = EN.exo(S.year, engineCfg());
  const ids = new Set(inServiceAt(E.end).map((a) => a.id));
  pickAsset('Réviser un bien de la catégorie ' + el.dataset.cat, (a) => ids.has(a.id) && a.categorie === el.dataset.cat, (a) => ACT['ev-revision']({ dataset: { id: a.id } }));
};
ACT['tst-new'] = () => {
  const E = EN.exo(S.year, engineCfg());
  const ids = new Set(inServiceAt(E.end).map((a) => a.id));
  pickAsset('Bien à tester au ' + fdate(E.end), (a) => ids.has(a.id), (a) => ACT['ev-test']({ dataset: { id: a.id } }), 'Aucune immobilisation en service au ' + fdate(E.end) + ' : enregistrez d\'abord les immobilisations de la société.');
};
ACT['re-cat'] = (el) => {
  const c = catOf(el.dataset.cat); if (!c) return;
  const E = EN.exo(S.year, engineCfg());
  const list = inServiceAt(E.end).filter((a) => a.categorie === c.code);
  reevalModal(list, 'Réévaluer la catégorie ' + c.code + ' – ' + c.libelle);
};

/* ==========================================================================
   Inventaires physiques et étiquettes code-barres
   ========================================================================== */
TITLES.inventaires = { title: 'Inventaires physiques' };
VIEWS.inventaires = function () {
  const rows = S.inventories.map((inv) => {
    const r = EN.inventoryResults(inv, S.assets);
    return '<tr class="click" data-act="inv-open" data-id="' + esc(inv.id) + '"><td>' + fdate(inv.date) + '</td><td><b>' + esc(inv.libelle) + '</b></td><td>' + esc(inv.emplacements && inv.emplacements.length ? inv.emplacements.join(', ') : 'Tous') + '</td><td>' + esc(inv.responsable || '') + '</td><td class="num">' + r.attendus + '</td><td class="num">' + r.trouves + '</td><td class="num">' + r.manquants.length + '</td><td class="num">' + r.malLocalises.length + '</td><td>' + (inv.statut === 'cloture' ? '<span class="pill grey">Clôturé</span>' : '<span class="pill warn">En cours</span>') + '</td></tr>';
  }).join('');
  return '<div class="page-head"><div><h2>Campagnes d\'inventaire</h2><p>Rapprochement entre le registre et l\'existant physique : biens trouvés, manquants, mal localisés ou non inscrits. Utilisez une douchette code-barres ou la saisie du code.</p></div><div class="actions"><button class="btn" data-act="inv-new">' + icon('plus') + 'Nouvelle campagne</button></div></div>' +
    '<div class="panel">' + (S.inventories.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Campagne</th><th>Emplacements</th><th>Responsable</th><th class="num">Attendus</th><th class="num">Trouvés</th><th class="num">Manquants</th><th class="num">Mal localisés</th><th>Statut</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty"><b>Aucune campagne d\'inventaire.</b><span>Imprimez d\'abord les étiquettes des biens, puis lancez une campagne par site ou pour toute la société.</span><button class="btn" data-act="inv-new">' + icon('plus') + 'Nouvelle campagne</button></div>') + '</div>';
};
ACT['inv-new'] = () => {
  const y = currentExo();
  openModal({
    title: 'Nouvelle campagne d\'inventaire', size: 'narrow',
    body: '<div class="form"><label class="field"><span>Libellé</span><input id="in-lib" value="Inventaire physique au ' + esc(fdate(EN.exo(y, engineCfg()).end)) + '"></label>' +
      '<label class="field"><span>Date d\'inventaire</span><input id="in-date" type="date" value="' + EN.today() + '"></label><label class="field"><span>Responsable</span><input id="in-resp"></label>' +
      '<div class="field"><span>Emplacements couverts</span><div style="display:grid;gap:6px;max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:9px;padding:8px">' +
      '<label class="check"><input type="checkbox" id="in-all" checked> Tous les emplacements</label>' + emps().map((e) => '<label class="check"><input type="checkbox" class="in-emp" value="' + esc(e.code) + '"> ' + esc(e.code + ' – ' + e.libelle) + '</label>').join('') + '</div></div></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="in-ok">Créer la campagne</button>',
    mount: (m) => {
      const all = m.querySelector('#in-all');
      m.querySelectorAll('.in-emp').forEach((c) => c.addEventListener('change', () => { all.checked = !m.querySelectorAll('.in-emp:checked').length; }));
      all.addEventListener('change', () => { if (all.checked) m.querySelectorAll('.in-emp').forEach((c) => { c.checked = false; }); });
      m.querySelector('#in-ok').addEventListener('click', async () => {
        const inv = { id: uid(), libelle: m.querySelector('#in-lib').value.trim() || 'Inventaire', date: m.querySelector('#in-date').value || EN.today(), responsable: m.querySelector('#in-resp').value.trim(), emplacements: all.checked ? [] : Array.from(m.querySelectorAll('.in-emp:checked')).map((c) => c.value), statut: 'en_cours', lignes: {}, inconnus: [], createdAt: nowIso() };
        try { await Store.set(P.inv(S.tenantId, inv.id), inv); S.inventories.unshift(inv); closeModal(); go('inventaire', inv.id); }
        catch (e) { storeError(e, 'inventaire'); }
      });
    }
  });
};
ACT['inv-open'] = (el) => go('inventaire', el.dataset.id);

let invTimer = null, invDirty = null;
function invSaveSoon(inv) {
  invDirty = inv;
  clearTimeout(invTimer);
  invTimer = setTimeout(flushInv, 900);
}
async function flushInv() {
  clearTimeout(invTimer);
  if (!invDirty) return;
  const inv = invDirty; invDirty = null;
  inv.updatedAt = nowIso();
  try { await Store.set(P.inv(S.tenantId, inv.id), inv); } catch (e) { storeError(e, 'inventaire'); }
}
window.addEventListener('beforeunload', () => { if (invDirty) flushInv(); });

TITLES.inventaire = { title: 'Inventaire physique' };
VIEWS.inventaire = function () {
  const inv = S.inventories.find((x) => x.id === S.arg);
  if (!inv) return '<div class="panel"><div class="empty"><b>Campagne introuvable.</b></div></div>';
  const r = EN.inventoryResults(inv, S.assets);
  const closed = inv.statut === 'cloture';
  const tab = S.ui.invTab || (closed ? 'res' : 'scan');
  S.ui.invEmp = S.ui.invEmp || (inv.emplacements && inv.emplacements[0]) || (emps()[0] || {}).code;
  S.ui.invEtat = S.ui.invEtat || (S.cfg.etats || EN.DEFAULT_ETATS)[0];
  const pct = Math.round(r.taux * 100);
  let content = '';
  if (tab === 'scan' && !closed) {
    const log = (S.ui.invLog || []).slice(-12).reverse().map((l) => '<div><span class="pill ' + l.k + '">' + esc(l.t) + '</span><span class="mono">' + esc(l.code) + '</span><span>' + esc(l.msg) + '</span></div>').join('');
    content = '<div class="grid-2"><div class="form"><div class="row"><label class="field"><span>Emplacement compté</span><select data-change="inv-emp">' + emps().map((e) => '<option value="' + esc(e.code) + '"' + sel(e.code, S.ui.invEmp) + '>' + esc(e.code + ' – ' + e.libelle) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>État constaté</span><select data-change="inv-etat">' + opt(S.cfg.etats || EN.DEFAULT_ETATS, S.ui.invEtat) + '</select></label></div>' +
      '<form class="scan" id="scan-form"><input id="scan-in" autocomplete="off" placeholder="Scanner ou saisir le code" aria-label="Code du bien" autofocus><button class="btn" type="submit">Pointer</button></form>' +
      '<div class="note">La douchette saisit le code puis « Entrée ». Un code absent du registre est noté comme bien non inscrit. Un bien trouvé hors de son emplacement est noté comme mal localisé.</div></div>' +
      '<div><b>Derniers pointages</b><div class="scan-log" style="margin-top:8px">' + (log || '<span class="muted">Aucun pointage pour l\'instant.</span>') + '</div></div></div>' + invChecklist(inv, r);
  } else if (tab === 'res' || closed) {
    content = invResults(inv, r, closed);
  } else content = invChecklist(inv, r);
  return '<div class="page-head"><div><button class="btn ghost sm" data-act="nav" data-view="inventaires">' + icon('back') + 'Campagnes</button></div><div class="actions">' +
    '<button class="btn ghost" data-act="inv-export" data-fmt="pdf">' + icon('dl') + 'PV PDF</button><button class="btn ghost" data-act="inv-export" data-fmt="xlsx">' + icon('dl') + 'PV Excel</button>' +
    (closed ? '<button class="btn ghost" data-act="inv-reopen">Rouvrir</button>' : '<button class="btn" data-act="inv-close">Clôturer l\'inventaire</button>') + '<button class="btn danger sm" data-act="inv-del">' + icon('trash') + '</button></div></div>' +
    '<div class="panel"><div class="panel-head"><div><h3 style="margin:0">' + esc(inv.libelle) + '</h3><div class="muted" style="font-size:12.5px">Date ' + fdate(inv.date) + ' · ' + esc(inv.emplacements && inv.emplacements.length ? 'emplacements ' + inv.emplacements.join(', ') : 'tous les emplacements') + (inv.responsable ? ' · responsable ' + esc(inv.responsable) : '') + '</div></div>' + (closed ? '<span class="pill grey">Clôturé le ' + fdate((inv.clotureAt || '').slice(0, 10)) + '</span>' : '<span class="pill warn">En cours</span>') + '</div>' +
    '<div class="kpis k5" style="margin-bottom:12px;--n:5">' + [['Attendus', r.attendus], ['Trouvés', r.trouves], ['Manquants', r.manquants.length], ['Mal localisés', r.malLocalises.length], ['Non inscrits', r.inconnus.length]].map((k) => '<div class="kpi" style="background:var(--soft-2)"><span class="l">' + k[0] + '</span><span class="v">' + k[1] + '</span></div>').join('') + '</div>' +
    '<div class="progress" aria-label="Avancement"><i style="width:' + pct + '%"></i></div><div class="muted" style="font-size:12px;margin:6px 0 14px">' + pct + ' % des biens attendus pointés</div>' +
    '<div class="tabs">' + (closed ? '' : '<button class="' + (tab === 'scan' ? 'on' : '') + '" data-act="inv-tab" data-tab="scan">Pointage</button>') + '<button class="' + (tab === 'list' ? 'on' : '') + '" data-act="inv-tab" data-tab="list">Liste de contrôle</button><button class="' + (tab === 'res' || closed ? 'on' : '') + '" data-act="inv-tab" data-tab="res">Résultats et régularisations</button></div>' + content + '</div>';
};
VIEWS.inventaire.after = function () {
  const f = $('#scan-form');
  if (!f) return;
  f.addEventListener('submit', (e) => { e.preventDefault(); const i = $('#scan-in'); invScan(i.value); });
  const i = $('#scan-in'); if (i) i.focus();
};
function invChecklist(inv, r) {
  const scope = inv.emplacements && inv.emplacements.length ? new Set(inv.emplacements) : null;
  const filt = S.ui.invList || 'tous';
  const list = S.assets.filter((a) => (!a.sortie || a.sortie.date > inv.date) && a.dateAcq <= inv.date && (!scope || scope.has(a.emplacement)));
  const rows = list.filter((a) => { const l = (inv.lignes || {})[a.id]; return filt === 'tous' || (filt === 'pointes' ? l && l.trouve : !(l && l.trouve)); })
    .map((a) => { const l = (inv.lignes || {})[a.id]; return '<tr><td><input type="checkbox" data-change="inv-toggle" data-id="' + esc(a.id) + '"' + chk(l && l.trouve) + (inv.statut === 'cloture' ? ' disabled' : '') + ' aria-label="Pointer ' + esc(a.code) + '"></td><td class="code">' + esc(codeTxt(a.code)) + '</td><td>' + esc(a.designation) + '</td><td>' + esc(empLabel(a.emplacement)) + '</td><td>' + (l && l.trouve ? esc(empLabel(l.emp)) + (l.emp !== a.emplacement ? ' <span class="pill warn">écart</span>' : '') : '') + '</td><td>' + esc(l && l.etat || '') + '</td></tr>'; }).join('');
  return '<div style="margin-top:16px"><div class="toolbar" style="margin-bottom:10px"><label class="field" style="max-width:240px"><span>Afficher</span><select data-change="inv-list">' + opt([{ v: 'tous', l: 'Tous les biens attendus' }, { v: 'restants', l: 'Restant à pointer' }, { v: 'pointes', l: 'Déjà pointés' }], filt) + '</select></label></div>' +
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Code</th><th>Désignation</th><th>Emplacement registre</th><th>Trouvé à</th><th>État</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6">Aucun bien dans cette sélection.</td></tr>') + '</tbody></table></div></div>';
}
function invResults(inv, r, closed) {
  const t = (title, items, cols, actions) => '<div class="fs"><div class="panel-head"><b>' + title + ' (' + items.length + ')</b>' + (actions || '') + '</div>' + (items.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + cols.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' + items.join('') + '</tbody></table></div>' : '<span class="muted">Néant.</span>') + '</div>';
  const mal = r.malLocalises.map((x) => '<tr><td class="code">' + esc(codeTxt(x.a.code)) + '</td><td>' + esc(x.a.designation) + '</td><td>' + esc(empLabel(x.a.emplacement)) + '</td><td>' + esc(empLabel(x.l.emp)) + '</td></tr>');
  const man = r.manquants.map((x) => '<tr><td class="code">' + esc(codeTxt(x.a.code)) + '</td><td>' + esc(x.a.designation) + '</td><td>' + esc(empLabel(x.a.emplacement)) + '</td><td class="num">' + money(x.a.valeur) + '</td><td class="num">' + money(EN.yearValues(x.a, sched(x.a), EN.exoOf(inv.date, engineCfg()), engineCfg()).vncFin) + '</td></tr>');
  const deg = r.degrades.map((x) => '<tr><td class="code">' + esc(codeTxt(x.a.code)) + '</td><td>' + esc(x.a.designation) + '</td><td>' + esc(x.l.etat) + '</td><td>' + esc(x.a.etat || '') + '</td></tr>');
  const inc = r.inconnus.map((x) => '<tr><td class="code">' + esc(x.code) + '</td><td>' + esc(empLabel(x.emp)) + '</td><td>' + esc(x.note || '') + '</td></tr>');
  return '<div class="form" style="margin-top:16px">' +
    t('Biens mal localisés', mal, ['Code', 'Désignation', 'Emplacement registre', 'Emplacement constaté'], mal.length ? '<button class="btn sm" data-act="inv-apply-moves">Mettre à jour les emplacements</button>' : '') +
    t('Biens manquants', man, ['Code', 'Désignation', 'Emplacement', 'Valeur brute', 'VNC estimée'], man.length ? '<button class="btn sm" data-act="inv-apply-missing">Constater les sorties</button>' : '') +
    t('Biens en mauvais état ou hors service', deg, ['Code', 'Désignation', 'État constaté', 'État registre'], deg.length ? '<button class="btn sm" data-act="inv-apply-etats">Reporter les états</button>' : '') +
    t('Biens non inscrits au registre', inc, ['Code lu', 'Trouvé à', 'Note'], '') +
    '<div class="note">Les régularisations s\'appliquent après validation. Les biens manquants sont sortis à la date d\'inventaire avec la nature « ' + esc((S.cfg.sorties || EN.DEFAULT_SORTIES)[3] || 'Perte') + ' » et une valeur de cession nulle ; la moins-value correspondante est calculée automatiquement.</div></div>';
}
ACT['inv-tab'] = (el) => { S.ui.invTab = el.dataset.tab; render(); };
CHANGE['inv-emp'] = (el) => { S.ui.invEmp = el.value; render(); };
CHANGE['inv-etat'] = (el) => { S.ui.invEtat = el.value; render(); };
CHANGE['inv-list'] = (el) => { S.ui.invList = el.value; render(); };
CHANGE['inv-toggle'] = (el) => {
  const inv = S.inventories.find((x) => x.id === S.arg); if (!inv) return;
  const a = S.assets.find((x) => x.id === el.dataset.id); if (!a) return;
  inv.lignes = inv.lignes || {};
  if (el.checked) inv.lignes[a.id] = { trouve: true, emp: a.emplacement, etat: S.ui.invEtat || 'Bon', at: nowIso(), manuel: true };
  else delete inv.lignes[a.id];
  invSaveSoon(inv); render();
};
function invScan(raw) {
  const inv = S.inventories.find((x) => x.id === S.arg); if (!inv || inv.statut === 'cloture') return;
  const code = EN.normCode(raw);
  if (!code) return;
  S.ui.invLog = S.ui.invLog || [];
  const a = S.assets.find((x) => x.code === code);
  inv.lignes = inv.lignes || {}; inv.inconnus = inv.inconnus || [];
  if (!a) {
    if (!inv.inconnus.some((x) => x.code === code)) inv.inconnus.push({ code: code, emp: S.ui.invEmp, at: nowIso() });
    S.ui.invLog.push({ code: code, k: 'bad', t: 'Non inscrit', msg: 'Code absent du registre' });
  } else if (a.sortie && a.sortie.date <= inv.date) {
    S.ui.invLog.push({ code: codeTxt(code), k: 'bad', t: 'Sorti', msg: a.designation + ' : sorti le ' + fdate(a.sortie.date) });
  } else {
    const already = inv.lignes[a.id] && inv.lignes[a.id].trouve;
    inv.lignes[a.id] = { trouve: true, emp: S.ui.invEmp, etat: S.ui.invEtat, at: nowIso() };
    const ecart = S.ui.invEmp !== a.emplacement;
    S.ui.invLog.push({ code: codeTxt(code), k: ecart ? 'warn' : 'ok', t: already ? 'Déjà pointé' : (ecart ? 'Mal localisé' : 'Trouvé'), msg: a.designation });
  }
  invSaveSoon(inv);
  render();
}
ACT['inv-close'] = async () => {
  const inv = S.inventories.find((x) => x.id === S.arg); if (!inv) return;
  const r = EN.inventoryResults(inv, S.assets);
  const ok = await confirmBox('Clôturer l\'inventaire', '<p>' + r.trouves + ' bien(s) pointé(s) sur ' + r.attendus + ' attendu(s), ' + r.manquants.length + ' manquant(s). Les pointages ne pourront plus être modifiés, sauf réouverture.</p>', 'Clôturer');
  if (!ok) return;
  inv.statut = 'cloture'; inv.clotureAt = nowIso(); invDirty = inv; await flushInv(); S.ui.invTab = 'res'; render();
};
ACT['inv-reopen'] = async () => { const inv = S.inventories.find((x) => x.id === S.arg); if (!inv) return; inv.statut = 'en_cours'; invDirty = inv; await flushInv(); S.ui.invTab = 'scan'; render(); };
ACT['inv-del'] = async () => {
  const inv = S.inventories.find((x) => x.id === S.arg); if (!inv) return;
  const ok = await confirmBox('Supprimer la campagne', '<p>La campagne « ' + esc(inv.libelle) + ' » et tous ses pointages seront supprimés. Les régularisations déjà appliquées au registre sont conservées.</p>', 'Supprimer', true);
  if (!ok) return;
  try { await Store.del(P.inv(S.tenantId, inv.id)); S.inventories = S.inventories.filter((x) => x.id !== inv.id); go('inventaires'); } catch (e) { storeError(e); }
};
ACT['inv-apply-moves'] = async () => {
  const inv = S.inventories.find((x) => x.id === S.arg); const r = EN.inventoryResults(inv, S.assets);
  const ok = await confirmBox('Mettre à jour les emplacements', '<p>' + r.malLocalises.length + ' bien(s) seront rattachés à l\'emplacement constaté. Les codes et étiquettes ne changent pas.</p>', 'Appliquer');
  if (!ok) return;
  for (const x of r.malLocalises) { const b = clone(x.a); b.history = (b.history || []).concat([{ date: inv.date, at: nowIso(), action: 'Transfert (inventaire)', detail: empLabel(x.a.emplacement) + ' → ' + empLabel(x.l.emp) }]); b.emplacement = x.l.emp; if (!(await saveAsset(b, true))) return; }
  toast('Emplacements mis à jour.', 'ok'); render();
};
ACT['inv-apply-etats'] = async () => {
  const inv = S.inventories.find((x) => x.id === S.arg); const r = EN.inventoryResults(inv, S.assets);
  for (const x of r.degrades) { const b = clone(x.a); b.etat = x.l.etat; b.history = (b.history || []).concat([{ date: inv.date, at: nowIso(), action: 'État constaté (inventaire)', detail: x.l.etat }]); if (!(await saveAsset(b, true))) return; }
  toast('États reportés au registre.', 'ok'); render();
};
ACT['inv-apply-missing'] = async () => {
  const inv = S.inventories.find((x) => x.id === S.arg); const r = EN.inventoryResults(inv, S.assets);
  const type = (S.cfg.sorties || EN.DEFAULT_SORTIES)[3] || 'Perte / manquant à l\'inventaire';
  const total = r.manquants.reduce((s, x) => s + EN.sortieCalc(x.a, catOf(x.a.categorie) || {}, engineCfg(), { date: inv.date }).vnc, 0);
  const ok = await confirmBox('Constater les biens manquants', '<p>' + r.manquants.length + ' bien(s) seront sortis au ' + fdate(inv.date) + ' (« ' + esc(type) + ' »), pour une valeur nette comptable de <b>' + money(total) + ' DT</b> constatée en charge nette (compte ' + esc(S.cfg.comptes.cessionCharge) + ').</p><label class="field"><span>Réf. pièce comptable de l\'écriture de sortie</span><input id="cfm-input" placeholder="Ex. OD-' + S.year + '-0042"></label><div class="note warn">Assurez-vous que les recherches complémentaires ont été menées avant de valider.</div>', 'Constater les sorties', true);
  if (ok === false) return;
  const pc = typeof ok === 'string' ? ok.trim() : '';
  for (const x of r.manquants) {
    const b = clone(x.a);
    b.sortie = { type: type, date: inv.date, prix: 0, indemnite: 0, tiers: '', piece: 'PV d\'inventaire du ' + fdate(inv.date), pieceCompta: pc, motif: 'Bien non retrouvé lors de « ' + inv.libelle + ' »', at: nowIso() };
    b.history = (b.history || []).concat([{ date: inv.date, at: nowIso(), action: 'Sortie (manquant à l\'inventaire)', detail: inv.libelle, piece: pc }]);
    if (!(await saveAsset(b, true))) return;
  }
  toast('Sorties constatées.', 'ok'); render();
};
ACT['inv-export'] = (el) => {
  const inv = S.inventories.find((x) => x.id === S.arg); if (!inv) return;
  exportReport('inventaire', el.dataset.fmt, { inv: inv });
};

/* ---------------- Étiquettes ---------------- */
TITLES.etiquettes = { title: 'Étiquettes code-barres' };
VIEWS.etiquettes = function () {
  const f = S.ui.lf || (S.ui.lf = { emp: '', cat: '', ids: null, fmt: '3x8' });
  const list = S.assets.filter((a) => !a.sortie && (!f.emp || a.emplacement === f.emp) && (!f.cat || a.categorie === f.cat));
  const ids = f.ids ? new Set(f.ids) : new Set(list.map((a) => a.id));
  const chosen = list.filter((a) => ids.has(a.id));
  const prev = chosen.slice(0, 6).map((a) => labelCard(a)).join('');
  return '<div class="page-head"><div><h2>Étiquettes d\'identification</h2><p>Code-barres Code 128 du code immobilisation, prêt pour une douchette. Format planche A4 autocollante.</p></div><div class="actions"><button class="btn" data-act="labels-pdf"' + (chosen.length ? '' : ' disabled') + '>' + icon('dl') + 'Générer le PDF (' + chosen.length + ')</button></div></div>' +
    '<div class="panel"><div class="toolbar" style="margin-bottom:14px"><label class="field"><span>Emplacement</span><select data-change="lf-emp"><option value="">Tous</option>' + emps().map((e) => '<option value="' + esc(e.code) + '"' + sel(e.code, f.emp) + '>' + esc(e.code + ' – ' + e.libelle) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Catégorie</span><select data-change="lf-cat"><option value="">Toutes</option>' + cats().map((c) => '<option value="' + esc(c.code) + '"' + sel(c.code, f.cat) + '>' + esc(c.code + ' – ' + c.libelle) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Planche</span><select data-change="lf-fmt">' + opt([{ v: '3x8', l: 'A4 – 24 étiquettes 70 × 37 mm' }, { v: '2x7', l: 'A4 – 14 étiquettes 99 × 38 mm' }, { v: '3x10', l: 'A4 – 30 étiquettes 70 × 29,7 mm' }], f.fmt) + '</select></label></div>' +
    (prev ? '<div class="labels-prev">' + prev + '</div>' + (chosen.length > 6 ? '<p class="muted" style="margin:10px 0 0">Aperçu des 6 premières étiquettes sur ' + chosen.length + '.</p>' : '') : '<div class="empty"><b>Aucun bien en service dans cette sélection.</b></div>') +
    '<div class="tbl-wrap" style="margin-top:16px;max-height:380px;overflow:auto"><table class="tbl"><thead><tr><th><input type="checkbox" data-change="lf-all"' + chk(chosen.length === list.length && list.length) + ' aria-label="Tout sélectionner"></th><th>Code</th><th>Désignation</th><th>Emplacement</th></tr></thead><tbody>' +
    list.map((a) => '<tr><td><input type="checkbox" data-change="lf-one" data-id="' + esc(a.id) + '"' + chk(ids.has(a.id)) + '></td><td class="code">' + esc(codeTxt(a.code)) + '</td><td>' + esc(a.designation) + '</td><td>' + esc(empLabel(a.emplacement)) + '</td></tr>').join('') + '</tbody></table></div></div>';
};
VIEWS.etiquettes.after = function () { drawBarcodes(); };
function labelCard(a) {
  return '<div class="label-card"><div class="t"><b>' + esc(S.tenant.raison) + '</b><span>' + esc(a.emplacement) + '</span></div><svg class="bc" data-code="' + esc(a.code) + '"></svg><div class="c">' + esc(codeTxt(a.code)) + '</div><div class="d">' + esc(a.designation) + '</div></div>';
}
function drawBarcodes() {
  if (!window.JsBarcode) return;
  $$('svg.bc').forEach((s) => { try { window.JsBarcode(s, s.dataset.code, { format: 'CODE128', displayValue: false, margin: 0, height: 48, width: 1.6 }); } catch (e) { /* code invalide */ } });
}
CHANGE['lf-emp'] = (el) => { S.ui.lf.emp = el.value; S.ui.lf.ids = null; render(); };
CHANGE['lf-cat'] = (el) => { S.ui.lf.cat = el.value; S.ui.lf.ids = null; render(); };
CHANGE['lf-fmt'] = (el) => { S.ui.lf.fmt = el.value; render(); };
CHANGE['lf-all'] = (el) => { S.ui.lf.ids = el.checked ? null : []; render(); };
CHANGE['lf-one'] = (el) => {
  const f = S.ui.lf;
  const list = S.assets.filter((a) => !a.sortie && (!f.emp || a.emplacement === f.emp) && (!f.cat || a.categorie === f.cat));
  const ids = new Set(f.ids || list.map((a) => a.id));
  if (el.checked) ids.add(el.dataset.id); else ids.delete(el.dataset.id);
  f.ids = Array.from(ids); render();
};
ACT['labels-pdf'] = () => {
  const f = S.ui.lf;
  const list = S.assets.filter((a) => !a.sortie && (!f.emp || a.emplacement === f.emp) && (!f.cat || a.categorie === f.cat));
  const ids = f.ids ? new Set(f.ids) : null;
  labelsPdf(list.filter((a) => !ids || ids.has(a.id)), f.fmt);
};
ACT['label-one'] = (el) => { const a = S.assets.find((x) => x.id === el.dataset.id); if (a) labelsPdf([a], '3x8'); };
function labelsPdf(list, fmtKey) {
  if (!window.jspdf || !window.JsBarcode) { toast('Les bibliothèques PDF ne sont pas encore chargées. Réessayez dans un instant.', 'bad'); return; }
  const F = { '3x8': { cols: 3, rows: 8, w: 70, h: 37, mx: 0, my: 0.5 }, '2x7': { cols: 2, rows: 7, w: 99, h: 38, mx: 6, my: 15.5 }, '3x10': { cols: 3, rows: 10, w: 70, h: 29.7, mx: 0, my: 0 } }[fmtKey] || { cols: 3, rows: 8, w: 70, h: 37, mx: 0, my: 0.5 };
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const per = F.cols * F.rows;
  const canvas = document.createElement('canvas');
  list.forEach((a, i) => {
    if (i && i % per === 0) doc.addPage();
    const k = i % per, c = k % F.cols, rr = Math.floor(k / F.cols);
    const x = F.mx + c * F.w, y = F.my + rr * F.h;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(60, 40, 90);
    doc.text(pdfTxt(String(S.tenant.raison).slice(0, 42)), x + 4, y + 4.5);
    doc.setFont('helvetica', 'normal'); doc.text(pdfTxt('Empl. ' + a.emplacement), x + F.w - 4, y + 4.5, { align: 'right' });
    try { window.JsBarcode(canvas, a.code, { format: 'CODE128', displayValue: false, margin: 0, height: 60, width: 2 }); doc.addImage(canvas.toDataURL('image/png'), 'PNG', x + 5, y + 6.5, F.w - 10, F.h * 0.42); } catch (e) { /* rien */ }
    doc.setFont('courier', 'bold'); doc.setFontSize(10); doc.setTextColor(20, 10, 40);
    doc.text(codeTxt(a.code), x + F.w / 2, y + 6.5 + F.h * 0.42 + 4.2, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.text(pdfTxt(String(a.designation).slice(0, 52)), x + F.w / 2, y + 6.5 + F.h * 0.42 + 7.8, { align: 'center' });
    doc.setFontSize(5); doc.setTextColor(120, 100, 150); doc.text('Propriete ' + pdfTxt(String(S.tenant.raison).slice(0, 40)) + ' - ne pas retirer', x + F.w / 2, y + F.h - 2, { align: 'center' });
  });
  saveFile('Etiquettes_' + S.tenant.codeSociete + '_' + EN.today() + '.pdf', doc.output('blob'));
}

/* ==========================================================================
   Rapports annuels et notes aux états financiers : construction, aperçu,
   export PDF (titres en Mozilla Headline) et Excel
   ========================================================================== */
const REPORTS = {
  tableau: { label: 'Tableau de variation des immobilisations', desc: 'Rapprochement de l\'exercice par catégorie : entrées, sorties, réévaluations, virements, amortissements, pertes de valeur et reprises (NC 05 §100).', orient: 'l' },
  notes: { label: 'Notes aux états financiers – immobilisations', desc: 'Méthodes, durées, changements d\'estimations, réévaluations, pertes de valeur, informations à fournir (NC 05 §100 à §107) et, le cas échéant, note sur l\'utilisation des taux fiscaux.', orient: 'p', doc: true },
  registre: { label: 'Registre détaillé des immobilisations', desc: 'Situation de chaque bien à la clôture ou à sa date de sortie.', orient: 'l' },
  fiscal: { label: 'Passage comptable / fiscal des amortissements', desc: 'Plafonds de l\'art. 12 bis CIRPPIS, part déductible, réintégrations et déductions ultérieures, retraitements des pertes de valeur et des sorties.', orient: 'l', fiscal: true },
  sorties: { label: 'État des sorties de l\'exercice', desc: 'Cessions, rebuts, vols, pertes et remplacements, avec résultats comptable et fiscal.', orient: 'l' },
  journal: { label: 'Écritures d\'inventaire de l\'exercice', desc: 'Dotations, pertes de valeur, reprises, réévaluations, démantèlement, subventions et sorties, avec leurs références de pièces comptables.', orient: 'p' },
  mouvements: { label: 'État des mouvements et pièces comptables', desc: 'Entrées, mises en service, dépenses ultérieures, réévaluations, dépréciations, reclassements, transferts et sorties de l\'exercice, avec la référence de la pièce comptable de chaque mouvement.', orient: 'l' },
  emplacement: { label: 'État des biens par emplacement', desc: 'Biens en service rattachés à chaque emplacement.', orient: 'p' }
};
const N = (h, w) => ({ h: h, num: true, w: w });
const T = (h, w) => ({ h: h, w: w });

function buildReport(key, o) {
  o = o || {};
  const y = o.year || S.year, cfg = engineCfg(), E = EN.exo(y, cfg);
  const per = 'Exercice ' + EN.exoLabel(y, cfg) + ' – du ' + fdate(E.start) + ' au ' + fdate(E.end);
  const filt = (a) => (!o.cat || a.categorie === o.cat) && (!o.emp || a.emplacement === o.emp);
  const assets = S.assets.filter(filt);
  const R = { key: key, title: (REPORTS[key] || {}).label || '', subtitle: per, cols: [], rows: [], foot: null, notes: [], orient: (REPORTS[key] || {}).orient || 'l' };

  if (key === 'tableau') {
    R.cols = [T('Catégorie', 46), N('VB début'), N('Entrées'), N('Réévaluations'), N('Sorties'), N('Virements'), N('VB fin'), N('Amort. et pertes début'), N('Dotations'), N('Pertes nettes de reprises'), N('Sorties'), N('Autres'), N('Amort. et pertes fin'), N('VNC fin')];
    const acc = {};
    const get = (c) => (acc[c] = acc[c] || Array(13).fill(0));
    const prevEnd = EN.iso(E.s - 1);
    assets.forEach((a) => {
      const v = EN.yearValues(a, sched(a), y, cfg);
      if (!v.exists) return;
      const exitIn = a.sortie && a.sortie.date >= E.start && a.sortie.date <= E.end;
      const cS = EN.catAt(a, prevEnd), cE = EN.catAt(a, exitIn ? a.sortie.date : E.end);
      const s = get(cS), e = get(cE);
      s[0] += v.vbDebut; s[6] += v.amDebut;
      e[1] += v.acquisitions + v.entrees; e[2] += v.reevaluations; e[3] += v.sorties; e[5] += v.vbFin;
      e[7] += v.dotation; e[8] += v.pertesNettes; e[9] += v.amSorties; e[10] -= v.elim; e[11] += v.amFin; e[12] += v.vncFin;
      if (cS !== cE) { s[4] -= v.vbDebut; e[4] += v.vbDebut; s[10] -= v.amDebut; e[10] += v.amDebut; }
      else { e[0] += 0; }
    });
    const tot = Array(13).fill(0);
    ['I', 'C'].forEach((type) => {
      const cs = cats().filter((c) => (c.type || 'C') === type && acc[c.code] && acc[c.code].some((v) => Math.abs(v) > 0.0005));
      if (!cs.length) return;
      const sub = Array(13).fill(0);
      R.rows.push({ group: type === 'I' ? 'Immobilisations incorporelles (NC 06)' : 'Immobilisations corporelles (NC 05)' });
      cs.forEach((c) => { const x = acc[c.code].map(r3); x.forEach((v, i) => { sub[i] += v; tot[i] += v; }); R.rows.push([c.code + ' – ' + c.libelle].concat(x)); });
      R.rows.push({ sub: true, cells: ['Sous-total ' + (type === 'I' ? 'incorporelles' : 'corporelles')].concat(sub.map(r3)) });
    });
    R.foot = ['Total général'].concat(tot.map(r3));
    R.notes.push('VB fin = VB début + entrées + réévaluations − sorties ± virements. Amortissements et pertes fin = début + dotations + pertes nettes − sorties ± autres (éliminations lors des réévaluations, virements).');
    R.notes.push('Entrées : acquisitions, productions, dépenses ultérieures immobilisées et révisions des coûts de démantèlement.');
  }

  if (key === 'registre') {
    R.cols = [T('Code', 26), T('Désignation', 46), T('Cat.'), T('Empl.'), T('Mise en service'), T('Mode'), T('Durée'), N('Valeur brute'), N('Amort. et pertes début'), N('Dotation'), N('Pertes nettes'), N('Amort. et pertes fin'), N('VNC'), T('Statut')];
    const tot = [0, 0, 0, 0, 0, 0];
    assets.forEach((a) => {
      const s = sched(a), v = EN.yearValues(a, s, y, cfg);
      if (!v.exists) return;
      const vb = v.vbFin || v.sorties, amF = v.vbFin ? v.amFin : v.amSorties, amD = v.amDebut;
      const vncv = r3(vb - amF);
      const st = a.sortie && a.sortie.date <= E.end ? 'Sorti ' + fdate(a.sortie.date) : (s.mode !== 'N' && vncv - num(a.vr) <= 0.001 ? 'Amorti' : 'En service');
      [vb, amD, v.dotation, v.pertesNettes, amF, vncv].forEach((x, i) => { tot[i] += x; });
      R.rows.push([codeTxt(a.code), a.designation, a.categorie, a.emplacement, fdate(a.dateMES || a.dateAcq), EN.MODES[s.mode] || '', ['L', 'A', 'D'].includes(s.mode) ? EN.fmtYears(s.dureeEffective) : '', vb, amD, v.dotation, v.pertesNettes, amF, vncv, st]);
    });
    R.foot = ['Total', R.rows.length + ' biens', '', '', '', '', ''].concat(tot.map(r3)).concat(['']);
  }

  if (key === 'fiscal') {
    R.cols = [T('Code', 24), T('Désignation', 40), T('Plafond', 28), N('Dotation comptable'), N('Plafond fiscal'), N('Déductible'), N('Amort. réintégrés'), N('Déduction réint. antérieures'), N('Autres réintégrations'), N('Autres déductions'), N('Ajustement de sortie'), N('Net à réintégrer')];
    const tot = Array(9).fill(0);
    let pending = 0;
    assets.forEach((a) => {
      const s = sched(a), v = EN.yearValues(a, s, y, cfg);
      if (!v.exists) return;
      const exitIn = a.sortie && a.sortie.date >= E.start && a.sortie.date <= E.end;
      const adj = exitIn ? EN.sortieCalc(a, catOf(a.categorie) || {}, cfg).ajustFiscal : 0;
      if (!v.row && !adj) return;
      const net = r3(v.reint - v.dedAnt + v.reintAutres - v.dedAutres + adj);
      const vals = [v.dotation, v.cap, v.ded, v.reint, v.dedAnt, v.reintAutres, v.dedAutres, adj, net];
      vals.forEach((x, i) => { tot[i] += x; });
      if (v.row && !exitIn && s.regime.regime !== 'ND') pending += Math.max(0, Math.min(s.fiscalBase - v.row.cumDed, (v.row.cumDotF || 0) - v.row.cumDed));
      R.rows.push([codeTxt(a.code), a.designation, s.regime.libelle].concat(vals));
    });
    R.foot = ['Total', '', ''].concat(tot.map(r3));
    const reintT = r3(Math.max(0, tot[3]) + tot[5] + Math.max(0, tot[7])), dedT = r3(tot[4] + tot[6] + Math.max(0, -tot[7]));
    R.notes.push('À reporter au tableau de détermination du résultat fiscal : réintégrations ' + money(reintT) + ' DT, déductions ' + money(dedT) + ' DT, soit un montant net de ' + money(tot[8]) + ' DT.');
    R.notes.push('Amortissements réintégrés restant à déduire sur les exercices suivants (note commune n° 22/2008) : ' + money(pending) + ' DT.');
    R.notes.push('Plafonds : taux maximum du décret n° 2008-492 (linéaire), coefficient d\'équipes (art. 2), amortissement intégral des biens de faible valeur (≤ ' + money(S.cfg.fiscal.seuilFaibleValeur) + ' DT). Non déductibles : voitures de tourisme de plus de ' + S.cfg.fiscal.seuilCV + ' CV, terrains, fonds de commerce, part « démantèlement » du coût, pertes de valeur, diminutions de réévaluation et désactualisation. Les réévaluations libres n\'ont pas d\'effet fiscal : le plafond reste calculé sur le coût historique.');
  }

  if (key === 'sorties') {
    R.cols = [T('Date'), T('Code', 24), T('Désignation', 40), T('Nature', 28), N('Valeur brute'), N('Amort. et pertes'), N('VNC'), N('Produit de sortie'), N('Résultat comptable'), N('Écart viré'), N('Résultat fiscal'), N('Ajustement fiscal')];
    const tot = Array(8).fill(0);
    assets.filter((a) => a.sortie && a.sortie.date >= E.start && a.sortie.date <= E.end).sort((a, b) => a.sortie.date.localeCompare(b.sortie.date)).forEach((a) => {
      const sc = EN.sortieCalc(a, catOf(a.categorie) || {}, cfg);
      const vals = [sc.gross, r3(sc.cumul + sc.prov), sc.vnc, sc.produit, sc.resCompta, sc.ecartVire, sc.resFiscal, sc.ajustFiscal];
      vals.forEach((x, i) => { tot[i] += x; });
      R.rows.push([fdate(a.sortie.date), codeTxt(a.code), a.designation, a.sortie.type].concat(vals));
    });
    R.foot = ['Total', R.rows.length + ' sortie(s)', '', ''].concat(tot.map(r3));
    R.notes.push('Profit ou perte = produit net de sortie − valeur comptable (NC 05 §80), au compte ' + S.cfg.comptes.cessionProduit + ' ou ' + S.cfg.comptes.cessionCharge + '. L\'écart de réévaluation réalisé est viré directement aux résultats reportés (§40), sans transiter par le résultat.');
  }

  if (key === 'journal') {
    R.cols = [T('Date'), T('Pièce'), T('Compte'), T('Libellé', 80), N('Débit'), N('Crédit')];
    const j = EN.journal(assets, cats(), Object.assign({}, cfg, { pieceInventaire: ((S.tenant.piecesInventaire || {})[y] || '').trim() }), y);
    let td = 0, tc = 0;
    j.forEach((e) => {
      R.rows.push({ group: fdate(e.date) + ' · ' + e.piece + ' · ' + e.libelle });
      e.lignes.forEach((l) => { td += l.debit; tc += l.credit; R.rows.push([fdate(e.date), e.piece, l.compte, l.libelle, l.debit || '', l.credit || '']); });
    });
    R.foot = ['Total', '', '', j.length + ' écriture(s)', r3(td), r3(tc)];
    R.notes.push('Les acquisitions et dépenses immobilisées sont enregistrées au journal des achats et ne figurent pas ici. Les sorties sont présentées en net, après la dotation complémentaire incluse dans les dotations de l\'exercice.');
  }

  if (key === 'mouvements') {
    R.cols = [T('Date'), T('Code', 26), T('Désignation', 46), T('Mouvement', 38), N('Montant', 26), T('Justificatif', 58), T('Réf. pièce comptable', 30)];
    const mv = yearMovements(y, filt);
    let manq = 0;
    mv.forEach((m) => { if (m.compta && !m.piece) manq++; R.rows.push([fdate(m.date), codeTxt(m.a.code), m.a.designation, m.label, m.montant === '' ? '' : m.montant, m.justif || '', m.piece || (m.compta ? 'À RENSEIGNER' : '—')]); });
    const pi = ((S.tenant.piecesInventaire || {})[y] || '').trim();
    R.foot = ['Total', mv.length + ' mouvement(s)', '', '', '', '', manq ? manq + ' sans pièce' : 'Toutes renseignées'];
    R.notes.push('Montant : coût d\'entrée, dépense immobilisée, écart de réévaluation, perte de valeur (−) ou reprise (+), variation de la provision pour démantèlement, valeur brute sortie (−). Les révisions d\'estimations, transferts d\'emplacement et tests sans incidence ne donnent pas lieu à écriture : leur pièce est facultative.');
    R.notes.push('Dotations et autres écritures d\'inventaire de l\'exercice : ' + (pi ? 'pièce ' + pi + '.' : 'référence de pièce à renseigner dans le rapport « Écritures d\'inventaire ».'));
    if (manq) R.notes.push(manq + ' mouvement(s) comptabilisable(s) sans référence de pièce : à compléter avant l\'arrêté des comptes pour assurer la piste d\'audit entre le registre et la comptabilité.');
  }

  if (key === 'emplacement') {
    R.cols = [T('Code', 28), T('Désignation', 60), T('Cat.'), T('Mise en service'), N('Valeur brute'), N('VNC'), T('État')];
    let tv = 0, tn = 0;
    emps().forEach((e) => {
      const list = assets.filter((a) => a.emplacement === e.code && !(a.sortie && a.sortie.date <= E.end) && a.dateAcq <= E.end);
      if (!list.length) return;
      R.rows.push({ group: e.code + ' – ' + e.libelle + (e.site ? ' (' + e.site + ')' : '') + ' · ' + list.length + ' bien(s)' });
      list.forEach((a) => { const v = EN.yearValues(a, sched(a), y, cfg); tv += v.vbFin; tn += v.vncFin; R.rows.push([codeTxt(a.code), a.designation, a.categorie, fdate(a.dateMES || a.dateAcq), v.vbFin, v.vncFin, a.etat || '']); });
    });
    R.foot = ['Total', '', '', '', r3(tv), r3(tn), ''];
  }

  if (key === 'inventaire' && o.inv) {
    const inv = o.inv, r = EN.inventoryResults(inv, S.assets);
    R.title = 'Procès-verbal d\'inventaire physique';
    R.subtitle = inv.libelle + ' – date ' + fdate(inv.date) + (inv.responsable ? ' – responsable : ' + inv.responsable : '');
    R.cols = [T('Résultat', 26), T('Code', 28), T('Désignation', 60), T('Empl. registre'), T('Empl. constaté'), T('État constaté'), N('Valeur brute')];
    const push = (lab, items, fn) => { if (!items.length) return; R.rows.push({ group: lab + ' (' + items.length + ')' }); items.forEach((x) => R.rows.push(fn(x))); };
    push('Biens manquants', r.manquants, (x) => ['Manquant', codeTxt(x.a.code), x.a.designation, x.a.emplacement, '', '', num(x.a.valeur)]);
    push('Biens mal localisés', r.malLocalises, (x) => ['Mal localisé', codeTxt(x.a.code), x.a.designation, x.a.emplacement, x.l.emp, x.l.etat || '', num(x.a.valeur)]);
    push('Biens non inscrits au registre', r.inconnus, (x) => ['Non inscrit', x.code, '', '', x.emp || '', '', '']);
    push('Biens conformes', r.conformes, (x) => ['Conforme', codeTxt(x.a.code), x.a.designation, x.a.emplacement, x.l.emp, x.l.etat || '', num(x.a.valeur)]);
    R.notes.push('Biens attendus : ' + r.attendus + ' · trouvés : ' + r.trouves + ' · manquants : ' + r.manquants.length + ' · mal localisés : ' + r.malLocalises.length + ' · non inscrits : ' + r.inconnus.length + '.');
    R.notes.push('Statut de la campagne : ' + (inv.statut === 'cloture' ? 'clôturée' : 'en cours') + '.');
    R.signatures = ['Le responsable de l\'inventaire', 'La direction', 'Le cabinet CTB'];
  }

  if (key === 'notes') return buildNotes(y, assets, R);
  if (key === 'plan' && o.asset) return buildFiche(o.asset, R);
  return R;
}

/* ---------------- Notes aux états financiers (NC 05 §100 à §107) ---------------- */
function buildNotes(y, assets, R) {
  const cfg = engineCfg(), E = EN.exo(y, cfg), ref = referentiel();
  R.doc = true; R.sections = []; R.orient = 'p';
  const sec = (title, paras, table) => R.sections.push({ title: title, paras: (paras || []).filter(Boolean), table: table || null });
  const vals = assets.map((a) => ({ a: a, s: sched(a), v: EN.yearValues(a, sched(a), y, cfg) })).filter((x) => x.v.exists);
  const proLab = { jours: 'jours exacts', mois: 'mois entiers', j360: 'jours sur une base de 360' }[cfg.prorata] || 'jours exacts';

  sec('Principes et méthodes comptables', [
    'Les immobilisations corporelles sont comptabilisées et évaluées conformément à la norme comptable NC 05 « Immobilisations corporelles » ; les immobilisations incorporelles suivent la NC 06.',
    'Évaluation initiale. Les immobilisations sont inscrites au coût : prix d\'achat net des remises et rabais, droits et taxes non récupérables, frais directement attribuables à la mise en état d\'utilisation et, le cas échéant, estimation initiale des coûts de démantèlement et de remise en état du site (§19 à §24). Les frais généraux, les frais de démarrage et les pertes initiales d\'exploitation sont constatés en charges. Les subventions d\'investissement ne sont pas déduites du coût (§27).',
    'Composants et dépenses ultérieures. Les composants dont la durée d\'utilité diffère sont comptabilisés et amortis séparément (§12). Les dépenses ultérieures sont immobilisées lorsqu\'elles augmentent les avantages économiques au-delà du niveau de performance initial ; l\'entretien et les réparations courantes sont des charges (§14 à §16).',
    'Amortissement. Le montant amortissable, égal au coût diminué de la valeur résiduelle, est réparti de façon systématique sur la durée d\'utilité, à compter de la date de mise en service, au prorata temporis (' + proLab + '). Le mode retenu reflète le rythme de consommation des avantages économiques (§42 à §49). Les terrains ne sont pas amortis (§46).',
    ref === 'NC05' ? 'Les durées d\'utilité sont estimées par la direction en fonction de l\'usage attendu, de l\'usure physique, de l\'obsolescence technique et des limites juridiques (§44). Elles sont revues à chaque clôture, avec les valeurs résiduelles et les modes ; toute modification est un changement d\'estimation appliqué de manière prospective (§51 à §54, NC 11).' : 'Les durées d\'amortissement correspondent aux taux fiscaux maximum : voir la note spécifique ci-après.',
    'Évaluation postérieure. Chaque catégorie est évaluée selon le modèle du coût (coût diminué du cumul des amortissements et des pertes de valeur) ou selon le modèle de la réévaluation (juste valeur à la date de réévaluation diminuée des amortissements et pertes de valeur ultérieurs) (§28 à §30). Une perte de valeur est constatée lorsque la valeur récupérable est inférieure à la valeur comptable (§55).'
  ], categoryTable(vals, cfg));

  if (ref === 'FISCAL') {
    const cmp = fiscalVsNc05(vals, y, cfg);
    sec('Note spécifique – Amortissements pratiqués selon les taux fiscaux', [
      'Pour la détermination des dotations aux amortissements, la société applique les taux maximum fixés par le décret n° 2008-492 du 25 février 2008, pris en application de l\'article 12 bis du Code de l\'IRPP et de l\'IS, ainsi que, le cas échéant, le coefficient d\'utilisation en deux ou trois équipes (art. 2 du décret) et l\'amortissement intégral des biens de faible valeur (≤ ' + money(S.cfg.fiscal.seuilFaibleValeur) + ' DT).',
      'La direction considère que ces taux traduisent de manière raisonnable le rythme de consommation des avantages économiques des biens concernés (NC 05 §42 et §49). Ils sont revus à chaque clôture ; une modification serait traitée comme un changement d\'estimation, de manière prospective (NC 11).',
      cmp.n ? 'À titre d\'information, si les durées d\'utilité indicatives de chaque catégorie avaient été retenues, la dotation de l\'exercice aurait été de ' + money(cmp.nc05) + ' DT au lieu de ' + money(cmp.fisc) + ' DT, soit un écart de ' + money(cmp.fisc - cmp.nc05) + ' DT (' + cmp.n + ' biens concernés).' : ''
    ], { cols: [T('Catégorie', 70), N('Taux fiscal maximum'), T('Durée implicite'), T('Durée d\'utilité indicative')], rows: cats().filter((c) => c.amortissable && vals.some((x) => x.a.categorie === c.code)).map((c) => [c.code + ' – ' + c.libelle, EN.fmtPct(num(c.tauxFiscal) / 100), num(c.tauxFiscal) > 0 ? EN.fmtYears(EN.normYears(100 / num(c.tauxFiscal))) : '—', num(c.duree) > 0 ? EN.fmtYears(num(c.duree)) : '—']) });
  }

  const tb = buildReport('tableau', { year: y });
  sec('Variation des immobilisations (§100)', ['Le rapprochement détaillé des valeurs brutes, amortissements et pertes de valeur figure dans le tableau de variation des immobilisations. Synthèse par nature :'], { cols: [T('Nature', 60), N('VB début'), N('Entrées'), N('Sorties'), N('VB fin'), N('Amort. et pertes fin'), N('VNC fin')], rows: tb.rows.filter((r) => r.sub).map((r) => [r.cells[0].replace('Sous-total ', 'Immobilisations '), r.cells[1], r.cells[2], r.cells[4], r.cells[6], r.cells[12], r.cells[13]]), foot: tb.foot ? ['Total', tb.foot[1], tb.foot[2], tb.foot[4], tb.foot[6], tb.foot[12], tb.foot[13]] : null });

  let dot = 0, pertes = 0, reprises = 0, cumAm = 0, cumPv = 0;
  vals.forEach((x) => { dot += x.v.dotation; pertes += x.v.pertes; reprises += x.v.reprisesPV; cumAm += x.v.amFinA; cumPv += x.v.pvFin; });
  sec('Dotations et cumuls (§102)', ['Dotations aux amortissements de l\'exercice : ' + money(dot) + ' DT, comptabilisées en charges (compte ' + S.cfg.comptes.dotAmort + '). Pertes de valeur constatées : ' + money(pertes) + ' DT ; reprises : ' + money(reprises) + ' DT. Cumul des amortissements à la clôture : ' + money(cumAm) + ' DT ; cumul des pertes de valeur : ' + money(cumPv) + ' DT.']);

  const enCours = vals.filter((x) => (catOf(x.a.categorie) || {}).enCours).reduce((s, x) => s + x.v.vbFin, 0);
  const nantis = vals.filter((x) => x.a.nanti && x.v.vbFin > 0);
  const info = (S.tenant.notesInfo || {})[y] || {};
  sec('Restrictions, immobilisations en cours et engagements (§101)', [
    'Immobilisations en cours à la clôture : ' + money(enCours) + ' DT.',
    nantis.length ? 'Biens donnés en nantissement ou en garantie : ' + nantis.length + ', pour une valeur comptable de ' + money(nantis.reduce((s, x) => s + x.v.vncFin, 0)) + ' DT.' : 'Aucun bien n\'est donné en nantissement ou en garantie.',
    'Engagements contractuels d\'acquisition : ' + (info.engagements ? info.engagements : 'néant.')
  ], nantis.length ? { cols: [T('Code', 28), T('Désignation', 60), T('Garantie', 50), N('VNC')], rows: nantis.map((x) => [codeTxt(x.a.code), x.a.designation, x.a.nantiDetail || '', x.v.vncFin]) } : null);

  const revs = [];
  vals.forEach((x) => (x.a.events || []).forEach((ev) => {
    if (!['revision', 'demantelement'].includes(ev.type) || EN.exoOf(ev.date, cfg) !== y) return;
    const without = Object.assign({}, x.a, { events: x.a.events.filter((e) => e.id !== ev.id) });
    const s0 = EN.schedule(without, catOf(x.a.categorie), cfg); const r0 = s0.rows.find((r) => r.year === y); const r1 = x.s.rows.find((r) => r.year === y);
    revs.push([fdate(ev.date), codeTxt(x.a.code), x.a.designation, ev.type === 'revision' ? (ev.motif || 'Révision') : 'Démantèlement', r3((r1 ? r1.dot : 0) - (r0 ? r0.dot : 0))]);
  }));
  sec('Changements d\'estimations (§103, NC 11)', [revs.length ? 'Les estimations suivantes ont été révisées au cours de l\'exercice ; l\'effet est pris en compte de manière prospective.' : 'Aucun changement d\'estimation (durées d\'utilité, valeurs résiduelles, modes, coûts de démantèlement) n\'a été constaté au cours de l\'exercice.'], revs.length ? { cols: [T('Date'), T('Code', 26), T('Désignation', 50), T('Nature', 50), N('Effet sur la dotation')], rows: revs } : null);

  const reevalAssets = vals.filter((x) => (x.a.events || []).some((e) => e.type === 'reevaluation' && e.date <= E.end));
  if (reevalAssets.length) {
    let ecD = 0, ecH = 0, ecB = 0, ecV = 0, ecF = 0;
    const rows = reevalAssets.map((x) => {
      const r = x.v.row; ecD += x.v.ecartDebut; ecF += x.v.ecartFin;
      if (r) { ecH += r.ecartHausse + r.repriseEcart; ecB += r.ecartBaisse + r.perteEcart; ecV += r.ecartVire; }
      const last = (x.a.events || []).filter((e) => e.type === 'reevaluation' && e.date <= E.end).sort((p, q) => String(q.date).localeCompare(String(p.date)))[0];
      const hist = EN.schedule(x.a, catOf(x.a.categorie), cfg, { ignoreReeval: true });
      const hv = EN.yearValues(x.a, hist, y, cfg);
      return [codeTxt(x.a.code), x.a.designation, fdate(last.date), (last.methode || '') + (last.evaluateur ? ' – ' + last.evaluateur + (last.independant ? ' (indépendant)' : '') : ''), x.v.vncFin, hv.vncFin, x.v.ecartFin];
    });
    const sortiesEcart = vals.filter((x) => x.a.sortie && x.a.sortie.date >= E.start && x.a.sortie.date <= E.end).reduce((s, x) => s + EN.sortieCalc(x.a, catOf(x.a.categorie) || {}, cfg).ecartVire, 0);
    sec('Immobilisations réévaluées (§104)', [
      'Les catégories suivantes sont évaluées selon le modèle de la réévaluation. Les justes valeurs reposent sur la méthode indiquée pour chaque bien ; les amortissements cumulés sont éliminés contre la valeur brute à la date de réévaluation (§34 b).',
      'Écart de réévaluation : solde d\'ouverture ' + money(ecD) + ' DT, augmentations ' + money(ecH) + ' DT, diminutions ' + money(ecB) + ' DT, virements aux résultats reportés ' + money(ecV + sortiesEcart) + ' DT, solde de clôture ' + money(ecF) + ' DT. L\'écart n\'est pas distribuable tant qu\'il n\'est pas réalisé.'
    ], { cols: [T('Code', 24), T('Désignation', 44), T('Date'), T('Méthode et évaluateur', 48), N('Valeur comptable'), N('Selon le modèle du coût'), N('Écart de réévaluation')], rows: rows });
  }

  const tests = [];
  vals.forEach((x) => x.s.events.filter((e) => e.type === 'test' && e.year === y && (e.resultat === 'perte' || e.resultat === 'reprise')).forEach((e) => {
    const src = (x.a.events || []).find((z) => z.id === e.id) || {};
    tests.push([fdate(e.date), codeTxt(x.a.code), x.a.designation, (src.indices || []).map((k) => (EN.INDICES[k] || k).replace(/ \(§57 .\)/, '')).join(' ; ') || (src.motif || ''), e.resultat === 'perte' ? -e.perte : e.reprise, e.baseRA === 'vu' ? 'Valeur d\'utilité' + (src.tauxActualisation ? ' (taux ' + src.tauxActualisation + ' %)' : '') : 'Juste valeur' + (src.baseJV ? ' – ' + src.baseJV : '')]);
  }));
  sec('Pertes de valeur et reprises (§105 et §106)', [tests.length ? 'Les pertes de valeur (montants négatifs) et reprises (montants positifs) suivantes ont été comptabilisées au cours de l\'exercice.' : 'Aucune perte de valeur ni reprise n\'a été comptabilisée au cours de l\'exercice.' + (((S.tenant.evaluation || {})[y] || {}).indices ? ' La revue des indices de perte de valeur a été réalisée le ' + fdate(S.tenant.evaluation[y].indices.date) + '.' : '')], tests.length ? { cols: [T('Date'), T('Code', 24), T('Désignation', 40), T('Événements et circonstances', 54), N('Montant'), T('Base de la valeur récupérable', 40)], rows: tests } : null);

  const idle = vals.filter((x) => x.v.vbFin > 0 && x.a.etat === 'Temporairement inutilisé');
  const fully = vals.filter((x) => x.v.vbFin > 0 && x.s.mode !== 'N' && x.v.vncFin - num(x.a.vr) <= 0.001 && x.a.etat !== 'Hors service');
  const hs = vals.filter((x) => x.v.vbFin > 0 && x.a.etat === 'Hors service');
  const sumVb = (l) => money(l.reduce((s, x) => s + x.v.vbFin, 0));
  sec('Informations complémentaires (§107)', [
    'Biens temporairement inutilisés : ' + idle.length + ' (valeur comptable ' + money(idle.reduce((s, x) => s + x.v.vncFin, 0)) + ' DT).',
    'Biens entièrement amortis encore en usage : ' + fully.length + ' (valeur brute ' + sumVb(fully) + ' DT).',
    'Biens hors service non encore sortis de l\'actif : ' + hs.length + ' (valeur brute ' + sumVb(hs) + ' DT).',
    info.autres || ''
  ]);

  const dem = vals.filter((x) => x.a.demantelement && x.v.row);
  if (dem.length) {
    const t = dem.reduce((s, x) => ({ d: s.d + x.v.row.provDemDebut, u: s.u + x.v.row.desact, f: s.f + x.v.row.provDemFin }), { d: 0, u: 0, f: 0 });
    sec('Provisions pour démantèlement et remise en état (§82 à §99)', ['Provision d\'ouverture ' + money(t.d) + ' DT, désactualisation de l\'exercice ' + money(t.u) + ' DT (charges financières), révisions comprises, provision de clôture ' + money(t.f) + ' DT.']);
  }
  const subs = vals.filter((x) => x.a.subvention && x.v.row);
  if (subs.length) sec('Subventions d\'investissement (NC 12)', ['Quote-part des subventions d\'investissement virée au résultat de l\'exercice (compte ' + S.cfg.comptes.quotePartSub + ') : ' + money(subs.reduce((s, x) => s + x.v.row.subQP, 0)) + ' DT ; solde restant à virer : ' + money(subs.reduce((s, x) => s + x.v.row.subRest, 0)) + ' DT.']);
  if (S.cfg.modules.fiscal) {
    const f = buildReport('fiscal', { year: y });
    sec('Incidence fiscale', ['Les retraitements fiscaux liés aux immobilisations sont présentés dans le passage comptable / fiscal des amortissements. ' + (f.notes[0] || '')]);
  }
  return R;
}
function categoryTable(vals, cfg) {
  const by = {};
  vals.forEach((x) => { if (!(x.v.vbFin > 0 || x.v.sorties > 0)) return; const k = x.a.categorie; (by[k] = by[k] || []).push(x); });
  return { cols: [T('Catégorie', 64), T('Modèle d\'évaluation', 34), T('Mode d\'amortissement', 36), T('Durée d\'utilité ou taux', 40)], rows: Object.keys(by).sort().map((k) => {
    const c = catOf(k) || {}; const l = by[k];
    const modes = Array.from(new Set(l.map((x) => EN.MODES[x.s.mode]))).join(', ');
    const durs = l.filter((x) => ['L', 'A', 'D'].includes(x.s.mode)).map((x) => x.s.dureeEffective);
    let d = '—';
    if (durs.length) { const mn = Math.min.apply(null, durs), mx = Math.max.apply(null, durs); d = Math.abs(mx - mn) < 0.01 ? EN.fmtYears(mn) + ' (' + EN.fmtPct(1 / mn) + ')' : EN.fmtYears(mn) + ' à ' + EN.fmtYears(mx); }
    else if (l.some((x) => x.s.mode === 'UO')) d = 'Unités produites';
    return [k + ' – ' + (c.libelle || ''), c.modele === 'reevaluation' && c.type !== 'I' ? 'Réévaluation' : 'Coût', modes, d];
  }) };
}
function fiscalVsNc05(vals, y, cfg) {
  const cfg2 = Object.assign({}, cfg, { referentiel: 'NC05' });
  let fisc = 0, nc05 = 0, n = 0;
  vals.forEach((x) => {
    if (EN.has(x.a.duree) || EN.has(x.a.taux)) return;
    const c = catOf(x.a.categorie); if (!c || !c.amortissable || !(num(c.duree) > 0)) return;
    const b = Object.assign({}, x.a, { mode: ['A', 'I'].includes(x.a.mode) ? 'L' : x.a.mode });
    const s2 = EN.schedule(b, c, cfg2); const r2 = s2.rows.find((r) => r.year === y);
    fisc += x.v.dotation; nc05 += r2 ? r2.dot : 0; n++;
  });
  return { fisc: r3(fisc), nc05: r3(nc05), n: n };
}
/* ---------------- Fiche d'un bien ---------------- */
function buildFiche(a, R) {
  const s = sched(a), cfg = engineCfg(), cat = catOf(a.categorie) || {};
  R.doc = true; R.orient = 'l'; R.title = 'Fiche immobilisation'; R.subtitle = codeTxt(a.code) + ' – ' + a.designation;
  R.sections = [];
  const kv = [['Catégorie', catLabel(a.categorie)], ['Emplacement', empLabel(a.emplacement)], ['Mode d\'entrée', EN.ENTREES[a.entree || 'achat']], ['Date d\'acquisition', fdate(a.dateAcq)], ['Mise en service', fdate(a.dateMES || a.dateAcq)], ['Coût d\'entrée HT', money(a.valeur) + ' DT'], ['Valeur résiduelle', money(a.vr || 0)], ['Mode et durée', (EN.MODES[s.mode] || '') + (['L', 'A', 'D'].includes(s.mode) ? ' – ' + EN.fmtYears(s.dureeEffective) : '')], ['Modèle d\'évaluation', cat.modele === 'reevaluation' ? 'Réévaluation' : 'Coût'], ['Plafond fiscal', s.regime.libelle], ['Fournisseur / facture', (a.fournisseur || '—') + ' / ' + (a.facture || '—')], ['Pièce comptable d\'entrée', a.pieceCompta || 'à renseigner'], ['Marque / modèle', a.marque || '—']];
  if (cat.roulant || a.immatriculation || a.chassis) kv.push(['Immatriculation', a.immatriculation || '—'], ['N° de châssis', a.chassis || '—']);
  if (serieRelevant(cat) || a.numSerie) kv.push(['N° de série', a.numSerie || '—']);
  if (a.garantie && num(a.garantie.duree) > 0) { const gf = EN.garantieFin(a); kv.push(['Garantie', String(a.garantie.duree).replace('.', ',') + ' ' + (a.garantie.unite === 'ans' ? 'an(s)' : 'mois') + (gf ? ' – jusqu\'au ' + fdate(gf) : '') + (a.garantie.conditions ? ' – ' + a.garantie.conditions : '')]); }
  if (a.sortie) { const sc = EN.sortieCalc(a, cat, cfg); kv.push(['Sortie', a.sortie.type + ' le ' + fdate(a.sortie.date)], ['Résultat de sortie', money(sc.resCompta) + ' DT (fiscal ' + money(sc.resFiscal) + ')']); }
  R.sections.push({ title: 'Identification', kv: kv });
  if ((a.contrats || []).length) R.sections.push({ title: 'Contrats et actes enregistrés', table: { cols: [T('Nature', 60), T('N° d\'enregistrement', 34), T('Date'), T('Recette des finances', 40), T('Cocontractant', 50)], rows: a.contrats.map((c) => [c.type || '', c.numero || '', fdate(c.date), c.recette || '', c.cocontractant || '']) } });
  R.sections.push({ title: 'Plan d\'amortissement (NC 05)', table: { cols: [T('Exercice'), N('VNC début'), N('Entrées'), N('Dotation'), N('Pertes / reprises'), N('Réévaluation'), N('VNC fin'), N('Amort. cumulés'), N('Pertes cumulées')], rows: s.rows.map((r) => [EN.exoLabel(r.year, cfg), r3(r.gDebut - r.amDebut - r.pvDebut), r3(r.vbComplements + r.vbDem), r.dot, r3(r.pvRep - r.pvDot), r3(r.vbReeval + r.amElim + r.pvElim), r.vnc, r.amFin, r.pvFin]) } });
  if (S.cfg.modules.fiscal) R.sections.push({ title: 'Plan fiscal', table: { cols: [T('Exercice'), N('Dotation comptable'), N('Plafond fiscal'), N('Déductible'), N('Réintégré'), N('Déduction ultérieure'), N('Autres réintégrations'), N('Autres déductions')], rows: s.rows.map((r) => [EN.exoLabel(r.year, cfg), r.dot, r.cap, r.ded, r.reint, r.dedAnt, r.reintAutres, r.dedAutres]) } });
  if ((a.events || []).length) R.sections.push({ title: 'Événements d\'évaluation', table: { cols: [T('Date'), T('Nature', 50), T('Détail', 120), T('Pièce', 30)], rows: (a.events || []).slice().sort((p, q) => String(p.date).localeCompare(String(q.date))).map((ev) => [fdate(ev.date), EN.EVENT_TYPES[ev.type] || ev.type, eventSummary(ev, s.events.find((e) => e.id === ev.id) || {}).replace(/<[^>]+>/g, ''), ev.pieceCompta || '']) } });
  R.sections.push({ title: 'Mouvements et pièces comptables', table: { cols: [T('Date'), T('Mouvement', 60), N('Montant'), T('Justificatif', 80), T('Réf. pièce comptable', 36)], rows: assetMovements(a).sort((p, q) => String(p.date).localeCompare(String(q.date))).map((m) => [fdate(m.date), m.label, m.montant === '' ? '' : m.montant, m.justif || '', m.piece || (m.compta ? 'à renseigner' : '—')]) } });
  return R;
}

/* ---------------- Affichage ---------------- */
function cellTxt(v, col) { if (col && col.num) return (v === '' || v === null || v === undefined) ? '' : (typeof v === 'number' ? money(v) : esc(v)); return esc(v === null || v === undefined ? '' : v); }
function tableHtml(t) {
  const head = '<tr>' + t.cols.map((c) => '<th class="' + (c.num ? 'num' : '') + '">' + esc(c.h) + '</th>').join('') + '</tr>';
  const body = t.rows.map((r) => {
    if (r.group) return '<tr class="group"><td colspan="' + t.cols.length + '">' + esc(r.group) + '</td></tr>';
    if (r.sub) return '<tr style="font-weight:600;background:#FBFAFE">' + r.cells.map((v, i) => '<td class="' + (t.cols[i].num ? 'num' : '') + '">' + cellTxt(v, t.cols[i]) + '</td>').join('') + '</tr>';
    return '<tr>' + r.map((v, i) => '<td class="' + (t.cols[i].num ? 'num' : (/Code/.test(t.cols[i].h) ? 'code' : '')) + '">' + cellTxt(v, t.cols[i]) + '</td>').join('') + '</tr>';
  }).join('');
  const foot = t.foot ? '<tfoot><tr>' + t.foot.map((v, i) => '<td class="' + (t.cols[i].num ? 'num' : '') + '">' + cellTxt(v, t.cols[i]) + '</td>').join('') + '</tr></tfoot>' : '';
  return '<div class="tbl-wrap"><table class="tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody>' + foot + '</table></div>';
}
function reportHtml(R) {
  if (R.doc) return '<div class="notes-doc">' + R.sections.map((s, i) => '<section><h4>' + (R.key === 'notes' ? (i + 1) + '. ' : '') + esc(s.title) + '</h4>' + (s.kv ? '<dl class="dl">' + s.kv.map((kv) => '<div><dt>' + esc(kv[0]) + '</dt><dd>' + esc(kv[1]) + '</dd></div>').join('') + '</dl>' : '') + (s.paras || []).map((p) => '<p>' + esc(p) + '</p>').join('') + (s.table && s.table.rows.length ? tableHtml(s.table) : '') + '</section>').join('') + '</div>';
  if (!R.rows.length) return '<div class="empty"><b>Aucune donnée pour cet exercice et ces filtres.</b></div>';
  return tableHtml(R) + (R.notes.length ? '<div class="note" style="margin-top:12px">' + R.notes.map(esc).join('<br>') + '</div>' : '');
}

TITLES.rapports = { title: 'Rapports et notes', year: true, tenant: true };
VIEWS.rapports = function () {
  const f = S.ui.rf || (S.ui.rf = { key: 'tableau', cat: '', emp: '' });
  const keys = Object.keys(REPORTS).filter((k) => !REPORTS[k].fiscal || S.cfg.modules.fiscal);
  if (keys.indexOf(f.key) === -1) f.key = keys[0];
  const R = buildReport(f.key, { cat: f.cat, emp: f.emp });
  const info = (S.tenant.notesInfo || {})[S.year] || {};
  const pieceForm = f.key === 'journal' || f.key === 'mouvements' ? '<div class="toolbar" style="margin-bottom:14px;align-items:end"><label class="field"><span>Réf. pièce des écritures d\'inventaire ' + S.year + ' (dotations, pertes, reprises…)</span><input id="pi-ref" value="' + esc((S.tenant.piecesInventaire || {})[S.year] || '') + '" placeholder="Ex. OD-' + S.year + '-12-031"></label><button class="btn sm" data-act="pi-save">Enregistrer</button></div>' : '';
  const notesForm = f.key === 'notes' ? '<details class="more" style="margin-bottom:14px"><summary>Compléter les informations de l\'exercice (§101 et §107)</summary><div class="form"><label class="field"><span>Engagements contractuels d\'acquisition d\'immobilisations</span><textarea id="ni-eng" rows="2">' + esc(info.engagements || '') + '</textarea></label><label class="field"><span>Autres informations (juste valeur des biens au coût, restrictions…)</span><textarea id="ni-aut" rows="2">' + esc(info.autres || '') + '</textarea></label><div class="actions"><button class="btn sm" data-act="ni-save">Enregistrer</button></div></div></details>' : '';
  return '<div class="page-head"><div><h2>' + esc(REPORTS[f.key].label) + '</h2><p>' + esc(REPORTS[f.key].desc) + '</p></div><div class="actions"><button class="btn ghost" data-act="rep-export" data-fmt="xlsx">' + icon('dl') + 'Excel</button><button class="btn" data-act="rep-export" data-fmt="pdf">' + icon('dl') + 'PDF</button><button class="btn ghost" data-act="rep-all">Dossier annuel complet (Excel)</button></div></div>' +
    '<div class="panel"><div class="toolbar" style="margin-bottom:14px"><label class="field wide"><span>Rapport</span><select data-change="rf-key">' + keys.map((k) => '<option value="' + k + '"' + sel(k, f.key) + '>' + esc(REPORTS[k].label) + '</option>').join('') + '</select></label>' +
    (REPORTS[f.key].doc ? '' : '<label class="field"><span>Catégorie</span><select data-change="rf-cat"><option value="">Toutes</option>' + cats().map((c) => '<option value="' + esc(c.code) + '"' + sel(c.code, f.cat) + '>' + esc(c.code + ' – ' + c.libelle) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Emplacement</span><select data-change="rf-emp"><option value="">Tous</option>' + emps().map((e) => '<option value="' + esc(e.code) + '"' + sel(e.code, f.emp) + '>' + esc(e.code + ' – ' + e.libelle) + '</option>').join('') + '</select></label>') + '</div>' +
    pieceForm + notesForm + '<div class="muted" style="font-size:12.5px;margin-bottom:10px">' + esc(R.subtitle) + ' · montants en dinars tunisiens (DT)</div>' + reportHtml(R) + '</div>';
};
CHANGE['rf-key'] = (el) => { S.ui.rf.key = el.value; render(); };
CHANGE['rf-cat'] = (el) => { S.ui.rf.cat = el.value; render(); };
CHANGE['rf-emp'] = (el) => { S.ui.rf.emp = el.value; render(); };
ACT['rep-export'] = (el) => { const f = S.ui.rf; exportReport(f.key, el.dataset.fmt, REPORTS[f.key].doc ? {} : { cat: f.cat, emp: f.emp }); };
ACT['rep-quick'] = (el) => { exportReport(el.dataset.rep, 'xlsx'); };
ACT['asset-pdf'] = (el) => { const a = assetById(el.dataset.id); if (a) exportReport('plan', 'pdf', { asset: a }); };
ACT['rep-all'] = () => exportAllXlsx();
ACT['pi-save'] = async () => {
  S.tenant.piecesInventaire = S.tenant.piecesInventaire || {};
  S.tenant.piecesInventaire[S.year] = $('#pi-ref').value.trim();
  if (await saveTenant(true)) { toast('Référence enregistrée.', 'ok'); render(); }
};
ACT['rep-open'] = (el) => { S.ui.rf = Object.assign(S.ui.rf || { cat: '', emp: '' }, { key: el.dataset.rep }); go('rapports'); };
ACT['ni-save'] = async () => {
  S.tenant.notesInfo = S.tenant.notesInfo || {};
  S.tenant.notesInfo[S.year] = { engagements: $('#ni-eng').value.trim(), autres: $('#ni-aut').value.trim() };
  if (await saveTenant(true)) { toast('Informations enregistrées.', 'ok'); render(); }
};

/* ---------------- Export ---------------- */
function fileBase(R) { return (R.title || 'Rapport').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) + '_' + (S.tenant ? S.tenant.codeSociete : 'CTB') + '_' + S.year; }
function exportReport(key, fmt, o) {
  const R = buildReport(key, o || {});
  if (!R.doc && !R.rows.length) { toast('Aucune donnée à exporter.', 'bad'); return; }
  if (fmt === 'xlsx') return xlsxExport([R], fileBase(R) + '.xlsx');
  return pdfExport(R);
}
function exportAllXlsx() {
  const keys = Object.keys(REPORTS).filter((k) => !REPORTS[k].fiscal || S.cfg.modules.fiscal);
  xlsxExport(keys.map((k) => buildReport(k, {})), 'Dossier_immobilisations_' + S.tenant.codeSociete + '_' + S.year + '.xlsx');
}
function aoaTable(aoa, t, numCells) {
  aoa.push(t.cols.map((c) => c.h));
  const push = (cells) => { const ri = aoa.length; aoa.push(cells); t.cols.forEach((c, ci) => { if (c.num && typeof cells[ci] === 'number') numCells.push([ri, ci]); }); };
  t.rows.forEach((r) => { if (r.group) aoa.push([r.group]); else push(r.sub ? r.cells : r); });
  if (t.foot) push(t.foot);
}
function xlsxExport(reports, filename) {
  if (!window.XLSX) { toast('La bibliothèque Excel n\'est pas encore chargée. Réessayez dans un instant.', 'bad'); return; }
  const wb = window.XLSX.utils.book_new();
  const used = new Set();
  reports.forEach((R) => {
    const aoa = [[R.title], [S.tenant ? S.tenant.raison + (S.tenant.mf ? ' – MF ' + S.tenant.mf : '') : ''], [R.subtitle + ' – montants en DT'], []];
    const numCells = [];
    let widths = [];
    if (R.doc) {
      R.sections.forEach((s, i) => {
        aoa.push([(R.key === 'notes' ? (i + 1) + '. ' : '') + s.title]);
        (s.kv || []).forEach((kv) => aoa.push([kv[0], kv[1]]));
        (s.paras || []).forEach((p) => aoa.push([p]));
        if (s.table && s.table.rows.length) { aoaTable(aoa, s.table, numCells); if (s.table.cols.length > widths.length) widths = s.table.cols; }
        aoa.push([]);
      });
    } else {
      aoaTable(aoa, R, numCells); widths = R.cols;
      if (R.notes.length) { aoa.push([]); R.notes.forEach((n) => aoa.push([n])); }
    }
    aoa.push([]); aoa.push([S.cfg.reportFooter + ' – édité le ' + fdate(EN.today())]);
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    numCells.forEach((rc) => { const ref = window.XLSX.utils.encode_cell({ r: rc[0], c: rc[1] }); if (ws[ref]) { ws[ref].t = 'n'; ws[ref].z = '#,##0.000'; } });
    ws['!cols'] = (widths.length ? widths : [T('', 60)]).map((c, i) => ({ wch: R.doc && i === 0 ? 60 : (c.num ? 16 : Math.max(10, Math.min(48, Math.round((c.w || 18) * 0.8)))) }));
    let name = ({ tableau: 'Variation', notes: 'Notes', registre: 'Registre', fiscal: 'Passage fiscal', sorties: 'Sorties', journal: 'Écritures', mouvements: 'Mouvements et pièces', emplacement: 'Emplacements', inventaire: 'Inventaire', plan: 'Fiche' }[R.key] || R.title).slice(0, 28).replace(/[\\/?*\[\]:]/g, ' ');
    while (used.has(name)) name = name.slice(0, 26) + ' ' + used.size;
    used.add(name);
    window.XLSX.utils.book_append_sheet(wb, ws, name);
  });
  const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFile(filename, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

function pdfTxt(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[‘’ʼ]/g, '\'').replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/•/g, '-')
    .replace(/[   ]/g, ' ').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/→/g, '->').replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/[^\x00-\xFF]/g, '');
}
function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [34, 7, 63]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
let logoInfo = null;
function getLogo() {
  const src = logoSrc();
  if (!src) return Promise.resolve(null);
  if (logoInfo && logoInfo.src === src) return Promise.resolve(logoInfo);
  return new Promise((res) => { const im = new Image(); im.onload = () => { logoInfo = { src: src, w: im.naturalWidth, h: im.naturalHeight }; res(logoInfo); }; im.onerror = () => res(null); im.src = src; });
}
/** Enregistre Mozilla Headline dans le document PDF ; repli sur Helvetica si besoin. */
function pdfHeadFont(doc) {
  if (doc.__mh !== undefined) return doc.__mh;
  doc.__mh = false;
  try {
    if (window.CTB_PDF_FONT && window.CTB_PDF_FONT.length > 1000) {
      doc.addFileToVFS('MozillaHeadline.ttf', window.CTB_PDF_FONT);
      doc.addFont('MozillaHeadline.ttf', 'MozillaHeadline', 'normal');
      doc.__mh = true;
    }
  } catch (e) { console.warn('Police PDF', e); doc.__mh = false; }
  return doc.__mh;
}
function setHead(doc, size) { if (pdfHeadFont(doc)) doc.setFont('MozillaHeadline', 'normal'); else doc.setFont('helvetica', 'bold'); doc.setFontSize(size); }
async function newPdf(orient) {
  if (!window.jspdf || !window.jspdf.jsPDF) { toast('La bibliothèque PDF n\'est pas encore chargée. Réessayez dans un instant.', 'bad'); return null; }
  const doc = new window.jspdf.jsPDF({ orientation: orient === 'p' ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' });
  if (typeof doc.autoTable !== 'function') { toast('Module de tableaux PDF indisponible.', 'bad'); return null; }
  pdfHeadFont(doc);
  return doc;
}
async function pdfHeader(doc) {
  const W = doc.internal.pageSize.getWidth();
  const bg = hexRgb(S.cfg.colors.bg), ac = hexRgb(S.cfg.colors.accent);
  const logo = await getLogo();
  return () => {
    doc.setFillColor(bg[0], bg[1], bg[2]); doc.rect(0, 0, W, 20, 'F');
    doc.setFillColor(ac[0], ac[1], ac[2]); doc.rect(0, 20, W, 1.2, 'F');
    let lx = 12;
    if (logo) { const h = 11, w = Math.min(40, logo.w / logo.h * h); try { doc.addImage(logo.src, 'PNG', 12, 4.5, w, h); lx = 12 + w + 4; } catch (e) { /* rien */ } }
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.2); doc.line(lx - 1.5, 5.5, lx - 1.5, 14.5);
    doc.setTextColor(255, 255, 255); setHead(doc, 15); doc.text(pdfTxt(S.cfg.appName || 'immo'), lx + 1, 11.2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text('Cabinet Tahar Bakir - expertise comptable, audit, conseil', lx + 1, 15);
    doc.setTextColor(255, 255, 255); setHead(doc, 12);
    doc.text(pdfTxt(S.tenant ? S.tenant.raison : S.cfg.appName), W - 12, 10.5, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(pdfTxt(S.tenant ? ((S.tenant.mf ? 'MF ' + S.tenant.mf + ' - ' : '') + 'code société ' + S.tenant.codeSociete) : ''), W - 12, 15, { align: 'right' });
  };
}
function pdfFooter(doc) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120, 105, 145);
    doc.text(pdfTxt(S.cfg.reportFooter + ' - édité le ' + fdate(EN.today())), 12, H - 7);
    doc.text('Page ' + p + ' / ' + pages, W - 12, H - 7, { align: 'right' });
  }
}
function pdfTableOpts(doc, t, startY, header) {
  const ac = hexRgb(S.cfg.colors.accent), soft = hexRgb(S.cfg.colors.soft);
  const body = t.rows.map((r) => {
    if (r.group) return [{ content: pdfTxt(r.group), colSpan: t.cols.length, styles: { fillColor: [247, 244, 255], textColor: ac, fontStyle: 'bold' } }];
    const cells = r.sub ? r.cells : r;
    return cells.map((v, i) => ({ content: t.cols[i].num ? (v === '' || v === null || v === undefined ? '' : (typeof v === 'number' ? pdfTxt(money(v)) : pdfTxt(v))) : pdfTxt(v), styles: r.sub ? { fontStyle: 'bold', fillColor: [251, 250, 254] } : {} }));
  });
  const colStyles = {};
  const wide = t.cols.length > 11;
  t.cols.forEach((c, i) => { colStyles[i] = c.num ? (c.w ? { halign: 'right', minCellWidth: c.w * 0.85 } : { halign: 'right' }) : (wide && c.w && c.w >= 40 ? { cellWidth: Math.min(44, c.w * 0.85) } : {}); });
  return {
    startY: startY, head: [t.cols.map((c) => pdfTxt(c.h))], body: body,
    foot: t.foot ? [t.foot.map((v, i) => ({ content: t.cols[i].num ? (typeof v === 'number' ? pdfTxt(money(v)) : pdfTxt(v)) : pdfTxt(v), styles: { halign: t.cols[i].num ? 'right' : 'left' } }))] : undefined,
    theme: 'grid', margin: { left: 12, right: 12, top: 26, bottom: 16 },
    styles: { font: 'helvetica', fontSize: t.cols.length > 12 ? 5.6 : (t.cols.length > 10 ? 6.2 : (t.cols.length > 8 ? 7 : 7.8)), cellPadding: wide ? 1.1 : 1.5, lineColor: [228, 221, 240], lineWidth: 0.15, textColor: [29, 16, 48], overflow: 'linebreak' },
    headStyles: { fillColor: soft, textColor: [29, 16, 48], fontStyle: 'bold', halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [241, 236, 255], textColor: [29, 16, 48], fontStyle: 'bold' },
    columnStyles: colStyles, showFoot: 'lastPage', didDrawPage: () => header()
  };
}
async function pdfExport(R) {
  const doc = await newPdf(R.orient);
  if (!doc) return;
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const header = await pdfHeader(doc);
  const ac = hexRgb(S.cfg.colors.accent);
  header();
  doc.setTextColor(29, 16, 48); setHead(doc, 19);
  doc.text(pdfTxt(R.title), 12, 32);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(93, 82, 116);
  doc.text(pdfTxt(R.subtitle + (R.key === 'manuel' ? '' : ' - montants en dinars tunisiens')), 12, 38);
  let y = 44;
  const ensure = (h) => { if (y + h > H - 18) { doc.addPage(); header(); y = 30; } };
  if (R.doc) {
    R.sections.forEach((s, i) => {
      if (s.title) {
        ensure(16);
        doc.setTextColor(ac[0], ac[1], ac[2]); setHead(doc, 12.5);
        doc.text(pdfTxt((R.key === 'notes' ? (i + 1) + '. ' : '') + s.title), 12, y); y += 5.5;
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(29, 16, 48);
      if (s.kv) {
        const colW = (W - 24) / 2;
        s.kv.forEach((kv, k) => {
          if (k % 2 === 0) ensure(5.4);
          const cx = 12 + (k % 2) * colW;
          doc.setTextColor(93, 82, 116); doc.text(pdfTxt(kv[0]), cx, y);
          doc.setTextColor(29, 16, 48); doc.setFont('helvetica', 'bold'); doc.text(pdfTxt(kv[1]).slice(0, 70), cx + 40, y); doc.setFont('helvetica', 'normal');
          if (k % 2 === 1 || k === s.kv.length - 1) y += 5.4;
        });
        y += 1;
      }
      (s.paras || []).forEach((p) => {
        const lines = doc.splitTextToSize(pdfTxt(p), W - 24);
        lines.forEach((ln) => { ensure(4.4); doc.text(ln, 12, y); y += 4.1; });
        y += 1.6;
      });
      if (s.table && s.table.rows.length) {
        doc.autoTable(pdfTableOpts(doc, s.table, y, header));
        y = doc.lastAutoTable.finalY + 6;
      } else y += 2;
    });
  } else {
    doc.autoTable(pdfTableOpts(doc, R, y, header));
    y = (doc.lastAutoTable && doc.lastAutoTable.finalY) || y;
    if (R.notes.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(93, 82, 116);
      R.notes.forEach((n) => { const lines = doc.splitTextToSize(pdfTxt(n), W - 24); if (y + 6 + lines.length * 4 > H - 18) { doc.addPage(); header(); y = 28; } doc.text(lines, 12, y + 6); y += lines.length * 4 + 1; });
    }
  }
  if (R.signatures) {
    if (y + 34 > H - 18) { doc.addPage(); header(); y = 28; }
    const sw = (W - 24) / R.signatures.length;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(29, 16, 48);
    R.signatures.forEach((s, i) => { doc.text(pdfTxt(s), 12 + i * sw, y + 14); doc.setDrawColor(200, 190, 220); doc.line(12 + i * sw, y + 32, 12 + i * sw + sw - 10, y + 32); });
  }
  pdfFooter(doc);
  saveFile(fileBase(R) + '.pdf', doc.output('blob'));
}

/* ==========================================================================
   Environnement client : société, référentiel, emplacements, catégories,
   import ; compte client
   ========================================================================== */
TITLES.env = { title: 'Paramètres société', tenant: true };
VIEWS.env = function () {
  const tab = S.ui.envTab || 'soc';
  const t = S.tenant;
  const tabs = [['soc', 'Société et référentiel'], ['emp', 'Emplacements (' + emps().length + ')'], ['cat', 'Catégories (' + cats().length + ')']].concat(S.cfg.modules.import ? [['import', 'Import Excel']] : []);
  let c = '';
  if (tab === 'soc') {
    c = '<form class="form" id="soc-form"><div class="row"><label class="field"><span>Raison sociale</span><input id="s-raison" value="' + esc(t.raison) + '"' + (S.session.role === 'admin' ? '' : ' readonly') + '></label><label class="field"><span>Code société (codification)</span><input value="' + esc(t.codeSociete) + '" readonly><small>Attribué par le cabinet CTB</small></label>' +
      '<label class="field"><span>Matricule fiscal</span><input id="s-mf" value="' + esc(t.mf || '') + '"></label><label class="field"><span>Activité</span><input id="s-act" value="' + esc(t.activite || '') + '"></label></div>' +
      '<label class="field"><span>Adresse</span><input id="s-adr" value="' + esc(t.adresse || '') + '"></label>' +
      '<div class="row"><label class="field"><span>Date de clôture (jour)</span><input id="s-cj" type="number" min="1" max="31" value="' + esc(t.clotureJour || 31) + '"></label><label class="field"><span>Date de clôture (mois)</span><select id="s-cm">' + ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'].map((m, i) => '<option value="' + (i + 1) + '"' + sel(i + 1, t.clotureMois || 12) + '>' + m + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Prorata temporis</span><select id="s-pro">' + opt([{ v: '', l: 'Référentiel CTB (' + ({ jours: 'jours exacts', mois: 'mois entiers', j360: 'base 360' }[S.cfg.prorata] || 'jours exacts') + ')' }, { v: 'jours', l: 'Jours exacts' }, { v: 'mois', l: 'Mois entiers' }, { v: 'j360', l: 'Base 360 jours' }], t.prorata || '') + '</select></label></div>' +
      '<fieldset class="fs"><legend>Référentiel d\'amortissement comptable</legend>' +
      '<label class="check"><input type="radio" name="s-ref" value="NC05"' + chk(referentiel() === 'NC05') + '> <span><b>NC 05 – durées d\'utilité estimées par la société</b> (recommandé). Les durées reflètent l\'usage attendu ; les écarts avec les taux fiscaux sont traités dans le passage comptable / fiscal.</span></label>' +
      '<label class="check"><input type="radio" name="s-ref" value="FISCAL"' + chk(referentiel() === 'FISCAL') + '> <span><b>Textes fiscaux – taux maximum du décret n° 2008-492</b>. Une note spécifique est générée dans les notes aux états financiers.</span></label>' +
      '<div class="note">Changer de référentiel en cours de vie des biens est un changement d\'estimation (NC 11) : il ne s\'applique qu\'aux biens sans durée propre et produit ses effets de manière prospective. Les durées saisies sur une fiche restent prioritaires.</div></fieldset>' +
      '<fieldset class="fs"><legend>Écart de réévaluation (NC 05 §40)</legend><label class="field"><span>Virement aux résultats reportés</span><select id="s-ecart">' + opt([{ v: 'sortie', l: 'À la sortie du bien uniquement' }, { v: 'utilisation', l: 'Au fur et à mesure de l\'utilisation du bien' }], t.ecartVirement || 'sortie') + '</select><small>Au fur et à mesure : montant égal à la différence entre l\'amortissement sur la valeur réévaluée et celui sur le coût d\'origine.</small></label></fieldset>' +
      '<div class="actions"><button class="btn" type="submit">Enregistrer</button></div></form>';
  } else if (tab === 'emp') {
    c = '<p class="muted" style="margin:0 0 12px">Chaque emplacement porte un numéro à deux chiffres, repris dans le code des immobilisations (positions 5 et 6).</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:90px">N°</th><th>Libellé</th><th>Site / bâtiment</th><th>Responsable</th><th class="num">Biens</th><th></th></tr></thead><tbody>' +
      emps().map((e, i) => { const n = S.assets.filter((a) => a.emplacement === e.code).length; return '<tr><td><input class="em-code mono" data-i="' + i + '" value="' + esc(e.code) + '" maxlength="2"' + (n ? ' readonly title="Numéro utilisé par des biens"' : '') + '></td><td><input class="em-lib" data-i="' + i + '" value="' + esc(e.libelle) + '"></td><td><input class="em-site" data-i="' + i + '" value="' + esc(e.site || '') + '"></td><td><input class="em-resp" data-i="' + i + '" value="' + esc(e.responsable || '') + '"></td><td class="num">' + n + '</td><td>' + (n ? '' : '<button class="btn ghost sm" data-act="emp-del" data-i="' + i + '">Retirer</button>') + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="actions" style="margin-top:12px"><button class="btn ghost" data-act="emp-add">' + icon('plus') + 'Ajouter un emplacement</button><button class="btn" data-act="emp-save">Enregistrer les emplacements</button></div>';
  } else if (tab === 'cat') {
    c = '<p class="muted" style="margin:0 0 12px">Le code catégorie (2 chiffres) entre dans la codification. La durée d\'utilité est l\'estimation comptable de la société (NC 05 §44) ; le taux fiscal est le maximum du décret n° 2008-492. Le modèle d\'évaluation s\'applique à toute la catégorie (§28).</p>' + catTableHtml(cats(), (x) => S.assets.some((a) => a.categorie === x.code)) +
      '<div class="actions" style="margin-top:12px"><button class="btn ghost" data-act="cat-add">' + icon('plus') + 'Ajouter une catégorie</button><button class="btn ghost" data-act="cat-sync">Mettre à jour depuis le référentiel CTB</button><button class="btn" data-act="cat-save">Enregistrer les catégories</button></div>';
  } else if (tab === 'import') c = importPanel();
  return '<div class="page-head"><div><h2>Environnement de ' + esc(t.raison) + '</h2><p>Préparez ici le référentiel d\'amortissement, les emplacements et les catégories avant de saisir les immobilisations.</p></div></div>' +
    '<div class="panel"><div class="tabs">' + tabs.map((x) => '<button class="' + (tab === x[0] ? 'on' : '') + '" data-act="env-tab" data-tab="' + x[0] + '">' + esc(x[1]) + '</button>').join('') + '</div>' + c + '</div>';
};
VIEWS.env.after = function () {
  const f = $('#soc-form');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (S.session.role === 'admin') S.tenant.raison = $('#s-raison').value.trim() || S.tenant.raison;
    const oldRef = referentiel();
    S.tenant.mf = $('#s-mf').value.trim(); S.tenant.activite = $('#s-act').value.trim(); S.tenant.adresse = $('#s-adr').value.trim();
    S.tenant.clotureJour = Math.min(31, Math.max(1, parseInt($('#s-cj').value, 10) || 31)); S.tenant.clotureMois = Number($('#s-cm').value) || 12; S.tenant.prorata = $('#s-pro').value;
    S.tenant.referentiel = ($('input[name="s-ref"]:checked') || {}).value || 'NC05';
    S.tenant.ecartVirement = $('#s-ecart').value;
    schedCache.clear();
    if (await saveTenant()) { if (oldRef !== S.tenant.referentiel) toast('Référentiel modifié : les plans des biens sans durée propre sont recalculés.', ''); S.year = currentExo(); render(); }
  });
  const fi = $('#imp-file');
  if (fi) fi.addEventListener('change', () => importRead(fi.files[0]));
};
ACT['env-tab'] = (el) => { S.ui.envTab = el.dataset.tab; if (S.view !== 'env') go('env'); else render(); };

/* Tableau des catégories (partagé avec le paramétrage administrateur) */
function catTableHtml(list, usedFn) {
  return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Libellé</th><th>Type</th><th>Cpte immo.</th><th>Cpte amort.</th><th>Cpte pertes</th><th>Cpte dot.</th><th>Durée d\'utilité (ans)</th><th>Taux fisc. %</th><th>Modèle</th><th>Fréq. réév. (ans)</th><th>Amortissable</th><th>En cours</th><th>Fiscal</th><th>Équipes</th><th>Roulant</th><th>Voiture de tourisme</th><th></th></tr></thead><tbody>' +
    list.map((x, i) => catRow(x, i, usedFn(x))).join('') + '</tbody></table></div>';
}
function catRow(x, i, used) {
  const ck = (cls, v) => '<input type="checkbox" class="' + cls + '" data-i="' + i + '"' + chk(v) + '>';
  return '<tr><td><input class="ca-code mono" data-i="' + i + '" value="' + esc(x.code) + '" maxlength="2" style="min-width:52px"' + (used ? ' readonly title="Code utilisé par des biens"' : '') + '></td><td><input class="ca-lib" data-i="' + i + '" value="' + esc(x.libelle) + '" style="min-width:210px"></td>' +
    '<td><select class="ca-type" data-i="' + i + '">' + opt([{ v: 'C', l: 'Corporelle' }, { v: 'I', l: 'Incorporelle' }], x.type || 'C') + '</select></td>' +
    '<td><input class="ca-ci mono" data-i="' + i + '" value="' + esc(x.cptImmo || '') + '"></td><td><input class="ca-ca mono" data-i="' + i + '" value="' + esc(x.cptAmort || '') + '"></td><td><input class="ca-cp mono" data-i="' + i + '" value="' + esc(x.cptProv || '') + '"></td><td><input class="ca-cd mono" data-i="' + i + '" value="' + esc(x.cptDot || '') + '"></td>' +
    '<td><input class="ca-du" data-i="' + i + '" value="' + esc(num(x.duree) > 0 ? String(EN.normYears(num(x.duree))).replace('.', ',') : '') + '" inputmode="decimal"></td><td><input class="ca-tf" data-i="' + i + '" value="' + esc(x.tauxFiscal) + '" inputmode="decimal"></td>' +
    '<td><select class="ca-mod" data-i="' + i + '">' + opt([{ v: 'cout', l: 'Coût' }, { v: 'reevaluation', l: 'Réévaluation' }], x.modele || 'cout') + '</select></td><td><input class="ca-fr" data-i="' + i + '" value="' + esc(x.frequenceReeval || 5) + '" inputmode="decimal" style="min-width:60px"></td>' +
    '<td>' + ck('ca-am', x.amortissable) + '</td><td>' + ck('ca-ec', x.enCours) + '</td><td><select class="ca-rf" data-i="' + i + '">' + opt([{ v: 'L', l: 'Déductible' }, { v: 'ND', l: 'Non déductible' }], x.regimeFiscal || 'L') + '</select></td><td>' + ck('ca-eq', x.equipesEligible) + '</td><td title="Immatriculation et n° de châssis au lieu du n° de série">' + ck('ca-ro', x.roulant) + '</td><td>' + ck('ca-vp', x.vehicule) + '</td>' +
    '<td>' + (used ? '' : '<button class="btn ghost sm" data-act="' + (S.tenant ? 'cat-del' : 'pc-del') + '" data-i="' + i + '">Retirer</button>') + '</td></tr>';
}
function readCatRows(list) {
  const g = (cls, i) => { const el = $('.' + cls + '[data-i="' + i + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
  return list.map((x, i) => {
    const du = num(g('ca-du', i));
    const am = !!g('ca-am', i);
    const type = g('ca-type', i);
    return Object.assign({}, x, {
      code: String(g('ca-code', i) || '').trim().padStart(2, '0').slice(-2), libelle: String(g('ca-lib', i) || '').trim(), type: type,
      cptImmo: String(g('ca-ci', i) || '').trim(), cptAmort: String(g('ca-ca', i) || '').trim(), cptProv: String(g('ca-cp', i) || '').trim(), cptDot: String(g('ca-cd', i) || '').trim(),
      duree: am ? du : 0, taux: am && du > 0 ? Math.round(10000 / du) / 100 : 0, tauxFiscal: num(g('ca-tf', i)),
      modele: type === 'I' ? 'cout' : g('ca-mod', i), frequenceReeval: num(g('ca-fr', i)) || 5,
      amortissable: am, enCours: !!g('ca-ec', i), regimeFiscal: g('ca-rf', i), equipesEligible: !!g('ca-eq', i), vehicule: !!g('ca-vp', i), roulant: !!g('ca-ro', i) || !!g('ca-vp', i)
    });
  });
}
function validCats(list) {
  const seen = new Set();
  for (const c of list) {
    if (!/^\d{2}$/.test(c.code)) { toast('Code catégorie invalide : ' + c.code + ' (2 chiffres).', 'bad'); return false; }
    if (seen.has(c.code)) { toast('Code catégorie en double : ' + c.code + '.', 'bad'); return false; }
    if (!c.libelle) { toast('Libellé manquant pour la catégorie ' + c.code + '.', 'bad'); return false; }
    if (c.amortissable && !(c.duree > 0)) { toast('Durée d\'utilité manquante pour la catégorie ' + c.code + '.', 'bad'); return false; }
    if (c.enCours && c.amortissable) { toast('Une catégorie « en cours » n\'est pas amortissable (' + c.code + ').', 'bad'); return false; }
    seen.add(c.code);
  }
  return true;
}
function blankCat(code) { return { code: code, libelle: 'Nouvelle catégorie', type: 'C', cptImmo: '228', cptAmort: '2828', cptProv: '2928', cptDot: '6811', duree: 10, taux: 10, tauxFiscal: 10, amortissable: true, regimeFiscal: 'L', modele: 'cout', frequenceReeval: 5, enCours: false, roulant: false }; }
ACT['cat-add'] = () => { S.tenant.categories = readCatRows(cats()); const used = new Set(cats().map((c) => c.code)); let n = 25; while (used.has(String(n).padStart(2, '0')) && n < 99) n++; S.tenant.categories.push(blankCat(String(n).padStart(2, '0'))); render(); };
ACT['cat-del'] = (el) => { S.tenant.categories = readCatRows(cats()); S.tenant.categories.splice(Number(el.dataset.i), 1); render(); };
ACT['cat-save'] = async () => { const l = readCatRows(cats()); if (!validCats(l)) return; S.tenant.categories = l.sort((a, b) => a.code.localeCompare(b.code)); schedCache.clear(); await saveTenant(); render(); };
ACT['cat-sync'] = async () => {
  const ok = await confirmBox('Mettre à jour depuis le référentiel', '<p>Les taux fiscaux, régimes, comptes de dotation et éligibilités seront alignés sur le référentiel du cabinet CTB, et les catégories manquantes ajoutées. Vos durées d\'utilité, libellés, modèles d\'évaluation et comptes d\'immobilisation sont conservés.</p>', 'Mettre à jour');
  if (!ok) return;
  const list = cats().slice();
  S.cfg.categories.forEach((ref) => {
    const c = list.find((x) => x.code === ref.code);
    if (!c) list.push(clone(ref));
    else Object.assign(c, { tauxFiscal: ref.tauxFiscal, regimeFiscal: ref.regimeFiscal, degressifEligible: ref.degressifEligible, equipesEligible: ref.equipesEligible, vehicule: ref.vehicule, roulant: c.roulant || ref.roulant, enCours: ref.enCours, cptDot: ref.cptDot, note: ref.note });
  });
  S.tenant.categories = list.map(EN.upgradeCategory).sort((a, b) => a.code.localeCompare(b.code)); schedCache.clear(); await saveTenant(); render();
};
function readEmpTable() {
  return emps().map((e, i) => ({ code: String(($('.em-code[data-i="' + i + '"]') || {}).value || '').trim().padStart(2, '0').slice(-2), libelle: String(($('.em-lib[data-i="' + i + '"]') || {}).value || '').trim(), site: String(($('.em-site[data-i="' + i + '"]') || {}).value || '').trim(), responsable: String(($('.em-resp[data-i="' + i + '"]') || {}).value || '').trim() }));
}
ACT['emp-add'] = () => { S.tenant.emplacements = readEmpTable(); const used = new Set(emps().map((e) => e.code)); let n = 1; while (used.has(String(n).padStart(2, '0')) && n < 99) n++; S.tenant.emplacements.push({ code: String(n).padStart(2, '0'), libelle: '', site: '', responsable: '' }); render(); };
ACT['emp-del'] = (el) => { S.tenant.emplacements = readEmpTable(); S.tenant.emplacements.splice(Number(el.dataset.i), 1); render(); };
ACT['emp-save'] = async () => {
  const l = readEmpTable(); const seen = new Set();
  for (const e of l) {
    if (!/^\d{2}$/.test(e.code) || e.code === '00') { toast('Numéro d\'emplacement invalide : ' + e.code + ' (01 à 99).', 'bad'); return; }
    if (seen.has(e.code)) { toast('Numéro d\'emplacement en double : ' + e.code + '.', 'bad'); return; }
    if (!e.libelle) { toast('Libellé manquant pour l\'emplacement ' + e.code + '.', 'bad'); return; }
    seen.add(e.code);
  }
  S.tenant.emplacements = l.sort((a, b) => a.code.localeCompare(b.code)); await saveTenant(); render();
};

/* ---------------- Import Excel ---------------- */
const IMPORT_COLS = ['Désignation', 'Code catégorie', 'Code emplacement', 'Date acquisition', 'Date mise en service', 'Coût d\'entrée HT', 'Mode (L/D/UO/A/I/N)', 'Durée d\'utilité (années)', 'Valeur résiduelle', 'Fournisseur', 'N° facture', 'Réf. pièce comptable', 'N° série', 'Immatriculation', 'N° châssis', 'Garantie (mois)', 'Contrat enregistré (nature)', 'N° enregistrement contrat', 'Date enregistrement contrat', 'Cumul amortissements antérieurs', 'Date de reprise', 'Code existant'];
function importPanel() {
  const p = S.ui.imp;
  let prev = '';
  if (p && p.rows) {
    const ok = p.rows.filter((r) => !r.err).length;
    prev = '<div class="fs" style="margin-top:14px"><div class="panel-head"><b>' + p.rows.length + ' ligne(s) lue(s) · ' + ok + ' valide(s)</b><div class="actions"><button class="btn ghost sm" data-act="imp-reset">Annuler</button><button class="btn sm" data-act="imp-go"' + (ok ? '' : ' disabled') + '>Importer ' + ok + ' bien(s)</button></div></div>' +
      '<div class="tbl-wrap" style="max-height:360px;overflow:auto"><table class="tbl"><thead><tr><th>Ligne</th><th>Désignation</th><th>Cat.</th><th>Empl.</th><th>Acquisition</th><th class="num">Coût</th><th>Mode</th><th>Durée</th><th class="num">Reprise</th><th>Contrôle</th></tr></thead><tbody>' +
      p.rows.map((r) => '<tr><td>' + r.line + '</td><td>' + esc(r.a.designation) + '</td><td>' + esc(r.a.categorie) + '</td><td>' + esc(r.a.emplacement) + '</td><td>' + fdate(r.a.dateAcq) + '</td><td class="num">' + money(r.a.valeur) + '</td><td>' + esc(r.a.mode) + '</td><td>' + esc(EN.has(r.a.duree) ? yrs(num(r.a.duree)) : 'catégorie') + '</td><td class="num">' + (r.a.reprise ? money(r.a.reprise.cumul) : '') + '</td><td>' + (r.err ? '<span class="pill bad">' + esc(r.err) + '</span>' : '<span class="pill ok">OK</span>') + '</td></tr>').join('') + '</tbody></table></div></div>';
  }
  return '<div class="grid-2"><div class="form"><p style="margin:0">Reprenez un registre existant en une fois. Téléchargez le modèle, complétez une ligne par bien, puis chargez le fichier. Les codes sont attribués automatiquement, sauf si la colonne « Code existant » est renseignée (11 caractères).</p>' +
    '<div class="actions"><button class="btn ghost" data-act="imp-template">' + icon('dl') + 'Télécharger le modèle Excel</button></div>' +
    '<label class="field"><span>Fichier à importer (.xlsx, .xls, .csv)</span><input type="file" id="imp-file" accept=".xlsx,.xls,.csv"></label></div>' +
    '<div class="note">Colonnes attendues : ' + IMPORT_COLS.map(esc).join(' · ') + '.<br>Dates au format JJ/MM/AAAA. Durée vide = durée de la catégorie. Pour un bien déjà partiellement amorti, renseignez le cumul et la date de reprise (ouverture de l\'exercice). L\'ancien modèle avec une colonne « Taux % » reste accepté.</div></div>' + prev;
}
ACT['imp-template'] = () => {
  if (!window.XLSX) { toast('La bibliothèque Excel n\'est pas encore chargée.', 'bad'); return; }
  const e1 = (emps()[0] || { code: '01' }).code;
  const ex = (o) => IMPORT_COLS.map((c) => (o[c] === undefined ? '' : o[c]));
  const aoa = [IMPORT_COLS,
    ex({ 'Désignation': 'Exemple – Ordinateur portable', 'Code catégorie': '12', 'Code emplacement': e1, 'Date acquisition': '15/03/2024', 'Coût d\'entrée HT': 2850, 'Mode (L/D/UO/A/I/N)': 'L', 'Durée d\'utilité (années)': 3, 'Valeur résiduelle': 0, 'Fournisseur': 'Fournisseur SARL', 'N° facture': 'F-2024-118', 'Réf. pièce comptable': 'AC-2024-0311', 'N° série': 'SN123456', 'Garantie (mois)': 24, 'Cumul amortissements antérieurs': 1726.25, 'Date de reprise': '01/01/2026' }),
    ex({ 'Désignation': 'Exemple – Camionnette de livraison', 'Code catégorie': '08', 'Code emplacement': e1, 'Date acquisition': '02/09/2025', 'Coût d\'entrée HT': 68500, 'Mode (L/D/UO/A/I/N)': 'L', 'Valeur résiduelle': 0, 'Réf. pièce comptable': 'AC-2025-0907', 'Immatriculation': '215 TU 4587', 'N° châssis': 'VF1FL000123456789', 'Garantie (mois)': 36, 'Contrat enregistré (nature)': 'Contrat de leasing', 'N° enregistrement contrat': '25-123456', 'Date enregistrement contrat': '05/09/2025' })];
  const ws = window.XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = IMPORT_COLS.map(() => ({ wch: 20 }));
  const ref = window.XLSX.utils.aoa_to_sheet([['Code', 'Catégorie', 'Durée d\'utilité (ans)', 'Taux fiscal %']].concat(cats().map((c) => [c.code, c.libelle, c.duree, c.tauxFiscal])).concat([[], ['Code', 'Emplacement']]).concat(emps().map((e) => [e.code, e.libelle])));
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Immobilisations'); window.XLSX.utils.book_append_sheet(wb, ref, 'Référentiels');
  saveFile('Modele_import_immobilisations_' + S.tenant.codeSociete + '.xlsx', new Blob([window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
};
ACT['imp-reset'] = () => { S.ui.imp = null; render(); };
async function importRead(file) {
  if (!file) return;
  if (!window.XLSX) { toast('La bibliothèque Excel n\'est pas encore chargée.', 'bad'); return; }
  try {
    const buf = await readFile(file);
    const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const head = (rows[0] || []).map((h) => String(h).trim().toLowerCase());
    const find = (names) => { for (const n of names) { const i = head.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
    const C = {
      des: find(['Désignation']), cat: find(['Code catégorie']), emp: find(['Code emplacement']), dacq: find(['Date acquisition']), dmes: find(['Date mise en service']),
      val: find(['Coût d\'entrée HT', 'Coût HT']), mode: find(['Mode (L/D/UO/A/I/N)', 'Mode (L/D/A/UO/N)']), duree: find(['Durée d\'utilité (années)']), taux: find(['Taux %']), vr: find(['Valeur résiduelle']),
      four: find(['Fournisseur']), fact: find(['N° facture']), serie: find(['N° série']), cum: find(['Cumul amortissements antérieurs']), rep: find(['Date de reprise']), code: find(['Code existant']),
      pc: find(['Réf. pièce comptable']), immat: find(['Immatriculation']), chassis: find(['N° châssis']), gar: find(['Garantie (mois)']), ctrT: find(['Contrat enregistré (nature)']), ctrN: find(['N° enregistrement contrat']), ctrD: find(['Date enregistrement contrat'])
    };
    if (C.des < 0 || C.val < 0) { toast('Colonnes « Désignation » et « Coût d\'entrée HT » introuvables : utilisez le modèle.', 'bad'); return; }
    const pick = (r, k) => (C[k] >= 0 ? r[C[k]] : '');
    const out = [];
    const tmpAssets = S.assets.slice();
    rows.slice(1).forEach((r, k) => {
      if (!r.some((v) => String(v).trim() !== '')) return;
      const a = { id: uid(), designation: String(pick(r, 'des')).trim(), categorie: String(pick(r, 'cat')).trim().padStart(2, '0'), emplacement: String(pick(r, 'emp')).trim().padStart(2, '0'), entree: 'achat', dateAcq: EN.parseUserDate(pick(r, 'dacq')), dateMES: EN.parseUserDate(pick(r, 'dmes')), valeur: r3(num(pick(r, 'val'))), vr: r3(num(pick(r, 'vr'))), mode: String(pick(r, 'mode') || '').trim().toUpperCase(), duree: '', fournisseur: String(pick(r, 'four')).trim(), facture: String(pick(r, 'fact')).trim(), numSerie: String(pick(r, 'serie')).trim(), etat: (S.cfg.etats || ['Bon'])[0], quantite: 1, fiscal: { regime: 'auto', taux: '' }, custom: {}, events: [] };
      const du = pick(r, 'duree'), tx = pick(r, 'taux');
      if (String(du).trim() !== '' && num(du) > 0) a.duree = num(du); else if (String(tx).trim() !== '' && num(tx) > 0) a.duree = EN.normYears(100 / num(tx));
      a.pieceCompta = String(pick(r, 'pc')).trim(); a.immatriculation = String(pick(r, 'immat')).trim(); a.chassis = String(pick(r, 'chassis')).trim().toUpperCase();
      if (num(pick(r, 'gar')) > 0) a.garantie = { duree: num(pick(r, 'gar')), unite: 'mois', debut: '', conditions: '' };
      const ctrN = String(pick(r, 'ctrN')).trim();
      a.contrats = ctrN ? [{ type: String(pick(r, 'ctrT')).trim() || 'Autre contrat enregistré', numero: ctrN, date: EN.parseUserDate(pick(r, 'ctrD')) || '', recette: '', cocontractant: '' }] : [];
      const cum = num(pick(r, 'cum')), rd = EN.parseUserDate(pick(r, 'rep'));
      if (cum > 0) a.reprise = { date: rd || EN.exo(currentExo(), engineCfg()).start, cumul: r3(cum), cumulFiscal: '' };
      const cat = catOf(a.categorie);
      if (!a.mode || !EN.MODES[a.mode] || (cat && !modeChoices(cat).includes(a.mode))) a.mode = cat && cat.amortissable ? 'L' : 'N';
      let err = '';
      if (!a.designation) err = 'Désignation vide';
      else if (!cat) err = 'Catégorie ' + a.categorie + ' inconnue';
      else if (!empOf(a.emplacement)) err = 'Emplacement ' + a.emplacement + ' inconnu';
      else if (!a.dateAcq) err = 'Date d\'acquisition invalide';
      else if (!(a.valeur > 0)) err = 'Coût invalide';
      else if (a.vr >= a.valeur) err = 'Valeur résiduelle trop élevée';
      const ex = EN.normCode(pick(r, 'code'));
      if (!err) {
        if (ex) { if (ex.length !== 11) err = 'Code existant invalide'; else if (tmpAssets.some((x) => x.code === ex)) err = 'Code déjà utilisé'; else a.code = ex; }
        else { a.code = EN.nextCode(tmpAssets, EN.codePrefix(S.tenant.codeSociete, a.dateAcq, a.emplacement, a.categorie), S.cfg.counterScope); if (!a.code) err = 'Compteur saturé'; }
      }
      if (!err) tmpAssets.push(a);
      out.push({ line: k + 2, a: a, err: err });
    });
    S.ui.imp = { rows: out }; render();
  } catch (e) { console.error(e); toast('Lecture du fichier impossible : ' + (e.message || e), 'bad'); }
}
ACT['imp-go'] = async () => {
  const list = (S.ui.imp && S.ui.imp.rows || []).filter((r) => !r.err);
  if (!list.length) return;
  let n = 0;
  toast('Import en cours de ' + list.length + ' bien(s)…');
  for (const r of list) {
    const a = r.a; a.createdAt = nowIso(); a.updatedAt = nowIso(); a.history = [{ date: EN.today(), at: nowIso(), action: 'Import Excel', detail: 'Ligne ' + r.line, piece: a.pieceCompta || '' }];
    try { await Store.set(P.asset(S.tenantId, a.id), a); S.assets.push(a); n++; }
    catch (e) { storeError(e, 'ligne ' + r.line); break; }
  }
  S.assets.sort((x, y) => String(x.code).localeCompare(String(y.code)));
  await saveTenant(true);
  S.ui.imp = null; toast(n + ' immobilisation(s) importée(s).', 'ok'); go('assets');
};

/* ---------------- Mon compte (client) ---------------- */
TITLES.compte = { title: 'Mon compte', tenant: true };
VIEWS.compte = function () {
  const c = S.registry.find((x) => x.id === S.tenantId) || {};
  return '<div class="grid-2"><div class="panel"><h3>Mot de passe</h3><form class="form" id="pw-form"><label class="field"><span>Mot de passe actuel</span><input id="pw-old" type="password" autocomplete="current-password" required></label><label class="field"><span>Nouveau mot de passe</span><input id="pw-new" type="password" autocomplete="new-password" minlength="8" required><small>8 caractères minimum, avec chiffres et lettres.</small></label><label class="field"><span>Confirmation</span><input id="pw-new2" type="password" autocomplete="new-password" required></label><div class="actions"><button class="btn" type="submit">Changer le mot de passe</button></div></form></div>' +
    '<div class="panel"><h3>Accès</h3><dl class="dl"><div><dt>Identifiant</dt><dd>' + esc(c.login || '') + '</dd></div><div><dt>Société</dt><dd>' + esc(S.tenant.raison) + '</dd></div><div><dt>Code société</dt><dd class="mono">' + esc(S.tenant.codeSociete) + '</dd></div></dl><p class="muted" style="margin:14px 0 0">Votre accès est limité à l\'environnement de votre société. Pour toute modification de l\'identifiant, contactez le cabinet CTB.</p></div></div>';
};
VIEWS.compte.after = function () {
  const f = $('#pw-form'); if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = $('#pw-old').value, n1 = $('#pw-new').value, n2 = $('#pw-new2').value;
    if (EN.hashPassword(o, S.tenant.auth.salt) !== S.tenant.auth.hash) { toast('Mot de passe actuel incorrect.', 'bad'); return; }
    if (!strongPwd(n1)) { toast('Le nouveau mot de passe doit contenir au moins 8 caractères, dont des lettres et des chiffres.', 'bad'); return; }
    if (n1 !== n2) { toast('La confirmation ne correspond pas.', 'bad'); return; }
    const salt = EN.randomSalt(); S.tenant.auth = { salt: salt, hash: EN.hashPassword(n1, salt), changedAt: nowIso() };
    if (await saveTenant(true)) { toast('Mot de passe modifié.', 'ok'); f.reset(); }
  });
};
function strongPwd(p) { return typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p); }

/* ==========================================================================
   Administration CTB : clients, paramétrage sans code, sécurité, sauvegarde
   ========================================================================== */
function requireAdmin() { return S.session && S.session.role === 'admin'; }

TITLES['adm-dash'] = { title: 'Vue d\'ensemble' };
VIEWS['adm-dash'] = function () {
  const n = S.registry.length, act = S.registry.filter((c) => c.actif !== false).length;
  let nb = 0, vb = 0, vnc = 0;
  S.registry.forEach((c) => { const t = S.tenants[c.id]; if (t && t.stats) { nb += t.stats.nb || 0; vb += t.stats.vb || 0; vnc += t.stats.vnc || 0; } });
  const k = (l, v, s, hero) => '<div class="kpi' + (hero ? ' hero' : '') + '"><span class="l">' + l + '</span><span class="v">' + v + '</span>' + (s ? '<span class="s">' + s + '</span>' : '') + '</div>';
  return '<div class="page-head on-dark"><div><h2>Bonjour, administrateur</h2><p>Pilotage des environnements clients de ' + esc(S.cfg.appName) + '. Seul l\'administrateur voit l\'ensemble des clients et peut en créer.</p></div><div class="actions"><button class="btn" data-act="client-new">' + icon('plus') + 'Nouveau client</button></div></div>' +
    (S.adminAuth && S.adminAuth.isDefault ? '<div class="note on-dark" style="background:rgba(255,200,80,.14);color:var(--on-dark)">Le mot de passe administrateur initial est toujours actif. <button class="link" style="color:var(--accent-2)" data-act="nav" data-view="adm-secu">Le remplacer maintenant</button></div>' : '') +
    '<div class="kpis k4" style="--n:4">' + k('Clients', n, act + ' accès actif(s)', true) + k('Biens suivis', nb, 'en service, tous clients') + k('Valeur brute cumulée', money(vb), 'DT') + k('VNC cumulée', money(vnc), 'DT') + '</div>' +
    '<div class="panel"><div class="panel-head"><h3>Clients</h3><button class="btn ghost sm" data-act="nav" data-view="adm-clients">Gérer les clients</button></div>' + clientsTable(true) + '</div>' +
    '<div class="grid-2"><div class="panel"><h3>Paramétrage sans code</h3><p class="muted" style="margin-top:0">Nom de l\'application, logo, couleurs, catégories et taux, seuils fiscaux, comptes, motifs de sortie, champs personnalisés et modules : tout se règle depuis l\'écran Paramétrage.</p><button class="btn" data-act="nav" data-view="adm-param">' + icon('cog') + 'Ouvrir le paramétrage</button></div>' +
    '<div class="panel"><h3>Stockage des données</h3><p class="muted" style="margin-top:0">' + (Store.mode === 'db' ? 'Les données sont conservées dans la base Supabase du cabinet, protégée par des règles d\'accès appliquées par la base elle-même : chaque client connecté ne retrouve que son environnement.' : 'Les données sont conservées dans ce navigateur. Exportez régulièrement une sauvegarde.') + '</p><button class="btn ghost" data-act="nav" data-view="adm-backup">' + icon('db') + 'Sauvegarde et restauration</button></div></div>';
};
function clientsTable(compact) {
  if (!S.registry.length) return '<div class="empty"><b>Aucun client pour l\'instant.</b><span>Créez le premier environnement client, ou générez un client de démonstration pour découvrir l\'application avec des données fictives.</span><div class="actions"><button class="btn" data-act="client-new">' + icon('plus') + 'Nouveau client</button><button class="btn ghost" data-act="demo-create">Créer un client de démonstration</button></div></div>';
  return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Raison sociale</th><th>Code</th><th>Identifiant</th><th class="num">Biens</th><th class="num">Valeur brute</th><th class="num">VNC</th><th>Accès</th><th></th></tr></thead><tbody>' +
    S.registry.map((c) => {
      const t = S.tenants[c.id], st = (t && t.stats) || {};
      return '<tr><td><b>' + esc(c.raison) + '</b>' + (c.demo ? ' <span class="pill">démo</span>' : '') + (c.mf ? '<div class="muted" style="font-size:11.5px">MF ' + esc(c.mf) + '</div>' : '') + '</td><td class="code">' + esc(c.codeSociete) + '</td><td>' + esc(c.login) + '</td><td class="num">' + (!t ? '…' : esc(st.nb || 0)) + '</td><td class="num">' + (st.vb === undefined ? '' : money(st.vb)) + '</td><td class="num">' + (st.vnc === undefined ? '' : money(st.vnc)) + '</td><td>' + (c.actif === false ? '<span class="pill bad">Désactivé</span>' : '<span class="pill ok">Actif</span>') + '</td>' +
        '<td><div class="actions" style="justify-content:flex-end"><button class="btn sm" data-act="client-open" data-id="' + esc(c.id) + '">Ouvrir</button>' + (compact ? '' : '<button class="btn ghost sm" data-act="client-edit" data-id="' + esc(c.id) + '">Modifier</button><button class="btn ghost sm" data-act="client-pwd" data-id="' + esc(c.id) + '">Mot de passe</button><button class="btn ghost sm" data-act="client-toggle" data-id="' + esc(c.id) + '">' + (c.actif === false ? 'Activer' : 'Désactiver') + '</button><button class="btn danger sm" data-act="client-del" data-id="' + esc(c.id) + '" aria-label="Supprimer">' + icon('trash') + '</button>') + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
}
TITLES['adm-clients'] = { title: 'Clients' };
VIEWS['adm-clients'] = function () {
  return '<div class="page-head"><div><h2>Environnements clients</h2><p>Chaque client accède uniquement à ses propres immobilisations, avec l\'adresse e-mail invitée par le cabinet, après validation de cette adresse. Le code société (2 caractères) ouvre la codification de ses biens.</p></div><div class="actions"><button class="btn ghost" data-act="demo-create">Client de démonstration</button><button class="btn" data-act="client-new">' + icon('plus') + 'Nouveau client</button></div></div><div class="panel">' + clientsTable(false) + '</div>';
};
ACT['client-open'] = (el) => enterTenant(el.dataset.id);
ACT['client-new'] = () => clientForm(null);
ACT['client-edit'] = (el) => clientForm(S.registry.find((c) => c.id === el.dataset.id));
function suggestCode(raison) {
  const words = String(raison || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && ['SA', 'SARL', 'SUARL', 'STE', 'SOCIETE', 'ET', 'DE', 'DES', 'LA', 'LE', 'LES', 'ETS'].indexOf(w) === -1);
  const used = new Set(S.registry.map((c) => c.codeSociete));
  const cands = [];
  if (words.length >= 2) cands.push(words[0][0] + words[1][0]);
  if (words[0]) { cands.push(words[0].slice(0, 2)); for (let i = 1; i < words[0].length; i++) cands.push(words[0][0] + words[0][i]); }
  for (const c of cands) if (c.length === 2 && !used.has(c)) return c;
  for (let i = 65; i < 91; i++) for (let j = 65; j < 91; j++) { const c = String.fromCharCode(i, j); if (!used.has(c)) return c; }
  return '';
}
function clientForm(c) {
  const isNew = !c;
  const d = c || { raison: '', codeSociete: '', login: '', mf: '', actif: true };
  const t = c ? (S.tenants[c.id] || {}) : {};
  openModal({
    title: isNew ? 'Nouveau client' : 'Modifier ' + d.raison, sticky: true,
    body: '<form class="form" id="cl-form"><div class="row"><label class="field"><span>Raison sociale <em>*</em></span><input id="cl-raison" required value="' + esc(d.raison) + '"></label><label class="field"><span>Code société (2 caractères) <em>*</em></span><input id="cl-code" class="mono" maxlength="2" required value="' + esc(d.codeSociete) + '"' + (isNew ? '' : ' readonly') + '><small>' + (isNew ? 'Premiers caractères de tous les codes immobilisations ; non modifiable ensuite.' : 'Non modifiable : utilisé par les codes existants.') + '</small></label></div>' +
      '<div class="row"><label class="field"><span>Identifiant de connexion (e-mail) <em>*</em></span><input id="cl-login" type="email" required value="' + esc(d.login) + '"></label>' + (isNew ? '<label class="field"><span>Mot de passe initial <em>*</em></span><input id="cl-pwd" required value="' + esc(genPwd()) + '"><small>À communiquer au client ; il pourra le changer.</small></label>' : '') + '</div>' +
      '<div class="row"><label class="field"><span>Matricule fiscal</span><input id="cl-mf" value="' + esc(d.mf || '') + '"></label><label class="field"><span>Adresse</span><input id="cl-adr" value="' + esc(t.adresse || '') + '"></label></div>' +
      (isNew ? '<div class="row"><label class="field"><span>Clôture de l\'exercice</span><select id="cl-clo"><option value="31/12">31 décembre</option><option value="30/06">30 juin</option><option value="30/09">30 septembre</option><option value="31/03">31 mars</option></select></label><label class="field"><span>Référentiel d\'amortissement</span><select id="cl-ref"><option value="NC05">NC 05 – durées d\'utilité</option><option value="FISCAL">Taux fiscaux (note spécifique)</option></select></label><label class="check"><input type="checkbox" id="cl-emp" checked> Créer les emplacements de départ (siège, direction, comptabilité…)</label></div>' : '') +
      '</form>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="cl-ok">' + (isNew ? 'Créer le client' : 'Enregistrer') + '</button>',
    mount: (m) => {
      const r = m.querySelector('#cl-raison'), code = m.querySelector('#cl-code');
      if (isNew) r.addEventListener('input', () => { if (!code.dataset.touched) code.value = suggestCode(r.value); });
      code.addEventListener('input', () => { code.dataset.touched = '1'; code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      m.querySelector('#cl-ok').addEventListener('click', async () => {
        const raison = r.value.trim(), cs = code.value.trim().toUpperCase(), login = m.querySelector('#cl-login').value.trim().toLowerCase();
        if (!raison || !/^[A-Z0-9]{2}$/.test(cs) || !/^\S+@\S+\.\S+$/.test(login)) { toast('Renseignez la raison sociale, un code société de 2 caractères et un e-mail valide.', 'bad'); return; }
        if (S.registry.some((x) => x.codeSociete === cs && (!c || x.id !== c.id))) { toast('Le code société ' + cs + ' est déjà attribué.', 'bad'); return; }
        if (S.registry.some((x) => String(x.login).toLowerCase() === login && (!c || x.id !== c.id)) || login === String(S.adminAuth.email).toLowerCase()) { toast('Cet identifiant est déjà utilisé.', 'bad'); return; }
        const mf = m.querySelector('#cl-mf').value.trim(), adr = m.querySelector('#cl-adr').value.trim();
        try {
          if (isNew) {
            const pwd = m.querySelector('#cl-pwd').value;
            if (!strongPwd(pwd)) { toast('Mot de passe initial : 8 caractères minimum, avec lettres et chiffres.', 'bad'); return; }
            const id = uid(); const clo = m.querySelector('#cl-clo').value.split('/');
            const reg = { raison: raison, codeSociete: cs, login: login, mf: mf, actif: true, createdAt: nowIso() };
            const salt = EN.randomSalt();
            const ten = { raison: raison, codeSociete: cs, mf: mf, adresse: adr, activite: '', clotureJour: Number(clo[0]), clotureMois: Number(clo[1]), prorata: '', referentiel: m.querySelector('#cl-ref').value, ecartVirement: 'sortie', categories: clone(S.cfg.categories), emplacements: m.querySelector('#cl-emp').checked ? defaultEmps() : [], auth: { salt: salt, hash: EN.hashPassword(pwd, salt) }, stats: { nb: 0, vb: 0, vnc: 0 }, createdAt: nowIso() };
            await Store.set(P.client(id), reg);
            await Store.set(P.tenant(id), ten);
            S.registry.push(Object.assign(reg, { id: id })); S.tenants[id] = ten;
            S.registry.sort((a, b) => String(a.raison).localeCompare(String(b.raison), 'fr'));
            closeModal(); render();
            credentialsBox(raison, login, pwd);
          } else {
            const reg = Object.assign(clone(c), { raison: raison, login: login, mf: mf }); delete reg.id;
            await Store.set(P.client(c.id), reg);
            const ten = await Store.get(P.tenant(c.id));
            if (ten) { ten.raison = raison; ten.mf = mf; ten.adresse = adr; await Store.set(P.tenant(c.id), ten); S.tenants[c.id] = ten; }
            Object.assign(c, reg); closeModal(); toast('Client mis à jour.', 'ok'); render();
          }
        } catch (e) { storeError(e, 'client'); }
      });
    }
  });
}
function defaultEmps() { return [{ code: '01', libelle: 'Siège – accueil', site: 'Siège', responsable: '' }, { code: '02', libelle: 'Direction générale', site: 'Siège', responsable: '' }, { code: '03', libelle: 'Administration et comptabilité', site: 'Siège', responsable: '' }, { code: '04', libelle: 'Salle serveurs / informatique', site: 'Siège', responsable: '' }]; }
function genPwd() { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', d = '23456789'; let s = ''; const r = new Uint8Array(10); crypto.getRandomValues(r); for (let i = 0; i < 7; i++) s += a[r[i] % a.length]; for (let i = 7; i < 10; i++) s += d[r[i] % d.length]; return s; }
function credentialsBox(raison, login, pwd) {
  openModal({
    title: 'Accès créé', size: 'narrow',
    body: '<div class="form"><p style="margin:0">Communiquez ces informations à <b>' + esc(raison) + '</b>. Le mot de passe n\'est plus affiché ensuite.</p><div class="fs"><div><span class="muted">Identifiant</span><div class="mono" style="font-size:16px">' + esc(login) + '</div></div><div><span class="muted">Mot de passe</span><div class="mono" style="font-size:16px">' + esc(pwd) + '</div></div></div><button class="btn ghost" id="cp-btn">Copier l\'identifiant et le mot de passe</button></div>',
    mount: (m) => m.querySelector('#cp-btn').addEventListener('click', () => {
      const txt = 'Identifiant : ' + login + '\nMot de passe : ' + pwd;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Copié.', 'ok')).catch(() => toast('Copie impossible : sélectionnez le texte.', 'bad'));
    })
  });
}
ACT['client-pwd'] = (el) => {
  const c = S.registry.find((x) => x.id === el.dataset.id); if (!c) return;
  const p = genPwd();
  openModal({
    title: 'Réinitialiser le mot de passe', size: 'narrow',
    body: '<div class="form"><p style="margin:0">Nouveau mot de passe pour <b>' + esc(c.raison) + '</b> :</p><label class="field"><span>Mot de passe</span><input id="rp-pwd" value="' + esc(p) + '"></label></div>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="rp-ok">Réinitialiser</button>',
    mount: (m) => m.querySelector('#rp-ok').addEventListener('click', async () => {
      const pwd = m.querySelector('#rp-pwd').value;
      if (!strongPwd(pwd)) { toast('8 caractères minimum, avec lettres et chiffres.', 'bad'); return; }
      try {
        const t = await Store.get(P.tenant(c.id)); if (!t) throw { message: 'Environnement introuvable.' };
        const salt = EN.randomSalt(); t.auth = { salt: salt, hash: EN.hashPassword(pwd, salt), resetAt: nowIso() };
        await Store.set(P.tenant(c.id), t); S.tenants[c.id] = t; closeModal(); credentialsBox(c.raison, c.login, pwd);
      } catch (e) { storeError(e, 'mot de passe'); }
    })
  });
};
ACT['client-toggle'] = async (el) => {
  const c = S.registry.find((x) => x.id === el.dataset.id); if (!c) return;
  const reg = clone(c); delete reg.id; reg.actif = c.actif === false;
  try { await Store.set(P.client(c.id), reg); c.actif = reg.actif; toast(reg.actif ? 'Accès activé.' : 'Accès désactivé.', 'ok'); render(); } catch (e) { storeError(e); }
};
ACT['client-del'] = async (el) => {
  const c = S.registry.find((x) => x.id === el.dataset.id); if (!c) return;
  const v = await confirmBox('Supprimer le client', '<p>L\'environnement de <b>' + esc(c.raison) + '</b> sera supprimé définitivement avec toutes ses immobilisations et ses inventaires.</p><div class="note bad">Exportez une sauvegarde avant de continuer. Saisissez le code société <b class="mono">' + esc(c.codeSociete) + '</b> pour confirmer.</div><label class="field"><span>Code société</span><input id="cfm-input" class="mono" maxlength="2"></label>', 'Supprimer définitivement', true);
  if (!v || String(v).toUpperCase() !== c.codeSociete) { if (v) toast('Code incorrect : suppression annulée.', 'bad'); return; }
  try {
    const [assets, invs] = await Promise.all([Store.list(P.assets(c.id)), Store.list(P.invs(c.id))]);
    for (const a of assets) await Store.del(P.asset(c.id, a.id));
    for (const i of invs) await Store.del(P.inv(c.id, i.id));
    await Store.del(P.tenant(c.id)); await Store.del(P.client(c.id));
    S.registry = S.registry.filter((x) => x.id !== c.id); delete S.tenants[c.id];
    toast('Client supprimé.', 'ok'); render();
  } catch (e) { storeError(e, 'suppression'); }
};

/* ---------------- Client de démonstration ---------------- */
ACT['demo-create'] = async () => {
  if (S.registry.some((c) => c.demo)) { toast('Un client de démonstration existe déjà : supprimez-le pour en créer un nouveau.', 'bad'); return; }
  const used = new Set(S.registry.map((c) => c.codeSociete));
  const cs = used.has('EX') ? suggestCode('Exemple Demo') : 'EX';
  const login = 'demo@exemple.tn', pwd = 'Demo2026!';
  if (S.registry.some((x) => x.login === login)) { toast('L\'identifiant de démonstration est déjà utilisé.', 'bad'); return; }
  const id = uid(), salt = EN.randomSalt(), y = new Date().getFullYear();
  const D = (yy, mm, dd) => EN.isoFrom(yy, mm, dd);
  const reg = { raison: 'Société Exemple SARL (démo)', codeSociete: cs, login: login, mf: '0000000/A/M/000', actif: true, demo: true, createdAt: nowIso() };
  const catsDemo = clone(S.cfg.categories).map((c) => (c.code === '01' || c.code === '02') ? Object.assign(c, { modele: 'reevaluation', frequenceReeval: 5 }) : c);
  const ten = { raison: reg.raison, codeSociete: cs, mf: reg.mf, adresse: 'Données fictives de démonstration', activite: 'Distribution', clotureJour: 31, clotureMois: 12, prorata: '', referentiel: 'NC05', ecartVirement: 'sortie', categories: catsDemo,
    emplacements: defaultEmps().concat([{ code: '05', libelle: 'Atelier de conditionnement', site: 'Usine', responsable: '' }, { code: '06', libelle: 'Parc automobile', site: 'Siège', responsable: '' }, { code: '07', libelle: 'Terrain et bâtiments', site: 'Siège', responsable: '' }]),
    createdAt: nowIso(),
    evaluation: { [y - 1]: { indices: { items: ['performance'], biens: 'Ligne de conditionnement : volumes inférieurs aux prévisions', conclusion: 'indices', date: D(y - 1, 12, 31), responsable: 'Direction financière' }, revue: { date: D(y - 1, 12, 31), commentaire: 'Durées confirmées, sauf logiciel de gestion (obsolescence)', categories: {} } } },
    notesInfo: {}, piecesInventaire: { [y - 1]: 'OD-' + (y - 1) + '-12-050' } };
  const assets = [];
  const mk = (o) => {
    const a = Object.assign({ id: uid(), entree: 'achat', dateMES: '', vr: 0, mode: 'L', duree: '', fiscal: { regime: 'auto', taux: '' }, quantite: 1, etat: 'Bon', fournisseur: 'Fournisseur exemple', custom: {}, events: [], createdAt: nowIso(), updatedAt: nowIso() }, o);
    a.facture = a.facture || 'F-' + a.dateAcq.slice(0, 4) + '-' + (100 + assets.length);
    a.code = EN.nextCode(assets, EN.codePrefix(cs, a.dateAcq, a.emplacement, a.categorie), S.cfg.counterScope);
    if (a.pieceCompta === undefined) a.pieceCompta = (a.entree === 'leasing' ? 'OD-' : 'AC-') + a.dateAcq.slice(0, 4) + '-' + String(140 + assets.length * 7).padStart(4, '0');
    a.history = [{ date: a.dateAcq, at: nowIso(), action: 'Création (démonstration)', detail: '', piece: a.pieceCompta }];
    assets.push(a); return a;
  };
  const acte = { numero: (y - 6) + '/04518', date: D(y - 6, 3, 8), recette: 'Tunis – Ennasr', cocontractant: 'Vendeur (personne physique)' };
  const reev = (p) => ({ id: uid(), type: 'reevaluation', date: D(y - 1, 12, 31), methode: 'Expertise', evaluateur: 'Expert immobilier agréé', independant: true, motif: 'Expertise', pieceCompta: 'OD-' + (y - 1) + '-12-045' });
  mk({ designation: 'Terrain du siège', categorie: '01', emplacement: '07', dateAcq: D(y - 6, 3, 1), valeur: 250000, mode: 'N', fournisseur: 'Vendeur (personne physique)', facture: 'Acte notarié', contrats: [Object.assign({ type: 'Acte d\'acquisition de terrain' }, acte)], events: [Object.assign(reev(), { justeValeur: 310000 })] });
  mk({ designation: 'Bâtiment administratif du siège', categorie: '02', emplacement: '07', dateAcq: D(y - 6, 3, 1), dateMES: D(y - 6, 6, 1), valeur: 600000, duree: 25, coutDetail: { prixAchat: 520000, droits: 22000, honoraires: 38000, preparation: 20000 }, fournisseur: 'Vendeur (personne physique)', facture: 'Acte notarié', contrats: [Object.assign({ type: 'Acte d\'acquisition d\'immeuble ou de local' }, acte)], events: [Object.assign(reev(), { justeValeur: 560000 })] });
  mk({ designation: 'Aménagement des bureaux du siège', categorie: '04', emplacement: '01', dateAcq: D(y - 4, 2, 10), valeur: 48500, duree: 10 });
  const ligne = mk({ designation: 'Ligne de conditionnement semi-automatique', categorie: '05', emplacement: '05', dateAcq: D(y - 3, 4, 12), valeur: 186000, duree: 10, equipes: '2', numSerie: 'LC-' + (y - 3) + '-0457', garantie: { duree: 24, unite: 'mois', debut: '', conditions: 'Constructeur – pièces et main-d\'œuvre' }, events: [{ id: uid(), type: 'test', date: D(y - 1, 12, 31), valeurUtilite: 105000, indices: ['performance'], tauxActualisation: '11', motif: 'Volumes inférieurs aux prévisions', pieceCompta: 'OD-' + (y - 1) + '-12-046' }] });
  mk({ designation: 'Moteur principal de la ligne (composant)', categorie: '15', emplacement: '05', dateAcq: D(y - 3, 4, 12), valeur: 24000, duree: 4, parentId: ligne.id });
  mk({ designation: 'Chaudière industrielle', categorie: '06', emplacement: '05', dateAcq: D(y - 1, 1, 5), valeur: 85000, duree: 10, numSerie: 'CH-88213-T', garantie: { duree: 2, unite: 'ans', debut: '', conditions: 'Installateur – garantie totale' }, demantelement: { montant: 5000, taux: 6, echeance: D(y + 8, 12, 31) } });
  const serveur = mk({ designation: 'Serveur Dell PowerEdge', categorie: '12', emplacement: '04', dateAcq: D(y - 3, 9, 15), valeur: 14800, duree: 3, marque: 'Dell PowerEdge T350', numSerie: '7XK2P93', garantie: { duree: 36, unite: 'mois', debut: '', conditions: 'Constructeur – intervention sur site J+1' } });
  serveur.sortie = { type: 'Cession (vente)', date: D(y, 3, 31), prix: 1200, indemnite: 0, tiers: 'Acquéreur exemple', piece: 'FV-' + y + '-014', pieceCompta: 'OD-' + y + '-03-018', motif: 'Remplacement du serveur', at: nowIso() };
  serveur.history.push({ date: serveur.sortie.date, at: nowIso(), action: 'Sortie', detail: 'Cession (vente) – prix 1 200,000', piece: serveur.sortie.pieceCompta });
  mk({ designation: 'Ordinateurs portables (lot de 4)', categorie: '12', emplacement: '03', dateAcq: D(y - 1, 1, 20), valeur: 11200, duree: 3, marque: 'Lenovo ThinkPad E14', numSerie: 'PF4KX1A à PF4KX1D', garantie: { duree: 36, unite: 'mois', debut: '', conditions: 'Constructeur' } });
  mk({ designation: 'Logiciel de gestion commerciale', categorie: '20', emplacement: '04', dateAcq: D(y - 1, 3, 1), valeur: 9600, duree: 3, events: [{ id: uid(), type: 'revision', date: D(y, 1, 1), dureeRestante: 1, motif: 'Remplacement prévu par un progiciel intégré (obsolescence)' }] });
  mk({ designation: 'Chariot élévateur électrique', categorie: '14', emplacement: '05', dateAcq: D(y - 1, 6, 28), valeur: 42300, duree: 8, marque: 'Toyota Traigo 48', numSerie: '7FBEF16-50123', garantie: { duree: 12, unite: 'mois', debut: '', conditions: 'Concessionnaire' }, subvention: { montant: 10000 } });
  mk({ designation: 'Camionnette de livraison', categorie: '08', emplacement: '06', dateAcq: D(y - 2, 11, 2), valeur: 68500, duree: 5, vr: 8500, marque: 'Renault Master', immatriculation: '198 TU 7421', chassis: 'VF1MA000568742311', garantie: { duree: 3, unite: 'ans', debut: '', conditions: 'Constructeur, kilométrage limité à 100 000 km' }, nanti: true, nantiDetail: 'Garantie d\'un crédit bancaire' });
  mk({ designation: 'Voiture de tourisme direction (11 CV)', categorie: '09', emplacement: '06', dateAcq: D(y - 1, 2, 14), valeur: 112000, duree: 5, entree: 'leasing', fournisseur: 'Société de leasing exemple', facture: 'Contrat LS-' + (y - 1) + '-00871', marque: 'Volkswagen Passat', immatriculation: '221 TU 1350', chassis: 'WVWZZZ3CZPE012345', contrats: [{ type: 'Contrat de leasing', numero: (y - 1) + '/02964', date: D(y - 1, 2, 20), recette: 'Tunis – Lac', cocontractant: 'Société de leasing exemple' }], vehicule: { tourisme: true, cv: 11, objetPrincipal: false } });
  mk({ designation: 'Bureau de direction et fauteuil', categorie: '10', emplacement: '02', dateAcq: D(y - 3, 5, 3), valeur: 3850, duree: 10 });
  mk({ designation: 'Imprimante multifonction', categorie: '11', emplacement: '03', dateAcq: D(y, 2, 5), valeur: 1980, duree: 5, marque: 'Canon i-SENSYS MF655', numSerie: 'CNB1R45678', garantie: { duree: 12, unite: 'mois', debut: '', conditions: 'Revendeur' } });
  mk({ designation: 'Téléphone IP', categorie: '11', emplacement: '01', dateAcq: D(y, 4, 9), valeur: 420, duree: 5, pieceCompta: '' });
  mk({ designation: 'Climatiseurs (3 unités)', categorie: '06', emplacement: '01', dateAcq: D(y - 3, 7, 1), valeur: 7650, duree: 10, etat: 'Temporairement inutilisé' });
  mk({ designation: 'Extension de l\'entrepôt (travaux en cours)', categorie: '19', emplacement: '07', dateAcq: D(y, 5, 10), valeur: 95000, mode: 'N', entree: 'production', fournisseur: 'Entreprise de construction exemple', facture: 'Situation de travaux n° 1', contrats: [{ type: 'Contrat de travaux (entreprise de construction)', numero: y + '/03377', date: D(y, 4, 28), recette: 'Tunis – Ennasr', cocontractant: 'Entreprise de construction exemple' }] });
  toast('Création du client de démonstration…');
  try {
    await Store.set(P.client(id), reg);
    ten.stats = { nb: assets.length - 1, vb: 0, vnc: 0 };
    await Store.set(P.tenant(id), ten);
    for (const a of assets) await Store.set(P.asset(id, a.id), a);
    S.registry.push(Object.assign(reg, { id: id })); S.tenants[id] = ten;
    toast(SUPA ? 'Client de démonstration créé (aucun accès client : données fictives consultables par l\'administrateur).' : 'Client de démonstration créé : ' + login + ' / ' + pwd, 'ok');
    render();
  } catch (e) { storeError(e, 'démonstration'); }
};

/* ---------------- Paramétrage sans code ---------------- */
TITLES['adm-param'] = { title: 'Paramétrage' };
VIEWS['adm-param'] = function () {
  const tab = S.ui.pTab || 'id';
  const c = S.cfg;
  const tabs = [['id', 'Identité visuelle'], ['cat', 'Catégories modèles'], ['comptes', 'Comptes (NC 05)'], ['fisc', 'Référentiel fiscal'], ['code', 'Codification et calcul'], ['list', 'Listes'], ['cf', 'Champs personnalisés'], ['mod', 'Modules']];
  let h = '';
  if (tab === 'id') {
    h = '<div class="grid-2"><div class="form"><label class="field"><span>Nom de l\'application</span><input id="p-name" value="' + esc(c.appName) + '"></label><label class="field"><span>Accroche</span><input id="p-tag" value="' + esc(c.tagline) + '"></label>' +
      '<label class="field"><span>Message de l\'écran de connexion</span><textarea id="p-login" rows="3">' + esc(c.loginMessage) + '</textarea></label><label class="field"><span>Pied de page des rapports</span><input id="p-foot" value="' + esc(c.reportFooter) + '"></label>' +
      '<div class="row"><label class="field"><span>Fond principal</span><input type="color" class="swatch" id="p-c1" value="' + esc(c.colors.bg) + '"></label><label class="field"><span>Accent (boutons)</span><input type="color" class="swatch" id="p-c2" value="' + esc(c.colors.accent) + '"></label><label class="field"><span>Lavande (encarts)</span><input type="color" class="swatch" id="p-c3" value="' + esc(c.colors.soft) + '"></label></div>' +
      '<div class="actions"><button class="btn ghost sm" data-act="p-colors-reset">Couleurs d\'origine</button></div></div>' +
      '<div class="form"><div class="field"><span>Logo (affiché sur l\'application et en tête des rapports PDF)</span><div class="logo-prev">' + brandHtml() + '</div></div>' +
      '<label class="field"><span>Remplacer le logo (PNG ou SVG, version blanche sur fond transparent). Le logo officiel CTB est installé par défaut.</span><input type="file" id="p-logo" accept="image/png,image/jpeg,image/svg+xml,image/webp"></label>' + (c.logo ? '<button class="btn ghost sm" data-act="p-logo-del">Revenir au logo CTB d\'origine</button>' : '') + '</div></div>';
  } else if (tab === 'fisc') {
    const f = c.fiscal;
    h = '<div class="form"><div class="row"><label class="field"><span>Seuil des biens de faible valeur (DT)</span><input id="pf-fv" inputmode="decimal" value="' + esc(f.seuilFaibleValeur) + '"><small>Art. 12 bis CIRPPIS (500 DT depuis la LF 2019)</small></label>' +
      '<label class="field"><span>Puissance fiscale maximale des voitures de tourisme (CV)</span><input id="pf-cv" inputmode="decimal" value="' + esc(f.seuilCV) + '"></label>' +
      '<label class="field"><span>Seuil des actifs réglés en espèces (DT HT)</span><input id="pf-esp" inputmode="decimal" value="' + esc(f.seuilEspeces) + '"></label></div>' +
      '<div class="row"><label class="field"><span>Coefficient deux équipes</span><input id="pf-c2" inputmode="decimal" value="' + esc(f.coefDeux) + '"><small>Décret n° 2008-492, art. 2</small></label><label class="field"><span>Coefficient trois équipes</span><input id="pf-c3" inputmode="decimal" value="' + esc(f.coefTrois) + '"></label><label class="field"><span>Durée minimale pour le dégressif (ans)</span><input id="pf-dmin" inputmode="decimal" value="' + esc(f.degDureeMin === undefined ? 3 : f.degDureeMin) + '"></label></div>' +
      '<div class="note">Depuis la loi de finances pour 2008 (art. 12 bis CIRPPIS, note commune n° 22/2008), la déduction est plafonnée aux annuités linéaires calculées aux taux maximum ; l\'excédent réintégré est déduit les exercices suivants. Le plafond dégressif n\'est plus applicable de droit commun : n\'activez l\'option ci-dessous que si un texte spécial l\'autorise.</div>' +
      '<div class="fs"><label class="check"><input type="checkbox" id="pf-deg"' + chk(f.degressifAutorise) + '> Autoriser un plafond dégressif (texte spécial)</label><div class="row">' + (f.degCoefs || []).map((x, i) => '<label class="field"><span>Durée jusqu\'à (ans)</span><input class="pf-dmax" data-i="' + i + '" value="' + esc(x.max) + '"></label><label class="field"><span>Coefficient</span><input class="pf-dco" data-i="' + i + '" value="' + esc(x.coef) + '"></label>').join('') + '</div><small class="muted">Ces coefficients servent aussi au mode dégressif comptable, lorsque ce mode traduit le rythme de consommation des avantages (NC 05 §49).</small></div>' +
      '<div class="actions"><button class="btn" data-act="p-fisc-save">Enregistrer le référentiel</button><button class="btn ghost" data-act="p-fisc-reset">Valeurs légales par défaut</button></div></div>';
  } else if (tab === 'cat') {
    h = '<p class="muted" style="margin:0 0 12px">Modèle copié dans chaque nouvel environnement client. Les durées d\'utilité sont indicatives (NC 05 §44 et §45) : chaque société les adapte à l\'usage réel de ses biens. Les clients existants peuvent s\'aligner via « Mettre à jour depuis le référentiel CTB ».</p>' + catTableHtml(c.categories, () => false) + '<div class="actions" style="margin-top:12px"><button class="btn ghost" data-act="pc-add">' + icon('plus') + 'Ajouter</button><button class="btn ghost" data-act="pc-reset">Référentiel d\'origine</button><button class="btn" data-act="pc-save">Enregistrer le modèle</button></div>';
  } else if (tab === 'comptes') {
    const K = c.comptes;
    const f2 = (k, l, help) => '<label class="field"><span>' + l + '</span><input class="pk-c mono" data-k="' + k + '" value="' + esc(K[k] || '') + '">' + (help ? '<small>' + help + '</small>' : '') + '</label>';
    h = '<div class="form"><div class="note">Comptes du système comptable des entreprises utilisés pour les écritures d\'inventaire. Les comptes d\'immobilisation, d\'amortissement et de pertes de valeur sont définis par catégorie.</div>' +
      '<div class="fs"><b>Amortissements et pertes de valeur</b><div class="row">' + f2('dotAmort', 'Dotations aux amortissements', '6811') + f2('dotProv', 'Dotations aux provisions pour dépréciation', '6816') + f2('repriseProv', 'Reprises sur provisions pour dépréciation', '7816') + '</div></div>' +
      '<div class="fs"><b>Réévaluation (NC 05 §38 à §40)</b><div class="row">' + f2('ecartReeval', 'Écart de réévaluation', 'Capitaux propres') + f2('resultatsReportes', 'Résultats reportés', '121') + f2('chargeReeval', 'Diminution de valeur en charge', '637 Réduction de valeur') + f2('produitReeval', 'Hausse reprenant une baisse antérieure', '') + '</div></div>' +
      '<div class="fs"><b>Démantèlement (§82 à §99) et subventions (NC 12)</b><div class="row">' + f2('provDemantelement', 'Provision pour démantèlement', '158') + f2('desactualisation', 'Désactualisation (charges financières)', '') + f2('produitDemantelement', 'Excédent de baisse en produit', '') + f2('subvention', 'Subventions d\'investissement', '145') + f2('quotePartSub', 'Quote-part virée au résultat', '739') + '</div></div>' +
      '<div class="fs"><b>Sorties (§75 à §81)</b><div class="row">' + f2('cessionCharge', 'Charges nettes sur cessions', '636') + f2('cessionProduit', 'Produits nets sur cessions', '736') + f2('creanceCession', 'Créances sur cessions', '452') + f2('indemnite', 'Indemnités d\'assurance à recevoir', '') + '</div></div>' +
      '<div class="actions"><button class="btn" data-act="pk-comptes">Enregistrer les comptes</button><button class="btn ghost" data-act="pk-comptes-reset">Comptes par défaut</button></div></div>';
  } else if (tab === 'code') {
    h = '<div class="form"><div class="note">Structure : <b class="mono">SS AA EE CC NNN</b> — société (2), année d\'acquisition (2), emplacement (2), catégorie (2), compteur (3). Exemple : <b class="mono">' + esc(EN.fmtCode('SY260312001', c.codeSep)) + '</b></div>' +
      '<div class="row"><label class="field"><span>Séparateur à l\'affichage et sur les étiquettes</span><select id="pk-sep">' + opt([{ v: '', l: 'Aucun (SY260312001)' }, { v: '-', l: 'Tiret (SY-26-03-12-001)' }, { v: '.', l: 'Point (SY.26.03.12.001)' }, { v: ' ', l: 'Espace (SY 26 03 12 001)' }], c.codeSep) + '</select></label>' +
      '<label class="field"><span>Portée du compteur</span><select id="pk-scope">' + opt([{ v: 'prefix', l: 'Par combinaison société + année + emplacement + catégorie' }, { v: 'cat', l: 'Par société et catégorie' }, { v: 'global', l: 'Unique pour toute la société' }], c.counterScope) + '</select></label>' +
      '<label class="field"><span>Prorata temporis par défaut</span><select id="pk-pro">' + opt([{ v: 'jours', l: 'Jours exacts' }, { v: 'mois', l: 'Mois entiers' }, { v: 'j360', l: 'Base 360 jours' }], c.prorata) + '</select></label></div>' +
      '<div class="actions"><button class="btn" data-act="pk-save">Enregistrer</button></div></div>';
  } else if (tab === 'list') {
    h = '<div class="grid-2"><label class="field"><span>Natures de sortie (une par ligne)</span><textarea id="pl-sorties" rows="9">' + esc((c.sorties || []).join('\n')) + '</textarea><small>La 4ᵉ ligne est utilisée pour les manquants constatés à l\'inventaire.</small></label><label class="field"><span>États des biens (une par ligne)</span><textarea id="pl-etats" rows="9">' + esc((c.etats || []).join('\n')) + '</textarea></label></div><div class="actions" style="margin-top:12px"><button class="btn" data-act="pl-save">Enregistrer les listes</button></div>';
  } else if (tab === 'cf') {
    h = '<p class="muted" style="margin:0 0 12px">Ajoutez des rubriques à la fiche immobilisation (n° d\'immatriculation, contrat de maintenance, garantie…), sans programmation.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Libellé</th><th>Type</th><th>Options (liste, séparées par des virgules)</th><th></th></tr></thead><tbody>' +
      (c.customFields || []).map((f, i) => '<tr><td><input class="cf-l" data-i="' + i + '" value="' + esc(f.label) + '"></td><td><select class="cf-t" data-i="' + i + '">' + opt([{ v: 'text', l: 'Texte' }, { v: 'number', l: 'Nombre' }, { v: 'date', l: 'Date' }, { v: 'select', l: 'Liste' }], f.type) + '</select></td><td><input class="cf-o" data-i="' + i + '" value="' + esc(f.options || '') + '"></td><td><button class="btn ghost sm" data-act="cf-del" data-i="' + i + '">Retirer</button></td></tr>').join('') +
      '</tbody></table></div><div class="actions" style="margin-top:12px"><button class="btn ghost" data-act="cf-add">' + icon('plus') + 'Ajouter un champ</button><button class="btn" data-act="cf-save">Enregistrer</button></div>';
  } else if (tab === 'mod') {
    const m = c.modules;
    h = '<div class="form"><label class="check"><input type="checkbox" id="pm-inv"' + chk(m.inventaire) + '> Inventaires physiques</label><label class="check"><input type="checkbox" id="pm-eti"' + chk(m.etiquettes) + '> Étiquettes code-barres</label><label class="check"><input type="checkbox" id="pm-imp"' + chk(m.import) + '> Import Excel des registres</label><label class="check"><input type="checkbox" id="pm-fis"' + chk(m.fiscal) + '> Traitement fiscal (plafonds, réintégrations)</label><div class="actions"><button class="btn" data-act="pm-save">Enregistrer</button></div></div>';
  }
  return '<div class="page-head"><div><h2>Paramétrage de l\'application</h2><p>Modifiez l\'apparence, les référentiels et les règles de calcul sans toucher au code. Les changements s\'appliquent immédiatement à tous les environnements.</p></div></div>' +
    '<div class="panel"><div class="tabs">' + tabs.map((x) => '<button class="' + (tab === x[0] ? 'on' : '') + '" data-act="p-tab" data-tab="' + x[0] + '">' + esc(x[1]) + '</button>').join('') + '</div>' + h + '</div>';
};
VIEWS['adm-param'].after = function () {
  ['p-name', 'p-tag', 'p-login', 'p-foot'].forEach((id) => { const el = $('#' + id); if (el) el.addEventListener('change', () => saveIdentity()); });
  ['p-c1', 'p-c2', 'p-c3'].forEach((id) => { const el = $('#' + id); if (el) { el.addEventListener('input', () => { S.cfg.colors = { bg: $('#p-c1').value, accent: $('#p-c2').value, soft: $('#p-c3').value }; applyTheme(); }); el.addEventListener('change', () => saveIdentity()); } });
  const lf = $('#p-logo'); if (lf) lf.addEventListener('change', () => loadLogo(lf.files[0]));
};
async function saveConfig(msg) {
  S.cfg.updatedAt = nowIso();
  try { await Store.set(P.config, S.cfg); toast(msg || 'Paramétrage enregistré.', 'ok'); schedCache.clear(); return true; }
  catch (e) { storeError(e, 'paramétrage'); return false; }
}
async function saveIdentity() {
  S.cfg.appName = $('#p-name').value.trim() || 'immo'; S.cfg.tagline = $('#p-tag').value.trim(); S.cfg.loginMessage = $('#p-login').value.trim(); S.cfg.reportFooter = $('#p-foot').value.trim();
  S.cfg.colors = { bg: $('#p-c1').value, accent: $('#p-c2').value, soft: $('#p-c3').value };
  await saveConfig('Identité enregistrée.'); applyTheme();
}
function loadLogo(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = async () => {
      const max = 480, scale = Math.min(1, max / Math.max(im.naturalWidth || max, 1), 200 / Math.max(im.naturalHeight || 200, 1));
      const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round((im.naturalWidth || 480) * scale)); cv.height = Math.max(1, Math.round((im.naturalHeight || 200) * scale));
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      S.cfg.logo = cv.toDataURL('image/png'); logoInfo = null;
      if (await saveConfig('Logo enregistré.')) render();
    };
    im.onerror = () => toast('Image illisible.', 'bad');
    im.src = r.result;
  };
  r.readAsDataURL(file);
}
ACT['p-tab'] = (el) => { S.ui.pTab = el.dataset.tab; render(); };
ACT['p-logo-del'] = async () => { S.cfg.logo = null; logoInfo = null; if (await saveConfig('Logo retiré.')) render(); };
ACT['p-colors-reset'] = async () => { S.cfg.colors = defaultConfig().colors; applyTheme(); if (await saveConfig('Couleurs d\'origine rétablies.')) render(); };
ACT['p-fisc-save'] = async () => {
  const f = S.cfg.fiscal;
  f.seuilFaibleValeur = num($('#pf-fv').value); f.seuilCV = num($('#pf-cv').value); f.seuilEspeces = num($('#pf-esp').value);
  f.coefDeux = num($('#pf-c2').value) || 1.5; f.coefTrois = num($('#pf-c3').value) || 2; f.degDureeMin = num($('#pf-dmin').value) || 3;
  f.degCoefs = $$('.pf-dmax').map((el, i) => ({ max: num(el.value), coef: num(($('.pf-dco[data-i="' + i + '"]') || {}).value) || 1 }));
  f.degressifAutorise = $('#pf-deg').checked;
  if (await saveConfig('Référentiel fiscal enregistré.')) render();
};
ACT['p-fisc-reset'] = async () => { S.cfg.fiscal = clone(EN.DEFAULT_FISCAL); if (await saveConfig('Valeurs par défaut rétablies.')) render(); };
ACT['pk-comptes'] = async () => { $$('.pk-c').forEach((el) => { S.cfg.comptes[el.dataset.k] = el.value.trim(); }); if (await saveConfig('Comptes enregistrés.')) render(); };
ACT['pk-comptes-reset'] = async () => { S.cfg.comptes = clone(EN.DEFAULT_COMPTES); if (await saveConfig('Comptes par défaut rétablis.')) render(); };
ACT['pc-del'] = (el) => { S.cfg.categories = readCatRows(S.cfg.categories); S.cfg.categories.splice(Number(el.dataset.i), 1); render(); };
function readCfgCats() { return readCatRows(S.cfg.categories); }
ACT['pc-add'] = () => { S.cfg.categories = readCfgCats(); const used = new Set(S.cfg.categories.map((c) => c.code)); let n = 25; while (used.has(String(n).padStart(2, '0')) && n < 99) n++; S.cfg.categories.push(blankCat(String(n).padStart(2, '0'))); render(); };
ACT['pc-reset'] = async () => { const ok = await confirmBox('Référentiel d\'origine', '<p>Le modèle de catégories sera remplacé par le référentiel livré avec l\'application (durées d\'utilité indicatives NC 05 et taux fiscaux du décret n° 2008-492).</p>', 'Remplacer'); if (!ok) return; S.cfg.categories = clone(EN.DEFAULT_CATEGORIES); if (await saveConfig()) render(); };
ACT['pc-save'] = async () => { const l = readCfgCats(); if (!validCats(l)) return; S.cfg.categories = l.sort((a, b) => a.code.localeCompare(b.code)); if (await saveConfig('Modèle de catégories enregistré.')) render(); };
ACT['pk-save'] = async () => { S.cfg.codeSep = $('#pk-sep').value; S.cfg.counterScope = $('#pk-scope').value; S.cfg.prorata = $('#pk-pro').value; if (await saveConfig()) render(); };
ACT['pl-save'] = async () => {
  const s = $('#pl-sorties').value.split('\n').map((x) => x.trim()).filter(Boolean), e = $('#pl-etats').value.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!s.length || !e.length) { toast('Chaque liste doit contenir au moins une valeur.', 'bad'); return; }
  S.cfg.sorties = s; S.cfg.etats = e; if (await saveConfig('Listes enregistrées.')) render();
};
function readCf() { return (S.cfg.customFields || []).map((f, i) => ({ key: f.key, label: ($('.cf-l[data-i="' + i + '"]') || {}).value || f.label, type: ($('.cf-t[data-i="' + i + '"]') || {}).value || 'text', options: ($('.cf-o[data-i="' + i + '"]') || {}).value || '' })); }
ACT['cf-add'] = () => { S.cfg.customFields = readCf(); S.cfg.customFields.push({ key: 'c' + uid().slice(-6), label: 'Nouveau champ', type: 'text', options: '' }); render(); };
ACT['cf-del'] = (el) => { S.cfg.customFields = readCf(); S.cfg.customFields.splice(Number(el.dataset.i), 1); render(); };
ACT['cf-save'] = async () => { S.cfg.customFields = readCf().filter((f) => f.label.trim()); if (await saveConfig('Champs personnalisés enregistrés.')) render(); };
ACT['pm-save'] = async () => { S.cfg.modules = { inventaire: $('#pm-inv').checked, etiquettes: $('#pm-eti').checked, import: $('#pm-imp').checked, fiscal: $('#pm-fis').checked }; if (await saveConfig('Modules enregistrés.')) render(); };

/* ---------------- Sécurité ---------------- */
TITLES['adm-secu'] = { title: 'Sécurité' };
VIEWS['adm-secu'] = function () {
  return '<div class="grid-2"><div class="panel"><h3>Compte administrateur</h3><form class="form" id="ad-form"><label class="field"><span>Identifiant (e-mail)</span><input id="ad-email" type="email" value="' + esc(S.adminAuth.email) + '" required></label><label class="field"><span>Mot de passe actuel</span><input id="ad-old" type="password" autocomplete="current-password" required></label><label class="field"><span>Nouveau mot de passe</span><input id="ad-new" type="password" autocomplete="new-password"><small>Laisser vide pour ne changer que l\'identifiant. 10 caractères minimum conseillés.</small></label><label class="field"><span>Confirmation</span><input id="ad-new2" type="password" autocomplete="new-password"></label><div class="actions"><button class="btn" type="submit">Enregistrer</button></div></form></div>' +
    '<div class="panel"><h3>Règles d\'accès</h3><ul style="margin:0;padding-left:18px;display:grid;gap:8px"><li>Seul l\'administrateur voit la liste des clients, crée, modifie, désactive ou supprime un environnement.</li><li>Chaque client se connecte avec son identifiant et n\'accède qu\'à son propre environnement.</li><li>Les mots de passe sont conservés sous forme d\'empreinte (hachage salé), jamais en clair.</li><li>Cinq échecs de connexion successifs bloquent les tentatives pendant 30 secondes.</li>' + (Store.mode === 'db' ? '<li>Dans la base partagée, seul le propriétaire de l\'application peut modifier la liste des clients et le paramétrage.</li>' : '') + '</ul></div></div>';
};
VIEWS['adm-secu'].after = function () {
  const f = $('#ad-form'); if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#ad-email').value.trim().toLowerCase(), o = $('#ad-old').value, n1 = $('#ad-new').value, n2 = $('#ad-new2').value;
    if (EN.hashPassword(o, S.adminAuth.salt) !== S.adminAuth.hash) { toast('Mot de passe actuel incorrect.', 'bad'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast('E-mail invalide.', 'bad'); return; }
    if (S.registry.some((c) => String(c.login).toLowerCase() === email)) { toast('Cet e-mail est déjà l\'identifiant d\'un client.', 'bad'); return; }
    const next = { email: email, salt: S.adminAuth.salt, hash: S.adminAuth.hash, updatedAt: nowIso() };
    if (n1) {
      if (!strongPwd(n1)) { toast('Nouveau mot de passe : 8 caractères minimum, avec lettres et chiffres.', 'bad'); return; }
      if (n1 !== n2) { toast('La confirmation ne correspond pas.', 'bad'); return; }
      next.salt = EN.randomSalt(); next.hash = EN.hashPassword(n1, next.salt);
    }
    try { await Store.set(P.admin, next); S.adminAuth = next; toast('Compte administrateur mis à jour.', 'ok'); render(); }
    catch (err) { storeError(err, 'compte administrateur'); }
  });
};

/* ---------------- Sauvegarde ---------------- */
TITLES['adm-backup'] = { title: 'Sauvegarde' };
VIEWS['adm-backup'] = function () {
  return '<div class="grid-2"><div class="panel"><h3>Exporter</h3><p class="muted" style="margin-top:0">Fichier JSON contenant le paramétrage, les clients, leurs environnements, immobilisations et inventaires. Conservez-le en lieu sûr' + (SUPA ? ' : il contient toutes les données comptables (aucun mot de passe).' : ' : il contient les empreintes des mots de passe.') + '</p><button class="btn" data-act="bk-export">' + icon('dl') + 'Exporter la sauvegarde complète</button></div>' +
    '<div class="panel"><h3>Restaurer</h3><p class="muted" style="margin-top:0">Recharge une sauvegarde : les documents présents dans le fichier remplacent ceux de même identifiant. Les autres données sont conservées.</p><label class="field"><span>Fichier de sauvegarde (.json)</span><input type="file" id="bk-file" accept=".json,application/json"></label></div></div>';
};
VIEWS['adm-backup'].after = function () { const f = $('#bk-file'); if (f) f.addEventListener('change', () => restoreBackup(f.files[0])); };
ACT['bk-export'] = async () => {
  toast('Préparation de la sauvegarde…');
  try {
    await loadRegistry();
    const out = { format: 'ctb-immobilisations', version: 1, exportedAt: nowIso(), config: S.cfg, admin: SUPA ? null : await Store.get(P.admin), clients: S.registry, tenants: {} };
    for (const c of S.registry) out.tenants[c.id] = { doc: await Store.get(P.tenant(c.id)), assets: await Store.list(P.assets(c.id)), inventories: await Store.list(P.invs(c.id)) };
    saveFile('Sauvegarde_CTB_Immobilisations_' + EN.today() + '.json', new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  } catch (e) { storeError(e, 'sauvegarde'); }
};
async function restoreBackup(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await readFile(file, true)); } catch (e) { toast('Fichier illisible.', 'bad'); return; }
  if (!data || data.format !== 'ctb-immobilisations') { toast('Ce fichier n\'est pas une sauvegarde immo.', 'bad'); return; }
  const nb = (data.clients || []).length;
  const ok = await confirmBox('Restaurer la sauvegarde', '<p>Sauvegarde du ' + esc(fdate(String(data.exportedAt).slice(0, 10))) + ' : ' + nb + ' client(s). Le paramétrage et les documents correspondants seront remplacés.</p>', 'Restaurer', true);
  if (!ok) return;
  try {
    if (data.config) { S.cfg = mergeConfig(data.config); await Store.set(P.config, S.cfg); }
    if (!SUPA && data.admin && data.admin.hash) { await Store.set(P.admin, data.admin); S.adminAuth = data.admin; }
    for (const c of data.clients || []) {
      const reg = clone(c); const id = reg.id; delete reg.id;
      await Store.set(P.client(id), reg);
      const t = (data.tenants || {})[id];
      if (t) {
        if (t.doc) await Store.set(P.tenant(id), t.doc);
        for (const a of t.assets || []) await Store.set(P.asset(id, a.id), a);
        for (const i of t.inventories || []) await Store.set(P.inv(id, i.id), i);
      }
    }
    toast('Restauration terminée. Invitez ensuite chaque client depuis la liste des clients.', 'ok'); await enterAdmin();
  } catch (e) { storeError(e, 'restauration'); }
}

/* ==========================================================================
   Logique de la codification : structure du code, règles de gestion,
   décodeur, simulateur, état des compteurs et référentiels du code
   ========================================================================== */
TITLES.codification = { title: 'Logique de la codification' };

const CODE_SEGS = [
  { k: 'societe', l: 'Société', pos: '1-2', n: 2, cls: 's1' },
  { k: 'annee', l: 'Année d\'acquisition', pos: '3-4', n: 2, cls: 's2' },
  { k: 'emplacement', l: 'Emplacement d\'origine', pos: '5-6', n: 2, cls: 's3' },
  { k: 'categorie', l: 'Catégorie', pos: '7-8', n: 2, cls: 's4' },
  { k: 'compteur', l: 'Compteur', pos: '9-11', n: 3, cls: 's5' }
];
const SCOPE_TXT = {
  prefix: { l: 'Par combinaison société + année + emplacement + catégorie', d: 'Le compteur repart à 001 pour chaque combinaison distincte des huit premiers caractères. Chaque combinaison accepte 999 biens.' },
  cat: { l: 'Par société et catégorie', d: 'Le compteur est commun à toutes les années et à tous les emplacements d\'une même catégorie : le numéro indique le rang du bien dans sa catégorie. 999 biens par catégorie.' },
  global: { l: 'Unique pour toute la société', d: 'Un seul compteur pour tous les biens de la société, quelle que soit la combinaison : le numéro indique l\'ordre d\'enregistrement. 999 biens au total.' }
};

/** Exemple de code : le dernier bien enregistré, sinon un code construit avec les référentiels de la société. */
function codeExample() {
  if (S.tenant) {
    const last = S.assets.filter((a) => a.code && a.code.length === 11).sort((p, q) => String(q.createdAt || '').localeCompare(String(p.createdAt || '')))[0];
    if (last) return { code: last.code, asset: last };
    const e = emps()[0], c = cats().find((x) => !x.enCours) || cats()[0];
    return { code: EN.codePrefix(S.tenant.codeSociete, EN.today(), e ? e.code : '01', c ? c.code : '10') + '001', asset: null };
  }
  return { code: 'SY' + EN.today().slice(2, 4) + '0312001', asset: null };
}

/** Lecture commentée de chaque segment d'un code pour la société ouverte (ou le registre des clients pour l'administrateur). */
function codeMeaning(p) {
  const out = {};
  if (S.tenant) {
    out.societe = p.societe === S.tenant.codeSociete ? S.tenant.raison : 'Autre société que ' + S.tenant.raison + ' (' + S.tenant.codeSociete + ')';
  } else {
    const c = (S.registry || []).find((x) => x.codeSociete === p.societe);
    out.societe = c ? c.raison : 'Code société non attribué';
  }
  out.annee = /^\d{2}$/.test(p.annee) ? 'Acquis en 20' + p.annee : 'Année invalide (2 chiffres attendus)';
  if (S.tenant) {
    const e = empOf(p.emplacement), c = catOf(p.categorie);
    out.emplacement = e ? e.libelle + (e.site ? ' (' + e.site + ')' : '') : 'Emplacement ' + p.emplacement + ' non défini';
    out.categorie = c ? c.libelle : 'Catégorie ' + p.categorie + ' non définie';
  } else {
    const c = (S.cfg.categories || []).find((x) => x.code === p.categorie);
    out.emplacement = 'Numéro propre à chaque société';
    out.categorie = c ? c.libelle + ' (référentiel du cabinet)' : 'Catégorie ' + p.categorie + ' hors référentiel du cabinet';
  }
  out.compteur = /^\d{3}$/.test(p.compteur) && p.compteur !== '000' ? 'N° ' + Number(p.compteur) + ' de la série' : 'Compteur invalide (001 à 999)';
  return out;
}

function codeAnatomy(code, meaning) {
  const p = EN.parseCode(code) || {};
  return '<div class="code-anatomy" aria-label="Décomposition du code ' + esc(codeTxt(code)) + '">' + CODE_SEGS.map((s) =>
    '<div class="ca-seg ' + s.cls + '"><b class="mono">' + esc(p[s.k] || '') + '</b><span>' + esc(s.l) + '</span><small>positions ' + s.pos + '</small>' + (meaning ? '<em>' + esc(meaning[s.k] || '') + '</em>' : '') + '</div>').join('') + '</div>';
}

/** Compteurs utilisés selon la portée retenue. */
function counterState() {
  const scope = S.cfg.counterScope || 'prefix';
  const groups = {};
  S.assets.forEach((a) => {
    if (!a.code || a.code.length !== 11) return;
    const key = scope === 'global' ? a.code.slice(0, 2) : scope === 'cat' ? a.code.slice(0, 2) + '·' + a.code.slice(6, 8) : a.code.slice(0, 8);
    const g = groups[key] || (groups[key] = { key: key, n: 0, max: 0, sortis: 0, sample: a.code });
    g.n++; if (a.sortie) g.sortis++;
    const k = parseInt(a.code.slice(8, 11), 10); if (k > g.max) g.max = k;
  });
  return Object.values(groups).sort((p, q) => p.key.localeCompare(q.key));
}
function counterLabel(g) {
  const scope = S.cfg.counterScope || 'prefix';
  const c = g.sample;
  if (scope === 'global') return 'Toute la société ' + c.slice(0, 2);
  if (scope === 'cat') return c.slice(0, 2) + ' · catégorie ' + c.slice(6, 8) + ' – ' + ((catOf(c.slice(6, 8)) || {}).libelle || '');
  return EN.fmtCode(c.slice(0, 8) + '___', S.cfg.codeSep).replace('___', '…') + ' · ' + ((empOf(c.slice(4, 6)) || {}).libelle || 'empl. ' + c.slice(4, 6)) + ' · ' + ((catOf(c.slice(6, 8)) || {}).libelle || 'cat. ' + c.slice(6, 8));
}

VIEWS.codification = function () {
  const ex = codeExample();
  const scope = S.cfg.counterScope || 'prefix';
  const sepTxt = S.cfg.codeSep === '-' ? 'un tiret' : S.cfg.codeSep === '.' ? 'un point' : S.cfg.codeSep === ' ' ? 'un espace' : 'aucun séparateur';
  const t = S.tenant;
  const head = '<div class="page-head"><div><h2>Logique de la codification</h2><p>Chaque immobilisation reçoit un code unique de 11 caractères, attribué automatiquement à son enregistrement. Ce code est l\'identifiant du bien : il figure sur l\'étiquette, dans le registre, à l\'inventaire physique et dans tous les rapports.</p></div></div>';

  const hero = '<div class="panel code-hero"><div class="panel-head"><h3>Structure du code</h3><span class="muted" style="font-size:12.5px">' + (ex.asset ? 'Exemple : dernier bien enregistré – ' + esc(ex.asset.designation) : 'Exemple construit avec ' + (t ? 'les référentiels de la société' : 'un code fictif')) + '</span></div>' +
    '<div class="code-formula mono" aria-hidden="true">SS AA EE CC NNN</div>' +
    codeAnatomy(ex.code, codeMeaning(EN.parseCode(ex.code))) +
    '<p class="muted" style="margin:14px 0 0;font-size:13px">Le code est enregistré sans séparateur (' + esc(ex.code) + ') et affiché avec ' + esc(sepTxt) + ' (' + esc(codeTxt(ex.code)) + '). L\'étiquette porte un code-barres Code 128 des 11 caractères.</p></div>';

  const seg = (cls, n, title, pos, paras, extra) => '<div class="seg-card ' + cls + '"><div class="seg-h"><span class="seg-n mono">' + n + '</span><div><h4>' + esc(title) + '</h4><small>positions ' + esc(pos) + '</small></div></div>' + paras.map((x) => '<p>' + x + '</p>').join('') + (extra || '') + '</div>';
  const segs = '<div class="panel"><h3>Les cinq éléments du code</h3><div class="seg-grid">' +
    seg('s1', 'SS', 'Société', '1 et 2', [
      'Code de 2 caractères (lettres ou chiffres) attribué par le cabinet CTB à la création de l\'environnement de la société.',
      'Il est unique parmi les clients du cabinet et ne peut plus être modifié ensuite : une étiquette identifie la société propriétaire, même hors de ses locaux.'
    ], t ? '<div class="seg-val">Pour cette société : <b class="mono">' + esc(t.codeSociete) + '</b> – ' + esc(t.raison) + '</div>' : '') +
    seg('s2', 'AA', 'Année d\'acquisition', '3 et 4', [
      'Les deux derniers chiffres de l\'année civile de la <b>date d\'acquisition</b> (ou d\'entrée) du bien, et non de sa mise en service ni de l\'exercice comptable.',
      'Exemple : un bien acquis le 15/12/2025 et mis en service le 10/01/2026 porte <b class="mono">25</b>. Pour une société à exercice décalé, l\'année du code reste l\'année civile d\'acquisition.'
    ]) +
    seg('s3', 'EE', 'Emplacement d\'origine', '5 et 6', [
      'Numéro (01 à 99) de l\'emplacement où le bien est affecté à son entrée : bureau, atelier, dépôt, site, parc automobile…',
      'Après un transfert, le code conserve l\'emplacement d\'origine ; l\'emplacement actuel est suivi à part sur la fiche, dans l\'historique et à l\'inventaire. Un numéro d\'emplacement déjà utilisé par des biens ne peut plus être modifié.'
    ]) +
    seg('s4', 'CC', 'Catégorie', '7 et 8', [
      'Code (01 à 99) de la catégorie d\'immobilisation, définie selon la nature du bien : terrains, constructions, matériel industriel, matériel de transport, mobilier, matériel informatique, logiciels…',
      'La catégorie porte les comptes, la durée d\'utilité et le traitement fiscal. Après un reclassement ou la mise en service d\'une immobilisation en cours, le code garde la catégorie d\'origine : la catégorie actuelle figure sur la fiche.'
    ]) +
    seg('s5', 'NNN', 'Compteur', '9 à 11', [
      'Numéro d\'ordre de 001 à 999, attribué à l\'enregistrement : le premier numéro libre après le plus élevé déjà utilisé dans la série.',
      'Portée retenue : <b>' + esc(SCOPE_TXT[scope].l) + '</b>. ' + esc(SCOPE_TXT[scope].d)
    ], S.session && S.session.role === 'admin' ? '<div class="seg-val">' + (S.tenant ? 'Réglage commun à tous les clients : Paramétrage → Codification.' : '<button class="link" data-act="code-scope">Modifier la portée du compteur</button>') + '</div>' : '') +
    '</div></div>';

  const rules = '<div class="panel"><h3>Règles de gestion</h3><div class="rule-grid">' + [
    ['Attribution automatique', 'Le code est calculé à l\'enregistrement à partir de la société, de la date d\'acquisition, de l\'emplacement et de la catégorie saisis. Il s\'affiche en direct pendant la saisie de la fiche.'],
    ['Code définitif', 'Le code ne change jamais : ni après un transfert, un reclassement, une mise en service, une réévaluation, ni après la sortie du bien. Une étiquette posée reste valable toute la vie du bien.'],
    ['Pas de réutilisation', 'Un bien sorti (vendu, mis au rebut, volé) conserve son code, et son numéro n\'est jamais réattribué. Seule la suppression d\'une fiche saisie par erreur peut libérer le dernier numéro d\'une série.'],
    ['Composants', 'Chaque composant amorti séparément (NC 05 §12) reçoit son propre code, selon sa propre catégorie et son année d\'acquisition, et reste rattaché au bien principal.'],
    ['Un code par fiche', 'Une fiche saisie pour un lot (4 ordinateurs par exemple) porte un seul code. Pour étiqueter et inventorier chaque unité, enregistrez une fiche par bien.'],
    ['Reprise d\'un registre existant', 'À l\'import Excel, la colonne « Code existant » conserve les anciens codes de 11 caractères ; les nouveaux biens prennent ensuite le numéro suivant le plus élevé de leur série.'],
    ['Limite de 999', 'Au-delà de 999 biens dans une même série, l\'enregistrement est refusé. L\'administrateur peut alors élargir la portée du compteur : changer de portée ne crée jamais de doublon, car le numéro suit toujours le plus élevé existant.'],
    ['Recherche et lecture', 'La recherche, la douchette d\'inventaire et le choix d\'un bien acceptent le code avec ou sans séparateurs, en majuscules ou en minuscules.']
  ].map((r, i) => '<div class="rule"><span class="rule-n">' + (i + 1) + '</span><div><b>' + esc(r[0]) + '</b><p>' + esc(r[1]) + '</p></div></div>').join('') + '</div></div>';

  const tools = '<div class="grid-2">' +
    '<div class="panel"><h3>Décoder un code</h3><p class="muted" style="margin:0 0 12px;font-size:13px">Saisissez ou scannez un code pour lire chacun de ses éléments' + (t ? ' et retrouver le bien correspondant' : '') + '.</p>' +
    '<label class="field"><span>Code immobilisation</span><input id="cd-in" class="mono" placeholder="' + esc(codeTxt(ex.code)) + '" autocomplete="off"></label><div id="cd-out" style="margin-top:12px"></div></div>' +
    (t ? '<div class="panel"><h3>Simuler le prochain code</h3><p class="muted" style="margin:0 0 12px;font-size:13px">Choisissez la date d\'acquisition, l\'emplacement et la catégorie : l\'application affiche le code qui serait attribué au prochain bien.</p>' +
      '<div class="form"><div class="row"><label class="field"><span>Date d\'acquisition</span><input id="cs-date" type="date" value="' + esc(EN.today()) + '"></label>' +
      '<label class="field"><span>Emplacement</span><select id="cs-emp">' + emps().map((e) => '<option value="' + esc(e.code) + '">' + esc(e.code + ' – ' + e.libelle) + '</option>').join('') + '</select></label></div>' +
      '<label class="field"><span>Catégorie</span><select id="cs-cat">' + cats().map((c) => '<option value="' + esc(c.code) + '">' + esc(c.code + ' – ' + c.libelle) + '</option>').join('') + '</select></label></div><div id="cs-out" style="margin-top:12px"></div></div>'
      : '<div class="panel"><h3>Codes société attribués</h3>' + ((S.registry || []).length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Société</th><th>Accès</th></tr></thead><tbody>' + S.registry.slice().sort((p, q) => String(p.codeSociete).localeCompare(String(q.codeSociete))).map((c) => '<tr><td class="code">' + esc(c.codeSociete) + '</td><td>' + esc(c.raison) + '</td><td>' + (c.actif === false ? '<span class="pill grey">désactivé</span>' : '<span class="pill ok">actif</span>') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted" style="margin:0">Aucun client créé.</p>') + '<p class="muted" style="margin:12px 0 0;font-size:12.5px">Le code société est choisi à la création du client (proposé à partir de la raison sociale) et ne peut plus être modifié.</p></div>') +
    '</div>';

  let refs = '';
  if (t) {
    const cs = counterState();
    const usedEmp = {}, usedCat = {};
    S.assets.forEach((a) => { if (a.code && a.code.length === 11) { const e = a.code.slice(4, 6), c = a.code.slice(6, 8); usedEmp[e] = (usedEmp[e] || 0) + 1; usedCat[c] = (usedCat[c] || 0) + 1; } });
    refs = '<div class="panel"><div class="panel-head"><h3>État des compteurs</h3><span class="muted" style="font-size:12.5px">Portée : ' + esc(SCOPE_TXT[scope].l.toLowerCase()) + '</span></div>' +
      (cs.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Série</th><th class="num">Biens codés</th><th class="num">dont sortis</th><th class="num">Dernier numéro</th><th class="num">Numéros disponibles</th><th></th></tr></thead><tbody>' +
        cs.map((g) => '<tr><td>' + esc(counterLabel(g)) + '</td><td class="num">' + g.n + '</td><td class="num">' + (g.sortis || '') + '</td><td class="num mono">' + String(g.max).padStart(3, '0') + '</td><td class="num">' + (999 - g.max) + '</td><td>' + (g.max >= 950 ? '<span class="pill bad">Proche de la limite</span>' : g.max >= 800 ? '<span class="pill warn">À surveiller</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted" style="margin:0">Aucun bien enregistré : le premier bien de chaque série recevra le numéro 001.</p>') + '</div>' +
      '<div class="grid-2"><div class="panel"><div class="panel-head"><h3>Emplacements (EE)</h3><button class="btn ghost sm" data-act="env-tab" data-tab="emp">Gérer</button></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Emplacement</th><th>Site</th><th class="num">Biens codés</th></tr></thead><tbody>' +
      (emps().length ? emps().map((e) => '<tr><td class="code">' + esc(e.code) + '</td><td>' + esc(e.libelle) + '</td><td>' + esc(e.site || '') + '</td><td class="num">' + (usedEmp[e.code] || '') + '</td></tr>').join('') : '<tr><td colspan="4" class="muted">Aucun emplacement défini.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="panel"><div class="panel-head"><h3>Catégories (CC)</h3><button class="btn ghost sm" data-act="env-tab" data-tab="cat">Gérer</button></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Catégorie</th><th>Compte</th><th class="num">Biens codés</th></tr></thead><tbody>' +
      cats().map((c) => '<tr><td class="code">' + esc(c.code) + '</td><td>' + esc(c.libelle) + '</td><td class="mono">' + esc(c.cptImmo || '') + '</td><td class="num">' + (usedCat[c.code] || '') + '</td></tr>').join('') + '</tbody></table></div></div></div>';
  } else {
    refs = '<div class="panel"><div class="panel-head"><h3>Catégories du référentiel du cabinet (CC)</h3><button class="btn ghost sm" data-act="nav" data-view="adm-param">Paramétrage</button></div><p class="muted" style="margin:0 0 12px;font-size:13px">Chaque nouvelle société reçoit ces catégories ; elle peut ensuite les adapter. Les emplacements (EE) sont propres à chaque société.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Catégorie</th><th>Type</th><th>Compte</th></tr></thead><tbody>' +
      (S.cfg.categories || []).map((c) => '<tr><td class="code">' + esc(c.code) + '</td><td>' + esc(c.libelle) + '</td><td>' + (c.type === 'I' ? 'Incorporelle' : 'Corporelle') + '</td><td class="mono">' + esc(c.cptImmo || '') + '</td></tr>').join('') + '</tbody></table></div></div>';
  }
  return head + hero + segs + rules + tools + refs;
};
VIEWS.codification.after = function () {
  const inp = $('#cd-in');
  if (inp) {
    const upd = () => {
      const out = $('#cd-out'); const raw = inp.value; const c = EN.normCode(raw);
      if (!c) { out.innerHTML = ''; return; }
      if (c.length !== 11) { out.innerHTML = '<div class="note warn">' + c.length + ' caractère(s) lu(s) : un code comporte 11 caractères (2 + 2 + 2 + 2 + 3).</div>'; return; }
      const p = EN.parseCode(c), m = codeMeaning(p);
      const a = S.tenant ? S.assets.find((x) => x.code === c) : null;
      out.innerHTML = codeAnatomy(c, m) + (S.tenant ? (a ? '<div class="note ok" style="margin-top:12px">Bien trouvé : <button class="link" data-act="asset-open" data-id="' + esc(a.id) + '">' + esc(a.designation) + '</button>' + (a.sortie ? ' – sorti le ' + fdate(a.sortie.date) : ' – actuellement : ' + esc(empLabel(a.emplacement))) + '</div>' : '<div class="note" style="margin-top:12px">Aucun bien de la société ne porte ce code.</div>') : '');
    };
    inp.addEventListener('input', upd);
  }
  const d = $('#cs-date');
  if (d) {
    const sim = () => {
      const out = $('#cs-out'), date = d.value, e = $('#cs-emp').value, k = $('#cs-cat').value;
      if (!EN.isValidIso(date) || !e || !k) { out.innerHTML = '<div class="note warn">Renseignez une date, un emplacement et une catégorie.</div>'; return; }
      const code = EN.nextCode(S.assets, EN.codePrefix(S.tenant.codeSociete, date, e, k), S.cfg.counterScope);
      out.innerHTML = code ? '<div class="sim-code"><span>Prochain code attribué</span><b class="mono">' + esc(codeTxt(code)) + '</b></div>' + codeAnatomy(code, null) : '<div class="note bad">Série complète (999) : aucun numéro disponible pour cette combinaison.</div>';
    };
    ['#cs-date', '#cs-emp', '#cs-cat'].forEach((s) => { const x = $(s); x.addEventListener('input', sim); x.addEventListener('change', sim); });
    sim();
  }
};
ACT['code-scope'] = () => { S.ui.pTab = 'code'; go('adm-param'); };

/* ==========================================================================
   Manuel d'utilisation intégré (consultable sans connexion, exportable en PDF)
   ========================================================================== */
const MANUAL = [
  { id: 'presentation', title: 'Présentation', blocks: [
    ['p', 'immo est l\'application de gestion des immobilisations corporelles et incorporelles conçue par le Cabinet Tahar Bakir (CTB) pour ses clients. Elle reste la propriété de CTB. Nous l\'avons construite autour d\'un principe simple : le référentiel est la norme comptable. Les immobilisations corporelles sont tenues selon la NC 05 « Immobilisations corporelles » (version applicable aux exercices ouverts à compter du 1er janvier 2021) et les incorporelles selon la NC 06. La fiscalité tunisienne est traitée à part, dans un passage comptable / fiscal.'],
    ['p', 'L\'application couvre tout le cycle de vie d\'un bien :'],
    ['ul', ['codification et étiquetage (code-barres) ;', 'coût d\'entrée détaillé, composants, dépenses ultérieures ;', 'amortissement sur la durée d\'utilité, révisions d\'estimations ;', 'tests de dépréciation, modèle de la réévaluation, provisions pour démantèlement ;', 'sorties (cession, casse, vol, perte, remplacement) ;', 'inventaire physique et procès-verbal d\'écarts ;', 'rapports annuels, notes aux états financiers, écritures d\'inventaire et passage fiscal, en PDF et en Excel.']],
    ['p', 'Chaque société cliente dispose de son propre environnement, isolé des autres. Seul l\'administrateur du cabinet voit l\'ensemble des clients et peut en créer.']
  ] },
  { id: 'acces', title: 'Accès, rôles et sécurité', blocks: SUPA ? [
    ['h', 'Qui peut accéder'],
    ['ul', ['Administrateur (cabinet CTB) : crée, modifie, désactive ou supprime les environnements clients, paramètre l\'application, consulte les journaux de sécurité, sauvegarde et restaure les données, et peut entrer dans n\'importe quel environnement client.', 'Client : accède uniquement aux immobilisations de sa société, avec l\'adresse e-mail déclarée par le cabinet.', 'Toute autre personne : aucun accès. Les inscriptions libres sont fermées.']],
    ['h', 'Première connexion : validation de l\'adresse e-mail'],
    ['ol', ['L\'administrateur crée le client avec son adresse e-mail : une invitation est envoyée automatiquement.', 'Le client ouvre le lien reçu. Son adresse est ainsi validée et l\'application lui demande de choisir son mot de passe : 10 caractères minimum, avec majuscules, minuscules et chiffres.', 'Il accède ensuite à sa société. Sans ouverture du lien, aucune connexion n\'est possible, même avec un mot de passe.']],
    ['h', 'Connexions suivantes'],
    ['p', 'Chaque connexion se fait en deux étapes : saisissez votre e-mail et votre mot de passe, puis le code à 6 chiffres envoyé aussitôt à votre adresse e-mail (valable 10 minutes). La base de données vérifie elle-même les deux étapes : un mot de passe seul, ou un code seul, ne donne accès à aucune donnée.'],
    ['p', 'Les mots de passe ne sont lisibles par personne, pas même par le cabinet : ils sont conservés sous forme chiffrée irréversible. En cas d\'oubli, contactez le cabinet : seul l\'administrateur peut envoyer à un client un lien personnel de réinitialisation (bouton « Réinitialiser le mot de passe » de la liste des clients). La session se ferme à la fermeture de l\'onglet et après une période d\'inactivité (30 minutes par défaut).'],
    ['h', 'Application d\'authentification (facultative)'],
    ['p', 'Dans « Sécurité » (administrateur) ou « Mon compte » (client), vous pouvez ajouter une troisième protection : en plus du code reçu par e-mail, un code à 6 chiffres généré par une application d\'authentification est demandé. Une fois activée, la base de données refuse tout accès aux données sans ce second facteur. Elle est recommandée pour le compte administrateur ; le cabinet peut la rendre obligatoire (réglage admin_totp_required du fichier schema.sql).'],
    ['h', 'Protection des données'],
    ['p', 'Les données sont hébergées dans Supabase. Les règles d\'accès sont appliquées par la base de données elle-même : un client ne peut ni lire ni modifier les données d\'une autre société, même en contournant l\'application. L\'administrateur dispose d\'un journal des connexions et d\'un journal des modifications (« Sécurité »).'],
    ['tip', 'Un client désactivé perd l\'accès immédiatement ; ses données sont conservées. Pour changer l\'adresse e-mail d\'un client, modifiez-la puis renvoyez l\'invitation.']
  ] : [
    ['h', 'Les deux rôles'],
    ['ul', ['Administrateur (cabinet CTB) : crée, modifie, désactive ou supprime les environnements clients, paramètre l\'application sans programmation, sauvegarde et restaure les données, et peut entrer dans n\'importe quel environnement client.', 'Client : se connecte avec l\'identifiant et le mot de passe remis par le cabinet et n\'accède qu\'aux immobilisations de sa société.']],
    ['h', 'Connexion'],
    ['p', 'Saisissez votre identifiant (adresse e-mail) et votre mot de passe sur l\'écran d\'accueil. Après cinq échecs successifs, les tentatives sont bloquées pendant 30 secondes. Les mots de passe sont conservés sous forme d\'empreinte salée et ne sont jamais stockés en clair. Un client modifie son mot de passe dans « Mon compte » ; l\'administrateur peut le réinitialiser depuis la liste des clients.'],
    ['h', 'Données et partage'],
    ['p', 'Lorsque l\'application est ouverte dans claude.ai, les données sont enregistrées dans la base partagée de l\'application (pastille verte « Base partagée »). Pour qu\'un client saisisse ses données, partagez l\'application avec lui depuis le menu Partager, avec un niveau d\'accès permettant de l\'utiliser (Contributeur). Seul le propriétaire de l\'application peut modifier la liste des clients et le paramétrage. Ouverte hors de claude.ai, l\'application enregistre les données dans le navigateur (pastille orange) : exportez alors régulièrement une sauvegarde.'],
    ['tip', 'L\'isolement des clients est assuré par l\'application. Pour une confidentialité renforcée entre clients, un hébergement dédié avec serveur peut être mis en place par le cabinet.']
  ] },
  { id: 'demarrage', title: 'Premiers pas de l\'administrateur', blocks: [
    ['ol', [SUPA ? 'Ouvrez le lien d\'invitation reçu par e-mail, choisissez votre mot de passe, puis activez la double authentification dans « Sécurité ».' : 'Connectez-vous avec le compte administrateur, puis remplacez immédiatement le mot de passe initial dans « Sécurité ».', 'Dans « Paramétrage → Identité visuelle », chargez le logo CTB (de préférence la version blanche sur fond transparent) et ajustez les couleurs si besoin.', 'Vérifiez les « Catégories modèles », les « Comptes » et le « Référentiel fiscal ». Ils sont copiés dans chaque nouvel environnement.', SUPA ? 'Créez un client : raison sociale, code société de deux caractères (début de tous ses codes), adresse e-mail du client, date de clôture et référentiel d\'amortissement. L\'invitation part automatiquement ; la colonne « Accès » indique quand le client a validé son adresse.' : 'Créez un client : raison sociale, code société de deux caractères (début de tous ses codes), identifiant, mot de passe initial, date de clôture et référentiel d\'amortissement. Communiquez l\'identifiant et le mot de passe affichés : le mot de passe n\'est plus visible ensuite.', 'Pour découvrir l\'application, créez le client de démonstration. Il contient des biens fictifs illustrant chaque règle de la NC 05 : réévaluation, test de dépréciation, composant, démantèlement, subvention, révision, cession. Il n\'a pas d\'accès client : ses données fictives sont consultables par l\'administrateur.']],
    ['p', 'Le bouton « Ouvrir » d\'un client vous fait entrer dans son environnement (bandeau « Mode administrateur ») ; « Retour à l\'administration » vous ramène à la liste.']
  ] },
  { id: 'environnement', title: 'Préparer l\'environnement d\'une société', blocks: [
    ['p', 'Avant toute saisie, ouvrez « Paramètres société ».'],
    ['h', 'Société et référentiel'],
    ['ul', ['Date de clôture : les exercices sont déterminés à partir de cette date (exercice décalé possible).', 'Prorata temporis : jours exacts (par défaut), mois entiers ou base 360 jours.', 'Référentiel d\'amortissement comptable : « NC 05 » (durées d\'utilité estimées par la société, recommandé) ou « Textes fiscaux » (taux maximum du décret n° 2008-492). Si la société retient les taux fiscaux, une note spécifique est produite dans les notes aux états financiers.', 'Écart de réévaluation : virement aux résultats reportés à la sortie du bien, ou au fur et à mesure de son utilisation (NC 05 §40).']],
    ['h', 'Emplacements'],
    ['p', 'Chaque emplacement (bureau, atelier, site, véhicule…) reçoit un numéro de 01 à 99, repris dans le code des biens. Un numéro utilisé ne peut plus être modifié.'],
    ['h', 'Catégories'],
    ['p', 'Pour chaque catégorie, vous définissez :'],
    ['ul', ['code à deux chiffres (repris dans le code des biens) et libellé ;', 'type : corporelle (NC 05) ou incorporelle (NC 06) ;', 'comptes d\'immobilisation, d\'amortissement, de pertes de valeur (29) et de dotation (6811) ;', 'durée d\'utilité indicative en années, qui est l\'estimation comptable de la société ;', 'taux fiscal maximum du décret n° 2008-492 ;', 'modèle d\'évaluation (coût ou réévaluation) et fréquence de réévaluation ;', 'indicateurs : amortissable, immobilisation en cours, déductibilité fiscale, éligibilité au coefficient d\'équipes, matériel roulant (immatriculation et n° de châssis au lieu du n° de série), voiture de tourisme.']],
    ['tip', 'Les durées livrées sont indicatives. La NC 05 (§44 et §45) demande de les estimer selon l\'usage attendu, l\'usure physique, l\'obsolescence technique et les limites juridiques propres à la société.']
  ] },
  { id: 'codification', title: 'Codification des immobilisations', blocks: [
    ['p', 'Chaque bien reçoit automatiquement un code de 11 caractères, attribué à l\'enregistrement :'],
    ['table', { cols: ['Positions', 'Contenu', 'Exemple'], rows: [['1-2', 'Code de la société', 'SY'], ['3-4', 'Année d\'acquisition', '26'], ['5-6', 'Numéro de l\'emplacement d\'origine', '03'], ['7-8', 'Code de la catégorie', '12'], ['9-11', 'Compteur', '001']] }],
    ['p', 'Le compteur peut être tenu par combinaison complète (par défaut), par société et catégorie, ou pour toute la société (Paramétrage → Codification). Le code ne change jamais, même après un transfert ou un reclassement : c\'est l\'identifiant imprimé sur l\'étiquette. La recherche accepte le code avec ou sans séparateurs.'],
    ['p', 'La page « Logique de la codification » (menu de gauche, après connexion) détaille chaque élément du code, les règles de gestion (code définitif, absence de réutilisation, composants, lots, reprise d\'un registre, limite de 999), l\'état des compteurs de la société et ses référentiels. Elle comprend un décodeur, qui lit un code saisi ou scanné et retrouve le bien, et un simulateur, qui affiche le prochain code pour une date, un emplacement et une catégorie.']
  ] },
  { id: 'saisie', title: 'Saisir une immobilisation', blocks: [
    ['p', '« Immobilisations → Nouvelle immobilisation » ouvre la fiche de saisie. Le code attribué et un aperçu du plan d\'amortissement s\'affichent en temps réel.'],
    ['h', 'Identification du bien'],
    ['ul', ['Matériel, équipements, informatique et autres biens : marque ou modèle et n° de série.', 'Voitures et matériel roulant (catégories cochées « Roulant ») : immatriculation (n° matricule, par exemple 215 TU 4587) et n° de châssis (VIN). Ces champs remplacent le n° de série dans la fiche, le registre, la recherche et la fiche PDF.', 'Tous ces numéros sont reconnus par la recherche du registre.']],
    ['h', 'Contrats et actes enregistrés'],
    ['p', 'La rubrique « Contrats et actes enregistrés » conserve, pour chaque bien, les références d\'enregistrement des actes et contrats qui le concernent : acte d\'acquisition d\'un terrain ou d\'un immeuble, contrat avec une entreprise de travaux, contrat de leasing, bail ou tout autre contrat enregistré. Pour chacun : nature, n° d\'enregistrement (ou de quittance), date d\'enregistrement, recette des finances et cocontractant. Plusieurs contrats peuvent être rattachés au même bien (par exemple l\'acte d\'acquisition et le contrat de travaux d\'un bâtiment).'],
    ['h', 'Garantie'],
    ['p', 'Indiquez la durée de garantie en mois ou en années, son point de départ (vide = date de mise en service) et le garant ou les conditions. La date de fin est calculée et affichée sur la fiche ; le tableau de bord signale les garanties qui expirent dans les 90 jours, pour faire jouer la garantie avant son terme.'],
    ['h', 'Coût d\'entrée (NC 05 §19 à §27)'],
    ['ul', ['Mode d\'entrée : acquisition, production immobilisée, échange, apport en nature, location-financement (NC 41). Un rappel des règles propres à chaque mode s\'affiche.', 'Cochez « Détailler les composantes du coût » pour saisir le prix d\'achat, les remises (à déduire), les droits et taxes non récupérables, le transport, l\'installation, les honoraires, la préparation du site et les autres frais directement attribuables. Le coût est alors calculé.', 'Les frais généraux, les frais de démarrage et les pertes initiales d\'exploitation restent en charges (§22).', 'Démantèlement et remise en état : indiquez la valeur actualisée de l\'obligation, son taux d\'actualisation et son échéance. Ce montant fait partie du coût (§20 c) ; la provision est désactualisée chaque année en charges financières (§99).', 'Paiement différé au-delà des conditions normales : retenez le prix comptant équivalent (§24).']],
    ['h', 'Amortissement'],
    ['ul', ['Mode : linéaire, dégressif ou unités d\'œuvre (référentiel NC 05). En référentiel fiscal, les modes proposés sont le linéaire aux taux maximum, l\'accéléré pour travail en équipes et l\'intégral pour les biens de faible valeur.', 'Durée d\'utilité : vide = durée de la catégorie (ou durée implicite du taux fiscal en référentiel fiscal).', 'Valeur résiduelle : montant net estimé de la sortie en fin d\'utilisation ; elle est déduite du montant amortissable (§48).', 'L\'amortissement commence à la date de mise en service (vide = date d\'acquisition).']],
    ['h', 'Autres rubriques'],
    ['ul', ['Composant de : rattache le bien à un bien principal (voir « Composants »).', 'Subvention d\'investissement : non déduite du coût (§27) ; la quote-part virée au résultat est calculée au rythme des amortissements.', 'Nantissement : à mentionner dans les notes (§101).', 'Traitement fiscal : plafond automatique, taux maximum, puissance fiscale des voitures de tourisme, règlement en espèces.', 'Reprise d\'un registre antérieur : date de reprise, amortissements cumulés, pertes de valeur, écart de réévaluation, durée résiduelle et cumul déduit fiscalement.']],
    ['h', 'Import Excel'],
    ['p', '« Paramètres société → Import Excel » : téléchargez le modèle, complétez une ligne par bien, puis chargez le fichier. Chaque ligne est contrôlée avant l\'import ; les codes existants peuvent être conservés. Le modèle reprend aussi la référence de pièce comptable, le n° de série, l\'immatriculation, le n° de châssis, la garantie (en mois) et un contrat enregistré.']
  ] },
  { id: 'pieces', title: 'Pièces comptables et piste d\'audit', blocks: [
    ['p', 'Chaque mouvement d\'une immobilisation porte la référence de la pièce comptable qui l\'enregistre. Le registre et la comptabilité se rapprochent ainsi ligne à ligne.'],
    ['table', { cols: ['Mouvement', 'Où saisir la référence', 'Écriture attendue'], rows: [
      ['Entrée (acquisition, production, apport, échange, leasing)', 'Fiche du bien, rubrique « Coût d\'entrée »', 'Oui'],
      ['Mise en service d\'une immobilisation en cours', 'Fenêtre « Mettre en service »', 'Oui (virement 23 → 22)'],
      ['Dépense ultérieure immobilisée', 'Fenêtre « Dépense ultérieure »', 'Oui'],
      ['Réévaluation', 'Fenêtre de réévaluation (une pièce commune pour la catégorie)', 'Oui'],
      ['Test de dépréciation', 'Fenêtre du test', 'Oui si perte de valeur ou reprise'],
      ['Révision de la provision pour démantèlement', 'Fenêtre de révision', 'Oui si l\'estimation varie'],
      ['Reclassement de catégorie', 'Fiche du bien, lors du changement de catégorie', 'Oui (virement de compte à compte)'],
      ['Sortie (cession, rebut, vol, perte, sinistre…)', 'Fenêtre de sortie, en plus du justificatif (facture de vente, PV)', 'Oui'],
      ['Révision des estimations, transfert d\'emplacement', 'Fenêtres correspondantes', 'Facultatif'],
      ['Dotations et autres écritures de clôture', 'Rapport « Écritures d\'inventaire » : une référence par exercice', 'Oui']] }],
    ['p', 'Une référence oubliée se complète après coup : sur la fiche, chaque événement affiche « Pièce comptable à renseigner – saisir ». L\'onglet « Mouvements et pièces » de la fiche récapitule tous les mouvements du bien et leurs références.'],
    ['p', 'Le rapport « État des mouvements et pièces comptables » liste les mouvements de l\'exercice avec leur montant, leur justificatif et leur pièce, et compte ceux qui restent sans référence. Le tableau de bord signale ces mouvements tant qu\'ils ne sont pas complétés.'],
    ['tip', 'Une référence par mouvement suffit : utilisez le n° de pièce de votre logiciel comptable (par exemple AC-2026-0142 pour un achat, OD-2026-12-031 pour une opération diverse).']
  ] },
  { id: 'composants', title: 'Composants et dépenses ultérieures', blocks: [
    ['p', 'Lorsque les éléments d\'un bien ont des durées d\'utilité différentes (moteur d\'une ligne, toiture d\'un bâtiment, révisions périodiques), ils sont comptabilisés et amortis séparément (§12). Sur la fiche du bien principal, utilisez « Ajouter un composant ». Si le nouveau composant remplace un composant existant, l\'ancien est sorti automatiquement à la date de mise en service du nouveau, pour sa valeur comptable (§18 et §79).'],
    ['p', 'Une dépense ultérieure n\'est immobilisée que si elle accroît les avantages économiques au-delà du niveau de performance initial : prolongation de la durée d\'utilité, hausse de capacité, amélioration substantielle de la qualité ou réduction substantielle des coûts (§14 et §15). L\'entretien et les réparations courantes restent en charges (§16). Utilisez « Dépense ultérieure » sur la fiche ; vous pouvez fixer une nouvelle durée résiduelle.']
  ] },
  { id: 'amortissement', title: 'Amortissement selon la NC 05', blocks: [
    ['p', 'Le montant amortissable, égal au coût diminué de la valeur résiduelle, est réparti de façon systématique sur la durée d\'utilité (§42). La dotation est constatée même si la juste valeur dépasse la valeur comptable (§43). Les terrains ne sont pas amortis (§46).'],
    ['ul', ['Linéaire : dotation constante, au prorata temporis la première et la dernière année.', 'Dégressif : taux linéaire multiplié par un coefficient (1,5 jusqu\'à 4 ans, 2 jusqu\'à 6 ans, 2,5 au-delà, paramétrable), appliqué à la valeur nette ; passage au linéaire lorsque celui-ci devient plus élevé.', 'Unités d\'œuvre : dotation proportionnelle aux unités consommées chaque exercice (heures, kilomètres, unités produites).']],
    ['p', 'Le mode doit refléter le rythme de consommation des avantages économiques et être appliqué de façon constante (§49). Le plan d\'amortissement figure sur la fiche du bien. Après une révision, une dépense immobilisée, une perte de valeur ou une réévaluation, la valeur comptable restante est répartie sur la durée résiduelle (§52, §62 et §70).']
  ] },
  { id: 'diligences', title: 'Écran « Évaluation NC 05 » : diligences de clôture', blocks: [
    ['p', 'L\'écran « Évaluation NC 05 » rassemble, pour l\'exercice choisi en haut de l\'écran, les diligences d\'évaluation à mener avant l\'arrêté des comptes. Quatre cartes en tête de page indiquent leur état et ouvrent l\'onglet correspondant :'],
    ['ol', ['Indices de perte de valeur (§55 et §57) : à documenter chaque année, même en l\'absence d\'indice.', 'Revue des estimations (§51 à §54) : durées d\'utilité, valeurs résiduelles et modes, catégorie par catégorie.', 'Tests de dépréciation : requis lorsque des indices ont été relevés ; la carte passe au vert dès qu\'un test est enregistré.', 'Réévaluations : pour les catégories au modèle de la réévaluation, selon la fréquence retenue (§33).']],
    ['p', '« Nouveau test » propose les immobilisations en service à la clôture de l\'exercice. Tant qu\'aucune immobilisation n\'est en service à cette date, le bouton est désactivé et l\'écran invite à saisir d\'abord les immobilisations. Un événement daté après la sortie d\'un bien est refusé, car il serait sans effet.']
  ] },
  { id: 'revision', title: 'Révision des estimations', blocks: [
    ['p', 'La durée d\'utilité, la valeur résiduelle et le mode d\'amortissement sont revus périodiquement (§51 à §54). Sur la fiche, « Réviser les estimations » enregistre une nouvelle durée résiduelle, une nouvelle valeur résiduelle et, le cas échéant, un nouveau mode, à compter d\'une date. La révision est un changement d\'estimation au sens de la NC 11 : elle s\'applique à l\'exercice en cours et aux suivants, sans retraitement du passé. L\'écran montre la dotation de l\'exercice avant et après la révision.'],
    ['p', 'La revue annuelle se documente dans « Évaluation NC 05 → Revue annuelle » : vous cochez par catégorie les revues sans changement et lancez une révision bien par bien si nécessaire. Les révisions de l\'exercice sont reprises automatiquement dans les notes (§103).'],
    ['tip', 'Sous le modèle du coût, la valeur résiduelle n\'est pas augmentée pour tenir compte de la hausse des prix (§48).']
  ] },
  { id: 'depreciation', title: 'Tests de dépréciation', blocks: [
    ['h', 'Quand tester ?'],
    ['p', 'Un test est requis lorsque des circonstances laissent penser que la valeur comptable ne sera pas recouvrée (§55). Les indices prévus par la NC 05 (§57) sont : une baisse significative de la valeur de marché, une évolution défavorable de la législation ou de l\'environnement économique, et des coûts accumulés très supérieurs aux estimations initiales. L\'application ajoute l\'obsolescence, la dégradation physique, l\'arrêt d\'activité, une performance insuffisante et l\'inutilisation. Documentez chaque année la revue des indices dans « Évaluation NC 05 → Revue annuelle ».'],
    ['h', 'Réaliser le test'],
    ['ol', ['Sur la fiche, choisissez « Test de dépréciation » et la date (par défaut, la clôture).', 'Cochez les indices relevés.', 'Renseignez la valeur d\'utilité : flux nets futurs actualisés, sur la durée d\'utilité restante, hors charges financières, augmentés de la valeur de sortie (§58 et §60). Le calculateur intégré actualise une série de flux annuels au taux choisi.', 'Renseignez, le cas échéant, la juste valeur et sa base (marché actif, actif équivalent, autre technique). La valeur récupérable retenue est la plus élevée des valeurs renseignées.', 'Enregistrez : l\'application compare la valeur récupérable à la valeur comptable à cette date.']],
    ['h', 'Effets'],
    ['ul', ['Perte de valeur : constatée en charge par une provision (comptes 6816 / 29). Pour un bien réévalué, elle est d\'abord imputée sur l\'écart de réévaluation du bien (§56). Les dotations futures sont calculées sur la valeur comptable révisée (§62).', 'Reprise : uniquement si les estimations ayant servi à la dernière perte ont changé (§63 et §64) ; le simple passage du temps ne suffit pas (§65). La valeur comptable après reprise ne dépasse pas celle qui aurait existé sans perte de valeur (§66) : l\'application calcule automatiquement ce plafond.']]
  ] },
  { id: 'reevaluation', title: 'Modèle de la réévaluation', blocks: [
    ['p', 'Chaque catégorie suit soit le modèle du coût, soit le modèle de la réévaluation (§28). Choisissez le modèle dans « Paramètres société → Catégories », colonne « Modèle ». Les immobilisations incorporelles restent au modèle du coût.'],
    ['ul', ['Fréquence : assez régulière pour que la valeur comptable ne diffère pas significativement de la juste valeur, soit chaque année pour les biens volatils et tous les trois à cinq ans sinon (§33). L\'écran « Évaluation NC 05 → Réévaluations » signale les catégories à réévaluer.', 'Toute la catégorie est réévaluée simultanément (§35) : « Réévaluer la catégorie » ouvre la liste des biens avec leur valeur comptable, la juste valeur à saisir, la nouvelle valeur résiduelle et la durée résiduelle.', 'Méthode : prix de marché, expertise, coût de remplacement net d\'amortissement ou approche par le résultat (§31 et §32), avec le nom de l\'évaluateur et son indépendance (§104).', 'Comptabilisation : les amortissements cumulés sont éliminés contre la valeur brute (§34 b). Une hausse est portée en écart de réévaluation, sauf si elle reprend une baisse antérieurement passée en charge. Une baisse est imputée sur l\'écart existant du même bien, le solde en charge (§38 et §39).', 'L\'écart de réévaluation est viré directement aux résultats reportés à la sortie du bien, ou au fur et à mesure de son utilisation selon l\'option retenue (§40).']]
  ] },
  { id: 'demantelement', title: 'Démantèlement, subventions et immobilisations en cours', blocks: [
    ['p', 'Démantèlement et remise en état (§82 à §99) : l\'estimation actualisée de l\'obligation est incluse dans le coût et une provision est constituée (compte 158 par défaut). Chaque exercice, la désactualisation augmente la provision en charges financières. « Réviser le démantèlement » enregistre une nouvelle estimation : sous le modèle du coût, la variation est ajoutée au coût du bien ou en est déduite ; l\'excédent d\'une baisse sur la valeur comptable est constaté en produit (§96).'],
    ['p', 'Subventions d\'investissement : la subvention n\'est pas déduite du coût (§27). Sa quote-part est virée au résultat (compte 739) au rythme des amortissements ; le solde est viré à la sortie du bien.'],
    ['p', 'Immobilisations en cours : saisissez-les dans une catégorie « en cours » (non amortissable). À l\'achèvement, « Mettre en service » vire le bien dans sa catégorie définitive, fixe le mode et la durée et déclenche l\'amortissement. Le virement apparaît dans la colonne « Virements » du tableau de variation.']
  ] },
  { id: 'sorties', title: 'Sorties d\'immobilisations', blocks: [
    ['p', 'Un bien est décomptabilisé lors de sa sortie ou lorsqu\'aucun avantage économique futur n\'en est attendu (§75). Sur la fiche, « Constater une sortie » demande la nature (cession, mise au rebut, vol, perte, sinistre, échange, don, apport, remplacement de composant…), la date, le prix de cession, l\'éventuelle indemnité d\'assurance, le justificatif (facture de vente, PV de mise au rebut, déclaration de vol) et la référence de la pièce comptable de l\'écriture de sortie.'],
    ['ul', ['L\'application calcule la dotation complémentaire jusqu\'à la date de sortie, la valeur comptable (coût − amortissements − pertes de valeur) et le profit ou la perte égal au produit net de sortie moins la valeur comptable (§80).', 'L\'écriture de sortie est proposée : annulation des amortissements et des pertes de valeur, créance de cession, charge ou produit net (636 / 736), virement de l\'écart de réévaluation aux résultats reportés et du solde de subvention au résultat.', 'Le résultat fiscal et l\'ajustement à porter au tableau de passage sont calculés en parallèle.', 'Une sortie peut être annulée ; une suppression de fiche, elle, n\'est pas une sortie comptable.']]
  ] },
  { id: 'inventaire', title: 'Inventaire physique et étiquettes', blocks: [
    ['ol', ['Imprimez les étiquettes (« Étiquettes ») : planches A4 de 14, 24 ou 30 étiquettes avec code-barres Code 128, filtrées par emplacement ou catégorie.', 'Créez une campagne (« Inventaires physiques → Nouvelle campagne ») pour toute la société ou certains emplacements.', 'Dans l\'onglet Pointage, choisissez l\'emplacement compté et l\'état constaté, puis scannez les étiquettes : la douchette saisit le code et valide. Le pointage manuel reste possible dans la liste de contrôle.', 'Clôturez la campagne : l\'application liste les biens conformes, mal localisés, manquants, dégradés et non inscrits.', 'Appliquez les régularisations après validation : mise à jour des emplacements, report des états, sortie des biens manquants à la date d\'inventaire (avec la moins-value correspondante et la référence de la pièce comptable de l\'écriture).', 'Exportez le procès-verbal en PDF ou en Excel, avec les zones de signature.']],
    ['tip', 'Un bien en mauvais état, hors service ou temporairement inutilisé constitue souvent un indice de perte de valeur : il apparaît dans l\'onglet « Tests de dépréciation ».']
  ] },
  { id: 'rapports', title: 'Rapports et notes aux états financiers', blocks: [
    ['p', '« Rapports et notes » produit, pour l\'exercice choisi en haut de l\'écran, les documents suivants. Chacun s\'exporte en PDF (titres en Mozilla Headline) ou en Excel. Le « Dossier annuel complet » réunit tout dans un classeur Excel.'],
    ['table', { cols: ['Rapport', 'Contenu'], rows: [
      ['Tableau de variation', 'Par catégorie : VB début, entrées, réévaluations, sorties, virements, VB fin, amortissements et pertes de valeur, VNC (§100).'],
      ['Notes aux états financiers', 'Méthodes, durées et modèles par catégorie, note spécifique si la société amortit aux taux fiscaux, dotations et cumuls, en-cours, nantissements, engagements, changements d\'estimations, réévaluations, pertes de valeur et reprises, informations complémentaires (§100 à §107).'],
      ['Registre détaillé', 'Situation de chaque bien à la clôture ou à sa sortie.'],
      ['Passage comptable / fiscal', 'Plafonds, part déductible, réintégrations, déductions ultérieures, retraitements des pertes de valeur et des sorties.'],
      ['État des sorties', 'Résultats comptable et fiscal de chaque sortie.'],
      ['Écritures d\'inventaire', 'Dotations, pertes, reprises, réévaluations, démantèlement, subventions et sorties, équilibrées, avec la référence de pièce de chaque écriture.'],
      ['État des mouvements et pièces comptables', 'Tous les mouvements de l\'exercice avec leur justificatif et leur référence de pièce ; décompte des mouvements sans pièce.'],
      ['État par emplacement', 'Biens en service par emplacement.']] }],
    ['p', 'Les engagements contractuels d\'acquisition et les autres informations de l\'exercice se complètent directement sur l\'écran des notes.']
  ] },
  { id: 'fiscal', title: 'Passage comptable / fiscal', blocks: [
    ['p', 'La comptabilité suit la NC 05 ; la déduction fiscale suit l\'article 12 bis du Code de l\'IRPP et de l\'IS. Les amortissements comptabilisés sont déductibles dans la limite des annuités linéaires calculées aux taux maximum du décret n° 2008-492.'],
    ['ul', ['Durée comptable plus courte que la durée fiscale : l\'excédent est réintégré, puis déduit les exercices suivants dans la limite du plafond (note commune n° 22/2008). L\'application suit ce report bien par bien.', 'Coefficient d\'équipes : 1,5 pour deux équipes, 2 pour trois équipes, pour le matériel industriel (art. 2 du décret).', 'Biens de faible valeur (≤ 500 DT) : déductibles en totalité l\'année de mise en service.', 'Non déductibles : terrains, fonds de commerce, voitures de tourisme de plus de 9 CV (sauf objet principal de l\'exploitation), actifs d\'au moins 5 000 DT réglés en espèces, part « démantèlement » du coût.', 'Pertes de valeur, diminutions de réévaluation et désactualisation : réintégrées. Reprises : déduites.', 'Réévaluation libre : sans effet fiscal, le plafond reste calculé sur le coût historique.', 'Plafond dégressif : supprimé depuis la loi de finances pour 2008 ; l\'option n\'est à activer que si un texte spécial l\'autorise.']],
    ['tip', 'Les seuils, coefficients et taux sont paramétrables par l\'administrateur pour suivre les lois de finances. Les avantages fiscaux spécifiques (déductions supplémentaires, régimes d\'incitation) restent à traiter dans la déclaration.']
  ] },
  { id: 'parametrage', title: 'Paramétrage sans programmation', blocks: [
    ['p', 'L\'administrateur modifie l\'application depuis « Paramétrage », sans toucher au code :'],
    ['ul', ['Identité visuelle : nom de l\'application, accroche, message de connexion, pied de page des rapports, couleurs et logo.', 'Catégories modèles : copiées dans chaque nouvel environnement ; les clients existants s\'alignent avec « Mettre à jour depuis le référentiel CTB ».', 'Comptes : dotations, provisions, reprises, écart de réévaluation, résultats reportés, démantèlement, subventions, sorties.', 'Référentiel fiscal : seuil des biens de faible valeur, puissance des voitures de tourisme, seuil des règlements en espèces, coefficients d\'équipes, option de plafond dégressif.', 'Codification et calcul : séparateur, portée du compteur, prorata temporis par défaut.', 'Listes : natures de sortie et états des biens.', 'Champs personnalisés : rubriques supplémentaires sur la fiche (texte, nombre, date, liste).', 'Modules : inventaire, étiquettes, import Excel, traitement fiscal.']]
  ] },
  { id: 'sauvegarde', title: 'Sauvegarde et restauration', blocks: [
    ['p', '« Sauvegarde → Exporter » produit un fichier JSON contenant le paramétrage, les clients, leurs environnements, immobilisations et inventaires. Conservez-le en lieu sûr' + (SUPA ? ' : il contient toutes les données comptables des clients (aucun mot de passe).' : ' : il contient les empreintes des mots de passe.') + ' « Restaurer » recharge une sauvegarde en remplaçant les documents de même identifiant. Avant de supprimer un client, exportez toujours une sauvegarde.']
  ] },
  { id: 'glossaire', title: 'Glossaire', blocks: [
    ['table', { cols: ['Terme', 'Définition (NC 05 §07)'], rows: [
      ['Durée d\'utilité', 'Période pendant laquelle l\'entreprise s\'attend à utiliser l\'actif, ou nombre d\'unités de production attendues.'],
      ['Valeur résiduelle', 'Montant net estimé que l\'entreprise obtiendrait actuellement de la sortie de l\'actif s\'il avait déjà l\'âge et l\'état attendus en fin de durée d\'utilité.'],
      ['Montant amortissable', 'Coût, ou montant substitué, diminué de la valeur résiduelle.'],
      ['Valeur comptable (VNC)', 'Coût ou valeur réévaluée diminué du cumul des amortissements et des pertes de valeur.'],
      ['Juste valeur', 'Prix auquel un actif pourrait être échangé entre un acheteur et un vendeur normalement informés et consentants.'],
      ['Valeur récupérable', 'Montant que l\'entreprise compte obtenir de l\'usage futur de l\'actif, y compris sa valeur résiduelle de cession.'],
      ['Perte de valeur', 'Excédent de la valeur comptable d\'un actif sur sa valeur récupérable.'],
      ['Écart de réévaluation', 'Hausse de valeur constatée en capitaux propres lors d\'une réévaluation.']] }]
  ] },
  { id: 'faq', title: 'Questions fréquentes', blocks: [
    ['h', 'Une société amortit aux taux fiscaux : est-ce conforme ?'],
    ['p', 'Oui, si ces taux reflètent raisonnablement le rythme de consommation des avantages économiques. Choisissez le référentiel « Textes fiscaux » : l\'application produit une note spécifique précisant ce choix et, à titre d\'information, l\'effet des durées d\'utilité indicatives.'],
    ['h', 'Pourquoi une réintégration apparaît-elle alors que j\'applique la NC 05 ?'],
    ['p', 'Parce que la durée d\'utilité retenue est plus courte que la durée implicite du taux fiscal maximum. L\'excédent est réintégré puis déduit les exercices suivants : consultez l\'onglet « Plan fiscal » de la fiche.'],
    ['h', 'Comment corriger un événement mal saisi ?'],
    ['p', 'Supprimez-le dans la liste « Évaluation postérieure » de la fiche, puis saisissez-le à nouveau. Le plan est recalculé immédiatement.'],
    ['h', 'Le code d\'un bien change-t-il après un transfert ?'],
    ['p', 'Non. Le code reste celui de l\'étiquette ; seul l\'emplacement de rattachement est mis à jour et tracé dans l\'historique.']
  ] }
];

TITLES.manuel = { title: 'Manuel d\'utilisation' };
function manualBlocks(blocks) {
  return blocks.map((b) => {
    if (b[0] === 'p') return '<p>' + esc(b[1]) + '</p>';
    if (b[0] === 'h') return '<h4>' + esc(b[1]) + '</h4>';
    if (b[0] === 'tip') return '<div class="tip">' + esc(b[1]) + '</div>';
    if (b[0] === 'ul') return '<ul>' + b[1].map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    if (b[0] === 'ol') return '<ol>' + b[1].map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>';
    if (b[0] === 'table') return '<div class="tbl-wrap" style="margin-bottom:10px"><table class="tbl"><thead><tr>' + b[1].cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + b[1].rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    return '';
  }).join('');
}
function manualBody() {
  return '<div class="page-head"><div class="manual-hero"><div class="eyebrow">' + esc(S.cfg.appName) + ' · NC 05</div><h2>Manuel d\'utilisation</h2><p>Mode d\'emploi détaillé de l\'application, de la création d\'un client jusqu\'aux notes aux états financiers.</p></div><div class="actions"><button class="btn" data-act="man-pdf">' + icon('dl') + 'Télécharger le manuel (PDF)</button></div></div>' +
    '<div class="manual"><nav class="manual-toc" aria-label="Sommaire du manuel"><b>Sommaire</b>' + MANUAL.map((s, i) => '<a href="#man-' + s.id + '" data-act="man-go" data-id="' + s.id + '">' + (i + 1) + '. ' + esc(s.title) + '</a>').join('') + '</nav>' +
    '<div class="manual-body">' + MANUAL.map((s, i) => '<section class="panel" id="man-' + s.id + '"><h3>' + (i + 1) + '. ' + esc(s.title) + '</h3>' + manualBlocks(s.blocks) + '</section>').join('') + '</div></div>';
}
VIEWS.manuel = function () { return manualBody(); };
ACT['man-go'] = (el) => {
  const t = document.getElementById('man-' + el.dataset.id);
  if (t) t.scrollIntoView({ behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
};
ACT['man-pdf'] = () => {
  const R = { key: 'manuel', doc: true, orient: 'p', title: 'Manuel d\'utilisation – ' + S.cfg.appName, subtitle: 'Gestion des immobilisations selon la NC 05 – édition du ' + fdate(EN.today()), sections: [], notes: [] };
  MANUAL.forEach((s, i) => {
    let cur = { title: (i + 1) + '. ' + s.title, paras: [] };
    R.sections.push(cur);
    s.blocks.forEach((b) => {
      if (b[0] === 'p' || b[0] === 'tip') cur.paras.push(b[1]);
      else if (b[0] === 'h') { cur = { title: b[1], paras: [] }; R.sections.push(cur); }
      else if (b[0] === 'ul') b[1].forEach((x) => cur.paras.push('• ' + x));
      else if (b[0] === 'ol') b[1].forEach((x, k) => cur.paras.push((k + 1) + '. ' + x));
      else if (b[0] === 'table') { cur.table = { cols: b[1].cols.map((c) => ({ h: c })), rows: b[1].rows }; cur = { title: '', paras: [] }; R.sections.push(cur); }
    });
  });
  R.sections = R.sections.filter((x) => x.title || x.paras.length || x.table);
  pdfExport(R);
};

/* ==========================================================================
   Version sécurisée (GitHub + Supabase Auth)
   - connexion par e-mail et mot de passe, uniquement après validation de
     l'adresse (lien d'invitation) ;
   - double authentification (TOTP) : obligatoire pour l'administrateur,
     au choix pour les clients ;
   - données dans PostgreSQL, protégées par les règles d'accès (RLS) ;
   - fermeture de session après inactivité, journal des connexions.
   ========================================================================== */
const SB_CFG = window.IMMO_CONFIG || {};
let sb = null;
const SB = { who: null, lastActive: Date.now(), timer: null, access: {}, logs: null };

function sbClient() {
  if (sb) return sb;
  if (!window.supabase || !SB_CFG.supabaseUrl || !SB_CFG.supabaseAnonKey || /VOTRE|XXXX/.test(SB_CFG.supabaseUrl + SB_CFG.supabaseAnonKey)) return null;
  sb = window.supabase.createClient(SB_CFG.supabaseUrl, SB_CFG.supabaseAnonKey, {
    auth: { storage: window.sessionStorage, storageKey: 'immo.auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
  });
  return sb;
}
function siteUrl() { return SB_CFG.siteUrl || (location.origin + location.pathname); }
function idleMinutes() { const n = Number(SB_CFG.inactivityMinutes); return n >= 5 && n <= 240 ? n : 30; }
function sbErr(e) {
  const c = String((e && (e.code || e.status)) || '');
  const m = String((e && e.message) || '');
  if (c === '42501' || /row-level security|permission denied/i.test(m)) return { code: 'invalid_argument', message: m };
  if (c === 'PGRST301' || c === '401' || /JWT|token/i.test(m)) return { code: 'revoked', message: m };
  return { message: m || 'erreur inconnue' };
}
function logEvt(ev, detail, email) {
  if (!sb) return Promise.resolve();
  return sb.rpc('log_auth_event', { p_event: ev, p_email: email || null, p_detail: detail || null }).then(() => {}, () => {});
}
function strongPwdSb(p) { return typeof p === 'string' && p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p); }
const PWD_RULE = '10 caractères minimum, avec au moins une majuscule, une minuscule et un chiffre.';

/* ---------- Stockage : table public.docs ---------- */
Object.assign(Store, {
  mode: 'db', runtime: false,
  init() { if (!this.ready) this.ready = Promise.resolve(); return this.ready; },
  async get(path) {
    const r = await sb.from('docs').select('data').eq('path', path).maybeSingle();
    if (r.error) throw sbErr(r.error);
    return r.data ? clone(r.data.data) : null;
  },
  async list(col) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await sb.from('docs').select('path,data').eq('parent', col).order('path').range(from, from + 999);
      if (r.error) throw sbErr(r.error);
      for (const row of r.data) out.push(Object.assign(clone(row.data), { id: row.path.slice(col.length + 1) }));
      if (r.data.length < 1000) break;
    }
    return out;
  },
  async _write(path, data) {
    const body = clone(data); delete body.id;
    if (/^tenants\/[^/]+$/.test(path)) delete body.auth;
    const r = await sb.from('docs').upsert({ path: path, data: body }, { onConflict: 'path' });
    if (r.error) throw sbErr(r.error);
  },
  async _del(path) {
    const r = await sb.from('docs').delete().eq('path', path);
    if (r.error) throw sbErr(r.error);
  }
});
storeError = function (e, what) {
  const c = e && e.code;
  let m = 'Enregistrement impossible' + (what ? ' (' + what + ')' : '') + '.';
  if (c === 'invalid_argument') m = 'Action refusée par la base de données : votre accès ne permet pas cette opération (accès désactivé, session expirée ou double authentification requise). Reconnectez-vous ou contactez le cabinet CTB.';
  else if (c === 'revoked') m = 'Votre session a expiré. Reconnectez-vous.';
  else if (e && e.message) m += ' ' + e.message;
  toast(m, 'bad');
  console.error(e);
};
storeBadge = function () { return '<span class="store-badge db" title="Données hébergées dans Supabase, protégées par des règles d\'accès appliquées par la base elle-même.">Base sécurisée</span>'; };
storeWarn = function () { return ''; };
saveSession = function () {};
readSession = function () { return null; };
loadAdminAuth = async function () { S.adminAuth = { email: (SB.who && SB.who.email) || '' }; };

/* ---------- Écrans d'accès ---------- */
function pitchHtml() {
  return '<div class="login-pitch">' + brandHtml(true) +
    '<div class="eyebrow" style="margin-top:34px">' + esc(S.cfg.tagline) + '</div>' +
    '<h1>' + esc(S.cfg.appName) + '</h1>' +
    '<p>Registre des immobilisations tenu selon la norme comptable NC 05 : coût d\'entrée, composants, amortissement sur la durée d\'utilité, révisions d\'estimations, tests de dépréciation et réévaluations. La fiscalité tunisienne est traitée à part, dans le passage comptable / fiscal.</p>' +
    '</div>';
}
function cardHtml(id, title, sub, inner) {
  return '<div class="glow" aria-hidden="true"></div><div class="login">' + pitchHtml() +
    '<form class="login-card" id="' + id + '" autocomplete="on" novalidate><h2>' + esc(title) + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '<div class="form">' + inner + '</div></form></div>';
}
loginView = function () {
  if (!sbClient()) {
    return cardHtml('cfg-form', 'Configuration requise', 'Le fichier <b>config.js</b> ne contient pas encore l\'adresse et la clé publique du projet Supabase. Suivez le guide d\'installation (README).', '');
  }
  return cardHtml('login-form', 'Connexion', esc(S.cfg.loginMessage),
    '<label class="field"><span>Adresse e-mail</span><input id="lg-login" type="email" autocomplete="username" required' + (SB.loginEmail ? '' : ' autofocus') + ' maxlength="190" value="' + esc(SB.loginEmail || '') + '"></label>' +
    '<label class="field"><span>Mot de passe</span><input id="lg-pwd" type="password" autocomplete="current-password" required' + (SB.loginEmail ? ' autofocus' : '') + ' maxlength="200"></label>' +
    '<button class="btn" type="submit" id="lg-btn">Se connecter</button>' +
    '<p class="muted" style="margin:0;font-size:12px">Connexion en deux étapes : après le mot de passe, un code de validation est envoyé à votre adresse e-mail.</p>' +
    '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--ink-2)"><button type="button" class="link" data-act="sb-forgot">Mot de passe oublié ?</button><span>Accès sur invitation du cabinet uniquement.</span></div>');
};
function gateView() {
  const g = S.gate;
  if (g.kind === 'setpwd') {
    return cardHtml('gate-form', g.type === 'invite' ? 'Bienvenue dans ' + S.cfg.appName : 'Nouveau mot de passe',
      (g.type === 'invite' ? 'Votre adresse e-mail est validée. ' : '') + 'Choisissez votre mot de passe personnel : ' + esc(PWD_RULE),
      '<input type="email" autocomplete="username" value="' + esc((SB.who && SB.who.email) || g.email || '') + '" hidden>' +
      '<label class="field"><span>Mot de passe</span><input id="gp-1" type="password" autocomplete="new-password" required autofocus maxlength="200"></label>' +
      '<label class="field"><span>Confirmation</span><input id="gp-2" type="password" autocomplete="new-password" required maxlength="200"></label>' +
      '<button class="btn" type="submit" id="gate-btn">Enregistrer et continuer</button>' +
      '<button type="button" class="link" data-act="logout" style="font-size:12px">Annuler et se déconnecter</button>');
  }
  if (g.kind === 'emailcode') {
    return cardHtml('gate-form', 'Validation par e-mail', 'Mot de passe correct. Un code de validation à 6 chiffres vient d\'être envoyé à <b>' + esc(g.email) + '</b>. Saisissez-le pour terminer la connexion (valable 10 minutes).',
      '<label class="field"><span>Code reçu par e-mail</span><input id="ge-code" class="mono" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus style="font-size:22px;letter-spacing:.3em"></label>' +
      '<button class="btn" type="submit" id="gate-btn">Valider</button>' +
      '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px"><button type="button" class="link" data-act="sb-code-resend">Je n\'ai rien reçu : renvoyer le code</button><button type="button" class="link" data-act="sb-home">Annuler</button></div>' +
      '<p class="muted" style="margin:0;font-size:12px">Pensez à vérifier le dossier des courriers indésirables. Si vous recevez un code sans avoir tenté de vous connecter, prévenez le cabinet CTB.</p>');
  }
  if (g.kind === 'mfa') {
    return cardHtml('gate-form', 'Double authentification', 'Saisissez le code à 6 chiffres affiché par votre application d\'authentification (Google Authenticator, Microsoft Authenticator…).',
      '<label class="field"><span>Code</span><input id="gm-code" class="mono" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus style="font-size:22px;letter-spacing:.3em"></label>' +
      '<button class="btn" type="submit" id="gate-btn">Vérifier</button>' +
      '<button type="button" class="link" data-act="logout" style="font-size:12px">Annuler et se déconnecter</button>');
  }
  if (g.kind === 'enroll') {
    return cardHtml('gate-form', 'Activez la double authentification',
      (g.forced ? 'Le cabinet l\'a rendue <b>obligatoire pour le compte administrateur</b> : sans elle, la base de données refuse l\'accès aux données. ' : '') +
      '1. Installez une application d\'authentification sur votre téléphone. 2. Scannez le code ci-dessous. 3. Saisissez le code à 6 chiffres affiché.',
      '<div id="gq-box" style="display:grid;place-items:center;min-height:200px;background:#fff;border-radius:10px;padding:10px"><div class="spin"></div></div>' +
      '<div class="muted" style="font-size:12px">Saisie manuelle de la clé : <span id="gq-secret" class="mono" style="word-break:break-all"></span></div>' +
      '<label class="field"><span>Code à 6 chiffres</span><input id="gm-code" class="mono" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required style="font-size:22px;letter-spacing:.3em"></label>' +
      '<button class="btn" type="submit" id="gate-btn">Activer</button>' +
      '<button type="button" class="link" data-act="logout" style="font-size:12px">Annuler et se déconnecter</button>');
  }
  return cardHtml('gate-form', 'Lien non valable', esc(g.msg || 'Ce lien est invalide ou a expiré.'),
    '<p class="muted" style="margin:0">Un lien d\'invitation ou de réinitialisation ne sert qu\'une fois et expire après un délai limité. Demandez au cabinet CTB de vous renvoyer un lien (invitation ou réinitialisation du mot de passe).</p>' +
    '<button type="button" class="btn" data-act="sb-home">Retour à la connexion</button>');
}
function bindGate() {
  const f = $('#gate-form'); if (!f) return;
  const g = S.gate;
  if (g.kind === 'enroll') startEnroll();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#gate-btn'); const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Vérification…'; }
    try {
      if (g.kind === 'setpwd') await submitNewPassword();
      else if (g.kind === 'emailcode') await submitEmailCode();
      else if (g.kind === 'mfa') await submitMfa();
      else if (g.kind === 'enroll') await submitEnroll();
    } catch (err) { console.error(err); toast('Opération impossible : ' + ((err && err.message) || 'erreur inconnue'), 'bad'); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
  });
}
async function submitNewPassword() {
  const p1 = $('#gp-1').value, p2 = $('#gp-2').value;
  if (!strongPwdSb(p1)) { toast('Mot de passe trop faible : ' + PWD_RULE, 'bad'); return; }
  if (p1 !== p2) { toast('La confirmation ne correspond pas.', 'bad'); return; }
  const r = await sb.auth.updateUser({ password: p1 });
  if (r.error) { toast('Mot de passe refusé : ' + r.error.message, 'bad'); return; }
  await logEvt(S.gate.type === 'invite' ? 'premier_mot_de_passe' : 'mot_de_passe_reinitialise');
  const email = (SB.who && SB.who.email) || '';
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* rien */ }
  localReset(); SB.loginEmail = email; render();
  toast('Mot de passe enregistré. Connectez-vous maintenant avec ce mot de passe : un code de validation vous sera ensuite envoyé par e-mail.', 'ok');
}
async function sendEmailCode(email) {
  const r = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
  if (r.error) {
    if (r.error.status === 429) toast('Un code vient déjà d\'être envoyé : patientez une minute avant d\'en demander un autre.', 'bad');
    else toast('Envoi du code impossible : ' + r.error.message, 'bad');
    return false;
  }
  return true;
}
async function submitEmailCode() {
  const code = ($('#ge-code').value || '').replace(/\D/g, '');
  if (code.length !== 6) { toast('Saisissez les 6 chiffres du code reçu.', 'bad'); return; }
  const email = S.gate.email;
  const r = await sb.auth.verifyOtp({ email: email, token: code, type: 'email' });
  if (r.error) {
    await logEvt('echec_code_email', r.error.code || r.error.message, email);
    toast('Code incorrect ou expiré. Demandez un nouveau code si besoin.', 'bad'); $('#ge-code').value = ''; return;
  }
  await logEvt('code_email_ok');
  S.gate = null;
  await sbAfterAuth();
}
ACT['sb-code-resend'] = async () => {
  if (!S.gate || S.gate.kind !== 'emailcode') return;
  if (Date.now() - (S.gate.sentAt || 0) < 60000) { toast('Patientez une minute avant de demander un nouveau code.', 'bad'); return; }
  if (await sendEmailCode(S.gate.email)) { S.gate.sentAt = Date.now(); toast('Nouveau code envoyé à ' + S.gate.email + '.', 'ok'); }
};
async function verifiedTotp() {
  const r = await sb.auth.mfa.listFactors();
  if (r.error) throw r.error;
  return (r.data.totp || []).find((f) => f.status === 'verified');
}
async function submitMfa() {
  const code = ($('#gm-code').value || '').replace(/\D/g, '');
  if (code.length !== 6) { toast('Saisissez les 6 chiffres.', 'bad'); return; }
  const f = await verifiedTotp();
  if (!f) { S.gate = null; await sbAfterAuth(); return; }
  const r = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: code });
  if (r.error) { await logEvt('echec_double_auth'); toast('Code incorrect ou expiré.', 'bad'); $('#gm-code').value = ''; return; }
  await logEvt('double_auth_ok');
  const next = S.gate && S.gate.then;
  S.gate = next || null;
  if (next) render(); else await sbAfterAuth();
}
async function startEnroll() {
  try {
    const lf = await sb.auth.mfa.listFactors();
    for (const f of ((lf.data && lf.data.all) || []).filter((x) => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
    const r = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'immo ' + new Date().toISOString().slice(0, 16) });
    if (r.error) throw r.error;
    S.gate.factorId = r.data.id;
    const box = $('#gq-box');
    if (box) { box.innerHTML = ''; const img = new Image(); img.alt = 'QR code de la double authentification'; img.width = 200; img.height = 200; img.src = r.data.totp.qr_code; box.appendChild(img); }
    const s = $('#gq-secret'); if (s) s.textContent = r.data.totp.secret;
    const c = $('#gm-code'); if (c) c.focus();
  } catch (e) { console.error(e); toast('Activation impossible : ' + ((e && e.message) || 'erreur'), 'bad'); }
}
async function submitEnroll() {
  const code = ($('#gm-code').value || '').replace(/\D/g, '');
  if (!S.gate.factorId) { toast('Le QR code n\'est pas encore prêt.', 'bad'); return; }
  if (code.length !== 6) { toast('Saisissez les 6 chiffres.', 'bad'); return; }
  const r = await sb.auth.mfa.challengeAndVerify({ factorId: S.gate.factorId, code: code });
  if (r.error) { toast('Code incorrect : vérifiez l\'heure du téléphone et réessayez.', 'bad'); return; }
  await logEvt('double_auth_activee');
  toast('Double authentification activée.', 'ok');
  const back = S.gate.back;
  S.gate = null;
  if (back) { await sbWhoami(); render(); } else await sbAfterAuth();
}

/* ---------- Enchaînement après authentification ---------- */
async function sbWhoami() {
  const r = await sb.rpc('whoami');
  if (r.error) throw r.error;
  SB.who = r.data; return r.data;
}
async function sbAfterAuth() {
  startIdle();
  const who = await sbWhoami();
  if (!who || !who.email_ok) { await sbSignOutLocal(); toast('Adresse e-mail non validée : ouvrez d\'abord le lien d\'invitation reçu.', 'bad'); return; }
  if (!who.role) { await logEvt('refus_sans_profil'); await sbSignOutLocal(); toast('Ce compte n\'est rattaché à aucun accès. Contactez le cabinet CTB.', 'bad'); return; }
  if (!who.login_ok) { await sbSignOutLocal(); toast('Connexion incomplète : saisissez votre mot de passe puis le code reçu par e-mail.', 'bad'); return; }
  const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data && aal.data.nextLevel === 'aal2' && aal.data.currentLevel !== 'aal2') { S.gate = { kind: 'mfa' }; render(); return; }
  if (who.role === 'admin' && who.totp_required && !who.mfa) { S.gate = { kind: 'enroll', forced: true }; render(); return; }
  if (who.role === 'client' && !who.active) { await logEvt('refus_acces_desactive'); await sbSignOutLocal(); toast('Cet accès est désactivé. Contactez le cabinet CTB.', 'bad'); return; }
  S.gate = null;
  showLoading('Chargement…');
  try { const c = await Store.get(P.config); S.cfg = mergeConfig(c); } catch (e) { console.warn(e); }
  S.adminAuth = { email: who.email };
  if (who.role === 'admin') {
    S.session = { role: 'admin', name: 'Administrateur' };
    await enterAdmin();
    refreshAccess();
  } else {
    await loadRegistry();
    const c = S.registry.find((x) => x.id === who.tenant_id);
    S.session = { role: 'client', clientId: who.tenant_id, name: c ? c.raison : who.email };
    await enterTenant(who.tenant_id);
  }
  startIdle();
}
function localReset() {
  S.session = null; S.gate = null; S.tenant = null; S.tenantId = null; S.assets = []; S.inventories = []; S.registry = []; S.tenants = {}; S.ui = {}; S.view = 'dash';
  SB.who = null; SB.access = {}; SB.logs = null;
  closeModal();
}
async function sbSignOutLocal() { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* rien */ } localReset(); render(); }

doLogin = async function (login, pwd) {
  if (Date.now() < S.lockUntil) { toast('Trop de tentatives. Réessayez dans quelques secondes.', 'bad'); return; }
  const email = String(login || '').trim().toLowerCase();
  if (!email || !pwd) { toast('Saisissez votre adresse e-mail et votre mot de passe.', 'bad'); return; }
  const r = await sb.auth.signInWithPassword({ email: email, password: pwd });
  if (r.error) {
    await logEvt('echec_connexion', r.error.code || r.error.message, email);
    if (r.error.code === 'email_not_confirmed' || /not confirmed/i.test(r.error.message)) { toast('Adresse e-mail non validée : ouvrez d\'abord le lien d\'invitation reçu.', 'bad'); return; }
    if (r.error.status === 429) { toast('Trop de tentatives : patientez avant de réessayer.', 'bad'); return; }
    return failLogin();
  }
  S.failures = 0;
  const m = await sb.rpc('mark_password_step');
  await logEvt('mot_de_passe_ok');
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* rien */ }
  if (m.error || m.data !== true) { toast('Connexion impossible pour le moment. Réessayez.', 'bad'); return; }
  if (!(await sendEmailCode(email))) return;
  SB.loginEmail = email;
  S.gate = { kind: 'emailcode', email: email, sentAt: Date.now() };
  startIdle(); render();
};
logout = async function (silent) {
  if (sb && (S.session || (S.gate && S.gate.kind !== 'emailcode'))) { await logEvt('deconnexion'); try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* rien */ } }
  localReset(); render();
};
ACT.logout = () => logout();
ACT['sb-home'] = () => { S.gate = null; render(); };
ACT['sb-forgot'] = () => {
  openModal({
    title: 'Mot de passe oublié', size: 'narrow',
    body: '<div class="form"><p style="margin:0">Pour votre sécurité, les mots de passe sont gérés par le <b>Cabinet Tahar Bakir</b>. Contactez le cabinet : il vous enverra, à votre adresse e-mail enregistrée, un lien personnel pour choisir un nouveau mot de passe.</p><p class="muted" style="margin:0;font-size:12.5px">Personne, pas même le cabinet, ne peut lire votre mot de passe : il est conservé sous forme chiffrée irréversible.</p></div>'
  });
};

const renderBase = render;
render = function () {
  if (S.gate) { applyTheme(); $('#app').innerHTML = gateView(); bindGate(); return; }
  renderBase();
};

/* ---------- Inactivité ---------- */
function startIdle() {
  SB.lastActive = Date.now();
  if (SB.timer) return;
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((ev) => document.addEventListener(ev, () => { SB.lastActive = Date.now(); }, { passive: true, capture: true }));
  SB.timer = setInterval(async () => {
    if (!(S.session || S.gate)) return;
    if (Date.now() - SB.lastActive > idleMinutes() * 60000) {
      await logEvt('deconnexion_inactivite');
      await logout();
      toast('Session fermée après ' + idleMinutes() + ' minutes d\'inactivité.', '');
    }
  }, 15000);
}

/* ---------- Sécurité du compte (administrateur et client) ---------- */
async function changePassword(p1) {
  let r = await sb.auth.updateUser({ password: p1 });
  if (r.error && (r.error.code === 'reauthentication_needed' || /reauthenticat/i.test(r.error.message))) {
    const s = await sb.auth.reauthenticate();
    if (s.error) return s;
    const nonce = await confirmBox('Confirmation par e-mail', '<p>Pour protéger votre compte, un code de confirmation vient d\'être envoyé à votre adresse e-mail.</p><label class="field"><span>Code reçu</span><input id="cfm-input" class="mono" inputmode="numeric" autocomplete="one-time-code"></label>', 'Confirmer');
    if (!nonce) return { error: { message: 'opération annulée' } };
    r = await sb.auth.updateUser({ password: p1, nonce: String(nonce).trim() });
  }
  return r;
}
function securityPanels(isAdmin) {
  const w = SB.who || {};
  const mfaTxt = w.mfa ? '<span class="pill ok">Activée</span>' : '<span class="pill grey">Non activée (facultative)</span>';
  return '<div class="grid-2"><div class="panel"><h3>' + (isAdmin ? 'Compte administrateur' : 'Mon accès') + '</h3><dl class="dl"><div><dt>Adresse e-mail (identifiant)</dt><dd>' + esc(w.email || '') + '</dd></div>' +
    (isAdmin ? '' : '<div><dt>Société</dt><dd>' + esc(S.tenant ? S.tenant.raison : '') + '</dd></div><div><dt>Code société</dt><dd class="mono">' + esc(S.tenant ? S.tenant.codeSociete : '') + '</dd></div>') +
    '<div><dt>Code par e-mail à chaque connexion</dt><dd><span class="pill ok">Actif</span></dd></div><div><dt>Application d\'authentification</dt><dd>' + mfaTxt + '</dd></div></dl>' +
    '<form class="form" id="pw-form" style="margin-top:16px"><input type="email" autocomplete="username" value="' + esc(w.email || '') + '" hidden><label class="field"><span>Nouveau mot de passe</span><input id="pw-new" type="password" autocomplete="new-password" required maxlength="200"><small>' + esc(PWD_RULE) + '</small></label><label class="field"><span>Confirmation</span><input id="pw-new2" type="password" autocomplete="new-password" required maxlength="200"></label><div class="actions"><button class="btn" type="submit">Changer le mot de passe</button></div></form></div>' +
    '<div class="panel"><h3>Double authentification et sessions</h3><p class="muted" style="margin-top:0">' +
    'Chaque connexion exige déjà le mot de passe <b>et</b> un code reçu par e-mail. Vous pouvez ajouter une troisième protection : un code généré par une application de votre téléphone (Google ou Microsoft Authenticator). Une fois activée, la base de données refuse tout accès sans ce code.' + (isAdmin ? ' Pour changer de téléphone, ajoutez le nouvel appareil puis retirez l\'ancien.' : '') + '</p>' +
    '<div class="actions" style="justify-content:flex-start;flex-wrap:wrap">' +
    (w.mfa && isAdmin ? '<button class="btn ghost" data-act="sb-mfa-add">Ajouter un appareil</button>' : '') +
    (!w.mfa ? '<button class="btn" data-act="sb-mfa-add">Activer la double authentification</button>' : '') +
    (w.mfa ? '<button class="btn ghost" data-act="sb-mfa-list">' + (isAdmin && w.totp_required ? 'Appareils enregistrés' : 'Appareils / désactiver') + '</button>' : '') + '</div>' +
    '<h3 style="margin-top:22px">Sessions</h3><p class="muted" style="margin-top:0">La session se ferme à la fermeture de l\'onglet et après ' + idleMinutes() + ' minutes d\'inactivité. En cas de doute (poste partagé, téléphone perdu), fermez toutes les sessions ouvertes sur tous les appareils.</p>' +
    '<button class="btn danger" data-act="sb-global-out">' + icon('exit') + 'Fermer toutes mes sessions</button></div></div>';
}
function bindPwForm() {
  const f = $('#pw-form'); if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n1 = $('#pw-new').value, n2 = $('#pw-new2').value;
    if (!strongPwdSb(n1)) { toast('Mot de passe trop faible : ' + PWD_RULE, 'bad'); return; }
    if (n1 !== n2) { toast('La confirmation ne correspond pas.', 'bad'); return; }
    const r = await changePassword(n1);
    if (r.error) { toast('Mot de passe non modifié : ' + r.error.message, 'bad'); return; }
    await logEvt('mot_de_passe_modifie');
    toast('Mot de passe modifié.', 'ok'); f.reset();
  });
}
ACT['sb-mfa-add'] = () => { S.gate = { kind: 'enroll', forced: false, back: true }; render(); };
ACT['sb-mfa-list'] = async () => {
  const r = await sb.auth.mfa.listFactors();
  if (r.error) { toast(r.error.message, 'bad'); return; }
  const list = (r.data.totp || []).filter((f) => f.status === 'verified');
  const isAdmin = SB.who && SB.who.role === 'admin' && SB.who.totp_required;
  openModal({
    title: 'Appareils de double authentification', size: 'narrow',
    body: '<div class="form">' + (isAdmin ? '<p class="muted" style="margin:0">L\'administrateur doit conserver au moins un appareil.</p>' : '') +
      list.map((f) => '<div class="fs" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>' + esc(f.friendly_name || 'Appareil') + '<br><small class="muted">ajouté le ' + esc(fdate(String(f.created_at).slice(0, 10))) + '</small></span>' +
        (isAdmin && list.length < 2 ? '' : '<button class="btn danger sm" data-mfa-del="' + esc(f.id) + '">Retirer</button>') + '</div>').join('') + '</div>',
    mount: (m) => m.querySelectorAll('[data-mfa-del]').forEach((b) => b.addEventListener('click', async () => {
      const u = await sb.auth.mfa.unenroll({ factorId: b.dataset.mfaDel });
      if (u.error) { toast('Retrait impossible : ' + u.error.message, 'bad'); return; }
      await logEvt('double_auth_retiree');
      closeModal(); toast('Appareil retiré.', 'ok');
      await sb.auth.refreshSession(); await sbWhoami(); render();
    }))
  });
};
ACT['sb-global-out'] = async () => {
  const ok = await confirmBox('Fermer toutes les sessions', '<p>Toutes vos sessions ouvertes, sur tous les appareils, seront fermées, y compris celle-ci.</p>', 'Fermer les sessions', true);
  if (!ok) return;
  await logEvt('deconnexion_globale');
  try { await sb.auth.signOut({ scope: 'global' }); } catch (e) { /* rien */ }
  localReset(); render(); toast('Toutes les sessions ont été fermées.', 'ok');
};

VIEWS.compte = function () { return securityPanels(false); };
VIEWS.compte.after = function () { bindPwForm(); };

VIEWS['adm-secu'] = function () {
  const L = SB.logs;
  const tbl = (rows, cols) => !rows ? '<div class="empty"><div class="spin"></div></div>' : !rows.length ? '<div class="empty"><b>Aucun événement.</b></div>' :
    '<div class="tbl-wrap" style="max-height:420px;overflow:auto"><table class="tbl"><thead><tr>' + cols.map((c) => '<th>' + c[0] + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + cols.map((c) => '<td' + (c[2] ? ' class="' + c[2] + '"' : '') + '>' + esc(c[1](r)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  const when = (r) => new Date(r.at).toLocaleString('fr-FR');
  return securityPanels(true) +
    '<div class="panel"><div class="panel-head"><h3>Règles d\'accès appliquées par la base de données</h3></div><ul style="margin:0;padding-left:18px;display:grid;gap:8px">' +
    '<li>Sans connexion, aucune donnée n\'est lisible. Les inscriptions libres sont fermées : seules les adresses invitées par le cabinet peuvent se connecter.</li>' +
    '<li>Aucun accès tant que l\'adresse e-mail n\'est pas validée par le lien d\'invitation.</li>' +
    '<li>Chaque connexion exige le mot de passe, puis un code à 6 chiffres envoyé par e-mail. La base de données vérifie elle-même ces deux étapes : un mot de passe seul, ou un code seul, ne donne accès à rien.</li>' +
    '<li>Les mots de passe ne sont lisibles par personne (empreintes bcrypt). Seul l\'administrateur peut déclencher l\'envoi d\'un lien de réinitialisation à un client.</li>' +
    '<li>Seul l\'administrateur voit la liste des clients, crée, modifie, désactive ou supprime un environnement et modifie le paramétrage.</li>' +
    '<li>Chaque client ne lit et ne modifie que les données de sa société ; un client désactivé perd l\'accès immédiatement.</li>' +
    '</ul></div>' +
    '<div class="panel"><div class="panel-head"><h3>Journal des connexions</h3><button class="btn ghost sm" data-act="sb-logs">' + icon('refresh') + 'Actualiser</button></div>' +
    tbl(L && L.auth, [['Date', when], ['Utilisateur', (r) => r.email || '—'], ['Événement', (r) => EVT[r.event] || r.event], ['Détail', (r) => r.detail || ''], ['Navigateur', (r) => (r.user_agent || '').slice(0, 60)]]) + '</div>' +
    '<div class="panel"><div class="panel-head"><h3>Journal des modifications</h3></div>' +
    tbl(L && L.audit, [['Date', when], ['Utilisateur', (r) => r.email || 'système'], ['Action', (r) => r.action], ['Document', (r) => r.path || ''], ['Détail', (r) => r.detail || '']]) + '</div>';
};
const EVT = { mot_de_passe_ok: 'Mot de passe correct (code e-mail envoyé)', code_email_ok: 'Connexion validée par le code e-mail', echec_code_email: 'Code e-mail erroné ou expiré', connexion: 'Connexion', deconnexion: 'Déconnexion', deconnexion_inactivite: 'Déconnexion (inactivité)', deconnexion_globale: 'Fermeture de toutes les sessions', echec_connexion: 'Échec de connexion', echec_double_auth: 'Code de double authentification erroné', double_auth_ok: 'Double authentification réussie', double_auth_activee: 'Double authentification activée', double_auth_retiree: 'Appareil de double authentification retiré', premier_mot_de_passe: 'Invitation acceptée, mot de passe choisi', mot_de_passe_reinitialise: 'Mot de passe réinitialisé par e-mail', mot_de_passe_modifie: 'Mot de passe modifié', refus_acces_desactive: 'Connexion refusée (accès désactivé)', refus_sans_profil: 'Connexion refusée (compte non rattaché)' };
VIEWS['adm-secu'].after = function () { bindPwForm(); if (!SB.logs) loadLogs(); };
async function loadLogs() {
  const [a, b] = await Promise.all([
    sb.from('auth_log').select('*').order('at', { ascending: false }).limit(300),
    sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300)
  ]);
  SB.logs = { auth: a.data || [], audit: b.data || [] };
  if (a.error || b.error) toast('Journaux illisibles : ' + ((a.error || b.error).message), 'bad');
  if (S.view === 'adm-secu' && !S.gate) render();
}
ACT['sb-logs'] = () => { SB.logs = null; render(); loadLogs(); };

/* ---------- Clients : invitations et accès ---------- */
async function refreshAccess() {
  SB.accessAt = Date.now();
  const r = await sb.rpc('admin_access_list');
  if (r.error) { console.warn(r.error); return; }
  const m = {}; (r.data || []).forEach((x) => { m[x.tenant_id] = x; });
  SB.access = m;
  if ((S.view === 'adm-clients' || S.view === 'adm-dash') && !S.tenant && !S.gate) render();
}
async function callInvite(action, tenantId, email) {
  const r = await sb.functions.invoke('invite-client', { body: { action: action, tenantId: tenantId, email: email || '' } });
  if (r.error) {
    let msg = r.error.message;
    try { const j = await r.error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* rien */ }
    return { ok: false, msg: msg };
  }
  return { ok: true };
}
async function inviteClient(c, quiet) {
  if (!quiet) toast('Envoi de l\'invitation à ' + c.login + '…');
  const r = await callInvite('invite', c.id, c.login);
  if (!r.ok) { toast('Invitation non envoyée : ' + r.msg, 'bad'); return false; }
  toast('Invitation envoyée à ' + c.login + '. Le client doit ouvrir le lien reçu pour valider son adresse et choisir son mot de passe.', 'ok');
  refreshAccess();
  return true;
}
function accessCell(c) {
  if (c.actif === false) return '<span class="pill bad">Désactivé</span>';
  if (c.demo) return '<span class="pill">Démo – sans accès</span>';
  const a = SB.access[c.id];
  if (!a || String(a.email).toLowerCase() !== String(c.login).toLowerCase()) return '<span class="pill warn">À inviter</span>';
  if (a.confirmed_at) return '<span class="pill ok">Actif</span><div class="muted" style="font-size:11px">adresse validée le ' + esc(fdate(String(a.confirmed_at).slice(0, 10))) + (a.mfa ? ' · 2FA' : '') + '</div>';
  return '<span class="pill">Invitation envoyée</span><div class="muted" style="font-size:11px">le ' + esc(fdate(String(a.invited_at || '').slice(0, 10))) + ' · en attente de validation</div>';
}
clientsTable = function (compact) {
  if (!S.registry.length) return '<div class="empty"><b>Aucun client pour l\'instant.</b><span>Créez le premier environnement client (une invitation part automatiquement à son adresse e-mail), ou générez un client de démonstration avec des données fictives.</span><div class="actions"><button class="btn" data-act="client-new">' + icon('plus') + 'Nouveau client</button><button class="btn ghost" data-act="demo-create">Créer un client de démonstration</button></div></div>';
  return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Raison sociale</th><th>Code</th><th>E-mail (identifiant)</th><th class="num">Biens</th><th class="num">Valeur brute</th><th class="num">VNC</th><th>Accès</th><th></th></tr></thead><tbody>' +
    S.registry.map((c) => {
      const t = S.tenants[c.id], st = (t && t.stats) || {};
      const a = SB.access[c.id];
      const canInvite = !c.demo && c.actif !== false && !(a && a.confirmed_at && String(a.email).toLowerCase() === String(c.login).toLowerCase());
      return '<tr><td><b>' + esc(c.raison) + '</b>' + (c.demo ? ' <span class="pill">démo</span>' : '') + (c.mf ? '<div class="muted" style="font-size:11.5px">MF ' + esc(c.mf) + '</div>' : '') + '</td><td class="code">' + esc(c.codeSociete) + '</td><td>' + esc(c.login) + '</td><td class="num">' + (!t ? '…' : esc(st.nb || 0)) + '</td><td class="num">' + (st.vb === undefined ? '' : money(st.vb)) + '</td><td class="num">' + (st.vnc === undefined ? '' : money(st.vnc)) + '</td><td>' + accessCell(c) + '</td>' +
        '<td><div class="actions" style="justify-content:flex-end"><button class="btn sm" data-act="client-open" data-id="' + esc(c.id) + '">Ouvrir</button>' + (compact ? '' : '<button class="btn ghost sm" data-act="client-edit" data-id="' + esc(c.id) + '">Modifier</button>' + (canInvite ? '<button class="btn ghost sm" data-act="client-invite" data-id="' + esc(c.id) + '">' + (a ? 'Renvoyer l\'invitation' : 'Inviter') + '</button>' : '') + (a && a.confirmed_at && c.actif !== false ? '<button class="btn ghost sm" data-act="client-reset" data-id="' + esc(c.id) + '">Réinitialiser le mot de passe</button>' : '') + '<button class="btn ghost sm" data-act="client-toggle" data-id="' + esc(c.id) + '">' + (c.actif === false ? 'Activer' : 'Désactiver') + '</button><button class="btn danger sm" data-act="client-del" data-id="' + esc(c.id) + '" aria-label="Supprimer">' + icon('trash') + '</button>') + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
};
// État des accès rafraîchi à l'ouverture de la liste des clients (au plus toutes les 10 s)
['adm-clients', 'adm-dash'].forEach((v) => {
  const prev = VIEWS[v].after;
  VIEWS[v].after = function () { if (prev) prev(); if (Date.now() - (SB.accessAt || 0) > 10000) refreshAccess(); };
});
ACT['client-invite'] = (el) => { const c = S.registry.find((x) => x.id === el.dataset.id); if (c) inviteClient(c); };
ACT['client-pwd'] = ACT['client-invite'];
ACT['client-reset'] = async (el) => {
  const c = S.registry.find((x) => x.id === el.dataset.id); if (!c) return;
  const ok = await confirmBox('Réinitialiser le mot de passe', '<p>Un lien personnel sera envoyé à <b>' + esc(c.login) + '</b>. En l\'ouvrant, <b>' + esc(c.raison) + '</b> choisira un nouveau mot de passe ; l\'ancien reste valable jusque-là.</p><p class="muted" style="margin:0">Le mot de passe n\'est jamais visible, ni par vous ni par le client après sa saisie.</p>', 'Envoyer le lien');
  if (!ok) return;
  const r = await callInvite('reset', c.id);
  if (!r.ok) { toast('Lien non envoyé : ' + r.msg, 'bad'); return; }
  toast('Lien de réinitialisation envoyé à ' + c.login + '.', 'ok');
};
const toggleBase = ACT['client-toggle'];
ACT['client-toggle'] = async (el) => { await toggleBase(el); refreshAccess(); };
const delBase = ACT['client-del'];
ACT['client-del'] = async (el) => {
  const c = S.registry.find((x) => x.id === el.dataset.id); if (!c) return;
  const before = S.registry.length;
  await delBase(el);
  if (S.registry.length < before) {
    const r = await callInvite('revoke', c.id);
    if (!r.ok) toast('Données supprimées, mais l\'accès e-mail n\'a pas pu être retiré : ' + r.msg + '. Supprimez l\'utilisateur dans Supabase (Authentication).', 'bad');
    refreshAccess();
  }
};
clientForm = function (c) {
  const isNew = !c;
  const d = c || { raison: '', codeSociete: '', login: '', mf: '', actif: true };
  const t = c ? (S.tenants[c.id] || {}) : {};
  openModal({
    title: isNew ? 'Nouveau client' : 'Modifier ' + d.raison, sticky: true,
    body: '<form class="form" id="cl-form"><div class="row"><label class="field"><span>Raison sociale <em>*</em></span><input id="cl-raison" required maxlength="160" value="' + esc(d.raison) + '"></label><label class="field"><span>Code société (2 caractères) <em>*</em></span><input id="cl-code" class="mono" maxlength="2" required value="' + esc(d.codeSociete) + '"' + (isNew ? '' : ' readonly') + '><small>' + (isNew ? 'Premiers caractères de tous les codes immobilisations ; non modifiable ensuite.' : 'Non modifiable : utilisé par les codes existants.') + '</small></label></div>' +
      '<div class="row"><label class="field"><span>Adresse e-mail du client (identifiant) <em>*</em></span><input id="cl-login" type="email" required maxlength="190" value="' + esc(d.demo ? '' : d.login) + '"><small>' + (isNew ? 'Une invitation est envoyée à cette adresse. Le client valide son adresse en ouvrant le lien, puis choisit son mot de passe.' : 'Si vous changez l\'adresse, l\'ancien accès est supprimé et une invitation part vers la nouvelle.') + '</small></label></div>' +
      '<div class="row"><label class="field"><span>Matricule fiscal</span><input id="cl-mf" maxlength="40" value="' + esc(d.mf || '') + '"></label><label class="field"><span>Adresse</span><input id="cl-adr" maxlength="300" value="' + esc(t.adresse || '') + '"></label></div>' +
      (isNew ? '<div class="row"><label class="field"><span>Clôture de l\'exercice</span><select id="cl-clo"><option value="31/12">31 décembre</option><option value="30/06">30 juin</option><option value="30/09">30 septembre</option><option value="31/03">31 mars</option></select></label><label class="field"><span>Référentiel d\'amortissement</span><select id="cl-ref"><option value="NC05">NC 05 – durées d\'utilité</option><option value="FISCAL">Taux fiscaux (note spécifique)</option></select></label><label class="check"><input type="checkbox" id="cl-emp" checked> Créer les emplacements de départ (siège, direction, comptabilité…)</label></div>' : '') +
      '</form>',
    foot: '<button class="btn ghost" data-act="modal-close">Annuler</button><button class="btn" id="cl-ok">' + (isNew ? 'Créer le client et l\'inviter' : 'Enregistrer') + '</button>',
    mount: (m) => {
      const r = m.querySelector('#cl-raison'), code = m.querySelector('#cl-code');
      if (isNew) r.addEventListener('input', () => { if (!code.dataset.touched) code.value = suggestCode(r.value); });
      code.addEventListener('input', () => { code.dataset.touched = '1'; code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      m.querySelector('#cl-ok').addEventListener('click', async () => {
        const raison = r.value.trim(), cs = code.value.trim().toUpperCase(), login = m.querySelector('#cl-login').value.trim().toLowerCase();
        if (!raison || !/^[A-Z0-9]{2}$/.test(cs) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(login)) { toast('Renseignez la raison sociale, un code société de 2 caractères et un e-mail valide.', 'bad'); return; }
        if (S.registry.some((x) => x.codeSociete === cs && (!c || x.id !== c.id))) { toast('Le code société ' + cs + ' est déjà attribué.', 'bad'); return; }
        if (S.registry.some((x) => String(x.login).toLowerCase() === login && (!c || x.id !== c.id)) || login === String((SB.who && SB.who.email) || '').toLowerCase()) { toast('Cette adresse e-mail est déjà utilisée.', 'bad'); return; }
        const mf = m.querySelector('#cl-mf').value.trim(), adr = m.querySelector('#cl-adr').value.trim();
        const okBtn = m.querySelector('#cl-ok'); okBtn.disabled = true;
        try {
          if (isNew) {
            const id = uid(); const clo = m.querySelector('#cl-clo').value.split('/');
            const reg = { raison: raison, codeSociete: cs, login: login, mf: mf, actif: true, createdAt: nowIso() };
            const ten = { raison: raison, codeSociete: cs, mf: mf, adresse: adr, activite: '', clotureJour: Number(clo[0]), clotureMois: Number(clo[1]), prorata: '', referentiel: m.querySelector('#cl-ref').value, ecartVirement: 'sortie', categories: clone(S.cfg.categories), emplacements: m.querySelector('#cl-emp').checked ? defaultEmps() : [], stats: { nb: 0, vb: 0, vnc: 0 }, createdAt: nowIso() };
            await Store.set(P.client(id), reg);
            await Store.set(P.tenant(id), ten);
            const entry = Object.assign(reg, { id: id });
            S.registry.push(entry); S.tenants[id] = ten;
            S.registry.sort((a, b) => String(a.raison).localeCompare(String(b.raison), 'fr'));
            closeModal(); render();
            await inviteClient(entry, true);
          } else {
            const changed = String(c.login).toLowerCase() !== login;
            if (changed && !c.demo && SB.access[c.id]) {
              const ok = await confirmBox('Changer l\'adresse e-mail', '<p>L\'accès actuel (<b>' + esc(c.login) + '</b>) sera supprimé et une invitation sera envoyée à <b>' + esc(login) + '</b>. Les données de la société sont conservées.</p>', 'Changer l\'adresse');
              if (!ok) { okBtn.disabled = false; return; }
            }
            const reg = Object.assign(clone(c), { raison: raison, login: login, mf: mf }); delete reg.id;
            if (changed) delete reg.demo;
            await Store.set(P.client(c.id), reg);
            const ten = await Store.get(P.tenant(c.id));
            if (ten) { ten.raison = raison; ten.mf = mf; ten.adresse = adr; await Store.set(P.tenant(c.id), ten); S.tenants[c.id] = ten; }
            Object.assign(c, reg); if (changed) delete c.demo;
            closeModal(); toast('Client mis à jour.', 'ok'); render();
            if (changed && c.actif !== false) await inviteClient(c, true);
          }
        } catch (e) { okBtn.disabled = false; storeError(e, 'client'); }
      });
    }
  });
};

/* ---------- Démarrage ---------- */
boot = async function () {
  render();
  if (!sbClient()) return;
  try {
    const b = await sb.rpc('public_branding');
    if (b.data) {
      const x = {}; Object.keys(b.data).forEach((k) => { if (b.data[k] !== null && b.data[k] !== undefined) x[k] = b.data[k]; });
      const d = defaultConfig();
      S.cfg = Object.assign(d, x, { colors: Object.assign(d.colors, x.colors || {}) });
    }
  } catch (e) { console.warn(e); }
  S.ready = true;
  // Lien reçu par e-mail : invitation, réinitialisation, changement d'adresse
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const th = q.get('token_hash'), ty = q.get('type');
  if (th || q.get('error') || h.get('error')) history.replaceState(null, '', location.pathname);
  if (q.get('error') || h.get('error')) {
    S.gate = { kind: 'link-error', msg: 'Ce lien est invalide ou a expiré.' }; render(); return;
  }
  if (th && ty) {
    if (['invite', 'recovery', 'email_change', 'email'].indexOf(ty) === -1) { S.gate = { kind: 'link-error' }; render(); return; }
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    const v = await sb.auth.verifyOtp({ token_hash: th, type: ty });
    if (v.error) { S.gate = { kind: 'link-error', msg: 'Ce lien est invalide, a déjà été utilisé ou a expiré.' }; render(); return; }
    if (ty === 'invite' || ty === 'recovery') {
      try { await sbWhoami(); } catch (e) { /* rien */ }
      const setpwd = { kind: 'setpwd', type: ty };
      const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      S.gate = (aal.data && aal.data.nextLevel === 'aal2' && aal.data.currentLevel !== 'aal2') ? { kind: 'mfa', then: setpwd } : setpwd;
      startIdle(); render(); return;
    }
  }
  const s = await sb.auth.getSession();
  if (s.data && s.data.session) {
    try { await sbAfterAuth(); } catch (e) { console.error(e); await sbSignOutLocal(); }
  } else render();
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && (S.session || S.gate)) { localReset(); render(); } });
};

/* ==========================================================================
   Démarrage
   ========================================================================== */
async function boot() {
  render();
  await Store.init();
  try { const c = await Store.get(P.config); S.cfg = mergeConfig(c); } catch (e) { console.warn('Configuration par défaut', e); }
  S.ready = true;
  const sess = readSession();
  if (!sess) { render(); return; }
  S.session = sess;
  try {
    if (sess.role === 'admin') { await loadAdminAuth(); await enterAdmin(); }
    else {
      await loadRegistry();
      const c = S.registry.find((x) => x.id === sess.clientId);
      if (!c || c.actif === false) { logout(); return; }
      await enterTenant(sess.clientId);
    }
  } catch (e) { console.error(e); logout(); }
}
window.addEventListener('load', () => { if (S.view === 'etiquettes' && S.tenant) drawBarcodes(); });
boot();

})();
