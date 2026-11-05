// ─────────────────────────────────────────────────────────────────
//  MAP / TABLE DEFINITIONS (MAPS tab)
//  From the DME disassembly workbook (dme/disassemble/disassembleperformance.xlsx
//  in whalenlg/944turbo_dme_klr), sheets Numbered Maps and Directly
//  Addressed Tables. Rows that cover several maps (43-46, 62 / 65, ...) are
//  split into one entry per map. Keep in step with the workbook by hand.
// ─────────────────────────────────────────────────────────────────

// n: map number (R2 at map_lookup, decimal); addr: map address in the code ROM
export const NUMBERED_MAPS = [
  {"n": 1, "name": "read_air_temp", "r2": "01h", "addr": "12A6h", "axes": "04h", "purpose": "Air temp NTC linearization, result to 12h (AIRTEMP_NTC1)", "covered": ""},
  {"n": 2, "name": "read_water_temp", "r2": "02h", "addr": "12A6h", "axes": "04h", "purpose": "Coolant temp NTC linearization, result to 13h (COOLANT_NTC2)", "covered": ""},
  {"n": 3, "name": "MAP3_CRANK_CLEAR_RPM", "r2": "03h", "addr": "1447h", "axes": "13h", "purpose": "rpm threshold for clearing the cranking flag 23h.2", "covered": ""},
  {"n": 4, "name": "MAP4_UNKNOWN", "r2": "04h", "addr": "13BCh", "axes": "13h", "purpose": "unknown", "covered": ""},
  {"n": 8, "name": "MAP8_UNKNOWN", "r2": "08h", "addr": "13ACh", "axes": "37h", "purpose": "unknown", "covered": ""},
  {"n": 18, "name": "MAP18_UNKNOWN", "r2": "12h", "addr": "13C4h", "axes": "13h", "purpose": "unknown", "covered": ""},
  {"n": 24, "name": "MAP24_UNKNOWN", "r2": "18h", "addr": "13DCh", "axes": "37h, 11h", "purpose": "unknown", "covered": ""},
  {"n": 25, "name": "MAP25_COAST_FUELCUT_RPM", "r2": "19h", "addr": "144Fh", "axes": "13h", "purpose": "coasting fuel cut rpm threshold", "covered": "fuel cut"},
  {"n": 26, "name": "MAP26_INJ_DEADTIME", "r2": "1Ah", "addr": "1598h", "axes": "11h", "purpose": "injector dead-time by system voltage", "covered": "fuel enrichments"},
  {"n": 27, "name": "MAP27_LOAD_LPF_COEF", "r2": "1Bh", "addr": "159Eh", "axes": "37h", "purpose": "load low-pass filter coefficient by rpm", "covered": "load"},
  {"n": 28, "name": "MAP28_ACCEL_LOWRPM_SCALE", "r2": "1Ch", "addr": "15DBh", "axes": "03h", "purpose": "low-rpm acceleration enrichment scaling (4Ch)", "covered": "acceleration enrichment"},
  {"n": 29, "name": "MAP29_ACCEL_LOWRPM_TEMP", "r2": "1Dh", "addr": "15D3h", "axes": "13h", "purpose": "low-rpm acceleration enrichment temperature map (4Ch)", "covered": "acceleration enrichment"},
  {"n": 33, "name": "MAP33_ACCEL_ALLRPM_SCALE", "r2": "21h", "addr": "15ACh", "axes": "03h", "purpose": "all-rpm acceleration enrichment scaling (3Dh)", "covered": "acceleration enrichment"},
  {"n": 34, "name": "MAP34_ACCEL_ALLRPM_TEMP", "r2": "22h", "addr": "15B2h (US), 18D0h (RoW)", "axes": "13h", "purpose": "all-rpm acceleration enrichment temperature map (3Dh)", "covered": "acceleration enrichment"},
  {"n": 38, "name": "MAP38_ACCEL_RPM_LOAD_SCALE", "r2": "26h", "addr": "15BCh", "axes": "37h, 49h", "purpose": "all-rpm acceleration enrichment rpm/load scaling (3Dh)", "covered": "acceleration enrichment"},
  {"n": 40, "name": "MAP40_POST_START_ENR", "r2": "28h", "addr": "1566h", "axes": "13h", "purpose": "post-start enrichment below 65C", "covered": "fuel enrichments"},
  {"n": 41, "name": "MAP41_HEAT_SOAK_ENR", "r2": "29h", "addr": "1570h", "axes": "12h", "purpose": "heat soak enrichment above 65C", "covered": "fuel enrichments"},
  {"n": 42, "name": "MAP42_IAT_FUEL_CORR", "r2": "2Ah", "addr": "145Bh", "axes": "12h", "purpose": "intake air temperature fuel correction", "covered": "fuel enrichments"},
  {"n": 43, "name": "MAP43_46_WARMUP_ENR", "r2": "2Bh", "addr": "1465h", "axes": "13h", "purpose": "warmup enrichment; 43/44 by region, 45/46 for cold cranking", "covered": "fuel enrichments"},
  {"n": 44, "name": "MAP43_46_WARMUP_ENR", "r2": "2Ch", "addr": "17E8h", "axes": "13h", "purpose": "warmup enrichment; 43/44 by region, 45/46 for cold cranking", "covered": "fuel enrichments"},
  {"n": 45, "name": "MAP43_46_WARMUP_ENR", "r2": "2Dh", "addr": "1B14h", "axes": "13h", "purpose": "warmup enrichment; 43/44 by region, 45/46 for cold cranking", "covered": "fuel enrichments"},
  {"n": 46, "name": "MAP43_46_WARMUP_ENR", "r2": "2Eh", "addr": "1A00h", "axes": "13h", "purpose": "warmup enrichment; 43/44 by region, 45/46 for cold cranking", "covered": "fuel enrichments"},
  {"n": 47, "name": "MAP47_WARMUP_SCALE_PT_WOT", "r2": "2Fh", "addr": "1473h", "axes": "37h, 49h", "purpose": "warmup enrichment scaling, part throttle and WOT", "covered": "fuel enrichments"},
  {"n": 48, "name": "MAP48_WARMUP_SCALE_IDLE", "r2": "30h", "addr": "1486h", "axes": "37h", "purpose": "warmup enrichment scaling, idle", "covered": "fuel enrichments"},
  {"n": 49, "name": "MAP49_IDLE_FUEL", "r2": "31h", "addr": "1538h", "axes": "37h", "purpose": "idle fuel map", "covered": "fuel enrichments"},
  {"n": 53, "name": "MAP53_ISV_CRANK_TARGET_RPM", "r2": "35h", "addr": "15E5h", "axes": "13h", "purpose": "ISV cranking target rpm", "covered": "ISV routine"},
  {"n": 54, "name": "MAP54_ISV_ALT_TARGET_RPM", "r2": "36h", "addr": "15EFh", "axes": "13h", "purpose": "ISV alternate path target rpm (800rpm throughout)", "covered": "ISV routine"},
  {"n": 55, "name": "MAP55_ISV_TARGET_RPM", "r2": "37h", "addr": "15F9h", "axes": "13h", "purpose": "ISV normal target rpm", "covered": "ISV routine"},
  {"n": 56, "name": "MAP56_ISV_IGAIN_BELOW", "r2": "38h", "addr": "1601h", "axes": "03h", "purpose": "idle correction I gain, rpm below target", "covered": "ISV routine"},
  {"n": 57, "name": "MAP57_ISV_IGAIN_ABOVE", "r2": "39h", "addr": "160Bh", "axes": "03h", "purpose": "idle correction I gain, rpm above target", "covered": "ISV routine"},
  {"n": 58, "name": "MAP58_ISV_PGAIN", "r2": "3Ah", "addr": "1615h", "axes": "03h", "purpose": "idle correction P gain", "covered": "ISV routine"},
  {"n": 59, "name": "MAP59_ISV_PWM_COAST_ADJ", "r2": "3Bh", "addr": "161Fh", "axes": "37h", "purpose": "ISV PWM adjustment during coasting fuel cutoff", "covered": "ISV routine"},
  {"n": 60, "name": "MAP60_ISV_BASE_PWM", "r2": "3Ch", "addr": "1629h", "axes": "37h, 13h", "purpose": "base (feed-forward) ISV PWM", "covered": "ISV routine"},
  {"n": 62, "name": "MAP62_65_LAMBDA_STEP_UNCHANGED", "r2": "3Eh", "addr": "1659h", "axes": "37h, 49h", "purpose": "lambda correction step, condition unchanged", "covered": "lambda"},
  {"n": 63, "name": "MAP63_66_LAMBDA_STEP_TO_LEAN", "r2": "3Fh", "addr": "1694h", "axes": "37h, 49h", "purpose": "lambda correction step, changed to lean", "covered": "lambda"},
  {"n": 64, "name": "MAP64_67_LAMBDA_STEP_TO_NOTLEAN", "r2": "40h", "addr": "16BAh", "axes": "37h, 49h", "purpose": "lambda correction step, changed to not-lean", "covered": "lambda"},
  {"n": 65, "name": "MAP62_65_LAMBDA_STEP_UNCHANGED", "r2": "41h", "addr": "1659h", "axes": "37h, 49h", "purpose": "lambda correction step, condition unchanged", "covered": "lambda"},
  {"n": 66, "name": "MAP63_66_LAMBDA_STEP_TO_LEAN", "r2": "42h", "addr": "1694h", "axes": "37h, 49h", "purpose": "lambda correction step, changed to lean", "covered": "lambda"},
  {"n": 67, "name": "MAP64_67_LAMBDA_STEP_TO_NOTLEAN", "r2": "43h", "addr": "18ECh", "axes": "37h, 49h", "purpose": "lambda correction step, changed to not-lean", "covered": "lambda"},
  {"n": 68, "name": "MAP68_OVERLOAD_LOAD_THRESH", "r2": "44h", "addr": "16E0h", "axes": "37h", "purpose": "overload load threshold by rpm", "covered": "fuel cut"},
  {"n": 72, "name": "MAP72_UNKNOWN", "r2": "48h", "addr": "12C0h", "axes": "37h", "purpose": "unknown", "covered": ""},
  {"n": 73, "name": "MAP73_UNKNOWN", "r2": "49h", "addr": "13CCh", "axes": "37h", "purpose": "unknown", "covered": ""},
  {"n": 74, "name": "MAP74_UNKNOWN", "r2": "4Ah", "addr": "13D4h", "axes": "13h", "purpose": "unknown", "covered": ""},
  {"n": 75, "name": "MAP75_WOT_FUEL", "r2": "4Bh", "addr": "1544h", "axes": "37h", "purpose": "WOT fuel map", "covered": "fuel enrichments"},
  {"n": 79, "name": "MAP79_PART_THROTTLE_FUEL", "r2": "4Fh", "addr": "148Ch", "axes": "37h, 49h", "purpose": "part throttle fuel map", "covered": "fuel enrichments"},
  {"n": 83, "name": "MAP83_BASE_CRANK_ENR", "r2": "53h", "addr": "157Ah", "axes": "13h", "purpose": "base cranking enrichment", "covered": "fuel enrichments"},
  {"n": 84, "name": "MAP84_CRANK_PHASEOUT_RPM", "r2": "54h", "addr": "1584h", "axes": "13h", "purpose": "rpm threshold starting the cranking phase-out (600rpm)", "covered": "fuel enrichments"},
  {"n": 85, "name": "MAP85_CRANK_PHASEOUT_SCALE1", "r2": "55h", "addr": "158Ah", "axes": "4Dh", "purpose": "cranking enrichment phase-out scaling, first term", "covered": "fuel enrichments"},
  {"n": 86, "name": "MAP86_CRANK_PHASEOUT_SCALE2", "r2": "56h", "addr": "1590h", "axes": "37h", "purpose": "cranking enrichment phase-out scaling, second term", "covered": "fuel enrichments"},
  {"n": 87, "name": "MAP87_90_ISV_TARGET_LOAD", "r2": "57h", "addr": "164Fh", "axes": "13h", "purpose": "ISV target load by temperature, selected by code plug", "covered": "ISV routine"},
  {"n": 88, "name": "MAP87_90_ISV_TARGET_LOAD", "r2": "58h", "addr": "18E2h", "axes": "13h", "purpose": "ISV target load by temperature, selected by code plug", "covered": "ISV routine"},
  {"n": 89, "name": "MAP87_90_ISV_TARGET_LOAD", "r2": "59h", "addr": "164Fh", "axes": "13h", "purpose": "ISV target load by temperature, selected by code plug", "covered": "ISV routine"},
  {"n": 90, "name": "MAP87_90_ISV_TARGET_LOAD", "r2": "5Ah", "addr": "1AFAh", "axes": "13h", "purpose": "ISV target load by temperature, selected by code plug", "covered": "ISV routine"},
  {"n": 91, "name": "MAP91_UNKNOWN", "r2": "5Bh", "addr": "12CAh", "axes": "37h, 49h", "purpose": "unknown", "covered": ""},
];

