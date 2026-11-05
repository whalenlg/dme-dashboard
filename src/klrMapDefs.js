// ─────────────────────────────────────────────────────────────────
//  KLR MAP / TABLE DEFINITIONS (KLR MAPS tab)
//  From the maps_index sheet of the KLR disassembly workbook
//  (klr/disassemble/87KLR951.xlsx in whalenlg/944turbo_dme_klr, written by
//  klr_maps.py). The ids are what dme_klr_dashboard_tb.v logs:
//    KLR: [LKUP] <ms>,T<addr>,<result>,<xa>=<xv>[,<ya>=<yv>]
//  Axes: 43h throttle index (3Ah deg - 53, 0-28), 44h rpm index
//  (0 = highest rpm, 60 = lowest, from 24h through the A00h table).
//  kind: 'map' for the throttle x rpm maps, 'table' for the rpm-only tables.
//  Keep in step with the workbook by hand.
// ─────────────────────────────────────────────────────────────────

export const KLR_MAPS = [
  {"id": "T0C00", "kind": "map", "name": "BOOST_TARGET_MAP", "addr": "0C00h", "axes": "43h, 44h", "out": "51h (= result - 57h)",
   "purpose": "target boost (MAP ADC units, ~1.22 x kPa - 4) by throttle and rpm, interpolated; 8 x 16 at C00h", "covered": "boost control"},
  {"id": "T0B00", "kind": "map", "name": "CV_OPEN_LOOP_MAP", "addr": "0B00h", "axes": "43h, 44h", "out": "68h",
   "purpose": "cycling valve open-loop (feed-forward) duty, counts of the 193-count PWM period, interpolated; 8 x 16 at B00h", "covered": "boost control"},
  {"id": "T0992", "kind": "map", "name": "BOOST_PID_GAIN", "addr": "0992h", "axes": "43h, 44h", "out": "6Bh",
   "purpose": "boost PID gain (bit-packed) by throttle (43h & 18h) and rpm (44h/8), no interpolation; 4 x 8", "covered": "boost control"},
  {"id": "T0A00", "kind": "table", "name": "RPM_AXIS_TABLE", "addr": "0A00h", "axes": "24h", "out": "44h",
   "purpose": "rpm axis: engine speed (24h, timer ticks per 180 deg) to the map rpm index 0-60 (0 = highest rpm; 60 below ~1830 rpm)", "covered": "rpm"},
  {"id": "T0925", "kind": "table", "name": "RPM_K_ADC_START_ANGLE", "addr": "0925h", "axes": "44h", "out": "2Ah",
   "purpose": "angle to start the ADC routine (x 24h -> 22h); by 44h/8", "covered": "knock"},
  {"id": "T092E", "kind": "table", "name": "RPM_K_ADC_READ_ANGLE", "addr": "092Eh", "axes": "44h", "out": "2Bh",
   "purpose": "angle for the ADC read (x 24h, - 8 -> 23h); by 44h/8", "covered": "knock"},
  {"id": "T0937", "kind": "table", "name": "RPM_K_KNOCK_THRESH_COEF", "addr": "0937h", "axes": "44h", "out": "47h",
   "purpose": "knock threshold coefficient (compared with 46h); by 44h/8", "covered": "knock"},
  {"id": "T0940", "kind": "table", "name": "RPM_K_TIMING_RESTORE_CNT", "addr": "0940h", "axes": "44h", "out": "4Ah",
   "purpose": "cycle count before restoring 0.3 deg of timing (49h); by 44h/8", "covered": "knock"},
  {"id": "T0949", "kind": "table", "name": "RPM_K_BOOST_RESTORE_CNT", "addr": "0949h", "axes": "44h", "out": "50h",
   "purpose": "cycle count before restoring boost; by 44h/8", "covered": "knock"},
  {"id": "T0952", "kind": "table", "name": "RPM_K_BOOST_PULL_CNT", "addr": "0952h", "axes": "44h", "out": "4Eh",
   "purpose": "cycle count before pulling boost; by 44h/8", "covered": "knock"},
  {"id": "T095B", "kind": "table", "name": "RPM_K_MAX_TIMING_RETARD", "addr": "095Bh", "axes": "44h", "out": "4Bh",
   "purpose": "max timing retard; by 44h/8", "covered": "knock"},
  {"id": "T0964", "kind": "table", "name": "RPM_K_KNOCK_TPS_THRESH", "addr": "0964h", "axes": "44h", "out": "48h",
   "purpose": "throttle position threshold for knock control; by 44h/8 (differs in the 89 image)", "covered": "knock"},
  {"id": "T096D", "kind": "table", "name": "RPM_K_BOOST_PULL_THRESH", "addr": "096Dh", "axes": "44h", "out": "4Ch",
   "purpose": "threshold for pulling boost; by 44h/8", "covered": "knock"},
  {"id": "T0976", "kind": "table", "name": "RPM_K_WOT_ANGLE", "addr": "0976h", "axes": "44h", "out": "3Eh",
   "purpose": "angle for WOT; by 44h/8", "covered": "boost control"},
  {"id": "T097F", "kind": "table", "name": "RPM_K_MIN_KNOCK_THRESH", "addr": "097Fh", "axes": "44h", "out": "45h",
   "purpose": "minimum knock threshold; by 44h/8", "covered": "knock"},
  {"id": "T0988", "kind": "table", "name": "RPM_K_CNT_FOR_6A", "addr": "0988h", "axes": "44h", "out": "69h",
   "purpose": "counter for 6Ah; by 44h/8", "covered": ""},
];
