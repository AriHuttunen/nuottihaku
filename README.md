# Nuottihaku

A static web page that finds sheet music by song title in the Helsinki-area
libraries: Helmet, Helka (University of Helsinki) and 3AMK (Haaga-Helia,
Laurea, Metropolia).

Most songs are published inside songbooks whose titles say nothing about the
song. The page searches the catalogues for the song title, then reads each
hit's catalogued contents and shows:

- whether the song is really listed in the publication, with its writers,
- the catalogue's notes, which usually say what the notation is (melody,
  lyrics, chords, tablature),
- the full contents of the publication,
- the cities, campuses and branches that hold it, with a link to the record
  page for shelf status and reservations.

Results can be narrowed by instrument, by what the notation has (chord
symbols, lyrics, melody, tablature, piano accompaniment) and to publications
marked easy. Each result shows the same properties as tags.

The page is in Finnish and English.

## How it works

The browser calls the open [Finna API](https://api.finna.fi) directly. There
is no server, no build step and no API key.

1. `/search` for the title as a phrase, limited to musical scores in the
   chosen library systems. An artist, when given, is added to the query. If
   that finds nothing, the search is repeated without the artist and the page
   says so.
2. `/record` for the Helmet, Helka and 3AMK copies of each hit, with the full
   MARC record.
3. The contents are read from the MARC record: added titles (730, 740), name
   and title entries (700) and contents notes (505). Helmet catalogues one
   added title per song, 3AMK writes a contents note.

### Filters

The catalogues have no field for the instrument, the notation or the level.
These are said in subject headings, in the title and in free-text notes such
as "Sanat, melodia, sointumerkit". `FILTERS` in `finna.js` lists, for each
filter value, the words that mean it; `piano*` is any word starting with
"piano".

A filter works in two steps:

1. Its words are added to the search query as alternatives, so Finna returns
   fewer hits. The API looks in every field, so a songbook that contains
   "Piano man" is still a hit for "piano".
2. Each hit's title, subjects and notes, but not its contents, are checked
   against the same words. Only hits that pass are shown, and the same check
   gives the tags.

Because of step 2, a page of 20 search results can show fewer than 20
publications. The page then reads on, up to four pages at a time, and says how
many search results it has read.

The word lists come from a study of about 1,000 score records for 20 popular
songs (November 2026). In that sample 85% of records named an instrument and
79% said something about the notation, but only 20% stated a level. The easy
filter therefore leaves out many publications that may be easy.

### Result marks

Each result is marked as one of:

| Mark | Meaning |
|---|---|
| Song listed | The song title is in the catalogued contents. |
| Title matches | The publication itself carries the title. |
| Unconfirmed | The search matched, but the contents do not show the song. |

## Limits

- A song is only found if a library catalogued the contents of the
  publication it is in.
- The page shows which library owns a publication, not whether a copy is on
  the shelf. Live shelf status is not in the Finna API, and the website
  endpoint that has it cannot be called from another site's page.
- The filters depend on how each publication was described. A songbook with
  guitar chord charts counts as "guitar", not only guitar arrangements; add
  the tablature filter to find those.
- Each library system needs its own library card.

## Files

- `index.html`, `style.css`: the page.
- `app.js`: form, results and the two languages.
- `finna.js`: API calls, MARC reading and matching. No DOM code, so it is
  tested in Node.
- `test/finna.test.js`: offline tests with a fake `fetch`.

## Run locally

The page uses JavaScript modules, which browsers do not load from `file://`,
so it needs a local web server:

```fish
python3 -m http.server 8000
```

Then open http://localhost:8000. A search can be linked to directly:
`http://localhost:8000/?q=Elefantin+paino&artist=Ellinoora`. Filters are in
the link too: `&inst=guitar&has=chords,tab&easy=1`.

Tests need Node 20 or newer and no dependencies:

```fish
npm test
```

## Deploy

The page is live at https://arihuttunen.github.io/nuottihaku/ on GitHub Pages,
which serves the root of the `main` branch. A push to `main` redeploys it.
Any other static host works the same way.

## Data

Metadata comes from the Finna API and is CC0. The records are provided by the
Helmet libraries, the University of Helsinki libraries and the 3AMK libraries.
Terms of use:
https://www.kiwi.fi/spaces/Finna/pages/53839699/Finna+API+Terms+of+Use

## Licence

MIT, see [LICENSE](LICENSE).
