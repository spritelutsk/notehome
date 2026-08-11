"""Иконки приложения для манифеста.

Рисуются кодом, а не лежат картинкой, чтобы совпадать с favicon в index.html: тот же синий
скруглённый квадрат и та же белая папка. Понадобится сменить логотип — правится в одном месте.
"""
from PIL import Image, ImageDraw

BLUE_TOP = (77, 139, 255)
BLUE_BOTTOM = (31, 107, 255)
SS = 4  # сглаживание через отрисовку в увеличенном масштабе


def gradient(size):
    img = Image.new("RGB", (size, size), BLUE_BOTTOM)
    d = ImageDraw.Draw(img)
    for y in range(size):
        k = y / max(1, size - 1)
        d.line(
            [(0, y), (size, y)],
            fill=tuple(round(a + (b - a) * k) for a, b in zip(BLUE_TOP, BLUE_BOTTOM)),
        )
    return img


def folder_mask(size, inset):
    """Белая папка на прозрачном фоне. Пропорции взяты из SVG в index.html (viewBox 40×40)."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    s = (size - inset * 2) / 40.0
    x0, y0 = inset, inset

    def p(x, y):
        return (x0 + x * s, y0 + y * s)

    # Корпус папки начинается ниже язычка — иначе они сливаются в один прямоугольник
    # и от папки остаётся просто квадрат.
    d.rounded_rectangle([p(11, 14), p(29, 29)], radius=2.6 * s, fill=255)
    # Язычок: левая часть выше корпуса, со скосом вправо — как в SVG (11,13)…(19,11)…(22,14).
    d.rounded_rectangle([p(11, 11), p(20, 19)], radius=1.8 * s, fill=255)  # ниже стыка: скругление прячется под корпусом
    d.polygon([p(18.5, 11), p(22.5, 14.6), p(18.5, 14.6)], fill=255)
    return m


def make(size, maskable=False):
    big = size * SS
    # У maskable-иконки система может обрезать до 80% — поэтому рисунок ужимается к центру,
    # а фон заливает весь квадрат целиком.
    pad = int(big * 0.18) if maskable else int(big * 0.06)
    radius = 0 if maskable else int(big * 0.22)

    bg = gradient(big).convert("RGBA")
    if radius:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=255)
        bg.putalpha(mask)

    folder = folder_mask(big, pad)
    white = Image.new("RGBA", (big, big), (255, 255, 255, 235))
    bg = Image.alpha_composite(bg, Image.composite(white, Image.new("RGBA", (big, big), (0, 0, 0, 0)), folder))
    return bg.resize((size, size), Image.LANCZOS)


base = "/home/sergey/Documents/note/public/icons"
import os
os.makedirs(base, exist_ok=True)
for size in (192, 512):
    make(size).save(f"{base}/icon-{size}.png", optimize=True)
make(512, maskable=True).save(f"{base}/icon-maskable-512.png", optimize=True)
print("иконки записаны в public/icons/")
