#!/usr/bin/env python3
"""SP Car Clean — Semana 4 (03 a 08/11/2026): gera todas as artes validadas.
Pré-requisitos (rodar na raiz de uma pasta de trabalho):
  pip install pillow
  mkdir -p fonts && cd fonts && npm pack @fontsource/montserrat@5.3.0 @fontsource/open-sans@5.3.0 \
    && for f in *.tgz; do tar xzf "$f" && mv package "${f%.tgz}"; done && cd ..
  Baixar cada foto do dicionário FOTOS (Google Drive, pelo ID) para raw/<nome_local>.
Saída: out/ (feed, carrossel-moto/, carrossel-vidros/, chamadas/, projeto-corsa-uva/)
"""
FOTOS = {
    "piso-banco-antes_1J_fwb.jpg": "1J_fwb4I85_2lGYGZ2IMLGyHNcZWMrOjm",
    "piso-banco-depois_15U2Lh.jpg": "15U2Lh7xYZlcG5xYGaMgDDpCkGXxxm2eI",
    "IMG-20260806-WA0065.jpeg": "1UpLBM0IMKTSsGEbhnHykY09NtxUfOrwx",
    "IMG-20260806-WA0061.jpeg": "1PUsiUyVdDRVt-PLbum86N8s-ZQfUOseH",
    "IMG-20260806-WA0047.jpeg": "1rnf5Qq08H4J6m8D12WHCJgwjYk02DLgR",
    "IMG-20260806-WA0054.jpeg": "12Y8vYkm6CfZCrmHuQ9IJJtnrdADT3fR4",
    "IMG-20260806-WA0050.jpeg": "12qiScbNBbI34IxcWQGqO9X-1e5XwOISv",
    "fusca-preto-frente_1nltaK.jpg": "1nltaKFSoJRM3iCLGdZi7hyfBFPIIU9R-",
    "IMG_20261023_102829.jpg": "1ze0Vlu03n9iQH2j91RIyLUT65tKxhe1r",
    "unsplash/manchas.jpg": "1_rfCD8Tq4NuhDxUVOSYENk4r4FNGKaT2",
    "IMG-20260807-WA0012.jpg": "1m-t6kj7x2grQgTox5inXPhEXtoH5pop1",
    "unsplash/farol.jpg": "1MvLKg52xoBYJo92EuITBQaVfnFLRLgYK",
    "IMG_20261022_152853.jpg": "1fIU9yKignV2AK0mUPzx4Kc5M7gMXfjV_",
    "corsa-uva_1792248548071.jpg": "1_wANEkqYiJhnAml4_oL7x_wPdlaYUYEu",
}
import os
faltando = [n for n in FOTOS if not os.path.exists("raw/" + n)]
if faltando:
    raise SystemExit("Fotos faltando em raw/: " + ", ".join(faltando))

# ===== IDENTIDADE VISUAL =====
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageOps
import os
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
        x = (img.width - max(w1 + w2, wd)) / 2
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

def footer(img, y=None, text='Guarulhos · SP'):
    d = ImageDraw.Draw(img); f = O(600, 26)
    y = y or img.height - 62
    d.text((img.width - 54 - d.textlength(text, font=f), y), text, font=f, fill=TXT2)

def save(img, name):
    p = 'out/' + name
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.convert('RGB').save(p, quality=92)
    return p


# ===== POST 1 · Ter 03/11 · Embaixo do banco =====
S=1080; H=S; W=S//2
a=treat('raw/piso-banco-antes_1J_fwb.jpg'); b=treat('raw/piso-banco-depois_15U2Lh.jpg')
def strip(im,cx):
    # crop vertical strip with aspect W:H centered at cx (fraction of width)
    h=im.height; w=int(h*W/H); x=int(im.width*cx-w/2)
    return im.crop((x,0,x+w,h)).resize((W,H),Image.LANCZOS)
