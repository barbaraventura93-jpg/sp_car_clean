#!/usr/bin/env python3
"""SP Car Clean — Semana 5 (09 a 15/11/2026): gera todas as artes da semana.
Pré-requisitos (rodar na raiz de uma pasta de trabalho):
  pip install pillow
  mkdir -p fonts && cd fonts && npm pack @fontsource/montserrat@5.3.0 @fontsource/open-sans@5.3.0 \
    && for f in *.tgz; do tar xzf "$f" && mv package "${f%.tgz}"; done && cd ..
  Baixar cada foto do dicionário FOTOS (Google Drive, pelo ID) para raw/<nome_local>.
Saída: out/ (feed, story, carrossel-higienizacao/, chamadas/)
"""
FOTOS = {
    # Reparo de Trinca em Para-brisa (outro carro, não é a Pickup Corsa Uva)
    "trinca-injetor_1793370514657.jpg": "1lcyhEpCsTAa1z9s6WKO6TgBU_D-_Q1MN",
    # Lavagem Detalhada Carros
    "picape-por-baixo_WA0031.jpeg": "133uySXWci8jfXVhnCexSEyxz1ACKbqoN",  # IMG-20260806-WA0031.jpeg
    # Higienização de Tecidos Carro
    "banco-antes_141230-2.jpg": "10Daohw5E9H2j8Vs7BqKsFfwV_V9ryM9I",   # IMG_20261006_141230~2.jpg
    "banco-antes_141230.jpg": "1Kcef2fa3YXq5CeaDafo9NVS6VrAvryq4",     # IMG_20261006_141230.jpg
    "banco-depois_145400.jpg": "1x-G5xcJ8IBFR4K1tO69TSGfLiAzE-HuU",    # IMG_20261006_145400.jpg
    "banco-depois_145400-2.jpg": "1_S-QujEhYtHrPHYBqbLB_XNImnrHBgkL",  # IMG_20261006_145400~2.jpg
    "assento-produto_150658.jpg": "1C3t6K_fmjiGctWTsj2adMoiqbcz8TPNl", # IMG_20261030_150658.jpg
    "lateral-banco_150641.jpg": "1KaKhlpaJ9FsJdXkf1HCzCvKacvK7N63T",   # IMG_20261030_150641.jpg
}
import os
faltando = [n for n in FOTOS if not os.path.exists("raw/" + n)]
if faltando:
    raise SystemExit("Fotos faltando em raw/: " + ", ".join(faltando))

# ===== IDENTIDADE VISUAL (Guia de Marca v1) =====
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageOps
F = 'fonts/'
def M(w, s): return ImageFont.truetype(F + f'fontsource-montserrat-5.3.0/files/montserrat-latin-{w}-normal.woff', s)
def O(w, s): return ImageFont.truetype(F + f'fontsource-open-sans-5.3.0/files/open-sans-latin-{w}-normal.woff', s)

BLUE = (10, 159, 212); LBLUE = (72, 201, 245); DBLUE = (10, 125, 176)
BG = (6, 9, 15); BG2 = (12, 18, 25); CARD = (17, 24, 39)
TXT = (221, 232, 245); TXT2 = (132, 151, 173); WHITE = (255, 255, 255)

def treat(path):
    """Tratamento obrigatorio em copia: reducao de ruido, contraste, nitidez."""
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    if max(im.size) > 2600:
        im.thumbnail((2600, 2600), Image.LANCZOS)
    im = im.filter(ImageFilter.MedianFilter(3))
    im = ImageEnhance.Contrast(im).enhance(1.10)
    im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=90, threshold=3))
    return im

def cover(im, w, h, fx=0.5, fy=0.5, zoom=1.0):
    r = max(w / im.width, h / im.height) * zoom
    nw, nh = int(im.width * r + .5), int(im.height * r + .5)
    im2 = im.resize((nw, nh), Image.LANCZOS)
    x = int((nw - w) * fx); y = int((nh - h) * fy)
    return im2.crop((x, y, x + w, y + h))

def scrim(img, y0, y1, a0, a1, color=BG):
    w, h = img.size
    ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for y in range(max(0, y0), min(h, y1)):
        t = (y - y0) / max(1, (y1 - y0))
        d.line([(0, y), (w, y)], fill=color + (int(a0 + (a1 - a0) * t),))
    return Image.alpha_composite(img.convert('RGBA'), ov)

def spaced(d, xy, text, font, fill, sp):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + sp
    return x

def spaced_w(d, text, font, sp):
    return sum(d.textlength(c, font=font) + sp for c in text) - sp

