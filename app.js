// Page behaviour: reads the form, runs the search, draws the results.

import {
  FILTERS, LIBRARIES, LIBRARY_KEYS, activeFilters, excerpt, searchScores,
} from './finna.js';

const PAGE_SIZE = 20;
// With filters on, a page of search results can hold few publications that
// pass them. One click reads on until this many more are shown, within limits.
const WANTED = 8;
const MAX_PAGES_PER_CLICK = 4;

const TEXT = {
  fi: {
    heading: 'Nuottihaku',
    intro: 'Etsi nuotti laulun nimellä pääkaupunkiseudun kirjastoista. Haku '
      + 'käy läpi myös laulukirjojen sisällöt, joten laulu löytyy, vaikka '
      + 'kirjan nimi olisi jotain aivan muuta.',
    titleLabel: 'Laulun nimi',
    artistLabel: 'Esittäjä tai säveltäjä (ei pakollinen)',
    librariesLabel: 'Kirjastot',
    instrumentLabel: 'Soitin',
    anyInstrument: 'Mikä tahansa',
    notationLabel: 'Nuotissa on',
    easyLabel: 'Vain helpoiksi merkityt',
    easyHint: 'Useimpiin julkaisuihin tasoa ei ole merkitty, joten helppoja '
      + 'voi olla muitakin.',
    instrument: {
      piano: 'Piano tai kosketinsoitin', guitar: 'Kitara', ukulele: 'Ukulele',
      bass: 'Basso', strings: 'Jousisoittimet', wind: 'Puhaltimet',
      accordion: 'Harmonikka', drums: 'Rummut ja lyömäsoittimet',
      voice: 'Laulu ja kuoro',
    },
    notation: {
      chords: 'Sointumerkit', lyrics: 'Sanat', melody: 'Melodia',
      tab: 'Tabulatuuri', accompaniment: 'Pianosäestys',
    },
    level: { easy: 'Helppo', advanced: 'Keskitaso tai edistynyt' },
    filtered: (shown, read, total) => {
      const n = shown === 1
        ? '1 suodattimiin sopiva julkaisu.'
        : `${shown} suodattimiin sopivaa julkaisua.`;
      return read < total ? `${n} Hakutuloksia käyty läpi ${read}/${total}.` : n;
    },
    noneFiltered: 'Suodattimiin sopivia julkaisuja ei löytynyt. Kokeile '
      + 'poistaa suodattimia.',
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
    instrumentLabel: 'Instrument',
    anyInstrument: 'Any',
    notationLabel: 'The notation has',
    easyLabel: 'Only those marked easy',
    easyHint: 'Most publications state no level, so others may be easy too.',
    instrument: {
      piano: 'Piano or keyboard', guitar: 'Guitar', ukulele: 'Ukulele',
      bass: 'Bass', strings: 'Strings', wind: 'Wind instruments',
      accordion: 'Accordion', drums: 'Drums and percussion',
      voice: 'Voice and choir',
    },
    notation: {
      chords: 'Chord symbols', lyrics: 'Lyrics', melody: 'Melody',
      tab: 'Tablature', accompaniment: 'Piano accompaniment',
    },
    level: { easy: 'Easy', advanced: 'Intermediate or advanced' },
    filtered: (shown, read, total) => {
      const n = shown === 1
        ? '1 publication fits the filters.'
        : `${shown} publications fit the filters.`;
      return read < total ? `${n} Read ${read} of ${total} search results.` : n;
    },
    noneFiltered: 'No publication fits the filters. Try removing some.',
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
// True once a search has been asked for, also while its answer is on the way.
let searched = false;

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
  drawFilterControls();
  try { localStorage.setItem('lang', lang); } catch { /* private mode */ }
}

/** Fills the instrument list and the notation boxes in the current language,
 * keeping what was chosen. */
function drawFilterControls() {
  const select = $('instrument');
  const chosen = select.value;
  select.replaceChildren(
    h('option', { value: '' }, t.anyInstrument),
    ...Object.keys(FILTERS.instrument).map((key) =>
      h('option', { value: key }, t.instrument[key])),
  );
  select.value = chosen;

  const box = $('notation');
  const ticked = new Set(
    [...box.querySelectorAll('input:checked')].map((el) => el.value),
  );
  box.replaceChildren(
    h('legend', {}, t.notationLabel),
    ...Object.keys(FILTERS.notation).map((key) =>
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'has', value: key, checked: ticked.has(key) }),
        t.notation[key])),
  );
}

