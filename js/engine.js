/* ==========================================================================
   immo (CTB) — moteur de calcul (fonctions pures, testables)
   Référentiel : NC 05 Immobilisations corporelles (version applicable aux
   exercices ouverts à partir du 1er janvier 2021) et NC 06 pour les
   incorporelles. La fiscalité (art. 12 bis CIRPPIS, décret n° 2008-492) est
   traitée à part, dans le passage comptable / fiscal.
   Propriété de CTB – Cabinet Tahar Bakir
   ========================================================================== */
(function (root) {
  'use strict';

  /* ---------------- Nombres ---------------- */
  const r3 = (x) => Math.round((Number(x) + (Number(x) >= 0 ? Number.EPSILON : -Number.EPSILON)) * 1000) / 1000;
  const num = (x) => { const n = typeof x === 'string' ? Number(x.replace(/[\s  ]/g, '').replace(',', '.')) : Number(x); return isFinite(n) ? n : 0; };
  const has = (v) => v !== undefined && v !== null && v !== '';

  function fmtNum(x, dec) {
    if (dec === undefined) dec = 3;
    if (x === null || x === undefined || x === '' || !isFinite(Number(x))) return '';
    let v = Number(x);
    if (Math.abs(v) < Math.pow(10, -dec) / 2) v = 0;
    const neg = v < 0;
    const s = Math.abs(v).toFixed(dec);
    const parts = s.split('.');
    const i = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '-' : '') + i + (parts[1] ? ',' + parts[1] : '');
  }
  function fmtPct(rate) {
    if (rate === null || rate === undefined || rate === '') return '';
    const v = Math.round(Number(rate) * 10000) / 100;
    return String(v).replace('.', ',') + ' %';
  }
  function fmtYears(y) {
    if (!(y > 0)) return '';
    const tot = Math.round(y * 12);
    const a = Math.floor(tot / 12), m = tot % 12;
    return (a ? a + ' an' + (a > 1 ? 's' : '') : '') + (a && m ? ' ' : '') + (m ? m + ' mois' : '');
  }
  function normYears(x) { x = Number(x) || 0; const r = Math.round(x); return Math.abs(x - r) < 0.01 ? r : x; }

  /* ---------------- Dates (ISO AAAA-MM-JJ, en jours UTC) ---------------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  function dn(isoDate) { const p = String(isoDate).split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5); }
  function iso(dnum) { return new Date(dnum * 864e5).toISOString().slice(0, 10); }
  function isoFrom(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function ymd(dnum) { const d = new Date(dnum * 864e5); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; }
  function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function fmtDate(isoDate) { if (!isoDate) return ''; const p = String(isoDate).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function today() { const d = new Date(); return isoFrom(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function isValidIso(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false; const p = s.split('-').map(Number); return p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && p[2] <= dim(p[0], p[1]); }

  /** Accepte JJ/MM/AAAA, AAAA-MM-JJ, numéro de série Excel ou objet Date. */
  function parseUserDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return isoFrom(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && v > 59 && v < 80000) return iso(Math.round(v) - 25569);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { const r = isoFrom(+m[1], +m[2], +m[3]); return isValidIso(r) ? r : ''; }
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; const r = isoFrom(y, +m[2], +m[1]); return isValidIso(r) ? r : ''; }
    return '';
  }
  function firstOfMonthDn(isoDate) { const p = ymd(dn(isoDate)); return dn(isoFrom(p[0], p[1], 1)); }
  function addMonthsDn(dnum, months) {
    const p = ymd(dnum); let y = p[0], m = p[1] - 1 + months;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return dn(isoFrom(y, m + 1, Math.min(p[2], dim(y, m + 1))));
  }

  /* ---------------- Exercices comptables ---------------- */
  function exo(year, cfg) {
    const cm = (cfg && cfg.clotureMois) || 12, cd = (cfg && cfg.clotureJour) || 31;
    const end = isoFrom(year, cm, Math.min(cd, dim(year, cm)));
    const prevEnd = isoFrom(year - 1, cm, Math.min(cd, dim(year - 1, cm)));
    const s = dn(prevEnd) + 1, e = dn(end);
    return { year: year, start: iso(s), end: end, s: s, e: e };
  }
  function exoOf(isoDate, cfg) {
    const y = Number(String(isoDate).slice(0, 4));
    const E = exo(y, cfg);
    if (dn(isoDate) > E.e) return y + 1;
    if (dn(isoDate) < E.s) return y - 1;
    return y;
  }
  function exoLabel(year, cfg) {
    if (((cfg && cfg.clotureMois) || 12) === 12 && ((cfg && cfg.clotureJour) || 31) === 31) return String(year);
    const E = exo(year, cfg);
    return fmtDate(E.start) + ' – ' + fmtDate(E.end);
  }

  /* ---------------- Prorata temporis ---------------- */
  function days360(a, bExcl) {
    const A = ymd(a), B = ymd(bExcl);
    const d1 = Math.min(A[2], 30), d2 = Math.min(B[2], 30);
    return (B[0] - A[0]) * 360 + (B[1] - A[1]) * 30 + (d2 - d1);
  }
  function monthsFrac(a, bExcl) {
    if (bExcl <= a) return 0;
    const A = ymd(a), B = ymd(bExcl);
    let months = (B[0] - A[0]) * 12 + (B[1] - A[1]);
    let frac;
    if (B[2] >= A[2]) frac = (B[2] - A[2]) / dim(B[0], B[1]);
    else {
      months -= 1;
      const py = B[1] === 1 ? B[0] - 1 : B[0], pm = B[1] === 1 ? 12 : B[1] - 1;
      frac = (dim(py, pm) - A[2] + B[2]) / dim(py, pm);
    }
    return months + frac;
  }
  function monthsTouched(a, bIncl) { const A = ymd(a), B = ymd(bIncl); return (B[0] - A[0]) * 12 + (B[1] - A[1]) + 1; }
  /** Fraction d'exercice couverte par [pS ; pE] (bornes incluses). */
  function fraction(pS, pE, E, method) {
    if (pE < pS) return 0;
    if (method === 'j360') return days360(pS, pE + 1) / days360(E.s, E.e + 1);
    if (method === 'mois') return monthsTouched(pS, pE) / monthsTouched(E.s, E.e);
    return (pE - pS + 1) / (E.e - E.s + 1);
  }

  /* ---------------- Référentiels par défaut ---------------- */
  const DEFAULT_FISCAL = {
    seuilFaibleValeur: 500,          // art. 12 bis CIRPPIS (LF 2019, art. 25)
    seuilCV: 9,                      // art. 15 : voitures de tourisme > 9 CV
    seuilEspeces: 5000,              // actifs ≥ 5 000 DT HT réglés en espèces
    coefDeux: 1.5,                   // décret n° 2008-492, art. 2 : deux équipes
    coefTrois: 2,                    // trois équipes
    degressifAutorise: false,        // plafond dégressif supprimé depuis la LF 2008 (NC n° 22/2008)
    degCoefs: [{ max: 4, coef: 1.5 }, { max: 6, coef: 2 }, { max: 999, coef: 2.5 }],
    degDureeMin: 3
  };
  const DEFAULT_COMPTES = {
    dotAmort: '6811', dotProv: '6816', repriseProv: '7816',
    chargeReeval: '637', produitReeval: '736',
    ecartReeval: '144', resultatsReportes: '121',
    provDemantelement: '158', desactualisation: '6865', produitDemantelement: '736',
    subvention: '145', quotePartSub: '739',
    cessionCharge: '636', cessionProduit: '736', creanceCession: '452', indemnite: '4671'
  };
  function comptesOf(cfg) {
    const f = (cfg && cfg.fiscal) || {};
    const legacy = {};
    if (f.compteCession) legacy.cessionCharge = f.compteCession;
    if (f.compteGainCession) legacy.cessionProduit = f.compteGainCession;
    if (f.compteCreance) legacy.creanceCession = f.compteCreance;
    if (f.compteIndemnite) legacy.indemnite = f.compteIndemnite;
    return Object.assign({}, DEFAULT_COMPTES, legacy, (cfg && cfg.comptes) || {});
  }
  const sub1 = (c) => String(c || '').slice(1);
  function makeCat(code, libelle, type, cptImmo, duree, tauxFiscal, extra) {
    return Object.assign({
      code: code, libelle: libelle, type: type, cptImmo: cptImmo,
      cptAmort: duree > 0 ? '28' + sub1(cptImmo) : '', cptProv: '29' + sub1(cptImmo), cptDot: '6811',
      duree: duree, taux: duree > 0 ? Math.round(10000 / duree) / 100 : 0, tauxFiscal: tauxFiscal,
      amortissable: duree > 0, regimeFiscal: 'L', degressifEligible: false, equipesEligible: false, vehicule: false, roulant: false,
      enCours: false, modele: 'cout', frequenceReeval: 5, note: ''
    }, extra || {});
  }
  const DEFAULT_CATEGORIES = [
    makeCat('01', 'Terrains', 'C', '221', 0, 0, { regimeFiscal: 'ND', note: 'Non amortissables (NC 05 §46), sauf carrières et sites d\'enfouissement.' }),
    makeCat('02', 'Constructions en dur', 'C', '222', 25, 5, { note: 'Durée d\'utilité indicative 25 ans ; taux fiscal maximum 5 %.' }),
    makeCat('03', 'Constructions légères', 'C', '222', 10, 10, { note: 'Taux fiscal maximum 10 %.' }),
    makeCat('04', 'Agencements, aménagements et installations', 'C', '2281', 10, 10, { note: 'Sur un local loué, la durée ne peut excéder celle du bail.' }),
    makeCat('05', 'Matériel et outillage industriels', 'C', '223', 10, 15, { degressifEligible: true, equipesEligible: true, note: 'Taux fiscal 15 % ; coefficient 1,5 (deux équipes) ou 2 (trois équipes).' }),
    makeCat('06', 'Équipements de chauffage et frigorifiques', 'C', '223', 10, 10, { degressifEligible: true, note: 'Taux fiscal 10 %.' }),
    makeCat('07', 'Ascenseurs et monte-charges', 'C', '223', 15, 10, { note: 'Taux fiscal 10 %.' }),
    makeCat('08', 'Matériel de transport', 'C', '224', 5, 20, { roulant: true, note: 'Taux fiscal 20 %.' }),
    makeCat('09', 'Voitures de tourisme', 'C', '224', 5, 20, { vehicule: true, roulant: true, note: 'Amortissement non déductible au-delà de 9 CV, sauf objet principal de l\'exploitation.' }),
    makeCat('10', 'Mobilier de bureau', 'C', '2282', 10, 20, { note: 'Taux fiscal 20 %.' }),
    makeCat('11', 'Matériel de bureau', 'C', '2282', 5, 20, { note: 'Taux fiscal 20 %.' }),
    makeCat('12', 'Matériel informatique', 'C', '2283', 3, 33.33, { degressifEligible: true, note: 'Taux fiscal 33,33 %.' }),
    makeCat('13', 'Rayonnages métalliques', 'C', '2288', 10, 15, { note: 'Taux fiscal 15 %.' }),
    makeCat('14', 'Autres machines et équipements', 'C', '223', 8, 15, { degressifEligible: true, note: 'Taux fiscal 15 %.' }),
    makeCat('15', 'Grosses réparations et révisions (composants)', 'C', '223', 3, 33.33, { note: 'Composant distinct (NC 05 §12 et §18) ; taux fiscal 33,33 %.' }),
    makeCat('19', 'Immobilisations corporelles en cours', 'C', '232', 0, 0, { regimeFiscal: 'ND', enCours: true, note: 'Non amortissables jusqu\'à la mise en service.' }),
    makeCat('20', 'Logiciels', 'I', '213', 3, 33.33, { note: 'NC 06 ; taux fiscal 33,33 %.' }),
    makeCat('21', 'Brevets, marques et frais de développement', 'I', '212', 5, 20, { note: 'NC 06 ; taux fiscal 20 %.' }),
    makeCat('22', 'Fonds commercial', 'I', '214', 20, 0, { regimeFiscal: 'ND', note: 'NC 06 ; amortissement non déductible.' }),
    makeCat('23', 'Droit au bail', 'I', '216', 20, 0, { regimeFiscal: 'ND', note: 'NC 06 ; traitement fiscal à apprécier selon le contrat.' }),
    makeCat('24', 'Autres immobilisations incorporelles', 'I', '218', 5, 20, { note: 'NC 06.' })
  ];

  /** Met à niveau une catégorie enregistrée par une version antérieure. */
  function upgradeCategory(c) {
    const x = Object.assign({}, c);
    if (x.cptDot === '6812') x.cptDot = '6811';                     // 6812 = résorption des charges reportées
    if (x.code === '23' && x.cptImmo === '215') { x.cptImmo = '216'; if (x.cptAmort === '2815') x.cptAmort = '2816'; }
    if (x.code === '24' && x.type === 'I' && x.cptImmo === '216') { x.cptImmo = '218'; if (x.cptAmort === '2816') x.cptAmort = '2818'; }
    if (!x.cptProv && x.cptImmo) x.cptProv = '29' + sub1(x.cptImmo);
    if (!(num(x.duree) > 0)) x.duree = x.amortissable && num(x.taux) > 0 ? normYears(100 / num(x.taux)) : 0;
    if (!x.modele) x.modele = 'cout';
    if (!(num(x.frequenceReeval) > 0)) x.frequenceReeval = 5;
    if (x.enCours === undefined) x.enCours = /^23/.test(String(x.cptImmo || ''));
    if (x.roulant === undefined) x.roulant = !!x.vehicule || /^224/.test(String(x.cptImmo || ''));
    if (x.type !== 'I') x.type = 'C';
    return x;
  }

  const DEFAULT_SORTIES = ['Cession (vente)', 'Mise au rebut / casse', 'Vol', 'Perte / manquant à l\'inventaire', 'Sinistre (destruction)', 'Échange', 'Don', 'Apport en société', 'Remplacement de composant', 'Autre'];
  const DEFAULT_ETATS = ['Bon', 'Moyen', 'Mauvais', 'Temporairement inutilisé', 'Hors service'];
  const MODES = { L: 'Linéaire', D: 'Dégressif', UO: 'Unités d\'œuvre', A: 'Linéaire accéléré (équipes)', I: 'Intégral (faible valeur)', N: 'Non amortissable' };
  const REGIMES = { L: 'Linéaire (taux maximum)', D: 'Dégressif (texte spécial)', A: 'Linéaire accéléré (équipes)', I: 'Amortissement intégral (faible valeur)', ND: 'Non déductible' };
  const ENTREES = { achat: 'Acquisition', production: 'Production immobilisée', echange: 'Échange', apport: 'Apport en nature', leasing: 'Location-financement (NC 41)', autre: 'Autre' };
  const EVENT_TYPES = { revision: 'Révision des estimations', complement: 'Dépense ultérieure immobilisée', test: 'Test de dépréciation', reevaluation: 'Réévaluation', transfert: 'Reclassement / mise en service', demantelement: 'Révision de la provision pour démantèlement' };
  const INDICES = {
    marche: 'Baisse significative de la valeur de marché de l\'actif (§57 a)',
    environnement: 'Évolution défavorable de la législation ou de l\'environnement économique (§57 b)',
    couts: 'Coûts accumulés très supérieurs aux estimations initiales (§57 c)',
    obsolescence: 'Obsolescence technique ou dégradation physique constatée',
    arret: 'Arrêt, restructuration ou sortie prévue de l\'activité concernée',
    performance: 'Performance économique inférieure aux prévisions',
    inutilise: 'Actif inutilisé ou destiné à être cédé'
  };

  function fiscalOf(cfg) { return Object.assign({}, DEFAULT_FISCAL, (cfg && cfg.fiscal) || {}); }
  function degCoef(n, fisc) {
    const list = (fisc && fisc.degCoefs) || DEFAULT_FISCAL.degCoefs;
    const min = fisc && fisc.degDureeMin !== undefined ? Number(fisc.degDureeMin) : 3;
    if (!(n >= min - 0.01)) return 1;
    const sorted = list.slice().sort((a, b) => Number(a.max) - Number(b.max));
    for (const c of sorted) if (n <= Number(c.max) + 0.01) return Number(c.coef) || 1;
    return 1;
  }
  function coefEquipes(equipes, fisc) {
    if (Number(equipes) === 3) return Number(fisc.coefTrois) || 2;
    if (Number(equipes) === 2) return Number(fisc.coefDeux) || 1.5;
    return 1;
  }

  /* ---------------- Durées ---------------- */
  function catDuration(cat, cfg) {
    if (!cat || !cat.amortissable) return 0;
    if (cfg && cfg.referentiel === 'FISCAL' && num(cat.tauxFiscal) > 0) return normYears(100 / num(cat.tauxFiscal));
    if (num(cat.duree) > 0) return normYears(num(cat.duree));
    if (num(cat.taux) > 0) return normYears(100 / num(cat.taux));
    return 0;
  }
  /** Durée d'utilité comptable retenue pour un bien (années). */
  function durationOf(a, cat, cfg) {
    if (num(a.duree) > 0) return normYears(num(a.duree));
    if (has(a.taux) && num(a.taux) > 0) return normYears(100 / num(a.taux));
    return catDuration(cat, cfg);
  }
  function fiscalYears(a, cat) {
    const t = a.fiscal && has(a.fiscal.taux) ? num(a.fiscal.taux) : num(cat && cat.tauxFiscal);
    return t > 0 ? normYears(100 / t) : 0;
  }
  function fiscalBaseOf(a) { return r3(num(a.valeur) - (a.demantelement ? num(a.demantelement.montant) : 0)); }

  /* ---------------- Régime fiscal ---------------- */
  function fiscalRegime(a, cat, cfg) {
    const fisc = fiscalOf(cfg);
    const fy = fiscalYears(a, cat);
    const tf = fy > 0 ? 1 / fy : 0;
    const fb = fiscalBaseOf(a);
    const out = (regime, raison, extra) => Object.assign({ regime: regime, raison: raison, taux: tf, libelle: REGIMES[regime] }, extra || {});
    if (!cat || !cat.amortissable) return out('ND', 'NA', { libelle: 'Non amortissable' });
    const forced = a.fiscal && a.fiscal.regime && a.fiscal.regime !== 'auto' ? a.fiscal.regime : null;
    const isVP = !!(cat.vehicule && a.vehicule && a.vehicule.tourisme !== false && num(a.vehicule.cv) > num(fisc.seuilCV) && !a.vehicule.objetPrincipal);
    if (forced === 'ND') return out('ND', isVP ? 'VP' : 'FORCE');
    if (cat.regimeFiscal === 'ND' && !forced) return out('ND', 'CAT');
    if (isVP && !forced) return out('ND', 'VP', { libelle: 'Non déductible (voiture de tourisme > ' + fisc.seuilCV + ' CV)' });
    if (a.especes && fb >= num(fisc.seuilEspeces) && !forced) return out('ND', 'ESP', { libelle: 'Non déductible (réglé en espèces ≥ ' + fmtNum(fisc.seuilEspeces, 0) + ' DT)' });
    if (forced === 'I' || (!forced && fb > 0 && fb <= num(fisc.seuilFaibleValeur))) return out('I', 'FV');
    if (forced === 'D') {
      if (fisc.degressifAutorise && cat.degressifEligible) return out('D', 'OPT');
      return out('L', 'DEG_NON_AUTORISE', { alerte: 'Plafond dégressif non applicable : le plafond linéaire est retenu.' });
    }
    const eq = Number(a.equipes || (a.fiscal && a.fiscal.equipes));
    if ((forced === 'A' || !forced) && cat.equipesEligible && eq >= 2) return out('A', 'EQ');
    if (forced === 'A') return out('L', 'EQ_NON_ELIGIBLE', { alerte: 'Coefficient d\'équipes non applicable à cette catégorie : plafond linéaire retenu.' });
    return out('L', 'STD');
  }

  /* ---------------- Événements et valeur récupérable ---------------- */
  const END_OF_DAY = { test: 1, reevaluation: 1, demantelement: 1, __stop: 1 };
  function eventsOf(a) {
    return (a.events || []).map((e, i) => Object.assign({}, e, { _i: i }))
      .filter((e) => e && EVENT_TYPES[e.type] && isValidIso(e.date))
      .map((e) => Object.assign(e, { _dn: dn(e.date), _at: dn(e.date) + (END_OF_DAY[e.type] ? 1 : 0) }))
      .sort((x, y) => x._at - y._at || x._i - y._i);
  }
  /** Valeur actualisée de flux annuels (fin d'année) et d'une valeur de sortie. */
  function dcf(flows, rate, exitValue) {
    const r = num(rate) / 100; let pv = 0;
    const list = (flows || []).map(num);
    list.forEach((f, i) => { pv += f / Math.pow(1 + r, i + 1); });
    if (list.length || num(exitValue)) pv += num(exitValue) / Math.pow(1 + r, Math.max(1, list.length));
    return r3(pv);
  }
  /** Valeur récupérable (NC 05 §58 et §60) : flux actualisés ; à défaut, juste valeur ; la plus élevée si les deux sont déterminées. */
  function recoverable(ev) {
    const vu = has(ev.valeurUtilite) ? num(ev.valeurUtilite) : null;
    const jv = has(ev.justeValeur) ? num(ev.justeValeur) : null;
    if (vu === null && jv === null) return null;
    if (vu === null) return { ra: r3(jv), base: 'jv' };
    if (jv === null) return { ra: r3(vu), base: 'vu' };
    return vu >= jv ? { ra: r3(vu), base: 'vu' } : { ra: r3(jv), base: 'jv' };
  }

  /* ---------------- Plan d'amortissement (NC 05) ---------------- */
  /**
   * Calcule, exercice par exercice, la valeur brute, les amortissements, les
   * pertes de valeur, l'écart de réévaluation, la provision pour démantèlement,
   * la quote-part de subvention et, en parallèle, le plafond fiscal.
   * opts : { ignoreTests, ignoreReeval, stopDn, shadow }
   */
  function schedule(a, cat, cfg, opts) {
    opts = opts || {}; cfg = cfg || {};
    const fisc = fiscalOf(cfg);
    const pro = cfg.prorata || 'jours';
    const ref = cfg.referentiel === 'FISCAL' ? 'FISCAL' : 'NC05';
    const cost = r3(num(a.valeur));
    const demInit = a.demantelement && num(a.demantelement.montant) > 0 ? r3(num(a.demantelement.montant)) : 0;
    const demRate = demInit > 0 ? num(a.demantelement.taux) / 100 : 0;
    const demEch = demInit > 0 && isValidIso(a.demantelement.echeance) ? dn(a.demantelement.echeance) : Infinity;
    const subTotal = a.subvention && num(a.subvention.montant) > 0 ? r3(num(a.subvention.montant)) : 0;
    const mesIso = a.dateMES || a.dateAcq;
    const exitDn = a.sortie && isValidIso(a.sortie.date) ? dn(a.sortie.date) : Infinity;
    const regime = fiscalRegime(a, cat, cfg);
    const amortissable = !!(cat && cat.amortissable) && a.mode !== 'N';
    let mode = amortissable ? (a.mode && MODES[a.mode] ? a.mode : 'L') : 'N';
    const n = durationOf(a, cat, cfg);
    const res = { rows: [], events: [], cost: cost, base: cost, vr: r3(num(a.vr)), regime: regime, mode: mode, dureeAns: n, coef: 1, tauxEffectif: 0, erreur: null, fiscalBase: r3(cost - demInit), init: null, final: null };
    if (!a.dateAcq || !isValidIso(a.dateAcq) || !isValidIso(mesIso)) { res.erreur = 'Dates manquantes ou invalides.'; return res; }
    if ((mode === 'L' || mode === 'A' || mode === 'D') && !(n > 0)) { res.erreur = 'Durée d\'utilité non renseignée : aucun amortissement calculé.'; mode = 'N'; res.mode = 'N'; }
    if (mode === 'UO' && !(num(a.uoTotal) > 0)) { res.erreur = 'Nombre total d\'unités d\'œuvre non renseigné.'; mode = 'N'; res.mode = 'N'; }
    let coef = 1, eff = n, td = 0;
    if (mode === 'A') { coef = coefEquipes(a.equipes, fisc); eff = n / coef; }
    if (mode === 'D') { coef = degCoef(n, fisc); td = coef / n; }
    res.coef = coef; res.dureeEffective = mode === 'D' ? n : eff;
    res.tauxEffectif = mode === 'D' ? td : ((mode === 'L' || mode === 'A') && eff > 0 ? 1 / eff : (mode === 'I' ? 1 : 0));

    const st = {
      gross: cost, cum: 0, prov: 0, surplus: 0, chargesRec: 0, vr: r3(num(a.vr)), mode: mode,
      rem: mode === 'D' ? n : eff, td: td, uoRem: num(a.uoTotal), provDem: demInit, sub: subTotal,
      fb: r3(cost - demInit), cumDed: 0, cumReint: 0, cumDotTotal: 0, cumDotF: 0, iDone: false, revalued: false
    };
    const startD = mode === 'D' && ref === 'FISCAL' ? firstOfMonthDn(a.dateAcq) : dn(mesIso);
    let startDn = startD, fsBase = dn(mesIso);
    if (a.reprise && isValidIso(a.reprise.date) && dn(a.reprise.date) > startD) {
      const repDn = dn(a.reprise.date);
      const db = Math.max(0, st.gross - st.vr);
      st.cum = r3(Math.min(db, num(a.reprise.cumul)));
      st.prov = r3(Math.min(Math.max(0, st.gross - st.cum), num(a.reprise.pertes)));
      st.surplus = r3(num(a.reprise.ecart));
      st.chargesRec = st.prov;
      const cf = has(a.reprise.cumulFiscal) ? num(a.reprise.cumulFiscal) : st.cum;
      st.cumDed = r3(Math.min(st.fb, cf));
      st.cumDotTotal = st.cum; st.cumDotF = r3(st.gross > 0 ? st.cum * Math.min(1, st.fb / st.gross) : 0);
      st.cumReint = r3(Math.max(0, st.cumDotTotal - st.cumDed));
      if (num(a.reprise.dureeRestante) > 0) st.rem = num(a.reprise.dureeRestante);
      else if (mode === 'L' || mode === 'A') st.rem = db > 0 ? eff * (1 - st.cum / db) : 0;
      else if (mode === 'D') st.rem = Math.max(0, n - monthsFrac(startD, repDn) / 12);
      if (mode === 'UO') st.uoRem = num(a.reprise.uoRestant) > 0 ? num(a.reprise.uoRestant) : (db > 0 ? num(a.uoTotal) * (1 - st.cum / db) : 0);
      if (mode === 'I') st.iDone = st.cum >= db - 0.0005;
      startDn = repDn; fsBase = Math.max(fsBase, repDn);
    }
    const snap = () => ({ gross: st.gross, cum: st.cum, prov: st.prov, surplus: st.surplus, vr: st.vr, rem: st.rem, provDem: st.provDem, sub: st.sub, fb: st.fb, cumDed: st.cumDed, cumReint: st.cumReint, cumDotTotal: st.cumDotTotal, cumDotF: st.cumDotF, mode: st.mode, ca: r3(st.gross - st.cum - st.prov) });
    res.init = snap();

    let evList = eventsOf(a).filter((e) => e._dn <= exitDn);
    if (opts.ignoreTests) evList = evList.filter((e) => e.type !== 'test');
    if (opts.ignoreReeval) evList = evList.filter((e) => e.type !== 'reevaluation');
    if (opts.stopDn !== undefined) { evList.push({ type: '__stop', _dn: opts.stopDn, _at: opts.stopDn + 1, _i: -1 }); evList.sort((x, y) => x._at - y._at || x._i - y._i); }
    // Plan fiscal d'un bien réévalué : amortissements calculés sur le coût historique (réévaluation sans effet fiscal)
    const hasReeval = !opts.shadow && evList.some((e) => e.type === 'reevaluation');
    const hist = hasReeval ? schedule(a, cat, cfg, { ignoreReeval: true, shadow: true, ignoreTests: !!opts.ignoreTests }) : null;
    const histCum = (year) => { if (!hist) return null; let v = hist.init ? hist.init.cumDotF : 0; for (const r of hist.rows) { if (r.year <= year) v = r.cumDotF; } return v; };

    // Fiscal
    const fy = fiscalYears(a, cat), tf = fy > 0 ? 1 / fy : 0;
    const cEq = coefEquipes(a.equipes || (a.fiscal && a.fiscal.equipes), fisc);
    const tdF = fy > 0 ? degCoef(fy, fisc) / fy : 0;
    const fPlanStart = firstOfMonthDn(a.dateAcq), fPlanEnd = addMonthsDn(fPlanStart, Math.round(fy * 12));
    let lastUoYear = -Infinity;
    if (mode === 'UO') Object.keys(a.uoParAnnee || {}).forEach((k) => { if (num(a.uoParAnnee[k]) > 0) lastUoYear = Math.max(lastUoYear, Number(k)); });

    function shadowCA(dnum) {
      if (opts.shadow) return Infinity;
      const s2 = schedule(a, cat, cfg, { ignoreTests: true, stopDn: dnum, shadow: true });
      return s2.stopCA !== undefined ? s2.stopCA : (s2.final ? s2.final.ca : Infinity);
    }

    if (exitDn < startDn) {
      for (const ev of evList) if (ev.type === 'complement') { st.gross = r3(st.gross + num(ev.montant)); st.fb = r3(st.fb + num(ev.montant)); }
      res.final = snap(); return res;
    }
    const startYear = exoOf(iso(startDn), cfg);
    let idx = 0;
    for (let y = startYear; y < startYear + 200; y++) {
      const E = exo(y, cfg);
      const pS = Math.max(E.s, startDn), pE = Math.min(E.e, exitDn);
      if (pE < pS) break;
      const row = {
        year: y, start: E.start, end: E.end, gDebut: st.gross, amDebut: st.cum, pvDebut: st.prov, ecartDebut: st.surplus, provDemDebut: st.provDem, remDebut: st.rem,
        baseDebut: r3(st.gross - st.cum - st.prov - st.vr), mode: st.mode,
        vbComplements: 0, vbReeval: 0, vbDem: 0, dot: 0, pvDot: 0, perteCharge: 0, perteEcart: 0, pvRep: 0, repriseProduit: 0, repriseEcart: 0,
        amElim: 0, pvElim: 0, reevalProduit: 0, reevalCharge: 0, ecartHausse: 0, ecartBaisse: 0, ecartVire: 0, desact: 0, subQP: 0, demProduit: 0,
        cap: 0, ded: 0, reint: 0, dedAnt: 0, events: [], sortie: false
      };
      const F = (x) => (x < pS ? 0 : fraction(pS, Math.min(x, pE), E, pro));
      const fS = Math.max(E.s, fsBase);
      const Ff = (x) => (x < fS ? 0 : fraction(fS, Math.min(x, pE), E, pro));

      const seg = (s, e) => {
        if (e < s) return;
        const fr = F(e) - F(s - 1);
        const ca = st.gross - st.cum - st.prov;
        const base = r3(ca - st.vr);
        let dot = 0;
        if (st.mode === 'L' || st.mode === 'A') {
          if (base > 0.0005 && fr > 0) dot = st.rem <= fr + 1e-9 ? base : base * fr / st.rem;
          st.rem = Math.max(0, st.rem - fr);
        } else if (st.mode === 'D') {
          const yrs = monthsFrac(s, e + 1) / 12;
          if (base > 0.0005 && yrs > 0) dot = st.rem <= yrs + 1e-9 ? base : Math.max(base * st.td * yrs, base * yrs / st.rem);
          st.rem = Math.max(0, st.rem - yrs);
        } else if (st.mode === 'UO') {
          const unitsY = num((a.uoParAnnee || {})[y]);
          const units = unitsY * (e - s + 1) / (pE - pS + 1);
          if (base > 0.0005 && units > 0 && st.uoRem > 0) dot = st.uoRem <= units + 1e-9 ? base : base * units / st.uoRem;
          st.uoRem = Math.max(0, st.uoRem - units);
        } else if (st.mode === 'I') {
          if (!st.iDone && base > 0.0005) dot = base;
          st.iDone = true;
        }
        dot = r3(Math.min(Math.max(dot, 0), Math.max(base, 0)));
        if (dot > 0 && base - dot < 0.0005) dot = base;
        if (dot > 0 && base > 0) {
          if (cfg.ecartVirement === 'utilisation' && st.surplus > 0) { const t = r3(Math.min(st.surplus, st.surplus * dot / base)); st.surplus = r3(st.surplus - t); row.ecartVire = r3(row.ecartVire + t); }
          if (st.sub > 0) { const q = r3(Math.min(st.sub, st.sub * dot / base)); st.sub = r3(st.sub - q); row.subQP = r3(row.subQP + q); }
        }
        st.cum = r3(st.cum + dot); st.cumDotTotal = r3(st.cumDotTotal + dot); row.dot = r3(row.dot + dot);
        st.cumDotF = r3(st.cumDotF + (st.gross > 0 ? dot * Math.min(1, Math.max(0, st.fb / st.gross)) : 0));
        if (st.provDem > 0 && demRate > 0 && s <= demEch) {
          const ee = Math.min(e, demEch);
          const ua = r3(st.provDem * demRate * (F(ee) - F(s - 1)));
          st.provDem = r3(st.provDem + ua); row.desact = r3(row.desact + ua);
        }
        // Plafond fiscal du segment
        const R = regime.regime;
        const resF = Math.max(0, st.fb - st.cumDed - row.cap);
        let cap = 0;
        if (R !== 'ND' && resF > 0 && e >= fsBase) {
          const frF = Ff(e) - Ff(s - 1);
          if (R === 'I') cap = resF;
          else if (R === 'L') cap = st.fb * tf * frF;
          else if (R === 'A') cap = st.fb * Math.min(1, tf * cEq) * frF;
          else if (R === 'D') {
            const ds = Math.max(s, fPlanStart);
            if (e >= ds) { const m = monthsFrac(ds, e + 1), remM = monthsFrac(ds, fPlanEnd); cap = remM <= m + 1e-6 ? resF : Math.max(resF * tdF * m / 12, resF * m / remM); }
          }
        }
        row.cap = r3(row.cap + Math.min(resF, Math.max(0, cap)));
      };

      const apply = (ev) => {
        const ca = r3(st.gross - st.cum - st.prov);
        if (ev.type === '__stop') { res.stopCA = ca; res.stopState = snap(); return 'stop'; }
        const out = { id: ev.id, type: ev.type, date: ev.date, year: y, ca: ca, libelle: EVENT_TYPES[ev.type], motif: ev.motif || ev.libelle || '', pieceCompta: ev.pieceCompta || '' };
        if (ev.type === 'revision') {
          out.avant = { rem: st.rem, vr: st.vr, mode: st.mode, uoRem: st.uoRem };
          if (ev.mode && MODES[ev.mode] && ev.mode !== st.mode) st.mode = ev.mode;
          if (num(ev.dureeRestante) > 0) st.rem = num(ev.dureeRestante);
          if (st.mode === 'D') st.td = st.rem > 0 ? degCoef(st.rem, fisc) / st.rem : 0;
          if (has(ev.vr)) st.vr = r3(num(ev.vr));
          if (num(ev.uoRestant) > 0) st.uoRem = num(ev.uoRestant);
          out.apres = { rem: st.rem, vr: st.vr, mode: st.mode, uoRem: st.uoRem };
        } else if (ev.type === 'complement') {
          const m = r3(num(ev.montant));
          st.gross = r3(st.gross + m); st.fb = r3(st.fb + m); row.vbComplements = r3(row.vbComplements + m);
          if (num(ev.dureeRestante) > 0) st.rem = num(ev.dureeRestante);
          out.montant = m;
        } else if (ev.type === 'test') {
          const rv = recoverable(ev);
          if (!rv) out.resultat = 'incomplet';
          else {
            out.ra = rv.ra; out.baseRA = rv.base;
            if (rv.ra < ca - 0.0005) {
              const loss = r3(ca - rv.ra);
              const imp = r3(Math.min(st.surplus, loss)); st.surplus = r3(st.surplus - imp);
              const ch = r3(loss - imp); st.chargesRec = r3(st.chargesRec + ch);
              st.prov = r3(st.prov + loss);
              row.pvDot = r3(row.pvDot + loss); row.perteEcart = r3(row.perteEcart + imp); row.perteCharge = r3(row.perteCharge + ch);
              Object.assign(out, { resultat: 'perte', perte: loss, imputationEcart: imp, charge: ch });
            } else if (rv.ra > ca + 0.0005 && st.prov > 0.0005) {
              if (!ev.changementEstimations) out.resultat = 'reprise_non_autorisee';
              else {
                const shadow = shadowCA(ev._dn);
                const rev = r3(Math.min(st.prov, Math.max(0, Math.min(rv.ra, shadow) - ca)));
                if (rev > 0) {
                  st.prov = r3(st.prov - rev);
                  const inc = r3(st.revalued ? Math.min(rev, st.chargesRec) : rev);
                  const eq = r3(rev - inc);
                  st.chargesRec = r3(Math.max(0, st.chargesRec - inc)); st.surplus = r3(st.surplus + eq);
                  row.pvRep = r3(row.pvRep + rev); row.repriseProduit = r3(row.repriseProduit + inc); row.repriseEcart = r3(row.repriseEcart + eq);
                  Object.assign(out, { resultat: 'reprise', reprise: rev, plafond: shadow === Infinity ? null : r3(shadow), produit: inc, ecart: eq });
                } else out.resultat = 'aucune';
              }
            } else out.resultat = 'aucune';
          }
        } else if (ev.type === 'reevaluation') {
          const fv = r3(num(ev.justeValeur)), diff = r3(fv - ca);
          out.jv = fv; out.ecart = diff; out.grossAvant = st.gross; out.cumElimine = st.cum; out.provEliminee = st.prov;
          if (diff >= 0) {
            const inc = r3(Math.min(diff, st.chargesRec)); st.chargesRec = r3(st.chargesRec - inc);
            const up = r3(diff - inc); st.surplus = r3(st.surplus + up);
            row.reevalProduit = r3(row.reevalProduit + inc); row.ecartHausse = r3(row.ecartHausse + up);
            out.produit = inc; out.hausse = up;
          } else {
            const dec = r3(-diff); const imp = r3(Math.min(st.surplus, dec)); st.surplus = r3(st.surplus - imp);
            const ch = r3(dec - imp); st.chargesRec = r3(st.chargesRec + ch);
            row.ecartBaisse = r3(row.ecartBaisse + imp); row.reevalCharge = r3(row.reevalCharge + ch);
            out.imputation = imp; out.charge = ch;
          }
          row.vbReeval = r3(row.vbReeval + fv - st.gross); row.amElim = r3(row.amElim + st.cum); row.pvElim = r3(row.pvElim + st.prov);
          st.gross = fv; st.cum = 0; st.prov = 0; st.revalued = true;
          if (has(ev.vr)) st.vr = r3(num(ev.vr));
          if (num(ev.dureeRestante) > 0) { st.rem = num(ev.dureeRestante); if (st.mode === 'D') st.td = degCoef(st.rem, fisc) / st.rem; }
        } else if (ev.type === 'transfert') {
          out.de = ev.de; out.vers = ev.vers; out.montant = st.gross;
        } else if (ev.type === 'demantelement') {
          const nv = r3(num(ev.montant)), delta = r3(nv - st.provDem);
          st.provDem = nv;
          if (delta >= 0) { st.gross = r3(st.gross + delta); row.vbDem = r3(row.vbDem + delta); }
          else { const dec = -delta, red = r3(Math.min(dec, Math.max(0, ca))); st.gross = r3(st.gross - red); row.vbDem = r3(row.vbDem - red); row.demProduit = r3(row.demProduit + dec - red); }
          out.delta = delta;
        }
        out.caApres = r3(st.gross - st.cum - st.prov);
        res.events.push(out); row.events.push(out);
        return null;
      };

      let cursor = pS, stopped = false;
      while (idx < evList.length && evList[idx]._dn <= pE) {
        const ev = evList[idx];
        const d = Math.max(ev._at, pS);
        if (d > cursor) { seg(cursor, d - 1); cursor = d; }
        idx++;
        if (apply(ev) === 'stop') { stopped = true; break; }
      }
      if (stopped) { res.final = snap(); return res; }
      if (cursor <= pE) seg(cursor, pE);

      // Clôture de l'exercice
      row.cap = r3(Math.min(row.cap, Math.max(0, st.fb - st.cumDed)));
      const cumF = hist ? histCum(y) : st.cumDotF;
      row.ded = r3(Math.max(0, Math.min(row.cap, cumF - st.cumDed)));
      row.reint = r3(Math.max(0, row.dot - row.ded));
      row.dedAnt = r3(Math.max(0, row.ded - row.dot));
      st.cumDed = r3(st.cumDed + row.ded);
      st.cumReint = r3(Math.max(0, st.cumDotTotal - st.cumDed));
      row.reintAutres = r3(row.perteCharge + row.reevalCharge + row.desact);
      row.dedAutres = r3(row.repriseProduit + row.reevalProduit);
      Object.assign(row, {
        gFin: st.gross, amFin: st.cum, pvFin: st.prov, vncFin: r3(st.gross - st.cum - st.prov), ecartFin: st.surplus,
        provDemFin: st.provDem, subRest: st.sub, cumDed: st.cumDed, cumReint: st.cumReint, cumDotTotal: st.cumDotTotal, cumDotF: st.cumDotF, remFin: st.rem, vrFin: st.vr,
        cumFin: st.cum, cumDebut: row.amDebut, vnc: r3(st.gross - st.cum - st.prov)
      });
      if (exitDn <= E.e) row.sortie = true;
      res.rows.push(row);
      if (row.sortie) break;
      const more = idx < evList.length;
      const base2 = st.gross - st.cum - st.prov - st.vr;
      const depDone = st.mode === 'N' || base2 <= 0.0005 || (st.mode === 'UO' && y >= lastUoYear) || (st.mode === 'I' && st.iDone);
      const demDone = !(st.provDem > 0 && demRate > 0 && demEch > E.e);
      const cumF2 = hist ? histCum(Infinity) : st.cumDotF;
      const fiscPending = regime.regime !== 'ND' && (regime.regime === 'I' || tf > 0) && cumF2 - st.cumDed > 0.0005 && st.fb - st.cumDed > 0.0005;
      if (!more && depDone && demDone && !fiscPending) break;
    }
    res.final = snap();
    return res;
  }

  /** État comptable d'un bien à la fin d'une journée donnée (après la dotation de ce jour). */
  function stateAt(a, cat, cfg, isoDate) {
    const s = schedule(a, cat, cfg, { stopDn: dn(isoDate) });
    return s.stopState || s.final || s.init;
  }

  /** Fin de garantie (date ISO) à partir d'une durée en mois ou en années. */
  function garantieFin(a) {
    const g = a && a.garantie;
    if (!g || !(num(g.duree) > 0)) return '';
    const debut = isValidIso(g.debut) ? g.debut : (a.dateMES || a.dateAcq);
    if (!isValidIso(debut)) return '';
    const mois = Math.round(num(g.duree) * (g.unite === 'ans' ? 12 : 1));
    return iso(addMonthsDn(dn(debut), mois) - 1);
  }

  /* ---------------- Catégorie à une date (reclassements) ---------------- */
  function catAt(a, isoDate) {
    let c = a.categorie;
    const t = dn(isoDate);
    const tr = eventsOf(a).filter((e) => e.type === 'transfert' && e.de && e.vers).sort((x, y) => y._dn - x._dn);
    for (const e of tr) if (e._dn > t) c = e.de;
    return c;
  }

  /* ---------------- Valeurs d'un bien pour un exercice ---------------- */
  function yearValues(a, s, year, cfg) {
    const E = exo(year, cfg);
    const z = { exists: false, vbDebut: 0, acquisitions: 0, entrees: 0, reevaluations: 0, sorties: 0, vbFin: 0, amDebut: 0, amDebutA: 0, pvDebut: 0, dotation: 0, pertes: 0, reprisesPV: 0, pertesNettes: 0, elim: 0, amSorties: 0, amFin: 0, amFinA: 0, pvFin: 0, vncFin: 0, ecartDebut: 0, ecartFin: 0, cap: 0, ded: 0, reint: 0, dedAnt: 0, reintAutres: 0, dedAutres: 0, cumReint: 0, desact: 0, subQP: 0, row: null };
    if (!a.dateAcq || !isValidIso(a.dateAcq)) return z;
    const acq = dn(a.dateAcq), exit = a.sortie && isValidIso(a.sortie.date) ? dn(a.sortie.date) : Infinity;
    if (!(acq <= E.e && exit >= E.s)) return z;
    const row = s.rows.find((r) => r.year === year) || null;
    let prev = null; for (const r of s.rows) if (r.year < year) prev = r;
    const init = s.init || { gross: s.cost, cum: 0, prov: 0, surplus: 0 };
    const ss = row ? { g: row.gDebut, am: row.amDebut, pv: row.pvDebut, ec: row.ecartDebut }
      : prev ? { g: prev.gFin, am: prev.amFin, pv: prev.pvFin, ec: prev.ecartFin }
      : { g: init.gross, am: init.cum, pv: init.prov, ec: init.surplus };
    const es = row ? { g: row.gFin, am: row.amFin, pv: row.pvFin, ec: row.ecartFin } : (prev ? ss : (s.final && exit < Infinity && exit <= E.e && !s.rows.length ? { g: s.final.gross, am: s.final.cum, pv: s.final.prov, ec: s.final.surplus } : ss));
    const inStart = acq < E.s, acqIn = acq >= E.s, exitIn = exit <= E.e, inEnd = !exitIn;
    const v = Object.assign({}, z, { exists: true, row: row });
    v.vbDebut = inStart ? ss.g : 0;
    v.acquisitions = acqIn ? (row ? row.gDebut : init.gross) : 0;
    v.entrees = row ? r3(row.vbComplements + row.vbDem) : 0;
    v.reevaluations = row ? row.vbReeval : 0;
    v.sorties = exitIn ? es.g : 0;
    v.vbFin = inEnd ? es.g : 0;
    v.amDebutA = inStart ? ss.am : 0; v.pvDebut = inStart ? ss.pv : 0; v.amDebut = r3(v.amDebutA + v.pvDebut);
    v.dotation = row ? row.dot : 0;
    v.pertes = row ? row.pvDot : 0; v.reprisesPV = row ? row.pvRep : 0; v.pertesNettes = r3(v.pertes - v.reprisesPV);
    v.elim = row ? r3(row.amElim + row.pvElim) : 0;
    if (acqIn && row && (row.amDebut || row.pvDebut)) { v.amDebutA = 0; v.pvDebut = 0; v.amDebut = 0; v.elim = r3(v.elim - row.amDebut - row.pvDebut); }
    v.amSorties = exitIn ? r3(es.am + es.pv) : 0;
    v.amFinA = inEnd ? es.am : 0; v.pvFin = inEnd ? es.pv : 0; v.amFin = r3(v.amFinA + v.pvFin);
    v.vncFin = r3(v.vbFin - v.amFin);
    v.ecartDebut = inStart ? ss.ec : 0; v.ecartFin = inEnd ? es.ec : 0;
    if (row) Object.assign(v, { cap: row.cap, ded: row.ded, reint: row.reint, dedAnt: row.dedAnt, reintAutres: row.reintAutres, dedAutres: row.dedAutres, cumReint: row.cumReint, desact: row.desact, subQP: row.subQP });
    else if (prev) v.cumReint = prev.cumReint;
    return v;
  }

  /* ---------------- Sorties (NC 05 §75 à §81) ---------------- */
  function sortieCalc(a, cat, cfg, sortie) {
    const s = sortie || a.sortie;
    const tmp = Object.assign({}, a, { sortie: s });
    const sched = schedule(tmp, cat, cfg);
    const f = sched.final || sched.init || { gross: num(a.valeur), cum: 0, prov: 0, surplus: 0, fb: num(a.valeur), cumDed: 0, cumDotTotal: 0, provDem: 0, sub: 0 };
    const exitYear = exoOf(s.date, cfg);
    const rowExit = sched.rows.find((r) => r.year === exitYear) || null;
    const gross = r3(f.gross), cumul = r3(f.cum), prov = r3(f.prov);
    const vnc = r3(gross - cumul - prov);
    const prix = r3(num(s.prix)), indem = r3(num(s.indemnite));
    const produit = r3(prix + indem);
    const resCompta = r3(produit - vnc);
    const vp = sched.regime.raison === 'VP';
    const vncFiscal = r3(Math.max(0, vp ? f.fb - Math.min(f.fb, f.cumDotF) : f.fb - f.cumDed));
    const resFiscal = r3(produit - vncFiscal);
    return {
      date: s.date, base: gross, gross: gross, cumul: cumul, prov: prov, vnc: vnc, prix: prix, indemnite: indem, produit: produit,
      resCompta: resCompta, ecartVire: r3(f.surplus), subRest: r3(f.sub), provDem: r3(f.provDem),
      vncFiscal: vncFiscal, resFiscal: resFiscal, ajustFiscal: r3(resFiscal - resCompta), cumReint: r3(f.cumReint), vp: vp,
      dotComplementaire: rowExit ? rowExit.dot : 0, dedComplementaire: rowExit ? rowExit.ded : 0, exitYear: exitYear, sched: sched
    };
  }

  /* ---------------- Codification ---------------- */
  function codePrefix(soc, dateAcq, emp, cat) {
    const yy = String(dateAcq || '').slice(2, 4);
    return (String(soc || '').toUpperCase().padEnd(2, 'X').slice(0, 2) + yy + String(emp || '').padStart(2, '0').slice(-2) + String(cat || '').padStart(2, '0').slice(-2));
  }
  function nextCode(assets, prefix, scope, excludeId) {
    const match = (c) => {
      if (!c || c.length !== 11) return false;
      if (scope === 'global') return c.slice(0, 2) === prefix.slice(0, 2);
      if (scope === 'cat') return c.slice(0, 2) === prefix.slice(0, 2) && c.slice(6, 8) === prefix.slice(6, 8);
      return c.slice(0, 8) === prefix.slice(0, 8);
    };
    let max = 0;
    for (const a of assets) {
      if (excludeId && a.id === excludeId) continue;
      if (match(a.code)) { const k = parseInt(a.code.slice(8, 11), 10); if (k > max) max = k; }
    }
    if (max >= 999) return null;
    return prefix + String(max + 1).padStart(3, '0');
  }
  function fmtCode(code, sep) {
    if (!code) return '';
    if (!sep || code.length !== 11) return code;
    return [code.slice(0, 2), code.slice(2, 4), code.slice(4, 6), code.slice(6, 8), code.slice(8, 11)].join(sep);
  }
  function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function parseCode(code) {
    const c = normCode(code);
    if (c.length !== 11) return null;
    return { societe: c.slice(0, 2), annee: c.slice(2, 4), emplacement: c.slice(4, 6), categorie: c.slice(6, 8), compteur: c.slice(8, 11) };
  }

  /* ---------------- Écritures d'inventaire ---------------- */
  function catAccounts(cat) {
    const c = cat || {};
    return { immo: c.cptImmo || '22', amort: c.cptAmort || ('28' + sub1(c.cptImmo || '22')), prov: c.cptProv || ('29' + sub1(c.cptImmo || '22')), dot: c.cptDot === '6812' ? '6811' : (c.cptDot || '6811') };
  }
  function journal(assets, cats, cfg, year) {
    const K = comptesOf(cfg);
    const E = exo(year, cfg);
    const catOf = (code) => cats.find((c) => c.code === code);
    const entries = [];
    const groups = {};
    const add = (key, debit, credit, montant, lib) => {
      if (!(montant > 0.0005)) return;
      const k = key + '|' + debit + '|' + credit;
      groups[k] = groups[k] || { key: key, debit: debit, credit: credit, montant: 0, libs: new Set() };
      groups[k].montant = r3(groups[k].montant + montant); if (lib) groups[k].libs.add(lib);
    };
    const perAsset = [];
    for (const a of assets) {
      const cat = catOf(catAt(a, E.end)) || catOf(a.categorie);
      const ac = catAccounts(cat);
      const s = schedule(a, cat, cfg);
      const row = s.rows.find((r) => r.year === year);
      if (row) {
        const lib = cat ? cat.libelle : '';
        add('dot', ac.dot, ac.amort, row.dot, lib);
        add('perte', K.dotProv, ac.prov, row.perteCharge, lib);
        add('perteEcart', K.ecartReeval, ac.prov, row.perteEcart, lib);
        add('reprise', ac.prov, K.repriseProv, row.repriseProduit, lib);
        add('repriseEcart', ac.prov, K.ecartReeval, row.repriseEcart, lib);
        add('ecartVire', K.ecartReeval, K.resultatsReportes, row.ecartVire, lib);
        add('desact', K.desactualisation, K.provDemantelement, row.desact, lib);
        add('sub', K.subvention, K.quotePartSub, row.subQP, lib);
        row.events.forEach((ev) => {
          if (ev.type === 'reevaluation') perAsset.push({ a: a, ac: ac, ev: ev });
          if (ev.type === 'demantelement' && Math.abs(ev.delta) > 0.0005) perAsset.push({ a: a, ac: ac, ev: ev });
        });
      }
      if (a.sortie && isValidIso(a.sortie.date) && dn(a.sortie.date) >= E.s && dn(a.sortie.date) <= E.e) perAsset.push({ a: a, ac: ac, sortie: sortieCalc(a, cat, cfg) });
    }
    const LIB = {
      dot: 'Dotations aux amortissements', perte: 'Pertes de valeur (dépréciation)', perteEcart: 'Pertes de valeur imputées sur l\'écart de réévaluation',
      reprise: 'Reprises de pertes de valeur', repriseEcart: 'Reprises de pertes de valeur portées en écart de réévaluation', ecartVire: 'Virement de l\'écart de réévaluation réalisé',
      desact: 'Désactualisation des provisions pour démantèlement', sub: 'Quote-part des subventions d\'investissement virée au résultat'
    };
    ['dot', 'perte', 'perteEcart', 'reprise', 'repriseEcart', 'ecartVire', 'desact', 'sub'].forEach((key) => {
      const gs = Object.values(groups).filter((g) => g.key === key).sort((x, y) => (x.debit + x.credit).localeCompare(y.debit + y.credit));
      if (!gs.length) return;
      const lignes = [];
      gs.forEach((g) => {
        const l = Array.from(g.libs).join(', ');
        lignes.push({ compte: g.debit, libelle: LIB[key] + (l ? ' – ' + l : ''), debit: g.montant, credit: 0 });
        lignes.push({ compte: g.credit, libelle: LIB[key] + (l ? ' – ' + l : ''), debit: 0, credit: g.montant });
      });
      entries.push({ date: E.end, journal: 'OD', piece: cfg.pieceInventaire || (key.toUpperCase().slice(0, 4) + '-' + year), libelle: LIB[key] + ' – exercice ' + year, lignes: lignes });
    });
    perAsset.forEach((p) => {
      const a = p.a, ac = p.ac;
      if (p.ev && p.ev.type === 'reevaluation') {
        const ev = p.ev, l = [];
        if (ev.cumElimine > 0) l.push({ compte: ac.amort, libelle: 'Élimination des amortissements cumulés ' + a.code, debit: ev.cumElimine, credit: 0 });
        if (ev.provEliminee > 0) l.push({ compte: ac.prov, libelle: 'Élimination des pertes de valeur ' + a.code, debit: ev.provEliminee, credit: 0 });
        if (ev.cumElimine + ev.provEliminee > 0) l.push({ compte: ac.immo, libelle: 'Élimination contre la valeur brute ' + a.code, debit: 0, credit: r3(ev.cumElimine + ev.provEliminee) });
        if (ev.ecart >= 0) {
          if (ev.ecart > 0) l.push({ compte: ac.immo, libelle: 'Réévaluation à la juste valeur ' + a.code, debit: ev.ecart, credit: 0 });
          if (ev.hausse > 0) l.push({ compte: K.ecartReeval, libelle: 'Écart de réévaluation ' + a.code, debit: 0, credit: ev.hausse });
          if (ev.produit > 0) l.push({ compte: K.produitReeval, libelle: 'Reprise d\'une diminution antérieure ' + a.code, debit: 0, credit: ev.produit });
        } else {
          if (ev.imputation > 0) l.push({ compte: K.ecartReeval, libelle: 'Diminution imputée sur l\'écart ' + a.code, debit: ev.imputation, credit: 0 });
          if (ev.charge > 0) l.push({ compte: K.chargeReeval, libelle: 'Diminution de valeur en charge ' + a.code, debit: ev.charge, credit: 0 });
          l.push({ compte: ac.immo, libelle: 'Réévaluation à la juste valeur ' + a.code, debit: 0, credit: r3(-ev.ecart) });
        }
        if (l.length) entries.push({ date: ev.date, journal: 'OD', piece: ev.pieceCompta || ('REEV-' + a.code), libelle: 'Réévaluation – ' + a.code + ' – ' + (a.designation || ''), lignes: l });
      } else if (p.ev && p.ev.type === 'demantelement') {
        const ev = p.ev, l = [];
        if (ev.delta > 0) { l.push({ compte: ac.immo, libelle: 'Hausse de l\'estimation du démantèlement ' + a.code, debit: ev.delta, credit: 0 }); l.push({ compte: K.provDemantelement, libelle: 'Provision pour démantèlement ' + a.code, debit: 0, credit: ev.delta }); }
        else {
          const dec = r3(-ev.delta), toAsset = r3(Math.min(dec, Math.max(0, ev.ca)));
          l.push({ compte: K.provDemantelement, libelle: 'Baisse de l\'estimation du démantèlement ' + a.code, debit: dec, credit: 0 });
          if (toAsset > 0) l.push({ compte: ac.immo, libelle: 'Réduction du coût ' + a.code, debit: 0, credit: toAsset });
          if (dec - toAsset > 0.0005) l.push({ compte: K.produitDemantelement, libelle: 'Excédent en produit (§96) ' + a.code, debit: 0, credit: r3(dec - toAsset) });
        }
        entries.push({ date: ev.date, journal: 'OD', piece: ev.pieceCompta || ('DEM-' + a.code), libelle: 'Révision de la provision pour démantèlement – ' + a.code, lignes: l });
      } else if (p.sortie) {
        const sc = p.sortie, l = [];
        if (sc.cumul > 0) l.push({ compte: ac.amort, libelle: 'Annulation des amortissements ' + a.code, debit: sc.cumul, credit: 0 });
        if (sc.prov > 0) l.push({ compte: ac.prov, libelle: 'Annulation des pertes de valeur ' + a.code, debit: sc.prov, credit: 0 });
        if (sc.prix > 0) l.push({ compte: K.creanceCession, libelle: 'Prix de cession ' + a.code, debit: sc.prix, credit: 0 });
        if (sc.indemnite > 0) l.push({ compte: K.indemnite, libelle: 'Indemnité à recevoir ' + a.code, debit: sc.indemnite, credit: 0 });
        if (sc.resCompta < 0) l.push({ compte: K.cessionCharge, libelle: 'Charge nette sur sortie ' + a.code, debit: r3(-sc.resCompta), credit: 0 });
        l.push({ compte: ac.immo, libelle: 'Sortie ' + a.code + ' – ' + (a.designation || ''), debit: 0, credit: sc.gross });
        if (sc.resCompta > 0) l.push({ compte: K.cessionProduit, libelle: 'Produit net sur sortie ' + a.code, debit: 0, credit: sc.resCompta });
        if (sc.ecartVire > 0) { l.push({ compte: K.ecartReeval, libelle: 'Écart de réévaluation réalisé ' + a.code, debit: sc.ecartVire, credit: 0 }); l.push({ compte: K.resultatsReportes, libelle: 'Virement aux résultats reportés (§40)', debit: 0, credit: sc.ecartVire }); }
        if (sc.subRest > 0) { l.push({ compte: K.subvention, libelle: 'Solde de subvention ' + a.code, debit: sc.subRest, credit: 0 }); l.push({ compte: K.quotePartSub, libelle: 'Solde de subvention viré au résultat', debit: 0, credit: sc.subRest }); }
        entries.push({ date: a.sortie.date, journal: 'OD', piece: a.sortie.pieceCompta || a.sortie.piece || ('SOR-' + a.code), libelle: (a.sortie.type || 'Sortie') + ' – ' + a.code, lignes: l });
      }
    });
    return entries;
  }

  /* ---------------- Inventaire physique ---------------- */
  function inventoryResults(inv, assets) {
    const scope = inv.emplacements && inv.emplacements.length ? new Set(inv.emplacements) : null;
    const invDn = inv.date && isValidIso(inv.date) ? dn(inv.date) : Infinity;
    const active = assets.filter((a) => {
      if (a.dateAcq && isValidIso(a.dateAcq) && dn(a.dateAcq) > invDn) return false;
      if (a.sortie && a.sortie.date && dn(a.sortie.date) <= invDn) return false;
      return true;
    });
    const lignes = inv.lignes || {};
    const conformes = [], malLocalises = [], manquants = [], degrades = [];
    for (const a of active) {
      const l = lignes[a.id];
      const expected = !scope || scope.has(a.emplacement);
      if (l && l.trouve) {
        if (l.emp && l.emp !== a.emplacement) malLocalises.push({ a: a, l: l }); else conformes.push({ a: a, l: l });
        if (l.etat && ['Mauvais', 'Hors service', 'Temporairement inutilisé'].indexOf(l.etat) >= 0) degrades.push({ a: a, l: l });
      } else if (expected) manquants.push({ a: a, l: l || null });
    }
    const attendus = active.filter((a) => !scope || scope.has(a.emplacement)).length;
    const trouves = conformes.length + malLocalises.length;
    return {
      attendus: attendus, trouves: trouves, conformes: conformes, malLocalises: malLocalises,
      manquants: manquants, degrades: degrades, inconnus: inv.inconnus || [],
      taux: attendus ? Math.min(1, (conformes.length + malLocalises.filter((x) => !scope || scope.has(x.a.emplacement)).length) / attendus) : 0
    };
  }

  /* ---------------- Hachage des mots de passe (SHA-256 itéré) ---------------- */
  function sha256(ascii) {
    function rr(v, n) { return (v >>> n) | (v << (32 - n)); }
    const maxWord = Math.pow(2, 32);
    let result = '';
    const words = [];
    const asciiBitLength = ascii.length * 8;
    if (!sha256.K) {
      const hh = [], kk = []; let pc = 0; const isComposite = {};
      for (let candidate = 2; pc < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hh[pc] = (Math.pow(candidate, 0.5) * maxWord) | 0;
          kk[pc++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
        }
      }
      sha256.H0 = hh; sha256.K = kk;
    }
    const k = sha256.K;
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) { const j = ascii.charCodeAt(i); if (j >> 8) return null; words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    let H = sha256.H0.slice(0, 8);
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = H;
      H = H.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = H[0], e = H[4];
        const temp1 = H[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & H[5]) ^ ((~e) & H[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        const temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & H[1]) ^ (a & H[2]) ^ (H[1] & H[2]));
        H = [(temp1 + temp2) | 0].concat(H);
        H[4] = (H[4] + temp1) | 0;
        H.length = 8;
      }
      for (let i = 0; i < 8; i++) H[i] = (H[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) { const b = (H[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }
  function utf8(s) { return unescape(encodeURIComponent(String(s))); }
  function hashPassword(pwd, salt) { let h = sha256(utf8(salt + '::' + pwd)); for (let i = 0; i < 5000; i++) h = sha256(h + salt); return h; }
  function randomSalt() {
    const a = new Uint8Array(12);
    (root.crypto || require('crypto').webcrypto).getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const API = {
    r3, num, has, fmtNum, fmtPct, fmtYears, normYears, pad2, dn, iso, isoFrom, ymd, dim, fmtDate, today, isValidIso, parseUserDate, addMonthsDn,
    exo, exoOf, exoLabel, fraction, monthsFrac, days360,
    DEFAULT_FISCAL, DEFAULT_COMPTES, DEFAULT_CATEGORIES, DEFAULT_SORTIES, DEFAULT_ETATS, MODES, REGIMES, ENTREES, EVENT_TYPES, INDICES,
    fiscalOf, comptesOf, upgradeCategory, degCoef, coefEquipes, catDuration, durationOf, fiscalYears, fiscalBaseOf, fiscalRegime,
    eventsOf, dcf, recoverable, schedule, stateAt, catAt, garantieFin, yearValues, sortieCalc, catAccounts,
    codePrefix, nextCode, fmtCode, normCode, parseCode, journal, inventoryResults,
    sha256, hashPassword, randomSalt
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Engine = API;
})(typeof window !== 'undefined' ? window : globalThis);
