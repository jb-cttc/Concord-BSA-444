#!/usr/bin/env python3
"""Draws the Troop 444 logo: the Golden Gate Area Council shoulder patch with
the 444 unit numerals under it, traced from a photo of a uniform sleeve.

    pip install fonttools
    python3 make-logo.py <Nunito Black .ttf> <output dir>

Writes logo.svg (the badge, transparent background) and icon.svg (square app
icon on uniform blue). render-png.cjs turns them into PNGs.

The lettering uses Nunito Black (SIL Open Font License, Google Fonts), turned
into outlines so the SVG looks the same everywhere without the font.
Coordinates: the council patch fills 0..1300 x 0..612; the numerals sit below.
"""
import math
import os
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT, OUT = sys.argv[1], sys.argv[2]

# ---------- colours (sampled from the photo, then evened out) ----------
NAVY = '#24406f'        # letter shadow, fleur outline, birds
SLATE = '#4f70a6'       # letter outline
WHITE = '#f7f8f6'
SKY_HI, SKY_LO = '#cfe6f8', '#86b5e0'
ORANGE, ORANGE_DK, ORANGE_HI = '#ea8a2b', '#c4621c', '#f6ac55'
RED, RED_DK, RED_HI = '#d42b26', '#9a1c18', '#ef5c4c'
GREEN_DK, GREEN, GREEN_LT, MIST = '#3a855a', '#5aa874', '#9dd3a8', '#dcf1e7'
WATER = '#a7cdeb'
LEAF_DK, LEAF_LT = '#2d6845', '#86b896'
POPPY_HI, POPPY, POPPY_DK, POPPY_EDGE = '#ffe36a', '#f9bd2e', '#f0901e', '#df6c1c'
SHIRT = '#3e5383'


def f(v):
    return f'{v:.1f}'.rstrip('0').rstrip('.')


def pts(ps):
    return ' '.join(f'{f(x)},{f(y)}' for x, y in ps)


# ---------- curves ----------
def cubic(p0, p1, p2, p3, t):
    u = 1 - t
    return (u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1])


def sample(segs, n=400):
    """Points along a chain of cubic segments, evenly spaced in t."""
    out = []
    for seg in segs:
        for i in range(n + 1):
            out.append(cubic(*seg, i / n))
    return out


def y_at(points, x):
    """y of a sampled curve at x (curve must be monotone in x there)."""
    best = min(points, key=lambda p: abs(p[0] - x))
    return best[1]


def seg_path(segs):
    d = f'M{f(segs[0][0][0])},{f(segs[0][0][1])}'
    for _, a, b, c in segs:
        d += f' C{f(a[0])},{f(a[1])} {f(b[0])},{f(b[1])} {f(c[0])},{f(c[1])}'
    return d


# ---------- patch outline ----------
CSP = ('M22,300 C180,95 420,28 650,28 C880,28 1120,95 1278,300 Q1293,322 1284,348 '
       'L1200,590 Q1189,614 1160,614 L140,614 Q111,614 100,590 L16,348 Q7,322 22,300 Z')

# ---------- lettering ----------
font = TTFont(FONT)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
UPM = font['head'].unitsPerEm


def glyph(ch, size, sx=1.0):
    g = glyphs[cmap[ord(ch)]]
    pen = SVGPathPen(glyphs, ntos=lambda v: f(v))
    s = size / UPM
    g.draw(TransformPen(pen, (s * sx, 0, 0, -s, 0, 0)))
    return pen.getCommands(), g.width * s * sx


def lettering():
    text = 'GOLDEN GATE AREA COUNCIL'
    size, sx, space = 90, 0.84, 34
    # Baseline: flat across the middle, dropping steeply at both ends, like
    # the arch of the patch.
    base = [((124, 342), (235, 190), (400, 170), (650, 168)),
            ((650, 168), (900, 170), (1065, 190), (1176, 342))]
    line = sample(base, 600)
    acc = [0.0]
    for a, b in zip(line, line[1:]):
        acc.append(acc[-1] + math.dist(a, b))
    total = acc[-1]
    items = [(ch, *glyph(ch, size, sx)) if ch != ' ' else (ch, '', space) for ch in text]
    widths = sum(w for _, _, w in items)
    track = (total - widths) / (len(items) - 1)
    out, s = [], 0.0
    for ch, d, w in items:
        mid = s + w / 2
        s += w + track
        if ch == ' ':
            continue
        i = min(range(len(acc)), key=lambda k: abs(acc[k] - mid))
        a, b = line[max(i - 1, 0)], line[min(i + 1, len(line) - 1)]
        ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        x, y = line[i]
        out.append(f'<path transform="translate({f(x)},{f(y)}) rotate({f(ang)}) translate({f(-w / 2)},0)" d="{d}"/>')
    return '\n'.join(out)


