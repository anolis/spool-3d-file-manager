# Spool

A local file browser and catalog for 3D printing files. Browse your folders, inspect a model in 3D, and collect the files you want to keep — along with their original archive and creator link.

Inspired by the browse-and-collect workflow in [Drape](https://github.com/anolis/drape).

[Project page](https://anolis.github.io/spool-3d-file-manager/) · [Issues](https://github.com/anolis/spool-3d-file-manager/issues)

![Spool's model preview and catalog details](docs/images/model-preview.png)

## Run locally

Requires **Node.js 22.12+** (Node 24 recommended), npm, and a browser with WebGL. Linux, macOS, and Windows can run the local server.

```sh
git clone https://github.com/anolis/spool-3d-file-manager.git
cd spool-3d-file-manager
npm install
npm run build
npm start
```

Open **http://localhost:5173**. The app binds to the loopback interface. It does not upload your models to a hosted service.

For development, use `npm run dev` instead of the build and start commands.

## What works

- **Local files:** enter a folder path and browse folders and supported files. Preview files in place; adding them to the collection makes a copy. Originals are never changed or deleted.
- **3D previews:** STL and 3MF geometry, STEP/STP converted locally using OpenCascade in a worker, and basic G-code toolpaths. Orbit, zoom, pan, reset the camera, and toggle mesh wireframes.
- **My collection:** search names, filenames, notes, tags, archive names, and source links. Filter formats and tags; sort by name, import date, or size. Grid and list views, favorites, and printed status.
- **ZIP imports:** catalog each supported file inside an archive, preserve its relative path and the original ZIP, and look for creator URLs in README, text, HTML, and URL files. Source detection is best-effort; links can be entered or corrected manually.
- **Metadata:** editable model names, source URLs, tags, and print notes.
- **Backups:** export models, original ZIPs, and catalog metadata together; restore merges by ID. Individual files and original archives can also be downloaded.
- **Discover:** unified results from connected Thingiverse and MyMiniFactory APIs, with source badges and saved links. Printables, MakerWorld, and Cults3D currently open their own search pages.

## Online catalog connections

To include provider results in the combined Discover view, supply your own keys when starting the server:

```sh
THINGIVERSE_TOKEN=your_token MYMINIFACTORY_KEY=your_key npm start
```

On Windows PowerShell, set `$env:THINGIVERSE_TOKEN` and `$env:MYMINIFACTORY_KEY` before `npm start`.

Keys remain in the server environment and are never sent to the app UI. Provider availability depends on the source site's API access and network status. Spool does not borrow tokens from other applications, bypass sign-in, or scrape protected download pages. Downloads happen on the creator's site; add the downloaded file or ZIP to Spool and retain its source link.

- [Thingiverse developer documentation](https://www.thingiverse.com/developers)
- [MyMiniFactory API documentation](https://github.com/MyMiniFactory/api-documentation)

## Storage and limits

By default, catalog data and imported files live in `.local-data/` in this checkout. Set `SPOOL_DATA_DIR` to use a different location; set `PORT` to change the production server port. Back up this directory or use **Settings & backup → Export collection**.

Imported copies and original ZIPs are retained in owned storage. Removing a model hides it from the catalog; underlying stored bytes remain to avoid accidental data loss. Local source files are always left untouched. Discover's saved links live in browser local storage and are separate from the collection backup.

Uploads and local previews are limited to 300 MB per file. ZIP imports reject archives expanding beyond 600 MB. Backups are intended for small-to-medium collections; export currently builds the archive in memory and restore has a 300 MB upload limit. Nested ZIP archives are not expanded. Very large or unusual STEP/3MF files may fail to preview; you can still catalog and download them. G-code preview supports the Three.js loader's basic commands and is not a printer simulator. STL, 3MF, and G-code coordinates are shown in file units, usually millimeters. This first version runs as a local browser app, without a native desktop wrapper.

The GitHub Pages website is a static project page. The filesystem API and application run on your own computer.

## Verification

```sh
npm test
npm run build
npm run test:ui
```

The API tests use temporary directories and a loopback HTTP server. Browser tests use Playwright and Chrome, with isolated catalog data and synthetic models. Set `CHROME_PATH` to your Chrome/Chromium executable if it is not `/usr/bin/google-chrome`.

## License

Spool source is MIT licensed. OpenCascade and occt-import-js are distributed under LGPL-2.1; their notices are included in `public/occt/`. Other dependencies retain their own licenses. User models and creator content retain their original licenses.