img=Image.new('RGB',(S,S))
img.paste(strip(a,0.50),(0,0)); img.paste(strip(b,0.52),(W,0))
img=img.convert('RGBA')
img=scrim(img,0,240,225,0)
img=scrim(img,600,S,0,245)
d=ImageDraw.Draw(img)
d.line([(W,0),(W,740)],fill=LBLUE,width=6)
logo(img,54,46,34)
outline_pill(img,40,260,'ANTES',M(800,28),col=WHITE,fill=BG)
grad_pill(img,W+40,260,'DEPOIS',M(800,28),padx=24)
d=ImageDraw.Draw(img)
d.text((54,770),'Embaixo do banco',font=M(800,64),fill=WHITE)
text_block(img,54,858,'O que ninguém vê, a gente limpa: trilhos, cantos e chicotes sem poeira nem barro.',O(600,30),TXT,880)
d.text((54,S-62),'spcarclean.com.br · Agende online',font=M(700,26),fill=LBLUE)
footer(img)
save(img,'semana4-01-antes-depois-embaixo-do-banco.jpg')


# ===== POST 2 + 2b · Qua 04/11 · Carrossel moto + chamada =====
S=1080
def chev(d,x,y):
    for i in range(3):
        xx=x+i*22; d.line([(xx,y-14),(xx+14,y),(xx,y+14)],fill=LBLUE,width=5)
def base(path,fx,fy,zoom=1.0):
    img=cover(treat(path),S,S,fx=fx,fy=fy,zoom=zoom).convert('RGBA')
    img=scrim(img,0,260,240,0); img=scrim(img,480,700,0,225); img=scrim(img,700,S,225,252)
    logo(img,54,46,30); return img
def capa():
    img=base('raw/IMG-20260806-WA0065.jpeg',0.42,0.5); d=ImageDraw.Draw(img)
    outline_pill(img,54,620,'PASSO A PASSO',M(800,24),col=LBLUE,fill=BG)
    d.text((54,690),'Lavagem Detalhada',font=M(800,64),fill=WHITE)
    d.text((54,766),'de Moto',font=M(800,64),fill=LBLUE)
    text_block(img,54,858,'Do primeiro jato ao brilho final: veja o que acontece em cada etapa.',O(600,30),TXT,960)
    d.text((54,S-74),'Deslize',font=M(700,28),fill=WHITE); chev(d,180,S-58); footer(img,S-62)
    return img
def passo(n,path,fx,fy,tit,txt,zoom=1.0):
    img=base(path,fx,fy,zoom); d=ImageDraw.Draw(img)
    f=M(900,40); num=f'{n:02d}'; d.text((S-54-d.textlength(num,font=f),44),num,font=f,fill=LBLUE)
    outline_pill(img,54,660,f'PASSO {n-1}',M(800,24),col=LBLUE,fill=BG)
    d.text((54,730),tit,font=M(800,56),fill=WHITE)
    text_block(img,54,816,txt,O(600,30),TXT,970,1.3)
    footer(img,S-62); return img
def cta():
    img=base('raw/IMG-20260806-WA0065.jpeg',0.92,0.5,zoom=1.35); d=ImageDraw.Draw(img)
    d.text((54,640),'Sua moto merece',font=M(800,60),fill=WHITE)
    d.text((54,712),'esse cuidado.',font=M(800,60),fill=LBLUE)
    text_block(img,54,800,'Lavagem Detalhada de Motos com hora marcada, de segunda a sexta.',O(600,30),TXT,960)
    grad_pill(img,54,900,'WhatsApp (11) 92669-7474',M(800,30),padx=32)
    d.text((54,S-64),'spcarclean.com.br · Agende online',font=M(700,24),fill=LBLUE); footer(img,S-62)
    return img
