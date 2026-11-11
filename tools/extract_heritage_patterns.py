"""Extract photographic silk textures and motif studies from heritage records.

The source photographs are already stored under assets/heritage/papers. This
script normalizes their color, maps each circular canopy into the radial UV
space used by the umbrella model, and creates small transparent motif crops.
"""
import math
import os

import cv2
import numpy as np


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAPERS = os.path.join(ROOT, "assets", "heritage", "papers")
OUTPUT = os.path.join(ROOT, "assets", "patterns", "heritage")
TEXTURE_SIZE = 1024


def read(name):
    return cv2.imread(os.path.join(PAPERS, name), cv2.IMREAD_COLOR)


def write_png(path, rgba):
    if not cv2.imwrite(path, rgba):
        raise RuntimeError(f"Could not encode {path}")


def normalize(image, saturation=1.04, contrast=1.02):
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.35, tileGridSize=(8, 8))
    l = clahe.apply(l)
    image = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] *= saturation
    hsv[..., 1] = np.clip(hsv[..., 1], 0, 255)
    image = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    return np.clip((image.astype(np.float32) - 127.5) * contrast + 127.5, 0, 255).astype(np.uint8)


def extract_canopy(source, ellipse, output_name, saturation=1.04):
    image = read(source)
    cx, cy, rx, ry = ellipse
    source_points = np.float32([
        [cx - rx, cy - ry], [cx + rx, cy - ry],
        [cx + rx, cy + ry], [cx - rx, cy + ry],
    ])
    destination = np.float32([
        [0, 0], [TEXTURE_SIZE - 1, 0],
        [TEXTURE_SIZE - 1, TEXTURE_SIZE - 1], [0, TEXTURE_SIZE - 1],
    ])
    matrix = cv2.getPerspectiveTransform(source_points, destination)
    warped = cv2.warpPerspective(image, matrix, (TEXTURE_SIZE, TEXTURE_SIZE), flags=cv2.INTER_CUBIC)
    warped = normalize(warped, saturation=saturation, contrast=1.015)
    alpha = np.zeros((TEXTURE_SIZE, TEXTURE_SIZE), dtype=np.uint8)
    cv2.circle(alpha, (TEXTURE_SIZE // 2, TEXTURE_SIZE // 2), TEXTURE_SIZE // 2 - 5, 255, -1)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 1.1)
    rgba = cv2.cvtColor(warped, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = alpha
    write_png(os.path.join(OUTPUT, output_name), rgba)


def remove_radial_ribs(image, center, count=36, width=1.8):
    height, width_px = image.shape[:2]
    yy, xx = np.mgrid[0:height, 0:width_px]
    dx = xx - center[0]
    dy = yy - center[1]
    radius = np.hypot(dx, dy)
    angle = np.arctan2(dy, dx)
    step = math.tau / count
    nearest = np.round(angle / step) * step
    delta = np.abs(np.arctan2(np.sin(angle - nearest), np.cos(angle - nearest)))
    perpendicular = radius * np.sin(delta)
    mask = ((perpendicular < width) & (radius > 12)).astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((2, 2), np.uint8), iterations=1)
    return cv2.inpaint(image, mask, 3, cv2.INPAINT_TELEA)


def extract_motif(source, rect, output_name, mode="saturated", feather=22, rib_center=None):
    image = read(source)
    if rib_center is not None:
        image = remove_radial_ribs(image, rib_center)
    x0, y0, x1, y1 = rect
    crop = image[y0:y1, x0:x1].copy()
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    saturation = hsv[..., 1].astype(np.float32)
    value = hsv[..., 2].astype(np.float32)
    alpha = None
    if mode == "white_flower":
        score = ((value > 162) & (saturation < 72)).astype(np.float32)
    elif mode == "blue_scene":
        h, w = saturation.shape
        yy, xx = np.mgrid[0:h, 0:w]
        edge = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]).astype(np.float32)
        score = np.clip(edge / feather, 0, 1)
    elif mode == "scene":
        h, w = saturation.shape
        yy, xx = np.mgrid[0:h, 0:w]
        edge = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]).astype(np.float32)
        score = np.clip(edge / feather, 0, 1)
    elif mode == "chroma":
        saturation_score = np.clip((saturation - 92) / 70, 0, 1)
        darkness_score = np.clip((150 - value) / 70, 0, 1)
        score = np.maximum(saturation_score, darkness_score)
    elif mode == "saturated":
        saturation_score = np.clip((saturation - 18) / 86, 0, 1)
        darkness_score = np.clip((155 - value) / 105, 0, 1)
        score = np.maximum(saturation_score, darkness_score)
    else:
        border = np.concatenate([
            crop[:4].reshape(-1, 3), crop[-4:].reshape(-1, 3),
            crop[:, :4].reshape(-1, 3), crop[:, -4:].reshape(-1, 3)
        ])
        background = np.median(border, axis=0)
        distance = np.linalg.norm(crop.astype(np.float32) - background, axis=2)
        score = np.clip((distance - 10) / 62, 0, 1)
    if mode == "blue_scene":
        gold = (
            (hsv[..., 0] >= 7) & (hsv[..., 0] <= 38)
            & (hsv[..., 1] > 72) & (hsv[..., 2] > 76)
        ).astype(np.uint8) * 255
        gold = cv2.dilate(gold, np.ones((2, 2), np.uint8), iterations=1)
        crop = cv2.inpaint(crop, gold, 3, cv2.INPAINT_TELEA)
        alpha = np.clip(score * 255, 0, 255).astype(np.uint8)
    elif mode == "scene":
        alpha = np.clip(score * 255, 0, 255).astype(np.uint8)
    else:
        alpha = np.clip(score * 255, 0, 255).astype(np.uint8)
        alpha = cv2.GaussianBlur(alpha, (0, 0), .8)
        if mode in ("saturated", "white_flower", "chroma"):
            binary = (alpha > 72).astype(np.uint8)
            binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
            kept = np.zeros_like(binary)
            for index in range(1, count):
                if stats[index, cv2.CC_STAT_AREA] >= 28:
                    kept[labels == index] = 1
            kept = cv2.dilate(kept, np.ones((3, 3), np.uint8), iterations=1)
            alpha = (alpha * kept).astype(np.uint8)
            alpha[alpha < 148] = 0
    rgba = cv2.cvtColor(normalize(crop, saturation=1.08), cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = alpha
    write_png(os.path.join(OUTPUT, output_name), rgba)


def main():
    os.makedirs(OUTPUT, exist_ok=True)
    canopies = [
        ("painted-silk-umbrella.jpg", (204, 197, 194, 187), "painted-floral.png", 1.02),
        ("patterned-silk-umbrella.jpg", (201, 209, 185, 183), "opera-pink.png", 1.08),
        ("pink-silk-umbrella.jpg", (613, 431, 357, 356), "pink-blossom.png", 1.06),
        ("radial-bamboo-frame.jpg", (207, 168, 157, 155), "radial-pink.png", 1.08),
        ("green-painted-umbrellas.jpg", (197, 273, 194, 183), "green-blossom.png", 1.06),
        ("finished-umbrella-styles.jpg", (505, 276, 321, 250), "ivory-floral.png", 1.03),
        ("colorful-silk-umbrellas.jpg", (291, 276, 158, 139), "violet-panel.png", 1.08),
        ("colorful-silk-umbrellas.jpg", (581, 280, 151, 137), "sky-blue.png", 1.08),
        ("colorful-silk-umbrellas.jpg", (746, 323, 207, 162), "magenta-floral.png", 1.12),
    ]
    for source, ellipse, name, saturation in canopies:
        extract_canopy(source, ellipse, name, saturation)

    motifs = [
        ("painted-silk-umbrella.jpg", (73, 154, 329, 317), "motif-painted-flower-bird.png", "chroma", (202, 198)),
        ("patterned-silk-umbrella.jpg", (98, 54, 176, 136), "motif-opera-face.png", "chroma", (201, 210)),
        ("pink-silk-umbrella.jpg", (268, 122, 688, 454), "motif-pink-branch.png", "white_flower", (614, 432)),
        ("green-painted-umbrellas.jpg", (55, 249, 391, 460), "motif-green-blossom.png", "white_flower", (252, 198)),
        ("finished-umbrella-styles.jpg", (310, 305, 725, 520), "motif-ivory-flower.png", "chroma", (505, 245)),
        ("finished-umbrella-styles.jpg", (118, 540, 488, 770), "motif-blue-lake.png", "blue_scene", (316, 506)),
        ("finished-umbrella-styles.jpg", (650, 477, 983, 790), "motif-orange-lake.png", "scene", (680, 487)),
    ]
    for source, rect, name, mode, rib_center in motifs:
        extract_motif(source, rect, name, mode, rib_center=rib_center)
    print(f"Extracted {len(canopies)} canopy textures and {len(motifs)} motif studies to {OUTPUT}")


if __name__ == "__main__":
    main()