def logo(img, x, y, size=34, center=False):
    d = ImageDraw.Draw(img)
    f = M(800, size); fs = M(600, int(size * 0.36))
    w1 = d.textlength('SP ', font=f); w2 = d.textlength('CAR CLEAN', font=f)
    sp = size * 0.13
    wd = spaced_w(d, 'CENTRO ESTÉTICO AUTOMOTIVO', fs, sp)
    if center:
        xl = (img.width - (w1 + w2)) / 2; xd = (img.width - wd) / 2
    else:
        xl = xd = x
    d.text((xl, y), 'SP', font=f, fill=BLUE)
    d.text((xl + w1, y), 'CAR CLEAN', font=f, fill=WHITE)
    spaced(d, (xd, y + size * 1.22), 'CENTRO ESTÉTICO AUTOMOTIVO', fs, TXT2, sp)

def wrap(d, text, font, maxw):
    out = []
    for para in text.split('\n'):
        words = para.split(' '); line = ''
        for wd in words:
            t = (line + ' ' + wd).strip()
            if d.textlength(t, font=font) <= maxw: line = t
            else:
                out.append(line); line = wd
        out.append(line)
    return out

def text_block(img, x, y, text, font, fill, maxw, lh=1.25, center=False):
    d = ImageDraw.Draw(img)
    for ln in wrap(d, text, font, maxw):
        xx = x if not center else (img.width - d.textlength(ln, font=font)) / 2
        d.text((xx, y), ln, font=font, fill=fill)
        y += font.size * lh
    return y

def grad_pill(img, x, y, text, font, padx=34, h=None, center=False, txtcol=BG):
    d = ImageDraw.Draw(img)
    tw = d.textlength(text, font=font); h = h or int(font.size * 2.2)
    w = int(tw + padx * 2)
    if center: x = (img.width - w) // 2
    g = Image.new('RGBA', (w, h))
    gd = ImageDraw.Draw(g)
    for i in range(w):
        t = i / max(1, w - 1)
        c = tuple(int(BLUE[k] + (LBLUE[k] - BLUE[k]) * t) for k in range(3))
        gd.line([(i, 0), (i, h)], fill=c + (255,))
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2, fill=255)
    img.paste(g, (int(x), int(y)), mask)
    bb = font.getbbox(text)
    d.text((x + padx, y + (h - (bb[3] + bb[1])) / 2), text, font=font, fill=txtcol)
    return x + w, y + h

def outline_pill(img, x, y, text, font, col=LBLUE, padx=24, h=None, fill=None, txt=None):
    d = ImageDraw.Draw(img)
    tw = d.textlength(text, font=font); h = h or int(font.size * 2.0)
    w = int(tw + padx * 2)
    d.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, outline=col, width=3, fill=fill)
    bb = font.getbbox(text)
    d.text((x + padx, y + (h - (bb[3] + bb[1])) / 2), text, font=font, fill=txt or col)
    return x + w, y + h

def bullet(d, x, y, r=9, col=LBLUE):
    d.ellipse([x - r, y - r, x + r, y + r], fill=col)

def chev(d, x, y):
    for i in range(3):
        xx = x + i * 22; d.line([(xx, y - 14), (xx + 14, y), (xx, y + 14)], fill=LBLUE, width=5)

def footer(img, y=None, text='Guarulhos · SP'):
    d = ImageDraw.Draw(img); f = O(600, 26)
    y = y or img.height - 62
    d.text((img.width - 54 - d.textlength(text, font=f), y), text, font=f, fill=TXT2)

def save(img, name):
    p = 'out/' + name
    os.makedirs(os.path.dirname(p) or 'out', exist_ok=True)
    img.convert('RGB').save(p, quality=92)
    return p

def chamada(capa_path, tit1, tit2, out_name):
    """Story de chamada 1080x1920: capa desfocada, selo POST NOVO NO FEED, capa em cartão."""
    capa_img = Image.open(capa_path).convert('RGB')
    W, H = 1080, 1920
    bg = ImageEnhance.Brightness(cover(capa_img, W, H).filter(ImageFilter.GaussianBlur(30))).enhance(0.4).convert('RGBA')
    img = scrim(bg, 0, H, 120, 170); logo(img, 0, 110, 40, center=True); d = ImageDraw.Draw(img)
    f = M(800, 32); t = 'POST NOVO NO FEED'; w = d.textlength(t, font=f) + 80; h = 74; x = (W - w) / 2
    d.rounded_rectangle([x, 280, x + w, 280 + h], radius=h // 2, fill=BLUE)
    bb = f.getbbox(t); d.text((x + 40, 280 + (h - (bb[3] + bb[1])) / 2), t, font=f, fill=WHITE)
    y = text_block(img, 0, 400, tit1, M(800, 58), WHITE, 1000, 1.15, center=True)
    y = text_block(img, 0, y, tit2, M(700, 46), LBLUE, 1000, 1.2, center=True)
    cw = 860; x0 = (W - cw) // 2; y0 = int(y) + 50
    d.rounded_rectangle([x0 - 8, y0 - 8, x0 + cw + 8, y0 + cw + 8], radius=34, fill=LBLUE)
    m = Image.new('L', (cw, cw), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, cw - 1, cw - 1], radius=28, fill=255)
    img.paste(capa_img.resize((cw, cw), Image.LANCZOS), (x0, y0), m)
    t = 'Confira no perfil @spcarclean'; f = M(800, 44)
    d.text(((W - d.textlength(t, font=f)) / 2, y0 + cw + 80), t, font=f, fill=WHITE)
    footer(img, H - 90); save(img, out_name)