# ---------- fleur-de-lis ----------
def fleur(cx, cy, k=1.0):
    def half(sign):
        def P(x, y):
            return f'{f(cx + sign * x * k)},{f(cy + y * k)}'
        return P
    R, L = half(1), half(-1)
    # Upper outline: pointed centre petal, then each side petal rising
    # beside it, rounding over and curling down into a ring at band level.
    d = (f'M{R(0, -140)} C{R(10, -122)} {R(27, -102)} {R(28, -82)} '
         f'C{R(29, -62)} {R(21, -46)} {R(13, -34)} '
         f'C{R(22, -60)} {R(36, -82)} {R(58, -84)} '
         f'C{R(82, -86)} {R(102, -66)} {R(100, -42)} '
         f'C{R(98, -22)} {R(82, -8)} {R(64, -4)} '
         f'L{R(46, 2)} L{L(46, 2)} L{L(64, -4)} '
         f'C{L(82, -8)} {L(98, -22)} {L(100, -42)} '
         f'C{L(102, -66)} {L(82, -86)} {L(58, -84)} '
         f'C{L(36, -82)} {L(22, -60)} {L(13, -34)} '
         f'C{L(21, -46)} {L(29, -62)} {L(28, -82)} '
         f'C{L(27, -102)} {L(10, -122)} {L(0, -140)} Z')
    # Lower piece under the band: two rounded lobes meeting in a point.
    low = (f'M{L(54, -2)} L{R(54, -2)} C{R(66, 8)} {R(62, 26)} {R(44, 31)} '
           f'C{R(24, 35)} {R(7, 42)} {R(0, 58)} '
           f'C{L(7, 42)} {L(24, 35)} {L(44, 31)} C{L(62, 26)} {L(66, 8)} {L(54, -2)} Z')
    band = f'M{L(40, -12)} L{R(40, -12)} L{R(40, 1)} L{L(40, 1)} Z'
    # Where the side petals tuck behind the centre petal, down to the band.
    inner = (f'M{R(13, -34)} C{R(10, -26)} {R(12, -18)} {R(14, -12)} '
             f'M{L(13, -34)} C{L(10, -26)} {L(12, -18)} {L(14, -12)}')
    curls = ''
    for sign in (1, -1):
        x, y = cx + sign * 47 * k, cy - 6 * k
        curls += (f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(11 * k)}" fill="{WHITE}" stroke="{NAVY}" stroke-width="{f(6.5 * k)}"/>'
                  f'<path d="M{f(x - sign * 4 * k)},{f(y - 3 * k)} Q{f(x + sign * 3 * k)},{f(y - 4 * k)} {f(x + sign * 2 * k)},{f(y + 3 * k)}" '
                  f'fill="none" stroke="{SLATE}" stroke-width="{f(3 * k)}" stroke-linecap="round"/>')
    return f'''<g stroke-linejoin="round">
  <path d="{low}" fill="{NAVY}" stroke="{NAVY}" stroke-width="{f(15 * k)}"/>
  <path d="{d}" fill="{NAVY}" stroke="{NAVY}" stroke-width="{f(15 * k)}"/>
  <path d="{low}" fill="url(#satin)" stroke="{SLATE}" stroke-width="{f(4 * k)}"/>
  <path d="{d}" fill="url(#satin)" stroke="{SLATE}" stroke-width="{f(4 * k)}"/>
  <path d="{inner}" fill="none" stroke="{SLATE}" stroke-width="{f(3 * k)}" stroke-linecap="round"/>
  <path d="{band}" fill="{WHITE}" stroke="{NAVY}" stroke-width="{f(4.5 * k)}"/>
  {curls}
</g>'''


