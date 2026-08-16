/**
 * 将 3D LUT 应用到图像像素数据。
 * 使用三线性插值实现平滑的颜色映射。
 * @param {Uint8ClampedArray} pixels - 输入 RGBA 像素数据
 * @param {Float64Array} lut - LUT 数据，3 * size³ 个值，RGB 逐像素，范围 [0, 1]
 * @param {number} size - LUT 网格尺寸
 * @returns {Uint8ClampedArray} - 输出 RGBA 像素数据
 */
export function applyLut(pixels, lut, size = 33) {
  const len = pixels.length;
  const out = new Uint8ClampedArray(len);
  const maxIdx = size - 1;

  for (let i = 0; i < len; i += 4) {
    let rf = pixels[i] / 255;
    let gf = pixels[i + 1] / 255;
    let bf = pixels[i + 2] / 255;

    rf = rf < 0 ? 0 : rf > 1 ? 1 : rf;
    gf = gf < 0 ? 0 : gf > 1 ? 1 : gf;
    bf = bf < 0 ? 0 : bf > 1 ? 1 : bf;

    const rx = rf * maxIdx, gx = gf * maxIdx, bx = bf * maxIdx;
    const r0 = Math.floor(rx), g0 = Math.floor(gx), b0 = Math.floor(bx);
    const r1 = Math.min(r0 + 1, maxIdx), g1 = Math.min(g0 + 1, maxIdx), b1 = Math.min(b0 + 1, maxIdx);
    const fr = rx - r0, fg = gx - g0, fb = bx - b0;

    const sizeSq = size * size;
    const idx000 = (b0 * sizeSq + g0 * size + r0) * 3;
    const idx001 = (b0 * sizeSq + g0 * size + r1) * 3;
    const idx010 = (b0 * sizeSq + g1 * size + r0) * 3;
    const idx011 = (b0 * sizeSq + g1 * size + r1) * 3;
    const idx100 = (b1 * sizeSq + g0 * size + r0) * 3;
    const idx101 = (b1 * sizeSq + g0 * size + r1) * 3;
    const idx110 = (b1 * sizeSq + g1 * size + r0) * 3;
    const idx111 = (b1 * sizeSq + g1 * size + r1) * 3;

    const invFr = 1 - fr, invFg = 1 - fg, invFb = 1 - fb;

    out[i]     = Math.round(255 * clamp(
      invFb * invFg * invFr * lut[idx000] + invFb * invFg * fr * lut[idx001] +
      invFb * fg * invFr * lut[idx010] + invFb * fg * fr * lut[idx011] +
      fb * invFg * invFr * lut[idx100] + fb * invFg * fr * lut[idx101] +
      fb * fg * invFr * lut[idx110] + fb * fg * fr * lut[idx111]
    ));

    out[i + 1] = Math.round(255 * clamp(
      invFb * invFg * invFr * lut[idx000 + 1] + invFb * invFg * fr * lut[idx001 + 1] +
      invFb * fg * invFr * lut[idx010 + 1] + invFb * fg * fr * lut[idx011 + 1] +
      fb * invFg * invFr * lut[idx100 + 1] + fb * invFg * fr * lut[idx101 + 1] +
      fb * fg * invFr * lut[idx110 + 1] + fb * fg * fr * lut[idx111 + 1]
    ));

    out[i + 2] = Math.round(255 * clamp(
      invFb * invFg * invFr * lut[idx000 + 2] + invFb * invFg * fr * lut[idx001 + 2] +
      invFb * fg * invFr * lut[idx010 + 2] + invFb * fg * fr * lut[idx011 + 2] +
      fb * invFg * invFr * lut[idx100 + 2] + fb * invFg * fr * lut[idx101 + 2] +
      fb * fg * invFr * lut[idx110 + 2] + fb * fg * fr * lut[idx111 + 2]
    ));

    out[i + 3] = pixels[i + 3];
  }

  return out;
}

function clamp(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
