/**
 * Psychrometric calculations for the UPR Hydro (moisture / drying) feature.
 *
 * Pure functions, no imports, no side effects. Imperial units only (°F, inHg,
 * grains per pound of dry air) because that is what restoration techs work
 * in on the job site.
 *
 * ------------------------------------------------------------------
 * Formula sources
 * ------------------------------------------------------------------
 * - August-Roche-Magnus (Tetens) approximation for saturation vapor
 *   pressure over water:
 *       es(T_c) = 6.1094 * exp((17.625 * T_c) / (T_c + 243.04))   [hPa]
 *   Reference: Alduchov & Eskridge (1996), "Improved Magnus Form
 *   Approximation of Saturation Vapor Pressure", J. Applied Meteorology.
 *
 * - Inverse Magnus form used for dew point:
 *       gamma = ln(RH/100) + (a*T_c)/(b + T_c)
 *       Td_c  = (b * gamma) / (a - gamma)
 *   with a = 17.625, b = 243.04.
 *
 * - Industry grains-per-pound (GPP) form used in water-damage restoration
 *   and the ASHRAE Psychrometric Chart at sea level:
 *       W (lb water / lb dry air) = 0.62198 * Pv / (Pa - Pv)
 *       GPP = 7000 * W  =  (7000 * 0.62198) * Pv / (Pa - Pv)
 *            ≈ 4354.8 * Pv / (Pa - Pv)
 *   where Pa is atmospheric pressure (29.92 inHg at sea level) and Pv is
 *   the actual partial pressure of water vapor, in inHg. This is the
 *   ASHRAE-consistent form; the popular "2700" short-hand seen in some
 *   field references corresponds to a mmHg-based variant and yields
 *   values far below the ASHRAE chart, so we use 4354.8 here.
 *
 * Atmospheric pressure is hard-coded to 29.92 inHg in v1. Altitude
 * corrections are intentionally not exposed.
 *
 * Inputs are validated; nonsense values return NaN so callers can detect
 * bad sensor data without try/catch. Results are rounded to 2 decimal
 * places so they look clean when stored and rendered.
 * ------------------------------------------------------------------
 */

// Magnus coefficients (over water), Alduchov-Eskridge form.
const MAGNUS_A = 17.625;
const MAGNUS_B = 243.04; // °C

// Atmospheric pressure at sea level, in inches of mercury.
const ATM_PRESSURE_INHG = 29.92;

// GPP constant: 7000 grains/lb * 0.62198 (molar-mass ratio water/dry-air).
const GPP_CONSTANT = 7000 * 0.62198; // ≈ 4353.86

// 1 hPa = 0.02953 inHg (NIST). Used to convert Magnus output (hPa) → inHg.
const HPA_TO_INHG = 0.02953;

/**
 * Internal: round to 2 decimal places for clean storage/display.
 * @param {number} x
 * @returns {number}
 */
function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * Internal: °F → °C.
 * @param {number} f
 * @returns {number}
 */
function fToC(f) {
  return ((f - 32) * 5) / 9;
}

/**
 * Internal: °C → °F.
 * @param {number} c
 * @returns {number}
 */
function cToF(c) {
  return (c * 9) / 5 + 32;
}

/**
 * Internal: is temp in the validated sensor range?
 * @param {number} t_f
 * @returns {boolean}
 */
function validTemp(t_f) {
  return Number.isFinite(t_f) && t_f >= -50 && t_f <= 200;
}

/**
 * Internal: is relative humidity in [0, 100]?
 * @param {number} rh
 * @returns {boolean}
 */
function validRH(rh) {
  return Number.isFinite(rh) && rh >= 0 && rh <= 100;
}

/**
 * Saturation vapor pressure in inches of mercury (inHg) at a given
 * dry-bulb temperature. Uses the Magnus-Tetens approximation in hPa
 * and converts the result to inHg.
 *
 * Returns NaN if temp_f is outside [-50, 200] °F or not finite.
 *
 * @param {number} temp_f - dry bulb temperature in °F
 * @returns {number} saturation vapor pressure in inHg, rounded to 2dp
 */
