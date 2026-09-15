import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  LineChart, ComposedChart, Line, XAxis, YAxis, Tooltip,
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
  {a:0x00,n:'r00',g:'reg',d:'undefined/unknown'},
  {a:0x01,n:'r01',g:'reg',d:'undefined/unknown'},
  {a:0x02,n:'r02',g:'reg',d:'undefined/unknown'},
  {a:0x03,n:'r03',g:'reg',d:'undefined/unknown'},
  {a:0x04,n:'r04',g:'reg',d:'undefined/unknown'},
  {a:0x05,n:'r05',g:'reg',d:'undefined/unknown'},
  {a:0x06,n:'r06',g:'reg',d:'undefined/unknown'},
  {a:0x07,n:'r07',g:'reg',d:'undefined/unknown'},
  {a:0x08,n:'r08',g:'reg',d:'undefined/unknown'},
  {a:0x09,n:'r09',g:'reg',d:'undefined/unknown'},
  {a:0x0A,n:'r0A',g:'reg',d:'undefined/unknown'},
  {a:0x0B,n:'r0B',g:'reg',d:'undefined/unknown'},
  {a:0x0C,n:'r0C',g:'reg',d:'undefined/unknown'},
  {a:0x0D,n:'r0D',g:'reg',d:'undefined/unknown'},
  {a:0x0E,n:'r0E',g:'reg',d:'undefined/unknown'},
  {a:0x0F,n:'r0F',g:'reg',d:'undefined/unknown'},
  {a:0x10,n:'AFM_RAW',g:'adc',d:'raw AFM wiper value, from the ADC'},
  {a:0x11,n:'SYS_VOLTAGE',g:'adc',d:'system voltage, from the ADC'},
  {a:0x12,n:'AIRTEMP_NTC1',g:'adc',d:'intake air temperature (NTC I), from the ADC'},
  {a:0x13,n:'COOLANT_NTC2',g:'adc',d:'coolant temperature (NTC II), from the ADC'},
  {a:0x14,n:'ALT_REGION_ADC',g:'adc',d:'altitude sensor / region coding input, from the ADC'},
  {a:0x15,n:'RESERVED_15H',g:'adc',d:'undefined/unknown'},
  {a:0x16,n:'ADC_TPS',g:'adc',d:'undefined/unknown'},
  {a:0x17,n:'FQS_POSITION',g:'adc',d:'FQS switch position, from the ADC'},
  {a:0x18,n:'LAMBDA_STEP_UNCHANGED',g:'lambda',d:'lambda correction step, condition unchanged (Map 62 or 65)'},
  {a:0x19,n:'LAMBDA_STEP_TO_LEAN',g:'lambda',d:'lambda correction step, changed to lean (Map 63 or 66)'},
  {a:0x1A,n:'LAMBDA_STEP_TO_NOTLEAN',g:'lambda',d:'lambda correction step, changed to not-lean (Map 64 or 67)'},
  {a:0x1B,n:'LAMBDA_CORR_HI',g:'lambda',d:'lambda correction factor, high byte. Notes: bit 7 is written to diag plug output'},
  {a:0x1C,n:'LAMBDA_CORR_LO',g:'lambda',d:'lambda correction factor, low byte'},
  {a:0x1D,n:'RESERVED_1DH',g:'reg',d:'undefined/unknown. Notes: used in extint1_handler'},
  {a:0x1E,n:'RESERVED_1EH',g:'reg',d:'undefined/unknown. Notes: -"-'},
  {a:0x1F,n:'RESERVED_1FH',g:'reg',d:'undefined/unknown. Notes: -"-'},
  {a:0x20,n:'FLAGS_20',g:'flags',d:'Bit-addressable flags register: b0=ISV_FLARE_VARIANT; b1=init_flag; b2=ISV_RPM_ERR_SIGN_LAMBDA_COND_CURRENT; b3=ISV_INT_BLOCK_POS; b4=ISV_INT_BLOCK_NEG; b5=ISV_PWM_OVF_SIGN; b6=ISV_FLARE_NEEDED; b7=LAMBDA_ENABLE'},
  {a:0x21,n:'FLAGS_21',g:'flags',d:'Bit-addressable flags register: b0=OVERLOAD_PRETIMER_RUN; b1=OVERLOAD_LOCKOUT_RUN; b2=INJECTORS_ON; b3=RESERVED_21H_3; b4=CRANK_ENR_PHASEOUT_LATCH; b5=FUEL_REACT_TRANS_ACTIVE; b6=FUELCUT_REACT_MODE; b7=ACCEL_PUMP_SHOT_LATCH'},
  {a:0x22,n:'FLAGS_22',g:'flags',d:'Bit-addressable flags register: b0=IGN_HALFTOOTH_CORR; b1=IGN_HALFTOOTH_ROUND_ERR; b2=Unreferenced; b3=COIL_STATE_REF; b4=TIMING_RATE_SEL_LOW; b5=TIMING_RATE_SEL_MED; b6=TIMING_RATE_SEL_HIGH; b7=Time1FlagLowIdle'},
  {a:0x23,n:'FLAGS_23',g:'flags',d:'Bit-addressable flags register: b0=TPS_AT_IDLE; b1=WOT_FLAG; b2=CRANKING_FLAG; b3=ISV_ALT_PATH; b4=STARTUP_FLAG; b5=FUEL_CUT_FLAG; b6=TRG_IDLE_FLARE; b7=TXDLambdaDiag'},
  {a:0x24,n:'FLAGS_24',g:'flags',d:'Bit-addressable flags register: b0=LAMBDA_WATCHDOG_EN; b1=LAMBDA_LOAD_TIMER_RUN; b2=LAMBDA_WATCHDOG_ACTIVE; b3=LAMBDA_NEUTRAL_PHASE; b4=LAMBDA_RICHLEAN_PHASE; b5=LAMBDA_COND_MET; b6=LAMBDA_COND_PREV; b7=LAMBDA_COND_PERSISTED'},
  {a:0x25,n:'FLAGS_25',g:'flags',d:'Bit-addressable flags register: b0=Unused; b1=Unused; b2=MapLookFail; b3=DiagNotSet; b4=COLD_CRANK_LAMBDA_SEL; b5=COLD_CRANK_WARMUP_SEL; b6=REGION_CODE; b7=ALTITUDE_HIGH_FLAG'},
  {a:0x26,n:'RESERVED_26H',g:'flags',d:'undefined/unknown. Notes: Only referenced in unused parts of the ROM'},
  {a:0x27,n:'RESERVED_27H',g:'flags',d:'undefined/unknown'},
  {a:0x28,n:'RESERVED_28H',g:'flags',d:'undefined/unknown'},
  {a:0x29,n:'ram_diag_addr',g:'flags',d:'Used for indexing table of RAM addresses to send from and receive to during diagnostics. Notes: Used for indexing table of RAM addresses to send from and receive to during diagnostics'},
  {a:0x2A,n:'RESERVED_2AH',g:'sys',d:'undefined/unknown. Notes: Software watchdog timer'},
  {a:0x2B,n:'IGN_EVENT_CNT',g:'ign',d:'ignition event counter to the next dwell or spark, in whole teeth. Notes: Tooth count until next extint1_handler event'},
  {a:0x2C,n:'IGN_EVENT_CNT_REF',g:'ign',d:'pre-calculated replacement for 2Bh, relative to the ref sensor. Notes: Tooth count until first ignition event after reference mark. Loaded into 2B when at reference mark.'},
  {a:0x2D,n:'KLR_TRIGGER_CNT',g:'ign',d:'KLR trigger counter, in whole teeth. Notes: Tooth count until next extint1_handler high ROM hook event. Reloaded from I2E (value 252) when at reference mark. Added to in steps of 65. Tooth count of first hook event is thus 61 since it wraps. The hook is empty in this version of the ROM and thus do nothing.'},
  {a:0x2E,n:'KLR_TRIGGER_CNT_REF',g:'ign',d:'pre-calculated replacement for 2Dh, relative to the ref sensor. Notes: Loaded with value from address 1162, value is 252.'},
  {a:0x2F,n:'DWELL_ANGLE',g:'ign',d:'dwell angle, in half-teeth. Notes: Dwell angle, number of half-teeth for primary current through the ignition coil. Loaded from map 24, rpm and battery voltage dependent.'},
  {a:0x30,n:'DWELL_DURATION_SPD',g:'ign',d:'dwell duration used by the speed sensor routine, in half-teeth. Notes: Duration of ignition pulse, number of half-teeth needed for dwell. This is the dwell angle with correction for offset between reference mark and flywheel tooth.'},
  {a:0x31,n:'IGN_ADVANCE_CUR',g:'ign',d:'current ignition advance, in half-teeth. Notes: Spark timing advance, half-teeth before TDC'},
  {a:0x32,n:'IGN_ADVANCE_TARGET',g:'ign',d:'target ignition advance. Notes: Next spark timing advance'},
  {a:0x33,n:'TDC_COUNTDOWN',g:'ign',d:'half-tooth count to the next TDC. Notes: Half-tooth count for next TDC counted from the point of the spark. i.e. timing advance + 180 degrees'},
  {a:0x34,n:'IGN_STEP_COUNTDOWN',g:'ign',d:'countdown to the next permitted ignition timing step. Notes: Timing advance update interval. The interval between updating I31 from I32.'},
  {a:0x35,n:'CYL_FIRE_INDEX',g:'ign',d:'cylinder firing index (0 or 1). Notes: This can have values 0 or 1. Two fire events in our four cylinder engine. It is used as index into arrays with flywheel tooth/half-tooth counts.'},
  {a:0x36,n:'SPD_PULSE_CNT',g:'rpm',d:'speed sensor pulse counter, used for rpm measurement'},
  {a:0x37,n:'ENGINE_RPM_RAW',g:'rpm',d:'engine speed, in units of 40rpm'},
  {a:0x38,n:'RESERVED_38H',g:'timer',d:'undefined/unknown'},
  {a:0x39,n:'RESERVED_39H',g:'timer',d:'undefined/unknown'},
  {a:0x3A,n:'RESERVED_3AH',g:'timer',d:'undefined/unknown'},
  {a:0x3B,n:'RESERVED_3BH',g:'rpm',d:'undefined/unknown'},
  {a:0x3C,n:'POST_START_ENR_TIMER',g:'timer',d:'post-start enrichment (software counter, 414ms units). Notes: After start enrichment'},
  {a:0x3D,n:'ACCEL_ENR_TIMER',g:'rpm',d:'all-rpm acceleration enrichment (software counter, 58ms units)'},
  {a:0x3E,n:'LAMBDA_TIMER',g:'lambda',d:'lambda timer (software counter, 11.5ms units)'},
  {a:0x3F,n:'LAMBDA_LOAD_TIMER',g:'sys',d:'lambda load threshold timer (software counter, 345ms units)'},
  {a:0x40,n:'RESERVED_40H',g:'fuel',d:'undefined/unknown'},
  {a:0x41,n:'ISV_ON_TIME_HI',g:'fuel',d:'timer1 ISV on-time, high byte'},
  {a:0x42,n:'ISV_ON_TIME_LO',g:'fuel',d:'timer1 ISV on-time, low byte'},
  {a:0x43,n:'RESERVED_43H',g:'fuel',d:'undefined/unknown'},
  {a:0x44,n:'ISV_OFF_TIME_LO',g:'fuel',d:'timer1 ISV off-time, low byte'},
  {a:0x45,n:'ISV_OFF_TIME_HI',g:'fuel',d:'timer1 ISV off-time, high byte'},
  {a:0x46,n:'LOAD_SMOOTHED_HI',g:'fuel',d:'smoothed 24-bit load value, high byte'},
  {a:0x47,n:'LOAD_SMOOTHED_MID',g:'fuel',d:'smoothed 24-bit load value, middle byte'},
  {a:0x48,n:'LOAD_SMOOTHED_LO',g:'fuel',d:'smoothed 24-bit load value, low byte'},
  {a:0x49,n:'LOAD_VALUE',g:'fuel',d:'load, i.e. the high byte of the scaled base fuel pulse'},
  {a:0x4A,n:'FUEL_PULSE_LO',g:'fuel',d:'final fuel pulse, low byte (timer0 ticks of 2us)'},
  {a:0x4B,n:'FUEL_PULSE_HI',g:'fuel',d:'final fuel pulse, high byte'},
  {a:0x4C,n:'ACCEL_ENR_LOWRPM',g:'fuel',d:'low-rpm acceleration enrichment, added directly to the pulse'},
  {a:0x4D,n:'INJ_EVENT_CNT',g:'fuel',d:'injection event counter, capped at 128'},
  {a:0x4E,n:'FUEL_ADJ_ACCUM_LO',g:'fuel',d:'accumulated fuel adjustment, low byte'},
  {a:0x4F,n:'FUEL_ADJ_ACCUM_HI',g:'fuel',d:'accumulated fuel adjustment, high byte'},
  {a:0x50,n:'FUEL_ADJ_SHIFT_CNT',g:'misc',d:'count of outstanding left shifts (pending multiplications by 2)'},
  {a:0x51,n:'AFM_HIST_1',g:'misc',d:'AFM history queue, most recent previous reading'},
  {a:0x52,n:'AFM_HIST_2',g:'misc',d:'AFM history queue, second previous reading'},
  {a:0x53,n:'AFM_HIST_3',g:'adc',d:'AFM history queue, third previous reading (~35ms old)'},
  {a:0x54,n:'INJ_DEADTIME',g:'misc',d:'injector dead-time. Notes: Number of ticks/5 to add to injection signal to compensate for injector opening time.'},
  {a:0x55,n:'RPM_LAG_REF',g:'misc',d:'lagging rpm reference that chases 37h'},
  {a:0x56,n:'RPM_LAG_ACCUM',g:'misc',d:'fractional accumulator controlling how fast 55h chases 37h'},
  {a:0x57,n:'IGN_ACCEL_ADJ',g:'misc',d:'acceleration/deceleration ignition timing adjustment. Notes: half-tooth spark timing adjustment for acceleration or deceleration. can have values 0, 1 or -1'},
  {a:0x58,n:'OVERLOAD_TIMER',g:'enrich',d:'overload timer'},
  {a:0x59,n:'OVERLOAD_PRESCALE',g:'enrich',d:'prescale counter for 58h'},
  {a:0x5A,n:'RESERVED_5AH',g:'misc',d:'undefined/unknown'},
  {a:0x5B,n:'RESERVED_5BH',g:'misc',d:'undefined/unknown'},
  {a:0x5C,n:'RESERVED_5CH',g:'misc',d:'undefined/unknown'},
  {a:0x5D,n:'RESERVED_5DH',g:'misc',d:'undefined/unknown'},
  {a:0x5E,n:'RESERVED_5EH',g:'misc',d:'undefined/unknown'},
  {a:0x5F,n:'RESERVED_5FH',g:'misc',d:'undefined/unknown'},
  {a:0x60,n:'RESERVED_60H',g:'misc',d:'undefined/unknown'},
  {a:0x61,n:'RESERVED_61H',g:'misc',d:'undefined/unknown'},
  {a:0x62,n:'RESERVED_62H',g:'misc',d:'undefined/unknown'},
  {a:0x63,n:'stack_0',g:'misc',d:'stack'},
  {a:0x64,n:'stack_1',g:'misc',d:'stack'},
  {a:0x65,n:'stack_2',g:'misc',d:'stack'},
  {a:0x66,n:'stack_3',g:'misc',d:'stack'},
  {a:0x67,n:'stack_4',g:'misc',d:'stack'},
  {a:0x68,n:'stack_5',g:'misc',d:'stack'},
  {a:0x69,n:'stack_6',g:'misc',d:'stack'},
  {a:0x6A,n:'stack_7',g:'misc',d:'stack'},
  {a:0x6B,n:'stack_8',g:'misc',d:'stack'},
  {a:0x6C,n:'stack_9',g:'misc',d:'stack'},
  {a:0x6D,n:'stack_A',g:'misc',d:'stack'},
  {a:0x6E,n:'stack_B',g:'misc',d:'stack'},
  {a:0x6F,n:'stack_C',g:'misc',d:'stack'},
  {a:0x70,n:'stack_D',g:'misc',d:'stack'},
  {a:0x71,n:'stack_E',g:'misc',d:'stack'},
  {a:0x72,n:'stack_F',g:'misc',d:'stack'},
  {a:0x73,n:'stack_G',g:'misc',d:'stack'},
  {a:0x74,n:'stack_H',g:'misc',d:'stack'},
  {a:0x75,n:'stack_I',g:'misc',d:'stack'},
  {a:0x76,n:'stack_J',g:'misc',d:'stack'},
  {a:0x77,n:'stack_K',g:'misc',d:'stack'},
  {a:0x78,n:'stack_L',g:'misc',d:'stack'},
  {a:0x79,n:'stack_M',g:'misc',d:'stack'},
  {a:0x7A,n:'RESERVED_7AH',g:'misc',d:'undefined/unknown. Notes: probably used as sequence number, written and read during diagnostics'},
  {a:0x7B,n:'ISV_CORR_DBL_HI',g:'misc',d:'high byte of the doubled ISV correction'},
  {a:0x7C,n:'ISV_FLARE_HOLD_CNT',g:'misc',d:'ISV flare hold counter'},
  {a:0x7D,n:'ISV_INTEGRAL_LO',g:'misc',d:'ISV integral term, low byte'},
  {a:0x7E,n:'ISV_INTEGRAL_HI',g:'misc',d:'ISV integral term, high byte'},
  {a:0x7F,n:'ISV_TARGET_RPM',g:'isv',d:'ISV target idle rpm'},
];