# ---------- sky ----------
def rays(cx, cy):
    out = []
    n = 26
    for i in range(n):
        if i % 2:
            continue
        a0 = 2 * math.pi * i / n
        a1 = 2 * math.pi * (i + 0.6) / n
        r = 1400
        out.append(f'<path d="M{cx},{cy} L{f(cx + r * math.cos(a0))},{f(cy + r * math.sin(a0))} '
                   f'L{f(cx + r * math.cos(a1))},{f(cy + r * math.sin(a1))} Z"/>')
    return f'<g fill="#ffffff" opacity="0.22">{"".join(out)}</g>'


# ---------- bridge ----------
DECK = [((40, 572), (300, 470), (600, 400), (905, 382)), ((905, 382), (960, 380), (1000, 376), (1060, 372))]
deck_line = sample(DECK, 300)


def deck():
    top, bot = [], []
    n = len(deck_line)
    for i, (x, y) in enumerate(deck_line):
        u = min(1, max(0, (x - 40) / 865))
        top.append((x, y - (17 * (1 - u) + 10 * u)))
        bot.append((x, y + (22 * (1 - u) + 12 * u)))
    body = f'<path d="M{pts(top)} L{pts(bot[::-1])} Z" fill="{ORANGE}"/>'
    # Lower half darker: the side of the deck in shadow.
    mid = [(x, (a[1] + b[1]) / 2 + 2) for (x, _), a, b in zip(deck_line, top, bot)]
    shade = f'<path d="M{pts(mid)} L{pts(bot[::-1])} Z" fill="{ORANGE_DK}" opacity="0.55"/>'
    # Truss: a zigzag along the deck, as the embroidery shows.
    zig, step, flip = [], 9, 0
    xs = [x for x in range(48, 1060, step)]
    for x in xs:
        i = min(range(n), key=lambda k: abs(deck_line[k][0] - x))
        t, b = top[i], bot[i]
        zig.append((x, t[1] + (b[1] - t[1]) * (0.25 if flip else 0.78)))
        flip ^= 1
    truss = f'<polyline points="{pts(zig)}" fill="none" stroke="{ORANGE_DK}" stroke-width="2.1" stroke-linejoin="round"/>'
    hi = f'<polyline points="{pts(top)}" fill="none" stroke="{ORANGE_HI}" stroke-width="3"/>'
    return body + shade + truss + hi, top


def leg(x0t, x1t, yt, x0b, x1b, yb, grooves=1):
    s = f'<path d="M{f(x0t)},{f(yt)} L{f(x1t)},{f(yt)} L{f(x1b)},{f(yb)} L{f(x0b)},{f(yb)} Z" fill="{ORANGE}"/>'
    # Shadowed right face.
    w_t, w_b = x1t - x0t, x1b - x0b
    s += (f'<path d="M{f(x1t - w_t * 0.3)},{f(yt)} L{f(x1t)},{f(yt)} L{f(x1b)},{f(yb)} L{f(x1b - w_b * 0.3)},{f(yb)} Z" '
          f'fill="{ORANGE_DK}" opacity="0.6"/>')
    for g in range(grooves):
        q = (g + 1) / (grooves + 1) * 0.7
        s += (f'<line x1="{f(x0t + w_t * q)}" y1="{f(yt + 4)}" x2="{f(x0b + w_b * q)}" y2="{f(yb)}" '
              f'stroke="{ORANGE_DK}" stroke-width="1.6" opacity="0.7"/>')
    return s


def strut(xl, xr, y, h, arch):
    return (f'<path d="M{f(xl)},{f(y)} L{f(xr)},{f(y)} L{f(xr)},{f(y + h)} '
            f'Q{f((xl + xr) / 2)},{f(y + h - arch)} {f(xl)},{f(y + h)} Z" fill="{ORANGE}" '
            f'stroke="{ORANGE_DK}" stroke-width="1.6"/>')


