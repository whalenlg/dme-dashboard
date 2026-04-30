import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine
} from "recharts";

// ─────────────────────────────────────────────────────────────────
//  GROUP COLOUR MAP
// ─────────────────────────────────────────────────────────────────
const GROUPS = {
  reg:    { color: '#8888bb', label: 'Registers'   },
  adc:    { color: '#44aaff', label: 'ADC Inputs'  },
  lambda: { color: '#cc66ff', label: 'Lambda'      },
  flags:  { color: '#ffaa00', label: 'Bit Flags'   },
  ign:    { color: '#ff8844', label: 'Ignition'    },
  rpm:    { color: '#66ffaa', label: 'RPM / Crank' },
  timer:  { color: '#44cccc', label: 'Timers'      },
  fuel:   { color: '#aaffaa', label: 'Fuel / Load' },
  sys:    { color: '#aaaaaa', label: 'System'      },
  enrich: { color: '#ff88cc', label: 'Enrichment'  },
  isv:    { color: '#ff44aa', label: 'ISV'         },
  misc:   { color: '#99cc99', label: 'Work Area'   },
};

const PHASE_COLORS = {
  fuelcut: '#ff4444',
  cold:    '#44aaff',
  sync:    '#66ffaa',
  lambda:  '#cc66ff',
  isv:     '#ff44aa',
  warn:    '#ffaa00',
  enrich:  '#ff88cc',
  info:    '#888888',
};

// ─────────────────────────────────────────────────────────────────
//  FULL 8051 IRAM MEMORY MAP  (0x00–0x7F)
// ─────────────────────────────────────────────────────────────────
const IRAM_MAP = [
  {a:0x00,n:'R0',     g:'reg',    d:'Bank 0 R0 — general purpose register'},
  {a:0x01,n:'R1',     g:'reg',    d:'Bank 0 R1 — general purpose register'},
  {a:0x02,n:'R2',     g:'reg',    d:'Bank 0 R2 — general purpose register'},
  {a:0x03,n:'R3',     g:'reg',    d:'Bank 0 R3 — general purpose register'},
  {a:0x04,n:'R4',     g:'reg',    d:'Bank 0 R4  (also byte for bit25h: DataPlug flag bit 5)'},
  {a:0x05,n:'R5',     g:'reg',    d:'Bank 0 R5 — general purpose register'},
  {a:0x06,n:'R6',     g:'reg',    d:'Bank 0 R6 — general purpose register'},
  {a:0x07,n:'R7',     g:'reg',    d:'Bank 0 R7 — general purpose register'},
  {a:0x08,n:'B1:R0',  g:'reg',    d:'Bank 1 R0'},
  {a:0x09,n:'B1:R1',  g:'reg',    d:'Bank 1 R1'},
  {a:0x0A,n:'B1:R2',  g:'reg',    d:'Bank 1 R2'},
  {a:0x0B,n:'B1:R3',  g:'reg',    d:'Bank 1 R3'},
  {a:0x0C,n:'B1:R4',  g:'reg',    d:'Bank 1 R4'},
  {a:0x0D,n:'B1:R5',  g:'reg',    d:'Bank 1 R5'},
  {a:0x0E,n:'B1:R6',  g:'reg',    d:'Bank 1 R6'},
  {a:0x0F,n:'B1:R7',  g:'reg',    d:'Bank 1 R7'},
  {a:0x10,n:'AFM_RAW',g:'adc',    d:'ADC Ch0 — Airflow meter raw value (ADC-derived; reflects afm_tippy spike during TEST_TIPPY_IN)'},
  {a:0x11,n:'BATT_V', g:'adc',    d:'ADC Ch1 — Battery voltage. Formula: V = raw × 0.05263 + 2.132  (0xD8=13.5V, 0x8C=11.0V, ADC spans ~6.4–14.8V)'},
  {a:0x12,n:'AIR_NTC',g:'adc',    d:'ADC Ch2 — Intake air temperature NTC (linearised firmware units)'},
  {a:0x13,n:'COOLANT',g:'adc',    d:'ADC Ch3 — Engine coolant NTC (linearised, 0xE0≈80°C warm, 0x00=cold/error)'},
  {a:0x14,n:'ALT_COR',g:'adc',    d:'ADC Ch4 — Altitude correction switch (0x00=high altitude >1000m, 0xF8=sea level)'},
  {a:0x15,n:'ADC_CH5',g:'adc',    d:'ADC Ch5 — Spare / unused channel (0xFF = no sensor fitted)'},
  {a:0x16,n:'TPS',    g:'adc',    d:'ADC Ch6 — Throttle Position Sensor (0xDB..0xFF=closed/idle, 0x77..0xD0=WOT, 0x00..0x76=part load)'},
  {a:0x17,n:'FQS_ALT',g:'adc',    d:'ADC Ch7 — Fuel Quality Switch / altitude barometric pressure sensor'},
  {a:0x18,n:'LMB_UNC',g:'lambda', d:'Lambda adj UNCHANGED — correction applied when no O2 change required'},
  {a:0x19,n:'LMB_LN', g:'lambda', d:'Lambda adj LEAN — applied when O2 reads lean (rich-up correction)'},
  {a:0x1A,n:'LMB_NLN',g:'lambda', d:'Lambda adj NOT-LEAN — applied when O2 reads rich (lean-down correction)'},
  {a:0x1B,n:'LMB_HI', g:'lambda', d:'Lambda integrator high byte — bit 7 drives TXD/P3.1 diagnostic pin output'},
  {a:0x1C,n:'LMB_LO', g:'lambda', d:'Lambda integrator low byte'},
  {a:0x1D,n:'B3:R5',  g:'reg',    d:'Bank 3 R5 save — extint1_handler (crank interrupt) register context save area'},
  {a:0x1E,n:'B3:R6',  g:'reg',    d:'Bank 3 R6 save — extint1_handler register context save'},
  {a:0x1F,n:'B3:R7',  g:'reg',    d:'Bank 3 R7 save — extint1_handler register context save'},
  {a:0x20,n:'FLAGS20',g:'flags',  d:'Bit-addressable: bit05h=ISVPWMOverflow'},
  {a:0x21,n:'FLAGS21',g:'flags',  d:'Bit-addressable: bit08h=EngineSync, bit09h=Phase2LambdaEnable, bit0Dh(bit5)=UseMap1140 after-start enrich active'},
  {a:0x22,n:'FLAGS22',g:'flags',  d:'Bit-addressable: bit10h..17h — fuel and lambda control flags'},
  {a:0x23,n:'FLAGS23',g:'flags',  d:'Bit-addressable: bit1Dh[5]=FuelOffCoast — fuel injection cut on deceleration'},
  {a:0x24,n:'FLAGS24',g:'flags',  d:'Bit-addressable: bit23h[3]=O2Lean / LambdaOK — closed-loop lambda enabled'},
  {a:0x25,n:'FLAGS25',g:'flags',  d:'Bit-addressable: bit2Ch[4]=ColdStartTiming map, bit2Dh[5]=ColdStartEnrich active'},
  {a:0x26,n:'FLAGS26',g:'flags',  d:'Bit-addressable: bit28h..2Fh — miscellaneous control bits'},
  {a:0x27,n:'FLAGS27',g:'flags',  d:'Bit-addressable: bit30h=LambdaTimerExpired, bit37h=DataPlug variant select'},
  {a:0x28,n:'FLAGS28',g:'flags',  d:'Bit-addressable: bit38h..3Fh'},
  {a:0x29,n:'FLAGS29',g:'flags',  d:'Bit-addressable: bit40h..47h'},
  {a:0x2A,n:'WDOG',   g:'sys',    d:'Watchdog counter — decremented each main-loop iteration; firmware health indicator'},
  {a:0x2B,n:'IGN_EVT',g:'ign',    d:'Teeth remaining until next extint1 ignition coil event fires'},
  {a:0x2C,n:'IGN_1ST',g:'ign',    d:'Tooth count to first ignition event after crank TDC reference pulse'},
  {a:0x2D,n:'XINT1DN',g:'ign',    d:'XINT1 countdown counter (counts 252→0, wraps — hooks empty in this ROM)'},
  {a:0x2E,n:'XINT1RL',g:'ign',    d:'XINT1 countdown reload value (0xFC=252, loaded from ROM[0x1162])'},
  {a:0x2F,n:'DWELL',  g:'ign',    d:'Dwell angle in half-teeth — coil charge duration (90° cap applied from table)'},
  {a:0x30,n:'IGN_DUR',g:'ign',    d:'Ignition duration: dwell with crank-reference offset correction applied'},
  {a:0x31,n:'IGN_ADV',g:'ign',    d:'Ignition advance °BTDC — base map value, reduced by KLR knock retard on real engine'},
  {a:0x32,n:'TIM_NXT',g:'ign',    d:'Next computed timing advance value (loaded into 0x31 at next update)'},
  {a:0x33,n:'NXT_TDC',g:'ign',    d:'Half-teeth from spark event to TDC (= advance + 180°)'},
  {a:0x34,n:'TIM_UPD',g:'ign',    d:'Interval (main-loop iterations) between timing advance updates'},
  {a:0x35,n:'FIRE_EV',g:'ign',    d:'Fire event index (0 or 1) — selects cylinder for next injection/ignition'},
  {a:0x36,n:'PRPM_CT',g:'rpm',    d:'PRPM tooth counter — accumulates teeth between crank reference pulses'},
  {a:0x37,n:'PRPM',   g:'rpm',    d:'PRPM tooth period — inversely proportional to RPM (lower = higher RPM)'},
  {a:0x38,n:'PSC0',   g:'timer',  d:'Prescaler 0 — subtask scheduler countdown'},
  {a:0x39,n:'PSC1',   g:'timer',  d:'Prescaler 1 — subtask scheduler countdown'},
  {a:0x3A,n:'PSC2',   g:'timer',  d:'Prescaler 2 — subtask scheduler countdown'},
  {a:0x3B,n:'PRPM_PRV',g:'rpm',   d:'Previous PRPM — used for RPM rate-of-change calculation'},
  {a:0x3C,n:'SUBTSK0',g:'timer',  d:'Subtask-0 prescaler / after-start enrichment counter (reloads 0x43–0x59)'},
  {a:0x3D,n:'AFM_PK', g:'rpm',    d:'AFM wiper peak — maximum wiper deflection sampled per crankshaft revolution'},
  {a:0x3E,n:'LMBD_TM',g:'lambda', d:'Lambda warmup timer — counts down before closed-loop lambda control enabled'},
  {a:0x3F,n:'DATAPLG',g:'sys',    d:'DataPlug variant register — written by P3.4 (T0) variant-select code path'},
  {a:0x40,n:'FUEL_40',g:'fuel',   d:'Fuel calculation intermediate work area'},
  {a:0x41,n:'FUEL_41',g:'fuel',   d:'Fuel calculation intermediate work area'},
  {a:0x42,n:'FUEL_42',g:'fuel',   d:'Fuel calculation intermediate work area'},
  {a:0x43,n:'FUEL_43',g:'fuel',   d:'Fuel calculation intermediate work area'},
  {a:0x44,n:'FUEL_44',g:'fuel',   d:'Fuel calculation intermediate work area'},
  {a:0x45,n:'FUEL_45',g:'fuel',   d:'Fuel calculation intermediate work area'},
  {a:0x46,n:'LOAD_HB',g:'fuel',   d:'24-bit load accumulator HIGH byte (0x46:0x47:0x48 — AFM×RPM integration)'},
  {a:0x47,n:'LOAD_MB',g:'fuel',   d:'24-bit load accumulator MID byte'},
  {a:0x48,n:'LOAD_LB',g:'fuel',   d:'24-bit load accumulator LOW byte'},
  {a:0x49,n:'LOAD_IX',g:'fuel',   d:'Load index — fuel map row selector (derived from load accumulator)'},
  {a:0x4A,n:'FUEL_LB',g:'fuel',   d:'Current injection pulse width LOW byte (pulse_width_µs = value×2)'},
  {a:0x4B,n:'FUEL_HB',g:'fuel',   d:'Current injection pulse width HIGH byte (ms = ((HB<<8)|LB)×2/1000)'},
  {a:0x4C,n:'ACCEL_E',g:'fuel',   d:'Acceleration enrichment — transient fuel adder from AFM rate-of-change'},
  {a:0x4D,n:'MAP1140',g:'fuel',   d:'Map-at-0x1140 index — UseMap1140 correction table lookup index'},
  {a:0x4E,n:'FNX_LB', g:'fuel',   d:'Next-cycle injection pulse LOW byte (computed this rev, loaded next rev)'},
  {a:0x4F,n:'FNX_HB', g:'fuel',   d:'Next-cycle injection pulse HIGH byte'},
  {a:0x50,n:'WORK_50',g:'misc',   d:'General firmware work area'},
  {a:0x51,n:'WORK_51',g:'misc',   d:'General firmware work area'},
  {a:0x52,n:'WORK_52',g:'misc',   d:'General firmware work area'},
  {a:0x53,n:'AFM_PRV',g:'adc',    d:'AFM previous-cycle reading — used by airflow_calc to compute delta (iram[10h]-iram[53h]) for acceleration enrichment'},
  {a:0x54,n:'WORK_54',g:'misc',   d:'General firmware work area'},
  {a:0x55,n:'WORK_55',g:'misc',   d:'General firmware work area'},
  {a:0x56,n:'WORK_56',g:'misc',   d:'General firmware work area'},
  {a:0x57,n:'WORK_57',g:'misc',   d:'General firmware work area'},
  {a:0x58,n:'WU_HB',  g:'enrich', d:'Warmup counter HIGH byte (0x58:0x59 — after-start enrichment countdown timer)'},
  {a:0x59,n:'WU_LB',  g:'enrich', d:'Warmup counter LOW byte (decrements to 0, then normal fuel calculation resumes)'},
  {a:0x5A,n:'WORK_5A',g:'misc',   d:'General firmware work area'},
  {a:0x5B,n:'WORK_5B',g:'misc',   d:'General firmware work area'},
  {a:0x5C,n:'WORK_5C',g:'misc',   d:'General firmware work area'},
  {a:0x5D,n:'WORK_5D',g:'misc',   d:'General firmware work area'},
  {a:0x5E,n:'WORK_5E',g:'misc',   d:'General firmware work area'},
  {a:0x5F,n:'WORK_5F',g:'misc',   d:'General firmware work area'},
  {a:0x60,n:'WORK_60',g:'misc',   d:'General firmware work area'},
  {a:0x61,n:'WORK_61',g:'misc',   d:'General firmware work area'},
  {a:0x62,n:'WORK_62',g:'misc',   d:'General firmware work area'},
  {a:0x63,n:'WORK_63',g:'misc',   d:'General firmware work area'},
  {a:0x64,n:'WORK_64',g:'misc',   d:'General firmware work area'},
  {a:0x65,n:'WORK_65',g:'misc',   d:'General firmware work area'},
  {a:0x66,n:'WORK_66',g:'misc',   d:'General firmware work area'},
  {a:0x67,n:'WORK_67',g:'misc',   d:'General firmware work area'},
  {a:0x68,n:'WORK_68',g:'misc',   d:'General firmware work area'},
  {a:0x69,n:'WORK_69',g:'misc',   d:'General firmware work area'},
  {a:0x6A,n:'WORK_6A',g:'misc',   d:'General firmware work area'},
  {a:0x6B,n:'WORK_6B',g:'misc',   d:'General firmware work area'},
  {a:0x6C,n:'WORK_6C',g:'misc',   d:'General firmware work area'},
  {a:0x6D,n:'WORK_6D',g:'misc',   d:'General firmware work area'},
  {a:0x6E,n:'WORK_6E',g:'misc',   d:'General firmware work area'},
  {a:0x6F,n:'WORK_6F',g:'misc',   d:'General firmware work area'},
  {a:0x70,n:'WORK_70',g:'misc',   d:'General firmware work area'},
  {a:0x71,n:'WORK_71',g:'misc',   d:'General firmware work area'},
  {a:0x72,n:'WORK_72',g:'misc',   d:'General firmware work area'},
  {a:0x73,n:'WORK_73',g:'misc',   d:'General firmware work area'},
  {a:0x74,n:'WORK_74',g:'misc',   d:'General firmware work area'},
  {a:0x75,n:'WORK_75',g:'misc',   d:'General firmware work area'},
  {a:0x76,n:'WORK_76',g:'misc',   d:'General firmware work area'},
  {a:0x77,n:'WORK_77',g:'misc',   d:'General firmware work area'},
  {a:0x78,n:'WORK_78',g:'misc',   d:'General firmware work area'},
  {a:0x79,n:'WORK_79',g:'misc',   d:'General firmware work area'},
  {a:0x7A,n:'WORK_7A',g:'misc',   d:'General firmware work area'},
  {a:0x7B,n:'WORK_7B',g:'misc',   d:'General firmware work area'},
  {a:0x7C,n:'WORK_7C',g:'misc',   d:'General firmware work area'},
  {a:0x7D,n:'WORK_7D',g:'misc',   d:'General firmware work area'},
  {a:0x7E,n:'WORK_7E',g:'misc',   d:'General firmware work area'},
  {a:0x7F,n:'ISV_STP',g:'isv',    d:'ISV step position — Idle Speed Valve (0x00=fully closed, higher=more air bypass)'},
];