// KLR 8048 RAM labels — from 87KLR951.xlsx byte_mem sheet (disassembly), variable_name column
const KLR_KNOWN = {
  0x00: {n:'interrupt_info', d:'Register bank 0 - Used for interrupt context/ r0 - Holds 24h at start of interrupt. 24h is scratch space to store the normal-context\'s accumulator'},
  0x02: {n:'num_timer_ints', d:'r2 - A count of number of times timer interrupt fired.'},
  0x03: {n:'mult_in', d:'r3 - used as an input to the 8-bit multiply function'},
  0x05: {n:'dec_interrupts', d:'r5 - Decremented every interrupt. When reaches 0'},
  0x06: {n:'speed_count', d:'r6 - engine speed represented as the number of timer interrupts since the last reset. Actually it is a count that is initialized to 0 at reset and counts _down_ each interrupt.'},
  0x07: {n:'timer_period', d:'r7 - the current timer period. Actually it is the value the timer/event-counter register. is re-initialized to every time the timer interrupt happens. r7 is initialized to 0xfc. in the boot code, and then left/right shifted occasionally depending on the RPM. In practice it has a value of 0xfe when the RPM is above 1500 RPM and 0xfc otherwise.'},
  0x22: {n:'ADC_INIT_ANGLE', d:'angle to begin ADC initialization routine (in timer ticks)'},
  0x23: {n:'ADC_READ_ANGLE', d:'angle to read ADC (after 22h, in timer ticks)'},
  0x24: {n:'ENGINE_SPEED_TICKS', d:'engine speed (in timer ticks)'},
  0x2E: {n:'BATTERY_VOLTAGE', d:'battery voltage'},
  0x2F: {n:'KNOCK_SENSOR_DIAG', d:'knock sensor (diagnostics)'},
  0x30: {n:'BLINK_ERR_KNOCK_MAP', d:'knock/MAP'},
  0x31: {n:'knock_test_out', d:''},
  0x33: {n:'BLINK_CODE_CURRENT', d:'current blink code'},
  0x35: {n:'BLINK_ERR_BOOST_HILO', d:'boost high/low'},
  0x36: {n:'BLINK_ERR_TPS', d:'TPS/TPS power supply'},
  0x38: {n:'UNKNOWN_38', d:'38h - scratch space for interrupt routines to stash the non-interrupt context\'s accumulator'},
  0x39: {n:'TPS_POWER_SUPPLY', d:'throttle position (power supply)'},
  0x3A: {n:'TPS_DEGREES', d:'throttle position (degrees)'},
  0x3B: {n:'TPS_Scaling', d:'3bh - The scaling numerator 3B is initialized to 119 in the trigger/reset routine. So the nominal scaling factor is 119/256, or about 0.46'},
  0x3C: {n:'TPS_RAW', d:'throttle position (raw)'},
  0x3E: {n:'WOT_angle', d:'angle for WOT (set to 66 decimal for all rpm)'},
  0x41: {n:'CV_DUTY_FINAL', d:'final CV duty cycle'},
  0x43: {n:'TPS_MAP_AXIS', d:'throttle position (map axis)'},
  0x44: {n:'RPM_MAP_AXIS', d:'rpm range (map axis)'},
  0x45: {n:'mac_knock_thresh', d:'45h - current maximum knock threshold (looked-up from map based on current RPM. But map is all the same value of 10). minimum knock threshold value (10 decimal for all rpm)'},
  0x46: {n:'integrated_knock_val', d:'46h - integrated knock value read by ADC'},
  0x47: {n:'knock_det_threshold', d:'coefficient for knock threshold (makes knock detection less sensitive at higher rpm)'},
  0x48: {n:'throttle_position_threshold', d:'throttle position threshold for knock control'},
  0x4A: {n:'cycle_count_before_restore', d:'cycle count before restoring 0.3 deg. timing (this value is used to initialize the counter 49h)'},
  0x4B: {n:'max_timing_retart', d:'max timing retard (set to 18 decimal for all rpm, which corresponds to ~6 degrees)'},
  0x4C: {n:'boost_threshold', d:'threshold for pulling boost'},
  0x4E: {n:'cycle_count_before_pulling_boost', d:'cycle count before pulling boost'},
  0x50: {n:'cycle_count_before_restore_boost', d:'cycle count before restoring boost'},
  0x51: {n:'MAP compare?', d:''},
  0x52: {n:'MAP_PRESSURE', d:'MAP pressure'},
  0x57: {n:'BOOST_REDUCTION_KNOCK', d:'total boost reduction for knock control'},
  0x60: {n:'BOOST_PID_ERROR', d:'boost control PID error (target boost - actual boost)'},
  0x61: {n:'BOOST_PID_ITERM', d:'boost control PID I term (integral)'},
  0x62: {n:'BOOST_PID_DTERM', d:'boost control PID D term (derivative)'},
  0x68: {n:'BOOST_FEEDFORWARD_CV', d:'boost control feedforward value (CV duty cycle)'},
  0x70: {n:'CYL_TIMING_DELAY_C1', d:'per-cylinder timing delay cylinder 1'},
  0x71: {n:'CYL_TIMING_DELAY_C2', d:'per-cylinder timing delay cylinder 2'},
  0x72: {n:'CYL_TIMING_DELAY_C3', d:'per-cylinder timing delay cylinder 3'},
  0x73: {n:'CYL_TIMING_DELAY_C4', d:'per-cylinder timing delay cylinder 4'},
  0x74: {n:'CYL_KNOCK_THRESH_C1', d:'per-cylinder knock threshold cyinder 1'},
  0x75: {n:'CYL_KNOCK_THRESH_C2', d:'per-cylinder knock threshold cyinder 2'},
  0x76: {n:'CYL_KNOCK_THRESH_C3', d:'per-cylinder knock threshold cyinder 3'},
  0x77: {n:'CYL_KNOCK_THRESH_C4', d:'per-cylinder knock threshold cyinder 4'},
  0x7A: {n:'knk_thres', d:'7ah - current knock threshold msb value for the cylinder that fired in the previous cycle'},
};

// ─────────────────────────────────────────────────────────────────
//  BOOST MAP TABLE — JS port of the identical table in klr_tb.v's
//  -DBOOST model (which itself was sourced from the '89 KLR boost
//  map documented at https://jhnbyrn.github.io/951-KLR-PAGES/
//  klr_memory_map.html). Used here to compute the *target* boost
//  the firmware should be reading, for comparison against the
//  actual observed reading (ram[0x52]) on the new Boost Control tab.
// ─────────────────────────────────────────────────────────────────
const BOOST_RPM_BP = [0, 1864, 2041, 2254, 2446, 2674, 2948, 3164, 3415, 3708, 4057, 4479, 4724, 4998, 5653, 6050];
const BOOST_THR_BP = [57.0, 61.3, 65.6, 69.9, 74.2, 78.5, 82.8, 87.1];
const BOOST_TABLE = [
  [137,141,144,145,145,146,146,148,148,148,150,150,150,152,152,152], // 57.0%
  [139,141,145,151,154,157,157,158,158,158,158,158,158,158,158,158], // 61.3%
  [139,141,148,157,164,167,167,170,170,167,167,167,166,165,165,165], // 65.6%
  [141,142,159,170,177,180,180,180,180,177,176,175,174,171,171,171], // 69.9%
  [143,145,171,190,193,193,193,193,193,191,188,186,184,182,180,180], // 74.2%
  [145,152,180,206,206,206,206,206,206,208,206,206,206,206,206,194], // 78.5%
  [145,152,180,206,206,206,206,206,206,208,206,206,206,206,206,194], // 82.8%
  [145,152,180,206,206,206,206,206,206,208,206,206,206,206,206,194], // 87.1%
];

// Throttle% from KLR's own tps_raw (STATUS-line field).
// Direction confirmed against an actual log (cl_ramp_to_6000_BOOST_LOW):
// tps_raw reads 0x77 (119) right at sim start (engine at rest, throttle
// closed) and rises as throttle opens — a DIRECT relationship, not
// inverted. Anchored 0%=idle at 0x77(119), 100%=fully open at 256 (the
// full 8-bit ADC ceiling), clamped beyond either end.
function tpsRawToThrottlePct(tpsRaw) {
  if (tpsRaw == null) return null;
  const pct = ((tpsRaw - 119) / (256 - 119)) * 100;
  return Math.max(0, Math.min(100, pct));
}

// Throttle% for the boost MAP table, from ram[0x43] — the KLR firmware's
// own throttle-cycling valve map input register (same source klr_tb.v's
// -DBOOST model now reads directly, replacing the earlier tps_raw-based
// approximation that was producing confirmed mismatches). Calibration:
// ram[0x43]=1 -> 58%, ram[0x43]=0x1C(28) -> 88%, linear between (and
// beyond — the boost table's own interpolation clamps out-of-range
// throttle% at its edges, so no clamping needed here).
function ram43ToThrottlePct(ram43) {
  if (ram43 == null) return null;
  return 58.0 + (ram43 - 1.0) * 30.0 / 27.0;
}

// Bilinear interpolation over BOOST_TABLE, clamped at the table edges
// (no extrapolation) — mirrors klr_tb.v's -DBOOST model exactly.
// Returns the target value in "software units" (same post-+10-offset
// scale as ram[0x52] itself, i.e. directly comparable to the actual
// observed reading without any further correction).
function boostTargetSoftwareUnits(rpm, throttlePct) {
  if (rpm == null || throttlePct == null) return null;
  let r = Math.max(BOOST_RPM_BP[0], Math.min(BOOST_RPM_BP[BOOST_RPM_BP.length-1], rpm));

  let rLo = 0, rHi = BOOST_RPM_BP.length - 1;
  for (let i = 0; i < BOOST_RPM_BP.length - 1; i++) {
    if (r >= BOOST_RPM_BP[i] && r <= BOOST_RPM_BP[i+1]) { rLo = i; rHi = i+1; }
  }
  const rFrac = BOOST_RPM_BP[rHi] !== BOOST_RPM_BP[rLo]
    ? (r - BOOST_RPM_BP[rLo]) / (BOOST_RPM_BP[rHi] - BOOST_RPM_BP[rLo]) : 0;

  let tLo, tHi, tFrac;
  if (throttlePct <= BOOST_THR_BP[0]) {
    tLo = 0; tHi = 0; tFrac = 0;
  } else if (throttlePct >= BOOST_THR_BP[BOOST_THR_BP.length-1]) {
    tLo = tHi = BOOST_THR_BP.length - 1; tFrac = 0;
  } else {
    tLo = 0; tHi = BOOST_THR_BP.length - 1;
    for (let j = 0; j < BOOST_THR_BP.length - 1; j++) {
      if (throttlePct >= BOOST_THR_BP[j] && throttlePct <= BOOST_THR_BP[j+1]) { tLo = j; tHi = j+1; }
    }
    tFrac = BOOST_THR_BP[tHi] !== BOOST_THR_BP[tLo]
      ? (throttlePct - BOOST_THR_BP[tLo]) / (BOOST_THR_BP[tHi] - BOOST_THR_BP[tLo]) : 0;
  }

  const v00 = BOOST_TABLE[tLo][rLo], v01 = BOOST_TABLE[tLo][rHi];
  const v10 = BOOST_TABLE[tHi][rLo], v11 = BOOST_TABLE[tHi][rHi];
  const v0 = v00 + (v01 - v00) * rFrac;
  const v1 = v10 + (v11 - v10) * rFrac;
  return v0 + (v1 - v0) * tFrac;
}

