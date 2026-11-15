#!/usr/bin/env python3
"""SP Car Clean — Semana 6 (16 a 22/11/2026): monta as artes de publicação da semana.

Nesta semana as artes já vieram prontas, geradas e tratadas pela sessão de
planejamento e salvas no Drive em "Posts Prontos — Status WhatsApp / Semana 6
(16 a 22-11)", no formato 1080x1920 (status do WhatsApp: a arte quadrada do feed
fica no centro, entre y=420 e y=1500, com fundo desfocado em cima e embaixo).
Este script:
  1. recorta o quadrado 1080x1080 de cada arte de feed/carrossel;
  2. copia o story do tapete como está (já é 1080x1920);
  3. gera o story de chamada do carrossel (mesmo modelo das semanas 4 e 5).

Pré-requisitos (rodar na raiz de uma pasta de trabalho):
  pip install pillow
  mkdir -p fonts && cd fonts && npm pack @fontsource/montserrat@5.3.0 @fontsource/open-sans@5.3.0 \
    && for f in *.tgz; do tar xzf "$f" && mv package "${f%.tgz}"; done && cd ..
  Baixar cada arquivo do dicionário ARTES (Google Drive, pelo ID) para dl/<nome_local>.
Saída: out/ (feed, story, carrossel-revenda/, chamadas/)
"""
ARTES = {
    # Pasta "Semana 6 (16 a 22-11)" (ID 132qKcPCIFqg57OoyKZQknNmO7z29SLE8)
    "01.jpg": "1J4k756h7IkWSnxqhnkARPc40Stfz5z0t",    # 01-ter-17-11-gift-card-natal.jpg
    "02.jpg": "1Fx3eZlb4Bga5Gg8MtpSFgkPqjt0QHXJ-",    # 02-qua-18-11-tapete-casa.jpg
    "03-1.jpg": "1X5z6ST_A1sBpGHgVfMyWFH68YYQue2In",  # 03-sab-21-11-vai-vender-o-carro-1.jpg
    "03-2.jpg": "1GPJc2HBdl-fxI1BOcKl-L3HyPZsgJh9S",  # ...-2.jpg
    "03-3.jpg": "1xxcZJP7scDcalgfl0Lr1Rc13qxdb2H-A",  # ...-3.jpg
    "03-4.jpg": "15UsZwjrQ23jKntQuDIrcFv9WQRHHmL0k",  # ...-4.jpg
    "03-5.jpg": "1C3e6zoX3PhS1dAoGrGJM9p9Gx5AP4f99",  # ...-5.jpg
    "03-6.jpg": "14Bn1Fl9cBy70Jgf469kKXhMTrG2datqK",  # ...-6.jpg
    "03-7.jpg": "1l0np8fER9NTW6EE0jtHm5IKWbeoCKFVq",  # ...-7.jpg
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


# POST 1 · Ter 17/11 10:00 · Feed · Gift Card de Natal
save(quadrado('01.jpg'), 'semana6-01-gift-card-natal.jpg')

# POST 2 · Qua 18/11 18:00 · Story · Tapete da sala (já em 1080x1920)
save(Image.open('dl/02.jpg').convert('RGB'), 'semana6-02-story-tapete-casa.jpg')

# POST 3 · Sáb 21/11 10:00 · Carrossel (7) · Vai vender o carro?
SLIDES = ['01-capa', '02-pintura', '03-bancos', '04-teto', '05-rodas', '06-motor', '07-cta']
for i, nome in enumerate(SLIDES, 1):
    save(quadrado(f'03-{i}.jpg'), f'carrossel-revenda/revenda-{nome}.jpg')

# POST 3b · Sáb 21/11 10:15 · Story de chamada
chamada(Image.open('out/carrossel-revenda/revenda-01-capa.jpg').convert('RGB'),
        'Vai vender o carro?', '5 cuidados antes do anúncio', 'chamadas/chamada-21-11-revenda.jpg')

print("Artes geradas em out/")