// ─────────────────────────────────────────────────────────────────
//  PORT DEFINITIONS
// ─────────────────────────────────────────────────────────────────
const PORT_DEFS = {
  P1: [
    {bit:7, name:'O2_LEAN',   dir:'IN',  desc:'O2/Lambda sensor top threshold: 1=lean (sensor < 0.45V), 0=rich'},
    {bit:6, name:'O2_RICH',   dir:'IN',  desc:'O2/Lambda sensor bottom threshold: 1=lean or crossover (sensor < 0.50V), 0=rich'},
    {bit:5, name:'IGN_OUT',   dir:'OUT', desc:'Ignition coil primary driver (KLR) — triggered by extint1_handler at computed spark angle'},
    {bit:4, name:'IDLE_SPD',  dir:'OUT', desc:'Idle speed positioner output — also used as firmware watchdog heartbeat'},
    {bit:3, name:'UNUSED',    dir:'?',   desc:'Unused — P1.3 not connected to any DME function'},
    {bit:2, name:'DME_RELAY', dir:'OUT', desc:'DME main relay / fuel pump relay driver — active-low'},
    {bit:1, name:'TACH_PULSE',dir:'OUT', desc:'Tachometer output pulse — drives instrument cluster rev counter'},
    {bit:0, name:'INJ_OUT',   dir:'OUT', desc:'Fuel injector driver — active-low pulse width set by FUEL_HB/LB (iram[4B:4A])'},
  ],
  P2: [
    {bit:7, name:'ADR_A15', dir:'OUT', desc:'External address bit 15 (high byte output during MOVX)'},
    {bit:6, name:'ADR_A14', dir:'OUT', desc:'External address bit 14'},
    {bit:5, name:'ADR_A13', dir:'OUT', desc:'External address bit 13'},
    {bit:4, name:'ADR_A12', dir:'OUT', desc:'External address bit 12'},
    {bit:3, name:'ADR_A11', dir:'OUT', desc:'External address bit 11'},
    {bit:2, name:'ADC_S2',  dir:'OUT', desc:'ADC mux channel select bit 2 — P2[2:0] selects ch0..7'},
    {bit:1, name:'ADC_S1',  dir:'OUT', desc:'ADC mux channel select bit 1'},
    {bit:0, name:'ADC_S0',  dir:'OUT', desc:'ADC mux bit 0 (0=AFM, 1=Batt, 2=AirNTC, 3=Coolant, 4=AltCorr, 5=spare, 6=TPS, 7=FQS)'},
  ],
  P3: [
    {bit:7, name:'/RD',      dir:'OUT', desc:'External RAM read strobe — active-low'},
    {bit:6, name:'/WR',      dir:'OUT', desc:'External RAM write strobe — active-low'},
    {bit:5, name:'T1/AC',    dir:'IN',  desc:'Timer 1 external clock / A/C compressor clutch input'},
    {bit:4, name:'T0/CODE',  dir:'IN',  desc:'Timer 0 / Codes plug (variant select) — floating=0xFF (default tune)'},
    {bit:3, name:'INT1/CRNK',dir:'IN',  desc:'External INT1 / Crank speed sensor — falling edge = tooth pulse'},
    {bit:2, name:'INT0/REF', dir:'IN',  desc:'External INT0 / Crank reference sensor — falling edge = TDC reference'},
    {bit:1, name:'TXD/LMB',  dir:'OUT', desc:'TXD serial / lambda diagnostic bit-bang (P3.1 dual use when bit1Fh=TXDLambdaDiag)'},
    {bit:0, name:'RXD',      dir:'IN',  desc:'Serial receive — diagnostic communications'},
  ],
};

// ─────────────────────────────────────────────────────────────────
//  LOG PARSER  — handles both [STATUS] (legacy) and [DS] (compact)
// ─────────────────────────────────────────────────────────────────

// Parse compact dashboard snapshot line:
//   [DS] <time_ms>,<256-hex-iram>,<p1hex><p2hex><p3hex>
function parseDsLine(line) {
  // Strip "[DS] " prefix
  const body = line.replace(/^\[DS\]\s*/,'').trim();
  const parts = body.split(',');
  if (parts.length < 3) return null;
  const t    = parseInt(parts[0]);
  const hex  = parts[1].trim();
  const ports = parts[2].trim();
  if (isNaN(t) || hex.length < 256) return null;

  const snap = { iram: {}, t, raw: line };
  // Unpack 128 iram bytes — skip 'xx' (X-state/uninitialised) entries
  for (let i = 0; i < 128; i++) {
    const byteStr = hex.slice(i*2, i*2+2);
    if (byteStr.indexOf('x') === -1 && byteStr.indexOf('X') === -1) {
      const v = parseInt(byteStr, 16);
      if (!isNaN(v)) snap.iram[i] = v;
    }
  }
  // Unpack ports (6 hex chars: P1 P2 P3)
  if (ports.length >= 6) {
    snap.p1 = parseInt(ports.slice(0,2), 16);
    snap.p2 = parseInt(ports.slice(2,4), 16);
    snap.p3 = parseInt(ports.slice(4,6), 16);
  }
  // Fourth field: RPM from reference sensor edge timing (0 = not yet synced)
  if (parts.length >= 4) {
    const rpm = parseInt(parts[3].trim());
    if (!isNaN(rpm) && rpm > 0) snap.refRpm = rpm;
  }
  return snap;
}