sl=[('01-capa',capa()),
 ('02-espuma',passo(2,'raw/IMG-20260806-WA0061.jpeg',0.5,0.5,'Espuma primeiro','A espuma amolece a sujeira antes de qualquer contato, para não riscar a pintura e as carenagens.')),
 ('03-desengraxante',passo(3,'raw/IMG-20260806-WA0047.jpeg',0.5,0.30,'Graxa sai no pincel','Na balança, na relação e nos pedais, desengraxante e pincel tiram a graxa velha peça por peça.')),
 ('04-rodas',passo(4,'raw/IMG-20260806-WA0054.jpeg',0.5,0.35,'Rodas e pneus','Pneu e roda recebem produto próprio e escova, inclusive nos raios e perto do disco de freio.')),
 ('05-frestas',passo(5,'raw/IMG-20260806-WA0050.jpeg',0.5,0.12,'Onde ninguém olha','Embaixo da rabeta e no suporte da placa, onde a sujeira da estrada se acumula.')),
 ('06-cta',cta())]
for n,i in sl: save(i,f'carrossel-moto/moto-{n}.jpg')
# chamada
capa_img=Image.open('out/carrossel-moto/moto-01-capa.jpg').convert('RGB')
W,H=1080,1920
bg=ImageEnhance.Brightness(cover(capa_img,W,H).filter(ImageFilter.GaussianBlur(30))).enhance(0.4).convert('RGBA')
img=scrim(bg,0,H,120,170); logo(img,0,110,40,center=True); d=ImageDraw.Draw(img)
f=M(800,32); t='POST NOVO NO FEED'; w=d.textlength(t,font=f)+80; h=74; x=(W-w)/2
d.rounded_rectangle([x,280,x+w,280+h],radius=h//2,fill=BLUE); bb=f.getbbox(t); d.text((x+40,280+(h-(bb[3]+bb[1]))/2),t,font=f,fill=WHITE)
y=text_block(img,0,400,'Lavagem Detalhada de Moto:',M(800,58),WHITE,1000,1.15,center=True)
y=text_block(img,0,y,'passo a passo',M(700,46),LBLUE,1000,1.2,center=True)
cw=860; x0=(W-cw)//2; y0=int(y)+50
d.rounded_rectangle([x0-8,y0-8,x0+cw+8,y0+cw+8],radius=34,fill=LBLUE)
m=Image.new('L',(cw,cw),0); ImageDraw.Draw(m).rounded_rectangle([0,0,cw-1,cw-1],radius=28,fill=255)
img.paste(capa_img.resize((cw,cw),Image.LANCZOS),(x0,y0),m)
t='Confira no perfil @spcarclean'; f=M(800,44); d.text(((W-d.textlength(t,font=f))/2,y0+cw+80),t,font=f,fill=WHITE)
footer(img,H-90); save(img,'chamadas/chamada-04-11-moto.jpg')


# ===== POST 3 · Qui 05/11 · Polimento de carro preto =====
S=1080
ph=treat('raw/fusca-preto-frente_1nltaK.jpg')
img=cover(ph,S,S,fx=0.40,fy=0.30).convert('RGBA')
img=scrim(img,0,320,252,0)
img=scrim(img,470,700,0,215)
img=scrim(img,700,S,215,250)
logo(img,54,46,34)
d=ImageDraw.Draw(img)
outline_pill(img,54,640,'POLIMENTO DE CARRO PRETO',M(800,24),col=LBLUE,fill=BG)
d.text((54,712),'Preto que vira espelho',font=M(800,62),fill=WHITE)
text_block(img,54,800,'O polimento corrige marcas finas da pintura e devolve a profundidade do reflexo.',O(600,30),TXT,940)
grad_pill(img,54,910,'Agende: (11) 92669-7474',M(800,28),padx=30)
footer(img,S-58)
save(img,'semana4-03-polimento-carro-preto.jpg')


# ===== POST 4 · Sáb 07/11 · Carrossel vidros =====
import sys, os
S=1080
def chevrons(d,x,y,col=LBLUE):
    for i in range(3):
        xx=x+i*22
        d.line([(xx,y-14),(xx+14,y),(xx,y+14)],fill=col,width=5,joint='curve')

def capa():
    ph=treat('raw/IMG_20261023_102829.jpg')
    img=cover(ph,S,S,fx=1.0,fy=0.42,zoom=2.0).convert('RGBA')
    img=scrim(img,0,300,250,0); img=scrim(img,470,700,0,225); img=scrim(img,700,S,225,252)
    logo(img,54,46,34); d=ImageDraw.Draw(img)
    outline_pill(img,54,600,'GUIA RÁPIDO',M(800,24),col=LBLUE,fill=BG)
    d.text((54,668),'Vidros e faróis',font=M(800,76),fill=WHITE)
    d.text((54,768),'3 problemas que têm solução',font=M(700,40),fill=LBLUE)
    text_block(img,54,840,'E por que vale resolver antes que piorem.',O(600,30),TXT,900)
    d.text((54,S-74),'Deslize',font=M(700,28),fill=WHITE); chevrons(d,180,S-58)
    footer(img,S-62)
    return img

def topico(n,photo,fx,fy,titulo,texto,servico,sol,pend=None):
    if photo and os.path.exists(photo):
        img=cover(treat(photo),S,S,fx=fx,fy=fy).convert('RGBA')
    else:
        img=Image.new('RGBA',(S,S),BG2+(255,))
        d=ImageDraw.Draw(img)
        for i in range(0,S,36): d.line([(i,60),(i+18,60)],fill=TXT2,width=3); d.line([(i,560),(i+18,560)],fill=TXT2,width=3)
        f=M(800,34); t='[FOTO PENDENTE]'
        d.text(((S-d.textlength(t,font=f))/2,250),t,font=f,fill=LBLUE)
        f2=O(600,26)
        d.text(((S-d.textlength(pend,font=f2))/2,305),pend,font=f2,fill=TXT2)
    img=scrim(img,0,220,230,0); img=scrim(img,420,640,0,228); img=scrim(img,640,S,228,252)
    d=ImageDraw.Draw(img)
    logo(img,54,46,30)
    f=M(900,40); num=f'{n:02d}'
    d.text((S-54-d.textlength(num,font=f),44),num,font=f,fill=LBLUE)
    y=560
    d.text((54,y),titulo,font=M(800,56),fill=WHITE)
    y=text_block(img,54,y+80,texto,O(400,29),TXT,970,1.3)+18
    d.rounded_rectangle([54,y,S-54,y+222],radius=24,fill=CARD+(235,),outline=DBLUE,width=2)
    d.text((84,y+22),'SOLUÇÃO',font=M(700,22),fill=TXT2)
    d.text((84,y+52),servico,font=M(800,34),fill=LBLUE)
    text_block(img,84,y+100,sol,O(600,26),TXT,S-170,1.25)
    return img

def cta():
    ph=treat('raw/IMG_20261022_152853.jpg')
    img=cover(ph,S,S,fx=0.45,fy=0.4).convert('RGBA')
    img=scrim(img,0,260,235,0); img=scrim(img,400,640,0,230); img=scrim(img,640,S,230,252)
    logo(img,54,46,34); d=ImageDraw.Draw(img)
    d.text((54,600),'Enxergar bem',font=M(800,64),fill=WHITE)
    d.text((54,676),'é segurança.',font=M(800,64),fill=LBLUE)
    text_block(img,54,770,'Traga seu carro para uma avaliação dos vidros e faróis. Atendemos de segunda a sexta, com hora marcada.',O(600,29),TXT,960)
    grad_pill(img,54,900,'WhatsApp (11) 92669-7474',M(800,30),padx=32)
    d.text((54,S-64),'spcarclean.com.br · Agende online',font=M(700,24),fill=LBLUE)
    footer(img,S-62)
    return img

U='raw/unsplash/'
slides=[
 ('01-capa',capa(),None),
 ('02-manchas',topico(2,U+'manchas.jpg',0.62,0.2,'Manchas no vidro','Gotas de chuva e de lavagem secam e deixam marcas que embaçam a visão, principalmente à noite e contra o sol.','Polimento de vidros','Remove as manchas e devolve a transparência do para-brisa.','Unsplash LFs1SDLr5jE · para-brisa com gotas'),U+'manchas.jpg'),
 ('03-trinca',topico(3,'raw/IMG-20260807-WA0012.jpg',0.5,0.85,'Trinca pequena cresce','Uma pedrinha na estrada abre um ponto de impacto. Com vibração e variação de temperatura, ele pode virar uma trinca longa.','Reparo de trinca','Feito cedo, pode evitar a troca do para-brisa. Avaliamos antes, e o reparo pode ser feito no seu local, conforme a localização.','foto propria'),'raw/IMG-20260807-WA0012.jpg'),
 ('04-farois',topico(4,U+'farol.jpg',0.55,0.35,'Farol amarelado','Com o sol, a lente do farol oxida, fica opaca e amarelada e espalha menos luz na pista. O ideal é a lente assim, transparente.','Restauração de faróis','Remove a camada oxidada e devolve a transparência da lente.','Unsplash O-9ZolZHZvw · farol opaco/amarelado'),U+'farol.jpg'),
 ('05-cta',cta(),None),
]
for name,img,ph in slides:
    suf='' if (ph is None or os.path.exists(ph)) else '-PREVIA-foto-pendente'
    save(img,f'carrossel-vidros/vidros-{name}{suf}.jpg')


# ===== POST 4b · Sáb 07/11 · Chamada vidros =====
W,H=1080,1920
capa=Image.open('out/carrossel-vidros/vidros-01-capa.jpg').convert('RGB')
bg=cover(capa,W,H).filter(ImageFilter.GaussianBlur(30))
bg=ImageEnhance.Brightness(bg).enhance(0.4).convert('RGBA')
img=scrim(bg,0,H,120,170)
logo(img,0,110,40,center=True)
d=ImageDraw.Draw(img)
f=M(800,32); t='POST NOVO NO FEED'; w=d.textlength(t,font=f)+80; h=74
x=(W-w)/2; d.rounded_rectangle([x,280,x+w,280+h],radius=h//2,fill=BLUE)
bb=f.getbbox(t); d.text((x+40,280+(h-(bb[3]+bb[1]))/2),t,font=f,fill=WHITE)
y=text_block(img,0,400,'Vidros e faróis:',M(800,66),WHITE,1000,1.15,center=True)
y=text_block(img,0,y,'3 problemas que têm solução',M(700,46),LBLUE,1000,1.2,center=True)
cw=860; x0=(W-cw)//2; y0=int(y)+50
d.rounded_rectangle([x0-8,y0-8,x0+cw+8,y0+cw+8],radius=34,fill=LBLUE)
m=Image.new('L',(cw,cw),0); ImageDraw.Draw(m).rounded_rectangle([0,0,cw-1,cw-1],radius=28,fill=255)
img.paste(capa.resize((cw,cw),Image.LANCZOS),(x0,y0),m)
y=y0+cw+80
t='Confira no perfil @spcarclean'; f=M(800,44)
d.text(((W-d.textlength(t,font=f))/2,y),t,font=f,fill=WHITE)
footer(img,H-90)
save(img,'chamadas/chamada-07-11-vidros.jpg')


# ===== POST 5 · Dom 08/11 · Projeto Personalizado Ep. 01 =====
S=1080
ph=treat('raw/corsa-uva_1792248548071.jpg')
img=cover(ph,S,S,fx=0.30,fy=0.55).convert('RGBA')
img=scrim(img,0,280,240,0); img=scrim(img,480,700,0,220); img=scrim(img,700,S,220,252)
logo(img,54,46,34); d=ImageDraw.Draw(img)
outline_pill(img,54,600,'PROJETO PERSONALIZADO · EP. 01',M(800,24),col=LBLUE,fill=BG)
d.text((54,670),'Pickup Corsa Uva:',font=M(800,62),fill=WHITE)
d.text((54,744),'começou o projeto',font=M(800,62),fill=LBLUE)
text_block(img,54,836,'A nossa Pickup Corsa Uva vai ganhar um projeto personalizado completo. Vamos mostrar cada etapa por aqui.',O(600,30),TXT,960)
d.text((54,S-66),'Siga @spcarclean e acompanhe',font=M(700,26),fill=WHITE)
footer(img,S-62)
save(img,'projeto-corsa-uva/corsa-uva-ep01-projeto-personalizado.jpg')


print("Artes geradas em out/")
