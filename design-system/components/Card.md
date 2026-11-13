# Card

`surface` on `line`, `radius-lg`, `shadow-sm`. Three regions: `card-head` (title in `heading-sm`, actions right), `card-body` (16px padding), `card-foot` (12px, `surface-2`, status left and link right).

- `is-selected`: `brand` border and a 1px ring; one card selected at a time.
- Module cards carry a 32px icon tile in `brand-wash`.
- Image cards clip the image at the card radius; the image area shows a hatched placeholder until loaded.

A card holds one thing (a visit, a module, a creative). A grid of cards wraps at 230 to 300px columns; never nest a card in a card.