export function calcSaturationPressure_inHg(temp_f) {
  if (!validTemp(temp_f)) return NaN;
  const t_c = fToC(temp_f);
  // Magnus (Alduchov-Eskridge) over water, in hPa.
  const es_hpa = 6.1094 * Math.exp((MAGNUS_A * t_c) / (MAGNUS_B + t_c));
  const es_inhg = es_hpa * HPA_TO_INHG;
  return round2(es_inhg);
}

/**
 * Actual vapor pressure (inHg) at given conditions.
 * Pv = RH * Ps, where Ps is saturation vapor pressure at the same temp.
 *
 * Returns NaN if temp_f is outside [-50, 200] °F or if rh_pct is
 * outside [0, 100].
 *
 * @param {number} temp_f - °F
 * @param {number} rh_pct - 0 to 100
 * @returns {number} actual vapor pressure in inHg, rounded to 2dp
 */
export function calcVaporPressure(temp_f, rh_pct) {
  if (!validTemp(temp_f) || !validRH(rh_pct)) return NaN;
  // Re-derive saturation pressure unrounded so the downstream Pv is not
  // biased by an early rounding step, then round once at the end.
  const t_c = fToC(temp_f);
  const es_hpa = 6.1094 * Math.exp((MAGNUS_A * t_c) / (MAGNUS_B + t_c));
  const es_inhg = es_hpa * HPA_TO_INHG;
  const pv_inhg = (rh_pct / 100) * es_inhg;
  return round2(pv_inhg);
}

/**
 * Dew point in °F from temperature and relative humidity. Uses the
 * inverse Magnus (August-Roche-Magnus) formula, computed in °C and
 * converted back to °F.
 *
 * At 100% RH the dew point equals the dry-bulb temperature (within
 * floating-point precision).
 *
 * Returns NaN if temp_f is outside [-50, 200] °F or if rh_pct is
 * outside [0, 100] or if rh_pct is 0 (log(0) is undefined).
 *
 * @param {number} temp_f - °F
 * @param {number} rh_pct - 0 to 100
 * @returns {number} dew point in °F, rounded to 2dp
 */
export function calcDewPoint(temp_f, rh_pct) {
  if (!validTemp(temp_f) || !validRH(rh_pct)) return NaN;
  if (rh_pct === 0) return NaN; // ln(0) undefined; physically no dew point.
  const t_c = fToC(temp_f);
  const gamma =
    Math.log(rh_pct / 100) + (MAGNUS_A * t_c) / (MAGNUS_B + t_c);
  const td_c = (MAGNUS_B * gamma) / (MAGNUS_A - gamma);
  const td_f = cToF(td_c);
  return round2(td_f);
}

/**
 * Grains per pound of dry air (GPP) — the key moisture number for
 * drying work. Uses the ASHRAE humidity-ratio form converted to grains:
 *     GPP = 7000 * 0.62198 * Pv / (Pa - Pv)  ≈  4354 * Pv / (Pa - Pv)
 * with Pa = 29.92 inHg (sea level) and Pv = actual vapor pressure in inHg.
 *
 * Returns NaN if temp_f is outside [-50, 200] °F or if rh_pct is
 * outside [0, 100].
 *
 * @param {number} temp_f - °F
 * @param {number} rh_pct - 0 to 100
 * @returns {number} grains of moisture per pound of dry air, rounded to 2dp
 */
export function calcGPP(temp_f, rh_pct) {
  if (!validTemp(temp_f) || !validRH(rh_pct)) return NaN;
  // Re-derive Pv unrounded so the division is not biased by an early
  // rounding step, then round once at the end.
  const t_c = fToC(temp_f);
  const es_hpa = 6.1094 * Math.exp((MAGNUS_A * t_c) / (MAGNUS_B + t_c));
  const es_inhg = es_hpa * HPA_TO_INHG;
  const pv_inhg = (rh_pct / 100) * es_inhg;
  const gpp = (GPP_CONSTANT * pv_inhg) / (ATM_PRESSURE_INHG - pv_inhg);
  return round2(gpp);
}
