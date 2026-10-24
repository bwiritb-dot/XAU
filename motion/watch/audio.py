"""Music + sound design for LINE · FORM · TIME. Pure numpy synthesis, timings from timeline.json.
usage: python3 audio.py out/audio.wav
"""
import json, sys, wave
import numpy as np

SR = 48000
TL = json.load(open('timeline.json'))
DUR = TL['dur']
N = int(SR * (DUR + 0.5))
rng = np.random.default_rng(3)
L = np.zeros(N); R = np.zeros(N)
BEAT = 60 / TL['bpm']


def add(sig, t0, gain=1.0, pan=0.0, bus=None):
    i0 = int(t0 * SR)
    if i0 >= N: return
    sig = sig[: N - i0] if i0 >= 0 else sig[-i0:]
    i0 = max(i0, 0)
    gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
    (bus or (L, R))[0][i0:i0 + len(sig)] += sig * gain * gl
    (bus or (L, R))[1][i0:i0 + len(sig)] += sig * gain * gr


def tt(d): return np.arange(int(d * SR)) / SR
def env(t, a, d): return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)
def hz(midi): return 440 * 2 ** ((midi - 69) / 12)


def smooth(x, n):  # moving average lowpass via cumsum
    c = np.cumsum(np.concatenate([np.zeros(n), x]))
    return (c[n:] - c[:-n]) / n


def bandnoise(d, lo, hi):
    n = rng.standard_normal(int(d * SR))
    a = smooth(n, max(1, int(SR / hi))); b = smooth(n, max(2, int(SR / lo)))
    return (a - b)[: int(d * SR)]


# reverb send
RV = [np.zeros(N), np.zeros(N)]

# ---------------- music ----------------
def pad_note(m, d, bright=0.4, att=1.2):
    t = tt(d); s = np.zeros_like(t)
    for det in (-0.07, 0.0, 0.08):
        f = hz(m + det)
        for h in range(1, 9):
            s += (bright ** (h - 1)) / h * np.sin(2 * np.pi * f * h * t + rng.random() * 6)
    e = np.minimum(1, t / att) * np.minimum(1, (d - t) / 1.2).clip(0)
    return s * e * 0.06


chords = [  # start, dur, notes, brightness, gain, attack
    (0.0, 8.2, [50, 57, 64, 65], 0.25, 0.45, 1.5),           # Dm(add9)
    (8.0, 6.2, [46, 53, 57, 62, 69], 0.35, 0.8, 1.2),        # Bbmaj7 swelling
    (14.0, 6.2, [50, 57, 60, 65, 69], 0.42, 0.8, 0.2),       # Dm7
    (20.0, 2.2, [46, 53, 58, 62, 69], 0.45, 0.95, 0.15),     # Bb
    (22.0, 2.2, [48, 55, 60, 64, 67], 0.5, 1.05, 0.15),      # C
    (24.0, 6.5, [50, 57, 62, 64, 65, 69], 0.38, 0.55, 0.1),  # Dm9 resolve
]
for st, d, notes, br, gain, att in chords:
    for i, m in enumerate(notes):
        s = pad_note(m, d, br, att)
        add(s, st, gain, pan=(i / max(1, len(notes) - 1) - 0.5) * 0.8)
        add(s, st, 0.6, bus=RV)


def bell(f, d=2.5, idx=2.2, ratio=3.5):
    t = tt(d)
    return np.sin(2 * np.pi * f * t + idx * np.exp(-t * 3) * np.sin(2 * np.pi * f * ratio * t)) * env(t, 0.002, d / 4)


# glass arpeggio: sparse in sketch, steady 8ths after the hit
arp = [62, 69, 72, 74, 77, 74, 72, 69]
for k in range(int(DUR / (BEAT / 2))):
    tk = k * BEAT / 2
    if tk < 8 and k % 4: continue
    if 10.0 <= tk < 14 and k % 2: continue
    if tk >= 29.5: continue
    m = arp[k % len(arp)] + (12 if 14 <= tk < 20 and k % 8 == 6 else 0) - (2 if 20 <= tk < 22 else 0)
    g = 0.05 if tk < 8 else 0.07
    b = bell(hz(m), 1.6)
    add(b, tk, g, pan=np.sin(k * 1.3) * 0.6); add(b, tk, g * 0.8, bus=RV)

