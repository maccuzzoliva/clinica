'use strict';
/* Clinica Pazienti – versione web installabile (iPhone / Android / PC).
   Stesso database, stessi utenti e stessi permessi dell'app Android. */

const CFG = window.CONFIG;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
const DOMINIO = 'clinica.local';
const MODULI = [
  ['pazienti', 'Anagrafica pazienti'], ['clinica', 'Anamnesi e note cliniche'], ['foto', 'Foto prima/dopo'],
  ['agenda', 'Agenda'], ['listino', 'Listino'], ['conti', 'Preventivi e pagamenti'], ['eliminazione', 'Eliminare dati']
];

/* ---------- utilità ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = v => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(+v || 0);
const num = s => parseFloat(String(s ?? '').trim().replace(',', '.')) || 0;
const pad = n => String(n).padStart(2, '0');
const fData = d => d ? new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('it-IT') : '';
const fDataOra = d => d ? new Date(d).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
const oggiISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoData = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoOra = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fobj = f => Object.fromEntries(new FormData(f));

let me = null;
const S = { pazienti: [], appuntamenti: [], listino: [], utenti: [] };

const can = (m, edit = false) => {
  if (!me || !me.attivo) return false;
  if (me.ruolo === 'admin') return true;
  const v = (me.permessi || {})[m] || 'none';
  return edit ? v === 'edit' : (v === 'view' || v === 'edit');
};

/* esegue una chiamata Supabase e lancia un errore leggibile */
async function q(p) {
  const { data, error } = await p;
  if (error) {
    const m = error.message || String(error);
    if (/row-level security|permission denied/i.test(m)) throw new Error('Non hai il permesso per questa operazione.');
    throw new Error(m);
  }
  return data;
}
const log = (azione, dettaglio = '') => { sb.from('registro').insert({ azione, dettaglio }).then(() => {}, () => {}); };

let occupato = 0;
function busy(on) { occupato += on ? 1 : -1; $('#busy').hidden = occupato <= 0; }
async function ok(fn) {
  busy(true);
  try { return await fn(); }
  catch (e) { avviso('Attenzione', e.message || String(e)); }
  finally { busy(false); }
}

