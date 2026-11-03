# Renders every app icon from the owner's logo (a flat gold star with a
# lightning cut, on a white ground):
#   uv run --no-project --with pillow --with numpy python -I scripts/render-logo.py
# Reads assets/brand/logo-source.png (the original file, unchanged) and
# writes assets/icon.png, android-icon-foreground.png,
# android-icon-monochrome.png, splash-icon.png, notification-icon.png and
# favicon.png. The star is cut from the white ground by its blue channel
# (the gold has almost none), so its edges stay smooth and the lightning
# cut becomes see-through. The star is only scaled, never stretched.
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
SOURCE = os.path.join(ASSETS, "brand", "logo-source.png")

GOLD = (248, 190, 3)  # measured: the star's flat fill
GROUND = (255, 255, 255)  # the logo's own white ground


def cut_star(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    blue = rgb[:, :, 2]
    white = np.median(blue[blue > 245])
    alpha = np.clip((white - blue) / (white - GOLD[2]), 0.0, 1.0)
    alpha[alpha < 0.02] = 0.0
    return alpha


def enclosing_circle(alpha):
    """Smallest circle around the star (Badoiu-Clarkson on its edge pixels)."""
    ys, xs = np.nonzero(alpha > 0.5)
    pts = np.stack([xs, ys], axis=1).astype(np.float64)
    c = pts.mean(axis=0)
    for i in range(1, 4000):
        far = pts[np.argmax(((pts - c) ** 2).sum(axis=1))]
        c = c + (far - c) / (i + 1)
    r = np.sqrt(((pts - c) ** 2).sum(axis=1)).max()
    return c, r


def place(alpha, centre, radius, size, target_radius):
    """The star's alpha on a size x size canvas, its circle centred, radius scaled."""
    scale = target_radius / radius
    h, w = alpha.shape
    img = Image.fromarray(np.uint8(np.round(alpha * 255)), "L")
    img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    canvas = Image.new("L", (size, size), 0)
    canvas.paste(img, (round(size / 2 - centre[0] * scale), round(size / 2 - centre[1] * scale)))
    return canvas


def coloured(mask, colour):
    out = Image.new("RGBA", mask.size, colour + (255,))
    out.putalpha(mask)
    return out


def on_ground(mask, colour, ground):
    out = Image.new("RGBA", mask.size, ground + (255,))
    out.alpha_composite(coloured(mask, colour))
    return out.convert("RGB")


def save(img, name):
    path = os.path.join(ASSETS, name)
    img.save(path, optimize=True)
    print(f"assets/{name}  {img.size[0]}px  {img.mode}  {os.path.getsize(path)} B")


def main():
    alpha = cut_star(sys.argv[1] if len(sys.argv) > 1 else SOURCE)
    centre, radius = enclosing_circle(alpha)
    W = (255, 255, 255)
    # Full icon (iOS, older Android launchers): star on the white ground.
    icon = on_ground(place(alpha, centre, radius, 1024, 400), GOLD, GROUND)
    save(icon, "icon.png")
    # Adaptive foreground and themed (monochrome) icon: the whole star inside
    # the 66/108 safe circle (radius 313 of 1024), so no mask clips a point.
    fg = place(alpha, centre, radius, 1024, 296)
    save(coloured(fg, GOLD), "android-icon-foreground.png")
    save(coloured(fg, W), "android-icon-monochrome.png")
    # Splash image, shown on the app's dark ground at imageWidth.
    save(coloured(place(alpha, centre, radius, 1024, 470), GOLD), "splash-icon.png")
    # Status-bar notification icon: white silhouette (Android tints it).
    save(coloured(place(alpha, centre, radius, 96, 46), W), "notification-icon.png")
    save(icon.resize((48, 48), Image.LANCZOS), "favicon.png")


main()
