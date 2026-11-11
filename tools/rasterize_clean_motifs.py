"""Create clean transparent motif PNGs from the project's source-backed studies.

The source study files were traced or repaired from the heritage photographs in
assets/heritage/papers. Vector studies are rasterized once here so the public
motif picker never serves an SVG as a finished artistic texture.
"""
import os

import cairosvg
from PIL import Image


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOTIFS = os.path.join(ROOT, "assets", "motifs")
OUTPUT = os.path.join(ROOT, "assets", "patterns", "restored")
SIZE = 1536


def crop_alpha(image):
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        return image
    left, top, right, bottom = bounds
    padding = round(max(right - left, bottom - top) * .035)
    box = (
        max(0, left - padding),
        max(0, top - padding),
        min(image.width, right + padding),
        min(image.height, bottom + padding),
    )
    cropped = image.crop(box)
    side = max(cropped.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return square.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def save_svg(source, output):
    rendered = cairosvg.svg2png(
        url=os.path.join(MOTIFS, source),
        output_width=SIZE,
        output_height=SIZE,
        background_color=None,
    )
    path = os.path.join(OUTPUT, output)
    with open(path, "wb") as stream:
        stream.write(rendered)
    image = Image.open(path)
    crop_alpha(image).save(path, optimize=True)


def save_png(source, output):
    image = Image.open(os.path.join(MOTIFS, source))
    crop_alpha(image).save(os.path.join(OUTPUT, output), optimize=True)


def main():
    os.makedirs(OUTPUT, exist_ok=True)
    save_png("bird-flower-study.png", "flower-birds.png")
    save_png("opera-face-study.png", "opera-face.png")
    save_svg("three-pools.svg", "three-pools.png")
    save_svg("lake-bridge-night.svg", "lake-bridge-night.png")
    save_svg("sunset-townscape.svg", "sunset-townscape.png")
    save_svg("magnolia-branch.svg", "magnolia-branch.png")
    save_svg("blossom-cluster.svg", "blossom-cluster.png")
    save_svg("cloud-scroll.svg", "cloud-scroll.png")
    save_svg("flower-border.svg", "flower-border.png")
    print(f"Rasterized clean motifs to {OUTPUT}")


if __name__ == "__main__":
    main()
