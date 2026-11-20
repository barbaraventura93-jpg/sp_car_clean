#!/usr/bin/env python3
"""SP Car Clean — Semana 7 (23 a 29/11/2026): monta as artes de publicação da semana.

As artes vieram prontas da sessão de planejamento, salvas no Drive em
"Posts Prontos — Status WhatsApp / Semana 7 (23 a 29-11)", no formato 1080x1920
(status do WhatsApp: a arte quadrada do feed fica no centro, entre y=420 e
y=1500, com fundo desfocado em cima e embaixo). Este script:
  1. recorta o quadrado 1080x1080 da arte de feed e de cada slide do carrossel;
  2. copia o story da Lavagem Detalhada como está (já é 1080x1920);
  3. gera o story de chamada do carrossel (mesmo modelo das semanas 4 a 6).

Pré-requisitos (rodar na raiz de uma pasta de trabalho):
  pip install pillow
  mkdir -p fonts && cd fonts && npm pack @fontsource/montserrat@5.3.0 @fontsource/open-sans@5.3.0 \\
    && for f in *.tgz; do tar xzf "$f" && mv package "${f%.tgz}"; done && cd ..
  Baixar cada arquivo do dicionário ARTES (Google Drive, pelo ID) para dl/<nome_local>.
Saída: out/ (feed, story, carrossel-farois/, chamadas/)
"""
ARTES = {
    # Pasta "Semana 7 (23 a 29-11)" (ID 1xvvA5YvnXo9FnPGRte1iSxOxaGOVnCIy)
    "01.jpg": "1l6CUoY81juFYW95pX0JhaHlY0OIP0UdO",    # 01-ter-24-11-para-choque.jpg
    "02.jpg": "1rTSuRuo7OmWEY-C2Xw71_WL7_x3H9XLI",    # 02-qua-25-11-lavagem-detalhada-inclui.jpg
    "03-1.jpg": "1fdWPwUeUtvTkX4mSgE5GFJqaUoDtywKY",  # 03-sab-28-11-farois-1.jpg
    "03-2.jpg": "1o5nsQ_R5Eksj10NigmPF6Fk1lldM0Pxs",  # ...-2.jpg
    "03-3.jpg": "1prN7DJSkjTW0hUVT-noDZ5Vi5cLyzJhA",  # ...-3.jpg
    "03-4.jpg": "11YvVA_SqLfzfwDE2Ahj6oAkbtT9EY07x",  # ...-4.jpg
    "03-5.jpg": "10IJZEUNexeINwyLb9pU8xQGwDWhWDlGA",  # ...-5.jpg
    "03-6.jpg": "1H4cntxzjlMFCojs6hopim_qOEcSlQxIP",  # ...-6.jpg
}
import os
faltando = [n for n in ARTES if not os.path.exists("dl/" + n)]
if faltando:
    raise SystemExit("Artes faltando em dl/: " + ", ".join(faltando))

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
F = 'fonts/'
def M(w, s): return ImageFont.truetype(F + f'fontsource-montserrat-5.3.0/files/montserrat-latin-{w}-normal.woff', s)
def O(w, s): return ImageFont.truetype(F + f'fontsource-open-sans-5.3.0/files/open-sans-latin-{w}-normal.woff', s)

BLUE = (10, 159, 212); LBLUE = (72, 201, 245); BG = (6, 9, 15)
TXT2 = (132, 151, 173); WHITE = (255, 255, 255)

def cover(im, w, h, fx=0.5, fy=0.5):
    r = max(w / im.width, h / im.height)
    nw, nh = int(im.width * r + .5), int(im.height * r + .5)
    im2 = im.resize((nw, nh), Image.LANCZOS)
    x = int((nw - w) * fx); y = int((nh - h) * fy)
    return im2.crop((x, y, x + w, y + h))

def scrim(img, y0, y1, a0, a1, color=BG):
    w, h = img.size
    ov = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    for y in range(max(0, y0), min(h, y1)):
        t = (y - y0) / max(1, (y1 - y0))
        d.line([(0, y), (w, y)], fill=color + (int(a0 + (a1 - a0) * t),))
    return Image.alpha_composite(img.convert('RGBA'), ov)

def spaced(d, xy, text, font, fill, sp):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill); x += d.textlength(ch, font=font) + sp

def spaced_w(d, text, font, sp):
    return sum(d.textlength(c, font=font) + sp for c in text) - sp