def bridge():
    out = []
    deck_svg, deck_top = deck()
    # Cables. Near (front) and far main cables; backstays to the left shore.
    near = [((264, 266), (330, 340), (440, 398), (556, 398)), ((556, 398), (700, 398), (850, 250), (914, 96))]
    far = [((270, 280), (336, 350), (446, 404), (562, 405)), ((562, 405), (700, 405), (840, 300), (912, 232))]
    back1 = [((262, 268), (190, 350), (110, 420), (30, 470))]
    back2 = [((186, 296), (140, 360), (90, 430), (30, 510))]
    near_pts, far_pts = sample(near, 300), sample(far, 300)
    b1, b2 = sample(back1, 200), sample(back2, 200)

    def suspenders(curve, x0, x1, step, width, op):
        s = []
        for x in range(x0, x1, step):
            cy = y_at(curve, x)
            dy = y_at(deck_top, x)
            if dy - cy > 6:
                s.append(f'<line x1="{x}" y1="{f(cy)}" x2="{x}" y2="{f(dy)}"/>')
        return f'<g stroke="{ORANGE}" stroke-width="{width}" opacity="{op}">{"".join(s)}</g>'

    # Back to front: far cable and its hangers, right tower, deck, near
    # cable, left tower.
    out.append(suspenders(far_pts, 300, 900, 34, 1.8, 0.75))
    out.append(f'<path d="{seg_path(far)}" fill="none" stroke="{ORANGE}" stroke-width="6.5" stroke-linecap="round"/>')
    # Right tower (close to the viewer, so big; its top runs under the border).
    out.append(leg(1028, 1064, 60, 1024, 1066, 430, 1))
    out.append(strut(950, 1032, 112, 56, 12))
    out.append(strut(950, 1032, 344, 28, 6))
    out.append(f'<line x1="988" y1="166" x2="984" y2="350" stroke="{ORANGE}" stroke-width="2.4" opacity="0.8"/>')
    out.append(leg(896, 952, 40, 890, 956, 440, 2))
    out.append(deck_svg)
    out.append(suspenders(near_pts, 290, 895, 36, 3, 1))
    out.append(suspenders(b1, 50, 250, 30, 2.8, 1))
    out.append(suspenders(b2, 48, 180, 30, 2.4, 0.85))
    for c, w in ((back2, 6), (back1, 7)):
        out.append(f'<path d="{seg_path(c)}" fill="none" stroke="{ORANGE}" stroke-width="{w}" stroke-linecap="round"/>')
    out.append(f'<path d="{seg_path(near)}" fill="none" stroke="{ORANGE_DK}" stroke-width="10.5" stroke-linecap="round"/>')
    out.append(f'<path d="{seg_path(near)}" fill="none" stroke="{ORANGE}" stroke-width="7.5" stroke-linecap="round"/>')
    # Left tower: far leg, portal struts, near leg running down to the water.
    out.append(leg(249, 271, 258, 247, 275, 508, 1))
    out.append(strut(186, 256, 300, 14, 4))
    out.append(strut(186, 256, 384, 13, 4))
    out.append(strut(186, 256, 452, 14, 4))
    out.append(leg(172, 195, 288, 164, 193, 584, 1))
    # Tower caps.
    out.append(f'<rect x="250" y="250" width="24" height="10" rx="2" fill="{ORANGE}" stroke="{ORANGE_DK}" stroke-width="1.5"/>')
    out.append(f'<rect x="173" y="280" width="24" height="10" rx="2" fill="{ORANGE}" stroke="{ORANGE_DK}" stroke-width="1.5"/>')
    return '\n'.join(out)


# ---------- hills, water, boat, birds ----------
def landscape():
    hill = ('M60,560 C120,552 200,548 280,540 C380,528 470,494 550,464 C590,449 630,444 664,452 '
            'C700,460 730,480 760,505 L760,620 L60,620 Z')
    band = ('M60,572 C150,566 260,560 360,548 C440,538 520,512 600,496 C650,488 700,500 760,520 '
            'L760,620 L60,620 Z')
    band2 = ('M60,582 C160,578 280,574 380,566 C460,558 560,540 640,534 C690,532 730,540 760,548 '
             'L760,620 L60,620 Z')
    mist = ('M60,592 C200,588 300,584 400,576 C480,570 560,560 640,558 C690,558 730,564 760,570 '
            'L760,620 L60,620 Z')
    water = 'M0,600 L1300,600 L1300,640 L0,640 Z'
    # Stitch texture on the hill.
    tex = []
    for i in range(18):
        y = 470 + i * 7
        tex.append(f'M{300 + i * 5},{y} C{420 + i * 3},{y - 8} {560},{y - 22 + i * 1.2} {700},{y - 4}')
    return f'''<path d="{hill}" fill="{GREEN_DK}"/>
<clipPath id="hillclip"><path d="{hill}"/></clipPath>
<path d="{' '.join(tex)}" fill="none" stroke="#2f7550" stroke-width="1.4" opacity="0.45" clip-path="url(#hillclip)"/>
<path d="{band}" fill="{GREEN}"/>
<path d="{band2}" fill="{GREEN_LT}"/>
<path d="{mist}" fill="{MIST}"/>
<path d="{water}" fill="{WATER}"/>'''


