import { lonLatToLocalM } from '../lane-enrichment-geometry-v2/local-project.js';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function buildCrossSectionDebugSvg(traceBundle) {
  const seg = traceBundle.cross_section.segment_endpoints;
  const anchor = traceBundle.cross_section.anchor_wgs84;
  const [oLon, oLat] = anchor;

  const pts = [];
  const push = (lon, lat, label, color, r = 4) => {
    const { x, y } = lonLatToLocalM(lon, lat, oLon, oLat);
    pts.push({ x, y, label, color, r });
  };

  for (const c of traceBundle.reproduction.boundary_clusters.lane_boundaries) {
    pts.push({ x: 0, y: c.center_lateral_m, label: `LB ${c.center_lateral_m}`, color: '#2a9d8f', r: 0, hline: true });
  }
  for (const c of traceBundle.reproduction.boundary_clusters.road_edges) {
    pts.push({ x: 0, y: c.center_lateral_m, label: `RE ${c.center_lateral_m}`, color: '#e76f51', r: 0, hline: true });
  }

  const roads = traceBundle._centreline_local || [];
  for (const pose of traceBundle.vehicle_poses || []) {
    push(pose.wgs84[0], pose.wgs84[1], `pose ${pose.frame_id}`, '#6a4c93', 6);
  }
  for (const p of traceBundle.point_traces) {
    const longOff = p.inclusion_exclusion_reasons.some((r) => r.includes('longitudinal'));
    const color = p.layer === 'edge_point' ? '#e9c46a' : longOff ? '#f4a261' : '#264653';
    push(p.wgs84[0], p.wgs84[1], `${p.frame_id} ${p.line_identity}`, color, 5);
  }

  let minX = -20;
  let maxX = 20;
  let minY = -15;
  let maxY = 15;
  for (const p of pts) {
    if (p.hline) {
      minY = Math.min(minY, p.y - 2);
      maxY = Math.max(maxY, p.y + 2);
    } else {
      minX = Math.min(minX, p.x - 5);
      maxX = Math.max(maxX, p.x + 5);
      minY = Math.min(minY, p.y - 5);
      maxY = Math.max(maxY, p.y + 5);
    }
  }
  const pad = 30;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const tx = (x) => x - minX + pad;
  const ty = (y) => maxY - y + pad;

  const a = lonLatToLocalM(seg.a[0], seg.a[1], oLon, oLat);
  const b = lonLatToLocalM(seg.b[0], seg.b[1], oLon, oLat);
  const centreline = `M ${tx(a.x)} ${ty(a.y)} L ${tx(b.x)} ${ty(b.y)}`;

  const csLen = 18;
  const nx = -(b.y - a.y);
  const ny = b.x - a.x;
  const nlen = Math.hypot(nx, ny) || 1;
  const csx = (nx / nlen) * csLen;
  const csy = (ny / nlen) * csLen;
  const crossSection = `M ${tx(-csx)} ${ty(-csy)} L ${tx(csx)} ${ty(csy)}`;

  let body = '';
  body += `<path d="${centreline}" stroke="#555" stroke-width="2" fill="none"/>`;
  body += `<path d="${crossSection}" stroke="#000" stroke-width="2" stroke-dasharray="6 4" fill="none"/>`;
  for (const p of pts) {
    if (p.hline) {
      body += `<line x1="${tx(minX - minX + pad)}" y1="${ty(p.y)}" x2="${tx(maxX - minX + pad)}" y2="${ty(p.y)}" stroke="${p.color}" stroke-width="1" opacity="0.35"/>`;
      body += `<text x="${tx(maxX - minX + pad - 2)}" y="${ty(p.y) - 4}" font-size="9" fill="${p.color}">${esc(p.label)}</text>`;
    } else {
      body += `<circle cx="${tx(p.x)}" cy="${ty(p.y)}" r="${p.r}" fill="${p.color}" opacity="0.85"/>`;
    }
  }

  const title = `OSM 252085334 cross-section ${traceBundle.reproduction.cross_section_id} — V2 lanes=${traceBundle.reproduction.selected_lane_count}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="10" y="18" font-size="12" font-family="sans-serif">${esc(title)}</text>
  <text x="10" y="32" font-size="10" font-family="sans-serif">Grey: OSM centreline segment | Dashed: cross-section | Teal/ coral lines: V2 clusters | Dots: observations (orange=longitudinal offset)</text>
  ${body}
</svg>`;
}
