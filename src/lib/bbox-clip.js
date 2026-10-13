/** Cohen–Sutherland-style segment clip to axis-aligned bbox. */

function computeCode(lon, lat, b) {
  let code = 0;
  if (lon < b.west) code |= 1;
  else if (lon > b.east) code |= 2;
  if (lat < b.south) code |= 4;
  else if (lat > b.north) code |= 8;
  return code;
}

function clipSegment(lon0, lat0, lon1, lat1, b) {
  let x0 = lon0;
  let y0 = lat0;
  let x1 = lon1;
  let y1 = lat1;
  let code0 = computeCode(x0, y0, b);
  let code1 = computeCode(x1, y1, b);
  let accept = false;
  for (let i = 0; i < 20; i++) {
    if (!(code0 | code1)) {
      accept = true;
      break;
    }
    if (code0 & code1) break;
    const codeOut = code0 ? code0 : code1;
    let x;
    let y;
    if (codeOut & 8) {
      x = x0 + ((x1 - x0) * (b.north - y0)) / (y1 - y0);
      y = b.north;
    } else if (codeOut & 4) {
      x = x0 + ((x1 - x0) * (b.south - y0)) / (y1 - y0);
      y = b.south;
    } else if (codeOut & 2) {
      y = y0 + ((y1 - y0) * (b.east - x0)) / (x1 - x0);
      x = b.east;
    } else {
      y = y0 + ((y1 - y0) * (b.west - x0)) / (x1 - x0);
      x = b.west;
    }
    if (codeOut === code0) {
      x0 = x;
      y0 = y;
      code0 = computeCode(x0, y0, b);
    } else {
      x1 = x;
      y1 = y;
      code1 = computeCode(x1, y1, b);
    }
  }
  return accept ? [[x0, y0], [x1, y1]] : null;
}

export function lineIntersectsBounds(coords, bounds) {
  for (const [lon, lat] of coords) {
    if (lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north) {
      return true;
    }
  }
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon0, lat0] = coords[i];
    const [lon1, lat1] = coords[i + 1];
    if (clipSegment(lon0, lat0, lon1, lat1, bounds)) return true;
  }
  return false;
}

export function clipLineStringToBounds(coords, bounds) {
  const out = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon0, lat0] = coords[i];
    const [lon1, lat1] = coords[i + 1];
    const seg = clipSegment(lon0, lat0, lon1, lat1, bounds);
    if (!seg) continue;
    const [a, b] = seg;
    if (!out.length) out.push(a);
    else {
      const prev = out[out.length - 1];
      if (prev[0] !== a[0] || prev[1] !== a[1]) out.push(a);
    }
    out.push(b);
  }
  return out.length >= 2 ? out : null;
}