def sailboat():
    return f'''<g stroke-linejoin="round" transform="translate(0,-14)">
  <path d="M292,480 L292,556 L228,556 Z" fill="{WHITE}" stroke="{SLATE}" stroke-width="4"/>
  <path d="M300,476 L300,556 L348,556 Z" fill="{WHITE}" stroke="{SLATE}" stroke-width="4"/>
  <path d="M265,520 L292,512 M262,540 L292,534" stroke="#d9dee6" stroke-width="2"/>
  <line x1="296" y1="470" x2="296" y2="560" stroke="{NAVY}" stroke-width="4" stroke-linecap="round"/>
  <path d="M218,560 L360,560 Q352,586 330,590 L246,590 Q226,586 218,560 Z" fill="#b9cde6" stroke="{NAVY}" stroke-width="5"/>
  <path d="M232,568 L346,568" stroke="{WHITE}" stroke-width="4" stroke-linecap="round"/>
</g>'''


def bird(x, y, k):
    return (f'<path d="M{f(x - 20 * k)},{f(y)} Q{f(x - 9 * k)},{f(y - 10 * k)} {f(x)},{f(y + 3 * k)} '
            f'Q{f(x + 9 * k)},{f(y - 10 * k)} {f(x + 20 * k)},{f(y - 2 * k)}" fill="none" stroke="{NAVY}" '
            f'stroke-width="{f(5 * k + 1)}" stroke-linecap="round" stroke-linejoin="round"/>')


# ---------- poppies and foliage ----------
grads = []


def petal(cx, cy, ang, L, W, gid):
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))

    def P(x, y):
        return f'{f(cx + x * c - y * s)},{f(cy + x * s + y * c)}'
    d = (f'M{P(0, 0)} C{P(0.2 * L, -0.45 * W)} {P(0.55 * L, -0.62 * W)} {P(0.82 * L, -0.46 * W)} '
         f'C{P(1.0 * L, -0.34 * W)} {P(1.05 * L, -0.12 * W)} {P(0.95 * L, 0.0)} '
         f'C{P(1.05 * L, 0.12 * W)} {P(1.0 * L, 0.32 * W)} {P(0.86 * L, 0.45 * W)} '
         f'C{P(0.6 * L, 0.62 * W)} {P(0.2 * L, 0.45 * W)} {P(0, 0)} Z')
    vein = f'M{P(0.12 * L, 0.02 * W)} C{P(0.4 * L, 0.08 * W)} {P(0.6 * L, -0.04 * W)} {P(0.8 * L, -0.06 * W)}'
    return (f'<path d="{d}" fill="url(#{gid})" stroke="{POPPY_EDGE}" stroke-width="2.4" stroke-linejoin="round"/>'
            f'<path d="{vein}" fill="none" stroke="{POPPY_DK}" stroke-width="1.6" opacity="0.55"/>')