def logo(img, y, size):
    d = ImageDraw.Draw(img)
    f = M(800, size); fs = M(600, int(size * 0.36)); sp = size * 0.13
    w1 = d.textlength('SP ', font=f); w2 = d.textlength('CAR CLEAN', font=f)
    wd = spaced_w(d, 'CENTRO ESTÉTICO AUTOMOTIVO', fs, sp)
    xl = (img.width - (w1 + w2)) / 2; xd = (img.width - wd) / 2
    d.text((xl, y), 'SP', font=f, fill=BLUE)
    d.text((xl + w1, y), 'CAR CLEAN', font=f, fill=WHITE)
    spaced(d, (xd, y + size * 1.22), 'CENTRO ESTÉTICO AUTOMOTIVO', fs, TXT2, sp)

def wrap(d, text, font, maxw):
    out = []; line = ''
    for wd in text.split(' '):
        t = (line + ' ' + wd).strip()
        if d.textlength(t, font=font) <= maxw: line = t
        else: out.append(line); line = wd
    return out + [line]

def text_center(img, y, text, font, fill, maxw, lh):
    d = ImageDraw.Draw(img)
    for ln in wrap(d, text, font, maxw):
        d.text(((img.width - d.textlength(ln, font=font)) / 2, y), ln, font=font, fill=fill)
        y += font.size * lh
    return y

def footer(img, y):
    d = ImageDraw.Draw(img); f = O(600, 26); t = 'Guarulhos · SP'
    d.text((img.width - 54 - d.textlength(t, font=f), y), t, font=f, fill=TXT2)

def save(img, name):
    p = 'out/' + name
    os.makedirs(os.path.dirname(p) or 'out', exist_ok=True)
    img.convert('RGB').save(p, quality=95)
    return p

def quadrado(src):
    """Recorta a arte 1080x1080 do centro da versão de status (1080x1920)."""
    im = Image.open('dl/' + src).convert('RGB')
    assert im.size == (1080, 1920), (src, im.size)
    return im.crop((0, 420, 1080, 1500))

def chamada(capa_img, tit1, tit2, out_name):
    """Story de chamada 1080x1920: capa desfocada, selo POST NOVO NO FEED, capa em cartão."""
    W, H = 1080, 1920
    bg = ImageEnhance.Brightness(cover(capa_img, W, H).filter(ImageFilter.GaussianBlur(30))).enhance(0.4).convert('RGBA')
    img = scrim(bg, 0, H, 120, 170); logo(img, 110, 40); d = ImageDraw.Draw(img)
    f = M(800, 32); t = 'POST NOVO NO FEED'; w = d.textlength(t, font=f) + 80; h = 74; x = (W - w) / 2
    d.rounded_rectangle([x, 280, x + w, 280 + h], radius=h // 2, fill=BLUE)
    bb = f.getbbox(t); d.text((x + 40, 280 + (h - (bb[3] + bb[1])) / 2), t, font=f, fill=WHITE)
    y = text_center(img, 400, tit1, M(800, 58), WHITE, 1000, 1.15)
    y = text_center(img, y, tit2, M(700, 46), LBLUE, 1000, 1.2)
    cw = 860; x0 = (W - cw) // 2; y0 = int(y) + 50
    d.rounded_rectangle([x0 - 8, y0 - 8, x0 + cw + 8, y0 + cw + 8], radius=34, fill=LBLUE)
    m = Image.new('L', (cw, cw), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, cw - 1, cw - 1], radius=28, fill=255)
    img.paste(capa_img.resize((cw, cw), Image.LANCZOS), (x0, y0), m)
    t = 'Confira no perfil @spcarclean'; f = M(800, 44)
    d.text(((W - d.textlength(t, font=f)) / 2, y0 + cw + 80), t, font=f, fill=WHITE)
    footer(img, H - 90); save(img, out_name)



# POST 1 · Ter 24/11 10:00 · Feed · Antes e depois: atrás do para-choque (Onix)
save(quadrado('01.jpg'), 'semana7-01-antes-depois-para-choque.jpg')

# POST 2 · Qua 25/11 18:00 · Story · O que a Lavagem Detalhada inclui (já em 1080x1920)
save(Image.open('dl/02.jpg').convert('RGB'), 'semana7-02-story-lavagem-detalhada-inclui.jpg')

# POST 3 · Sáb 28/11 10:00 · Carrossel (6) · Restauração de faróis, etapa por etapa
SLIDES = ['01-capa', '02-por-que', '03-preparo', '04-polimento', '05-seguranca', '06-cta']
for i, nome in enumerate(SLIDES, 1):
    save(quadrado(f'03-{i}.jpg'), f'carrossel-farois/farois-{nome}.jpg')

# POST 3b · Sáb 28/11 10:15 · Story de chamada
chamada(Image.open('out/carrossel-farois/farois-01-capa.jpg').convert('RGB'),
        'Farol opaco tem solução', 'Restauração de faróis, etapa por etapa', 'chamadas/chamada-28-11-farois.jpg')

print("Artes geradas em out/")
