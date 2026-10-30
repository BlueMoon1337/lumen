#!/usr/bin/env python3
"""
Draws the Mac disk image's window background (src-tauri/dmg/background.png): Lumen, the step to
drag it into Applications with an arrow between the two icons, and what to do the first time it's
opened. The icon positions match "dmg" in src-tauri/tauri.conf.json. Needs Pillow and the Inter
font; run it again after changing either.

    python3 scripts/dmg-background.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri/dmg/background.png"
ICON = ROOT / "src-tauri/icons/icon.png"
# The window is 660x588 in tauri.conf.json, its title bar included; the picture runs a little
# past its bottom edge so no bare strip shows whichever way Finder measures it.
W, H = 660, 600
APP, APPS = (165, 262), (495, 262)  # icon centres, as in tauri.conf.json
PINK = (232, 74, 138)


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    for path in (f"/usr/share/fonts/opentype/inter/Inter-{weight}.otf", "/Library/Fonts/Inter.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def centred(draw: ImageDraw.ImageDraw, y: int, text: str, f: ImageFont.FreeTypeFont, fill) -> None:
    w = draw.textlength(text, font=f)
    draw.text(((W - w) / 2, y), text, font=f, fill=fill)


def main() -> None:
    img = Image.new("RGB", (W, H), (250, 250, 252))
    d = ImageDraw.Draw(img)
    # A soft fade to the bottom.
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(250 - 8 * t), int(250 - 8 * t), int(252 - 6 * t)))

    # Lumen, and the Installation band.
    icon = Image.open(ICON).convert("RGBA").resize((64, 64), Image.LANCZOS)
    title = font("Bold", 34)
    tw = d.textlength("Lumen", font=title)
    x0 = (W - (64 + 14 + tw)) / 2
    img.paste(icon, (int(x0), 18), icon)
    d.text((x0 + 78, 28), "Lumen", font=title, fill=(28, 28, 32))
    d.rectangle([0, 98, W, 126], fill=PINK)
    d.text((24, 103), "INSTALLATION", font=font("Bold", 15), fill="white")

    centred(d, 146, "Drag the Lumen icon to the Applications folder", font("SemiBold", 18), (28, 28, 32))

    # A curved arrow from Lumen to Applications, yellow to orange, with a soft shadow. Drawn four
    # times larger and scaled down, so its edges are smooth.
    k = 4
    arrow = Image.new("RGBA", (W * k, H * k), (0, 0, 0, 0))
    a = ImageDraw.Draw(arrow)
    (x1, y1), (x2, y2) = (APP[0] + 80, APP[1] - 8), (APPS[0] - 96, APPS[1] - 8)
    steps = 400
    for i in range(steps + 1):
        t = i / steps
        x = (x1 + (x2 - x1) * t) * k
        y = (y1 - 50 * 4 * t * (1 - t)) * k  # a shallow arc above the straight line
        r = (4 + 5 * t) * k
        a.ellipse([x - r, y - r, x + r, y + r], fill=(255, int(216 - 76 * t), int(90 - 72 * t), int(70 + 185 * t)))
    # The head, pointing along the end of the arc (slightly down, to the right).
    hx, hy = x2 * k, y1 * k
    a.polygon([(hx + 26 * k, hy + 8 * k), (hx - 4 * k, hy - 18 * k), (hx, hy + 26 * k)], fill=(247, 140, 22, 255))
    arrow = arrow.resize((W, H), Image.LANCZOS)
    shadow = arrow.getchannel("A").filter(ImageFilter.GaussianBlur(4)).point(lambda v: v // 6)
    img.paste((0, 0, 0), (0, 3), shadow)
    img.paste(arrow, (0, 0), arrow)

    # The first time it's opened (Lumen isn't signed with an Apple Developer ID).
    small, bold = font("Regular", 13), font("SemiBold", 13)
    grey = (70, 70, 78)
    centred(d, 368, "The first time: in Applications, right-click Lumen and choose Open, then Open.", small, grey)
    centred(d, 388, "If macOS says Lumen “is damaged”, open Read Me First below for the one-line fix.", small, grey)
    d.line([(W / 2 - 160, 416), (W / 2 + 160, 416)], fill=(222, 222, 228), width=1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({W}x{H})")


if __name__ == "__main__":
    main()