function modal(html, wide = false) {
  const m = $('#modal');
  m.innerHTML = `<div class="box${wide ? ' wide' : ''}">${html}</div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m) chiudi(); };
}
function chiudi() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function avviso(t, msg) {
  modal(`<h2>${esc(t)}</h2><p>${esc(msg)}</p><div class="row"><button class="b" id="mk">OK</button></div>`);
  $('#mk').onclick = chiudi;
}
function conferma(t, msg, onOk) {
  modal(`<h2>${esc(t)}</h2><p>${esc(msg)}</p><div class="row"><button class="b d" id="mok">Conferma</button><button class="b o" id="mno">Annulla</button></div>`);
  $('#mno').onclick = chiudi;
  $('#mok').onclick = () => { chiudi(); onOk(); };
}

const go = h => { location.hash = h; };
function indietro() { if (history.length > 1) history.back(); else go('#/pazienti'); }

/* ---------- componenti HTML ---------- */
const campo = (et, nome, val = '', tipo = 'text', extra = '') =>
  `<label class="f">${esc(et)}<input type="${tipo}" name="${nome}" value="${esc(val)}" ${extra}></label>`;
const area = (et, nome, val = '') => `<label class="f">${esc(et)}<textarea name="${nome}">${esc(val)}</textarea></label>`;
const scelta = (nome, opzioni, sel) =>
  `<div class="chips">${opzioni.map(o => `<label><input type="radio" name="${nome}" value="${esc(o)}" ${o === sel ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div>`;
const kv = (e, v) => `<div class="kv"><span>${esc(e)}</span><span>${v}</span></div>`;

function schermo({ titolo, back = false, azioni = '', nav = null, body }) {
  const navi = nav ? `<nav class="bar"><div>
    <a href="#/pazienti" class="${nav === 'pazienti' ? 'on' : ''}"><b>👥</b>Pazienti</a>
    ${can('agenda') ? `<a href="#/agenda" class="${nav === 'agenda' ? 'on' : ''}"><b>📅</b>Agenda</a>` : ''}
    ${can('listino') ? `<a href="#/listino" class="${nav === 'listino' ? 'on' : ''}"><b>💶</b>Listino</a>` : ''}
    ${me.ruolo === 'admin' ? `<a href="#/utenti" class="${nav === 'utenti' ? 'on' : ''}"><b>🔑</b>Utenti</a>` : ''}
    <button id="esci"><b style="display:block;font-size:20px">⎋</b>Esci</button></div></nav>` : '';
  $('#app').innerHTML = `<header class="top">${back ? '<button class="ic" id="bk" aria-label="Indietro">←</button>' : '<img class="logo" src="icons/icon-192.png" alt="">'}
    <h1>${esc(titolo)}</h1><div>${azioni}</div></header><main>${body}</main>${navi}`;
  if (back) $('#bk').onclick = indietro;
  const e = $('#esci'); if (e) e.onclick = () => conferma('Uscire?', 'Dovrai rifare l\'accesso.', esci);
  window.scrollTo(0, 0);
}

/* ---------- accesso ---------- */
function vistaLogin(msg = '') {
  $('#app').innerHTML = `<div class="login"><img src="icons/icon-192.png" alt=""><h1>Clinica Pazienti</h1>
    <form id="lf" autocomplete="on">
      <label class="f">Nome utente<input name="u" autocomplete="username" autocapitalize="none" autocorrect="off" required></label>
      <label class="f">Password<input name="p" type="password" autocomplete="current-password" required></label>
      <div class="err" id="le">${esc(msg)}</div>
      <button class="b" style="width:100%;margin-top:6px">Accedi</button></form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const d = fobj(e.target);
    busy(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: `${d.u.trim().toLowerCase()}@${DOMINIO}`, password: d.p });
      if (error) throw new Error(/invalid login/i.test(error.message) ? 'Nome utente o password errati.' : error.message);
      await entra();
    } catch (err) { $('#le').textContent = err.message; }
    finally { busy(false); }
  };
}

async function entra() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return vistaLogin();
  const p = await q(sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
  if (!p) { await esci(); return vistaLogin('Profilo non trovato: contatta l\'amministratore.'); }
  if (!p.attivo) { await esci(); return vistaLogin('Utenza disattivata. Contatta l\'amministratore.'); }
  me = p;
  await caricaTutto();
  if (!location.hash || location.hash === '#/') location.hash = '#/pazienti';
  render();
}

async function esci() {
  me = null; S.pazienti = []; S.appuntamenti = []; S.listino = []; S.utenti = [];
  try { await sb.auth.signOut(); } catch (_) { /* ignora */ }
  location.hash = '';
  vistaLogin();
}

async function caricaTutto() {
  const job = [];
  job.push(q(sb.from('pazienti').select('*').order('cognome').order('nome')).then(d => S.pazienti = d || []));
  if (can('agenda')) job.push(q(sb.from('appuntamenti').select('*').order('inizio')).then(d => S.appuntamenti = d || []));
  if (can('listino') || can('conti') || can('agenda')) job.push(q(sb.from('listino').select('*').order('categoria').order('nome')).then(d => S.listino = d || []).catch(() => {}));
  if (me.ruolo === 'admin') job.push(q(sb.from('profiles').select('*').order('username')).then(d => S.utenti = d || []));
  await Promise.all(job);
}
const nomePaz = id => { const p = S.pazienti.find(x => x.id === id); return p ? `${p.cognome} ${p.nome}`.trim() : '—'; };

/* ---------- router ---------- */
const VISTE = {};
async function render() {
  if (!me) return;
  const [nome, ...a] = (location.hash.replace(/^#\//, '') || 'pazienti').split('/').map(decodeURIComponent);
  const v = VISTE[nome] || VISTE.pazienti;
  try { await v(...a); } catch (e) { avviso('Attenzione', e.message || String(e)); }
}
window.addEventListener('hashchange', () => { chiudi(); render(); });

/* ---------- PAZIENTI ---------- */
VISTE.pazienti = async () => {
  schermo({
    titolo: 'Pazienti', nav: 'pazienti',
    body: `<input id="cerca" type="search" placeholder="Cerca per nome o telefono" style="margin:0 0 6px"><div class="list" id="lista"></div>
      ${can('pazienti', true) ? '<button class="fab" id="nuovo" aria-label="Nuovo paziente">+</button>' : ''}`
  });
  const disegna = () => {
    const t = $('#cerca').value.trim().toLowerCase();
    const l = S.pazienti.filter(p => !t || `${p.cognome} ${p.nome} ${p.telefono || ''}`.toLowerCase().includes(t));
    $('#lista').innerHTML = l.length ? l.map(p => `<a class="it" href="#/paziente/${p.id}"><b>${esc(p.cognome)} ${esc(p.nome)}</b><br><small>${esc(p.telefono || '')}</small></a>`).join('')
      : '<p class="m">Nessun paziente</p>';
  };
  $('#cerca').oninput = disegna; disegna();
  if ($('#nuovo')) $('#nuovo').onclick = () => go('#/pform/new');
};

VISTE.pform = async id => {
  const nuovo = id === 'new';
  const p = nuovo ? {} : S.pazienti.find(x => x.id === id) || {};
  schermo({
    titolo: nuovo ? 'Nuovo paziente' : 'Modifica paziente', back: true,
    body: `<form id="f">
      ${campo('Cognome', 'cognome', p.cognome, 'text', 'required')}${campo('Nome', 'nome', p.nome, 'text', 'required')}
      ${campo('Data di nascita', 'data_nascita', p.data_nascita || '', 'date')}
      <label class="f">Sesso${scelta('sesso', ['F', 'M', 'Altro'], p.sesso || '')}</label>
      ${campo('Codice fiscale', 'codice_fiscale', p.codice_fiscale, 'text', 'autocapitalize="characters"')}
      ${campo('Telefono', 'telefono', p.telefono, 'tel')}${campo('Email', 'email', p.email, 'email')}${campo('Indirizzo', 'indirizzo', p.indirizzo)}
      <label class="chk"><input type="checkbox" name="consenso_privacy" ${p.consenso_privacy ? 'checked' : ''}>Informativa privacy (GDPR) firmata</label>
      <label class="chk"><input type="checkbox" name="consenso_informato" ${p.consenso_informato ? 'checked' : ''}>Consenso informato firmato</label>
      ${campo('Data del consenso', 'consenso_data', p.consenso_data || '', 'date')}
      <div class="row"><button class="b">Salva</button></div></form>`
  });
  $('#f').onsubmit = e => {
    e.preventDefault();
    const d = fobj(e.target);
    const rec = {
      nome: d.nome.trim(), cognome: d.cognome.trim(), data_nascita: d.data_nascita || null, sesso: d.sesso || '',
      codice_fiscale: (d.codice_fiscale || '').trim().toUpperCase(), telefono: (d.telefono || '').trim(), email: (d.email || '').trim(),
      indirizzo: (d.indirizzo || '').trim(), consenso_privacy: !!d.consenso_privacy, consenso_informato: !!d.consenso_informato,
      consenso_data: d.consenso_informato ? (d.consenso_data || oggiISO()) : (d.consenso_data || null)
    };
    ok(async () => {
      let pid = id;
      if (nuovo) { const r = await q(sb.from('pazienti').insert(rec).select().single()); pid = r.id; log('crea_paziente', pid); }
      else { await q(sb.from('pazienti').update(rec).eq('id', id)); log('modifica_paziente', id); }
      S.pazienti = await q(sb.from('pazienti').select('*').order('cognome').order('nome'));
      history.replaceState(null, '', `#/paziente/${pid}`); render();
    });
  };
};

VISTE.paziente = async (id, tab = 'scheda') => {
  const pz = S.pazienti.find(x => x.id === id);
  if (!pz) return schermo({ titolo: 'Paziente', back: true, body: '<p>Paziente non trovato</p>' });
  const tabs = [['scheda', 'Scheda']];
  if (can('clinica')) tabs.push(['clinica', 'Clinica']);
  if (can('foto')) tabs.push(['foto', 'Foto']);
  if (can('conti')) tabs.push(['conti', 'Conti']);
  if (!tabs.some(t => t[0] === tab)) tab = 'scheda';
  schermo({
    titolo: `${pz.cognome} ${pz.nome}`, back: true, azioni: '<button class="t" id="pdf">PDF / Stampa</button>',
    body: `${tabs.length > 1 ? `<div class="tabs">${tabs.map(t => `<a class="${t[0] === tab ? 'on' : ''}" href="#/paziente/${id}/${t[0]}" replace>${t[1]}</a>`).join('')}</div>` : ''}<div id="tc"></div>`
  });
  $('#pdf').onclick = () => ok(() => stampa(id));
  log('apri_paziente', id);
  await ({ scheda: tabScheda, clinica: tabClinica, foto: tabFoto, conti: tabConti }[tab])(pz);
};