# ===== POST 1 · Ter 10/11 10:00 · Feed · Reparo de trinca no seu local =====
S = 1080
ph = treat('raw/trinca-injetor_1793370514657.jpg')
img = cover(ph, S, S, fx=0.5, fy=0.40).convert('RGBA')
img = scrim(img, 0, 280, 245, 0)
img = scrim(img, 470, 680, 0, 220)
img = scrim(img, 680, S, 220, 252)
logo(img, 54, 46, 34)
d = ImageDraw.Draw(img)
outline_pill(img, 54, 590, 'REPARO DE TRINCA', M(800, 24), col=LBLUE, fill=BG)
d.text((54, 660), 'Trinca no para-brisa?', font=M(800, 60), fill=WHITE)
d.text((54, 732), 'O reparo vai até você.', font=M(800, 60), fill=LBLUE)
text_block(img, 54, 822, 'Resina aplicada no ponto de impacto para a trinca não crescer. Pode ser feito no seu local, conforme a localização.', O(600, 29), TXT, 970, 1.28)
grad_pill(img, 54, 950, 'Avalie: (11) 92669-7474', M(800, 28), padx=30)
footer(img, S - 58)
save(img, 'semana5-01-reparo-trinca-no-local.jpg')


# ===== POST 2 · Qua 11/11 18:00 · Story · Por baixo também precisa de cuidado =====
W, H = 1080, 1920
ph = treat('raw/picape-por-baixo_WA0031.jpeg')
img = Image.new('RGBA', (W, H), BG + (255,))
top = cover(ph, W, 1060, fx=0.52, fy=0.5).convert('RGBA')
img.paste(top, (0, 0))
img = scrim(img, 0, 380, 250, 0)
img = scrim(img, 760, 1060, 0, 255)
logo(img, 0, 90, 40, center=True)
d = ImageDraw.Draw(img)
outline_pill(img, 70, 980, 'LAVAGEM DETALHADA', M(800, 24), col=LBLUE, fill=BG)
d.text((70, 1060), 'Por baixo também', font=M(800, 70), fill=WHITE)
d.text((70, 1142), 'precisa de cuidado', font=M(800, 70), fill=LBLUE)
itens = [('Caixas de roda', 'limpeza detalhada, incluída na Lavagem Detalhada'),
         ('Estepe e eixo', 'barro e areia se acumulam onde ninguém vê'),
         ('Barro acumulado', 'segura umidade junto às peças por mais tempo')]
y = 1270
for tit, sub in itens:
    bullet(d, 86, y + 24, 11)
    d.text((118, y), tit, font=M(700, 38), fill=WHITE)
    d.text((118, y + 50), sub, font=O(400, 30), fill=TXT)
    y += 122
grad_pill(img, 0, 1660, 'WhatsApp (11) 92669-7474', M(800, 34), padx=40, center=True)
f = M(700, 28); t = 'spcarclean.com.br · Agende online'
d.text(((W - d.textlength(t, font=f)) / 2, 1770), t, font=f, fill=LBLUE)
footer(img, H - 70)
save(img, 'semana5-02-story-por-baixo.jpg')


# ===== POST 3 + 3b · Sáb 14/11 10:00 · Carrossel Higienização de bancos + chamada =====
S = 1080
def base(path, fx, fy, zoom=1.0):
    img = cover(treat(path), S, S, fx=fx, fy=fy, zoom=zoom).convert('RGBA')
    img = scrim(img, 0, 260, 240, 0); img = scrim(img, 470, 690, 0, 228); img = scrim(img, 690, S, 228, 252)
    logo(img, 54, 46, 30); return img

def capa():
    img = base('raw/banco-depois_145400-2.jpg', 0.5, 0.18); d = ImageDraw.Draw(img)
    outline_pill(img, 54, 610, 'SAÚDE DA FAMÍLIA', M(800, 24), col=LBLUE, fill=BG)
    d.text((54, 680), 'Higienização de bancos', font=M(800, 60), fill=WHITE)
    d.text((54, 752), 'etapa por etapa', font=M(800, 60), fill=LBLUE)
    text_block(img, 54, 842, 'O que sai de dentro do tecido e como o banco volta limpo.', O(600, 30), TXT, 960)
    d.text((54, S - 74), 'Deslize', font=M(700, 28), fill=WHITE); chev(d, 180, S - 58); footer(img, S - 62)
    return img

