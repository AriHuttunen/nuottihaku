// Page behaviour: reads the form, runs the search, draws the results.

import { LIBRARIES, LIBRARY_KEYS, excerpt, searchScores } from './finna.js';

const PAGE_SIZE = 20;

const TEXT = {
  fi: {
    heading: 'Nuottihaku',
    intro: 'Etsi nuotti laulun nimellä pääkaupunkiseudun kirjastoista. Haku '
      + 'käy läpi myös laulukirjojen sisällöt, joten laulu löytyy, vaikka '
      + 'kirjan nimi olisi jotain aivan muuta.',
    titleLabel: 'Laulun nimi',
    artistLabel: 'Esittäjä tai säveltäjä (ei pakollinen)',
    librariesLabel: 'Kirjastot',
    search: 'Hae',
    more: 'Näytä lisää',
    otherLang: 'In English',
    searching: 'Haetaan…',
    none: 'Laulua ei löytynyt näiden kirjastojen nuoteista.',
    count: (shown, total) => total === 1
      ? '1 julkaisu.'
      : shown < total ? `${total} julkaisua, näytetään ${shown}.` : `${total} julkaisua.`,
    artistDropped: (a) => `Haulla "${a}" ei löytynyt mitään, joten tässä ovat `
      + 'tulokset pelkällä laulun nimellä.',
    statusSong: 'Laulu on luetteloitu julkaisun sisältöön',
    statusTitle: 'Julkaisun oma nimi vastaa hakua',
    statusUnconfirmed: 'Haku osui julkaisuun, mutta laulua ei löytynyt sen '
      + 'luetteloidusta sisällöstä',
    notes: 'Huomautukset',
    contents: (n) => (n === 1 ? 'Sisältö (1 kappale)' : `Sisältö (${n} kappaletta)`),
    shelf: 'Saatavuus ja varaus',
    errUnreachable: 'Finnaan ei saatu yhteyttä. Yritä hetken kuluttua uudelleen.',
    errOther: (m) => `Finna hylkäsi haun: ${m}`,
    errNoLibrary: 'Valitse vähintään yksi kirjasto.',
    footerData: 'Tiedot tulevat Finnan avoimesta rajapinnasta (api.finna.fi) '
      + 'Helmet-, Helka- ja 3AMK-kirjastojen luetteloista. Sivu näyttää, mikä '
      + 'kirjasto omistaa julkaisun. Hyllyssä olon näkee linkin takaa.',
    footerCards: 'Jokaiseen kirjastojärjestelmään tarvitaan oma kirjastokortti.',
  },
  en: {
    heading: 'Sheet music search',
    intro: 'Find sheet music by song title in the Helsinki-area libraries. '
      + 'The search also reads the contents of songbooks, so a song is found '
      + 'even when the book is called something else entirely.',
    titleLabel: 'Song title',
    artistLabel: 'Artist or composer (optional)',
    librariesLabel: 'Libraries',
    search: 'Search',
    more: 'Show more',
    otherLang: 'Suomeksi',
    searching: 'Searching…',
    none: 'The song was not found in the scores of these libraries.',
    count: (shown, total) => total === 1
      ? '1 publication.'
      : shown < total ? `${total} publications, showing ${shown}.` : `${total} publications.`,
    artistDropped: (a) => `Nothing was found with "${a}", so these are the `
      + 'results for the song title alone.',
    statusSong: 'The song is listed in the catalogued contents',
    statusTitle: 'The publication itself has this title',
    statusUnconfirmed: 'The search matched this publication, but the song was '
      + 'not found in its catalogued contents',
    notes: 'Notes',
    contents: (n) => (n === 1 ? 'Contents (1 piece)' : `Contents (${n} pieces)`),
    shelf: 'Shelf status and reservations',
    errUnreachable: 'Could not reach Finna. Try again in a moment.',
    errOther: (m) => `Finna rejected the search: ${m}`,
    errNoLibrary: 'Choose at least one library.',
    footerData: 'Data comes from the open Finna API (api.finna.fi), from the '
      + 'Helmet, Helka and 3AMK catalogues. The page shows which library owns '
      + 'a publication. Whether a copy is on the shelf is behind the link.',
    footerCards: 'Each library system needs its own library card.',
  },
};

const $ = (id) => document.getElementById(id);
const form = $('form');
const statusEl = $('status');
const resultsEl = $('results');
const moreEl = $('more');

let lang = 'fi';
let t = TEXT.fi;
// The search now shown: its options, the groups drawn so far, the next page.
let current = null;
// Counts searches, so that a slow answer to an older one is ignored.
let run = 0;

/** Builds an element: h('a', { href }, 'text', childNode). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.filter((c) => c != null && c !== ''));
  return el;
}

function setLang(next) {
  lang = TEXT[next] ? next : 'fi';
  t = TEXT[lang];
  document.documentElement.lang = lang;
  document.title = t.heading;
  for (const el of document.querySelectorAll('[data-t]')) {
    el.textContent = t[el.dataset.t];
  }
  $('lang').textContent = t.otherLang;
  try { localStorage.setItem('lang', lang); } catch { /* private mode */ }
}

function errorText(err) {
  if (err.message === 'unreachable') return t.errUnreachable;
  if (err.message === 'no-library') return t.errNoLibrary;
  return t.errOther(err.message);
}