// addr: table address (hex, no h)
export const DIRECT_TABLES = [
  {"addr": "10F4", "name": "AFM_XFER_TABLE1", "purpose": "AFM transfer table 1, indexed by the raw value divided by 32", "covered": "load"},
  {"addr": "10FC", "name": "AFM_XFER_TABLE2_SHIFT", "purpose": "AFM transfer table 2, exponent for the left shift (2^n)", "covered": "load"},
  {"addr": "1104", "name": "AFM_XFER_TABLE3", "purpose": "AFM transfer table 3, indexed by the remainder of the division by 32", "covered": "load"},
  {"addr": "1124", "name": "TABLE1124_UNKNOWN", "purpose": "unknown", "covered": ""},
  {"addr": "112E", "name": "FQS_SWITCH_MAP", "purpose": "FQS map, maps the ADC value in 17h to a switch position of 0-7", "covered": "fuel enrichments"},
  {"addr": "1140", "name": "REACT_IDLE_FUEL_TABLE", "purpose": "return-to-idle transient fuel correction, indexed by 4Dh", "covered": "post-ignition"},
  {"addr": "1150", "name": "REACT_THROTTLE_FUEL_TABLE", "purpose": "return-to-throttle transient fuel correction, indexed by 4Dh", "covered": "post-ignition"},
  {"addr": "1296", "name": "REGION_ALTITUDE_MAP", "purpose": "region and altitude coding map, indexed by 14h", "covered": ""},
];
