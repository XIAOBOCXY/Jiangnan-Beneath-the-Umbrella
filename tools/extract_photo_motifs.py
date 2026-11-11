"""Extract single motifs from the project's heritage umbrella photographs.

These are not whole-canopy textures. Each output is a transparent, cropped
study derived from a painted subject in one of the source photographs. Radial
ribs are removed before the foreground mask is estimated so the result can be
placed, repeated and transformed as an independent motif in the studio.

Run:
  python tools/extract_photo_motifs.py
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass

import cv2
import numpy as np


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAPERS = os.path.join(ROOT, "assets", "heritage", "papers")
OUTPUT = os.path.join(ROOT, "assets", "patterns", "photographic")
CONTACT_SHEET = os.path.join(ROOT, "tmp", "photographic-motifs-contact.jpg")
OUTPUT_SIZE = 1024


@dataclass(frozen=True)
class MotifSpec:
    source: str
    crop: tuple[int, int, int, int]
    output: str
    rib_center: tuple[int, int]
    rib_count: int = 36
    detect_rib_lines: bool = True
    mode: str = "cutout"
    background: str = "chroma"
    low: float = 18.0
    high: float = 54.0


MOTIFS = (
    MotifSpec(
        "painted-silk-umbrella.jpg",
        (72, 169, 214, 352),
        "flower-spray.png",
        (202, 198),
        36,
        background="golden_pale",
        low=28,
        high=72,
    ),
    MotifSpec(
        "painted-silk-umbrella.jpg",
        (259, 196, 351, 261),
        "blue-bird.png",
        (202, 198),
        36,
        background="golden_pale",
        low=24,
        high=68,
    ),
    MotifSpec(
        "patterned-silk-umbrella.jpg",
        (184, 61, 264, 146),
        "opera-yellow-face.png",
        (201, 202),
        36,
        background="magenta",
        low=34,
        high=78,
    ),
    MotifSpec(
        "patterned-silk-umbrella.jpg",
        (230, 259, 337, 354),
        "opera-vermilion-face.png",
        (201, 202),
        36,
        background="magenta",
        low=34,
        high=78,
    ),
    MotifSpec(
        "pink-silk-umbrella.jpg",
        (294, 145, 576, 360),
        "blossom-branch.png",
        (613, 431),
        36,
        background="magenta",
        low=34,
        high=82,
    ),
    MotifSpec(
        "green-painted-umbrellas.jpg",
        (49, 289, 261, 431),
        "jade-blossom-cluster.png",
        (252, 198),
        42,
        background="green",
        low=42,
        high=94,
    ),
    MotifSpec(
        "finished-umbrella-styles.jpg",
        (104, 536, 434, 815),
        "three-pools-waterfront.png",
        (316, 506),
        30,
        detect_rib_lines=False,
        mode="scene",
    ),
    MotifSpec(
        "finished-umbrella-styles.jpg",
        (620, 530, 991, 813),
        "vermilion-lakefront.png",
        (680, 487),
        30,
        detect_rib_lines=False,
        mode="scene",
    ),
)


def read_source(name: str) -> np.ndarray:
    image = cv2.imread(os.path.join(PAPERS, name), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"Could not read heritage photograph: {name}")
    return image


def remove_radial_ribs(
    image: np.ndarray,
    center: tuple[int, int],
    count: int,
    width: float = 2.0,
    detect_lines: bool = True,
) -> np.ndarray:
    """Inpaint bamboo ribs using both their radial layout and their edges."""
    height, width_px = image.shape[:2]
    yy, xx = np.mgrid[0:height, 0:width_px]
    dx = xx - center[0]
    dy = yy - center[1]
    radius = np.hypot(dx, dy)
    angle = np.arctan2(dy, dx)
    step = math.tau / max(8, count)
    nearest = np.round(angle / step) * step
    delta = np.abs(np.arctan2(np.sin(angle - nearest), np.cos(angle - nearest)))
    perpendicular = radius * np.sin(delta)
    mask = ((perpendicular < width) & (radius > 8)).astype(np.uint8) * 255

    # Source photographs are perspective views, so evenly spaced angles alone
    # are not enough. Hough segments through the hub cover the actual ribs,
    # including those whose perspective spacing differs from the ideal.
    if detect_lines:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 42, 118)
        segments = cv2.HoughLinesP(
            edges,
            1,
            np.pi / 720,
            threshold=18,
            minLineLength=max(24, min(height, width_px) * 0.08),
            maxLineGap=14,
        )
        if segments is not None:
            for x1, y1, x2, y2 in segments[:, 0]:
                line_length = math.hypot(x2 - x1, y2 - y1)
                if line_length < 1:
                    continue
                hub_distance = abs(
                    (y2 - y1) * center[0]
                    - (x2 - x1) * center[1]
                    + x2 * y1
                    - y2 * x1
                ) / line_length
                if hub_distance <= 12:
                    vx = (x2 - x1) / line_length
                    vy = (y2 - y1) / line_length
                    extent = math.hypot(height, width_px) * 1.25
                    start = (
                        round(center[0] - vx * extent),
                        round(center[1] - vy * extent),
                    )
                    end = (
                        round(center[0] + vx * extent),
                        round(center[1] + vy * extent),
                    )
                    cv2.line(mask, start, end, 255, 3, cv2.LINE_AA)

    mask = cv2.dilate(
        mask,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
        iterations=1,
    )
    return cv2.inpaint(image, mask, 7, cv2.INPAINT_TELEA)


def dominant_border_color(crop_lab: np.ndarray) -> np.ndarray:
    """Estimate the silk ground from the border with a small Lab palette."""
    height, width = crop_lab.shape[:2]
    border_width = max(2, round(min(height, width) * 0.035))
    border = np.concatenate(
        (
            crop_lab[:border_width].reshape(-1, 3),
            crop_lab[-border_width:].reshape(-1, 3),
            crop_lab[:, :border_width].reshape(-1, 3),
            crop_lab[:, -border_width:].reshape(-1, 3),
        )
    )
    samples = border.astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.2)
    _, labels, centers = cv2.kmeans(
        samples,
        4,
        None,
        criteria,
        5,
        cv2.KMEANS_PP_CENTERS,
    )
    counts = np.bincount(labels.ravel(), minlength=len(centers))
    # Ignore tiny clusters, which are usually ribs or a cut-off painted edge.
    valid = np.flatnonzero(counts >= max(8, samples.shape[0] * 0.035))
    if not len(valid):
        return np.median(samples, axis=0)
    return centers[valid[np.argmax(counts[valid])]]


def remove_small_components(binary: np.ndarray, minimum_area: int) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        binary.astype(np.uint8),
        connectivity=8,
    )
    kept = np.zeros_like(binary, dtype=np.uint8)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= minimum_area:
            kept[labels == index] = 1
    return kept.astype(bool)


def remove_border_components(binary: np.ndarray) -> np.ndarray:
    """Drop silk-ground regions that remain connected to the crop boundary."""
    count, labels, _, _ = cv2.connectedComponentsWithStats(
        binary.astype(np.uint8),
        connectivity=8,
    )
    border_labels = np.unique(
        np.concatenate(
            (
                labels[0],
                labels[-1],
                labels[:, 0],
                labels[:, -1],
            )
        )
    )
    kept = binary.copy()
    for label in border_labels:
        if label:
            kept[labels == label] = False
    return kept


def fill_enclosed_holes(binary: np.ndarray) -> np.ndarray:
    height, width = binary.shape
    flood = np.zeros((height + 2, width + 2), np.uint8)
    inverse = np.where(binary, 0, 255).astype(np.uint8)
    cv2.floodFill(inverse, flood, (0, 0), 128)
    holes = inverse == 255
    return binary | holes


def cutout_alpha(
    crop_bgr: np.ndarray,
    low: float,
    high: float,
    background_mode: str,
) -> np.ndarray:
    # The photographed grounds are chromatically close to parts of the
    # painting, so a simple colour key leaves translucent silk patches. GrabCut
    # uses the border as a strong background prior and follows the actual
    # painted silhouette, including white petals and pale faces.
    height, width = crop_bgr.shape[:2]
    margin = max(2, round(min(height, width) * 0.025))
    mask = np.zeros((height, width), np.uint8)
    background_model = np.zeros((1, 65), np.float64)
    foreground_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(
        crop_bgr,
        mask,
        (margin, margin, width - margin * 2, height - margin * 2),
        background_model,
        foreground_model,
        9,
        cv2.GC_INIT_WITH_RECT,
    )
    binary = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.uint8)
    binary = cv2.morphologyEx(
        binary,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
    ).astype(bool)
    borderless = remove_border_components(binary)
    if np.count_nonzero(borderless) >= max(40, np.count_nonzero(binary) * 0.12):
        binary = borderless
    minimum_area = max(10, round(crop_bgr.shape[0] * crop_bgr.shape[1] * 0.00018))
    binary = remove_small_components(binary, minimum_area)
    binary = cv2.dilate(binary.astype(np.uint8), np.ones((2, 2), np.uint8), iterations=1)
    binary = fill_enclosed_holes(binary.astype(bool))

    # A short feather retains the photographed brush edge instead of producing
    # a vector-like sticker boundary.
    alpha = cv2.GaussianBlur(binary.astype(np.float32) * 255, (0, 0), 0.75)
    alpha[alpha < 18] = 0
    return np.clip(alpha, 0, 255).astype(np.uint8)


def scene_alpha(height: int, width: int) -> np.ndarray:
    """Give a painted landscape a feathered, brush-cut edge."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    cx = width * 0.5
    cy = height * 0.52
    nx = (xx - cx) / (width * 0.49)
    ny = (yy - cy) / (height * 0.51)
    # A very shallow irregular edge suggests a hand-brushed scene study rather
    # than a rectangular crop of the umbrella fabric.
    wave = np.sin(nx * 5.2 + 0.8) * 0.018 + np.sin(nx * 11.0 - 0.4) * 0.008
    radius = np.power(np.abs(nx), 3.0) + np.power(np.abs(ny + wave), 2.35)
    alpha = np.clip((1.0 - radius) * 11.0, 0, 1)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 1.05)
    return np.clip(alpha * 255, 0, 255).astype(np.uint8)