def comparativo():
    a = cover(treat('raw/banco-antes_141230.jpg'), S // 2, S, fx=0.5, fy=0.30)
    b = cover(treat('raw/banco-depois_145400.jpg'), S // 2, S, fx=0.5, fy=0.22)
    img = Image.new('RGB', (S, S)); img.paste(a, (0, 0)); img.paste(b, (S // 2, 0)); img = img.convert('RGBA')
    img = scrim(img, 0, 260, 240, 0); img = scrim(img, 470, 690, 0, 228); img = scrim(img, 690, S, 228, 252)
    d = ImageDraw.Draw(img); d.line([(S // 2, 0), (S // 2, 690)], fill=LBLUE, width=6)
    logo(img, 54, 46, 30)
    f = M(900, 40); num = '05'; d.text((S - 54 - d.textlength(num, font=f), 44), num, font=f, fill=LBLUE)
    outline_pill(img, 40, 300, 'ANTES', M(800, 26), col=WHITE, fill=BG)
    grad_pill(img, S // 2 + 40, 300, 'DEPOIS', M(800, 26), padx=24)
    d = ImageDraw.Draw(img)
    d.text((54, 710), 'Banco limpo de novo', font=M(800, 56), fill=WHITE)
    y = text_block(img, 54, 796, 'O mesmo encosto, antes e logo depois da higienização.', O(600, 30), TXT, 970, 1.3)
    d.text((54, y + 8), 'Na foto do depois, o tecido ainda está úmido.', font=O(400, 24), fill=TXT2)
    footer(img, S - 62); return img

def passo(n, path, fx, fy, etapa, tit, txt, zoom=1.0, nota=None):
    img = base(path, fx, fy, zoom); d = ImageDraw.Draw(img)
    f = M(900, 40); num = f'{n:02d}'; d.text((S - 54 - d.textlength(num, font=f), 44), num, font=f, fill=LBLUE)
    outline_pill(img, 54, 640, etapa, M(800, 24), col=LBLUE, fill=BG)
    d.text((54, 710), tit, font=M(800, 56), fill=WHITE)
    y = text_block(img, 54, 796, txt, O(600, 30), TXT, 970, 1.3)
    if nota:
        d.text((54, y + 8), nota, font=O(400, 24), fill=TXT2)
    footer(img, S - 62); return img

def cta():
    img = base('raw/banco-depois_145400-2.jpg', 0.5, 0.92, zoom=1.15); d = ImageDraw.Draw(img)
    d.text((54, 600), 'Cuide de quem', font=M(800, 62), fill=WHITE)
    d.text((54, 674), 'anda com você.', font=M(800, 62), fill=LBLUE)
    text_block(img, 54, 768, 'Higienização de bancos, tapetes e teto, com hora marcada de segunda a sexta.', O(600, 30), TXT, 960)
    grad_pill(img, 54, 900, 'WhatsApp (11) 92669-7474', M(800, 30), padx=32)
    d.text((54, S - 64), 'spcarclean.com.br · Agende online', font=M(700, 24), fill=LBLUE); footer(img, S - 62)
    return img

sl = [('01-capa', capa()),
      ('02-o-que-fica', passo(2, 'raw/banco-antes_141230-2.jpg', 0.5, 0.35, 'ANTES', 'O que fica no tecido',
            'Suor, poeira, restos de comida e ácaros entram nas fibras. É daí que vêm o cheiro e as manchas.')),
      ('03-produto', passo(3, 'raw/assento-produto_150658.jpg', 0.5, 0.45, 'ETAPA 1', 'Produto no tecido',
            'O produto é aplicado por toda a área do assento para soltar a sujeira presa nas fibras.')),
      ('04-extracao', passo(4, 'raw/lateral-banco_150641.jpg', 0.5, 0.40, 'ETAPA 2', 'Extração e detalhes',
            'A sujeira é extraída de dentro do tecido. Laterais e costuras recebem a mesma atenção.')),
      ('05-resultado', comparativo()),
      ('06-cta', cta())]
for n, i in sl: save(i, f'carrossel-higienizacao/higienizacao-{n}.jpg')
chamada('out/carrossel-higienizacao/higienizacao-01-capa.jpg', 'Higienização de bancos:', 'etapa por etapa',
        'chamadas/chamada-14-11-higienizacao.jpg')

print("Artes geradas em out/")
