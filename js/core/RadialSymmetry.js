// New strokes have exactly one copy per segment. Alternate copies may be
// reflected about the ray where the stroke started, without adding copies.
export function radialCopyTransforms(count, mirror, axis = 0) {
  const total = Math.max(1, Math.min(14, Math.round(Number(count) || 1)));
  return Array.from({ length: total }, (_, index) => {
    const angle = index * Math.PI * 2 / total;
    if (mirror && total > 1 && index % 2 === 1) {
      const cosine = Math.cos(angle + 2 * axis);
      const sine = Math.sin(angle + 2 * axis);
      return { a: cosine, b: sine, c: sine, d: -cosine };
    }
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return { a: cosine, b: sine, c: -sine, d: cosine };
  });
}
