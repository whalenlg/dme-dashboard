// KLR MAP scaling (ram[0x52], ram[0x51] and the boost table, all in the
// ADC routine's "software units"), per the KLR memory map's MAP section:
//   x = 1.22 * kPa - 4
//   https://jhnbyrn.github.io/951-KLR-PAGES/klr_memory_map.html
// Gauge pressure is relative to 1 bar.
export const ATM_KPA = 100;
export const mapKpa = x => (x + 4) / 1.22;
export const gaugePsi = x => (mapKpa(x) - ATM_KPA) * 0.145038;

// Boost-gauge readout: vacuum in inHg, boost in psi
const PSI_TO_INHG = 2.03602;
export const boostParts = psi => psi == null ? ['--', '']
  : psi < 0 ? [(psi * PSI_TO_INHG).toFixed(1), 'inHg']
  : [`+${psi.toFixed(1)}`, 'psi'];
export const fmtBoost = psi => psi == null ? '--' : boostParts(psi).join(' ');
