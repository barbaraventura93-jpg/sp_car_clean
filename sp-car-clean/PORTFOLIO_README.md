# Portfolio de Obras - Como Adicionar Mídia

## Estrutura

```
assets/
├── portfolio/          ← Coloque as imagens/vídeos aqui
│   ├── foto1.jpg
│   ├── foto2.jpg
│   ├── video1.mp4
│   └── video1-thumb.jpg (para vídeos)
└── portfolio.json      ← Lista as mídias
```

## Passo a Passo

### 1. Adicionar arquivo à pasta
- Coloque a imagem ou vídeo em `assets/portfolio/`
- Nomes: use sem espaços, exemplo: `polimento-preto.jpg`, `antes-depois.mp4`

### 2. Atualizar portfolio.json
Abra `assets/portfolio.json` e adicione um item:

**Para imagem:**
```json
{
  "id": 4,
  "type": "image",
  "title": "Nome da obra",
  "url": "/assets/portfolio/foto.jpg",
  "thumb": "/assets/portfolio/foto.jpg"
}
```

**Para vídeo:**
```json
{
  "id": 5,
  "type": "video",
  "title": "Nome do vídeo",
  "url": "/assets/portfolio/video.mp4",
  "thumb": "/assets/portfolio/video-thumb.jpg"
}
```

### 3. Commit e Deploy
```bash
git add assets/
git commit -m "Adicionar nova obra ao portfólio"
git push
```

## Dicas

✅ **Imagens**: JPG (200x200px), PNG  
✅ **Vídeos**: MP4 (recomendado), WebM  
✅ **Thumbnails**: JPG 200x200px para vídeos  
⚠️ **Tamanho**: Otimize para web (~500KB por arquivo)

## Exemplo Completo

```json
{
  "items": [
    {
      "id": 1,
      "type": "image",
      "title": "Polimento Carro Preto",
      "url": "/assets/portfolio/polimento-preto.jpg",
      "thumb": "/assets/portfolio/polimento-preto.jpg"
    },
    {
      "id": 2,
      "type": "image",
      "title": "Cristalização",
      "url": "/assets/portfolio/cristalizacao.jpg",
      "thumb": "/assets/portfolio/cristalizacao.jpg"
    },
    {
      "id": 3,
      "type": "video",
      "title": "Antes e Depois em 60s",
      "url": "/assets/portfolio/antes-depois.mp4",
      "thumb": "/assets/portfolio/antes-depois-thumb.jpg"
    }
  ]
}
```

## Funcionalidades

- 🎯 Carrossel horizontal com scroll suave
- 📱 Responsivo em mobile
- ▶️ Vídeos com botão play (clique para expandir)
- 🖼️ Imagens com zoom ao passar o mouse
- ✨ Transições suaves

Pronto! O carrossel aparecerá automaticamente no hero quando adicionar os arquivos e atualizar o JSON.