function holdingRow(holding) {
  const where = holding.places
    .map((p) => (p.branches.length ? `${p.name}: ${p.branches.join(', ')}` : p.name))
    .join(' · ');
  return h('li', {},
    h('strong', {}, LIBRARIES[holding.library].name),
    where ? ` ${where}` : '',
    h('div', { class: 'link' },
      `${t.shelf}: `,
      // The address is the link text, so the destination is visible.
      h('a', { href: holding.url, rel: 'noopener' }, holding.url.replace(/^https:\/\//, ''))));
}

function groupCard(group) {
  const facts = [group.year, ...group.publishers].filter(Boolean).join(' · ');
  const statusText = {
    song: t.statusSong, title: t.statusTitle, unconfirmed: t.statusUnconfirmed,
  }[group.status];

  const matched = group.matches.map((m) =>
    h('p', { class: 'match' },
      h('mark', {}, excerpt(m.title, current?.opts.title ?? '')), m.by ? ` / ${m.by}` : ''));

  const contents = group.contents.length
    ? h('details', {},
      h('summary', {}, t.contents(group.contents.length)),
      h('ul', { class: 'contents' }, ...group.contents.map((c) =>
        h('li', { class: group.matches.includes(c) ? 'hit' : null },
          c.title, c.by ? h('span', { class: 'by' }, ` / ${c.by}`) : ''))))
    : null;

  return h('li', { class: `card ${group.status}` },
    h('h2', {}, group.title),
    facts ? h('p', { class: 'facts' }, facts) : null,
    h('p', { class: 'status' }, statusText),
    ...matched,
    group.notes.length
      ? h('p', { class: 'notes' }, h('span', { class: 'label' }, `${t.notes}: `), group.notes.join(' '))
      : null,
    contents,
    h('ul', { class: 'holdings' }, ...group.holdings.map(holdingRow)));
}

function draw() {
  if (!current) return;
  resultsEl.replaceChildren(...current.groups.map(groupCard));
  const parts = [];
  if (current.opts.askedArtist) parts.push(t.artistDropped(current.opts.askedArtist));
  parts.push(current.total
    ? t.count(current.fetched, current.total)
    : t.none);
  statusEl.textContent = parts.join(' ');
  statusEl.classList.remove('error');
  moreEl.hidden = current.fetched >= current.total;
}

async function load(opts, page) {
  const mine = ++run;
  statusEl.textContent = t.searching;
  statusEl.classList.remove('error');
  moreEl.disabled = true;
  try {
    const result = await searchScores({ ...opts, page, limit: PAGE_SIZE, lng: lang === 'fi' ? 'fi' : 'en-gb' });
    if (mine !== run) return;
    const earlier = page > 1 && current ? current : { groups: [], fetched: 0 };
    current = {
      // An artist dropped on the first page stays dropped on later pages;
      // askedArtist keeps the name for the message.
      opts: result.artistDropped
        ? { ...opts, artist: '', askedArtist: opts.artist }
        : opts,
      groups: [...earlier.groups, ...result.groups],
      fetched: earlier.fetched + result.fetched,
      total: result.resultCount,
      page,
    };
    draw();
  } catch (err) {
    if (mine !== run) return;
    statusEl.textContent = errorText(err);
    statusEl.classList.add('error');
  } finally {
    if (mine === run) moreEl.disabled = false;
  }
}

function readForm() {
  const data = new FormData(form);
  return {
    title: String(data.get('q') ?? '').trim(),
    artist: String(data.get('artist') ?? '').trim(),
    libraries: data.getAll('lib'),
  };
}

function writeUrl(opts) {
  const p = new URLSearchParams({ q: opts.title });
  if (opts.artist) p.set('artist', opts.artist);
  if (opts.libraries.length !== LIBRARY_KEYS.length) p.set('lib', opts.libraries.join(','));
  history.replaceState(null, '', `?${p}`);
}

function start() {
  const opts = readForm();
  if (!opts.title) return;
  if (!opts.libraries.length) {
    statusEl.textContent = t.errNoLibrary;
    statusEl.classList.add('error');
    return;
  }
  writeUrl(opts);
  current = null;
  resultsEl.replaceChildren();
  moreEl.hidden = true;
  load(opts, 1);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  start();
});

moreEl.addEventListener('click', () => {
  if (current) load(current.opts, current.page + 1);
});

$('lang').addEventListener('click', () => {
  setLang(lang === 'fi' ? 'en' : 'fi');
  // Library and city names come translated from the API, so search again.
  if (current) start(); else statusEl.textContent = '';
});

// A search in the address (?q=…&artist=…) runs on arrival, so it can be shared.
function init() {
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch { /* private mode */ }
  setLang(saved ?? (navigator.language?.toLowerCase().startsWith('fi') ? 'fi' : 'en'));

  const p = new URLSearchParams(location.search);
  $('title').value = p.get('q') ?? '';
  $('artist').value = p.get('artist') ?? '';
  const libs = p.get('lib')?.split(',').filter((k) => LIBRARY_KEYS.includes(k));
  if (libs?.length) {
    for (const box of form.querySelectorAll('input[name="lib"]')) {
      box.checked = libs.includes(box.value);
    }
  }
  if ($('title').value.trim()) start();
}

init();
