/** Report-only: vehicle-frame scatter for one frame (not a reconstructed polyline). */
export function buildLocalFrameSvg(frameTrace) {
  const lines = frameTrace.lines || [];
  const w = 520;
  const h = 360;
  const margin = 40;
  let minY = -10;
  let maxY = 10;
  let maxX = 10;
  for (const ln of lines) {
    const lat = ln.coordinates_local_m_single_sample?.model_lateral_m;
    const fwd = ln.coordinates_local_m_single_sample?.model_forward_m;
    if (lat != null) {
      minY = Math.min(minY, lat);
      maxY = Math.max(maxY, lat);
    }
    if (fwd != null) maxX = Math.max(maxX, fwd);
  }
  const sx = (w - 2 * margin) / Math.max(maxX, 1);
  const sy = (h - 2 * margin) / Math.max(maxY - minY, 1);
  const tx = (x) => margin + x * sx;
  const ty = (y) => h - margin - (y - minY) * sy;

  let dots = '';
  for (const ln of lines) {
    const lat = ln.coordinates_local_m_single_sample?.model_lateral_m ?? 0;
    const fwd = ln.coordinates_local_m_single_sample?.model_forward_m ?? 0;
    const color = ln.feature_type?.includes('road_edge') ? '#e76f51' : '#2a9d8f';
    dots += `<circle cx="${tx(fwd)}" cy="${ty(lat)}" r="6" fill="${color}"/>`;
    dots += `<text x="${tx(fwd) + 8}" y="${ty(lat) + 4}" font-size="10">${ln.line_id}</text>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="12" y="20" font-size="12" font-family="sans-serif">Frame ${frameTrace.frame_id} — single sample per line (not a polyline)</text>
  <text x="12" y="36" font-size="10" font-family="sans-serif">Axes: model_x_m forward, model_y_m lateral — OSM ${frameTrace.osm_way_context}</text>
  <line x1="${margin}" y1="${h - margin}" x2="${w - margin}" y2="${h - margin}" stroke="#999"/>
  <line x1="${margin}" y1="${margin}" x2="${margin}" y2="${h - margin}" stroke="#999"/>
  ${dots}
  <text x="${margin}" y="${h - 12}" font-size="9">forward (model_x_m)</text>
  <text x="8" y="${margin}" font-size="9" transform="rotate(-90 8 ${margin})">lateral (model_y_m)</text>
</svg>`;
}
