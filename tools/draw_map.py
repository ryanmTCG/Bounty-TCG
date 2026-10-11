#!/usr/bin/env python3
# Draws the old sea-chart background behind the table (our own artwork). Usage: python3 tools/draw_map.py map.svg
# then put the SVG into --map in page/bounty-tcg.html as a data: URL.
# draws an old sea-chart background as SVG (our own artwork, no photo)
import math, random, sys
random.seed(7)
W, H = 1600, 1000
INK = "#5C3B1A"

def blob(cx, cy, r, wob=0.5, n=110, seed=0):
    rnd = random.Random(seed)
    ks = [(rnd.randint(2, 6), rnd.uniform(0, 6.28), rnd.uniform(.5, 1)) for _ in range(4)] + [(rnd.randint(7, 17), rnd.uniform(0, 6.28), rnd.uniform(.1, .35)) for _ in range(6)]
    tot = sum(a for _, _, a in ks)
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        f = 1 + wob * sum(a * math.sin(k * t + p) for k, p, a in ks) / tot
        f += rnd.uniform(-.035, .035)
        pts.append((cx + r * f * math.cos(t) * 1.25, cy + r * f * math.sin(t)))
    d = "M%.0f %.0f" % pts[0]
    for i in range(1, n + 1):
        a, b = pts[i % n], pts[(i + 1) % n]
        d += " Q%.0f %.0f %.0f %.0f" % (a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return d + "Z"

def coast_top():
    rnd = random.Random(3)
    hs = [(rnd.uniform(.002, .006), rnd.uniform(0, 6.28), rnd.uniform(40, 70)), (rnd.uniform(.01, .02), rnd.uniform(0, 6.28), rnd.uniform(15, 30)), (rnd.uniform(.03, .05), rnd.uniform(0, 6.28), rnd.uniform(5, 12))]
    pts = []; x = -20
    while x < W + 30:
        y = 170 + sum(a * math.sin(f * x + p) for f, p, a in hs) + rnd.uniform(-5, 5)
        # a couple of deep bays
        y += 90 * math.exp(-((x - 430) / 70) ** 2) - 70 * math.exp(-((x - 1180) / 60) ** 2)
        pts.append((x, y)); x += rnd.uniform(9, 16)
    d = "M-20 -20 L%.0f %.0f" % pts[0]
    for a, b in zip(pts, pts[1:]): d += " Q%.0f %.0f %.0f %.0f" % (a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return d + " L%d -20Z" % (W + 20)

lands = [coast_top(), blob(560, 560, 150, seed=11), blob(1250, 330, 70, seed=5), blob(250, 820, 95, seed=21),
         blob(1420, 840, 55, seed=8), blob(930, 860, 40, seed=13), blob(1010, 470, 26, seed=4), blob(1080, 520, 18, seed=9),
         blob(1140, 575, 14, seed=2), blob(1190, 630, 11, seed=6)]

def rays(cx, cy, n=32, L=2200):
    s = ""
    for i in range(n):
        t = 2 * math.pi * i / n
        s += "M%.0f %.0fL%.0f %.0f" % (cx, cy, cx + L * math.cos(t), cy + L * math.sin(t))
    return s

def rose(cx, cy, r):
    out = []
    for i in range(16):
        t = math.pi / 8 * i - math.pi / 2
        big = i % 4 == 0; mid = i % 2 == 0
        R = r if big else r * .62 if mid else r * .38
        w = .16 if big else .13
        tip = (cx + R * math.cos(t), cy + R * math.sin(t))
        l = (cx + r * w * math.cos(t - math.pi / 2), cy + r * w * math.sin(t - math.pi / 2))
        rr = (cx + r * w * math.cos(t + math.pi / 2), cy + r * w * math.sin(t + math.pi / 2))
        out.append("<path d='M%.1f %.1fL%.1f %.1fL%.1f %.1fZ' fill='%s' fill-opacity='%s'/>" % (cx, cy, *tip, *l, INK, ".55" if big else ".35"))
        out.append("<path d='M%.1f %.1fL%.1f %.1fL%.1f %.1fZ' fill='%s' fill-opacity='%s'/>" % (cx, cy, *tip, *rr, INK, ".25" if big else ".15"))
    out.append("<circle cx='%d' cy='%d' r='%d' fill='none' stroke='%s' stroke-opacity='.45' stroke-width='2'/>" % (cx, cy, r * .3, INK))
    out.append("<circle cx='%d' cy='%d' r='%d' fill='none' stroke='%s' stroke-opacity='.3' stroke-width='1.5'/>" % (cx, cy, r * .82, INK))
    out.append("<circle cx='%d' cy='%d' r='%d' fill='#EBD7A6' stroke='%s' stroke-opacity='.6' stroke-width='2'/>" % (cx, cy, r * .06, INK))
    return "".join(out)

svg = f"""<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {W} {H}' preserveAspectRatio='xMidYMid slice'>
<defs>
<radialGradient id='p' cx='50%' cy='48%' r='75%'><stop offset='0' stop-color='#EBD7A6'/><stop offset='.6' stop-color='#DDBF85'/><stop offset='1' stop-color='#B98A4C'/></radialGradient>
<radialGradient id='v' cx='50%' cy='50%' r='72%'><stop offset='.55' stop-color='#5A3410' stop-opacity='0'/><stop offset='.86' stop-color='#5A3410' stop-opacity='.45'/><stop offset='1' stop-color='#2E1803' stop-opacity='.85'/></radialGradient>
<filter id='g' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 .35 0 0 0 0 .22 0 0 0 0 .08 0 0 0 -.9 .62'/></filter>
<filter id='s' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.004 .006' numOctaves='4' seed='9'/><feColorMatrix values='0 0 0 0 .45 0 0 0 0 .28 0 0 0 0 .08 0 0 0 -2.2 .95'/></filter>
<filter id='r' x='-5%' y='-5%' width='110%' height='110%'><feTurbulence type='fractalNoise' baseFrequency='.03' numOctaves='2' seed='4'/><feDisplacementMap in='SourceGraphic' scale='9'/></filter>
</defs>
<rect width='{W}' height='{H}' fill='url(#p)'/>
<rect width='{W}' height='{H}' filter='url(#s)'/>
<g stroke='{INK}' stroke-opacity='.16' stroke-width='1.2' fill='none'><path d='{rays(1060, 700)}'/><path d='{rays(330, 420, 16)}'/></g>
<g filter='url(#r)'>
<g fill='{INK}' fill-opacity='.07' stroke='{INK}' stroke-opacity='.5' stroke-width='2.2' stroke-linejoin='round'>{''.join(f"<path d='{d}'/>" for d in lands)}</g>
<g fill='none' stroke='{INK}' stroke-opacity='.16' stroke-width='7' stroke-linejoin='round'>{''.join(f"<path d='{d}'/>" for d in lands)}</g>
</g>
{rose(1060, 700, 120)}
<rect x='34' y='30' width='{W-68}' height='{H-60}' fill='none' stroke='{INK}' stroke-opacity='.4' stroke-width='2'/>
<rect x='44' y='40' width='{W-88}' height='{H-80}' fill='none' stroke='{INK}' stroke-opacity='.25' stroke-width='1'/>
<rect width='{W}' height='{H}' filter='url(#g)' opacity='.7'/>
<rect width='{W}' height='{H}' fill='url(#v)'/>
</svg>"""
svg = " ".join(svg.split())
open(sys.argv[1], "w").write(svg)
print(len(svg))