def crop_alpha(rgba: np.ndarray) -> np.ndarray:
    alpha = rgba[..., 3]
    ys, xs = np.where(alpha > 12)
    if not len(xs):
        raise ValueError("Motif extraction produced an empty alpha channel")
    left, right = xs.min(), xs.max() + 1
    top, bottom = ys.min(), ys.max() + 1
    padding = max(4, round(max(right - left, bottom - top) * 0.035))
    left, top = max(0, left - padding), max(0, top - padding)
    right = min(rgba.shape[1], right + padding)
    bottom = min(rgba.shape[0], bottom + padding)
    cropped = rgba[top:bottom, left:right]
    side = max(cropped.shape[:2])
    square = np.zeros((side, side, 4), dtype=np.uint8)
    offset_x = (side - cropped.shape[1]) // 2
    offset_y = (side - cropped.shape[0]) // 2
    square[
        offset_y:offset_y + cropped.shape[0],
        offset_x:offset_x + cropped.shape[1],
    ] = cropped
    return cv2.resize(
        square,
        (OUTPUT_SIZE, OUTPUT_SIZE),
        interpolation=cv2.INTER_LANCZOS4,
    )


def extract(spec: MotifSpec) -> np.ndarray:
    source = read_source(spec.source)
    cleaned = remove_radial_ribs(
        source,
        spec.rib_center,
        spec.rib_count,
        detect_lines=spec.detect_rib_lines,
    )
    x0, y0, x1, y1 = spec.crop
    crop = cleaned[y0:y1, x0:x1].copy()
    if spec.mode == "scene":
        alpha = scene_alpha(*crop.shape[:2])
    else:
        alpha = cutout_alpha(crop, spec.low, spec.high, spec.background)
    rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = alpha
    return crop_alpha(rgba)


