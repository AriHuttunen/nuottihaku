// Offline tests: the network is replaced by a fake fetch.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeFilters, buildQuery, buildSearchParams, classify, contentsOf,
  describeGroup, describingText, excerpt, findSong, fold, hasPhrase,
  localIdsOf, matchesFilters, parseMarc, placesOf, searchScores,
} from '../finna.js';

const field = (tag, ind2, subs) =>
  `<datafield tag="${tag}" ind1="0" ind2="${ind2}">${subs
    .map(([c, v]) => `<subfield code="${c}">${v}</subfield>`).join('')}</datafield>`;
const marc = (...fields) => `<record>${fields.join('\n')}</record>`;

// Helmet catalogues one added title per song.
const HELMET = {
  id: 'helmet.2276160',
  title: 'Pop tänään. Vol. 6',
  year: '2017',
  publishers: ['F-Kustannus'],
  generalNotes: ['Melodia, sanat, sointumerkit. Kitaran otetaulukko.'],
  buildings: [
    { value: '0/Helmet/', translated: 'Helmet-kirjastot' },
    { value: '1/Helmet/h/', translated: 'Helsinki' },
    { value: '2/Helmet/h/h00/', translated: 'Oodi' },
    { value: '2/Helmet/h/h01/', translated: 'Pasila' },
    { value: '1/Helmet/k/', translated: 'Kauniainen' },
  ],
  fullRecord: marc(
    field('245', ' ', [['a', 'Pop tänään.'], ['n', 'Vol. 6']]),
    field('730', ' ', [['a', 'Dye my hair /'], ['g', 'Miettinen, Alma']]),
    field('730', ' ', [['a', 'Elefantin paino /'], ['g', 'Leikas, Ellinoora &amp; Sirviö, Samuli']]),
    field('740', ' ', [['a', 'Pop tänään. 6 [2017]']]),
    field('700', ' ', [['a', 'Alma,'], ['e', 'esittäjä']]),
  ),
};
// 3AMK writes the same contents as one note.
const AMK = {
  id: '3amk.163207',
  title: 'Pop tänään vol. 6 [2017]',
  year: '2017',
  buildings: [{ value: '1/3AMK/MAR/', translated: 'Metropolia Arabia' }],
  fullRecord: marc(field('505', ' ', [['a',
    'Dye my hair / säv. Alma Miettinen -- Elefantin paino / säv. Ellinoora Leikas, esitt. Ellinoora -- Kohta sataa / säv. Jurek.']])),
};

test('the query is a phrase, with the artist as separate words', () => {
  assert.equal(buildQuery(' Elefantin  paino '), '"Elefantin paino"');
  assert.equal(buildQuery('Yesterday', 'The Beatles'), '"Yesterday" AND (The AND Beatles)');
  assert.equal(buildQuery('Say "hi"', 'Tapio, Juha'), '"Say hi" AND (Tapio AND Juha)');
  assert.throws(() => buildQuery('  '));
});

test('search parameters limit to scores in the chosen libraries', () => {
  const p = buildSearchParams({ title: 'Aino', libraries: ['helmet', '3amk'] });
  assert.deepEqual(p.getAll('filter[]'), [
    '~building:"0/Helmet/"', '~building:"0/3AMK/"', 'format:"0/MusicalScore/"',
  ]);
  assert.throws(() => buildSearchParams({ title: 'Aino', libraries: [] }));
});

test('MARC fields are read with entities decoded', () => {
  const [f] = parseMarc(field('730', ' ', [['a', 'A &amp; B /'], ['g', 'X &#228;']]));
  assert.equal(f.tag, '730');
  assert.deepEqual(f.subs, [['a', 'A & B /'], ['g', 'X ä']]);
  assert.deepEqual(parseMarc(undefined), []);
});

test('contents come from added titles, leaving out the book\'s own variants', () => {
  assert.deepEqual(contentsOf(HELMET), [
    { title: 'Dye my hair', by: 'Miettinen, Alma' },
    { title: 'Elefantin paino', by: 'Leikas, Ellinoora & Sirviö, Samuli' },
  ]);
});

test('contents come from a contents note', () => {
  assert.deepEqual(contentsOf(AMK).map((e) => e.title),
    ['Dye my hair', 'Elefantin paino', 'Kohta sataa']);
  assert.equal(contentsOf(AMK)[1].by, 'säv. Ellinoora Leikas, esitt. Ellinoora');
});

test('contents come from title and responsibility subfields, and from toc', () => {
  const enhanced = { fullRecord: marc(field('505', '0', [
    ['t', 'Aamu /'], ['r', 'Pepe Willberg --'], ['t', 'Ilta /'], ['r', 'Kirka.'],
  ])) };
  assert.deepEqual(contentsOf(enhanced), [
    { title: 'Aamu', by: 'Pepe Willberg' }, { title: 'Ilta', by: 'Kirka.' },
  ]);
  assert.deepEqual(contentsOf({ toc: ['Aamu / Pepe Willberg', 'Ilta'] }), [
    { title: 'Aamu', by: 'Pepe Willberg' }, { title: 'Ilta', by: '' },
  ]);
});

