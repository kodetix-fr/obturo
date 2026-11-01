# Third-party notices

Obturo is released under the MIT licence (see `LICENSE`). The extension package bundles a single third-party component, copied as is into `vendor/`. No other code is shipped: the development tools (`devDependencies`) are not part of the package.

## Fabric.js

| | |
|---|---|
| Project | [Fabric.js](https://github.com/fabricjs/fabric.js) |
| Version | 6.9.1 |
| Shipped file | `vendor/fabric.min.mjs` (`dist/index.min.mjs` of the npm package `fabric@6.9.1`, unmodified) |
| Licence | MIT |
| Use | rendering and editing of the annotations in the library page: the editor, and the grouped export that renders the displayed version of several captures (never in the service worker) |

The checksums of the npm package and of the shipped file, and the way to verify them, are in `vendor/README.md`.

### Licence text

The full MIT text of Fabric.js, with its two copyright lines and the sentence that requires the copyright notice to be kept, is in [`vendor/fabric.LICENSE`](vendor/fabric.LICENSE). That file travels with the component in the extension package: it is not copied here, so that only one version of the text exists. Its provenance is in `vendor/README.md`.