function tabScheda(pz) {
  $('#tc').innerHTML = `${kv('Data di nascita', esc(fData(pz.data_nascita)))}${kv('Sesso', esc(pz.sesso))}${kv('Codice fiscale', esc(pz.codice_fiscale))}
    ${kv('Telefono', pz.telefono ? `<a href="tel:${esc(pz.telefono)}">${esc(pz.telefono)}</a>` : '')}${kv('Email', esc(pz.email))}${kv('Indirizzo', esc(pz.indirizzo))}
    ${kv('Privacy (GDPR)', pz.consenso_privacy ? 'Informativa firmata' : '<span class="warn">NON firmata</span>')}
    ${kv('Consenso informato', pz.consenso_informato ? 'Firmato il ' + esc(fData(pz.consenso_data)) : '<span class="warn">NON firmato</span>')}
    <div class="row">
      ${can('pazienti', true) ? `<a class="b o" href="#/pform/${pz.id}">Modifica</a>` : ''}
      ${can('agenda', true) ? `<a class="b o" href="#/app/new/${pz.id}">Appuntamento</a>` : ''}
      ${can('eliminazione', true) ? '<button class="b d" id="del">Elimina paziente</button>' : ''}</div>`;
  const d = $('#del');
  if (d) d.onclick = () => conferma('Eliminare il paziente?', 'Verranno eliminati anche note, foto, preventivi e pagamenti. Non si può annullare.', () => ok(async () => {
    const f = await q(sb.from('foto').select('percorso').eq('paziente_id', pz.id)).catch(() => []);
    if (f.length) await sb.storage.from('foto-pazienti').remove(f.map(x => x.percorso));
    await q(sb.from('pazienti').delete().eq('id', pz.id));
    log('elimina_paziente', pz.id);
    S.pazienti = S.pazienti.filter(x => x.id !== pz.id);
    history.replaceState(null, '', '#/pazienti'); render();
  }));
}

/* ---------- CLINICA ---------- */
async function tabClinica(pz) {
  const id = pz.id, mod = can('clinica', true);
  const [an, note] = await Promise.all([
    q(sb.from('anamnesi').select('*').eq('paziente_id', id)),
    q(sb.from('note_cliniche').select('*').eq('paziente_id', id).order('creato_il', { ascending: false }))
  ]);
  const a = an[0] || {};
  const dis = mod ? '' : 'disabled';
  $('#tc').innerHTML = `<h3 style="margin-top:0">Anamnesi</h3>
    <form id="fa">${area('Allergie', 'allergie', a.allergie).replace('<textarea', `<textarea ${dis}`)}
      ${area('Farmaci in corso', 'farmaci', a.farmaci).replace('<textarea', `<textarea ${dis}`)}
      ${area('Patologie', 'patologie', a.patologie).replace('<textarea', `<textarea ${dis}`)}
      <label class="f">Fumo${scelta('fumatore', ['No', 'Ex', 'Sì'], a.fumatore || '')}</label>
      ${mod ? '<div class="row"><button class="b">Salva anamnesi</button></div>' : ''}</form>
    <h3>Note cliniche</h3>
    ${mod ? `<form id="fn">${area('Nuova nota', 'testo')}<div class="row"><button class="b" id="addn" disabled>Aggiungi nota</button></div></form>` : ''}
    ${note.length ? note.map(n => `<div class="card"><div class="m">${esc(fDataOra(n.creato_il))} · ${esc(n.autore_nome)}</div>
      <div>${esc(n.testo).replace(/\n/g, '<br>')}</div>
      ${can('eliminazione', true) ? `<button class="t d" data-del="${n.id}">Elimina</button>` : ''}</div>`).join('') : '<p class="m">Nessuna nota</p>'}`;
  if (mod) {
    $('#fa').onsubmit = e => {
      e.preventDefault(); const d = fobj(e.target);
      ok(async () => {
        await q(sb.from('anamnesi').upsert({ paziente_id: id, allergie: d.allergie.trim(), farmaci: d.farmaci.trim(), patologie: d.patologie.trim(), fumatore: d.fumatore || '' }, { onConflict: 'paziente_id' }));
        log('modifica_anamnesi', id); avviso('Fatto', 'Anamnesi salvata.');
      });
    };
    const ta = $('#fn textarea');
    ta.oninput = () => { $('#addn').disabled = !ta.value.trim(); };
    $('#fn').onsubmit = e => {
      e.preventDefault();
      ok(async () => {
        await q(sb.from('note_cliniche').insert({ paziente_id: id, testo: ta.value.trim(), autore_nome: me.nome || me.username }));
        log('nuova_nota', id); await tabClinica(pz);
      });
    };
  }
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () =>
    conferma('Eliminare la nota?', 'L\'operazione non si può annullare.', () => ok(async () => {
      await q(sb.from('note_cliniche').delete().eq('id', b.dataset.del)); await tabClinica(pz);
    })));
}