# sub pulse from the hit on
for k in range(int((DUR - 10) / BEAT)):
    tk = 10 + k * BEAT
    if tk > 29.6: break
    root = 38 if tk < 20 or tk >= 24 else (34 if tk < 22 else 36)
    t = tt(0.45)
    s = np.sin(2 * np.pi * hz(root) * t) * env(t, 0.004, 0.16)
    add(s, tk, 0.28 if 14 <= tk < 20 else 0.2)

# hats: 8ths while the parts float, 16ths building through reassembly
for k in range(int(10 / (BEAT / 4))):
    tk = 14 + k * BEAT / 4
    if tk >= 24: break
    if tk < 20 and k % 2: continue
    ramp = 0.5 + 0.5 * (tk - 20) / 4 if tk >= 20 else 0.6
    add(bandnoise(0.05, 6000, 16000) * np.exp(-tt(0.05) * 90), tk, 0.12 * ramp * (1.3 if k % 4 == 2 else 1), pan=0.35 if k % 2 else -0.35)
# 8th-note sub drive in reassembly
for k in range(8):
    tk = 20 + k * BEAT
    t = tt(0.3); add(np.sin(2 * np.pi * hz(34 if tk < 22 else 36) * t) * env(t, 0.003, 0.1), tk + BEAT / 2, 0.16)

# ---------------- sound design ----------------
def scratch(d, rate=14, gain=1.0):
    t = tt(d)
    n = bandnoise(d, 1800, 9000)
    stroke = 0.55 + 0.45 * np.sin(2 * np.pi * rate * t + np.sin(2 * np.pi * 2.3 * t) * 3) ** 2
    grit = (rng.random(len(t)) > 0.9985) * rng.standard_normal(len(t)) * 3
    e = np.minimum(1, t / 0.05) * np.minimum(1, (d - t) / 0.08).clip(0)
    return (n * stroke + smooth(grit, 6)) * e * gain


for k, (a, b) in TL['sketch'].items():
    add(scratch(b - a, rate=9 if k == 'construct' else 15), a, 0.055 if k != 'construct' else 0.04, pan=0.25)
for _, a, b in TL['notes']:
    add(scratch(b - a, rate=22), a, 0.035, pan=-0.3)


def whoosh(d, lo=200, hi=3000, peak=0.6):
    t = tt(d); x = t / d
    e = np.where(x < peak, (x / peak) ** 2, ((1 - x) / (1 - peak)) ** 1.5)
    return bandnoise(d, lo, hi) * e


def thump(f=48, d=1.2):
    t = tt(d); ph = 2 * np.pi * np.cumsum(f * (1 + 2.5 * np.exp(-t * 30))) / SR
    return np.sin(ph) * env(t, 0.002, d / 4)


def click(f=3200, d=0.12, metal=True):
    t = tt(d)
    s = bandnoise(d, 2000, 12000) * np.exp(-t * 300) * 1.4
    if metal:
        for r, a in ((1.0, 0.5), (2.76, 0.3), (5.4, 0.2)):
            s += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * 45)
    return s


def riser(d):
    t = tt(d); x = t / d
    return bandnoise(d, 3000, 14000) * x ** 3 + 0.4 * np.sin(2 * np.pi * (300 + 900 * x ** 2) * t) * x ** 4 * 0.2


# lift + lights down: reverse shimmer into the solid sweep
a, b = TL['lift']; add(riser(b - a + 0.4), a, 0.22); add(riser(b - a + 0.4), a, 0.2, bus=RV)
a, b = TL['sweep']
for i, m in enumerate([62, 65, 69, 72, 74, 77, 81, 86]):
    bb = bell(hz(m), 2.0, idx=3.0, ratio=2.01)
    tk = a + (b - a) * (i / 8) ** 0.8
    add(bb, tk, 0.06, pan=-0.7 + i * 0.2); add(bb, tk, 0.07, bus=RV)
add(whoosh(b - a, 300, 5000, 0.85), a, 0.25)
a, b = TL['paperFall']; add(whoosh(b - a, 80, 1200, 0.5), a, 0.35, pan=-0.2)

# the hit at tickStart: watch comes alive
th = TL['tickStart']
add(thump(42, 1.8), th, 0.9); add(click(1800, 0.4), th, 0.4); add(bell(hz(50), 4, 1.5, 2.0), th, 0.18, bus=RV)

