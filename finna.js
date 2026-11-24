// Finna API client for the sheet music search. No DOM code in here, so it runs
// in the browser and in Node tests alike.

export const API_BASE = 'https://api.finna.fi/v1';
const TIMEOUT_MS = 20_000;
// /record accepts many id[] values per call; full MARC records are large, so
// the batches are kept small.
const RECORD_BATCH = 25;

export const LIBRARIES = {
  helmet: {
    name: 'Helmet',
    code: 'Helmet',
    recordUrl: (id) => `https://helmet.finna.fi/Record/${encodeURIComponent(id)}`,
  },
  helka: {
    name: 'Helka',
    code: 'HELKA',
    recordUrl: (id) => `https://helka.finna.fi/Record/${encodeURIComponent(id)}`,
  },
  '3amk': {
    name: '3AMK',
    code: '3AMK',
    // 3amk.finna.fi answers 403 to record links, the national view works.
    recordUrl: (id) => `https://www.finna.fi/Record/${encodeURIComponent(id)}`,
  },
};
export const LIBRARY_KEYS = Object.keys(LIBRARIES);

const SEARCH_FIELDS = ['id', 'title', 'year', 'dedupIds'];
const RECORD_FIELDS = [
  'id', 'title', 'year', 'publishers', 'generalNotes', 'buildings', 'toc',
  'fullRecord',
];

export class FinnaError extends Error {}

/** Which of the three systems a record ID belongs to, or null. */
export function libraryOfId(id) {
  const prefix = String(id).split('.')[0].toLowerCase();
  return LIBRARY_KEYS.includes(prefix) ? prefix : null;
}

export function recordUrl(id) {
  const lib = libraryOfId(id);
  return lib
    ? LIBRARIES[lib].recordUrl(id)
    : `https://www.finna.fi/Record/${encodeURIComponent(id)}`;
}

// ------------------------------------------------------------------- query

const words = (s) => String(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The song title is searched as a phrase. The artist is added as separate
 * words, because catalogues write names both ways round ("Tapio, Juha").
 */
export function buildQuery(title, artist = '') {
  const phrase = String(title).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!phrase) throw new FinnaError('empty-title');
  const names = words(artist);
  return names.length
    ? `"${phrase}" AND (${names.join(' AND ')})`
    : `"${phrase}"`;
}

export function buildSearchParams(opts) {
  const {
    title, artist = '', libraries = LIBRARY_KEYS, page = 1, limit = 20,
    lng = 'fi',
  } = opts;
  if (!libraries.length) throw new FinnaError('no-library');
  const p = new URLSearchParams();
  p.set('lookfor', buildQuery(title, artist));
  p.set('type', 'AllFields');
  p.set('sort', 'relevance');
  p.set('page', String(page));
  p.set('limit', String(limit));
  p.set('lng', lng);
  // "~" makes the filters on one field alternatives (OR) instead of AND.
  for (const k of libraries) {
    p.append('filter[]', `~building:"0/${LIBRARIES[k].code}/"`);
  }
  p.append('filter[]', 'format:"0/MusicalScore/"');
  for (const f of SEARCH_FIELDS) p.append('field[]', f);
  return p;
}

// -------------------------------------------------------------------- MARC

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) ? String.fromCodePoint(n) : m;
});
const attr = (attrs, name) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';

/** Reads the data fields of a MARCXML record: [{ tag, ind1, ind2, subs }]. */
export function parseMarc(xml) {
  const out = [];
  const fieldRe = /<(?:\w+:)?datafield\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?datafield>/g;
  for (const [, attrs, body] of String(xml ?? '').matchAll(fieldRe)) {
    const subs = [];
    const subRe = /<(?:\w+:)?subfield\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?subfield>/g;
    for (const [, sAttrs, value] of body.matchAll(subRe)) {
      subs.push([attr(sAttrs, 'code'), decode(value).replace(/\s+/g, ' ').trim()]);
    }
    out.push({
      tag: attr(attrs, 'tag'), ind1: attr(attrs, 'ind1'),
      ind2: attr(attrs, 'ind2'), subs,
    });
  }
  return out;
}

const tidy = (s) => String(s ?? '')
  .replace(/\s+/g, ' ')
  .replace(/\s*(--|[/:;,])\s*$/, '')
  .trim();