function parseStatusLine(line) {
  const snap = { iram: {}, raw: line };
  const tm = line.match(/t=(\d+)\s*ms/);
  if (!tm) return null;
  snap.t = parseInt(tm[1]);

  // Named single-byte:  name(HH)=0xNN
  for (const m of line.matchAll(/([a-zA-Z_]\w*)\(([0-9A-Fa-f]{1,2})\)=0x([0-9A-Fa-f]{1,4})/g)) {
    const addr = parseInt(m[2], 16);
    const val  = parseInt(m[3], 16);
    snap[m[1].toLowerCase()] = val;
    snap.iram[addr] = val;
  }
  // Named 16-bit:  name(HH:LL)=0xNNNN
  for (const m of line.matchAll(/([a-zA-Z_]\w*)\(([0-9A-Fa-f]{1,2}):([0-9A-Fa-f]{1,2})\)=0x([0-9A-Fa-f]{1,4})/g)) {
    const addrH = parseInt(m[2], 16);
    const addrL = parseInt(m[3], 16);
    const val16 = parseInt(m[4], 16);
    snap[m[1].toLowerCase()] = val16;
    snap.iram[addrH] = (val16 >> 8) & 0xFF;
    snap.iram[addrL] = val16 & 0xFF;
  }
  // Lambda triple:  lmbdadj(AA:BB:CC)=0xNN/0xNN/0xNN
  const lm = line.match(/lmbdadj\(([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)\)=0x([0-9a-f]+)\/0x([0-9a-f]+)\/0x([0-9a-f]+)/i);
  if (lm) {
    [parseInt(lm[1],16), parseInt(lm[2],16), parseInt(lm[3],16)].forEach((a,i) => {
      snap.iram[a] = parseInt(lm[4+i], 16);
    });
    snap.lmbdadj_unc   = parseInt(lm[4], 16);
    snap.lmbdadj_lean  = parseInt(lm[5], 16);
    snap.lmbdadj_nlean = parseInt(lm[6], 16);
  }
  // Standalone (HH)=0xNN — flags without name prefix
  for (const m of line.matchAll(/\(([0-9A-Fa-f]{2})\)=0x([0-9A-Fa-f]{1,2})/g)) {
    const addr = parseInt(m[1], 16);
    const val  = parseInt(m[2], 16);
    if (snap.iram[addr] === undefined) snap.iram[addr] = val;
  }
  // Explicit RPM in status line: prpm(37)=0x15 (840 RPM)
  const rpmEx = line.match(/prpm[^=]*=0x[0-9a-f]+\s+\((\d+)\s+RPM\)/i);
  if (rpmEx) snap.explicitRpm = parseInt(rpmEx[1]);
  return snap;
}

function parsePhaseLine(line) {
  const tm = line.match(/t=(\d+)\s*ms/);
  if (!tm) return null;
  const msg = line.replace(/^\[PHASE\]\s*t=\d+\s*ms\s*/,'').trim();
  let category = 'info';
  if (/FUEL CUT/i.test(msg))               category = 'fuelcut';
  else if (/COLD.START/i.test(msg))        category = 'cold';
  else if (/ENGINE SYNC/i.test(msg))       category = 'sync';
  else if (/LAMBDA|O2/i.test(msg))         category = 'lambda';
  else if (/ISV/i.test(msg))               category = 'isv';
  else if (/WATCHDOG|WDOG/i.test(msg))     category = 'warn';
  else if (/AFTER.START ENRICH/i.test(msg))category = 'enrich';
  else if (/ENRICH|MAP1140|UseMap/i.test(msg)) category = 'enrich';
  else if (/INTERRUPT BLOCK/i.test(msg))   category = 'sync';
  return { t: parseInt(tm[1]), msg, category };
}

function parseLog(text) {
  const snapshots = [], phases = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('[DS]'))          { const s = parseDsLine(t);      if (s) snapshots.push(s); }
    else if (t.startsWith('[STATUS]')) { const s = parseStatusLine(t);  if (s) snapshots.push(s); }
    else if (t.startsWith('[PHASE]'))  { const p = parsePhaseLine(t);   if (p) phases.push(p);    }
  }
  // Annotate each snapshot with last valid raw temp bytes so Overview
  // can carry-forward across mid-scan raw ADC artifacts.
  // Inline threshold: val*0.875-116 >= -40  →  val >= 87 (0x57)
  const validTemp = v => v !== undefined && v >= 0x57;
  let lastCoolantRaw = undefined, lastAirRaw = undefined;
  for (const s of snapshots) {
    if (validTemp(s.iram[0x13])) lastCoolantRaw = s.iram[0x13];
    if (validTemp(s.iram[0x12])) lastAirRaw     = s.iram[0x12];
    s._prevCoolant = lastCoolantRaw;
    s._prevAir     = lastAirRaw;
  }
  return { snapshots, phases };
}

// ─────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────
const h2  = v => v !== undefined ? v.toString(16).toUpperCase().padStart(2,'0') : '--';
const h4  = v => v !== undefined ? v.toString(16).toUpperCase().padStart(4,'0') : '----';
const b8  = v => v !== undefined ? v.toString(2).padStart(8,'0') : '--------';
const fuelMs = snap => {
  const hb = snap?.iram?.[0x4B] ?? 0, lb = snap?.iram?.[0x4A] ?? 0;
  return ((hb << 8) | lb) * 2 / 1000;
};
// PRPM → RPM  (empirical: prpm=21 @ 840 RPM → K=17640)
// prpm=3 → ~5880 RPM (near redline).  prpm < 3 is a pre-sync
// garbage value — return null so it is excluded from display and charts.
const PRPM_MIN_VALID = 3;
const prpmToRpm = prpm => (prpm >= PRPM_MIN_VALID) ? Math.round(17640 / prpm) : null;
const snapRpm   = snap =>
  snap.refRpm                                            // DS log: reference sensor (authoritative)
  ?? snap.explicitRpm                                    // STATUS log with "(RPM)" annotation
  ?? ((snap.iram?.[0x21] & 1)                           // prpm fallback only after EngineSync
      ? prpmToRpm(snap.iram?.[0x37] ?? 0)
      : null);
// NTC linearised byte → °C  (anchored: 0x00=−116°C, 0xE0=80°C → slope=0.875)
// NTC linearised byte → °C.
// Returns null if below −40°C — that means the firmware's linearisation
// subtask hasn't run yet and iram still holds the raw ADC scan value.
// Engine coolant/intake air can never be below −40°C in any valid state.
const ntcToC = v => {
  if (v == null || v === undefined) return null;
  const c = Math.round(v * 0.875 - 116);
  return c >= -40 ? c : null;
};
// Dwell: iram[0x2F] is in half-teeth (132 teeth × 2 edges = 264 ht/rev)
// 1 half-tooth = 360°/264 = 1.364°
// dwell_ms = half_teeth × 60000 / (RPM × 264)
const HT_PER_REV = 264;
const dwellHtToDeg = ht => ht != null ? +(ht * 360 / HT_PER_REV).toFixed(1) : null;
const dwellHtToMs  = (ht, rpm) => (ht != null && rpm >= 40)
  ? (ht * 60000 / (rpm * HT_PER_REV)).toFixed(2) : '--';

// ─────────────────────────────────────────────────────────────────
//  STYLES  (all inline — zero external CSS deps)
// ─────────────────────────────────────────────────────────────────
const C = {
  bg:'#040a04', panelBg:'#060e06', panelBg2:'#0a150a',
  border:'#0d2e0d', border2:'#1a3a1a',
  text:'#00e060', textDim:'#ccddcc', textBright:'#00ff80',
  amber:'#ffaa00', red:'#ff4444', blue:'#44aaff',
};