# watch ticking: 8 per second quiet, accent on beats
for k in range(int((DUR - th) * 8)):
    tk = th + k / 8
    if tk > DUR - 0.05: break
    acc = k % 4 == 0
    add(click(5200 if k % 2 else 4600, 0.03, metal=True), tk, 0.05 if acc else 0.025, pan=0.15)

# FORM letters
for i in range(4):
    tf = TL['form'][0] + i * 0.16 + 0.12
    add(thump(90 + i * 8, 0.4), tf, 0.13, pan=0.3 - i * 0.15); add(click(2400, 0.08), tf, 0.07, pan=0.3 - i * 0.15)

# crown unscrew: accelerating ratchet, riser into the drop
a, b = TL['crownOut']
tk = a
while tk < b:
    p = (tk - a) / (b - a)
    add(click(2800 + 800 * p, 0.04), tk, 0.08 + 0.06 * p, pan=0.5)
    tk += 0.11 - 0.07 * p
add(riser(1.0), a, 0.3)

# explosion
for name, te in TL['explode'].items():
    big = name in ('crystal', 'bezel')
    add(whoosh(0.9, 250, 6000, 0.2), te, 0.35 if big else 0.18, pan=rng.uniform(-0.6, 0.6))
    add(bell(hz(rng.choice([74, 77, 81, 86])), 1.5, 2.5, 3.1), te + 0.02, 0.05, bus=RV)
te = TL['explode']['crystal']
add(thump(36, 2.2), te, 1.0); add(bandnoise(2.5, 200, 9000) * np.exp(-tt(2.5) * 2.2), te, 0.18, bus=RV)

# label typing
l0, l1 = TL['labels']
for i in range(8):
    s0 = l0 + i * 0.22 + 0.6 * 0.3 * 0.6
    for c in range(9):
        add(click(6000, 0.02, metal=False), s0 + c * 0.035, 0.03, pan=-0.4 + i * 0.1)

# reassembly: whoosh in, snap on the beat
for name, tr in TL['assemble'].items():
    big = name in ('crystal', 'case')
    add(whoosh(0.6, 300, 5000, 0.92), tr - 0.58, 0.22 if big else 0.14, pan=rng.uniform(-0.5, 0.5))
    add(click(2200 if big else 3400, 0.18), tr, 0.35 if big else 0.22)
    add(thump(70 if big else 110, 0.5), tr, 0.4 if big else 0.2)
    add(click(2600, 0.2), tr, 0.12, bus=RV)
# bezel ratchet
tb = TL['assemble']['bezel']
for k in range(6): add(click(3000, 0.04), tb + 0.05 + k * 0.06, 0.06, pan=-0.3)
# crown screw-in: decelerating ratchet, final click
a, b = TL['crownIn']; tk = a
while tk < b - 0.05:
    p = (tk - a) / (b - a)
    add(click(3400 - 600 * p, 0.04), tk, 0.08, pan=0.5)
    tk += 0.04 + 0.12 * p
add(click(2000, 0.3), b, 0.35); add(thump(60, 0.8), b, 0.4)

# title swell + glint sparkle
a, b = TL['title']; add(whoosh(b - a, 400, 8000, 0.4), a, 0.12, bus=RV)
g = TL['glint']
for i, m in enumerate([86, 93, 98, 101]):
    add(bell(hz(m), 2.2, 1.2, 4.0), g + i * 0.05, 0.05, pan=-0.2 + i * 0.15); add(bell(hz(m), 2.2, 1.2, 4.0), g + i * 0.05, 0.06, bus=RV)

# ---------------- reverb + master ----------------
ir_t = tt(2.8)
for ch in range(2):
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 2.4)
    ir = smooth(ir, 3)[: len(ir_t)]
    n = 1 << int(np.ceil(np.log2(N + len(ir))))
    wet = np.fft.irfft(np.fft.rfft(RV[ch], n) * np.fft.rfft(ir, n), n)[:N]
    (L, R)[ch][:] += wet * 0.06

mix = np.stack([L, R], 1)[: int(DUR * SR)]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.6) / np.tanh(1.6) * 0.89
fo = int(0.05 * SR); mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
mix[:int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]
pcm = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'out/audio.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok', pcm.shape)