/**
 * Splits one part of a contents note into entries. The usual form is
 * "Title / who wrote it". Several titles can share one statement:
 * "Hey Jude ; Yesterday / Lennon & McCartney".
 */
function splitEntry(text) {
  const i = text.indexOf(' / ');
  const titles = i < 0 ? text : text.slice(0, i);
  const by = i < 0 ? '' : tidy(text.slice(i + 3));
  return titles.split(/\s+;\s+/).map((t) => ({ title: tidy(t), by }));
}

/**
 * The pieces a publication contains, as [{ title, by }]. Libraries catalogue
 * these in different places: Helmet as one added title (730) per song, 3AMK
 * as a contents note (505).
 */
export function contentsOf(record) {
  const out = [];
  const seen = new Set();
  const add = (title, by = '') => {
    const t = tidy(title);
    if (!t || seen.has(fold(t))) return;
    seen.add(fold(t));
    out.push({ title: t, by: tidy(by) });
  };
  const sub = (f, code) => f.subs.filter(([c]) => c === code).map(([, v]) => v);

  for (const f of parseMarc(record.fullRecord)) {
    if (f.tag === '505') {
      if (sub(f, 't').length) {
        let last = null;
        for (const [code, value] of f.subs) {
          if (code === 't') {
            if (last) add(last.title, last.by);
            last = { title: value, by: '' };
          } else if (code === 'r' && last) {
            last.by = value;
          }
        }
        if (last) add(last.title, last.by);
      } else {
        for (const part of sub(f, 'a').join(' ').split(/\s+--\s+/)) {
          for (const e of splitEntry(part.replace(/\.$/, ''))) add(e.title, e.by);
        }
      }
    } else if (f.tag === '730' || (f.tag === '740' && f.ind2 === '2')) {
      add(sub(f, 'a').join(' '), sub(f, 'g').join(' '));
    } else if (['700', '710', '711'].includes(f.tag) && sub(f, 't').length) {
      add(sub(f, 't').join(' '), sub(f, 'a').join(' '));
    }
  }
  // The API's own contents list, for records that are not MARC.
  if (!out.length) {
    for (const line of record.toc ?? []) {
      if (typeof line !== 'string') continue;
      for (const e of splitEntry(line)) add(e.title, e.by);
    }
  }
  return out;
}

// ---------------------------------------------------------------- matching

/** Lower case, no accents, punctuation as spaces: "Sä & mä!" → "sa ma". */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('fi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when `text` has the words of `phrase` next to each other, in order. */
export function hasPhrase(text, phrase) {
  const needle = fold(phrase);
  return needle !== '' && ` ${fold(text)} `.includes(` ${needle} `);
}

/**
 * A long text cut down to the part around the phrase. Some contents notes are
 * one unbroken list, and only the song's surroundings are worth showing.
 */
export function excerpt(text, phrase, max = 90) {
  if (text.length <= max) return text;
  // Accents are folded away in the phrase, so the text is searched with its
  // accents split off, each letter allowed to carry some.
  const loose = fold(phrase).split(' ')
    .map((w) => [...w].join('\\p{M}*'))
    .join('[^\\p{L}\\p{N}]+');
  const split = text.normalize('NFKD');
  const at = new RegExp(loose, 'iu').exec(split)?.index ?? 0;
  const from = Math.max(0, at - 30);
  const to = Math.min(split.length, from + max);
  const cut = split.slice(from, to).normalize('NFC').trim();
  return `${from > 0 ? '… ' : ''}${cut}${to < split.length ? ' …' : ''}`;
}

/** The contents entries whose title has the song title in it. */
export function findSong(entries, title) {
  return entries.filter((e) => hasPhrase(e.title, title));
}

// ---------------------------------------------------------------- holdings

/**
 * Turns a record's building list into cities or campuses with their branches:
 * [{ name: "Helsinki", branches: ["Oodi", "Pasila"] }].
 */
export function placesOf(buildings = []) {
  const name = (b) => b.translated || b.value;
  const places = buildings
    .filter((b) => b.value.startsWith('1/'))
    .map((b) => ({ code: b.value.slice(2), name: name(b), branches: [] }));
  for (const b of buildings.filter((x) => x.value.startsWith('2/'))) {
    const parent = places.find((p) => b.value.slice(2).startsWith(p.code));
    if (parent) parent.branches.push(name(b));
  }
  return places.map(({ name: n, branches }) => ({ name: n, branches }));
}

// --------------------------------------------------------------------- API

async function getJson(path, params, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${API_BASE}/${path}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new FinnaError('unreachable', { cause: err });
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new FinnaError(`http-${res.status}`);
  }
  if (!res.ok || body.status !== 'OK') {
    throw new FinnaError(body.statusMessage || `http-${res.status}`);
  }
  return body;
}

