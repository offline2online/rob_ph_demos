#!/usr/bin/env python3
# Cuts the Material Symbols font down to the icons the screen can show: the ones the editor's icon picker offers
# (admin/js/icons.js) and the screen's own (tv_off). Called by tools/fetch-fonts.mjs at build time, never at runtime.
#
#   python3 tools/subset-icons.py <full.woff2> <names.txt> <out.woff2>
#
# The icons are ligatures (the text "local_pharmacy" becomes one glyph), so the font keeps the letters, digits and
# "_" the names are spelled with, the ligature glyph of each name, and only the ligature rules that make those
# glyphs (no layout closure: every other icon is dropped). Prints the names the font does not have.
# Needs fontTools with brotli: pip install fonttools brotli
import sys
from fontTools.ttLib import TTFont
from fontTools import subset


def ligatures(font):
    """{icon name: ligature glyph} from the font's GSUB ligature lookups."""
    rev = {g: chr(u) for u, g in font.getBestCmap().items()}
    out = {}
    for lookup in font['GSUB'].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if lookup.LookupType == 7:
                st = st.ExtSubTable
            if getattr(st, 'LookupType', None) != 4:
                continue
            for first, ligs in st.ligatures.items():
                for lig in ligs:
                    out[''.join(rev.get(g, '\0') for g in [first] + lig.Component)] = lig.LigGlyph
    return out


def main(src, names_file, dst):
    font = TTFont(src)
    lig = ligatures(font)
    names = sorted({n.strip() for n in open(names_file, encoding='utf-8').read().split() if n.strip()})
    have = [n for n in names if n in lig]
    missing = [n for n in names if n not in lig]
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_closure = False
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(glyphs=[lig[n] for n in have], text=''.join(sorted(set(''.join(have)))))
    sub.subset(font)
    font.save(dst)
    print(f'{len(have)} icons kept' + (f'; not in the font: {", ".join(missing)}' if missing else ''))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit('usage: subset-icons.py <full.woff2> <names.txt> <out.woff2>')
    main(*sys.argv[1:])
