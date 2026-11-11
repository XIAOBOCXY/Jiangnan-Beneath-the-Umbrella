"""Compose full-canopy designs from the studio's painterly motif assets."""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets", "patterns", "painted-collection")
OUTPUT = os.path.join(ROOT, "assets", "patterns", "whole-canopy")
SIZE = 768
CENTER = SIZE / 2
RADIUS = SIZE * .488


DESIGNS = (
    ("lake-moon", "#e8e2cf", ("blue-lake", .5, .56, .90, .55, 0), ("clouds", .5, .21, .48, .17, 0)),
    ("flower-bird", "#eee7d5", ("white-flowers", .37, .51, .58, .43, -8), ("green-bird", .69, .31, .27, .25, 24), ("plum", .69, .72, .31, .24, -18)),
    ("lotus-water", "#d6dfd1", ("lotus", .48, .52, .54, .49, -8), ("blue-blossoms", .73, .71, .31, .25, 18), ("white-butterfly", .25, .29, .23, .22, -12)),
    ("opera-gathering", "#dfd6bd", ("green-opera", .30, .34, .30, .34, -10), ("gold-opera", .70, .34, .30, .34, 10), ("blue-opera", .30, .69, .30, .34, 10), ("red-opera", .70, .69, .30, .34, -10)),
    ("pavilion-cloud", "#e9e1cd", ("clouds", .5, .25, .72, .23, 0), ("pavilion", .50, .62, .91, .44, 0), ("white-flowers", .23, .73, .27, .22, -12)),
)


def fabric_disc(color: str, seed: int) -> Image.Image:
    base = np.array([int(color[index:index + 2], 16) for index in (1, 3, 5)], dtype=np.float32)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    distance = np.sqrt((xx - CENTER) ** 2 + (yy - CENTER) ** 2)
    glow = np.clip(1 - distance / (RADIUS * 1.55), 0, 1)
    noise = np.random.default_rng(seed).normal(0, 1.25, (SIZE, SIZE, 1))
    lift = np.array([13, 12, 8], dtype=np.float32)[None, None, :] * glow[:, :, None]
    rgb = np.clip(base[None, None, :] + lift + noise, 0, 255).astype(np.uint8)
    alpha = np.clip((RADIUS + 2 - distance) * 16, 0, 255).astype(np.uint8)
    rgba = np.dstack((rgb, alpha))
    return Image.fromarray(rgba)


def place(canvas: Image.Image, motif_name: str, x: float, y: float,
          max_width: float, max_height: float, angle: float) -> None:
    source = Image.open(os.path.join(SOURCE, f"{motif_name}.webp")).convert("RGBA")
    bounds = source.getchannel("A").getbbox()
    if bounds:
        source = source.crop(bounds)
    scale = min(max_width / source.width, max_height / source.height)
    size = (max(1, round(source.width * scale)), max(1, round(source.height * scale)))
    source = source.resize(size, Image.Resampling.LANCZOS)
    if angle:
        source = source.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    canvas.alpha_composite(source, (round(x * SIZE - source.width / 2), round(y * SIZE - source.height / 2)))


def main() -> None:
    os.makedirs(OUTPUT, exist_ok=True)
    previews = []
    for index, (design_id, color, *motifs) in enumerate(DESIGNS):
        canvas = fabric_disc(color, 820 + index * 47)
        for name, x, y, width, height, angle in motifs:
            place(canvas, name, x, y, width * SIZE, height * SIZE, angle)
        draw = ImageDraw.Draw(canvas)
        draw.ellipse((SIZE * .016, SIZE * .016, SIZE * .984, SIZE * .984),
                    outline=(103, 86, 59, 54), width=2)
        path = os.path.join(OUTPUT, f"{design_id}.webp")
        canvas.save(path, "WEBP", quality=94, method=6)
        previews.append((design_id, canvas.copy()))
        print(f"Generated {path}")

    sheet = Image.new("RGB", (SIZE * len(previews), SIZE), "#e9e3d4")
    for index, (design_id, image) in enumerate(previews):
        tile = Image.new("RGBA", (SIZE, SIZE), "#e9e3d4")
        tile.alpha_composite(image)
        sheet.paste(tile.convert("RGB"), (SIZE * index, 0))
    sheet.save(os.path.join(ROOT, "tmp", "whole-canopy-contact.jpg"), quality=90)


if __name__ == "__main__":
    main()