def poppy(cx, cy, L, W, angles, gid, centre=True):
    grads.append(f'<radialGradient id="{gid}" gradientUnits="userSpaceOnUse" cx="{cx}" cy="{cy}" r="{f(L * 1.05)}">'
                 f'<stop offset="0" stop-color="#fff27c"/><stop offset="0.2" stop-color="#fbd23e"/>'
                 f'<stop offset="0.42" stop-color="{POPPY_DK}"/><stop offset="0.75" stop-color="{POPPY}"/>'
                 f'<stop offset="1" stop-color="{POPPY_HI}"/></radialGradient>')
    s = ''.join(petal(cx, cy, a, L * k, W * k, gid) for a, k in angles)
    if centre:
        rays_ = []
        for i in range(16):
            a = 2 * math.pi * i / 16 + 0.2
            r0, r1 = 7, 18 + 8 * (i % 2)
            rays_.append(f'M{f(cx + r0 * math.cos(a))},{f(cy + r0 * math.sin(a))} L{f(cx + r1 * math.cos(a))},{f(cy + r1 * math.sin(a))}')

        s += f'<path d="{" ".join(rays_)}" stroke="#d3dc58" stroke-width="2.6" stroke-linecap="round"/>'
        s += f'<circle cx="{cx}" cy="{cy}" r="6.5" fill="#dcedf8" stroke="#9cc3df" stroke-width="2"/>'
    return s


def cup(gid):
    # The side-on poppy at the lower left of the flowers.
    grads.append(f'<radialGradient id="{gid}" gradientUnits="userSpaceOnUse" cx="790" cy="520" r="120">'
                 f'<stop offset="0" stop-color="{POPPY_HI}"/><stop offset="0.55" stop-color="{POPPY}"/>'
                 f'<stop offset="1" stop-color="{POPPY_DK}"/></radialGradient>')
    body = 'M706,620 C700,560 708,500 742,470 C772,446 820,440 852,452 C884,464 900,500 898,540 C896,580 890,610 886,620 Z'
    lines = ('M748,470 C736,510 744,560 764,612 M822,446 C842,480 846,540 836,612 '
             'M742,470 C780,486 820,482 852,452')
    return (f'<path d="{body}" fill="url(#{gid})" stroke="{POPPY_EDGE}" stroke-width="3"/>'
            f'<path d="{lines}" fill="none" stroke="{POPPY_EDGE}" stroke-width="2.6" stroke-linecap="round"/>')


def bud(x, y, ang, L, W, gid):
    grads.append(f'<linearGradient id="{gid}" x1="0" y1="1" x2="0" y2="0">'
                 f'<stop offset="0" stop-color="{POPPY_DK}"/><stop offset="0.6" stop-color="{POPPY}"/>'
                 f'<stop offset="1" stop-color="{POPPY_HI}"/></linearGradient>')
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))

    def P(a, b):
        return f'{f(x + a * c - b * s)},{f(y + a * s + b * c)}'
    d = (f'M{P(0, -W / 2)} C{P(0.5 * L, -0.62 * W)} {P(0.85 * L, -0.4 * W)} {P(L, 0)} '
         f'C{P(0.85 * L, 0.4 * W)} {P(0.5 * L, 0.62 * W)} {P(0, W / 2)} Z')
    return (f'<path d="{d}" fill="url(#{gid})" stroke="{POPPY_EDGE}" stroke-width="2.6"/>'
            f'<path d="M{P(0.1 * L, 0)} L{P(0.85 * L, 0)}" stroke="{POPPY_EDGE}" stroke-width="2" opacity="0.7"/>')


def sprig(x0, y0, x1, y1, n, size, bend=0.15, seed=1):
    """A bushy clump of poppy leaves: a few fronds fanning from one base,
    each with uneven leaflets, dark green with sage highlights."""
    rnd = seed * 9301 + 49297

    def r():
        nonlocal rnd
        rnd = (rnd * 9301 + 49297) % 233280
        return rnd / 233280

    height = math.dist((x0, y0), (x1, y1))
    base_ang = math.atan2(y1 - y0, x1 - x0)
    dk, lt, stems = [], [], []
    for frond in (-0.32, 0.0, 0.3):
        a0 = base_ang + frond + (r() - 0.5) * 0.15
        h = height * (1.0 if frond == 0 else 0.7 + 0.15 * r())
        ex, ey = x0 + h * math.cos(a0), y0 + h * math.sin(a0)
        nx, ny = -(ey - y0), (ex - x0)
        cx, cy = (x0 + ex) / 2 + nx * bend, (y0 + ey) / 2 + ny * bend
        stems.append(f'M{f(x0)},{f(y0)} Q{f(cx)},{f(cy)} {f(ex)},{f(ey)}')
        m = max(3, round(n * h / height))
        for i in range(1, m + 1):
            t = i / (m + 0.6)
            px = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * ex
            py = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * ey
            tx = 2 * (1 - t) * (cx - x0) + 2 * t * (ex - cx)
            ty = 2 * (1 - t) * (cy - y0) + 2 * t * (ey - cy)
            a = math.atan2(ty, tx)
            for side in (-1, 1):
                ln = size * (1.05 - 0.55 * t) * (0.7 + 0.5 * r())
                b = a + side * (0.7 + 0.5 * r())
                qx, qy = px + ln * math.cos(b), py + ln * math.sin(b)
                dk.append(f'M{f(px)},{f(py)} L{f(qx)},{f(qy)}')
                if r() > 0.35:
                    lt.append(f'M{f(px + (qx - px) * 0.5)},{f(py + (qy - py) * 0.5)} L{f(qx)},{f(qy)}')
    return (f'<g stroke-linecap="round" fill="none"><path d="{" ".join(stems)}" stroke="{LEAF_DK}" stroke-width="3.4"/>'
            f'<path d="{" ".join(dk)}" stroke="{LEAF_DK}" stroke-width="6"/>'
            f'<path d="{" ".join(lt)}" stroke="{LEAF_LT}" stroke-width="2.6"/></g>')