async function fetchRecords(ids, lng, fetchImpl) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += RECORD_BATCH) {
    const p = new URLSearchParams({ lng });
    for (const id of ids.slice(i, i + RECORD_BATCH)) p.append('id[]', id);
    for (const f of RECORD_FIELDS) p.append('field[]', f);
    const body = await getJson('record', p, fetchImpl);
    for (const r of body.records ?? []) out.set(r.id, r);
  }
  return out;
}

/** IDs of the Helmet, Helka and 3AMK copies of a search result. */
export function localIdsOf(record, libraries = LIBRARY_KEYS) {
  const all = [record.id, ...(record.dedupIds ?? [])];
  return [...new Set(all)]
    .filter((id) => libraries.includes(libraryOfId(id)))
    .sort((a, b) =>
      LIBRARY_KEYS.indexOf(libraryOfId(a)) - LIBRARY_KEYS.indexOf(libraryOfId(b)));
}

/**
 * Describes one search result: where the song was found and which libraries
 * hold the publication.
 *
 * status "song"        the song is in the catalogued contents
 *        "title"       the publication itself carries the title
 *        "unconfirmed" the search matched, but the contents do not show why
 */
export function describeGroup(representative, records, title) {
  const holdings = records.map((r) => {
    const contents = contentsOf(r);
    return {
      id: r.id,
      library: libraryOfId(r.id),
      url: recordUrl(r.id),
      places: placesOf(r.buildings),
      notes: (r.generalNotes ?? []).filter((n) => typeof n === 'string'),
      contents,
      matches: findSong(contents, title),
    };
  });
  const first = records[0] ?? representative;
  // Contents are shown from the copy that names the song, else the fullest.
  const best = holdings.find((h) => h.matches.length)
    ?? [...holdings].sort((a, b) => b.contents.length - a.contents.length)[0];
  const matches = best?.matches ?? [];
  const status = matches.length
    ? 'song'
    : hasPhrase(first.title, title) ? 'title' : 'unconfirmed';
  return {
    title: first.title ?? representative.title ?? '',
    year: first.year ?? representative.year ?? '',
    publishers: first.publishers ?? [],
    notes: holdings.find((h) => h.notes.length)?.notes ?? [],
    status,
    matches,
    contents: best?.contents ?? [],
    holdings,
  };
}

const RANK = { song: 0, title: 1, unconfirmed: 2 };

/**
 * Searches musical scores for a song title and reads each hit's contents.
 * When the artist narrows the search to nothing, it is searched again without
 * the artist and `artistDropped` is set.
 */
export async function searchScores(opts, fetchImpl = fetch) {
  const libraries = opts.libraries?.length ? opts.libraries : LIBRARY_KEYS;
  const lng = opts.lng ?? 'fi';
  let artistDropped = false;
  let body = await getJson(
    'search', buildSearchParams({ ...opts, libraries, lng }), fetchImpl,
  );
  if (!body.resultCount && words(opts.artist ?? '').length) {
    artistDropped = true;
    body = await getJson(
      'search', buildSearchParams({ ...opts, artist: '', libraries, lng }), fetchImpl,
    );
  }
  const found = body.records ?? [];
  const ids = [...new Set(found.flatMap((r) => localIdsOf(r, libraries)))];
  const records = await fetchRecords(ids, lng, fetchImpl);
  const groups = found
    .map((r) => describeGroup(
      r,
      localIdsOf(r, libraries).map((id) => records.get(id)).filter(Boolean),
      opts.title,
    ))
    .filter((g) => g.holdings.length);
  // Stable sort: confirmed songs first, the API's relevance order within each.
  groups.sort((a, b) => RANK[a.status] - RANK[b.status]);
  return {
    resultCount: body.resultCount ?? 0,
    groups,
    artistDropped: artistDropped && (body.resultCount ?? 0) > 0,
    fetched: found.length,
  };
}