def write_contact_sheet(images: list[tuple[str, np.ndarray]]) -> None:
    cell_width, cell_height = 280, 300
    columns = 4
    rows = math.ceil(len(images) / columns)
    sheet = np.full(
        (rows * cell_height, columns * cell_width, 3),
        (47, 76, 66),
        dtype=np.uint8,
    )
    for index, (name, rgba) in enumerate(images):
        preview = cv2.resize(
            rgba,
            (cell_width, cell_height - 24),
            interpolation=cv2.INTER_AREA,
        )
        rgb = preview[..., :3]
        alpha = (preview[..., 3:4].astype(np.float32) / 255.0)
        tile = np.full_like(rgb, (47, 76, 66), dtype=np.uint8)
        visual = (rgb.astype(np.float32) * alpha + tile.astype(np.float32) * (1 - alpha))
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        sheet[y:y + cell_height - 24, x:x + cell_width] = visual.astype(np.uint8)
        cv2.putText(
            sheet,
            os.path.basename(name),
            (x + 6, y + cell_height - 7),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.43,
            (246, 240, 218),
            1,
            cv2.LINE_AA,
        )
    os.makedirs(os.path.dirname(CONTACT_SHEET), exist_ok=True)
    if not cv2.imwrite(CONTACT_SHEET, sheet):
        raise RuntimeError(f"Could not write {CONTACT_SHEET}")


def main() -> None:
    os.makedirs(OUTPUT, exist_ok=True)
    results: list[tuple[str, np.ndarray]] = []
    for spec in MOTIFS:
        rgba = extract(spec)
        path = os.path.join(OUTPUT, spec.output)
        if not cv2.imwrite(path, rgba):
            raise RuntimeError(f"Could not write {path}")
        results.append((spec.output, rgba))
    write_contact_sheet(results)
    print(f"Extracted {len(results)} single photographic motifs to {OUTPUT}")
    print(f"Contact sheet: {CONTACT_SHEET}")


if __name__ == "__main__":
    main()