def flowers():
    grads.append(f'<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{POPPY}"/>'
                 f'<stop offset="1" stop-color="{POPPY_DK}"/></linearGradient>')
    bed = ('M700,620 L700,520 C712,470 760,446 800,438 C840,430 870,410 905,398 C960,385 1010,372 1050,350 '
           'C1080,330 1110,300 1150,288 C1200,276 1250,272 1300,268 L1300,620 Z')
    out = [f'<path d="{bed}" fill="url(#gold)"/>']
    # Foliage behind the flowers.
    out.append(sprig(842, 418, 868, 352, 6, 20, 0.1, seed=1))
    out.append(sprig(902, 404, 950, 330, 7, 22, -0.12, seed=2))
    out.append(sprig(964, 400, 1000, 338, 6, 20, 0.1, seed=3))
    out.append(sprig(1050, 350, 1072, 296, 5, 18, -0.1, seed=4))
    # Closed poppies standing up at the top right.
    out.append(bud(1112, 362, -98, 80, 44, 'bud1'))
    out.append(bud(1160, 352, -82, 84, 46, 'bud2'))
    out.append(bud(1272, 360, -95, 90, 50, 'bud3'))
    # Open poppies, back to front.
    # Each poppy is a cup seen from above at an angle: big back petals,
    # smaller side and front petals. (angle, size) per petal, back first.
    cup5 = [(240, 1.0), (300, 1.0), (185, 0.9), (355, 0.9), (90, 0.8), (135, 0.78), (45, 0.78)]
    out.append(poppy(1232, 372, 86, 120, cup5, 'p4'))
    out.append(poppy(1082, 466, 112, 150, cup5, 'p3'))
    out.append(cup('p1'))
    out.append(poppy(917, 498, 100, 136, cup5, 'p2'))
    # Foliage in front.
    out.append(sprig(812, 470, 822, 344, 8, 22, 0.05, seed=5))
    out.append(sprig(1176, 560, 1196, 430, 7, 20, 0.08, seed=6))
    out.append(sprig(1148, 420, 1166, 376, 3, 14, 0.1, seed=7))
    out.append(sprig(1012, 610, 1004, 560, 3, 12, 0.1, seed=8))
    return '\n'.join(out)


