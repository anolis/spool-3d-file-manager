# Third-party components

`public/occt/` contains the unmodified JavaScript and WebAssembly distribution of
[occt-import-js 0.0.23](https://github.com/kovacsv/occt-import-js), including OpenCascade.
The upstream license texts are included alongside those assets. These components are
licensed under LGPL-2.1, separately from Spool's MIT-licensed application code.

Source and build instructions: https://github.com/kovacsv/occt-import-js
OpenCascade source: https://github.com/Open-Cascade-SAS/OCCT

The STEP worker dynamically loads these files; users can replace the JS/WASM pair
with a compatible build from the upstream sources. The build copies `public/`
without transforming these files. Run `npm run build` again after replacing them.

React, Three.js, Lucide, fflate, and other npm dependencies retain their respective
licenses in their package distributions. The lockfile records exact versions.
Screenshots use synthetic test geometry; no user collection is distributed.
