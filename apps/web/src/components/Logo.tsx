/**
 * The Novira mark.
 *
 * An N built as a length of box truss — the one object everyone in this trade
 * touches, and the reason the letterform reads as *this* industry rather than
 * as a generic tech logo.
 *
 * It renders as the white cut-out on an azure tile. That is not the only
 * version — `logo-mark.png` (azure) and `logo-mark-black.png` are both in
 * `public/` — but it is the one the product wears, for two reasons. The tile
 * keeps the exact geometry the header has always had, so nothing moves for
 * anyone who knows where to click. And a mark on a coloured field holds its
 * shape at 28 px, where a fine azure truss on white turns to mush.
 *
 * The image is decorative: every caller pairs it with the wordmark or an
 * accessible label, so a second announcement of "Novira" is noise.
 */
export function LogoMark({
  size = 28,
  className,
}: {
  /** Edge length in pixels. The tile is square. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg bg-primary shadow-btn ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/logo-mark-white.png"
        alt=""
        aria-hidden
        draggable={false}
        /*
         * Inset, so the truss has air inside the tile rather than touching the
         * corner radius. 72% is where the mark reads as a logo on a badge
         * instead of as a cropped picture.
         */
        style={{ width: size * 0.72, height: size * 0.72 }}
        className="object-contain"
      />
    </span>
  );
}

/**
 * The mark and the word together.
 *
 * Used wherever the brand identifies the whole product — the app header, the
 * landing page, a shared plan someone opened from a link. The wordmark is set
 * in the interface font rather than shipped as an image, so it stays crisp at
 * every size and inherits the page's colour.
 */
export function Wordmark({
  size = 28,
  text = 'text-[15px]',
  className,
}: {
  size?: number;
  /** Type scale for the word, so a header and a hero can differ. */
  text?: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark size={size} />
      <span className={`${text} font-black tracking-tight text-ink`}>Novira</span>
    </span>
  );
}
