from PIL import Image

img = Image.open('Logo.jpeg').convert('RGBA')
pixels = img.load()
w, h = img.size

for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        # Pixels brancos ou quase brancos viram transparentes
        if r > 230 and g > 230 and b > 230:
            pixels[x, y] = (r, g, b, 0)

img.save('assets/logo.png')
print('OK — assets/logo.png salvo')