const S = {
  root:{background:C.bg,color:C.text,fontFamily:"'Share Tech Mono','Courier New',monospace",
        fontSize:'12px',minHeight:'100vh',display:'flex',flexDirection:'column'},
  hdr:{background:C.panelBg,borderBottom:`2px solid ${C.border}`,padding:'8px 14px',
       display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'},
  title:{fontFamily:"'Orbitron','Courier New',monospace",fontSize:'15px',fontWeight:900,
         color:C.textBright,letterSpacing:'0.08em',textShadow:`0 0 12px ${C.textBright}66`,margin:0},
  sub:{color:'#88bb88',fontSize:'9px',letterSpacing:'0.2em',marginTop:'1px'},
  tabBar:{display:'flex',gap:'2px',background:C.panelBg,borderBottom:`1px solid ${C.border}`,
          padding:'4px 12px 0',flexShrink:0},
  tab:a=>({padding:'5px 14px',cursor:'pointer',fontFamily:'inherit',fontSize:'11px',
           letterSpacing:'0.1em',border:'none',outline:'none',
           background:a?'#0d2e0d':'transparent',color:a?C.textBright:C.textDim,
           borderTop:a?`1px solid ${C.textBright}`:'1px solid transparent',transition:'all .15s'}),
  content:{padding:'10px',flex:1,overflow:'auto'},
  panel:{background:C.panelBg,border:`1px solid ${C.border}`,borderRadius:'2px',
         padding:'10px',marginBottom:'10px'},
  panelTitle:{color:C.textDim,fontSize:'9px',letterSpacing:'0.2em',textTransform:'uppercase',
              borderBottom:`1px solid ${C.border}`,paddingBottom:'4px',marginBottom:'8px'},
  metric:{background:C.panelBg2,border:`1px solid ${C.border}`,borderRadius:'2px',
          padding:'8px 6px',textAlign:'center'},
  metricLbl:{color:C.textDim,fontSize:'9px',letterSpacing:'0.12em',textTransform:'uppercase'},
  metricVal:{color:C.textBright,fontSize:'18px',
             fontFamily:"'Orbitron','Courier New',monospace",textShadow:`0 0 6px ${C.textBright}44`},
  metricUnit:{color:C.textDim,fontSize:'9px'},
  btn:v=>({padding:'6px 16px',background:v==='p'?'#0d4a0d':C.panelBg,
           border:`1px solid ${v==='p'?C.textBright:C.border}`,
           color:v==='p'?C.textBright:C.textDim,fontFamily:'inherit',
           fontSize:'11px',letterSpacing:'0.1em',cursor:'pointer'}),
  scrubber:{background:C.panelBg,borderTop:`1px solid ${C.border}`,
            padding:'6px 14px',display:'flex',alignItems:'center',gap:'10px',flexShrink:0},
  memCell:(hasVal,hot)=>({
    background: hot?'#0f2a0f':hasVal?C.panelBg2:'#060d06',
    border:`1px solid ${hot?C.textBright:hasVal?C.border2:C.border}`,
    borderRadius:'2px',padding:'4px 3px',cursor:'pointer',
    transition:'all .1s',
  }),
  logOverlay:{position:'fixed',inset:0,background:'#020502ee',display:'flex',
              alignItems:'center',justifyContent:'center',zIndex:100},
  logBox:{background:C.panelBg,border:`1px solid #0d4a0d`,borderRadius:'4px',
          padding:'18px',width:'600px',maxWidth:'92vw'},
  ta:{width:'100%',height:'190px',background:'#030803',border:`1px solid ${C.border}`,
      color:'#00cc66',fontFamily:'inherit',fontSize:'11px',padding:'8px',
      resize:'vertical',boxSizing:'border-box',outline:'none'},
};

// ─────────────────────────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────────────────────────
export default function DMEDashboard() {
  const [logText, setLogText]   = useState('');
  const [logFileName, setLogFileName] = useState('');
  const [data, setData]         = useState({ snapshots:[], phases:[] });
  const [idx, setIdx]           = useState(0);
  const [tab, setTab]           = useState('overview');
  const [tooltip, setTooltip]   = useState(null);
  const [showLog, setShowLog]   = useState(true);
  const [playing, setPlaying]   = useState(false);
  const [playSpeed, setPlaySpeed] = useState(100); // ms between steps
  const logRef = useRef();

  // Playback engine
  useEffect(() => {
    if (!playing || data.snapshots.length === 0) return;
    const id = setInterval(() => {
      setIdx(i => {
        if (i >= data.snapshots.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, playSpeed);
    return () => clearInterval(id);
  }, [playing, playSpeed, data.snapshots.length]);

  useEffect(() => {
    const lnk = document.createElement('link');
    lnk.rel='stylesheet';
    lnk.href='https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@700;900&display=swap';
    document.head.appendChild(lnk);
  }, []);

  // Auto-load log from ?log=<url> query param.
  // The shell script starts a temporary CORS-enabled HTTP server
  // in the log directory and passes the full URL here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const logParam = params.get('log');
    if (!logParam) return;
    fetch(logParam)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => {
        const fname = logParam.split('/').pop();
        // Derive test name from filename: cl_tippy_in.dash.log → cl_tippy_in
        const testName = fname.replace(/\.dash\.log$/, '').replace(/\.log$/, '');
        document.title = `DME 951 — ${testName}`;
        setLogFileName(fname);
        setLogText(text);
        const parsed = parseLog(text);
        setData(parsed);
        setIdx(0);
        setPlaying(false);
        if (parsed.snapshots.length || parsed.phases.length) setShowLog(false);
      })
      .catch(err => console.warn('[DME951] ?log= fetch failed:', err));
  }, []);

  const handleLoad = useCallback(() => {
    const parsed = parseLog(logText);
    setData(parsed);
    setIdx(0);
    if (parsed.snapshots.length || parsed.phases.length) setShowLog(false);
  }, [logText]);

  // Drag-drop onto textarea
  const handleDrop = useCallback(e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setLogFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => setLogText(ev.target.result);
    reader.readAsText(file);
  }, []);

  const snap     = data.snapshots[idx] || { iram:{} };
  const iram     = snap.iram;
  const fuelMsV  = fuelMs(snap);
  const fuelNext = (((iram[0x4F]||0)<<8)|(iram[0x4E]||0))*2/1000;
  const load16   = ((iram[0x46]||0)<<8)|(iram[0x47]||0);
  const wu16     = ((iram[0x58]||0)<<8)|(iram[0x59]||0);
  const lmbd16   = ((iram[0x1B]||0)<<8)|(iram[0x1C]||0);

  const chartData = useMemo(() => {
    let lastCoolant = null, lastAir = null, lastAfm = null;
    return data.snapshots.map(s => {
      // Show 0ms when fuel is cut (FuelOffCoast = iram[23h].5)
      const fuel = ((s.iram[0x23] ?? 0) >> 5) & 1 ? 0 : +fuelMs(s).toFixed(3);
      // Use only reference-sensor RPM — null = gap in chart (pre-sync)
      const rpm  = s.refRpm ?? s.explicitRpm ?? null;
      // Temperature: carry forward last valid reading to bridge ADC-scan artifacts.
      const rawCoolant = ntcToC(s.iram[0x13]);
      const rawAir     = ntcToC(s.iram[0x12]);
      if (rawCoolant !== null) lastCoolant = rawCoolant;
      if (rawAir     !== null) lastAir     = rawAir;
      // AFM delta: difference from previous snapshot AFM value.
      // iram[53h] is always == iram[10h] at snapshot time so we compute it here.
      const afmNow   = s.iram[0x10] ?? null;
      const afmDelta = (afmNow !== null && lastAfm !== null) ? afmNow - lastAfm : 0;
      if (afmNow !== null) lastAfm = afmNow;
      return {
        t:         s.t,
        fuel,
        rpm,
        coolant:   lastCoolant,
        lmbdLn:    s.iram[0x19] ?? null,
        lmbdNln:   s.iram[0x1A] ?? null,
        isv:       s.iram[0x7F] ?? null,
        dwell:   rpm != null && rpm >= 40 && s.iram[0x2F] != null
                   ? +(s.iram[0x2F] * 60000 / (rpm * HT_PER_REV)).toFixed(2)
                   : null,
        afm:       afmNow,
        afm_delta: afmDelta,
        tps:       s.iram[0x16] ?? null,
      };
    });
  }, [data.snapshots]);

  // Min/max over all snapshots for the 8 top metrics
  const minmax = useMemo(() => {
    const mm = (fn, fmt) => {
      const vals = data.snapshots.map(fn).filter(v => v !== null && v !== undefined && !isNaN(v));
      if (!vals.length) return { mn:'--', mx:'--' };
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return { mn: fmt(lo), mx: fmt(hi) };
    };

    return {
      fuel:    mm(s => +fuelMs(s).toFixed(3),    v => v.toFixed(3)),
      rpm:     mm(s => snapRpm(s) || null,        v => v.toString()),
      isv:     mm(s => s.iram[0x7F]??null,        v => h2(v)),
      dwell:   mm(s => { const ht=s.iram[0x2F]; const r=s.refRpm??s.explicitRpm; return (ht!=null&&r>=40) ? +(ht*60000/(r*HT_PER_REV)).toFixed(2) : null; }, v=>`${v}ms`),
      coolant: mm(s => ntcToC(s.iram[0x13]),         v=>`${v}°C`),
      airtemp: mm(s => ntcToC(s.iram[0x12]),         v=>`${v}°C`),
      batt:    mm(s => s.iram[0x11]!=null ? +(s.iram[0x11]*0.05263+2.132).toFixed(1) : null, v=>`${v}V`),
      afm:     mm(s => s.iram[0x10]??null,        v => h2(v)),
      tps:     mm(s => s.iram[0x16]??null,        v => h2(v)),
      wdog:    mm(s => s.iram[0x2A]??null,        v => h2(v)),
    };
  }, [data.snapshots]);

  // True once any snapshot has FLAGS21.bit1 set — never goes false.
  // Prevents AFR display flickering from snapshot timing artifacts.
  const clEverActive = useMemo(() =>
    data.snapshots.some(s => ((s.iram[0x21] ?? 0) >> 1) & 1),
  [data.snapshots]);

  const TABS = ['overview','ports','iram','charts','phase','diag'];

  return (
    <div style={S.root}>
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={S.hdr}>
        <div>
          <div style={S.title}>▶ 89 DME 951 — SIMULATION DEBUG CONSOLE</div>
          <div style={S.sub}>BOSCH MOTRONIC · INTEL 8051 · PORSCHE 944 TURBO</div>
          {logFileName && (
            <div style={{color:'#66ddaa',fontSize:'10px',marginTop:'3px',
                         fontFamily:"'Courier New',monospace",letterSpacing:'0.05em'}}>
              📄 {logFileName}
            </div>
          )}
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:'8px',alignItems:'center'}}>
          {(data.snapshots.length>0||data.phases.length>0) && (
            <span style={{color:C.textDim,fontSize:'10px'}}>
              {data.snapshots.length} STATUS · {data.phases.length} PHASE
            </span>
          )}
          <button style={S.btn('s')} onClick={()=>setShowLog(true)}>LOAD LOG ▲</button>
        </div>
      </div>

      {/* ── TABS ───────────────────────────────────────────── */}
      <div style={S.tabBar}>
        {TABS.map(t=>(
          <button key={t} style={S.tab(tab===t)} onClick={()=>setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ────────────────────────────────────── */}
      <div style={S.content}>
        {tab==='overview' && <OverviewTab snap={snap} iram={iram}
          fuelMsV={fuelMsV} fuelNext={fuelNext} load16={load16} wu16={wu16} lmbd16={lmbd16}
          minmax={minmax} clEverActive={clEverActive} />}
        {tab==='ports'    && <PortsTab snap={snap} />}
        {tab==='iram'     && <IRAMTab iram={iram} tooltip={tooltip} setTooltip={setTooltip} />}
        {tab==='charts'   && <ChartsTab chartData={chartData} currentT={snap.t} />}
        {tab==='phase'    && <PhaseTab phases={data.phases} currentT={snap.t} />}
        {tab==='diag'     && <DiagTab iram={iram} snap={snap} />}
      </div>

      {/* ── TIME SCRUBBER + PLAYBACK ────────────────────────── */}
      {data.snapshots.length>0 && (
        <div style={S.scrubber}>
          {/* Play / Pause */}
          <button onClick={()=>setPlaying(p=>!p)}
            style={{...S.btn(playing?'p':'s'),minWidth:'60px',letterSpacing:'.05em',
                    boxShadow:playing?`0 0 8px ${C.textBright}44`:'none'}}>
            {playing ? '⏸ PAUSE' : '▶ PLAY'}
          </button>

          {/* Step back */}
          <button onClick={()=>{setPlaying(false);setIdx(i=>Math.max(0,i-1));}}
            style={{...S.btn('s'),padding:'5px 8px'}} title="Step back">◀</button>

          {/* Step forward */}
          <button onClick={()=>{setPlaying(false);setIdx(i=>Math.min(data.snapshots.length-1,i+1));}}
            style={{...S.btn('s'),padding:'5px 8px'}} title="Step forward">▶</button>

          {/* Rewind to start */}
          <button onClick={()=>{setPlaying(false);setIdx(0);}}
            style={{...S.btn('s'),padding:'5px 8px'}} title="Rewind">⏮</button>

          {/* Speed selector */}
          <select value={playSpeed} onChange={e=>{setPlaySpeed(+e.target.value);}}
            style={{background:C.panelBg,border:`1px solid ${C.border}`,color:C.textDim,
                    fontFamily:'inherit',fontSize:'9px',padding:'3px 4px',cursor:'pointer'}}>
            <option value={500}>0.2×</option>
            <option value={200}>0.5×</option>
            <option value={100}>1×</option>
            <option value={50}>2×</option>
            <option value={20}>5×</option>
            <option value={10}>10×</option>
            <option value={1}>MAX</option>
          </select>

          {/* Scrub slider */}
          <input type="range" min={0} max={data.snapshots.length-1} value={idx}
            onChange={e=>{setPlaying(false);setIdx(+e.target.value);}}
            style={{flex:1,accentColor:'#00cc66',cursor:'pointer'}} />

          {/* Time display */}
          <span style={{color:C.textBright,fontFamily:"'Orbitron',monospace",
                        fontSize:'14px',whiteSpace:'nowrap',minWidth:'90px',textAlign:'right',
                        textShadow:`0 0 8px ${C.textBright}66`}}>
            t={snap.t ?? '---'} ms
          </span>

          {/* Snapshot counter */}
          <span style={{color:C.textDim,fontSize:'9px',whiteSpace:'nowrap'}}>
            {idx+1}/{data.snapshots.length}
          </span>
        </div>
      )}

      {/* ── LOG INPUT MODAL ─────────────────────────────────── */}
      {showLog && (
        <div style={S.logOverlay}>
          <div style={S.logBox}>
            <div style={{color:C.textBright,fontSize:'13px',fontFamily:"'Orbitron',monospace",
                         letterSpacing:'0.08em',borderBottom:`1px solid #0d4a0d`,
                         paddingBottom:'10px',marginBottom:'12px'}}>
              ▶ LOAD SIMULATION LOG
            </div>
            <div style={{color:C.textDim,fontSize:'10px',marginBottom:'5px'}}>
              Paste your .log file below, or drag-and-drop the file onto the text area:
            </div>
            <textarea ref={logRef} style={S.ta} value={logText}
              onChange={e=>setLogText(e.target.value)}
              onDrop={handleDrop} onDragOver={e=>e.preventDefault()}
              placeholder={"[STATUS] t=1003 ms  prpm(37)=0x15  fuel_hb(4B)=0x03  fuel_lb(4A)=0xbb  ...\n[PHASE] t=569 ms  ENGINE SYNC\n...\n\nPaste your complete log (or a combined STATUS+PHASE file) here."}
            />
            <div style={{color:C.textDim,fontSize:'9px',marginTop:'4px',marginBottom:'14px'}}>
              Accepts full .log, _status.log, or _phase.log files
            </div>
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
              {(data.snapshots.length>0||data.phases.length>0) && (
                <button style={S.btn('s')} onClick={()=>setShowLog(false)}>CANCEL</button>
              )}
              <button style={S.btn('p')} onClick={handleLoad}>PARSE & LOAD →</button>
            </div>
          </div>
        </div>
      )}

      {/* ── IRAM TOOLTIP ────────────────────────────────────── */}
      {tooltip && <IRAMTooltip tip={tooltip} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────
function OverviewTab({ snap, iram, fuelMsV, fuelNext, load16, wu16, lmbd16, minmax, clEverActive }) {
  const f20=iram[0x20]??0, f21=iram[0x21]??0, f23=iram[0x23]??0,
        f24=iram[0x24]??0, f25=iram[0x25]??0;

  const prpm    = iram[0x37];
  const rpm     = snapRpm(snap);
  // Carry forward last valid temperature — raw ADC (0x20) briefly appears
  // in iram[0x12/13] mid-scan before linearisation; ignore those readings.
  const coolC   = ntcToC(iram[0x13]) ?? ntcToC(snap._prevCoolant);
  const airC    = ntcToC(iram[0x12]) ?? ntcToC(snap._prevAir);
  const dwHt    = iram[0x2F] ?? null;
  const dwDeg   = dwellHtToDeg(dwHt);
  const dwMs    = dwellHtToMs(dwHt, rpm);
  const mm      = minmax || {};

  // FuelOffCoast (bit1Dh = iram[23h].5) — fuel injection physically cut
  const fuelCut = ((iram[0x23] ?? 0) >> 5) & 1;
  // Show computed value in parens when cut, 0.000 as primary
  const fuelDisplay = fuelCut
    ? `0.000`
    : fuelMsV.toFixed(3);
  const fuelUnit = fuelCut
    ? `ms  (CUT — computed: ${fuelMsV.toFixed(3)}ms)`
    : 'ms';

  const battRaw = iram[0x11] ?? null;
  // Battery ADC calibration derived from dwell table behaviour:
  // 0xD8 = 13.5V (normal), 0x8C = 9.5V (low — firmware dwell matches ~10V TunerPro column)
  // Formula: V = raw × 0.05263 + 2.132  (offset divider, ~2.1V floor)
  const battV   = battRaw != null ? (battRaw * 0.05263 + 2.132).toFixed(1) : '--';
  const battCol = battRaw != null
    ? (battRaw < 0x98 ? C.red : battRaw < 0xB0 ? C.amber : C.textBright)
    : C.textDim;

  // Estimated lambda / AFR from closed-loop integrator
  // iram[0x1C:0x1B] = 16-bit lambda integrator, centred at 0x0080 = stoich
  // trim% = (integrator − 0x80) / 0x80 × 100
  // estimated AFR ≈ 14.7 × (1 + trim/100)
  // NOTE: narrowband sensor — this is the firmware's CL correction, not a real wideband reading
  const lmbLo  = iram[0x1B] ?? null;
  const lmbHi  = iram[0x1C] ?? null;
  const lmb16  = (lmbLo != null && lmbHi != null) ? (lmbHi << 8) | lmbLo : null;
  const o2Lean = ((iram[0x24] ?? 0) >> 3) & 1;
  const engSync   = ((iram[0x21] ?? 0) & 1) || (rpm != null && rpm > 100);
  const lmbTmrVal = iram[0x3E] ?? 255;
  const clBit     = ((iram[0x21] ?? 0) >> 1) & 1;
  // Use clEverActive (latched across all snapshots) to avoid flickering from
  // the crank interrupt transiently clearing FLAGS21.bit1 at snapshot time.
  const clActive  = clBit || (clEverActive && engSync && rpm != null && rpm > 100);
  let estLambda = null, estAFR = null, afrCol = C.textDim, afrLabel = '--';
  if (lmb16 != null && clActive) {
    const trim = (lmb16 - 0x80) / 0x80;
    estLambda = (1 + trim).toFixed(3);
    estAFR    = (14.7 * (1 + trim)).toFixed(2);
    afrCol    = lmb16 > 0x90 ? '#44aaff'   // lean — blue
              : lmb16 < 0x70 ? '#ff6644'   // rich — orange-red
              : '#66ffaa';                  // stoich — green
    afrLabel  = `λ${estLambda}`;
  } else if (fuelCut) {
    afrLabel = 'FUEL CUT';
    afrCol   = C.red;
  } else if (!clActive) {
    // Determine why open-loop: high load, warmup, or sensor fault
    const loadIdx = iram[0x49] ?? 0;
    if (!engSync)              { afrLabel = 'PRE-SYNC';   afrCol = C.textDim; }
    else if (lmbTmrVal > 0)    { afrLabel = 'WARMUP';     afrCol = C.amber;   }
    else if (loadIdx > 0x30)   { afrLabel = 'HIGH LOAD';  afrCol = C.amber;   }
    else                       { afrLabel = 'OPEN LOOP';  afrCol = C.textDim; }
  }

  const metrics = [
    { lbl:'FUEL PULSE',    val:fuelDisplay,                              unit:fuelUnit,      col:fuelCut?C.red:'#66ff66', mmk:'fuel'    },
    { lbl:'ENGINE SPEED',  val:rpm != null ? rpm : '---',              unit:'RPM',         col:C.textBright, mmk:'rpm' },
    { lbl:'ISV STEP',      val:h2(iram[0x7F]),                       unit:'hex',         col:'#ff44aa', mmk:'isv'     },
    { lbl:'DWELL',         val:`${dwMs}ms`,   unit:`${dwDeg??'--'}° / ${dwHt??'--'} ht`, col:'#ff8844', mmk:'dwell'   },
    { lbl:'COOLANT',       val:coolC!==null?`${coolC}°C`:'--',       unit:`0x${h2(iram[0x13])}`, col:C.blue, mmk:'coolant' },
    { lbl:'AIR TEMP',      val:airC !==null?`${airC}°C` :'--',       unit:`0x${h2(iram[0x12])}`, col:C.blue, mmk:'airtemp' },
    { lbl:'BATTERY',       val:`${battV}V`,                            unit:`0x${h2(iram[0x11])}`, col:battCol, mmk:'batt'   },
    { lbl:'EST. AFR',      val:estAFR ?? afrLabel,
                           unit:clActive ? `${afrLabel}  O2:${o2Lean?'LEAN':'RICH'}` : 'narrowband NB',
                           col:afrCol, mmk:null },
    { lbl:'AFM RAW (10h)',    val:h2(iram[0x10]),                       unit:'hex',         col:'#44cccc', mmk:'afm'     },
    { lbl:'AFM Prev (53h)',   val:h2(iram[0x53]),                       unit:'hex',         col:'#339999', mmk:null      },
    { lbl:'AFM Delta',        val:(iram[0x10]!=null&&iram[0x53]!=null) ? `+${iram[0x10]-iram[0x53]}` : '--', unit:'', col: (iram[0x10]??0)>(iram[0x53]??0) ? '#ff9944' : '#44cccc', mmk:null },
    { lbl:'Accel Enrich (4C)',val:h2(iram[0x4C]),                       unit:'hex',         col:'#ff9944', mmk:null      },
    { lbl:'TPS',           val:h2(iram[0x16]),                       unit:(iram[0x16]??0)>=0xD1?'CLOSED':(iram[0x16]??0)>=0x77?'WOT':'OPEN', col:(iram[0x16]??0)>=0xD1?'#44cccc':(iram[0x16]??0)>=0x77?C.red:C.amber, mmk:'tps' },
    { lbl:'WATCHDOG',      val:h2(iram[0x2A]),                       unit:'hex',         col:(iram[0x2A]??255)<5?C.red:C.textBright, mmk:'wdog' },
  ];

  const flags = [
    { name:'EngineSync',        val:(f21>>0)&1, col:'#66ffaa',  addr:'21h.0' },
    { name:'Phase2Lambda',      val:(f21>>1)&1, col:'#cc66ff',  addr:'21h.1' },
    { name:'UseMap1140',        val:(f21>>5)&1, col:'#44cccc',  addr:'21h.5' },
    { name:'ISVPWMOverflow',    val:(f20>>5)&1, col:'#ff88cc',  addr:'20h.5' },
    { name:'FuelOffCoast',      val:(f23>>5)&1, col:C.red,      addr:'23h.5' },
    { name:'O2 Lean',           val:(f24>>3)&1, col:C.amber,    addr:'24h.3' },
    { name:'LambdaOK',          val:(f24>>3)&1, col:'#cc66ff',  addr:'24h.3' },
    { name:'ColdStartTiming',   val:(f25>>4)&1, col:C.blue,     addr:'25h.4' },
    { name:'ColdStartEnrich',   val:(f25>>5)&1, col:C.blue,     addr:'25h.5' },
  ];

  const regs = [
    ['PRPM raw (37)',      h2(iram[0x37]),  `${rpm} RPM`],
    ['TPS (16)',          h2(iram[0x16]),  (iram[0x16]??0)>=0xD1?'IDLE/CLOSED':(iram[0x16]??0)>=0x77?'WOT':'PART LOAD'],
    ['FQS/Alt (17)',      h2(iram[0x17]),  (iram[0x17]??0)>=0x80?'PREMIUM FUEL':'REGULAR FUEL'],
    ['Batt V (11)',       h2(iram[0x11]),  iram[0x11] != null ? `${(iram[0x11]*0.05263+2.132).toFixed(1)}V` : '--'],
    ['DataPlug (3F)',     h2(iram[0x3F]),  `${iram[0x3F]??'--'}d`],
    ['Coolant (13)',      h2(iram[0x13]),  coolC !== null ? `${coolC}°C` : '--'],
    ['Air Temp (12)',     h2(iram[0x12]),  airC  !== null ? `${airC}°C`  : '--'],
    ['Dwell (2F)',        h2(iram[0x2F]),  `${dwMs}ms  (${dwDeg ?? '--'}° / ${dwHt??'--'}ht)`],
    ['IGN Next (32)',     h2(iram[0x32]),  `${iram[0x32]??'--'} ½-teeth`],
    ['AFM Peak (3D)',     h2(iram[0x3D]),  `${iram[0x3D]??'--'}d`],
    ['Subtask0 (3C)',     h2(iram[0x3C]),  'prescaler cdown'],
    ['Load 46:47',        '0x'+h4(load16), `${load16}d`],
    ['Load Idx (49)',     h2(iram[0x49]),  `map row ${iram[0x49]??'--'}`],
    ['Fuel HB:LB 4B:4A', `${h2(iram[0x4B])}:${h2(iram[0x4A])}`, `${fuelMsV.toFixed(3)} ms`],
    ['Fuel Next 4F:4E',  `${h2(iram[0x4F])}:${h2(iram[0x4E])}`, `${fuelNext.toFixed(3)} ms`],
    ['Accel Enrich (4C)',h2(iram[0x4C]),  `${iram[0x4C]??'--'}d`],
    ['Map1140 Idx (4D)', h2(iram[0x4D]),  `${iram[0x4D]??'--'}d`],
    ['WU Counter 58:59', '0x'+h4(wu16),   `${wu16}d`],
    ['Lmbd Unc (18)',     h2(iram[0x18]),  `${iram[0x18]??'--'}d`],
    ['Lmbd Lean (19)',    h2(iram[0x19]),  `${iram[0x19]??'--'}d`],
    ['Lmbd !Lean (1A)',   h2(iram[0x1A]),  `${iram[0x1A]??'--'}d`],
    ['Lmbd Int 1B:1C',   '0x'+h4(lmbd16), `${lmbd16}d`],
    ['Lmbd Timer (3E)',   h2(iram[0x3E]),  `${iram[0x3E]??'--'}d`],
    ['Flags (20)',        h2(iram[0x20]),  b8(iram[0x20])],
    ['Flags (21)',        h2(iram[0x21]),  b8(iram[0x21])],
    ['Flags (23)',        h2(iram[0x23]),  b8(iram[0x23])],
    ['Flags (24)',        h2(iram[0x24]),  b8(iram[0x24])],
    ['Flags (25)',        h2(iram[0x25]),  b8(iram[0x25])],
  ];

  return (
    <div>
      {/* Big metrics row */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:'6px',marginBottom:'10px'}}>
        {metrics.map(m=>{
          const mmv = mm[m.mmk] || {};
          return (
            <div key={m.lbl} style={S.metric}>
              <div style={S.metricLbl}>{m.lbl}</div>
              <div style={{...S.metricVal,color:m.col,fontSize:'15px',lineHeight:'1.2',margin:'3px 0'}}>
                {m.val}
              </div>
              <div style={S.metricUnit}>{m.unit}</div>
              {(mmv.mn !== '--' || mmv.mx !== '--') && (
                <div style={{
                  display:'flex',justifyContent:'space-between',
                  marginTop:'5px',paddingTop:'4px',borderTop:`1px solid ${C.border}`,
                  fontSize:'9px',
                }}>
                  <span style={{color:'#33aaff'}}>▼{mmv.mn??'--'}</span>
                  <span style={{color:C.textDim,fontSize:'8px'}}>min/max</span>
                  <span style={{color:'#ff8844'}}>▲{mmv.mx??'--'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 240px',gap:'10px'}}>
        {/* Key registers table */}
        <div style={S.panel}>
          <div style={S.panelTitle}>ALL KEY REGISTERS</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1px'}}>
            {regs.map(([lbl,val,det])=>(
              <div key={lbl} style={{display:'flex',justifyContent:'space-between',
                                     padding:'3px 6px',borderBottom:`1px solid ${C.border}`}}>
                <span style={{color:C.textDim,fontSize:'10px'}}>{lbl}</span>
                <span style={{color:C.textBright}}>
                  {val} <span style={{color:C.textDim,fontWeight:'normal',fontSize:'10px'}}>({det})</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Control flags */}
        <div style={S.panel}>
          <div style={S.panelTitle}>CONTROL FLAGS</div>
          {flags.map(f=>(
            <div key={f.name+f.addr} style={{
              display:'flex',alignItems:'center',gap:'8px',
              padding:'4px 6px',marginBottom:'2px',
              borderLeft:`3px solid ${f.val?f.col:'#1a2e1a'}`,
              background:f.val?'#0a1f0a':'#070e07',
            }}>
              <span style={{
                width:'10px',height:'10px',borderRadius:'50%',flexShrink:0,
                background:f.val?f.col:'transparent',
                border:`1px solid ${f.val?f.col:'#1a3a1a'}`,
                boxShadow:f.val?`0 0 6px ${f.col}`:'none',
                display:'inline-block',
              }}/>
              <span style={{color:f.val?f.col:'#335533',fontSize:'10px',flex:1}}>{f.name}</span>
              <span style={{color:C.textDim,fontSize:'9px'}}>{f.addr}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  PORTS TAB
// ─────────────────────────────────────────────────────────────────
function PortsTab({ snap }) {
  const portVals = {
    P1: snap?.p1,
    P2: snap?.p2,
    P3: snap?.p3,
  };
  const hasLive = snap?.p1 !== undefined;
  const portDescs = {
    P1: 'ANALOG I/O — injector, ignition, O2 sensor',
    P2: 'ADDRESS BUS / ADC CHANNEL SELECT',
    P3: 'CRANK SENSORS · SERIAL · /RD /WR STROBES',
  };
  return (
    <div>
      {!hasLive && (
        <div style={{color:C.amber,fontSize:'10px',marginBottom:'8px',
                     padding:'6px 10px',border:`1px solid ${C.amber}44`,
                     background:'#1a1000'}}>
          ⚠ Live port values require the new [DS] log format from i8051_dashboard_tb.v
          — legacy [STATUS] logs show pin definitions only.
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px'}}>
        {Object.entries(PORT_DEFS).map(([pName,bits])=>{
          const portByte = portVals[pName];
          const hasVal   = portByte !== undefined;
          return (
            <div key={pName} style={S.panel}>
              <div style={S.panelTitle}>
                {pName} — {portDescs[pName]}
                {hasVal && (
                  <span style={{marginLeft:'10px',color:C.textBright,
                                fontFamily:"'Orbitron',monospace",fontSize:'11px'}}>
                    0x{h2(portByte)} &nbsp; {b8(portByte)}
                  </span>
                )}
              </div>
              {bits.map(b=>{
                const bitVal = hasVal ? ((portByte >> b.bit) & 1) : null;
                const isSet  = bitVal === 1;
                const dirCol = b.dir==='IN' ? C.blue : b.dir==='OUT' ? '#66ffaa' : C.amber;
                return (
                  <div key={b.bit} style={{
                    display:'grid',
                    gridTemplateColumns:'24px 24px 80px 1fr',
                    gap:'6px',alignItems:'center',
                    padding:'4px 6px',borderBottom:`1px solid ${C.border}`,
                    background: isSet ? '#0a1a0a' : 'transparent',
                  }}>
                    <span style={{color:C.textDim,fontSize:'9px'}}>
                      {pName}.{b.bit}
                    </span>
                    {/* Live bit indicator */}
                    <span style={{
                      width:'18px',height:'18px',lineHeight:'18px',
                      textAlign:'center',borderRadius:'2px',
                      fontSize:'12px',fontWeight:'bold',display:'inline-block',
                      background: bitVal===null ? 'transparent'
                                : isSet ? `${dirCol}33` : '#080f08',
                      color:       bitVal===null ? C.textDim
                                : isSet ? dirCol : '#335533',
                      border:`1px solid ${bitVal===null ? C.border
                                        : isSet ? dirCol : '#1a3a1a'}`,
                      boxShadow: isSet ? `0 0 5px ${dirCol}66` : 'none',
                    }}>
                      {bitVal === null ? '?' : bitVal}
                    </span>
                    <span style={{
                      padding:'1px 4px',fontSize:'8px',borderRadius:'2px',
                      background: b.dir==='IN'?'#0a1a2a':b.dir==='OUT'?'#0a1f0a':'#1a1a0a',
                      color: dirCol, textAlign:'center',whiteSpace:'nowrap',
                    }}>{b.dir}</span>
                    <div>
                      <span style={{color:isSet?dirCol:'#00cc66',fontSize:'10px',
                                    fontWeight:'bold'}}>{b.name}</span>
                      <span style={{color:C.textDim,fontSize:'9px',
                                    marginLeft:'6px',lineHeight:'1.4'}}>{b.desc}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  IRAM MAP TAB  — sub-tabs per category
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
//  8051 BIT ADDRESS LABELS  (bit 0x00–0x7F = iram[20h..2Fh] bits)
//  bit_addr = (byte - 0x20) * 8 + bit_position
// ─────────────────────────────────────────────────────────────────
const BIT_LABELS = {
  // iram[20h] = bits 00h..07h
  0x00:'',0x01:'',0x02:'',0x03:'',
  0x05:'UseMap1140',   // 21h.5
  0x05:'ISVPWMOverflow', // 20h.5
  0x06:'',0x07:'',
  // iram[21h] = bits 08h..0Fh
  0x08:'EngineSync',   // 21h.0
  0x09:'Phase2Lambda', // 21h.1
  0x0A:'',0x0B:'',0x0C:'',0x0D:'',0x0E:'',0x0F:'',
  // iram[22h] = bits 10h..17h
  0x10:'',0x11:'',0x12:'',0x13:'',0x14:'',0x15:'',0x16:'',0x17:'',
  // iram[23h] = bits 18h..1Fh
  0x18:'',0x19:'',0x1A:'',0x1B:'',0x1C:'',
  0x1D:'FuelOffCoast', // 23h.5
  0x1E:'',0x1F:'TXDLambdaDiag',
  // iram[24h] = bits 20h..27h
  0x20:'LambdaFlag20', // 24h.0
  0x21:'LambdaFlag21',
  0x22:'LambdaFlag22',
  0x23:'O2Lean/LambdaOK', // 24h.3
  0x24:'',0x25:'',0x26:'',0x27:'',
  // iram[25h] = bits 28h..2Fh
  0x28:'',0x29:'',0x2A:'',0x2B:'',
  0x2C:'ColdStartTiming', // 25h.4
  0x2D:'ColdStartEnrich',  // 25h.5
  0x2E:'',0x2F:'',
  // iram[26h] = bits 30h..37h
  0x30:'',0x31:'',0x32:'',0x33:'',0x34:'',0x35:'',0x36:'',0x37:'DataPlug',
  // iram[27h..2Fh] = bits 38h..7Fh (mostly unnamed)
};

const IRAM_SUBTABS = [
  { key:'all',     label:'ALL',        groups: null }, // null = show all
  { key:'adc',     label:'ADC INPUTS', groups: ['adc'] },
  { key:'fuel',    label:'FUEL/LOAD',  groups: ['fuel'] },
  { key:'ign',     label:'IGNITION',   groups: ['ign'] },
  { key:'lambda',  label:'LAMBDA',     groups: ['lambda'] },
  { key:'flags',   label:'FLAGS',      groups: ['flags'] },
  { key:'rpm',     label:'RPM/CRANK',  groups: ['rpm','timer'] },
  { key:'enrich',  label:'ENRICH/ISV', groups: ['enrich','isv'] },
  { key:'sys',     label:'SYSTEM',     groups: ['sys','reg'] },
  { key:'misc',    label:'WORK AREA',  groups: ['misc'] },
];

function IRAMTab({ iram, tooltip, setTooltip }) {
  const [sub, setSub] = useState('all');
  const subDef  = IRAM_SUBTABS.find(t=>t.key===sub) || IRAM_SUBTABS[0];
  const entries = subDef.groups
    ? IRAM_MAP.filter(e => subDef.groups.includes(e.g))
    : IRAM_MAP;

  const isAll = sub === 'all';

  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{display:'flex',gap:'2px',flexWrap:'wrap',marginBottom:'8px'}}>
        {IRAM_SUBTABS.map(t => {
          const groupCol = t.groups ? (GROUPS[t.groups[0]]?.color || C.textDim) : C.textBright;
          const active   = sub === t.key;
          return (
            <button key={t.key} onClick={()=>setSub(t.key)} style={{
              padding:'3px 10px',cursor:'pointer',fontFamily:'inherit',
              fontSize:'10px',letterSpacing:'0.08em',border:'none',outline:'none',
              background: active ? `${groupCol}22` : 'transparent',
              color: active ? groupCol : C.textDim,
              borderBottom: active ? `2px solid ${groupCol}` : '2px solid transparent',
              transition:'all .12s',
            }}>{t.label}</button>
          );
        })}
      </div>

      {/* ALL view — compact hex grid */}
      {isAll && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(16,1fr)',gap:'3px',marginBottom:'3px'}}>
            {Array.from({length:16},(_,i)=>(
              <div key={i} style={{textAlign:'center',color:C.textDim,fontSize:'8px'}}>+{i.toString(16).toUpperCase()}</div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(16,1fr)',gap:'3px'}}>
            {IRAM_MAP.map(entry=>{
              const val    = iram[entry.a];
              const hasVal = val !== undefined;
              const hot    = tooltip?.a === entry.a;
              const col    = GROUPS[entry.g]?.color || C.textDim;
              return (
                <div key={entry.a} style={S.memCell(hasVal,hot)}
                  onMouseEnter={()=>setTooltip({...entry,val})}
                  onMouseLeave={()=>setTooltip(null)}>
                  <span style={{color:C.textDim,fontSize:'8px',display:'block'}}>
                    {entry.a.toString(16).toUpperCase().padStart(2,'0')}h
                  </span>
                  <span style={{color:hasVal?C.textBright:'#335533',fontSize:'11px',
                                display:'block',fontWeight:'bold',lineHeight:'1.2'}}>
                    {hasVal?h2(val):'--'}
                  </span>
                  <span style={{color:col,fontSize:'7px',display:'block',overflow:'hidden',
                                whiteSpace:'nowrap',textOverflow:'ellipsis'}}>
                    {entry.n}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{color:C.textDim,fontSize:'9px',marginTop:'8px',textAlign:'right'}}>
            hover any cell for full description
          </div>
        </div>
      )}

      {/* DETAIL view — table per category */}
      {!isAll && (
        <div style={S.panel}>
          <div style={S.panelTitle}>
            {subDef.label} — {entries.length} locations
            {subDef.groups && (
              <span style={{marginLeft:'8px'}}>
                {subDef.groups.map(g=>(
                  <span key={g} style={{color:GROUPS[g]?.color,marginRight:'8px',fontSize:'9px'}}>
                    ● {GROUPS[g]?.label}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div style={{overflowX:'auto'}}>
            {/* FLAGS sub-tab: expand each byte into 8 individual bit rows */}
            {sub === 'flags' ? (
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${C.border2}`}}>
                    {['BIT ADDR','BYTE','BIT','NAME','VAL','DESCRIPTION'].map(h=>(
                      <th key={h} style={{color:C.textDim,fontSize:'9px',letterSpacing:'0.15em',
                        padding:'4px 8px',textAlign:'left',fontWeight:'normal',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.flatMap((entry, ei) => {
                    const val    = iram[entry.a];
                    const hasVal = val !== undefined;
                    const col    = GROUPS[entry.g]?.color || C.textDim;
                    // 8051 bit address for RAM byte B, bit N = B*8 + N (for bytes 0x20-0x2F)
                    const byteAddr = entry.a;
                    return Array.from({length:8}, (_,n) => {
                      const bitN    = 7 - n;             // show bit7 at top
                      const bitAddr = (byteAddr - 0x20) * 8 + bitN; // 8051 bit address
                      const bitVal  = hasVal ? ((val >> bitN) & 1) : null;
                      const isSet   = bitVal === 1;
                      const rowBg   = isSet ? '#0a1f0a' : (n%2===0 ? C.panelBg : C.panelBg2);
                      // Named bit labels from known firmware definitions
                      const bitLabel = BIT_LABELS[bitAddr] || '';
                      return (
                        <tr key={`${entry.a}-${bitN}`}
                          style={{background:rowBg,borderBottom:`1px solid ${C.border}`}}>
                          <td style={{padding:'3px 8px',color:C.textDim,whiteSpace:'nowrap',fontSize:'10px'}}>
                            {bitAddr >= 0 ? `bit${bitAddr.toString(16).toUpperCase().padStart(2,'0')}h` : '--'}
                          </td>
                          <td style={{padding:'3px 8px',color:col,whiteSpace:'nowrap',fontSize:'10px'}}>
                            {entry.a.toString(16).toUpperCase().padStart(2,'0')}h.{bitN}
                          </td>
                          <td style={{padding:'3px 8px',color:C.textDim,whiteSpace:'nowrap',fontSize:'10px'}}>
                            bit {bitN}
                          </td>
                          <td style={{padding:'3px 8px',color:isSet?col:C.textDim,
                                      fontWeight:isSet?'bold':'normal',whiteSpace:'nowrap'}}>
                            {bitLabel || '—'}
                          </td>
                          <td style={{padding:'3px 8px',whiteSpace:'nowrap'}}>
                            <span style={{
                              display:'inline-block',width:'20px',height:'20px',lineHeight:'20px',
                              textAlign:'center',borderRadius:'2px',fontWeight:'bold',fontSize:'13px',
                              background: bitVal===null?'transparent': isSet?`${col}33`:'#0a0f0a',
                              color:       bitVal===null?C.textDim   : isSet?col       :'#335533',
                              border:`1px solid ${bitVal===null?C.border:isSet?col:'#1a3a1a'}`,
                              boxShadow:   isSet?`0 0 6px ${col}55`:'none',
                            }}>{bitVal === null ? '?' : bitVal}</span>
                          </td>
                          <td style={{padding:'3px 8px',color:C.textDim,fontSize:'10px',lineHeight:'1.4'}}>
                            {bitLabel ? entry.d : <span style={{color:'#224422'}}>—</span>}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            ) : (
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${C.border2}`}}>
                  {['ADDR','NAME','HEX','DEC','BIN','DESCRIPTION'].map(h=>(
                    <th key={h} style={{
                      color:C.textDim,fontSize:'9px',letterSpacing:'0.15em',
                      padding:'4px 8px',textAlign:'left',fontWeight:'normal',
                      whiteSpace:'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry,i)=>{
                  const val    = iram[entry.a];
                  const hasVal = val !== undefined;
                  const col    = GROUPS[entry.g]?.color || C.textDim;
                  const rowBg  = i%2===0 ? C.panelBg : C.panelBg2;
                  let derived = '';
                  if (entry.a === 0x12 || entry.a === 0x13) {
                    if (hasVal) derived = ` (${Math.round(val*0.875-116)}°C)`;
                  }
                  if (entry.a === 0x16 && hasVal) {
                    derived = val>=0xD1?' (CLOSED/IDLE)':val>=0x77?' (WOT)':' (PART LOAD)';
                  }
                  if (entry.a === 0x2F && hasVal) {
                    derived = ` (${val}°)`;
                  }
                  if (entry.a === 0x4A || entry.a === 0x4B) {
                    const hb = iram[0x4B]??0, lb = iram[0x4A]??0;
                    const ms = ((hb<<8)|lb)*2/1000;
                    derived = ` → ${ms.toFixed(3)}ms pulse`;
                  }
                  return (
                    <tr key={entry.a}
                      style={{background:rowBg,borderBottom:`1px solid ${C.border}`}}
                      onMouseEnter={()=>setTooltip({...entry,val})}
                      onMouseLeave={()=>setTooltip(null)}>
                      <td style={{padding:'4px 8px',color:C.textDim,whiteSpace:'nowrap'}}>
                        <span style={{color:col}}>0x{entry.a.toString(16).toUpperCase().padStart(2,'0')}</span>
                      </td>
                      <td style={{padding:'4px 8px',color:col,fontWeight:'bold',whiteSpace:'nowrap'}}>
                        {entry.n}
                      </td>
                      <td style={{padding:'4px 8px',color:hasVal?C.textBright:'#335533',
                                  fontWeight:'bold',whiteSpace:'nowrap'}}>
                        {hasVal ? `0x${h2(val)}` : '--'}
                        <span style={{color:C.textDim,fontWeight:'normal',fontSize:'10px'}}>{derived}</span>
                      </td>
                      <td style={{padding:'4px 8px',color:hasVal?C.textDim:'#224422',whiteSpace:'nowrap'}}>
                        {hasVal ? val : '--'}
                      </td>
                      <td style={{padding:'4px 8px',color:hasVal?'#336633':'#1a2e1a',
                                  fontSize:'10px',whiteSpace:'nowrap',letterSpacing:'0.05em'}}>
                        {hasVal ? b8(val) : '--------'}
                      </td>
                      <td style={{padding:'4px 8px',color:C.textDim,fontSize:'10px',lineHeight:'1.4'}}>
                        {entry.d}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        </div>
      )}

      {/* Tooltip overlay (used in both views) */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  IRAM TOOLTIP OVERLAY
// ─────────────────────────────────────────────────────────────────
function IRAMTooltip({ tip }) {
  const col = GROUPS[tip.g]?.color || C.textDim;
  return (
    <div style={{
      position:'fixed',bottom:'70px',left:'50%',transform:'translateX(-50%)',
      background:'#060e06',border:`1px solid ${col}`,borderRadius:'4px',
      padding:'10px 16px',zIndex:50,maxWidth:'480px',pointerEvents:'none',
      boxShadow:`0 0 16px ${col}33`,
    }}>
      <div style={{color:col,fontSize:'9px',letterSpacing:'0.2em',marginBottom:'2px'}}>
        {GROUPS[tip.g]?.label?.toUpperCase()} — {tip.g.toUpperCase()}
      </div>
      <div style={{color:C.textBright,fontSize:'14px',fontWeight:'bold',marginBottom:'4px'}}>
        [{tip.a.toString(16).toUpperCase().padStart(2,'0')}h]&nbsp;&nbsp;{tip.n}
      </div>
      <div style={{color:C.textDim,fontSize:'11px',lineHeight:'1.5'}}>{tip.d}</div>
      {tip.val !== undefined && (
        <div style={{color:C.textBright,fontSize:'12px',marginTop:'6px',
                     borderTop:`1px solid ${C.border}`,paddingTop:'6px',
                     display:'flex',gap:'16px'}}>
          <span>hex: 0x{h2(tip.val)}</span>
          <span>dec: {tip.val}</span>
          <span>bin: {b8(tip.val)}</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  CHARTS TAB
// ─────────────────────────────────────────────────────────────────
function ChartsTab({ chartData, currentT }) {
  if (!chartData.length) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'14px'}}>
      No STATUS data loaded — use LOAD LOG to parse a log file
    </div>
  );

  const ax = {fill:C.textDim,fontSize:10,fontFamily:"'Share Tech Mono',monospace"};
  const charts = [
    {title:'INJECTION PULSE WIDTH',  k:'fuel',    col:'#66ff66', unit:'ms',      dom:[0,'auto']},
    {title:'ENGINE SPEED (RPM)',     k:'rpm',     col:C.textBright,unit:'RPM',   dom:[0,'auto']},
    {title:'AFM RAW (10h)',          k:'afm',     col:'#44cccc', unit:'hex',     dom:[0,255]},
    {title:'AFM DELTA (snapshot)',   k:'afm_delta',col:'#ff9944', unit:'Δhex',   dom:['auto','auto']},
    {title:'TPS RAW (16h)',          k:'tps',     col:'#ffcc44', unit:'hex',     dom:[0,255]},
    {title:'ISV STEP POSITION',      k:'isv',     col:'#ff44aa', unit:'hex',     dom:[0,255]},
    {title:'LAMBDA ADJ — LEAN (19)', k:'lmbdLn',  col:'#cc66ff', unit:'hex',     dom:[0,255]},
    {title:'DWELL TIME (2F)',         k:'dwell',   col:'#ff8844', unit:'ms', dom:[0,'auto']},
    {title:'COOLANT TEMP (13)',      k:'coolant', col:C.blue,    unit:'°C',      dom:[-20,120]},
  ];

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
      {charts.map(c=>(
        <div key={c.k} style={S.panel}>
          <div style={S.panelTitle}>{c.title}</div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={chartData} margin={{top:2,right:8,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d" />
              <XAxis dataKey="t" tick={ax} tickFormatter={v=>`${v}ms`} stroke={C.textDim} />
              <YAxis tick={ax} domain={c.dom} stroke={C.textDim} />
              <Tooltip
                contentStyle={{background:'#060e06',border:`1px solid ${c.col}55`,
                               color:c.col,fontSize:'11px',fontFamily:'inherit'}}
                formatter={v=>[v,c.unit]}
                labelFormatter={t=>`t=${t} ms`}
              />
              {currentT !== undefined &&
                <ReferenceLine x={currentT} stroke={C.textDim} strokeDasharray="3 3" />}
              <Line type="monotone" dataKey={c.k} stroke={c.col}
                    dot={false} strokeWidth={1.5} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  PHASE EVENTS TAB
// ─────────────────────────────────────────────────────────────────
function PhaseTab({ phases, currentT }) {
  if (!phases.length) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'14px'}}>
      No PHASE data loaded — paste a _phase.log or full .log file
    </div>
  );

  const maxT = phases[phases.length-1]?.t || 1;
  const pctT = currentT !== undefined ? (currentT / maxT) * 100 : null;

  return (
    <div>
      {/* Timeline bar */}
      <div style={{...S.panel,padding:'10px'}}>
        <div style={S.panelTitle}>EVENT TIMELINE — {phases.length} events  (hover for label)</div>
        <div style={{position:'relative',height:'36px',background:'#040904',
                     borderRadius:'2px',overflow:'hidden',border:`1px solid ${C.border}`}}>
          {phases.map((p,i)=>(
            <div key={i} title={`${p.t}ms — ${p.msg}`} style={{
              position:'absolute',
              left:`${(p.t/maxT)*100}%`,
              top:0,width:'2px',height:'100%',
              background: PHASE_COLORS[p.category]||'#888',
              opacity:0.85,cursor:'pointer',
            }}/>
          ))}
          {pctT !== null && (
            <div style={{
              position:'absolute',left:`${pctT}%`,top:0,
              width:'1px',height:'100%',
              background:C.textBright,boxShadow:`0 0 5px ${C.textBright}`,
            }}/>
          )}
        </div>
        {/* Category legend */}
        <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'8px'}}>
          {Object.entries(PHASE_COLORS).map(([k,col])=>(
            <span key={k} style={{fontSize:'9px',color:col,letterSpacing:'0.05em'}}>
              ▌ {k.toUpperCase()}
            </span>
          ))}
        </div>
      </div>

      {/* Event list */}
      <div style={S.panel}>
        <div style={S.panelTitle}>ALL EVENTS</div>
        <div style={{maxHeight:'420px',overflow:'auto'}}>
          {phases.map((p,i)=>{
            const past = currentT === undefined || p.t <= currentT;
            const col  = PHASE_COLORS[p.category]||'#888';
            return (
              <div key={i} style={{
                display:'flex',alignItems:'baseline',gap:'10px',
                padding:'4px 8px',marginBottom:'1px',
                borderLeft:`3px solid ${past?col:'#1a2e1a'}`,
                background: past?C.panelBg:'#050c05',
              }}>
                <span style={{
                  color: past?col:C.textDim,
                  fontFamily:"'Orbitron',monospace",fontSize:'10px',
                  minWidth:'72px',whiteSpace:'nowrap',
                }}>{p.t} ms</span>
                <span style={{color:past?col:C.textDim,fontSize:'11px'}}>{p.msg}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── DiagTab ───────────────────────────────────────────────────────
// Reconstructs the send_diag_p2 diagnostic stream from current iram
// values, showing what the DME would output on each P2 page.
//
// Routine at 0x1E00 — confirmed from ROM disassembly:
//   P2=0x19  MOVX @R0, iram[0x1B]              → LMB_LO raw
//   P2=0x1B  MOVX @R0, (iram[0x31]+0x0A)<<1    → IGN_ADV transformed
//   P2=0x1C  MOVX @R0, iram[0x37]              → PRPM
//   P2=0x1D  MOVX @R0, iram[0x49]              → LOAD_IX
//   P2=0x1E  MOVX @R0, iram[0x10]              → AFM_RAW
//   P2=0x1F  MOVX @R0, iram[0x13]              → COOLANT
//   P2=0x98  MOVX @R0, lambda_state_2bit        → computed
//
function DiagTab({ iram, snap }) {
  const ir = iram || {};

  // Use the authoritative RPM from the DS header (refRpm) rather than
  // iram[0x37] raw — PRPM gets updated mid-crank-cycle so the 100ms
  // snapshot often catches a stale or intermediate value.
  const refRpm   = snap?.refRpm ?? snap?.explicitRpm ?? null;
  const prpm     = ir[0x37] ?? 0;
  // For the transmitted byte the firmware sends iram[0x37] directly
  const prpmTx   = prpm;

  // Compute transmitted byte for each channel exactly as firmware does
  const lmbLo   = ir[0x1B] ?? 0;
  const lmbHi   = ir[0x1C] ?? 0;
  const lmb16   = (lmbHi << 8) | lmbLo;
  const ignAdv  = ir[0x31] ?? 0;
  const loadIdx = ir[0x49] ?? 0;
  const afmRaw  = ir[0x10] ?? 0;
  const coolant = ir[0x13] ?? 0;

  // P2=0x1B: ADD A,#0x0A then RL A (rotate left = ×2, wrapping 8-bit)
  const ignAdvTx = ((ignAdv + 0x0A) << 1) & 0xFF;

  // P2=0x98: CPL A, INC A, ADD A,iram[1B], RL, RL, MOV R0,A
  //          MOV A,iram[1C], RLC, RLC, RLC, ANL #0x03
  // This encodes the lambda integrator as a 2-bit state:
  //   offset = -(0x60) + lmb16, shift left 2, take bits[7:6] → 2-bit value
  const lmbOffset = (lmb16 - 0x60) & 0xFFFF;
  const lmbState  = (lmbOffset >> 6) & 0x03;
  const LMBD_STATES = ['Stoich / closed-loop centre', 'Lean correction active', 'Rich correction active', 'Max correction'];

  // RPM decode
  const rpm = prpm >= 3 ? Math.round(17640 / prpm) : 0;

  // Coolant decode (linearised → °C approx)
  const coolC = Math.round(coolant * 0.875 - 116);

  // Lambda integrator decode (0x80 = stoich centre)
  const lmbSigned = lmbLo - 0x80;
  const lmbPct = (lmbSigned / 0x80 * 100).toFixed(1);

  const CHANNELS = [
    {
      p2: '0x19', name: 'LAMBDA INTEGRATOR', src: 'iram[0x1B]  LMB_LO',
      raw: lmbLo, tx: lmbLo,
      decode: `${lmbLo === 0x80 ? 'Stoich (centred)' : lmbLo > 0x80 ? `Rich offset +${(lmbLo-0x80)}` : `Lean offset ${lmbLo-0x80}`}  (0x80=λ1.0)`,
      col: '#cc66ff',
      detail: `16-bit integrator: 0x${h2(lmbHi)}:${h2(lmbLo)} = ${lmb16}  |  correction: ${lmbPct}%`,
    },
    {
      p2: '0x1B', name: 'IGNITION ADVANCE', src: 'iram[0x31]  IGN_ADV',
      raw: ignAdv, tx: ignAdvTx,
      decode: `${ignAdv}° BTDC base  →  tx=(${ignAdv}+10)×2=${ignAdvTx}  |  KLR may retard further`,
      col: '#ff8844',
      detail: `Ignition duration: iram[0x30]=0x${h2(ir[0x30]??0)} (${ir[0x30]??0} half-teeth)`,
    },
    {
      p2: '0x1C', name: 'ENGINE SPEED (PRPM)', src: 'iram[0x37]  PRPM',
      raw: prpm, tx: prpmTx,
      decode: refRpm != null
        ? `${refRpm} RPM  (from DS header)  |  iram[0x37]=0x${h2(prpm)} raw`
        : prpm >= 3 ? `${Math.round(17640 / prpm)} RPM  (17640 / ${prpm})` : 'Engine not running',
      col: '#66ffaa',
      detail: `Previous PRPM: iram[0x3B]=0x${h2(ir[0x3B]??0)}`,
    },
    {
      p2: '0x1D', name: 'LOAD INDEX', src: 'iram[0x49]  LOAD_IX',
      raw: loadIdx, tx: loadIdx,
      decode: `Row ${loadIdx} (0x${h2(loadIdx)}) in fuel map  |  load acc: 0x${h2(ir[0x46]??0)}${h2(ir[0x47]??0)}`,
      col: '#aaffaa',
      detail: `Fuel pulse: 0x${h2(ir[0x4B]??0)}:${h2(ir[0x4A]??0)} = ${(((ir[0x4B]||0)<<8|(ir[0x4A]||0))*2/1000).toFixed(3)}ms`,
    },
    {
      p2: '0x1E', name: 'AFM RAW', src: 'iram[0x10]  AFM_RAW',
      raw: afmRaw, tx: afmRaw,
      decode: `0x${h2(afmRaw)} = ${afmRaw}d  |  prev: iram[0x53]=0x${h2(ir[0x53]??0)}  delta: ${afmRaw-(ir[0x53]??afmRaw)>=0?'+':''}${afmRaw-(ir[0x53]??afmRaw)}`,
      col: '#44cccc',
      detail: `TPS: iram[0x16]=0x${h2(ir[0x16]??0)}  ${(ir[0x16]??0)>=0xD1?'CLOSED':(ir[0x16]??0)>=0x77?'WOT':'PART THROTTLE'}`,
    },
    {
      p2: '0x1F', name: 'COOLANT TEMP', src: 'iram[0x13]  COOLANT',
      raw: coolant, tx: coolant,
      decode: `0x${h2(coolant)} → ${coolC}°C  |  air temp: iram[0x12]=0x${h2(ir[0x12]??0)} → ${Math.round((ir[0x12]??0)*0.875-116)}°C`,
      col: '#44aaff',
      detail: `Cold start enrich: ${(ir[0x25]??0)>>5&1?'ACTIVE':'off'}  cold timing: ${(ir[0x25]??0)>>4&1?'ACTIVE':'off'}`,
    },
    {
      p2: '0x98', name: 'LAMBDA STATE (computed)', src: 'f(iram[0x1C:0x1B])',
      raw: lmb16, tx: lmbState,
      decode: `${lmbState} — ${LMBD_STATES[lmbState]}`,
      col: '#cc66ff',
      detail: `Derived: (0x${lmb16.toString(16).padStart(4,'0').toUpperCase()} − 0x60) << 2, bits[7:6]`,
    },
  ];

  return (
    <div>
      <div style={{...S.panel, marginBottom:'8px'}}>
        <div style={S.panelTitle}>SEND_DIAG_P2 — DIAGNOSTIC STREAM  (ROM 0x1E00)</div>
        <div style={{color:C.textDim, fontSize:'9px', marginBottom:'8px', lineHeight:'1.5'}}>
          Reconstructed from current iram values. P2 = diagnostic channel address.
          On real hardware this stream is output via MOVX @R0 on the external data bus
          and captured by the test equipment at the DME diagnostic connector.
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:'4px'}}>
          {CHANNELS.map(ch => (
            <div key={ch.p2} style={{
              background: C.panelBg2,
              border: `1px solid ${C.border2}`,
              borderLeft: `3px solid ${ch.col}`,
              borderRadius: '2px',
              padding: '6px 10px',
              display: 'grid',
              gridTemplateColumns: '60px 180px 60px 60px 1fr',
              alignItems: 'start',
              gap: '8px',
            }}>
              {/* P2 page */}
              <div>
                <div style={{color: C.textDim, fontSize:'8px', letterSpacing:'.1em'}}>P2 PAGE</div>
                <div style={{color: ch.col, fontSize:'13px', fontWeight:'bold', letterSpacing:'.05em'}}>{ch.p2}</div>
              </div>
              {/* Channel name */}
              <div>
                <div style={{color: C.textDim, fontSize:'8px', letterSpacing:'.1em'}}>CHANNEL</div>
                <div style={{color: ch.col, fontSize:'10px', fontWeight:'bold'}}>{ch.name}</div>
                <div style={{color: C.textDim, fontSize:'9px', marginTop:'1px'}}>{ch.src}</div>
              </div>
              {/* Raw iram value */}
              <div>
                <div style={{color: C.textDim, fontSize:'8px', letterSpacing:'.1em'}}>IRAM</div>
                <div style={{color: C.textBright, fontSize:'12px'}}>0x{h2(ch.raw & 0xFF)}</div>
                <div style={{color: C.textDim, fontSize:'9px'}}>{ch.raw & 0xFF}d</div>
              </div>
              {/* Transmitted byte */}
              <div>
                <div style={{color: C.textDim, fontSize:'8px', letterSpacing:'.1em'}}>TX BYTE</div>
                <div style={{color: ch.col, fontSize:'12px', textShadow:`0 0 6px ${ch.col}66`}}>
                  0x{h2(ch.tx & 0xFF)}
                </div>
                <div style={{color: C.textDim, fontSize:'9px'}}>{ch.tx & 0xFF}d</div>
              </div>
              {/* Decoded meaning */}
              <div>
                <div style={{color: C.textDim, fontSize:'8px', letterSpacing:'.1em'}}>DECODED</div>
                <div style={{color: C.text, fontSize:'10px', marginTop:'1px'}}>{ch.decode}</div>
                <div style={{color: C.textDim, fontSize:'9px', marginTop:'2px'}}>{ch.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Raw iram values used by diag routine */}
      <div style={S.panel}>
        <div style={S.panelTitle}>SUPPORTING IRAM VALUES</div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'4px'}}>
          {[
            [0x10,'AFM_RAW'], [0x13,'COOLANT'], [0x16,'TPS'],
            [0x1B,'LMB_LO'],  [0x1C,'LMB_HI'], [0x19,'LMB_ADJ_LN'],
            [0x31,'IGN_ADV'], [0x30,'IGN_DUR'], [0x37,'PRPM'],
            [0x49,'LOAD_IX'], [0x4B,'FUEL_HB'], [0x4A,'FUEL_LB'],
          ].map(([a,n])=>(
            <div key={a} style={{display:'flex',justifyContent:'space-between',
                                 padding:'2px 6px',borderBottom:`1px solid ${C.border}`,fontSize:'10px'}}>
              <span style={{color:C.textDim}}>{n} ({h2(a)}h)</span>
              <span style={{color:C.textBright}}>0x{h2(ir[a]??0)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
