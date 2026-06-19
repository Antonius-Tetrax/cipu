# 宋词可视化词谱 · Song-ci Visual Tone Templates

A static web app showing, for each 词牌 (and 体), the empirical per-position tone
distribution (平/上/去/入) over ~21,050 Song-dynasty 词, overlaid on the 钦定词谱 codes,
with an author roster you can filter by region, era, output, and name.

**Live site:** see the GitHub Pages URL in this repository's *Settings → Pages*.

This is a fully static site — the data loads via `fetch`, so it must be served by a web
host (GitHub Pages works; double-clicking `index.html` locally will not).

## Data sources (all openly licensed)
- 词 corpus: [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) (MIT)
- Tones: 平水韻 / 廣韻 via [ytenx](https://github.com/BYVoid/ytenx)
- 词谱 overlay: 钦定词谱 via [blankego/LyricPatterns](https://github.com/blankego/LyricPatterns) (MIT)

Corpus text is uncertified; example lines are illustrative, not an authoritative edition.