# ---------- unit numerals ----------
def numerals(x0, y0, w, h):
    out = []
    four = [(0.505, 0.13), (0.70, 0.13), (0.70, 0.60), (0.80, 0.60), (0.80, 0.73), (0.70, 0.73),
            (0.70, 0.86), (0.51, 0.86), (0.51, 0.73), (0.24, 0.73), (0.24, 0.615)]
    hole = [(0.51, 0.335), (0.51, 0.60), (0.36, 0.60)]
    for i in range(3):
        x = x0 + i * w
        d = (f'M{pts([(x + a * w, y0 + b * h) for a, b in four])} Z '
             f'M{pts([(x + a * w, y0 + b * h) for a, b in hole])} Z')
        out.append(f'''<g>
  <rect x="{f(x + 1)}" y="{y0}" width="{f(w - 2)}" height="{h}" rx="8" fill="{RED_DK}"/>
  <rect x="{f(x + 13)}" y="{y0 + 12}" width="{f(w - 26)}" height="{h - 24}" rx="6" fill="none" stroke="{RED}" stroke-width="20"/>
  <rect x="{f(x + 13)}" y="{y0 + 12}" width="{f(w - 26)}" height="{h - 24}" rx="6" fill="none" stroke="{RED_DK}" stroke-width="18" stroke-dasharray="2 4" opacity="0.55"/>
  <rect x="{f(x + 24)}" y="{y0 + 23}" width="{f(w - 48)}" height="{h - 46}" fill="url(#twill)" stroke="{RED_DK}" stroke-width="2.5"/>
  <path d="{d}" fill="#d4d5d8" stroke="#d4d5d8" stroke-width="12" stroke-linejoin="round" fill-rule="evenodd" transform="translate(2,3)"/>
  <path d="{d}" fill="url(#satin)" stroke="{WHITE}" stroke-width="10" stroke-linejoin="round" fill-rule="evenodd"/>
</g>''')
    return '\n'.join(out)


# ---------- assemble ----------
def defs():
    return f'''<defs>
  <clipPath id="inside"><path d="{CSP}"/></clipPath>
  <radialGradient id="sky" gradientUnits="userSpaceOnUse" cx="560" cy="280" r="760">
    <stop offset="0" stop-color="{SKY_HI}"/><stop offset="1" stop-color="{SKY_LO}"/>
  </radialGradient>
  <linearGradient id="satin" x1="0" y1="0" x2="0.25" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="{WHITE}"/><stop offset="1" stop-color="#e3e6ea"/>
  </linearGradient>
  <pattern id="twill" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
    <rect width="7" height="7" fill="#de2b2f"/><rect width="7" height="2.2" fill="#c8232a"/>
  </pattern>
  {"".join(grads)}
</defs>'''


def badge():
    scene = '\n'.join([
        f'<rect x="0" y="0" width="1300" height="640" fill="url(#sky)"/>',
        rays(560, 300),
        bird(735, 205, 1), bird(80, 394, 0.6),
        landscape(),
        bridge(),
        sailboat(),
        flowers(),
        fleur(531, 326, 1.0),
    ])
    letters = lettering()
    return f'''<g clip-path="url(#inside)">
{scene}
<g id="letters" stroke-linejoin="round">
  <g fill="{NAVY}" stroke="{NAVY}" stroke-width="15" transform="translate(1.5,3.5)">{letters}</g>
  <g fill="{SLATE}" stroke="{SLATE}" stroke-width="9">{letters}</g>
  <g fill="url(#satin)" stroke="#dfe3e8" stroke-width="1.5">{letters}</g>
</g>
</g>
<g fill="none" clip-path="url(#inside)">
  <path d="{CSP}" stroke="{RED_DK}" stroke-width="74"/>
  <path d="{CSP}" stroke="{RED}" stroke-width="68"/>
  <path d="{CSP}" stroke="{RED_DK}" stroke-width="64" stroke-dasharray="2.2 4.6" opacity="0.45"/>
  <path d="{CSP}" stroke="{RED_HI}" stroke-width="40" stroke-dasharray="1.6 5.2" stroke-dashoffset="3" opacity="0.35"/>
</g>
<path d="{CSP}" fill="none" stroke="#7d1512" stroke-width="3"/>
{numerals(192.5, 622, 305, 470)}'''


body = badge()  # builds the gradient list used by defs()
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'logo.svg'), 'w') as fh:
    fh.write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 1324 1118" width="1324" height="1118">
<title>BSA Troop 444</title>
{defs()}
{body}
</svg>
''')
with open(os.path.join(OUT, 'icon.svg'), 'w') as fh:
    s = 940 / 1324
    fh.write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<title>BSA Troop 444</title>
{defs()}
<rect width="1024" height="1024" fill="{SHIRT}"/>
<g transform="translate({f(42 + 12 * s)},{f((1024 - 1118 * s) / 2 + 12 * s)}) scale({f(s)})">
{body}
</g>
</svg>
''')
print('wrote', os.path.join(OUT, 'logo.svg'), os.path.join(OUT, 'icon.svg'))