test('titles that share one statement are separate entries', () => {
  const rec = { fullRecord: marc(field('505', ' ', [['a',
    'Hey Jude ; Yesterday / Lennon &amp; McCartney -- Aamu / säv. X ; san. Y']])) };
  assert.deepEqual(contentsOf(rec), [
    { title: 'Hey Jude', by: 'Lennon & McCartney' },
    { title: 'Yesterday', by: 'Lennon & McCartney' },
    { title: 'Aamu', by: 'säv. X ; san. Y' },
  ]);
});

test('a long unbroken contents note is cut down to the song', () => {
  assert.equal(excerpt('Yesterday', 'yesterday'), 'Yesterday');
  const long = `${'All my loving. '.repeat(10)}Päivänsäde ja menninkäinen. ${'Help!. '.repeat(20)}`;
  const cut = excerpt(long, 'paivansade ja menninkainen');
  assert.ok(cut.includes('Päivänsäde ja menninkäinen'));
  assert.ok(cut.startsWith('… ') && cut.endsWith(' …'));
  assert.ok(cut.length < 100);
});

test('matching ignores case, accents and punctuation but keeps whole words', () => {
  assert.equal(fold('Sä & mä!'), 'sa ma');
  assert.ok(hasPhrase('Elefantin paino (akustinen)', 'elefantin PAINO'));
  assert.ok(!hasPhrase('Elefantin paino', 'Aino'));
  assert.ok(!hasPhrase('Elefantin paino', ''));
  assert.equal(findSong(contentsOf(HELMET), 'Elefantin paino').length, 1);
});

test('buildings become cities with their branches', () => {
  assert.deepEqual(placesOf(HELMET.buildings), [
    { name: 'Helsinki', branches: ['Oodi', 'Pasila'] },
    { name: 'Kauniainen', branches: [] },
  ]);
});

test('local copies are picked from the merged group, Helmet first', () => {
  const rep = { id: 'vaski.1', dedupIds: ['vaski.1', '3amk.163207', 'helmet.2276160'] };
  assert.deepEqual(localIdsOf(rep), ['helmet.2276160', '3amk.163207']);
  assert.deepEqual(localIdsOf(rep, ['3amk']), ['3amk.163207']);
});

test('a group says how the song was found', () => {
  const g = describeGroup({ id: 'vaski.1' }, [HELMET, AMK], 'Elefantin paino');
  assert.equal(g.status, 'song');
  assert.equal(g.matches[0].by, 'Leikas, Ellinoora & Sirviö, Samuli');
  assert.equal(g.holdings.length, 2);
  assert.equal(g.holdings[1].url, 'https://www.finna.fi/Record/3amk.163207');

  assert.equal(describeGroup({}, [HELMET], 'Pop tänään').status, 'title');
  assert.equal(describeGroup({}, [HELMET], 'Jokin muu').status, 'unconfirmed');
});

test('filters add their words to the query as alternatives', () => {
  assert.equal(
    buildQuery('Yesterday', 'Beatles', { instrument: 'ukulele', notation: ['tab'], easy: false }),
    '"Yesterday" AND (Beatles) AND (ukulele*) AND (tabulatuur* OR tablatur* OR tab)',
  );
  assert.equal(buildQuery('Yesterday', '', { instrument: 'theremin', notation: ['x'] }), '"Yesterday"');
  assert.deepEqual(activeFilters({ instrument: 'piano', notation: ['chords'], easy: true }),
    [['instrument', 'piano'], ['notation', 'chords'], ['level', 'easy']]);
});

test('a description is classified by whole words and word beginnings', () => {
  assert.deepEqual(classify('Easy piano | Sanat, melodia, sointumerkit. Kitaran otetaulukko.'), {
    instrument: ['piano', 'guitar'],
    notation: ['chords', 'lyrics', 'melody'],
    level: ['easy'],
  });
  // "tab" is a whole word, so a table is not tablature; a bassoon is not a bass.
  assert.deepEqual(classify('Table of bassoon pieces'),
    { instrument: [], notation: [], level: [] });
  assert.deepEqual(classify('Kitaranuotinnos vain TABULATUURINA. Taso: keskitaso').notation, ['tab']);
  assert.deepEqual(classify('Nuotinnos: kosketinsoitinsäestys').notation, ['accompaniment']);
  assert.deepEqual(classify('Sähkökitara, alkeistaso').level, ['easy']);
});