/* ---------- FOTO ---------- */
function preparaJpeg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const f = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('Immagine non leggibile')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Immagine non leggibile')); };
    img.src = url;
  });
}
async function urlFoto(foto) {
  if (!foto.length) return {};
  const { data, error } = await sb.storage.from('foto-pazienti').createSignedUrls(foto.map(f => f.percorso), 3600);
  if (error) throw new Error(error.message);
  const m = {}; (data || []).forEach(x => { if (x.signedUrl) m[x.path] = x.signedUrl; });
  return m;
}
async function tabFoto(pz) {
  const id = pz.id, mod = can('foto', true);
  const foto = await q(sb.from('foto').select('*').eq('paziente_id', id).order('creato_il', { ascending: false }));
  const urls = await urlFoto(foto);
  $('#tc').innerHTML = `${mod ? `<h3 style="margin-top:0">Nuova foto</h3>${scelta('etichetta', ['Prima', 'Dopo', 'Controllo'], 'Prima')}
    <div class="row"><label class="b" for="cam">Scatta / Galleria</label></div>
    <input type="file" id="cam" accept="image/*" hidden>` : ''}
    <div id="cmp"></div>
    ${foto.length ? '' : '<p class="m">Nessuna foto</p>'}
    <div class="grid2" style="margin-top:12px">${foto.map(f => `<div class="ph"><img src="${esc(urls[f.percorso] || '')}" data-big="${esc(urls[f.percorso] || '')}" alt="${esc(f.etichetta)}">
      <b>${esc(f.etichetta)}</b><br><span class="m">${esc(fDataOra(f.creato_il))}</span>
      <label class="chk"><input type="checkbox" data-sel="${f.id}">Confronta</label>
      ${can('eliminazione', true) ? `<button class="t d" data-del="${f.id}">Elimina</button>` : ''}</div>`).join('')}</div>`;
  if (mod) {
    $('#cam').onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      const et = ($('#tc input[name=etichetta]:checked') || {}).value || 'Prima';
      ok(async () => {
        const blob = await preparaJpeg(file);
        const percorso = `${id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from('foto-pazienti').upload(percorso, blob, { contentType: 'image/jpeg' });
        if (error) throw new Error(error.message);
        await q(sb.from('foto').insert({ paziente_id: id, percorso, etichetta: et }));
        log('carica_foto', id); await tabFoto(pz);
      });
    };
  }
  document.querySelectorAll('[data-big]').forEach(i => i.onclick = () => {
    if (!i.dataset.big) return;
    modal(`<img src="${esc(i.dataset.big)}" alt=""><div class="row"><button class="b" id="mk">Chiudi</button></div>`, true);
    $('#mk').onclick = chiudi;
  });
  const sel = [];
  document.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => {
    if (c.checked) { sel.push(c); if (sel.length > 2) { sel.shift().checked = false; } }
    else sel.splice(sel.indexOf(c), 1);
    const g = $('#cmp');
    if (sel.length === 2) {
      g.innerHTML = '<div class="row"><button class="b" id="cf" style="width:100%">Confronta le 2 foto selezionate</button></div>';
      $('#cf').onclick = () => {
        const u = sel.map(s => urls[(foto.find(f => f.id === s.dataset.sel) || {}).percorso]);
        modal(`<div class="grid2"><img src="${esc(u[0])}" alt=""><img src="${esc(u[1])}" alt=""></div><div class="row"><button class="b" id="mk">Chiudi</button></div>`, true);
        $('#mk').onclick = chiudi;
      };
    } else g.innerHTML = '';
  });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () =>
    conferma('Eliminare la foto?', 'L\'operazione non si può annullare.', () => ok(async () => {
      const f = foto.find(x => x.id === b.dataset.del);
      await sb.storage.from('foto-pazienti').remove([f.percorso]);
      await q(sb.from('foto').delete().eq('id', f.id));
      log('elimina_foto', id); await tabFoto(pz);
    })));
}

/* ---------- CONTI ---------- */
const totPrev = p => (p.voci || []).reduce((s, v) => s + (+v.prezzo || 0) * (+v.qta || 1), 0) - (+p.sconto || 0);
async function tabConti(pz) {
  const id = pz.id, mod = can('conti', true);
  const [prev, pag] = await Promise.all([
    q(sb.from('preventivi').select('*').eq('paziente_id', id).order('creato_il', { ascending: false })),
    q(sb.from('pagamenti').select('*').eq('paziente_id', id).order('creato_il', { ascending: false }))
  ]);
  const acc = prev.filter(p => p.stato === 'Accettato').reduce((s, p) => s + totPrev(p), 0);
  const pagato = pag.reduce((s, p) => s + (+p.importo || 0), 0);
  $('#tc').innerHTML = `<div class="card" style="margin-top:0">${kv('Accettato', euro(acc))}${kv('Pagato', euro(pagato))}<div style="padding-top:8px"><b>Residuo: ${euro(acc - pagato)}</b></div></div>
    <h3>Preventivi</h3>${mod ? `<a class="b o" href="#/prev/${id}/new">Nuovo preventivo</a>` : ''}
    ${prev.length ? prev.map(p => `<a class="card" style="display:block;color:inherit;text-decoration:none" href="#/prev/${id}/${p.id}">
      <div class="m">${esc(fData(p.creato_il))} · ${esc(p.stato)}</div><b>${euro(totPrev(p))}</b><div>${esc((p.voci || []).map(v => v.nome).join(', '))}</div></a>`).join('') : '<p class="m">Nessun preventivo</p>'}
    <h3>Pagamenti</h3>
    ${mod ? `<form id="fp">${campo('Importo (€)', 'importo', '', 'text', 'inputmode="decimal" required')}
      <label class="f">Metodo${scelta('metodo', ['Contanti', 'Carta', 'Bonifico', 'Altro'], 'Contanti')}</label>${campo('Nota', 'nota')}
      <div class="row"><button class="b">Registra pagamento</button></div></form>` : ''}
    ${pag.length ? pag.map(p => `<div class="kv"><span><span class="m">${esc(fData(p.creato_il))} · ${esc(p.metodo)}</span><br>${euro(p.importo)}${p.nota ? `<br><small class="m">${esc(p.nota)}</small>` : ''}</span>
      ${can('eliminazione', true) ? `<button class="t d" data-del="${p.id}">Elimina</button>` : ''}</div>`).join('') : '<p class="m">Nessun pagamento</p>'}`;
  if (mod) $('#fp').onsubmit = e => {
    e.preventDefault(); const d = fobj(e.target), v = num(d.importo);
    if (v <= 0) return avviso('Attenzione', 'Inserisci un importo maggiore di zero.');
    ok(async () => {
      await q(sb.from('pagamenti').insert({ paziente_id: id, importo: v, metodo: d.metodo || 'Contanti', nota: (d.nota || '').trim() }));
      log('pagamento', id); await tabConti(pz);
    });
  };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () =>
    conferma('Eliminare il pagamento?', 'L\'operazione non si può annullare.', () => ok(async () => {
      await q(sb.from('pagamenti').delete().eq('id', b.dataset.del)); await tabConti(pz);
    })));
}

VISTE.prev = async (pazId, id) => {
  const nuovo = id === 'new';
  let ex = null;
  if (!nuovo) ex = await q(sb.from('preventivi').select('*').eq('id', id).maybeSingle());
  const P = { voci: (ex?.voci || []).map(v => ({ nome: v.nome, prezzo: String(v.prezzo), qta: String(v.qta) })), sconto: ex && +ex.sconto ? String(ex.sconto) : '', stato: ex?.stato || 'Bozza' };
  const mod = can('conti', true);
  schermo({
    titolo: nuovo ? 'Nuovo preventivo' : 'Preventivo', back: true,
    body: `${mod ? `<label class="f">Aggiungi dal listino<select id="dl"><option value="">Scegli…</option>
      ${S.listino.filter(l => l.attivo).map(l => `<option value="${l.id}">${esc(l.nome)} · ${euro(l.prezzo)}</option>`).join('')}<option value="libera">Voce libera</option></select></label>` : ''}
      <div id="voci"></div>${campo('Sconto €', 'sconto', P.sconto, 'text', 'id="sc" inputmode="decimal"')}
      <label class="f">Stato${scelta('stato', ['Bozza', 'Accettato', 'Rifiutato'], P.stato)}</label>
      <h3 id="tot"></h3><div class="row"><button class="b" id="sv">Salva</button><button class="b o" id="sh">Condividi</button></div>`
  });
  const voci = () => P.voci.filter(v => v.nome.trim()).map(v => ({ nome: v.nome.trim(), prezzo: num(v.prezzo), qta: Math.max(1, parseInt(v.qta) || 1) }));
  const totale = () => voci().reduce((s, v) => s + v.prezzo * v.qta, 0) - num($('#sc').value);
  const agg = () => { $('#tot').textContent = 'Totale: ' + euro(totale()); };
  const disegna = () => {
    $('#voci').innerHTML = P.voci.map((v, i) => `<div class="card"><label class="f" style="margin-top:0">Voce<input data-i="${i}" data-k="nome" value="${esc(v.nome)}"></label>
      <div class="grid2"><label class="f">Prezzo €<input data-i="${i}" data-k="prezzo" inputmode="decimal" value="${esc(v.prezzo)}"></label>
      <label class="f">Qtà<input data-i="${i}" data-k="qta" inputmode="numeric" value="${esc(v.qta)}"></label></div>
      <button class="t d" data-rm="${i}">Rimuovi voce</button></div>`).join('');
    document.querySelectorAll('#voci input').forEach(inp => inp.oninput = () => { P.voci[+inp.dataset.i][inp.dataset.k] = inp.value; agg(); });
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { P.voci.splice(+b.dataset.rm, 1); disegna(); agg(); });
  };
  disegna(); agg();
  $('#sc').oninput = agg;
  if (mod) $('#dl').onchange = e => {
    const l = S.listino.find(x => x.id === e.target.value);
    P.voci.push(l ? { nome: l.nome, prezzo: String(l.prezzo), qta: '1' } : { nome: '', prezzo: '', qta: '1' });
    e.target.value = ''; disegna(); agg();
  };
  $('#sv').disabled = !mod;
  $('#sv').onclick = () => {
    const rec = { paziente_id: pazId, voci: voci(), sconto: num($('#sc').value), stato: ($('input[name=stato]:checked') || {}).value || 'Bozza' };
    if (!rec.voci.length) return avviso('Attenzione', 'Aggiungi almeno una voce.');
    ok(async () => {
      if (nuovo) await q(sb.from('preventivi').insert(rec)); else await q(sb.from('preventivi').update(rec).eq('id', id));
      log('preventivo', pazId); history.back();
    });
  };
  $('#sh').onclick = async () => {
    const v = voci(); if (!v.length) return;
    const sc = num($('#sc').value);
    const t = `Preventivo per ${nomePaz(pazId)}\n` + v.map(x => `- ${x.nome} x${x.qta}: ${euro(x.prezzo * x.qta)}`).join('\n') + (sc > 0 ? `\nSconto: ${euro(sc)}` : '') + `\nTotale: ${euro(totale())}`;
    try { if (navigator.share) await navigator.share({ text: t }); else { await navigator.clipboard.writeText(t); avviso('Copiato', 'Testo copiato negli appunti.'); } } catch (_) { /* annullato */ }
  };
};

/* ---------- AGENDA ---------- */
let agFiltro = 'Prossimi';
VISTE.agenda = async () => {
  schermo({
    titolo: 'Agenda', nav: 'agenda',
    body: `<div class="chips" id="flt">${['Oggi', 'Prossimi', 'Tutti'].map(o => `<label><input type="radio" name="f" value="${o}" ${o === agFiltro ? 'checked' : ''}>${o}</label>`).join('')}</div>
      <div class="list" id="lista" style="margin-top:8px"></div>${can('agenda', true) ? '<button class="fab" id="nuovo" aria-label="Nuovo appuntamento">+</button>' : ''}`
  });
  const disegna = () => {
    const oggi = oggiISO();
    const l = S.appuntamenti.filter(a => {
      const d = isoData(new Date(a.inizio));
      return agFiltro === 'Oggi' ? d === oggi : agFiltro === 'Prossimi' ? d >= oggi && a.stato !== 'Annullato' : true;
    });
    $('#lista').innerHTML = l.length ? l.map(a => `<a class="it" href="#/app/${a.id}"><span class="over">${esc(fDataOra(a.inizio))} · ${a.durata_min} min · ${esc(a.stato)}</span><br>
      <b>${esc(nomePaz(a.paziente_id))}</b><br><small>${esc([a.tipo, a.trattamento].filter(Boolean).join(' · '))}</small></a>`).join('') : '<p class="m">Nessun appuntamento</p>';
  };
  document.querySelectorAll('#flt input').forEach(i => i.onchange = () => { agFiltro = i.value; disegna(); });
  disegna();
  if ($('#nuovo')) $('#nuovo').onclick = () => go('#/app/new');
};

/* ---------- CALENDARIO ---------- */
const iniziali = id => nomePaz(id).split(/\s+/).filter(Boolean).map(x => x[0].toUpperCase() + '.').join('');
const utcStamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const nomeCogn = id => { const p = S.pazienti.find(x => x.id === id); return p ? `${p.nome} ${p.cognome}`.trim() : ''; };
function datiCal(a) {
  const fine = new Date(new Date(a.inizio).getTime() + (a.durata_min || 30) * 60000);
  return {
    titolo: [nomeCogn(a.paziente_id), a.tipo || 'Appuntamento', a.trattamento].filter(Boolean).join(' - '),
    note: a.note || '',
    inizio: utcStamp(a.inizio), fine: utcStamp(fine)
  };
}
function gcalLink(a) {
  const c = datiCal(a);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(c.titolo) +
    '&dates=' + c.inizio + '/' + c.fine + '&details=' + encodeURIComponent(c.note);
}
function waLink(a) {
  const pz = S.pazienti.find(x => x.id === a.paziente_id) || {};
  let n = String(pz.telefono || '').replace(/[^\d+]/g, '');
  if (n.startsWith('00')) n = n.slice(2); else if (n.startsWith('+')) n = n.slice(1); else if (n) n = '39' + n.replace(/^0+(?=3)/, '');
  const d = new Date(a.inizio);
  const saluto = new Date().getHours() < 17 ? 'Buongiorno' : 'Buonasera';
  const testo = `${saluto} ${pz.nome || ''}, le confermiamo l'appuntamento del ${d.toLocaleDateString('it-IT')} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.\n\nSTUDIO PROAESTHETICS CHIRURGIA PLASTICA ED ESTETICA`;
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(testo)}` : '';
}
function scaricaIcs(a) {
  const c = datiCal(a), esc2 = t => String(t).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clinica//IT', 'BEGIN:VEVENT', `UID:${a.id}@clinica`,
    `DTSTAMP:${utcStamp(new Date())}`, `DTSTART:${c.inizio}`, `DTEND:${c.fine}`, `SUMMARY:${esc2(c.titolo)}`,
    `DESCRIPTION:${esc2(c.note)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const l = document.createElement('a'); l.href = url; l.download = 'appuntamento.ics'; document.body.appendChild(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

VISTE.app = async (id, pazPre = '') => {
  const nuovo = id === 'new', mod = can('agenda', true);
  const a = nuovo ? { durata_min: 30, tipo: 'Visita', stato: 'Programmato', trattamento: '', note: '' } : S.appuntamenti.find(x => x.id === id) || {};
  const ini = a.inizio ? new Date(a.inizio) : new Date();
  const ora0 = a.inizio ? isoOra(ini) : '09:00';
  schermo({
    titolo: nuovo ? 'Nuovo appuntamento' : 'Appuntamento', back: true,
    body: `<form id="f"><fieldset style="border:0;padding:0;margin:0" ${mod ? '' : 'disabled'}>
      <label class="f">Paziente<select name="paziente_id" required><option value="">Scegli paziente…</option>
        ${S.pazienti.map(p => `<option value="${p.id}" ${p.id === (a.paziente_id || pazPre) ? 'selected' : ''}>${esc(p.cognome)} ${esc(p.nome)}</option>`).join('')}</select></label>
      <div class="grid2">${campo('Data', 'data', isoData(ini), 'date', 'required')}${campo('Ora', 'ora', ora0, 'time', 'required')}</div>
      ${campo('Durata (minuti)', 'durata_min', a.durata_min, 'number', 'min="5" step="5"')}
      <label class="f">Tipo${scelta('tipo', ['Visita', 'Intervento', 'Controllo', 'Altro'], a.tipo)}</label>
      ${campo('Trattamento', 'trattamento', a.trattamento, 'text', 'id="trt"')}
      <label class="f">Scegli dal listino<select id="dl"><option value="">—</option>${S.listino.filter(l => l.attivo).map(l => `<option value="${l.id}">${esc(l.nome)}</option>`).join('')}</select></label>
      <label class="f">Stato${scelta('stato', ['Programmato', 'Eseguito', 'Annullato'], a.stato)}</label>
      ${area('Note', 'note', a.note)}</fieldset>
      <div class="row">${mod ? '<button class="b">Salva</button>' : ''}${!nuovo && can('eliminazione', true) ? '<button type="button" class="b d" id="del">Elimina appuntamento</button>' : ''}</div></form>
      ${nuovo ? '' : `<h3>Calendario</h3><div class="row"><a class="b o" id="gcal" target="_blank" rel="noopener" href="${esc(gcalLink(a))}">Google Calendar</a>
      <button type="button" class="b o" id="ics">Apple / altri (.ics)</button></div>
      <h3>Promemoria paziente</h3>${waLink(a) ? `<a class="b" id="wa" target="_blank" rel="noopener" href="${esc(waLink(a))}">Invia promemoria WhatsApp</a>` : '<p class="m">Nessun numero di telefono nella scheda del paziente.</p>'}
      <p class="m">Nel calendario compaiono nome e cognome, tipo e trattamento.</p>`}`
  });
  $('#dl').onchange = e => { const l = S.listino.find(x => x.id === e.target.value); if (l) { $('#trt').value = l.nome; $('#f [name=durata_min]').value = l.durata_min; } };
  $('#f').onsubmit = e => {
    e.preventDefault(); const d = fobj(e.target);
    const rec = {
      paziente_id: d.paziente_id, inizio: new Date(`${d.data}T${d.ora}`).toISOString(), durata_min: parseInt(d.durata_min) || 30,
      tipo: d.tipo || 'Visita', trattamento: (d.trattamento || '').trim(), stato: d.stato || 'Programmato', note: (d.note || '').trim()
    };
    ok(async () => {
      if (nuovo) await q(sb.from('appuntamenti').insert(rec)); else await q(sb.from('appuntamenti').update(rec).eq('id', id));
      S.appuntamenti = await q(sb.from('appuntamenti').select('*').order('inizio')); history.back();
    });
  };
  if ($('#ics')) $('#ics').onclick = () => scaricaIcs(a);
  const del = $('#del');
  if (del) del.onclick = () => conferma('Eliminare l\'appuntamento?', 'L\'operazione non si può annullare.', () => ok(async () => {
    await q(sb.from('appuntamenti').delete().eq('id', id));
    S.appuntamenti = S.appuntamenti.filter(x => x.id !== id); history.back();
  }));
};

/* ---------- LISTINO ---------- */
VISTE.listino = async () => {
  schermo({
    titolo: 'Listino', nav: 'listino',
    body: `${S.listino.length ? `<div class="list">${S.listino.map(l => `<a class="it" ${can('listino', true) ? `href="#/voce/${l.id}"` : ''}>
      ${l.categoria ? `<span class="over">${esc(l.categoria)}</span><br>` : ''}<b>${esc(l.nome)}${l.attivo ? '' : ' (non attivo)'}</b><br><small>${euro(l.prezzo)} · ${l.durata_min} min</small></a>`).join('')}</div>` : '<p class="m">Listino vuoto</p>'}
      ${can('listino', true) ? '<button class="fab" id="nuovo" aria-label="Nuova voce">+</button>' : ''}`
  });
  if ($('#nuovo')) $('#nuovo').onclick = () => go('#/voce/new');
};

VISTE.voce = async id => {
  const nuovo = id === 'new', l = nuovo ? { attivo: true, durata_min: 30 } : S.listino.find(x => x.id === id) || {};
  schermo({
    titolo: nuovo ? 'Nuova voce' : 'Modifica voce', back: true,
    body: `<form id="f">${campo('Nome trattamento / intervento', 'nome', l.nome, 'text', 'required')}${campo('Categoria', 'categoria', l.categoria)}
      ${campo('Prezzo €', 'prezzo', l.prezzo ?? '', 'text', 'inputmode="decimal"')}${campo('Durata (minuti)', 'durata_min', l.durata_min, 'number')}
      <label class="chk"><input type="checkbox" name="attivo" ${l.attivo ? 'checked' : ''}>Attivo</label>
      <div class="row"><button class="b">Salva</button>${!nuovo && can('eliminazione', true) ? '<button type="button" class="b d" id="del">Elimina voce</button>' : ''}</div></form>`
  });
  const ricarica = async () => { S.listino = await q(sb.from('listino').select('*').order('categoria').order('nome')); history.back(); };
  $('#f').onsubmit = e => {
    e.preventDefault(); const d = fobj(e.target);
    const rec = { nome: d.nome.trim(), categoria: (d.categoria || '').trim(), prezzo: num(d.prezzo), durata_min: parseInt(d.durata_min) || 30, attivo: !!d.attivo };
    ok(async () => { if (nuovo) await q(sb.from('listino').insert(rec)); else await q(sb.from('listino').update(rec).eq('id', id)); await ricarica(); });
  };
  const del = $('#del');
  if (del) del.onclick = () => conferma('Eliminare la voce?', 'I preventivi già creati non vengono modificati.', () => ok(async () => { await q(sb.from('listino').delete().eq('id', id)); await ricarica(); }));
};

/* ---------- UTENTI (solo amministratore) ---------- */
async function gestioneUtenti(body) {
  const { data, error } = await sb.functions.invoke('gestione-utenti', { body });
  if (error) {
    let m = error.message;
    try { const j = await error.context.json(); m = j.errore || j.message || m; } catch (_) { /* ignora */ }
    throw new Error(m);
  }
  if (data && data.errore) throw new Error(data.errore);
}

VISTE.utenti = async () => {
  if (me.ruolo !== 'admin') return go('#/pazienti');
  S.utenti = await q(sb.from('profiles').select('*').order('username'));
  schermo({
    titolo: 'Utenti', nav: 'utenti',
    body: `<div class="list">${S.utenti.map(u => `<a class="it" href="#/utente/${u.id}"><span class="over">${u.ruolo === 'admin' ? 'Amministratore' : 'Operatore'}</span><br>
      <b>${esc(u.nome || u.username)}</b><br><small>@${esc(u.username)}${u.attivo ? '' : ' · DISATTIVATO'}</small></a>`).join('')}</div>
      <button class="fab" id="nuovo" aria-label="Nuovo utente">+</button>`
  });
  $('#nuovo').onclick = () => go('#/utente/new');
};

VISTE.utente = async id => {
  if (me.ruolo !== 'admin') return go('#/pazienti');
  const nuovo = id === 'new', u = nuovo ? { ruolo: 'staff', attivo: true, permessi: {} } : S.utenti.find(x => x.id === id) || {};
  const io = !nuovo && u.id === me.id;
  const livello = k => (u.permessi || {})[k] || (['pazienti', 'agenda', 'listino'].includes(k) ? 'view' : 'none');
  schermo({
    titolo: nuovo ? 'Nuovo utente' : `Utente @${u.username}`, back: true,
    body: `<form id="f">${campo('Username (senza spazi)', 'username', u.username, 'text', `${nuovo ? '' : 'disabled'} autocapitalize="none" autocorrect="off"`)}
      ${campo('Nome e cognome', 'nome', u.nome)}
      ${campo(nuovo ? 'Password (min. 8 caratteri)' : 'Nuova password (lascia vuoto per non cambiarla)', 'password', '', 'password', 'autocomplete="new-password"')}
      <label class="chk"><input type="checkbox" name="admin" ${u.ruolo === 'admin' ? 'checked' : ''} ${io ? 'disabled' : ''}>Amministratore (accesso totale e gestione utenti)</label>
      <label class="chk"><input type="checkbox" name="attivo" ${u.attivo ? 'checked' : ''} ${io ? 'disabled' : ''}>Utenza attiva</label>
      <div id="perm">${MODULI.map(([k, et]) => `<label class="f">${esc(et)}${k === 'eliminazione'
        ? scelta('p_' + k, ['No', 'Sì'], livello(k) === 'edit' ? 'Sì' : 'No')
        : scelta('p_' + k, ['Nessuno', 'Lettura', 'Modifica'], { none: 'Nessuno', view: 'Lettura', edit: 'Modifica' }[livello(k)])}</label>`).join('')}</div>
      <div class="row"><button class="b">Salva</button>${!nuovo && !io ? '<button type="button" class="b d" id="del">Elimina utente</button>' : ''}</div>
      <p class="m">Le modifiche ai permessi valgono dal prossimo accesso o aggiornamento dell'altro utente.</p></form>`
  });
  const mostra = () => { $('#perm').hidden = $('#f [name=admin]').checked; };
  $('#f [name=admin]').onchange = mostra; mostra();
  $('#f').onsubmit = e => {
    e.preventDefault(); const d = fobj(e.target);
    const permessi = {};
    MODULI.forEach(([k]) => { const v = d['p_' + k]; permessi[k] = k === 'eliminazione' ? (v === 'Sì' ? 'edit' : 'none') : { Nessuno: 'none', Lettura: 'view', Modifica: 'edit' }[v] || 'none'; });
    const ruolo = d.admin ? 'admin' : 'staff', pw = d.password || '';
    if (nuovo && (!/^[a-z0-9._-]{3,30}$/.test((d.username || '').trim().toLowerCase()) || pw.length < 8))
      return avviso('Attenzione', 'Username (3-30 caratteri: lettere, numeri . _ -) e password di almeno 8 caratteri.');
    if (!nuovo && pw && pw.length < 8) return avviso('Attenzione', 'La password deve avere almeno 8 caratteri.');
    ok(async () => {
      if (nuovo) {
        await gestioneUtenti({ azione: 'crea', username: d.username.trim().toLowerCase(), password: pw, nome: d.nome.trim(), ruolo, permessi });
        log('crea_utente', d.username);
      } else {
        await q(sb.from('profiles').update({ nome: d.nome.trim(), ruolo: io ? u.ruolo : ruolo, attivo: io ? true : !!d.attivo, permessi }).eq('id', id));
        if (pw) await gestioneUtenti({ azione: 'password', id, password: pw });
        log('modifica_utente', u.username);
      }
      history.back();
    });
  };
  const del = $('#del');
  if (del) del.onclick = () => conferma('Eliminare l\'utente?', `@${u.username} non potrà più accedere. I dati dei pazienti restano.`, () => ok(async () => {
    await gestioneUtenti({ azione: 'elimina', id }); log('elimina_utente', u.username); history.back();
  }));
};

/* ---------- STAMPA / PDF ---------- */
async function stampa(id) {
  const pz = S.pazienti.find(x => x.id === id), h = [];
  h.push(`<h1>Scheda paziente</h1><h2>${esc(pz.cognome)} ${esc(pz.nome)}</h2>
    <p class="s">Stampata il ${new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })} da ${esc(me.nome || me.username)}</p>`);
  const r = (e, v) => v ? `<tr><td class="e">${esc(e)}</td><td>${esc(v)}</td></tr>` : '';
  h.push(`<h3>Anagrafica</h3><table>${r('Data di nascita', fData(pz.data_nascita))}${r('Sesso', pz.sesso)}${r('Codice fiscale', pz.codice_fiscale)}${r('Telefono', pz.telefono)}
    ${r('Email', pz.email)}${r('Indirizzo', pz.indirizzo)}${r('Privacy (GDPR)', pz.consenso_privacy ? 'Informativa firmata' : 'NON firmata')}
    ${r('Consenso informato', pz.consenso_informato ? 'Firmato il ' + fData(pz.consenso_data) : 'NON firmato')}</table>`);
  if (can('clinica')) {
    const [an, note] = await Promise.all([q(sb.from('anamnesi').select('*').eq('paziente_id', id)), q(sb.from('note_cliniche').select('*').eq('paziente_id', id).order('creato_il', { ascending: false }))]);
    const a = an[0];
    h.push(`<h3>Anamnesi</h3><table>${a ? r('Allergie', a.allergie) + r('Farmaci in corso', a.farmaci) + r('Patologie', a.patologie) + r('Fumo', a.fumatore) : '<tr><td>Nessuna anamnesi registrata</td></tr>'}</table><h3>Note cliniche</h3>`);
    h.push(note.length ? note.map(n => `<div class="n"><div class="s">${esc(fDataOra(n.creato_il))} · ${esc(n.autore_nome)}</div>${esc(n.testo).replace(/\n/g, '<br>')}</div>`).join('') : '<p>Nessuna nota</p>');
  }
  if (can('agenda')) {
    const ap = S.appuntamenti.filter(x => x.paziente_id === id).sort((x, y) => y.inizio.localeCompare(x.inizio));
    h.push('<h3>Appuntamenti</h3>' + (ap.length ? `<table class="g"><tr><th>Data</th><th>Tipo</th><th>Trattamento</th><th>Stato</th></tr>${ap.map(x => `<tr><td>${esc(fDataOra(x.inizio))}</td><td>${esc(x.tipo)}</td><td>${esc(x.trattamento)}</td><td>${esc(x.stato)}</td></tr>`).join('')}</table>` : '<p>Nessun appuntamento</p>'));
  }
  if (can('conti')) {
    const [prev, pag] = await Promise.all([q(sb.from('preventivi').select('*').eq('paziente_id', id).order('creato_il', { ascending: false })), q(sb.from('pagamenti').select('*').eq('paziente_id', id).order('creato_il', { ascending: false }))]);
    const acc = prev.filter(p => p.stato === 'Accettato').reduce((s, p) => s + totPrev(p), 0), pagato = pag.reduce((s, p) => s + (+p.importo || 0), 0);
    h.push('<h3>Preventivi</h3>' + (prev.length ? prev.map(p => `<div class="n"><div class="s">${esc(fData(p.creato_il))} · ${esc(p.stato)}</div>
      ${(p.voci || []).map(v => `${esc(v.nome)} x${v.qta}: ${euro(v.prezzo * v.qta)}<br>`).join('')}${+p.sconto > 0 ? `Sconto: ${euro(p.sconto)}<br>` : ''}<b>Totale: ${euro(totPrev(p))}</b></div>`).join('') : '<p>Nessun preventivo</p>'));
    h.push('<h3>Pagamenti</h3>' + (pag.length ? `<table class="g"><tr><th>Data</th><th>Metodo</th><th>Importo</th><th>Nota</th></tr>${pag.map(p => `<tr><td>${esc(fData(p.creato_il))}</td><td>${esc(p.metodo)}</td><td>${euro(p.importo)}</td><td>${esc(p.nota)}</td></tr>`).join('')}</table>` : '<p>Nessun pagamento</p>'));
    h.push(`<p><b>Accettato ${euro(acc)} · Pagato ${euro(pagato)} · Residuo ${euro(acc - pagato)}</b></p>`);
  }
  if (can('foto')) {
    const foto = await q(sb.from('foto').select('*').eq('paziente_id', id).order('creato_il'));
    if (foto.length) {
      const u = await urlFoto(foto);
      h.push(`<h3>Foto</h3><div class="f">${foto.map(f => `<figure><img src="${esc(u[f.percorso] || '')}"><figcaption>${esc(f.etichetta)} · ${esc(fDataOra(f.creato_il))}</figcaption></figure>`).join('')}</div>`);
    }
  }
  h.push('<p class="s" style="margin-top:24px">Documento riservato: contiene dati personali e sanitari.</p>');
  const p = $('#print'); p.innerHTML = h.join('');
  await Promise.all([...p.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  log('stampa_scheda', id);
  const t = document.title; document.title = `Scheda ${pz.cognome} ${pz.nome}`;
  window.print();
  setTimeout(() => { document.title = t; p.innerHTML = ''; }, 1500);
}

/* ---------- avvio e blocco per inattività ---------- */
let inattivo;
function resetInattivo() {
  clearTimeout(inattivo);
  if (me) inattivo = setTimeout(() => { if (me) { esci().then(() => vistaLogin('Sessione chiusa per inattività.')); } }, 30 * 60 * 1000);
}
['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => window.addEventListener(ev, resetInattivo, { passive: true }));

(async function avvio() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!CFG || /INCOLLA/.test(CFG.SUPABASE_ANON_KEY)) {
    $('#app').innerHTML = '<div class="login"><h1>Configurazione mancante</h1><p>Apri il file <b>config.js</b> e incolla la chiave ANON di Supabase.</p></div>';
    return;
  }
  busy(true);
  try { await entra(); } catch (e) { vistaLogin(); } finally { busy(false); }
  resetInattivo();
})();