function tagList(tags) {
  const items = ['instrument', 'notation', 'level'].flatMap((kind) =>
    tags[kind].map((key) => h('li', { class: kind }, t[kind][key])));
  return items.length ? h('ul', { class: 'tags' }, ...items) : null;
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
    tagList(group.tags),
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
  if (activeFilters(current.opts.filters).length) {
    parts.push(current.groups.length || current.fetched < current.total
      ? t.filtered(current.groups.length, current.fetched, current.total)
      : t.noneFiltered);
  } else {
    parts.push(current.total ? t.count(current.fetched, current.total) : t.none);
  }
  statusEl.textContent = parts.join(' ');
  statusEl.classList.remove('error');
  moreEl.hidden = current.fetched >= current.total;
}

async function load(opts, firstPage) {
  const mine = ++run;
  statusEl.textContent = t.searching;
  statusEl.classList.remove('error');
  moreEl.disabled = true;
  const lng = lang === 'fi' ? 'fi' : 'en-gb';
  const filtering = activeFilters(opts.filters).length > 0;
  let added = 0;
  try {
    for (let page = firstPage, n = 0; n < MAX_PAGES_PER_CLICK; page += 1, n += 1) {
      const asked = current?.opts ?? opts;
      const result = await searchScores({ ...asked, page, limit: PAGE_SIZE, lng });
      if (mine !== run) return;
      const earlier = current ?? { groups: [], fetched: 0 };
      current = {
        // An artist dropped on the first page stays dropped on later pages;
        // askedArtist keeps the name for the message.
        opts: result.artistDropped
          ? { ...asked, artist: '', askedArtist: asked.artist }
          : asked,
        groups: [...earlier.groups, ...result.groups],
        fetched: earlier.fetched + result.fetched,
        total: result.resultCount,
        page,
      };
      added += result.groups.length;
      draw();
      const done = current.fetched >= current.total || result.fetched === 0;
      if (done || !filtering || added >= WANTED) break;
      statusEl.textContent += ` ${t.searching}`;
    }
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
    filters: {
      instrument: String(data.get('inst') ?? ''),
      notation: data.getAll('has'),
      easy: data.has('easy'),
    },
  };
}

function writeUrl(opts) {
  const p = new URLSearchParams({ q: opts.title });
  if (opts.artist) p.set('artist', opts.artist);
  if (opts.libraries.length !== LIBRARY_KEYS.length) p.set('lib', opts.libraries.join(','));
  if (opts.filters.instrument) p.set('inst', opts.filters.instrument);
  if (opts.filters.notation.length) p.set('has', opts.filters.notation.join(','));
  if (opts.filters.easy) p.set('easy', '1');
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
  searched = true;
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

// Changing a filter or a library searches again, when there is a search.
form.addEventListener('change', (e) => {
  if (searched && e.target.matches('select, input[type="checkbox"]')) start();
});

$('lang').addEventListener('click', () => {
  setLang(lang === 'fi' ? 'en' : 'fi');
  // Library and city names come translated from the API, so search again.
  if (searched) start(); else statusEl.textContent = '';
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
  $('instrument').value = FILTERS.instrument[p.get('inst')] ? p.get('inst') : '';
  const has = p.get('has')?.split(',') ?? [];
  for (const box of form.querySelectorAll('input[name="has"]')) {
    box.checked = has.includes(box.value);
  }
  $('easy').checked = p.get('easy') === '1';
  if ($('title').value.trim()) start();
}

init();