test('the classified text is the description, not the contents', () => {
  const rec = {
    title: 'Suuri toivelaulukirja',
    generalNotes: ['Sanat, melodia, sointumerkit.'],
    fullRecord: marc(
      field('650', '7', [['a', 'ukulele'], ['2', 'yso/fin'], ['0', 'http://www.yso.fi/onto/yso/p1234']]),
      field('730', ' ', [['a', 'Piano man /'], ['g', 'Joel, Billy']]),
    ),
  };
  const text = describingText(rec);
  assert.ok(text.includes('ukulele') && !text.includes('Piano man') && !text.includes('yso'));
  assert.deepEqual(classify(text).instrument, ['ukulele']);
});

test('a group carries the tags of all its copies and is checked against the filters', () => {
  const g = describeGroup({}, [HELMET, AMK], 'Elefantin paino');
  assert.deepEqual(g.tags, {
    instrument: ['guitar'], notation: ['chords', 'lyrics', 'melody'], level: [],
  });
  assert.ok(matchesFilters(g.tags, {}));
  assert.ok(matchesFilters(g.tags, { instrument: 'guitar', notation: ['chords', 'lyrics'] }));
  assert.ok(!matchesFilters(g.tags, { instrument: 'piano' }));
  assert.ok(!matchesFilters(g.tags, { notation: ['chords', 'tab'] }));
  assert.ok(!matchesFilters(g.tags, { easy: true }));
});

/** A fake fetch that answers /search and /record from the given data. */
function fakeFetch(searches, records) {
  const calls = [];
  const impl = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const body = u.pathname.endsWith('/search')
      ? searches(u.searchParams.get('lookfor'))
      : { status: 'OK', records: u.searchParams.getAll('id[]').map((id) => records[id]).filter(Boolean) };
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl, calls };
}

test('a search fetches the local copies and puts confirmed songs first', async () => {
  const other = { id: 'helmet.9', title: 'Muu kirja', fullRecord: marc() };
  const { impl, calls } = fakeFetch(() => ({
    status: 'OK',
    resultCount: 2,
    records: [
      { id: 'helmet.9', title: 'Muu kirja', dedupIds: ['helmet.9'] },
      { id: 'vaski.1', title: 'Pop tänään', dedupIds: ['vaski.1', 'helmet.2276160', '3amk.163207'] },
    ],
  }), { 'helmet.9': other, [HELMET.id]: HELMET, [AMK.id]: AMK });

  const out = await searchScores({ title: 'Elefantin paino' }, impl);
  assert.equal(out.resultCount, 2);
  assert.deepEqual(out.groups.map((g) => g.status), ['song', 'unconfirmed']);
  assert.equal(out.artistDropped, false);
  assert.equal(calls.length, 2);
});

test('a filtered search narrows the query and leaves out hits that do not fit', async () => {
  // The API matches "piano" anywhere, here in a song title in the contents.
  const pianoMan = {
    id: 'helmet.7', title: 'Kitarakirja',
    fullRecord: marc(field('730', ' ', [['a', 'Piano man /']]), field('730', ' ', [['a', 'Elefantin paino /']])),
  };
  const pianoBook = {
    id: 'helmet.8', title: 'Pop-pianisti',
    generalNotes: ['Helppoja sovituksia pianolle.'],
    fullRecord: marc(field('730', ' ', [['a', 'Elefantin paino /']])),
  };
  const { impl, calls } = fakeFetch(() => ({
    status: 'OK',
    resultCount: 2,
    records: [{ id: 'helmet.7', dedupIds: ['helmet.7'] }, { id: 'helmet.8', dedupIds: ['helmet.8'] }],
  }), { 'helmet.7': pianoMan, 'helmet.8': pianoBook });

  const out = await searchScores(
    { title: 'Elefantin paino', filters: { instrument: 'piano', easy: true } }, impl,
  );
  assert.match(calls[0].searchParams.get('lookfor'), /AND \(piano\* OR .*\) AND \(alkeistaso\* OR /);
  assert.equal(out.resultCount, 2);
  assert.equal(out.fetched, 2);
  assert.deepEqual(out.groups.map((g) => g.title), ['Pop-pianisti']);
});

test('an artist that finds nothing is dropped and reported', async () => {
  const { impl, calls } = fakeFetch((lookfor) => (lookfor.includes('AND')
    ? { status: 'OK', resultCount: 0 }
    : { status: 'OK', resultCount: 1, records: [{ id: HELMET.id, dedupIds: [HELMET.id] }] }),
  { [HELMET.id]: HELMET });

  const out = await searchScores({ title: 'Elefantin paino', artist: 'Madonna' }, impl);
  assert.equal(out.artistDropped, true);
  assert.equal(out.groups.length, 1);
  assert.equal(calls.filter((u) => u.pathname.endsWith('/search')).length, 2);
});

test('API failures become errors the page can explain', async () => {
  await assert.rejects(
    searchScores({ title: 'x' }, async () => { throw new Error('offline'); }),
    { message: 'unreachable' },
  );
  await assert.rejects(
    searchScores({ title: 'x' }, async () => ({
      ok: false, status: 400, json: async () => ({ status: 'ERROR', statusMessage: 'bad filter' }),
    })),
    { message: 'bad filter' },
  );
});
