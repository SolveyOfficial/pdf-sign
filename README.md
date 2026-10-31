# Solvey Fill & Sign

Fill and sign PDFs for free, entirely in your browser.

Live: https://solveyofficial.github.io/pdf-sign/

- **Signature**: draw it with a mouse, finger or stylus (black or blue ink, any
  thickness), type your name in a handwriting font, or upload a photo of your
  signature and make the white paper transparent
- **Text and dates**: any size and colour; dates are filled in as DD/MM/YYYY
  and can be edited
- **Ticks, crosses and white-out**: mark boxes, or cover text you want to hide
- **Forms**: PDFs with fillable fields (text boxes, checkboxes, lists and
  option buttons) can be filled in, with a live preview, and optionally
  flattened
- Move, resize and delete anything you place, with undo; zoom in and out
- Saving writes everything into the PDF at the exact spot, keeps the original
  text selectable, and downloads `<name>-signed.pdf`
- Signatures are only remembered on your device if you tick "Remember on this
  device", and can be forgotten at any time

Works on phones too: tap a tool, then tap the page.

## Private by design

Your files are never uploaded. The app has no analytics or tracking, and it
serves its own fonts and PDF renderer, so it loads nothing from other sites.
Remembered signatures are kept in your browser's local storage only.

Built with [pdf-lib](https://pdf-lib.js.org) and Mozilla's
[pdf.js](https://mozilla.github.io/pdf.js/). Typed signatures use the Caveat
and Dancing Script fonts.

## Limitations

- Text written in scripts other than Latin (for example Hindi) is added as a
  picture, so it is not selectable in the saved PDF.
- Form fields can only hold Latin letters, numbers and common symbols.
- PDFs protected with a password cannot be changed.
- Signatures added here are pictures of a signature, not certificate-based
  digital signatures.

## Development

You need Node.js 22.13 or later.

```sh
npm install
npm run dev        # development server
npm run lint       # Prettier and ESLint
npm run typecheck  # TypeScript
npm test           # unit tests
npm run build      # production build in dist/
```

Set `BASE_PATH` (for example `BASE_PATH=/pdf-sign/`) when the app is served
from a sub-path. The build also writes `THIRD_PARTY_NOTICES.md`, listing every
bundled package, font and data file with its licence; the app links to it as
"Licences".

When the repository is public, every push to `main` is published to GitHub
Pages.

## Licence

MIT, see LICENSE.