// ─────────────────────────────────────────────────────────────────
//  PORT DEFINITIONS
// ─────────────────────────────────────────────────────────────────
const PORT_DEFS = {
  P1: [
    {bit:7, name:'O2_LEAN',   dir:'IN',  desc:'O2/Lambda sensor top threshold: 1=lean (sensor < 0.45V), 0=rich'},
    {bit:6, name:'O2_RICH',   dir:'IN',  desc:'O2/Lambda sensor bottom threshold: 1=lean or crossover (sensor < 0.50V), 0=rich'},
    {bit:5, name:'KLR_TRIGGER',dir:'OUT', desc:'Ignition/trigger signal to KLR trigger input — triggered by extint1_handler at computed spark angle'},
    {bit:4, name:'IDLE_SPD',  dir:'OUT', desc:'Idle speed positioner output — also used as firmware watchdog heartbeat'},
    {bit:3, name:'UNUSED',    dir:'?',   desc:'Unused — P1.3 not connected to any DME function'},
    {bit:2, name:'DME_RELAY', dir:'OUT', desc:'DME main relay / fuel pump relay driver — active-low'},
    {bit:1, name:'TACH/KLRIgn',dir:'OUT', desc:'Ignition signal output — drives both the tachometer (instrument cluster rev counter) and the KLR ignition input'},
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
//  KLR 8048 PORT DEFINITIONS
// ─────────────────────────────────────────────────────────────────
const KLR_PORT_DEFS = {
  P1: [
    {bit:7, name:'ADC_CH2',   dir:'IN',  desc:'ADC input channel 2'},
    {bit:6, name:'ADC_CH1',   dir:'IN',  desc:'ADC input channel 1'},
    {bit:5, name:'FULL_LOAD', dir:'OUT', desc:'Full-load / WOT flag output → DME TPS ch6'},
    {bit:4, name:'ADC_CH0',   dir:'IN',  desc:'ADC input channel 0'},
    {bit:3, name:'ADC_A2',    dir:'OUT', desc:'ADC mux address bit 2'},
    {bit:2, name:'ADC_A1',    dir:'OUT', desc:'ADC mux address bit 1'},
    {bit:1, name:'ADC_A0',    dir:'OUT', desc:'ADC mux address bit 0'},
    {bit:0, name:'ADC_START', dir:'OUT', desc:'ADC start conversion'},
  ],
  P2: [
    {bit:7, name:'IGN_OUT',   dir:'OUT', desc:'Ignition coil output → DME ign input (processed spark signal)'},
    {bit:6, name:'IGN_OUT_N', dir:'OUT', desc:'Ignition coil output active-low complement'},
    {bit:5, name:'CV_PWM',    dir:'OUT', desc:'Coil voltage PWM control'},
    {bit:4, name:'KNOCK_DET', dir:'OUT', desc:'Diag LED Output'},
    {bit:3, name:'P2_3',      dir:'?',   desc:'P2.3 — function TBD'},
    {bit:2, name:'P2_2',      dir:'?',   desc:'P2.2 — function TBD'},
    {bit:1, name:'P2_1',      dir:'?',   desc:'P2.1 — function TBD'},
    {bit:0, name:'P2_0',      dir:'?',   desc:'P2.0 — function TBD'},
  ],
};

// Parse compact dashboard snapshot line:
//   [DS] <time_ms>,<256-hex-iram>,<p1hex><p2hex><p3hex>
function parseDsLine(line) {
  // Strip "[DS] " prefix
  const body = line.replace(/^(?:DME:\s*)?\[DS\]\s*/,'').trim();
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
  // Explicit ground-truth temps in status line: coolant(13)=0xde (80 degC).
  // Prefer these over the NTC-curve estimate when present — 9999 degC is a
  // startup sentinel for "sensor not yet sampled", so it's ignored.
  const coolEx = line.match(/coolant\([0-9A-Fa-f]{1,2}\)=0x[0-9A-Fa-f]+\s+\((-?\d+)\s*degC\)/i);
  if (coolEx) { const v = parseInt(coolEx[1]); if (v < 200) snap.explicitCoolantC = v; }
  const airEx = line.match(/airtemp\([0-9A-Fa-f]{1,2}\)=0x[0-9A-Fa-f]+\s+\((-?\d+)\s*degC\)/i);
  if (airEx) { const v = parseInt(airEx[1]); if (v < 200) snap.explicitAirC = v; }
  return snap;
}

function parsePhaseLine(line) {
  const tm = line.match(/t=(\d+)\s*ms/);
  if (!tm) return null;
  const msg = line.replace(/^(?:DME:\s*)?\[PHASE\]\s*t=\d+\s*ms\s*/,'').trim();
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
    if (t.startsWith('[DS]') || t.startsWith('DME: [DS]'))             { const s = parseDsLine(t);      if (s) snapshots.push(s); }
    else if (t.startsWith('[STATUS]'))                                  { const s = parseStatusLine(t);  if (s) snapshots.push(s); }
    else if (t.startsWith('[PHASE]') || t.startsWith('DME: [PHASE]'))  { const p = parsePhaseLine(t);   if (p) phases.push(p);    }
    else if (t.startsWith('DME: [STATUS]'))                            { const s = parseStatusLine(t.replace(/^DME: /,'')); if (s) snapshots.push(s); }
  }
  // Annotate each snapshot with last valid raw temp bytes so Overview
  // can carry-forward across mid-scan raw ADC artifacts.
  // Inline threshold: val*0.875-116 >= -40  →  val >= 87 (0x57)
  const validTemp = v => v !== undefined && v >= 0x57;
  const validAfm  = v => v !== undefined && v >= 0x08 && v <= 0xF0;
  const validTps  = v => v !== undefined && v >= 0x50;
  let lastCoolantRaw = undefined, lastAirRaw = undefined, lastAfmRaw = undefined, lastTpsRaw = undefined;
  let lastCoolantC = undefined, lastAirC = undefined;
  let lastDsIram = {};
  for (const s of snapshots) {
    if (validTemp(s.iram[0x13])) lastCoolantRaw = s.iram[0x13];
    if (validTemp(s.iram[0x12])) lastAirRaw     = s.iram[0x12];
    // Only use STATUS snapshots for AFM shadow — DS iram[0x10] is unreliable
    if (s.raw?.includes('[STATUS]') && validAfm(s.iram[0x10])) lastAfmRaw = s.iram[0x10];
    if (validTps(s.iram[0x16]))  lastTpsRaw     = s.iram[0x16];
    if (s.explicitCoolantC !== undefined) lastCoolantC = s.explicitCoolantC;
    if (s.explicitAirC     !== undefined) lastAirC     = s.explicitAirC;
    s._prevCoolant  = lastCoolantRaw;
    s._prevAir      = lastAirRaw;
    s._prevAfm      = lastAfmRaw;
    s._prevTps      = lastTpsRaw;
    s._prevCoolantC = lastCoolantC;
    s._prevAirC     = lastAirC;
    // Track last DS iram for gap-filling STATUS snapshots
    if (!s.raw?.includes('[STATUS]')) {
      lastDsIram = s.iram;
    } else {
      // Fill STATUS iram gaps from previous DS snapshot
      s.iram = { ...lastDsIram, ...s.iram };
    }
  }
  phases.sort((a, b) => a.t - b.t);
  return { snapshots, phases };
}

// ─────────────────────────────────────────────────────────────────
//  KLR LOG PARSER
//  Parses [KLR] snapshot lines emitted by i8048_tb.v
//
//  Format: [KLR] <time_ms>,<128hex_64bytes_ram>,<p1hex><p2hex>,<ign><ignout><fl>
//    time_ms  : simulated ms
//    128hex   : 64 bytes of 8048 RAM as 128 hex chars
//    p1,p2    : port bytes
//    ign      : T1 input (DME tach)
//    ignout   : p2[7] ignition output
//    fl       : p1[5] full-load flag
// ─────────────────────────────────────────────────────────────────
function parseKLRLog(text) {
  const snapshots = [], phases = [], status = [];
  for (const line of text.split('\n')) {
    const t = line.trim();

    // ── [KLR] hex snapshot ──────────────────────────────────
    if (t.startsWith('KLR: [DS]')) {
      const parts = t.slice('KLR: [DS]'.length).trim().split(',');
      if (parts.length < 2) continue;
      const time = parseInt(parts[0]);
      if (isNaN(time)) continue;
      const hex = parts[1].trim();
      const snap = { t: time, ram: {} };
      for (let i = 0; i < Math.min(hex.length / 2, 128); i++) {
        const bs = hex.slice(i * 2, i * 2 + 2);
        if (bs && !/x/i.test(bs)) {
          const v = parseInt(bs, 16); if (!isNaN(v)) snap.ram[i] = v;
        }
      }
      // Ports field may contain X for unknown bits e.g. "X76X"
      // Parse each nibble separately — skip only the unknown nibbles
      if (parts[2]) {
        const pf = parts[2].trim();
        // P1 = first two chars, P2 = next two chars
        // A nibble is valid if it's 0-9 or a-f; X/x means unknown
        const parsePartial = (hi, lo) => {
          const hv = /^[0-9a-fA-F]$/.test(hi) ? parseInt(hi, 16) : null;
          const lv = /^[0-9a-fA-F]$/.test(lo)  ? parseInt(lo, 16)  : null;
          if (hv === null && lv === null) return null;
          // Fill unknown nibble with 0 and mark as partial
          return { val: ((hv ?? 0) << 4) | (lv ?? 0), partial: hv===null||lv===null };
        };
        const p1r = parsePartial(pf[0], pf[1]);
        const p2r = parsePartial(pf[2], pf[3]);
        if (p1r !== null) { snap.p1 = p1r.val; snap.p1partial = p1r.partial; }
        if (p2r !== null) { snap.p2 = p2r.val; snap.p2partial = p2r.partial; }
      }
      if (parts[3]) snap.extra = parts[3].trim();
      snapshots.push(snap);

    // ── KLR: [STATUS] text line ─────────────────────────────
    } else if (t.startsWith('KLR: [STATUS]')) {
      const body = t.slice('KLR: [STATUS]'.length).trim();
      const tm = body.match(/t=(\d+)\s*ms/);
      if (!tm) continue;
      const s = { t: parseInt(tm[1]) };
      // Named fields
      const fields = ['pc','mb','SP','irq','ign_out','full_load','CV_PWM','tps_raw','tps_deg','timer_val'];
      for (const f of fields) {
        const m = body.match(new RegExp(f + '=(\\w+)'));
        if (m && m[1] !== 'x' && m[1] !== 'xx') s[f] = parseInt(m[1], 16);
      }
      // knock — may be 'x'
      const km = body.match(/knock=(\w+)/);
      if (km) s.knock = km[1] === 'x' ? null : parseInt(km[1], 16);
      // knock_count — cumulative decimal counter (not hex)
      const kcm = body.match(/knock_count=(\d+)/);
      if (kcm) s.knock_count = parseInt(kcm[1], 10);
      // boost_target — real internal MAP-table lookup from klr_tb.v itself
      // (authoritative — replaces the dashboard's own independent JS
      // reconstruction when present in the log). 0 when -DBOOST wasn't set.
      const btm = body.match(/boost_target=([0-9a-fA-F]+)/);
      if (btm) s.boost_target = parseInt(btm[1], 16);
      // Registers R0/R2/R4/R5
      for (const r of ['R0','R2','R4','R5']) {
        const m = body.match(new RegExp(r + '=(\\w+)'));
        if (m && m[1] !== 'x') s[r] = parseInt(m[1], 16);
      }
      // ram[n] values — bracket index is HEX (e.g. ram[33] means address 0x33),
      // matching how the KLR firmware log labels RAM addresses.
      s.ramVals = {};
      for (const m of body.matchAll(/ram\[([0-9a-fA-F]+)\]=([0-9a-fA-F]+)/g))
        s.ramVals[parseInt(m[1], 16)] = parseInt(m[2], 16);
      status.push(s);

    // ── KLR: [PHASE] timing event ───────────────────────────
    } else if (t.startsWith('KLR: [PHASE]')) {
      const body = t.slice('KLR: [PHASE]'.length).trim();
      const tm = body.match(/t=(\d+)\s*ms/);
      if (!tm) continue;
      const msg = body.replace(/t=\d+\s*ms\s*/, '').trim();
      // Extract timing measurements
      const dm = msg.match(/delay_from_ign_in=([\d.]+)\s*(us|ms)/);
      const pm = msg.match(/pulse_width=([\d.]+)\s*(us|ms)/);
      const delay_us = dm ? parseFloat(dm[1]) * (dm[2] === 'ms' ? 1000 : 1) : null;
      const pulse_ms = pm ? parseFloat(pm[1]) * (pm[2] === 'us' ? 0.001 : 1) : null;
      // Timing-only lines (no parenthetical context) — merge into previous entry
      // Never merge asserted/deasserted lines — they always need their own entry
      const isTiming = (dm || pm) && !/\(/.test(msg) &&
                       !/asserted|deasserted/i.test(msg);
      if (isTiming && phases.length > 0) {
        const prev = phases[phases.length - 1];
        if (delay_us != null) prev.delay_us = delay_us;
        if (pulse_ms != null) prev.pulse_ms = pulse_ms;
      } else {
        const p = { t: parseInt(tm[1]), msg, cat: 'klr' };
        if (delay_us != null) p.delay_us = delay_us;
        if (pulse_ms != null) p.pulse_ms = pulse_ms;
        p.asserted   = /asserted/i.test(msg);
        p.deasserted = /deasserted/i.test(msg);
        phases.push(p);
      }

    // ── DME [PHASE] — bare or DME: prefixed (combined log) ───
    // Tag as cat:'dme' so KLR charts filter these out
    } else if (t.startsWith('[PHASE]') || t.startsWith('DME: [PHASE]')) {
      const p = parsePhaseLine(t);
      if (p) { p.cat = 'dme'; phases.push(p); }
    }
  }
  phases.sort((a, b) => a.t - b.t);
  return { snapshots, phases, status };
}
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
  tabBar:{background:C.panelBg,borderBottom:`1px solid ${C.border}`,flexShrink:0},
  tabRow:{display:'flex',gap:'2px',padding:'4px 10px 0'},
  tabRowKlr:{display:'flex',gap:'2px',padding:'2px 10px 0',borderTop:`1px solid #0a2a0a`},
  tab:a=>({padding:'4px 12px',cursor:'pointer',fontFamily:'inherit',fontSize:'10px',
           letterSpacing:'0.08em',border:'none',outline:'none',
           background:a?'#0d2e0d':'transparent',color:a?C.textBright:C.textDim,
           borderTop:a?`1px solid ${C.textBright}`:'1px solid transparent',transition:'all .15s'}),
  tabKlr:a=>({padding:'4px 12px',cursor:'pointer',fontFamily:'inherit',fontSize:'10px',
              letterSpacing:'0.08em',border:'none',outline:'none',
              background:a?'#001a22':'transparent',color:a?'#44aaff':C.textDim,
              borderTop:a?`1px solid #44aaff`:'1px solid transparent',transition:'all .15s'}),
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
  const [klrData, setKlrData]     = useState({ snapshots:[], phases:[], status:[] });
  const [klrIdx, setKlrIdx]       = useState(0);
  const [klrPlaying, setKlrPlaying] = useState(false);
  const [klrPlaySpeed, setKlrPlaySpeed] = useState(100);
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

  // KLR playback engine — steps through KLR phases (events)
  useEffect(() => {
    if (!klrPlaying || !klrData.phases?.length) return;
    const id = setInterval(() => {
      setKlrIdx(i => {
        if (i >= klrData.phases.length - 1) { setKlrPlaying(false); return i; }
        return i + 1;
      });
    }, klrPlaySpeed);
    return () => clearInterval(id);
  }, [klrPlaying, klrPlaySpeed, klrData.phases?.length]);

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
        const dme = parseLog(text);
        const klr = parseKLRLog(text);
        setData(dme);
        setKlrData(klr);
        setIdx(0);
        setKlrIdx(0);
        setPlaying(false);
        setKlrPlaying(false);
        if (dme.snapshots.length || dme.phases.length ||
            klr.snapshots.length || klr.phases.length) setShowLog(false);
      })
      .catch(err => console.warn('[DME951] ?log= fetch failed:', err));
  }, []);

  const handleLoadAll = useCallback(() => {
    const dme = parseLog(logText);
    const klr = parseKLRLog(logText);
    setData(dme);
    setKlrData(klr);
    setIdx(0);
    setKlrIdx(0);
    setPlaying(false);
    setKlrPlaying(false);
    if (dme.snapshots.length || dme.phases.length ||
        klr.snapshots.length || klr.phases.length) setShowLog(false);
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
  // Build merged iram: current snap + fill gaps from nearest prior DS snapshot
  const iram = useMemo(() => {
    if (!data.snapshots?.length) return snap.iram ?? {};
    const base = {};
    // Find most recent DS snapshot at or before current index
    for (let i = Math.min(idx, data.snapshots.length - 1); i >= 0; i--) {
      const s = data.snapshots[i];
      if (s && !s.raw?.includes('[STATUS]')) {
        Object.assign(base, s.iram);
        break;
      }
    }
    // Overlay current snap (STATUS values take priority)
    return { ...base, ...(snap.iram ?? {}) };
  }, [data.snapshots, idx, snap]);
  const fuelMsV  = fuelMs(snap);
  const fuelNext = (((iram[0x4F]||0)<<8)|(iram[0x4E]||0))*2/1000;
  const load16   = ((iram[0x46]||0)<<8)|(iram[0x47]||0);
  const wu16     = ((iram[0x58]||0)<<8)|(iram[0x59]||0);
  const lmbd16   = ((iram[0x1B]||0)<<8)|(iram[0x1C]||0);

  const chartData = useMemo(() => {
    // Compute timing advance baseline from first stable snapshots (RPM > 1000)
    // Used to show FQS timing retard as deviation from no-retard baseline
    const stableAdvs = data.snapshots
      .filter(s => (s.refRpm ?? s.explicitRpm ?? 0) > 1000 && s.iram?.[0x31] != null && s.iram[0x31] <= 180)
      .slice(0, 30)
      .map(s => s.iram[0x31]);
    const advBaseline = stableAdvs.length
      ? stableAdvs.reduce((a,b)=>a+b,0) / stableAdvs.length
      : null;
    // Merge DS + STATUS snapshots at same timestamp.
    // DS has full iram[0x00-0x7F]; STATUS has shadowed ADC values.
    // Merged: start with DS iram, overlay STATUS iram on top.
    const byT = new Map();
    for (const s of data.snapshots) {
      const isStatus = s.raw?.includes('[STATUS]');
      if (!byT.has(s.t)) {
        byT.set(s.t, { ...s, iram: { ...s.iram } });
      } else {
        const merged = byT.get(s.t);
        if (isStatus) {
          // STATUS overlays its addresses onto the existing DS iram.
          // For ADC channels with valid-range filtering, skip out-of-range values
          // so they don't overwrite good DS readings with noise.
          for (const [k, v] of Object.entries(s.iram)) {
            const ki = Number(k);
            // STATUS afm_raw(10) uses the shadow register — always authoritative.
            // TPS (0x16) has no STATUS shadow — skip out-of-range values.
            if (ki === 0x16 && v < 0x50) continue;
            merged.iram[ki] = v;
          }
          // Copy STATUS-only fields
          if (s.explicitRpm != null) merged.explicitRpm = s.explicitRpm;
          if (s._prevAfm != null)    merged._prevAfm = s._prevAfm;
          if (s._prevTps != null)    merged._prevTps = s._prevTps;
        } else {
          // DS: only fill addresses not already set by STATUS
          for (const [k,v] of Object.entries(s.iram))
            if (merged.iram[k] === undefined) merged.iram[k] = v;
          if (s.refRpm != null) merged.refRpm = s.refRpm;
          if (s._prevAfm != null && merged._prevAfm == null) merged._prevAfm = s._prevAfm;
          if (s._prevTps != null && merged._prevTps == null) merged._prevTps = s._prevTps;
        }
      }
    }
    const merged = [...byT.values()].sort((a,b) => a.t - b.t);
    let lastCoolant = null, lastAir = null, lastAfm = null, lastTps = null, lastLmbdLn = null, lastLmbdNln = null,
        lastLmbdHi = null, lastLmbdLo = null;
    return merged.map(s => {
      const ir = s.iram ?? {};
      // Show 0ms when fuel is cut (FuelOffCoast = iram[23h].5)
      const fuel = ((ir[0x23] ?? 0) >> 5) & 1 ? 0 : +fuelMs(s).toFixed(3);
      // Use only reference-sensor RPM — null = gap in chart (pre-sync)
      const rpm  = s.refRpm ?? s.explicitRpm ?? null;
      // Temperature: once the log has produced at least one explicit STATUS
      // reading, keep riding that carried-forward value (s._prevCoolantC/
      // s._prevAirC) rather than recomputing from iram[0x13]/[0x12] on every
      // [DS] snapshot. The raw byte at that address is shared with other ADC
      // channels via a hardware mux, so a [DS] dump can catch it mid-scan
      // showing a different channel's value — that's what produces the
      // sawtooth/triangle-wave noise. Only fall back to the NTC-curve
      // estimate before any explicit reading has appeared yet in the log.
      const rawCoolant = s._prevCoolantC ?? ntcToC(ir[0x13]);
      const rawAir     = s._prevAirC     ?? ntcToC(ir[0x12]);
      if (rawCoolant !== null && rawCoolant !== undefined) lastCoolant = rawCoolant;
      if (rawAir     !== null && rawAir     !== undefined) lastAir     = rawAir;
      // AFM from STATUS shadow register (afm_raw_shadow) — always correct.
      // _prevAfm is set only from STATUS snapshots in parseLog.
      // AFM: prefer the STATUS shadow register (_prevAfm) when present, but
      // fall back to the DS snapshot's iram[0x10] so the series still populates
      // on logs that have no STATUS lines (e.g. combined DME+KLR dash logs).
      const afmPrev  = lastAfm;
      const afmSrc   = (s._prevAfm != null) ? s._prevAfm
                     : (ir[0x10]   != null) ? ir[0x10]
                     : null;
      if (afmSrc !== null) lastAfm = afmSrc;
      const afmNow   = lastAfm;
      const afmDelta = (afmNow !== null && afmPrev !== null) ? afmNow - afmPrev : 0;


      return {
        t:         s.t,
        fuel,
        rpm,
        coolant:   lastCoolant,
        lmbdLn:    (() => { const v = ir[0x19] ?? null; if (v !== null) lastLmbdLn = v; return lastLmbdLn; })(),
        lmbdNln:   (() => { const v = ir[0x1A] ?? null; if (v !== null) lastLmbdNln = v; return lastLmbdNln; })(),
        // Lambda correction — 16-bit lambda integrator (Lmbd Int 1B:1C) offset from
        // its 0x8000 centre. Same calculation as the DME Overview callout box.
        lmbdCorr:  (() => {
          const hi = ir[0x1B] ?? null, lo = ir[0x1C] ?? null;
          if (hi !== null) lastLmbdHi = hi;
          if (lo !== null) lastLmbdLo = lo;
          if (lastLmbdHi === null || lastLmbdLo === null) return null;
          return ((lastLmbdHi << 8) | lastLmbdLo) - 0x8000;
        })(),
        isv:       ir[0x7F] ?? null,
        dwell:   rpm != null && rpm >= 40 && ir[0x2F] != null
                   ? +(ir[0x2F] * 60000 / (rpm * HT_PER_REV)).toFixed(2)
                   : null,
        afm:       afmNow,
        afm_delta: afmDelta,
        tps:       (() => { const v = ir[0x16] != null && ir[0x16] >= 0x50 ? ir[0x16] : (s._prevTps ?? null); if (v !== null) lastTps = v; return lastTps; })(),
        // Ignition advance is only meaningful once the crank has synced (rpm valid) —
        // before that, ir[0x31] holds stale/uninitialized RAM and produces a spurious
        // spike at the start of the log. Also sanity-clamp to a physically plausible
        // half-teeth range (0-180 half-teeth ≈ 0-245°BTDC) to reject any other garbage.
        timingAdv: (rpm != null && rpm >= 40 && ir[0x31] != null && ir[0x31] <= 180)
                     ? +(ir[0x31] * 360 / 264).toFixed(1) : null,  // half-teeth → degrees BTDC
        fqsAdv:      ir[0x17] ?? null,  // FQS ADC raw value (0x00=pos0 … 0xA7=pos7)
        timingRetard: (rpm != null && rpm >= 40 && ir[0x31] != null && ir[0x31] <= 180 && advBaseline != null)
                        ? +((advBaseline - ir[0x31]) * 360 / 264).toFixed(2)
                        : null,  // degrees retarded vs baseline (positive = retard)
        loadIdx:   ir[0x49] ?? null,  // load index — fuel map row selector
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
      isv:     mm(s => s.iram?.[0x7F]??null,        v => h2(v)),
      dwell:   mm(s => { const ht=s.iram?.[0x2F]; const r=s.refRpm??s.explicitRpm; return (ht!=null&&r>=40) ? +(ht*60000/(r*HT_PER_REV)).toFixed(2) : null; }, v=>`${v}ms`),
      coolant: mm(s => s._prevCoolantC ?? ntcToC(s.iram?.[0x13]), v=>`${v}°C`),
      airtemp: mm(s => s._prevAirC     ?? ntcToC(s.iram?.[0x12]), v=>`${v}°C`),
      batt:    mm(s => s.iram?.[0x11]!=null ? +(s.iram[0x11]*0.05263+2.132).toFixed(1) : null, v=>`${v}V`),
      afm:     mm(s => s._prevAfm??s.iram?.[0x10]??null, v => h2(v)),
      tps:     mm(s => s._prevTps??s.iram?.[0x16]??null, v => h2(v)),
      wdog:    mm(s => s.iram?.[0x2A]??null,        v => h2(v)),
      load:    mm(s => s.iram?.[0x49]??null,        v => h2(v)),
    };
  }, [data.snapshots]);

  // True once any snapshot has FLAGS21.bit1 set — never goes false.
  // Prevents AFR display flickering from snapshot timing artifacts.
  const clEverActive = useMemo(() =>
    data.snapshots.some(s => ((s.iram?.[0x21] ?? 0) >> 1) & 1),
  [data.snapshots]);

  const TABS = ['overview','ports','iram','charts','phase','diag','klr','klr_ports','klr_iram','klr_charts','klr_phase','klr_diag','klr_boost'];

  return (
    <div style={S.root}>
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={S.hdr}>
        <div>
          <div style={S.title}>▶ PORSCHE 951 DME AND KLR — SIMULATION DEBUG CONSOLE</div>
          <div style={S.sub}>BOSCH MOTRONIC · INTEL 8051 + 8048 · PORSCHE 944 TURBO</div>
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

      {/* ── TABS — two rows ─────────────────────────────────── */}
      <div style={S.tabBar}>
        {/* Row 1 — DME tabs */}
        <div style={S.tabRow}>
          {['overview','ports','iram','charts','phase','diag'].map(t=>(
            <button key={t} style={S.tab(tab===t)} onClick={()=>setTab(t)}>
              {t==='overview'?'DME OVERVIEW':
               t==='ports'   ?'DME PORTS'  :
               t==='iram'    ?'DME IRAM'   :
               t==='charts'  ?'DME CHARTS' :
               t==='phase'   ?'DME PHASE'  :
               t==='diag'    ?'DME DIAG'   :
               t.toUpperCase()}
            </button>
          ))}
        </div>
        {/* Row 2 — KLR tabs */}
        <div style={S.tabRowKlr}>
          {['klr','klr_ports','klr_iram','klr_charts','klr_phase','klr_diag','klr_boost'].map(t=>(
            <button key={t} style={S.tabKlr(tab===t)} onClick={()=>setTab(t)}>
              {t==='klr'       ?'KLR OVERVIEW':
               t==='klr_ports' ?'KLR PORTS'   :
               t==='klr_iram'  ?'KLR IRAM'    :
               t==='klr_charts'?'KLR CHARTS'  :
               t==='klr_phase' ?'KLR PHASE'   :
               t==='klr_diag'  ?'KLR DIAG'    :
               t==='klr_boost' ?'BOOST CONTROL':
               t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB CONTENT ────────────────────────────────────── */}
      <div style={S.content}>
        {tab==='overview' && <OverviewTab snap={snap} iram={iram}
          fuelMsV={fuelMsV} fuelNext={fuelNext} load16={load16} wu16={wu16} lmbd16={lmbd16}
          minmax={minmax} clEverActive={clEverActive} />}
        {tab==='ports'    && <PortsTab snap={snap}
            logHasPorts={data.snapshots.some(s=>s.p1!==undefined)}
            logLoaded={data.snapshots.length>0} />}
        {tab==='iram'     && <IRAMTab iram={{...iram, ...(snap._prevAfm!=null?{0x10:snap._prevAfm}:{}), ...(snap._prevTps!=null?{0x16:snap._prevTps}:{})}} tooltip={tooltip} setTooltip={setTooltip} />}
        {tab==='charts'   && <ChartsTab chartData={chartData} currentT={snap.t} />}
        {tab==='phase'    && <PhaseTab phases={data.phases} currentT={snap.t} />}
        {tab==='diag'     && <DiagTab iram={iram} snap={snap} />}
        {tab==='klr'        && <KLRTab klrData={klrData} currentT={klrData.phases?.[klrIdx]?.t} />}
        {tab==='klr_ports'  && <KLRPortsTab klrData={klrData} klrIdx={klrIdx}
            logHasPorts={klrData.snapshots?.some(s=>s.p1!==undefined||s.p2!==undefined)}
            logLoaded={(klrData.snapshots?.length||0)+(klrData.status?.length||0)>0} />}
        {tab==='klr_iram'   && <KLRIRAMTab  klrData={klrData} klrIdx={klrIdx} />}
        {tab==='klr_charts' && <KLRChartsTab klrData={klrData} currentT={klrData.phases?.[klrIdx]?.t} />}
        {tab==='klr_phase'  && <KLRPhaseTab klrData={klrData} klrIdx={klrIdx} />}
        {tab==='klr_diag'   && <KLRDiagTab  klrData={klrData} klrIdx={klrIdx} />}
        {tab==='klr_boost'  && <BoostControlTab klrData={klrData} klrIdx={klrIdx} dmeSnapshots={data.snapshots} />}
      </div>

      {/* ── TIME SCRUBBER + PLAYBACK ────────────────────────── */}
      {data.snapshots.length>0 && !['klr','klr_ports','klr_iram','klr_charts','klr_phase','klr_diag','klr_boost'].includes(tab) && (
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

      {/* ── KLR PLAYBACK SCRUBBER — KLR tabs only ──────────── */}
      {klrData.phases?.length > 0 && ['klr','klr_ports','klr_iram','klr_charts','klr_phase','klr_diag','klr_boost'].includes(tab) && (
        <div style={{...S.scrubber, borderTop:`1px solid #004433`, background:'#030c08'}}>
          <span style={{color:'#44aaff',fontSize:'9px',whiteSpace:'nowrap',letterSpacing:'.05em'}}>KLR</span>
          <button onClick={()=>setKlrPlaying(p=>!p)}
            style={{...S.btn(klrPlaying?'p':'s'), minWidth:'60px', fontSize:'9px',
                    borderColor: klrPlaying ? '#44aaff' : C.border,
                    color: klrPlaying ? '#44aaff' : C.textDim,
                    boxShadow: klrPlaying ? `0 0 8px #44aaff44` : 'none'}}>
            {klrPlaying ? '⏸ PAUSE' : '▶ PLAY'}
          </button>
          <button onClick={()=>{setKlrPlaying(false);setKlrIdx(i=>Math.max(0,i-1));}}
            style={{...S.btn('s'),padding:'5px 8px'}} title="Step back">◀</button>
          <button onClick={()=>{setKlrPlaying(false);setKlrIdx(i=>Math.min(klrData.phases.length-1,i+1));}}
            style={{...S.btn('s'),padding:'5px 8px'}} title="Step forward">▶</button>
          <button onClick={()=>{setKlrPlaying(false);setKlrIdx(0);}}
            style={{...S.btn('s'),padding:'5px 8px'}} title="Rewind">⏮</button>
          <select value={klrPlaySpeed} onChange={e=>setKlrPlaySpeed(+e.target.value)}
            style={{background:'#030c08',border:`1px solid #004433`,color:C.textDim,
                    fontFamily:'inherit',fontSize:'9px',padding:'3px 4px',cursor:'pointer'}}>
            <option value={500}>0.2×</option>
            <option value={200}>0.5×</option>
            <option value={100}>1×</option>
            <option value={50}>2×</option>
            <option value={20}>5×</option>
            <option value={10}>10×</option>
            <option value={1}>MAX</option>
          </select>
          <input type="range" min={0} max={klrData.phases.length-1} value={klrIdx}
            onChange={e=>{setKlrPlaying(false);setKlrIdx(+e.target.value);}}
            style={{flex:1, accentColor:'#44aaff', cursor:'pointer'}}/>
          <span style={{color:'#44aaff',fontSize:'12px',whiteSpace:'nowrap',minWidth:'90px',
                        textAlign:'right',textShadow:`0 0 8px #44aaff66`}}>
            t={klrData.phases[klrIdx]?.t ?? '---'} ms
          </span>
          <span style={{color:C.textDim,fontSize:'9px',whiteSpace:'nowrap'}}>
            {klrIdx+1}/{klrData.phases.length}
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
              placeholder={"DME: [DS] ... (DME snapshot)\nKLR: [DS] ... (KLR snapshot)\nDME: [PHASE] / KLR: [PHASE] ...\n\nPaste your .dash.log file here or drag and drop."}
            />
            <div style={{color:C.textDim,fontSize:'9px',marginTop:'4px',marginBottom:'14px'}}>
              Supports combined DME+KLR logs (<code>DME: [DS]</code> / <code>[KLR]</code>),
              DME-only logs (<code>[DS]</code> / <code>[STATUS]</code>), and legacy formats.
              All data is parsed in one pass.
            </div>
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',flexWrap:'wrap'}}>
              {(data.snapshots.length > 0 || data.phases.length > 0 ||
                klrData.snapshots.length > 0) && (
                <button style={S.btn('s')} onClick={()=>setShowLog(false)}>CANCEL</button>
              )}
              <button style={S.btn('p')} onClick={handleLoadAll}>
                PARSE &amp; LOAD →
              </button>
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
  const f20=iram[0x20]??0, f21=iram[0x21]??0, f22=iram[0x22]??0, f23=iram[0x23]??0,
        f24=iram[0x24]??0, f25=iram[0x25]??0;

  const prpm    = iram[0x37];
  const rpm     = snapRpm(snap);
  // Carry forward last valid temperature — raw ADC (0x20) briefly appears
  // in iram[0x12/13] mid-scan before linearisation; ignore those readings.
  // Prefer explicit ground-truth degC from STATUS lines (e.g. "80 degC") over
  // the NTC-curve estimate, which is only an approximation of the real curve.
  const coolC   = snap.explicitCoolantC ?? snap._prevCoolantC ?? ntcToC(iram[0x13]) ?? ntcToC(snap._prevCoolant);
  const airC    = snap.explicitAirC     ?? snap._prevAirC     ?? ntcToC(iram[0x12]) ?? ntcToC(snap._prevAir);
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

  // Lambda correction — 16-bit lambda integrator (Lmbd Int 1B:1C) offset from
  // its 0x8000 centre. Positive = correction added (lean-side trim), negative
  // = correction removed (rich-side trim).
  const lmbdCorrRaw = lmbd16 - 0x8000;
  const lmbdCorrSign = lmbdCorrRaw >= 0 ? '+' : '−';
  const lmbdCorrAbs  = Math.abs(lmbdCorrRaw);
  const lmbdCorrHex  = (lmbdCorrRaw < 0 ? '-' : '') + '0x' + lmbdCorrAbs.toString(16).toUpperCase().padStart(4,'0');
  const lmbdCorrCol  = lmbdCorrRaw > 0 ? '#44aaff' : lmbdCorrRaw < 0 ? '#ff6644' : '#66ffaa';

  // Hover text for metric cards, sourced from IRAM_MAP (disassembly data)
  const iramDesc = addr => {
    const e = IRAM_MAP.find(x => x.a === addr);
    return e ? `0x${addr.toString(16).toUpperCase().padStart(2,'0')} ${e.n} — ${e.d}` : undefined;
  };

  const metricsRow1 = [
    { lbl:'ENGINE SPEED',  val:rpm != null ? rpm : '---',              unit:'RPM',         col:C.textBright, mmk:'rpm', addr:0x37 },
    { lbl:'FUEL PULSE',    val:fuelDisplay,                              unit:fuelUnit,      col:fuelCut?C.red:'#66ff66', mmk:'fuel', addr:0x4B    },
    { lbl:'DWELL',         val:`${dwMs}ms`,   unit:`${dwDeg??'--'}° / ${dwHt??'--'} ht`, col:'#ff8844', mmk:'dwell', addr:0x2F   },
    { lbl:'LAMBDA CORR',   val:`${lmbdCorrSign}${lmbdCorrAbs}`,
                           unit:`${lmbdCorrHex}  (1B:1C−8000h)`,       col:lmbdCorrCol, mmk:null, addr:0x1B },
    { lbl:'Accel Enrich (4C)',val:h2(iram[0x4C]),                       unit:'hex',         col:'#ff9944', mmk:null, addr:0x4C      },
  ];

  const metricsRow2 = [
    { lbl:'AFM RAW (10h)',    val:h2(snap._prevAfm ?? iram[0x10]),                       unit:'hex',         col:'#44cccc', mmk:'afm', addr:0x10     },
    { lbl:'TPS',           val:h2(snap._prevTps ?? iram[0x16]),
                           unit:(snap._prevTps??iram[0x16])===0x85?'CLOSED/IDLE':(snap._prevTps??iram[0x16])===0xCC?'WOT':(snap._prevTps??iram[0x16])===0xF2?'PARTIAL':'--',
                           col:(snap._prevTps??iram[0x16])===0x85?'#44cccc':(snap._prevTps??iram[0x16])===0xCC?C.red:(snap._prevTps??iram[0x16])===0xF2?C.amber:C.textDim,
                           mmk:'tps', addr:0x16 },
    { lbl:'COOLANT',       val:coolC!==null?`${coolC}°C`:'--',       unit:`0x${h2(iram[0x13])}`, col:C.blue, mmk:'coolant', addr:0x13 },
    { lbl:'AIR TEMP',      val:airC !==null?`${airC}°C` :'--',       unit:`0x${h2(iram[0x12])}`, col:C.blue, mmk:'airtemp', addr:0x12 },
    { lbl:'BATTERY',       val:`${battV}V`,                            unit:`0x${h2(iram[0x11])}`, col:battCol, mmk:'batt', addr:0x11   },
  ];

  const metricsRow3 = [
    { lbl:'LOAD (49h)',    val:h2(iram[0x49]),                       unit:`map row ${iram[0x49]??'--'}`, col:'#88ccff', mmk:'load', addr:0x49 },
    { lbl:'ISV STEP',      val:h2(iram[0x7F]),                       unit:'hex',         col:'#ff44aa', mmk:'isv', addr:0x7F     },
    { lbl:'WATCHDOG',      val:h2(iram[0x2A]),                       unit:'hex',         col:(iram[0x2A]??255)<5?C.red:C.textBright, mmk:'wdog', addr:0x2A },
    { lbl:'EST. AFR',      val:estAFR ?? afrLabel,
                           unit:clActive ? `${afrLabel}  O2:${o2Lean?'LEAN':'RICH'}` : 'narrowband NB',
                           col:afrCol, mmk:null, addr:null },
  ];


  // Control flags — from disassemble3.xlsx bit_mem sheet (43 named bits, 0x20-0x25)
  // Control flags — from disassemble3.xlsx bit_mem sheet (all 48 documented bits, 0x20-0x25)
  const flags = [
    { name:'ISV_FLARE_VARIANT', val:(f20>>0)&1, col:'#66ffaa', addr:'20h.0', desc:'ISV flare variant: 0 = return to idle, 1 = startup' },
    { name:'init_flag', val:(f20>>1)&1, col:'#cc66ff', addr:'20h.1', desc:'at startup phase, a locally used init flag' },
    { name:'ISV_RPM_ERR_SIGN_LAMBDA_COND_CURRENT', val:(f20>>2)&1, col:'#66ffaa', addr:'20h.2', desc:'ISV idle rpm error sign: 1 = rpm too high, 0 = rpm too low. *reused for lambda:* current condition, 0 = lean, 1 = not lean' },
    { name:'ISV_INT_BLOCK_POS', val:(f20>>3)&1, col:'#66ffaa', addr:'20h.3', desc:'blocks integration when a positive ISV correction is clamped' },
    { name:'ISV_INT_BLOCK_NEG', val:(f20>>4)&1, col:'#66ffaa', addr:'20h.4', desc:'blocks integration when a negative ISV correction is clamped, or when load is below the Map 87 value' },
    { name:'ISV_PWM_OVF_SIGN', val:(f20>>5)&1, col:'#66ffaa', addr:'20h.5', desc:'ISV PWM correction overflow sign (which way to clamp)' },
    { name:'ISV_FLARE_NEEDED', val:(f20>>6)&1, col:'#66ffaa', addr:'20h.6', desc:'an idle flare is needed on return to idle' },
    { name:'LAMBDA_ENABLE', val:(f20>>7)&1, col:'#44cccc', addr:'20h.7', desc:'master enable for closed loop lambda control; only set on US (cat/O2) cars' },
    { name:'OVERLOAD_PRETIMER_RUN', val:(f21>>0)&1, col:'#ff88cc', addr:'21h.0', desc:'the ~3 second overload pre-timer is running' },
    { name:'OVERLOAD_LOCKOUT_RUN', val:(f21>>1)&1, col:'#ff88cc', addr:'21h.1', desc:'overload confirmed; the ~60 second lockout is running' },
    { name:'INJECTORS_ON', val:(f21>>2)&1, col:'#ff6644', addr:'21h.2', desc:'injectors are currently on' },
    { name:'RESERVED_21H_3', val:(f21>>3)&1, col:'#cc66ff', addr:'21h.3', desc:'undefined/unknown' },
    { name:'CRANK_ENR_PHASEOUT_LATCH', val:(f21>>4)&1, col:'#ffcc44', addr:'21h.4', desc:'latch marking that the cranking enrichment phase-out has started' },
    { name:'FUEL_REACT_TRANS_ACTIVE', val:(f21>>5)&1, col:'#ff88cc', addr:'21h.5', desc:'transient fuel correction after reactivation is active' },
    { name:'FUELCUT_REACT_MODE', val:(f21>>6)&1, col:'#ff88cc', addr:'21h.6', desc:'selects return-to-idle (Map 1140) vs return-to-throttle (Map 1150)' },
    { name:'ACCEL_PUMP_SHOT_LATCH', val:(f21>>7)&1, col:'#88ccff', addr:'21h.7', desc:'latch for a pending 4Ch acceleration enrichment pump shot' },
    { name:'IGN_HALFTOOTH_CORR', val:(f22>>0)&1, col:'#ff8844', addr:'22h.0', desc:'half-tooth correction applied to the next ignition event' },
    { name:'IGN_HALFTOOTH_ROUND_ERR', val:(f22>>1)&1, col:'#ff8844', addr:'22h.1', desc:'half-tooth rounding error left over from the 021D calculation' },
    { name:'Unreferenced', val:(f22>>2)&1, col:'#cc66ff', addr:'22h.2', desc:'bit 2 - unreferenced' },
    { name:'COIL_STATE_REF', val:(f22>>3)&1, col:'#ff8844', addr:'22h.3', desc:'coil state to apply in the ref sensor routine (set = dwell off)' },
    { name:'TIMING_RATE_SEL_LOW', val:(f22>>4)&1, col:'#ff6644', addr:'22h.4', desc:'timing change rate select, lowest priority of the three' },
    { name:'TIMING_RATE_SEL_MED', val:(f22>>5)&1, col:'#ff6644', addr:'22h.5', desc:'timing change rate select, medium priority' },
    { name:'TIMING_RATE_SEL_HIGH', val:(f22>>6)&1, col:'#ff6644', addr:'22h.6', desc:'timing change rate select, highest priority' },
    { name:'Time1FlagLowIdle', val:(f22>>7)&1, col:'#cc66ff', addr:'22h.7', desc:'set at start of low idle speed positioner pulse' },
    { name:'TPS_AT_IDLE', val:(f23>>0)&1, col:'#66ffaa', addr:'23h.0', desc:'TPS at idle (1 = at idle)' },
    { name:'WOT_FLAG', val:(f23>>1)&1, col:'#66ffaa', addr:'23h.1', desc:'WOT (1 = WOT). Controlled by the KLR, which calls > 65 deg. WOT' },
    { name:'CRANKING_FLAG', val:(f23>>2)&1, col:'#cc66ff', addr:'23h.2', desc:'cranking (1 = rpm below 160). Cleared at a temperature-dependent threshold from Map 3' },
    { name:'ISV_ALT_PATH', val:(f23>>3)&1, col:'#66ffaa', addr:'23h.3', desc:'ISV alternate code path, set via ADC channel 5 (DME pin 28)' },
    { name:'STARTUP_FLAG', val:(f23>>4)&1, col:'#44cccc', addr:'23h.4', desc:'startup' },
    { name:'FUEL_CUT_FLAG', val:(f23>>5)&1, col:'#ff88cc', addr:'23h.5', desc:'fuel cut, for coasting or overload' },
    { name:'TRG_IDLE_FLARE', val:(f23>>6)&1, col:'#ffcc44', addr:'23h.6', desc:'trigger the idle flare (rpm increase above normal target)' },
    { name:'TXDLambdaDiag', val:(f23>>7)&1, col:'#cc66ff', addr:'23h.7', desc:'used for lambda diag' },
    { name:'LAMBDA_WATCHDOG_EN', val:(f24>>0)&1, col:'#44cccc', addr:'24h.0', desc:'lambda watchdog enable; always set in the production code' },
    { name:'LAMBDA_LOAD_TIMER_RUN', val:(f24>>1)&1, col:'#44cccc', addr:'24h.1', desc:'the load threshold timer (3Fh) is running' },
    { name:'LAMBDA_WATCHDOG_ACTIVE', val:(f24>>2)&1, col:'#44cccc', addr:'24h.2', desc:'watchdog countdown active; never set by reachable code' },
    { name:'LAMBDA_NEUTRAL_PHASE', val:(f24>>3)&1, col:'#44cccc', addr:'24h.3', desc:'the lambda-neutral timer phase is running' },
    { name:'LAMBDA_RICHLEAN_PHASE', val:(f24>>4)&1, col:'#44cccc', addr:'24h.4', desc:'the rich/lean timer phase is running' },
    { name:'LAMBDA_COND_MET', val:(f24>>5)&1, col:'#44cccc', addr:'24h.5', desc:'all lambda threshold conditions are met (1 = correction permitted)' },
    { name:'LAMBDA_COND_PREV', val:(f24>>6)&1, col:'#44cccc', addr:'24h.6', desc:'previous value of 20h.2: 0 = previously lean, 1 = previously not lean' },
    { name:'LAMBDA_COND_PERSISTED', val:(f24>>7)&1, col:'#44cccc', addr:'24h.7', desc:'the current condition has persisted long enough to act on' },
    { name:'Unused', val:(f25>>0)&1, col:'#cc66ff', addr:'25h.0', desc:'bit 0-1 - only has purpose in unused functions' },
    { name:'Unused', val:(f25>>1)&1, col:'#cc66ff', addr:'25h.1', desc:'bit 0-1 - only has purpose in unused functions' },
    { name:'MapLookFail', val:(f25>>2)&1, col:'#cc66ff', addr:'25h.2', desc:'map lookup failed' },
    { name:'DiagNotSet', val:(f25>>3)&1, col:'#cc66ff', addr:'25h.3', desc:'bit 3 - 1= diagnostics mode not set, =0 when mode has been selected' },
    { name:'COLD_CRANK_LAMBDA_SEL', val:(f25>>4)&1, col:'#44cccc', addr:'25h.4', desc:'NTC II was below ~14.7C while cranking; selects the lambda enable temperature' },
    { name:'COLD_CRANK_WARMUP_SEL', val:(f25>>5)&1, col:'#ffcc44', addr:'25h.5', desc:'NTC II was below ~14.7C while cranking; selects between warmup maps 43 and 45' },
    { name:'REGION_CODE', val:(f25>>6)&1, col:'#cc66ff', addr:'25h.6', desc:'region coding: 0 = US, 1 = RoW' },
    { name:'ALTITUDE_HIGH_FLAG', val:(f25>>7)&1, col:'#ffcc44', addr:'25h.7', desc:'altitude sensor: 1 = above 1000M' },
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
      {/* Big metrics — row 1 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'6px',marginBottom:'6px'}}>
        {metricsRow1.map(m=>{
          const mmv = mm[m.mmk] || {};
          return (
            <div key={m.lbl} style={S.metric} title={m.addr!=null ? iramDesc(m.addr) : undefined}>
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

      {/* Big metrics — row 2 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'6px',marginBottom:'6px'}}>
        {metricsRow2.map(m=>{
          const mmv = mm[m.mmk] || {};
          return (
            <div key={m.lbl} style={S.metric} title={m.addr!=null ? iramDesc(m.addr) : undefined}>
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

      {/* Big metrics — row 3 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'6px',marginBottom:'10px'}}>
        {metricsRow3.map(m=>{
          const mmv = mm[m.mmk] || {};
          return (
            <div key={m.lbl} style={S.metric} title={m.addr!=null ? iramDesc(m.addr) : undefined}>
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
          <div style={S.panelTitle}>CONTROL FLAGS &nbsp;
            <span style={{color:C.textDim,fontSize:'8px'}}>hover any flag for full description</span>
          </div>
          <div style={{maxHeight:'420px',overflow:'auto'}}>
            {flags.map(f=>(
              <div key={f.name+f.addr} title={f.desc}
                style={{
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
                <span style={{color:f.val?f.col:'#335533',fontSize:'10px',flex:1,
                              overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{f.name}</span>
                <span style={{color:C.textDim,fontSize:'9px',flexShrink:0}}>{f.addr}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  PORTS TAB
// ─────────────────────────────────────────────────────────────────
function PortsTab({ snap, logHasPorts, logLoaded }) {
  const portVals = { P1: snap?.p1, P2: snap?.p2, P3: snap?.p3 };
  const hasLive  = snap?.p1 !== undefined;
  const portDescs = {
    P1: 'ANALOG I/O — injector, ignition, O2 sensor',
    P2: 'ADDRESS BUS / ADC CHANNEL SELECT',
    P3: 'CRANK SENSORS · SERIAL · /RD /WR STROBES',
  };
  return (
    <div>
      {logLoaded && !logHasPorts && (
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
      No snapshot data loaded — use LOAD LOG to parse a log file
    </div>
  );

  const ax = {fill:C.textDim,fontSize:10,fontFamily:"'Share Tech Mono',monospace"};
  const charts = [
    {title:'INJECTION PULSE WIDTH',  k:'fuel',    col:'#66ff66', unit:'ms',      dom:[0,'auto']},
    {title:'ENGINE SPEED (RPM)',     k:'rpm',     col:C.textBright,unit:'RPM',   dom:[0,'auto']},
    {title:'AFM RAW (10h)',          k:'afm',     col:'#44cccc', unit:'hex',     dom:[0,255],    cn:true},
    {title:'AFM DELTA (snapshot)',   k:'afm_delta',col:'#ff9944', unit:'Δhex',   dom:['auto','auto'], cn:false},
    {title:'TPS RAW (16h)',          k:'tps',     col:'#ffcc44', unit:'hex',     dom:[0,255],    cn:true},
    {title:'ISV STEP POSITION',      k:'isv',     col:'#ff44aa', unit:'hex',     dom:[0,255],    cn:true},
    {title:'LAMBDA ADJ — CORRECTION (1B:1C)', k:'lmbdCorr', col:'#cc66ff', unit:'d', dom:['auto','auto'], cn:true},
    {title:'DWELL TIME (2F)',         k:'dwell',      col:'#ff8844', unit:'ms',  dom:[0,'auto'],    cn:true},
    {title:'COOLANT TEMP (13)',       k:'coolant',    col:C.blue,    unit:'°C',  dom:[-20,120],     cn:true},
    {title:'IGNITION ADVANCE (31)',   k:'timingAdv',    col:'#ff4444', unit:'°BTDC',    dom:[0,'auto'],      cn:true},
    {title:'FQS TIMING RETARD (°)',   k:'timingRetard', col:'#ff8800', unit:'°retard',  dom:['auto','auto'], cn:true},
    {title:'FQS ADC RAW (17h)',       k:'fqsAdv',       col:'#aaffaa', unit:'hex',      dom:[0,255],         cn:true},
    {title:'LOAD INDEX (49h)',        k:'loadIdx',      col:'#88ccff', unit:'hex',      dom:[0,255],         cn:true},
  ];

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
      {charts.map(c=>(
        <div key={c.k} style={S.panel}>
          <div style={S.panelTitle}>{c.title}</div>
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart data={chartData} margin={{top:2,right:36,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d" />
              <XAxis dataKey="t" type="number" domain={['dataMin','dataMax']} tick={ax} tickFormatter={v=>`${v}ms`} stroke={C.textDim} />
              <YAxis yAxisId="left"  tick={ax} domain={c.dom} stroke={C.textDim} />
              <YAxis yAxisId="right" tick={ax} domain={[0,7000]} stroke="#888855"
                     orientation="right" tickFormatter={v=>`${v}`} width={36}/>
              <Tooltip
                contentStyle={{background:'#060e06',border:`1px solid ${c.col}55`,
                               color:c.col,fontSize:'11px',fontFamily:'inherit'}}
                formatter={(v,n)=>n==='rpm'?[`${v} RPM`,'RPM']:c.unit==='hex'?[`0x${v.toString(16).toUpperCase().padStart(2,'0')} (${v}d)`,n]:c.unit==='°BTDC'?[`${v}°BTDC`,n]:c.unit==='°retard'?[`${v}° retard`,n]:[v,n]}
                labelFormatter={t=>`t=${t} ms`}
              />
              {currentT !== undefined &&
                <ReferenceLine yAxisId="left" x={currentT} stroke={C.textDim} strokeDasharray="3 3" />}
              <Line yAxisId="left"  type="monotone" dataKey={c.k}    stroke={c.col}
                    dot={false} strokeWidth={1.5} connectNulls={c.cn??false} />
              {c.k !== 'rpm' &&
                <Line yAxisId="right" type="monotone" dataKey="rpm" stroke="#888855"
                      dot={false} strokeWidth={1} connectNulls={false} strokeDasharray="4 2" />}
            </ComposedChart>
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

// ── KLRTab ────────────────────────────────────────────────────────
function KLRTab({ klrData, currentT }) {
  if (!klrData || (klrData.snapshots.length === 0 && klrData.phases.length === 0 && (!klrData.status || klrData.status.length === 0))) {
    return (
      <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'11px'}}>
        No KLR data loaded — use <strong style={{color:C.textBright}}>PARSE &amp; LOAD</strong> with a combined log containing{' '}
        <code style={{color:'#44aaff'}}>[KLR]</code> or <code style={{color:'#44aaff'}}>KLR: [STATUS]</code> lines
      </div>
    );
  }

  // ── Latest status snapshot ──────────────────────────────────
  const latestStatus = klrData.status?.filter(s => s.t <= (currentT ?? Infinity)).slice(-1)[0];
  const latestSnap   = klrData.snapshots?.filter(s => s.t <= (currentT ?? Infinity)).slice(-1)[0];
  const ram = latestSnap?.ram ?? {};

  // ── IGN events up to currentT ──────────────────────────────
  const ignEvents = klrData.phases?.filter(p => p.cat === 'klr' && p.t <= (currentT ?? Infinity)) ?? [];
  const lastAssert   = [...ignEvents].reverse().find(p => p.asserted);
  const lastDeassert = [...ignEvents].reverse().find(p => p.deasserted);

  // ── Counts ─────────────────────────────────────────────────
  const totalFires = ignEvents.filter(p => p.asserted).length;
  const delays     = ignEvents.filter(p => p.delay_us != null).map(p => p.delay_us);
  const pulses     = ignEvents.filter(p => p.pulse_ms != null).map(p => p.pulse_ms);
  const avgDelay   = delays.length ? (delays.reduce((a,b)=>a+b,0)/delays.length).toFixed(2) : '--';
  const avgPulse   = pulses.length ? (pulses.reduce((a,b)=>a+b,0)/pulses.length).toFixed(3) : '--';

  // Merge ram vals from status ramVals into ram display
  const ramDisplay = { ...ram };
  if (latestStatus?.ramVals) Object.assign(ramDisplay, latestStatus.ramVals);

  // Boost / MAP pressure — ram[0x52]. ADC-read routine adds 10 units
  // before storing here (software-units scale), and per the KLR memory
  // map docs, ~1.2 software units = 1 kPa absolute. Converted to gauge
  // PSI (relative to ~101.3kPa atmospheric) — conventional boost-gauge units.
  //   https://jhnbyrn.github.io/951-KLR-PAGES/klr_memory_map.html
  const boostRaw = ramDisplay[0x52];
  const boostKpa = boostRaw != null ? boostRaw / 1.2 : null;
  const boostPsiGauge = boostKpa != null ? +((boostKpa - 101.3) * 0.145038).toFixed(1) : null;

  const sig = [
    { l:'AVG PULSE',  v: `${avgPulse}ms`, col: '#44cccc' },
    { l:'AVG DELAY',  v: `${avgDelay}μs`, col: '#44cccc' },
    { l:'KNOCK COUNT', v: latestStatus?.knock_count != null ? `${latestStatus.knock_count}` : 'N/A',
      col: (latestStatus?.knock_count ?? 0) > 0 ? C.red : '#cc66ff' },
    { l:'FULL LOAD',  v: latestStatus?.full_load != null ? (latestStatus.full_load?'YES':'NO') : '--',
      col: latestStatus?.full_load ? C.amber : C.textBright },
    { l:'CV PWM',     v: latestStatus?.CV_PWM != null ? (latestStatus.CV_PWM?'ON':'OFF') : '--',
      col: '#66ffaa' },
    { l:'TIMER',      v: latestStatus?.timer_val != null ? `0x${h2(latestStatus.timer_val)}` : '--',
      col: C.textBright },
    { l:'IGN FIRES',  v: totalFires, col: '#ff8844' },
    { l:'BOOST',      v: boostPsiGauge != null ? `${boostPsiGauge>=0?'+':''}${boostPsiGauge}psi` : '--',
      col: boostPsiGauge != null && boostPsiGauge > 0 ? C.amber : '#88ccff', addr: 0x52 },
  ];

  const regs = latestStatus ? [
    ['PC', latestStatus.pc != null ? `0x${latestStatus.pc.toString(16).toUpperCase()}` : '--'],
    ['R0', latestStatus.R0 != null ? h2(latestStatus.R0) : '--'],
    ['R2', latestStatus.R2 != null ? h2(latestStatus.R2) : '--'],
    ['R4', latestStatus.R4 != null ? h2(latestStatus.R4) : '--'],
    ['R5', latestStatus.R5 != null ? h2(latestStatus.R5) : '--'],
    ['IRQ', latestStatus.irq != null ? String(latestStatus.irq) : '--'],
    ['MB',  latestStatus.mb  != null ? String(latestStatus.mb)  : '--'],
    ['SP',  latestStatus.SP  != null ? String(latestStatus.SP)  : '--'],
  ] : [];

  return (
    <div>
      {/* ── Signal metrics ─────────────────────────────────── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:'5px', marginBottom:'8px'}}>
        {sig.map(s => (
          <div key={s.l} style={S.metric}
               title={s.addr != null ? `0x${s.addr.toString(16).toUpperCase().padStart(2,'0')} ${KLR_KNOWN[s.addr]?.n ?? ''} — ${KLR_KNOWN[s.addr]?.d ?? ''}` : undefined}>
            <div style={S.metricLbl}>{s.l}</div>
            <div style={{...S.metricVal, color:s.col, fontSize:'12px', margin:'2px 0'}}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{marginBottom:'8px'}}>
        {/* ── Last IGN event ─────────────────────────────── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>LAST IGNITION EVENT</div>
          {lastAssert ? (
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px'}}>
              {[
                ['Event time', `${lastAssert.t} ms`],
                ['Delay from ign_in', lastAssert.delay_us != null ? `${lastAssert.delay_us.toFixed(2)} μs` : '--'],
                ['Pulse width', lastDeassert?.pulse_ms != null ? `${lastDeassert.pulse_ms.toFixed(3)} ms` : '--'],
                ['Total IGN fires', `${totalFires}  (avg ${avgDelay}μs delay)`],
              ].map(([l,v]) => (
                <div key={l} style={{padding:'3px 6px', borderBottom:`1px solid ${C.border}`, fontSize:'10px'}}>
                  <span style={{color:C.textDim}}>{l}: </span>
                  <span style={{color:C.textBright}}>{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{color:C.textDim, fontSize:'10px', padding:'8px'}}>
              No IGN events yet at t={currentT ?? '---'}ms
            </div>
          )}

          {/* ── 8048 Registers ───────────────────────────── */}
          {regs.length > 0 && (
            <>
              <div style={{...S.panelTitle, marginTop:'8px'}}>8048 REGISTERS</div>
              <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'2px'}}>
                {regs.map(([l,v]) => (
                  <div key={l} style={{display:'flex', justifyContent:'space-between',
                                       padding:'2px 5px', borderBottom:`1px solid ${C.border}`, fontSize:'10px'}}>
                    <span style={{color:C.textDim}}>{l}</span>
                    <span style={{color:C.textBright}}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── IGN event log ──────────────────────────────────── */}
      <div style={S.panel}>
        <div style={S.panelTitle}>KLR IGNITION EVENT LOG — {ignEvents.length} events</div>

        {/* Timeline bar */}
        {ignEvents.length > 0 && (() => {
          const maxT = klrData.phases[klrData.phases.length-1]?.t || 1;
          const pct = currentT != null ? (currentT/maxT)*100 : null;
          return (
            <div style={{position:'relative',height:'24px',background:'#040904',
                         border:`1px solid ${C.border}`,borderRadius:'2px',
                         overflow:'hidden',marginBottom:'8px'}}>
              {ignEvents.filter(p=>p.asserted).map((p,i) => (
                <div key={i} title={`${p.t}ms — ${p.msg}`}
                     style={{position:'absolute',left:`${(p.t/maxT)*100}%`,
                             top:0,width:'2px',height:'100%',background:'#ff8844',opacity:.9}}/>
              ))}
              {pct!=null&&<div style={{position:'absolute',left:`${pct}%`,top:0,
                                       width:'1px',height:'100%',background:C.textBright}}/>}
            </div>
          );
        })()}

        <div style={{maxHeight:'280px', overflow:'auto'}}>
          {[...ignEvents].reverse().slice(0, 80).map((p,i) => (
            <div key={i} style={{display:'flex', alignItems:'baseline', gap:'8px',
                                  padding:'2px 6px', marginBottom:'1px', fontSize:'10px',
                                  borderLeft:`3px solid ${p.asserted?'#ff8844':'#44aaff'}`,
                                  background:C.panelBg}}>
              <span style={{color:p.asserted?'#ff8844':'#44aaff', minWidth:'65px'}}>{p.t} ms</span>
              <span style={{color:C.text, flex:1}}>{p.msg}</span>
              {p.delay_us != null && (
                <span style={{color:'#44cccc', fontSize:'9px'}}>{p.delay_us.toFixed(2)}μs</span>
              )}
              {p.pulse_ms != null && (
                <span style={{color:'#cc66ff', fontSize:'9px'}}>{p.pulse_ms.toFixed(3)}ms</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── KLRChartsTab ──────────────────────────────────────────────────
// Charts for KLR knock controller signals over simulation time.
//
// Data sources:
//   klrData.phases (KLR: [PHASE]) → IGN delay, IGN pulse width
//   klrData.status (KLR: [STATUS]) → CV_PWM, knock
//   klrData.snapshots ([KLR]) → p1/p2 port state
//
// Each chart uses Recharts ResponsiveContainer with the same
// green-on-black theme as the DME charts tab.
function KLRChartsTab({ klrData, currentT }) {
  // Filter to KLR-only phases (exclude DME phase entries tagged cat:'dme')
  const klrPhases = (klrData?.phases ?? []).filter(p => p.cat === 'klr');
  const klrStatus = klrData?.status ?? [];
  // If currentT predates KLR data (e.g. from a DME phase entry at t=2ms),
  // default to showing all data up to the last KLR timestamp.
  const firstKlrT = klrPhases[0]?.t ?? klrStatus[0]?.t;
  const lastKlrT  = klrPhases[klrPhases.length-1]?.t ?? klrStatus[klrStatus.length-1]?.t;
  const effectiveT = (currentT == null || (firstKlrT != null && currentT < firstKlrT))
    ? lastKlrT
    : currentT;

  const empty = !klrData ||
    (klrData.phases?.length === 0 && klrData.status?.length === 0 && klrData.snapshots?.length === 0);

  if (empty) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'11px'}}>
      No KLR data — use <strong style={{color:C.textBright}}>PARSE &amp; LOAD</strong> with a combined log
    </div>
  );

  // ── Build chart datasets ──────────────────────────────────
  // IGN delay — one point per asserted event with a measured delay.
  // First 5s is noisy cranking/sync data, and any single reading above
  // 200μs is treated as sensor/measurement noise rather than a real spark
  // delay — keep those points (so all 4 charts share the same time axis /
  // line up) but zero their delay value instead of dropping them.
  // Firing order 1st→cyl1, 2nd→cyl2, 3rd→cyl3, 4th→cyl4, 5th→cyl1, ... (4-stroke
  // firing order repeats every 4 IGN_OUT assertions).
  const IGN_IGNORE_MS   = 5000;
  const IGN_NOISE_US    = 200;
  const ignDelayEvents = klrPhases
    .filter(p => p.asserted && p.delay_us != null &&
                 (effectiveT == null || p.t <= effectiveT))
    .map(p => {
      const raw = +p.delay_us.toFixed(2);
      const noisy = p.t < IGN_IGNORE_MS || raw > IGN_NOISE_US;
      return { t: p.t, delay: noisy ? 0 : raw };
    });

  const ignDelayByCyl = [1, 2, 3, 4].map(cyl =>
    ignDelayEvents.filter((_, i) => (i % 4) + 1 === cyl)
  );

  // Shared y-axis max across all 4 cylinder charts, so they're directly
  // comparable at a glance instead of each auto-scaling independently.
  const ignDelayMax = Math.max(
    1, ...ignDelayByCyl.flat().map(d => d.delay ?? 0)
  );

  const ignPulseData = klrPhases
    .filter(p => p.deasserted && p.pulse_ms != null && (effectiveT == null || p.t <= effectiveT))
    .map(p => ({ t: p.t, pulse: p.t < IGN_IGNORE_MS ? 0 : +p.pulse_ms.toFixed(3) }));

  // CV_PWM and knock from STATUS lines
  const statusData = klrStatus.filter(s => effectiveT == null || s.t <= effectiveT).map(s => ({
    t: s.t,
    cv_pwm: s.CV_PWM ?? null,
    knock:  s.knock  ?? null,
    knock_count: s.knock_count ?? null,
  }));

  // Boost / MAP pressure (ram[0x52]) — merged from periodic [DS] hex
  // snapshots (always has it) and any explicit STATUS ram[52]= lines,
  // sorted chronologically. ~1.2 software units = 1 kPa absolute, per
  // https://jhnbyrn.github.io/951-KLR-PAGES/klr_memory_map.html
  // Converted to gauge PSI (relative to ~101.3kPa atmospheric) — the
  // conventional units for a boost gauge readout.
  const boostData = [
    ...(klrData.snapshots ?? [])
      .filter(s => (effectiveT == null || s.t <= effectiveT) && s.ram?.[0x52] != null)
      .map(s => ({ t: s.t, raw: s.ram[0x52] })),
    ...klrStatus
      .filter(s => (effectiveT == null || s.t <= effectiveT) && s.ramVals?.[0x52] != null)
      .map(s => ({ t: s.t, raw: s.ramVals[0x52] })),
  ]
    .sort((a, b) => a.t - b.t)
    .map(d => {
      const kpa = d.raw / 1.2;
      return { t: d.t, boost_psi: +((kpa - 101.3) * 0.145038).toFixed(1) };
    });

  // Real knock pulses, from [PHASE] lines rather than the coarse 100ms
  // STATUS sample — STATUS is too infrequent to ever catch the ~6-8ms-wide
  // knock window, so its "knock" bit always reads high/idle. The [PHASE]
  // log records the actual drop/restore edges of the comparator output.
  const knockPulseEvents = klrPhases
    .filter(p => /Knock pulse: (dropping|restoring)/i.test(p.msg) &&
                 (effectiveT == null || p.t <= effectiveT))
    .map(p => ({ t: p.t, knock_out: /dropping/i.test(p.msg) ? 0 : 1 }));
  // Anchor the line at idle-high for the full visible time range so the
  // chart reads as a mostly-flat trace with brief low pulses, not just a
  // handful of points floating in isolation. The lead-in/lead-out anchor
  // segments are NOT real samples (there's no data confirming the signal
  // stayed high across that whole gap) — they're dashed to flag that,
  // while the real recorded pulse edges in the middle stay solid.
  const knockPulseData = knockPulseEvents.length
    ? [
        { t: firstKlrT ?? 0, knock_out: 1 },
        ...knockPulseEvents,
        { t: effectiveT ?? lastKlrT ?? knockPulseEvents[knockPulseEvents.length-1].t, knock_out: 1 },
      ]
    : [];
  const knockPulseSegments = knockPulseEvents.length
    ? [
        { dashed: true,  data: [{ t: firstKlrT ?? 0, knock_out: 1 }, knockPulseEvents[0]] },
        { dashed: false, data: knockPulseEvents },
        { dashed: true,  data: [knockPulseEvents[knockPulseEvents.length-1],
                                 { t: effectiveT ?? lastKlrT ?? knockPulseEvents[knockPulseEvents.length-1].t, knock_out: 1 }] },
      ]
    : [];

  // TPS (raw ADC + scaled degrees) from STATUS lines
  const tpsData = klrStatus.filter(s => effectiveT == null || s.t <= effectiveT).map(s => ({
    t: s.t,
    tps_raw: s.tps_raw ?? null,
    tps_deg: s.tps_deg ?? null,
  }));

  // ign_out state from [KLR] snapshots or status
  const ignOutData = [
    ...(klrData.snapshots ?? []).filter(s => effectiveT == null || s.t <= effectiveT).map(s => ({
      t: s.t,
      ign_out: s.p2 != null ? ((s.p2 >> 7) & 1) : null,
      full_load: s.p1 != null ? ((s.p1 >> 5) & 1) : null,
    })),
    ...klrStatus.filter(s => effectiveT == null || s.t <= effectiveT).map(s => ({
      t: s.t,
      ign_out:   s.ign_out   ?? null,
      full_load: s.full_load ?? null,
    })),
  ].sort((a,b) => a.t - b.t);

  const ax = { fill: C.textDim, fontSize: 9, fontFamily: "'Courier New',monospace" };
  const tt = { contentStyle: { background:'#060e06', border:'1px solid #0d2e0d',
               color: C.text, fontSize:'10px', fontFamily:'inherit' },
               labelFormatter: t => `t=${t}ms` };

  const CYL_COLORS = ['#ff8844', '#ffcc44', '#88ccff', '#ff66aa'];

  const charts = [
    ...[1, 2, 3, 4].map(cyl => ({
      title: `IGN DELAY — CYL ${cyl} (μs)`,
      data:  ignDelayByCyl[cyl-1],
      key:   'delay',
      col:   CYL_COLORS[cyl-1],
      unit:  'μs',
      dom:   [0, ignDelayMax],
      note:  `Every 4th IGN_OUT assertion (firing #${cyl}, 4, 8, ...) — first ${IGN_IGNORE_MS/1000}s and readings >${IGN_NOISE_US}μs zeroed as noise`,
      empty: ignDelayByCyl[cyl-1].length === 0,
    })),
    {
      title: 'IGN PULSE WIDTH (ms)',
      data:  ignPulseData,
      key:   'pulse',
      col:   '#44cccc',
      unit:  'ms',
      dom:   [0, 'auto'],
      note:  `KLR ignition coil dwell / spark duration — first ${IGN_IGNORE_MS/1000}s zeroed as noisy`,
      empty: ignPulseData.length === 0,
    },
    {
      title: 'CV_PWM (coil voltage PWM)',
      data:  statusData,
      key:   'cv_pwm',
      col:   '#66ffaa',
      unit:  '',
      dom:   [-0.1, 1.1],
      type:  'stepAfter',
      note:  'Coil voltage pulse-width modulation output state',
      empty: statusData.every(d => d.cv_pwm == null),
    },
    {
      title: 'KNOCK OUTPUT (pulse edges)',
      data:  knockPulseData,
      segments: knockPulseSegments,
      key:   'knock_out',
      col:   '#cc66ff',
      unit:  '',
      dom:   [-0.1, 1.1],
      type:  'stepAfter',
      note:  'Comparator output — briefly drops low during each knock window (from [PHASE] pulse events, not the 100ms STATUS sample). Dashed ends = no data confirming state across that gap, just anchored high.',
      empty: knockPulseData.length === 0,
    },
    {
      title: 'KNOCK COUNT',
      data:  statusData,
      key:   'knock_count',
      col:   C.red,
      unit:  '',
      dom:   [0, 'auto'],
      note:  'Cumulative knock event counter',
      empty: statusData.every(d => d.knock_count == null),
    },
    {
      title: 'TPS RAW (ADC)',
      data:  tpsData,
      key:   'tps_raw',
      col:   '#ffcc44',
      unit:  'hex',
      dom:   [0, 255],
      note:  'Raw throttle position ADC reading — increases as throttle opens (0x77≈idle, higher=more open; see BOOST CONTROL tab for %)',
      empty: tpsData.every(d => d.tps_raw == null),
    },
    {
      title: 'TPS ANGLE (deg)',
      data:  tpsData,
      key:   'tps_deg',
      col:   '#ffaa22',
      unit:  '°',
      dom:   [0, 'auto'],
      note:  'Scaled throttle angle',
      empty: tpsData.every(d => d.tps_deg == null),
    },
    {
      title: 'BOOST (psi)',
      data:  boostData,
      key:   'boost_psi',
      col:   '#88ccff',
      unit:  'psi',
      dom:   ['auto', 'auto'],
      note:  'ram[0x52] — gauge boost pressure (0psi ≈ atmospheric, no boost)',
      empty: boostData.length === 0,
    },
  ];

  return (
    <div>
      {/* Info banner when limited data */}
      {(ignDelayEvents.length === 0 && ignPulseData.length === 0) && (
        <div style={{...S.panel, color:C.amber, fontSize:'10px', marginBottom:'8px'}}>
          ⚠ IGN delay and pulse width require <code>KLR: [PHASE]</code> lines in the log.
          CV_PWM and knock require <code>KLR: [STATUS]</code> lines.
        </div>
      )}

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px'}}>
        {charts.map(c => (
          <div key={c.title} style={S.panel}>
            <div style={S.panelTitle}>{c.title}</div>
            {c.empty ? (
              <div style={{height:'130px', display:'flex', alignItems:'center',
                           justifyContent:'center', color:C.textDim, fontSize:'10px'}}>
                No data
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={130}>
                  <LineChart data={c.data} margin={{top:2,right:6,bottom:0,left:0}}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d"/>
                    <XAxis dataKey="t" type="number" domain={['dataMin','dataMax']} tick={ax} tickFormatter={v=>`${v}ms`} stroke={C.textDim}/>
                    <YAxis tick={ax} domain={c.dom} stroke={C.textDim}/>
                    <Tooltip {...tt} formatter={v=>[v, c.unit]}/>
                    {currentT != null &&
                      <ReferenceLine x={currentT} stroke={C.textDim} strokeDasharray="3 3"/>}
                    {c.segments ? (
                      c.segments.map((seg, i) => (
                        <Line key={i} type={c.type || 'monotone'} dataKey={c.key} data={seg.data}
                              stroke={c.col} strokeDasharray={seg.dashed ? '4 3' : undefined}
                              dot={seg.data.length < 100}
                              strokeWidth={c.data.length < 50 ? 1.5 : 1}
                              connectNulls={false} isAnimationActive={false}/>
                      ))
                    ) : (
                      <Line type={c.type || 'monotone'} dataKey={c.key} stroke={c.col}
                            dot={c.data.length < 100}
                            strokeWidth={c.data.length < 50 ? 1.5 : 1}
                            connectNulls={false}/>
                    )}
                  </LineChart>
                </ResponsiveContainer>
                <div style={{color:C.textDim, fontSize:'8px', marginTop:'2px'}}>{c.note}</div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* FULL LOAD step chart */}
      {ignOutData.some(d => d.full_load != null) && (
        <div style={S.panel}>
          <div style={S.panelTitle}>FULL LOAD STATE</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={ignOutData} margin={{top:2,right:6,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="2 4" stroke="#0d2e0d"/>
              <XAxis dataKey="t" type="number" domain={['dataMin','dataMax']} tick={ax} tickFormatter={v=>`${v}ms`} stroke={C.textDim}/>
              <YAxis tick={ax} domain={[-0.1,1.1]} stroke={C.textDim} ticks={[0,1]}/>
              <Tooltip {...tt}/>
              {currentT != null &&
                <ReferenceLine x={currentT} stroke={C.textDim} strokeDasharray="3 3"/>}
              <Line type="stepAfter" dataKey="full_load" stroke={C.amber} dot={false}
                    strokeWidth={1.5} connectNulls={false} name="FULL LOAD"/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{display:'flex', gap:'12px', marginTop:'3px', fontSize:'9px'}}>
            <span style={{color:C.amber}}>▬ FULL LOAD (p1[5])</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── KLRPhaseTab ───────────────────────────────────────────────────
function KLRPhaseTab({ klrData, klrIdx }) {
  const allPhases  = klrData?.phases ?? [];
  const klrPhases  = allPhases.filter(p => p.cat === 'klr');
  // Filter out IGN_OUT asserted/deasserted events — too noisy for this view,
  // covered in detail on KLR Overview / Charts instead.
  const visPhases  = klrPhases.filter(p => !p.asserted && !p.deasserted);

  if (klrPhases.length === 0) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'14px'}}>
      No KLR phase data — log needs <code style={{color:'#44aaff'}}>KLR: [PHASE]</code> lines
    </div>
  );

  const currentT = allPhases[klrIdx]?.t ?? 0;
  const maxT     = klrPhases[klrPhases.length-1]?.t || 1;
  const pctT     = (currentT / maxT) * 100;

  const klrColor = p => p.asserted ? '#ff8844' : p.deasserted ? '#44aaff' : '#44cccc';

  return (
    <div>
      {/* ── Timeline bar ──────────────────────────────────────── */}
      <div style={{...S.panel, padding:'10px'}}>
        <div style={S.panelTitle}>KLR EVENT TIMELINE — {visPhases.length} events</div>
        <div style={{position:'relative',height:'36px',background:'#040904',
                     borderRadius:'2px',overflow:'hidden',border:`1px solid ${C.border}`}}>
          {visPhases.map((p,i)=>(
            <div key={i} title={`${p.t}ms — ${p.msg}`} style={{
              position:'absolute', left:`${(p.t/maxT)*100}%`,
              top:0, width:'2px', height:'100%',
              background: klrColor(p), opacity:0.85, cursor:'pointer',
            }}/>
          ))}
          <div style={{
            position:'absolute', left:`${pctT}%`, top:0,
            width:'1px', height:'100%',
            background:C.textBright, boxShadow:`0 0 5px ${C.textBright}`,
          }}/>
        </div>
        <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'8px'}}>
          <span style={{fontSize:'9px',color:'#44cccc',letterSpacing:'0.05em'}}>▌ EVENTS</span>
          <span style={{fontSize:'9px',color:C.textDim,letterSpacing:'0.05em'}}>
            (IGN_OUT asserted/deasserted events hidden — see KLR Overview)
          </span>
        </div>
      </div>

      {/* ── Event list ────────────────────────────────────────── */}
      <div style={S.panel}>
        <div style={S.panelTitle}>ALL KLR EVENTS</div>
        <div style={{maxHeight:'420px',overflow:'auto'}}>
          {visPhases.map((p,i)=>{
            const past  = p.t <= currentT;
            const col   = klrColor(p);
            const isCur = allPhases.indexOf(p) === klrIdx;
            return (
              <div key={i} style={{
                display:'flex', alignItems:'baseline', gap:'10px',
                padding:'4px 8px', marginBottom:'1px',
                borderLeft:`3px solid ${past?col:'#1a2e1a'}`,
                background: isCur ? '#0a1a0a' : (past ? C.panelBg : '#050c05'),
                outline: isCur ? `1px solid ${col}` : 'none',
              }}>
                <span style={{
                  color: past?col:C.textDim,
                  fontFamily:"'Orbitron',monospace", fontSize:'10px',
                  minWidth:'72px', whiteSpace:'nowrap',
                }}>{p.t} ms</span>
                <span style={{color:past?col:C.textDim, fontSize:'11px', flex:1}}>{p.msg}</span>
                {p.delay_us != null && (
                  <span style={{color:'#44cccc',fontSize:'9px',whiteSpace:'nowrap'}}>
                    {p.delay_us.toFixed(2)} μs
                  </span>
                )}
                {p.pulse_ms != null && (
                  <span style={{color:'#cc66ff',fontSize:'9px',whiteSpace:'nowrap'}}>
                    {p.pulse_ms.toFixed(3)} ms
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── KLRPortsTab ───────────────────────────────────────────────────
function KLRPortsTab({ klrData, klrIdx, logHasPorts, logLoaded }) {
  // Get port values from latest [KLR] snapshot at or before klrIdx
  const phases   = klrData?.phases ?? [];
  const currentT = phases[klrIdx]?.t ?? Infinity;
  const snaps    = klrData?.snapshots ?? [];
  const snap     = snaps.filter(s => s.t <= currentT).slice(-1)[0];

  // Also check status lines
  const status   = klrData?.status ?? [];
  const stat     = status.filter(s => s.t <= currentT).slice(-1)[0];

  // Prefer [KLR] hex snapshot ports; fall back to STATUS ign_out/full_load
  const p1val = snap?.p1 ?? null;
  const p2val = snap?.p2 ?? null;

  const hasLive    = p1val !== null || p2val !== null;
  const hasPartial = snap?.p1partial || snap?.p2partial;
  const portVals   = { P1: p1val, P2: p2val };

  const portDescs = {
    P1: 'ADC MUX CONTROL · FULL LOAD FLAG',
    P2: 'IGNITION OUTPUT · KNOCK · CV PWM',
  };

  return (
    <div>
      {logLoaded && !logHasPorts && (
        <div style={{color:C.amber,fontSize:'10px',marginBottom:'8px',
                     padding:'6px 10px',border:`1px solid ${C.amber}44`,background:'#1a1000'}}>
          ⚠ No live port values — requires [KLR] hex snapshot lines in the log.
          KLR: [STATUS] lines show signal names only.
        </div>
      )}
      {logLoaded && logHasPorts && hasPartial && (
        <div style={{color:C.textDim,fontSize:'10px',marginBottom:'8px',
                     padding:'4px 10px',border:`1px solid ${C.border}`,background:C.panelBg2}}>
          ⚠ Some port nibbles are unknown (X) in this snapshot — affected bits shown as ?
        </div>
      )}

      {/* Status-derived signal banner */}
      {stat && (
        <div style={{display:'flex',gap:'8px',marginBottom:'8px',flexWrap:'wrap'}}>
          {[
            ['IGN OUT',   stat.ign_out,   '#ff8844'],
            ['FULL LOAD', stat.full_load,  C.amber],
            ['CV PWM',    stat.CV_PWM,    '#66ffaa'],
            ['KNOCK',     stat.knock,     '#cc66ff'],
          ].filter(([,v])=>v!=null).map(([l,v,col])=>(
            <div key={l} style={{...S.metric, flex:'0 0 auto', minWidth:'90px'}}>
              <div style={S.metricLbl}>{l}</div>
              <div style={{...S.metricVal,color: v?col:C.textDim,fontSize:'12px'}}>
                {typeof v==='number'?`0x${h2(v)}`:v?'HIGH':'LOW'}
              </div>
            </div>
          ))}
          <div style={{...S.metric,flex:'0 0 auto',minWidth:'80px'}}>
            <div style={S.metricLbl}>t</div>
            <div style={{...S.metricVal,fontSize:'12px'}}>{stat.t} ms</div>
          </div>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
        {Object.entries(KLR_PORT_DEFS).map(([pName,bits])=>{
          const portByte = portVals[pName];
          const hasVal   = portByte !== null && portByte !== undefined;
          return (
            <div key={pName} style={S.panel}>
              <div style={S.panelTitle}>
                {pName} — {portDescs[pName]}
                {hasVal && (
                  <span style={{marginLeft:'10px',color:'#44aaff',
                                fontFamily:"'Orbitron',monospace",fontSize:'11px'}}>
                    0x{h2(portByte)} &nbsp; {b8(portByte)}
                  </span>
                )}
              </div>
              {bits.map(b=>{
                const bitVal = hasVal ? ((portByte >> b.bit) & 1) : null;
                const isSet  = bitVal === 1;
                const dirCol = b.dir==='IN'  ? C.blue
                             : b.dir==='OUT' ? '#66ffaa'
                             : C.amber;
                return (
                  <div key={b.bit} style={{
                    display:'grid',
                    gridTemplateColumns:'24px 24px 80px 1fr',
                    gap:'6px', alignItems:'center',
                    padding:'4px 6px', borderBottom:`1px solid ${C.border}`,
                    background: isSet ? '#0a1a22' : 'transparent',
                  }}>
                    <span style={{color:C.textDim,fontSize:'9px'}}>{pName}.{b.bit}</span>
                    <span style={{
                      width:'18px',height:'18px',lineHeight:'18px',
                      textAlign:'center',borderRadius:'2px',
                      fontSize:'12px',fontWeight:'bold',display:'inline-block',
                      background: bitVal===null ? 'transparent'
                                : isSet ? `${dirCol}33` : '#080f08',
                      color:       bitVal===null ? C.textDim
                                : isSet ? dirCol : '#335533',
                      border:`1px solid ${bitVal===null?C.border:isSet?dirCol:'#1a3a1a'}`,
                      boxShadow: isSet ? `0 0 5px ${dirCol}66` : 'none',
                    }}>
                      {bitVal===null ? '?' : bitVal}
                    </span>
                    <span style={{
                      padding:'1px 4px',fontSize:'8px',borderRadius:'2px',
                      background: b.dir==='IN'?'#0a1a2a':b.dir==='OUT'?'#0a1f0a':'#1a1a0a',
                      color:dirCol,textAlign:'center',whiteSpace:'nowrap',
                    }}>{b.dir}</span>
                    <div>
                      <span style={{color:isSet?dirCol:'#44aaff',fontSize:'10px',fontWeight:'bold'}}>
                        {b.name}
                      </span>
                      <span style={{color:C.textDim,fontSize:'9px',marginLeft:'6px'}}>
                        {b.desc}
                      </span>
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

// ── KLRIRAMTab ────────────────────────────────────────────────────
// Displays the full 128-byte 8048 RAM dump from the KLR: [DS] snapshot
// nearest to the current KLR scrubber position, plus any named
// locations available from KLR: [STATUS] ramVals.
function KLRIRAMTab({ klrData, klrIdx }) {
  const [sub, setSub] = useState('grid');

  const phases   = klrData?.phases ?? [];
  const currentT = phases[klrIdx]?.t ?? Infinity;

  // Nearest [KLR] hex snapshot at or before currentT
  const snaps = klrData?.snapshots ?? [];
  const snap  = snaps.filter(s => s.t <= currentT).slice(-1)[0];
  const ram   = snap?.ram ?? {};

  // Accumulate ALL ramVals from STATUS lines up to currentT, tracking the
  // time each address was last updated (multiple lines may touch different
  // addresses, and later status lines should win over earlier ones).
  const allStatus = (klrData?.status ?? []).filter(s => s.t <= currentT);
  const ramFromStatus = {}; // addr -> { v, t }
  for (const s of allStatus)
    if (s.ramVals)
      for (const [a, v] of Object.entries(s.ramVals))
        ramFromStatus[a] = { v, t: s.t };

  // Merge: for each address, use whichever source (hex snapshot at snap.t,
  // or the latest STATUS-line update) is more recent — NOT a blind priority
  // for one source, since hex snapshots and STATUS lines are sampled at
  // different rates and can disagree about which is "current" at a given t.
  const snapT = snap?.t ?? -Infinity;
  const ramMerged = { ...ram };
  for (const [a, {v, t}] of Object.entries(ramFromStatus))
    if (t >= snapT) ramMerged[a] = v;


  const hasHex    = Object.keys(ram).length > 0;
  const hasStatus = Object.keys(ramFromStatus).length > 0;
  const hasData   = Object.keys(ramMerged).length > 0;

  const SUBTABS = [
    { key:'grid',      label:'RAM GRID' },
    { key:'known',     label:'KNOWN' },
    { key:'adc',       label:'ADC INPUTS' },
    { key:'status',    label:'STATUS VALUES' },
  ];

  const logLoaded = (klrData?.snapshots?.length > 0) || (klrData?.status?.length > 0);
  if (!logLoaded) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'14px'}}>
      No KLR RAM data — load a log with <code style={{color:'#44aaff'}}>KLR: [DS]</code> or{' '}
      <code style={{color:'#44aaff'}}>KLR: [STATUS]</code> lines
    </div>
  );

  return (
    <div>
      {/* Source banner */}
      <div style={{display:'flex',gap:'6px',marginBottom:'6px',fontSize:'9px',color:C.textDim}}>
        {hasHex    && <span style={{color:'#66ffaa'}}>● HEX SNAPSHOT  {Object.keys(ram).length} bytes</span>}
        {hasStatus && <span style={{color:'#44aaff'}}>● STATUS LINES  {Object.keys(ramFromStatus).length} addresses</span>}
        <span style={{marginLeft:'auto'}}>t≤{currentT===Infinity?'---':currentT}ms</span>
      </div>

      {/* Subtabs */}
      <div style={{display:'flex',gap:'2px',marginBottom:'6px',borderBottom:`1px solid ${C.border}`,paddingBottom:'0'}}>
        {SUBTABS.map(t=>(
          <button key={t.key} style={S.tabKlr(sub===t.key)} onClick={()=>setSub(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── RAM GRID (all 64 bytes) ─────────────────────────── */}
      {sub==='grid' && (
        <div style={S.panel}>
          <div style={S.panelTitle}>
            8048 RAM — 128 BYTES &nbsp;
            <span style={{color:C.textDim,fontSize:'8px'}}>hover for details · blue = known location</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(16,1fr)',gap:'2px',marginBottom:'2px'}}>
            {Array.from({length:16},(_,i)=>(
              <div key={i} style={{textAlign:'center',color:C.textDim,fontSize:'8px'}}>+{i.toString(16).toUpperCase()}</div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(16,1fr)',gap:'2px'}}>
            {Array.from({length:128},(_,addr)=>{
              const val   = ramMerged[addr];
              const hasV  = val !== undefined;
              const known = KLR_KNOWN[addr];
              const fromSnap   = ram[addr] !== undefined;
              const fromStat   = ramFromStatus[addr] !== undefined && !fromSnap;
              return (
                <div key={addr}
                  title={`ram[${addr}] (0x${addr.toString(16).toUpperCase().padStart(2,'0')}) = ${hasV?'0x'+h2(val)+' ('+val+'d)':'unknown'}${known?' — '+known.n+(known.d?': '+known.d:''):''}${fromStat?' [STATUS]':fromSnap?' [HEX]':''}`}
                  style={{
                    background: hasV ? (known?'#001a22':'#0a150a') : '#060d06',
                    border:`1px solid ${hasV?(known?'#44aaff':'#1a3a1a'):C.border}`,
                    borderRadius:'2px',padding:'3px 2px',textAlign:'center',cursor:'default',
                  }}>
                  <div style={{color:C.textDim,fontSize:'7px'}}>{addr.toString(16).toUpperCase().padStart(2,'0')}h</div>
                  <div style={{color:hasV?(known?'#44aaff':C.textBright):'#335533',fontSize:'10px',fontWeight:'bold'}}>
                    {hasV?h2(val):'--'}
                  </div>
                  {known && (
                    <div style={{color:'#44aaff',fontSize:'6px',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>
                      {known.n}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── KNOWN LOCATIONS ─────────────────────────────────── */}
      {sub==='known' && (
        <div style={S.panel}>
          <div style={S.panelTitle}>KNOWN KLR RAM LOCATIONS &nbsp;
            <span style={{color:C.textDim,fontSize:'8px'}}>blue border = has value · dim = no data yet</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:'4px',marginTop:'6px'}}>
            {Object.entries(KLR_KNOWN).map(([addr,info])=>{
              const a   = +addr;
              const val = ramMerged[a];
              const hasV = val !== undefined;
              const addrHex = a.toString(16).toUpperCase().padStart(2,'0');
              return (
                <div key={addr}
                  title={`ram[${a}] (0x${addrHex}h) = ${hasV?'0x'+h2(val)+' ('+val+'d)':'no data'}${info.d?' — '+info.d:''}`}
                  style={{
                    background: hasV ? '#001a22' : '#060d06',
                    border:`1px solid ${hasV?'#44aaff':C.border}`,
                    borderRadius:'4px',padding:'5px 6px',
                  }}>
                  <div style={{color:'#44aaff',fontSize:'9px',fontWeight:'bold',
                               overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>
                    {info.n}
                  </div>
                  <div style={{color:C.textDim,fontSize:'7px',marginBottom:'3px'}}>
                    0x{addrHex}h
                  </div>
                  <div style={{color:hasV?C.textBright:'#335533',fontSize:'13px',fontWeight:'bold'}}>
                    {hasV ? h2(val) : '--'}
                  </div>
                  {hasV && (
                    <div style={{color:C.textDim,fontSize:'7px',marginTop:'1px'}}>
                      {val}d &nbsp; {val.toString(2).padStart(8,'0')}b
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ADC INPUTS ─────────────────────────────────────────── */}
      {sub==='adc' && (
        <div style={S.panel}>
          <div style={S.panelTitle}>KLR ADC INPUTS &nbsp;
            <span style={{color:C.textDim,fontSize:'8px'}}>from KLR: [DS] snapshot + [STATUS] (whichever is freshest)</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'4px',marginTop:'6px'}}>
            {[
              { ch:3,  label:'TPS Supply',   addr:0x39, desc:'5V regulated supply (ch3)' },
              { ch:7,  label:'TPS Angle',    addr:0x3C, desc:'Throttle wiper raw (ch7)' },
              { ch:7,  label:'Throttle °',   addr:0x3A, desc:'Processed degrees (3A)' },
              { ch:7,  label:'TPS Scaling',  addr:0x3B, desc:'3B scaling numerator' },
              { ch:7,  label:'TPS Cycling',  addr:0x43, desc:'Cycling valve map input (43h)' },
              { ch:7,  label:'WOT Threshold',addr:0x3E, desc:'WOT angle threshold (3E)' },
              { ch:0,  label:'Knock ch0',    addr:0x2F,  desc:'knock sensor 1 amplified' },
              { ch:1,  label:'Battery',      addr:0x2E,  desc:'battery voltage (ch1)' },
              { ch:5,  label:'Comparator',   addr:null,  desc:'LM2902 comparator output (ch5)' },
              { ch:null, label:'Knock Integrator', addr:0x46, desc:'Integrated knock value (46h)' },
              { ch:4,  label:'Boost',        addr:0x52, desc:'MAP pressure — post +10-offset ADC read (52h), see BOOST CONTROL tab' },
            ].map(({ch, label, addr, desc}) => {
              const val = addr !== null ? ramMerged[addr] : undefined;
              const hasV = val !== undefined && val !== null;
              return (
                <div key={label} title={desc}
                  style={{background: hasV?'#001a22':'#060d06',
                          border:`1px solid ${hasV?'#44aaff':C.border}`,
                          borderRadius:'4px',padding:'5px 6px'}}>
                  <div style={{color:'#44aaff',fontSize:'9px',fontWeight:'bold'}}>{label}</div>
                  <div style={{color:C.textDim,fontSize:'7px',marginBottom:'3px'}}>
                    {ch!==null ? `ch${ch}` : ''}{addr!==null ? `${ch!==null?' · ':''}ram[0x${addr.toString(16).toUpperCase()}]` : ''}
                  </div>
                  <div style={{color:hasV?C.textBright:'#335533',fontSize:'13px',fontWeight:'bold'}}>
                    {hasV ? h2(val) : '--'}
                  </div>
                  {hasV && (
                    <div style={{color:C.textDim,fontSize:'7px',marginTop:'1px'}}>
                      {val}d &nbsp; {(val*100/255).toFixed(0)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── STATUS VALUES ────────────────────────────────────── */}
      {sub==='status' && (
        <div style={S.panel}>
          <div style={S.panelTitle}>RAM VALUES FROM KLR: [STATUS] LINES</div>
          {hasStatus ? (
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'4px'}}>
              {Object.entries(ramFromStatus).sort((a,b)=>+a[0]-+b[0]).map(([addr,{v,t}])=>(
                <div key={addr} style={{display:'flex',justifyContent:'space-between',
                                        padding:'3px 6px',borderBottom:`1px solid ${C.border}`,fontSize:'10px'}}>
                  <span style={{color:C.textDim}} title={KLR_KNOWN[+addr]?.d}>ram[{addr}] {KLR_KNOWN[+addr]?<span style={{color:'#44aaff',fontSize:'9px'}}>{KLR_KNOWN[+addr].n}</span>:''}</span>
                  <span style={{color:C.textBright}}>0x{h2(v)} ({v}d) <span style={{color:C.textDim,fontSize:'9px'}}>@{t}ms</span></span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{color:C.textDim,fontSize:'10px',padding:'12px 8px'}}>
              No ram[n] values found in KLR: [STATUS] lines at t≤{currentT===Infinity?'---':currentT}ms
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── KLRDiagTab ───────────────────────────────────────────────────
function KLRDiagTab({ klrData, klrIdx }) {
  const phases   = klrData?.phases ?? [];
  const currentT = phases[klrIdx]?.t ?? Infinity;

  // Nearest [KLR] hex snapshot at or before currentT
  const snaps = klrData?.snapshots ?? [];
  const snap  = snaps.filter(s => s.t <= currentT).slice(-1)[0];
  const ram   = snap?.ram ?? {};

  // Accumulate ALL ramVals from STATUS lines up to currentT, tracking the
  // time each address was last updated.
  const allStatus = (klrData?.status ?? []).filter(s => s.t <= currentT);
  const ramFromStatus = {}; // addr -> { v, t }
  for (const s of allStatus)
    if (s.ramVals)
      for (const [a, v] of Object.entries(s.ramVals))
        ramFromStatus[a] = { v, t: s.t };

  // Merge: for each address, use whichever source (hex snapshot at snap.t,
  // or the latest STATUS-line update) is more recent.
  const snapT = snap?.t ?? -Infinity;
  const ramMerged = { ...ram };
  for (const [a, {v, t}] of Object.entries(ramFromStatus))
    if (t >= snapT) ramMerged[a] = v;

  const logLoaded = (klrData?.snapshots?.length > 0) || (klrData?.status?.length > 0);
  if (!logLoaded) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'11px'}}>
      No KLR data loaded — use <strong style={{color:C.textBright}}>PARSE &amp; LOAD</strong> with a combined log containing{' '}
      <code style={{color:'#44aaff'}}>[KLR]</code> or <code style={{color:'#44aaff'}}>KLR: [STATUS]</code> lines
    </div>
  );

  // ram[0x33] diagnostic code
  const code     = ramMerged[0x33];
  const hasCode  = code != null;

  const DTC = {
    0x11: { label: 'Max KLR Timing Retard Exceeded' },
    0x12: { label: 'Voltage Under 10.2V',
            detail: 'Check alternator, battery, regulator, relays or wiring' },
    0x21: { label: 'Engine Damage' },
    0x22: { label: 'Knock Sensor Disconnected' },
    0x23: { label: 'KLR Defective' },
    0x31: { label: 'Boost Pressure Low' },
    0x32: { label: 'Boost Pressure Too High' },
    0x33: { label: 'Pressure Sensor In KLR Defective' },
    0x41: { label: 'Throttle Position Sensor Power Wires',
            detail: 'Power wire to TPS, ground contact or connection dirty' },
    0x42: { label: 'Throttle Position Sensor Bad' },
  };

  // "X-Y" style code label, e.g. 0x31 → "3-1", matching the KLR tester's own notation
  const codeStr = c => `${(c >> 4) & 0xF}-${c & 0xF}`;

  const entry = hasCode ? DTC[code] : null;
  const isKnownFault = entry != null;
  const label  = hasCode ? (entry?.label ?? 'No Fault / Unknown Code') : '--';
  const detail = entry?.detail;
  const col    = isKnownFault ? C.red : hasCode ? '#66ffaa' : C.textDim;

  return (
    <div>
      <div style={S.panel}>
        <div style={S.panelTitle}>KLR DIAGNOSTIC CODE — RAM[0x33]</div>
        <div style={{display:'flex',alignItems:'center',gap:'28px',padding:'14px 8px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'10px',color:C.textDim,letterSpacing:'0.15em'}}>RAW CODE</div>
            <div style={{fontSize:'30px',fontWeight:'bold',color:col,margin:'2px 0'}}>
              {hasCode ? `0x${h2(code)}` : '--'}
            </div>
            <div style={{fontSize:'10px',color:C.textDim}}>{hasCode ? `${codeStr(code)}  (${code}d)` : ''}</div>
          </div>
          <div style={{borderLeft:`1px solid ${C.border}`,paddingLeft:'28px'}}>
            <div style={{fontSize:'10px',color:C.textDim,letterSpacing:'0.15em'}}>DIAGNOSIS</div>
            <div style={{fontSize:'22px',fontWeight:'bold',color:col,margin:'2px 0'}}>
              {label}
            </div>
            {detail && (
              <div style={{fontSize:'11px',color:C.textDim,maxWidth:'480px'}}>{detail}</div>
            )}
          </div>
        </div>
      </div>

      <div style={{...S.panel, marginTop:'8px'}}>
        <div style={S.panelTitle}>KNOWN DTC CODES</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px',padding:'6px 4px'}}>
          {Object.entries(DTC).map(([c,d]) => {
            const cNum = Number(c);
            const active = hasCode && code === cNum;
            return (
              <div key={c} style={{
                display:'flex',flexDirection:'column',gap:'2px',padding:'6px 10px',
                background: active ? 'rgba(255,68,68,0.12)' : 'transparent',
                border:`1px solid ${active ? C.red : C.border}`,
                borderRadius:'2px',
              }}>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span style={{color: active ? C.red : C.textBright}}>
                    {codeStr(cNum)} <span style={{color:C.textDim,fontSize:'9px'}}>0x{h2(cNum)}</span>
                  </span>
                  <span style={{color: active ? C.red : C.textDim}}>{d.label}</span>
                </div>
                {d.detail && (
                  <div style={{fontSize:'9px',color:C.textDim,textAlign:'right'}}>{d.detail}</div>
                )}
              </div>
            );
          })}
        </div>
        {hasCode && !isKnownFault && (
          <div style={{color:C.textDim,fontSize:'10px',padding:'6px 8px'}}>
            Current code {codeStr(code)} (0x{h2(code)}) does not match a known DTC — treated as no fault present.
          </div>
        )}
      </div>
    </div>
  );
}

// ── BoostControlTab ─────────────────────────────────────────────
function BoostControlTab({ klrData, klrIdx, dmeSnapshots }) {
  const phases   = klrData?.phases ?? [];
  const currentT = phases[klrIdx]?.t ?? Infinity;

  // RPM comes from the DME side, but this tab's timeline is driven by the
  // KLR cursor (klrIdx) — NOT the DME tab's own independently-scrubbed
  // position. Find the DME snapshot actually time-aligned with currentT
  // (nearest at-or-before), rather than reading whatever the DME scrubber
  // happens to be sitting on, which could be at a completely different
  // point in the log and produce a stale/mismatched RPM reading.
  const dmeSnaps = dmeSnapshots ?? [];
  const dmeSnapAtCurrentT = dmeSnaps.filter(s => s.t <= currentT).slice(-1)[0] ?? { iram:{} };
  const rpm = snapRpm(dmeSnapAtCurrentT);

  // Nearest [KLR] hex snapshot at or before currentT
  const snaps = klrData?.snapshots ?? [];
  const snap  = snaps.filter(s => s.t <= currentT).slice(-1)[0];
  const ram   = snap?.ram ?? {};

  // Accumulate ALL ramVals from STATUS lines up to currentT, tracking the
  // time each address was last updated (same merge pattern as KLR Diag).
  const allStatus = (klrData?.status ?? []).filter(s => s.t <= currentT);
  const ramFromStatus = {}; // addr -> { v, t }
  for (const s of allStatus)
    if (s.ramVals)
      for (const [a, v] of Object.entries(s.ramVals))
        ramFromStatus[a] = { v, t: s.t };

  const snapT = snap?.t ?? -Infinity;
  const ramMerged = { ...ram };
  for (const [a, {v, t}] of Object.entries(ramFromStatus))
    if (t >= snapT) ramMerged[a] = v;

  // Latest tps_raw and CV_PWM directly from STATUS lines (not in ramVals —
  // these are named fields the parser pulls out separately).
  const latestStatus = allStatus.length ? allStatus[allStatus.length - 1] : null;

  const logLoaded = (klrData?.snapshots?.length > 0) || (klrData?.status?.length > 0);
  if (!logLoaded) return (
    <div style={{textAlign:'center',color:C.textDim,padding:'60px',fontSize:'11px'}}>
      No KLR data loaded — use <strong style={{color:C.textBright}}>PARSE &amp; LOAD</strong> with a combined log containing{' '}
      <code style={{color:'#44aaff'}}>[KLR]</code> or <code style={{color:'#44aaff'}}>KLR: [STATUS]</code> lines
    </div>
  );

  // ── Boost Input — actual observed reading, ram[0x52] ──────────
  const boostInputRaw = ramMerged[0x52];
  const boostInputKpa = boostInputRaw != null ? boostInputRaw / 1.2 : null;
  const boostInputPsi = boostInputKpa != null ? (boostInputKpa - 101.3) * 0.145038 : null;

  // ── Throttle % — from ram[0x43], the same source klr_tb.v's boost
  // model now reads directly (see ram43ToThrottlePct above) ─────────
  const ram43 = ramMerged[0x43];
  const throttlePct = ram43ToThrottlePct(ram43);

  // ── Boost Target — bilinear MAP-table lookup at current RPM/throttle ──
  // Gated at 400rpm (matching var_interrupt_gen_cl.v's own CL_RPM_MIN stall
  // threshold) — below that the engine is cranking/stalled, and a turbo
  // boost target is physically meaningless (no exhaust flow to spool
  // anything), so showing a computed table value there would be misleading
  // rather than informative.
  // Gate 1: cranking/stall (see above). Gate 2: the real boost table only
  // has documented data from 57.0% to 87.1% throttle — outside that band,
  // any "target" would just be silently clamped to the table's nearest
  // edge row, which isn't a real measured target and is misleading to
  // present as one (this is exactly what was producing bogus low-throttle
  // "targets" like 3.7psi at near-idle, clamped to the 57% row instead of
  // reflecting anything real about closed-throttle boost behavior).
  // ── Boost Target — prefer the real value klr_tb.v itself computed
  // (logged directly as boost_target=XX in newer logs) over the
  // dashboard's own independent MAP-table reconstruction. The
  // reconstruction uses tps_raw-derived throttle%, which is NOT the same
  // signal path klr_tb.v actually uses internally (tps_wiper) — this was
  // producing real, confirmed mismatches (e.g. input 0xC2 vs "target"
  // 0xB0 on a plain, unmodified BOOST test, where they should be
  // identical). The logged value is authoritative; only fall back to the
  // approximation for older logs that don't have this field yet.
  const boostTargetLogged = latestStatus?.boost_target;
  const usingLoggedTarget = boostTargetLogged !== undefined;

  const rpmValidForBoost = rpm != null && rpm >= 400;
  const throttleInTableRange = throttlePct != null && throttlePct >= BOOST_THR_BP[0] && throttlePct <= BOOST_THR_BP[BOOST_THR_BP.length-1];
  const boostTargetApprox = (rpmValidForBoost && throttleInTableRange) ? boostTargetSoftwareUnits(rpm, throttlePct) : null;

  const boostTargetRaw = usingLoggedTarget ? boostTargetLogged : boostTargetApprox;
  const boostTargetKpa = boostTargetRaw != null ? boostTargetRaw / 1.2 : null;
  const boostTargetPsi = boostTargetKpa != null ? (boostTargetKpa - 101.3) * 0.145038 : null;

  const boostDeltaPsi = (boostInputPsi != null && boostTargetPsi != null)
    ? boostInputPsi - boostTargetPsi : null;

  // ── CV Duty Cycle — ram[0x41] (CV_DUTY_FINAL) ──────────────────
  const cvDutyRaw = ramMerged[0x41];
  const cvDutyPct = cvDutyRaw != null ? (cvDutyRaw / 255) * 100 : null;

  const fmt1 = v => v != null ? v.toFixed(1) : '--';

  const Card = ({ label, value, unit, sub, col }) => (
    <div style={S.metric}>
      <div style={S.metricLbl}>{label}</div>
      <div style={{...S.metricVal, color: col || C.textBright, fontSize:'20px', margin:'4px 0'}}>
        {value}{unit && <span style={{fontSize:'12px', color:C.textDim, marginLeft:'4px'}}>{unit}</span>}
      </div>
      {sub && <div style={S.metricUnit}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px', marginBottom:'10px'}}>
        <Card label="BOOST INPUT" value={fmt1(boostInputPsi)} unit="psi"
              sub={boostInputRaw != null ? `ram[0x52]=0x${h2(boostInputRaw)} (${fmt1(boostInputKpa)}kPa)` : 'no data'}
              col={boostInputPsi != null && boostInputPsi > 0 ? C.amber : '#88ccff'} />
        <Card label="BOOST TARGET" value={fmt1(boostTargetPsi)} unit="psi"
              sub={boostTargetRaw != null
                   ? `hex=0x${h2(Math.round(boostTargetRaw))}${usingLoggedTarget ? ' [sim]' : ` [approx @ ${rpm}rpm, ${fmt1(throttlePct)}%]`}`
                   : rpm != null && rpm < 400 ? `cranking (${rpm}rpm) — not meaningful below 400rpm`
                   : throttlePct != null && !throttleInTableRange ? `${fmt1(throttlePct)}% throttle outside table's 57-87% range`
                   : 'no RPM/throttle'}
              col="#66ffaa" />
        <Card label="CV DUTY CYCLE" value={fmt1(cvDutyPct)} unit="%"
              sub={cvDutyRaw != null ? `ram[0x41]=0x${h2(cvDutyRaw)}` : 'no data'}
              col="#cc66ff" />
        <Card label="THROTTLE %" value={fmt1(throttlePct)} unit="%"
              sub={ram43 != null ? `ram[0x43]=0x${h2(ram43)}` : 'no data'}
              col="#ffcc44" />
      </div>

      <div style={S.panel}>
        <div style={S.panelTitle}>BOOST INPUT vs TARGET</div>
        <div style={{display:'flex', alignItems:'center', gap:'28px', padding:'10px 8px', flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'10px', color:C.textDim, letterSpacing:'0.1em'}}>INPUT (ram[0x52])</div>
            <div style={{fontSize:'20px', fontWeight:'bold', color:'#88ccff'}}>
              {boostInputRaw != null ? `0x${h2(boostInputRaw)}` : '--'}
              <span style={{fontSize:'11px', color:C.textDim, marginLeft:'6px'}}>
                {boostInputRaw != null ? `${boostInputRaw}d` : ''}
              </span>
            </div>
          </div>
          <div>
            <div style={{fontSize:'10px', color:C.textDim, letterSpacing:'0.1em'}}>TARGET (MAP table)</div>
            <div style={{fontSize:'20px', fontWeight:'bold', color:'#66ffaa'}}>
              {boostTargetRaw != null ? `0x${h2(Math.round(boostTargetRaw))}` : '--'}
              <span style={{fontSize:'11px', color:C.textDim, marginLeft:'6px'}}>
                {boostTargetRaw != null ? `${Math.round(boostTargetRaw)}d` : ''}
              </span>
            </div>
          </div>
          <div>
            <div style={{fontSize:'10px', color:C.textDim, letterSpacing:'0.1em'}}>DEVIATION</div>
            <div style={{fontSize:'22px', fontWeight:'bold',
                         color: boostDeltaPsi == null ? C.textDim : Math.abs(boostDeltaPsi) < 1 ? '#66ffaa' : Math.abs(boostDeltaPsi) < 5 ? C.amber : C.red}}>
              {boostDeltaPsi != null ? `${boostDeltaPsi >= 0 ? '+' : ''}${fmt1(boostDeltaPsi)}psi` : '--'}
            </div>
          </div>
          <div style={{fontSize:'10px', color:C.textDim, maxWidth:'420px'}}>
            Input minus target. Large/persistent deviation typically means either a test-injected
            boost fault (see KLR Diag) or a genuine closed-loop wastegate control error the CV duty
            cycle hasn't yet corrected for. Hex values above are both in the same "software units"
            scale as the KLR memory map docs (post +10-offset) — directly comparable byte-for-byte.
          </div>
        </div>
      </div>
    </div>
  );
}
