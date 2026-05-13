// RGB to XYZ matrix (sRGB D65)
const RGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041]
];

const XYZ_TO_RGB = [
  [ 3.2404542, -1.5371385, -0.4985314],
  [-0.9692660,  1.8760108,  0.0415560],
  [ 0.0556434, -0.2040259,  1.0572252]
];

function linearize(c) {
  c = c / 255;
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

function gammaize(c) {
  return c >= 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
}

export function rgbToLab(r, g, b) {
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);

  const x = RGB_TO_XYZ[0][0] * lr + RGB_TO_XYZ[0][1] * lg + RGB_TO_XYZ[0][2] * lb;
  const y = RGB_TO_XYZ[1][0] * lr + RGB_TO_XYZ[1][1] * lg + RGB_TO_XYZ[1][2] * lb;
  const z = RGB_TO_XYZ[2][0] * lr + RGB_TO_XYZ[2][1] * lg + RGB_TO_XYZ[2][2] * lb;

  const xn = 0.95047, yn = 1.00000, zn = 1.08883;

  const f = (t) => t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116);

  const L = 116 * f(y / yn) - 16;
  const a = 500 * (f(x / xn) - f(y / yn));
  const b2 = 200 * (f(y / yn) - f(z / zn));

  return [L, a, b2];
}

export function labToRgb(L, a, b2) {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b2 / 200;

  const f = (t) => t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787;

  const xn = 0.95047, yn = 1.00000, zn = 1.08883;
  const x = xn * f(fx);
  const y = yn * f(fy);
  const z = zn * f(fz);

  const lr = XYZ_TO_RGB[0][0] * x + XYZ_TO_RGB[0][1] * y + XYZ_TO_RGB[0][2] * z;
  const lg = XYZ_TO_RGB[1][0] * x + XYZ_TO_RGB[1][1] * y + XYZ_TO_RGB[1][2] * z;
  const lb = XYZ_TO_RGB[2][0] * x + XYZ_TO_RGB[2][1] * y + XYZ_TO_RGB[2][2] * z;

  const r = Math.max(0, Math.min(255, Math.round(gammaize(lr) * 255)));
  const g = Math.max(0, Math.min(255, Math.round(gammaize(lg) * 255)));
  const b = Math.max(0, Math.min(255, Math.round(gammaize(lb) * 255)));

  return [r, g, b];
}