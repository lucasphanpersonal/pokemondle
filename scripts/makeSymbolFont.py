"""
Builds src/assets/fonts/pixel-symbols.woff2: the ♀ and ♂ signs drawn on Press Start 2P's own grid, which has no
glyphs for them (so "Nidoran♀" lost its sign, or showed a smooth system-font one). index.css loads it after
Press Start 2P with a unicode-range of just these two characters, so the browser only uses it for them.

Same metrics as Press Start 2P: 1000 units per em, 8 x 8 pixels of 125 units, capitals 7 pixels wide and
7 tall sitting one pixel above the baseline, 2-pixel-wide upright strokes and 1-pixel-tall flat ones.

Run with `npm run font` (needs Python 3 with fonttools and brotli: `pip install fonttools brotli`).
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

PX = 125
GLYPHS = {
    0x2640: ("female", [
        ".#####.",
        "##...##",
        "##...##",
        ".#####.",
        "...#...",
        ".#####.",
        "...#...",
    ]),
    0x2642: ("male", [
        "...####",
        ".....##",
        ".####.#",
        "##..##.",
        "##..##.",
        "##..##.",
        ".####..",
    ]),
}


def draw(rows):
    pen = TTGlyphPen(None)
    for r, row in enumerate(rows):
        y = (len(rows) - r) * PX  # the bottom row sits one pixel above the baseline, as in Press Start 2P
        x = 0
        while x < len(row):
            if row[x] != "#":
                x += 1
                continue
            end = x
            while end < len(row) and row[end] == "#":
                end += 1
            # One rectangle per run of pixels, clockwise (TrueType outer contours).
            pen.moveTo((x * PX, y))
            pen.lineTo((x * PX, y + PX))
            pen.lineTo((end * PX, y + PX))
            pen.lineTo((end * PX, y))
            pen.closePath()
            x = end
    return pen.glyph()


def main():
    names = [".notdef"] + [name for name, _ in GLYPHS.values()]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({cp: name for cp, (name, _) in GLYPHS.items()})
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    glyphs.update({name: draw(rows) for name, rows in GLYPHS.values()})
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({n: (1000, 0) for n in names})  # every glyph is 1em wide and starts at x = 0
    fb.setupHorizontalHeader(ascent=1000, descent=0)
    fb.setupNameTable({"familyName": "Pokemondle Pixel Symbols", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=1000, sTypoDescender=0, sTypoLineGap=0, usWinAscent=1000, usWinDescent=374)
    fb.setupPost()
    # Fixed timestamps, so rerunning the script gives the same bytes and no git diff.
    fb.font["head"].created = fb.font["head"].modified = 0
    fb.font.flavor = "woff2"
    out = Path(__file__).resolve().parent.parent / "src/assets/fonts/pixel-symbols.woff2"
    fb.save(str(out))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
