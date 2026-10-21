// ── Operand values for the LIVE assembly panes ──────────────
//
//  Resolves the data an instruction's operands refer to (registers,
//  direct RAM, @Ri, bits, SFRs) against:
//    ram  — internal RAM bytes (DME iram / KLR ram), indexed 0..127
//    regs — CPU registers (lower-case names, numbers)
//  The panes build both from the sim's trace context for the last time
//  that instruction ran (traceState below), so each row shows the values
//  it actually saw, not the registers at the stop.
//  Returns a short text such as "A=04 R7=1F @R0[5A]=12 23.2=1", or ''.
//  Immediates and jump/call targets are skipped.

const h2 = v => v == null || isNaN(v) ? '--' : v.toString(16).toUpperCase().padStart(2, '0');
const h4 = v => v.toString(16).toUpperCase().padStart(4, '0');

// 8051 SFRs by direct address
const SFR = {
  0x80: 'p0', 0x81: 'sp', 0x82: 'dpl', 0x83: 'dph', 0x87: 'pcon', 0x88: 'tcon', 0x89: 'tmod',
  0x8a: 'tl0', 0x8b: 'tl1', 0x8c: 'th0', 0x8d: 'th1', 0x90: 'p1', 0x98: 'scon', 0x99: 'sbuf',
  0xa0: 'p2', 0xa8: 'ie', 0xb0: 'p3', 0xb8: 'ip', 0xd0: 'psw', 0xe0: 'acc', 0xf0: 'b',
};
const SFR_NAME = { acc: 'A', b: 'B' };

// Branches: the last operand is a code address, not data
const DME_BRANCH = /^(jb|jnb|jbc|jz|jnz|jc|jnc|cjne|djnz|sjmp|ajmp|ljmp|acall|lcall)$/i;
const KLR_BRANCH = /^(j\w*|djnz|call|jmp)$/i;

function dmeDirect(addr, ram, regs) {
  if (addr < 0x80) return ram?.[addr];
  const n = SFR[addr];
  if (n === 'dpl') return regs?.dptr & 0xff;
  if (n === 'dph') return regs?.dptr >> 8;
  return n ? regs?.[n] : undefined;
}
const dmeDirectName = a => a < 0x80 ? h2(a) : (SFR_NAME[SFR[a]] ?? SFR[a]?.toUpperCase() ?? h2(a));

export function dmeOperandValues(row, ram, regs) {
  if (!row?.num || !regs) return '';
  let ops = row.num.split(',').map(s => s.trim()).filter(Boolean);
  if (DME_BRANCH.test(row.instr)) ops = ops.slice(0, -1);
  const bank = ((regs.psw ?? 0) >> 3) & 3;
  const out = [];
  for (const op of ops) {
    let m;
    if (op === 'A') out.push(`A=${h2(regs.acc)}`);
    else if (op === 'AB') out.push(`A=${h2(regs.acc)} B=${h2(regs.b)}`);
    else if (op === 'C' || op === '/C') out.push(`C=${(regs.psw >> 7) & 1}`);
    else if (op === 'DPTR' || op === '@DPTR') out.push(`DPTR=${h2(regs.dptr >> 8)}${h2(regs.dptr & 0xff)}`);
    else if (op === '@A+DPTR') out.push(`A+DPTR=${h4((regs.acc + regs.dptr) & 0xffff)}${regs.mdptr != null ? `→${h2(regs.mdptr)}` : ''}`);
    else if (op === '@A+PC' && regs.mpc != null) out.push(`@A+PC→${h2(regs.mpc)}`);
    else if ((m = op.match(/^R([0-7])$/i))) out.push(`R${m[1]}=${h2(ram?.[bank * 8 + +m[1]])}`);
    else if ((m = op.match(/^@R([01])$/i))) {
      const p = ram?.[bank * 8 + +m[1]];
      out.push(`@R${m[1]}[${h2(p)}]=${p != null && p < 0x80 ? h2(ram?.[p]) : '--'}`);
    }
    else if ((m = op.match(/^\/?0x([0-9a-f]{2})\.([0-7])/i))) {
      const a = parseInt(m[1], 16), v = dmeDirect(a, ram, regs);
      out.push(`${dmeDirectName(a)}.${m[2]}=${v == null ? '-' : (v >> +m[2]) & 1}`);
    }
    else if ((m = op.match(/^0x([0-9a-f]{2})$/i))) {
      const a = parseInt(m[1], 16);
      out.push(`${dmeDirectName(a)}=${h2(dmeDirect(a, ram, regs))}`);
    }
  }
  return out.join(' ');
}

export function klrOperandValues(row, ram, regs) {
  if (!row?.ops || !regs) return '';
  let ops = row.ops.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (KLR_BRANCH.test(row.instr)) ops = ops.slice(0, -1);
  const base = (regs.psw >> 4) & 1 ? 0x18 : 0;
  const out = [];
  for (const op of ops) {
    let m;
    if (op === 'a') out.push(`A=${h2(regs.acc)}`);
    else if (op === 'c') out.push(`C=${(regs.psw >> 7) & 1}`);
    else if (op === 'psw') out.push(`PSW=${h2(regs.psw)}`);
    else if (op === 't') out.push(`T=${h2(regs.t)}`);
    else if (op === 'p1' || op === 'p2') out.push(`${op.toUpperCase()}=${h2(regs[op])}`);
    else if (op === 'f0' || op === 'f1') out.push(`${op.toUpperCase()}=${regs[op]}`);
    else if ((m = op.match(/^r([0-7])$/))) out.push(`R${m[1]}=${h2(ram?.[base + +m[1]])}`);
    else if ((m = op.match(/^@r([01])$/))) {
      const p = ram?.[base + +m[1]];
      out.push(`@R${m[1]}[${h2(p)}]=${p != null ? h2(ram?.[p & 0x7f]) : '--'}`);
    }
  }
  return out.join(' ');
}

// ── Stack decode for the LIVE asm panes ─────────────────────
//
//  DME 8051: stack in iram 64h..79h (SP = 63h when empty), SP = last byte pushed. A call pushes
//  PCL then PCH, so a return address is (ram[sp], ram[sp-1]) = hi, lo.
//  A pair counts as a return address when the instruction just before it
//  is an acall/lcall ('call'); otherwise, if it lands on an instruction
//  boundary, it is probably an interrupt return ('int?'); else one data byte.
//  When the sim sends per-byte stack tags (SIM: [REGS] dmestk) those are
//  used instead, which tells calls, interrupts and PUSHes apart exactly.
//  KLR 8048: 8 two-byte levels at 08h..17h, SP = i8048_core sp (= PSW[2:0]).
//  Frame i: byte 08h+2i = PC[7:0], 09h+2i = PSW[7:4] | PC[11:8].

export const STACK = {
  dme: { lo: 0x64, hi: 0x79 },   // SP = 63h when empty; first push goes to 64h
  klr: { lo: 0x08, hi: 0x17 },
};

const routineOf = (listing, a) => {
  if (!listing.length) return '';
  let i = listing.findIndex(r => r.a > a);
  if (i < 0) i = listing.length;
  for (i--; i >= 0; i--) if (listing[i].label) return listing[i].label;
  return '';
};

// DME stack walk using the sim's per-byte tags (stk[i] is for 64h+i):
// c/C call return lo/hi, i/I interrupt return lo/hi, pXXXX pushed by the
// PUSH at XXXX, '-' unknown.
function dmeTagged(sp, ram, stk, listing, byAddr) {
  const tag = a => stk[a - STACK.dme.lo] ?? '-';
  const frames = [];
  let a = sp;
  while (a >= STACK.dme.lo) {
    const t = tag(a);
    if ((t === 'C' || t === 'I') && tag(a - 1) === t.toLowerCase()) {
      const ret = (ram[a] << 8) | ram[a - 1];
      frames.push({ kind: t === 'C' ? 'call' : 'int', at: a - 1, ret, routine: routineOf(listing, ret) });
      a -= 2;
    } else if (t[0] === 'p') {
      const src = parseInt(t.slice(1), 16), ins = byAddr.get(src);
      const what = ins && /^push$/i.test(ins.instr) ? ins.ops : null;
      frames.push({ kind: 'push', at: a, val: ram[a], src, what });
      a -= 1;
    } else {
      frames.push({ kind: 'data', at: a, val: ram[a] });
      a -= 1;
    }
  }
  return frames;
}

// Returns { sp, used: Set of stack addresses in use, frames: [{kind, at, ret, routine}] }, top first
export function decodeStack(cpu, ram, regs, listing) {
  if (!ram || !regs) return null;
  const byAddr = new Map(listing.map(r => [r.a, r]));
  const frames = [], used = new Set();
  if (cpu === 'dme') {
    const sp = regs.sp, { lo } = STACK.dme;
    for (let a = lo; a <= sp && a < 0x80; a++) used.add(a);
    if (regs.stk) return { sp, used, frames: dmeTagged(sp, ram, regs.stk, listing, byAddr) };
    let a = sp;
    while (a >= lo) {
      const hi8 = ram[a], lo8 = ram[a - 1];
      if (a - 1 >= lo && hi8 != null && lo8 != null) {
        const ret = (hi8 << 8) | lo8;
        const call = byAddr.get(ret - 2)?.instr === 'acall' || byAddr.get(ret - 3)?.instr === 'lcall';
        if (call || byAddr.has(ret)) {
          frames.push({ kind: call ? 'call' : 'int?', at: a - 1, ret, routine: routineOf(listing, ret) });
          a -= 2; continue;
        }
      }
      frames.push({ kind: 'data', at: a, val: hi8 });
      a -= 1;
    }
    return { sp, used, frames };
  }
  // The 3-bit SP wraps, so all 8 levels are listed from the top down.
  const sp = regs.sp ?? (regs.psw & 7);
  let live = true;
  for (let k = 0; k < 8; k++) {
    const i = (sp - 1 - k) & 7, at = STACK.klr.lo + 2 * i, b0 = ram[at], b1 = ram[at + 1];
    if (b0 == null || b1 == null) continue;
    const ret = ((b1 & 0x0f) << 8) | b0;
    const call = /^call$/i.test(byAddr.get(ret - 2)?.instr ?? '');
    // Live levels run down from the top until one that is not a call
    // return (the top one may be an interrupt return instead)
    const kind = !live ? 'old' : call ? 'call' : k === 0 && byAddr.has(ret) ? 'int?' : 'old';
    if (kind === 'old') live = false;
    else { used.add(at); used.add(at + 1); }
    frames.push({ kind, at, ret, psw: b1 >> 4, routine: routineOf(listing, ret) });
  }
  return { sp, used, frames };
}

// ── Where execution came from ───────────────────────────────
//
//  Walks the recent instruction trace (oldest first, last = current PC)
//  back to the most recent non-sequential step: a jump, branch, call,
//  return, or an interrupt entry. Returns { from, to, ins, kind, ago }
//  (ago = instructions executed since, 0 when the transfer landed on the
//  current PC), or null.

const VECTORS = { dme: [0x03, 0x0b, 0x13, 0x1b, 0x23], klr: [0x03, 0x07] };

const insLen = (listing, byAddr, a) => {
  const r = byAddr.get(a);
  const n = r ? r.bytes.split(/\s+/).filter(b => /^[0-9a-f]{1,2}$/i.test(b)).length : 0;
  if (n) return n;
  const i = listing.findIndex(x => x.a > a);
  return i >= 0 ? listing[i].a - a : 1;
};

export function cameFrom(cpu, trace, listing) {
  if (!trace?.length || !listing.length) return null;
  const byAddr = new Map(listing.map(r => [r.a, r]));
  for (let i = trace.length - 1; i > 0; i--) {
    const prev = trace[i - 1], cur = trace[i];
    if (cur === prev + insLen(listing, byAddr, prev)) continue;
    const ins = byAddr.get(prev);
    // Landing on an interrupt vector means an interrupt was taken after prev
    const kind = VECTORS[cpu].includes(cur) ? 'interrupt' : 'jump';
    return { from: prev, to: cur, ins, kind, ago: trace.length - 1 - i };
  }
  return null;
}

// ── Per-instruction register context from SIM: [TRACE] ─────
//
//  Each trace entry is "pc/ctx0/ctx1/ctx2" (hex), captured as the
//  instruction was fetched, i.e. before it ran (see the testbench):
//    DME ctx0 = A B PSW SP DPH DPL [iram @ operand byte 1] [@ byte 2]
//        ctx1 = R0..R7 (active bank), ctx2 = @R0 @R1 code[A+DPTR] code[A+PC+1]
//    KLR ctx0 = A PSW T P1 P2 {F0,F1} @R0 @R1, ctx1 = R0..R7 (active bank)
//  traceState turns one into the { ram, regs } the operand decoders take;
//  ram holds only what was captured, so anything else reads as '--'.

const bytesOf = (hex, n) => Array.from({ length: n }, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));

export function parseTraceEntry(s) {
  const [pc, c0, c1, c2] = s.split('/');
  return { pc: parseInt(pc, 16), ctx: c0 ? { c0, c1, c2 } : null };
}

export function traceState(cpu, ctx, row) {
  if (!ctx) return null;
  const [a0, a1, a2, a3, a4, a5, a6, a7] = bytesOf(ctx.c0, 8);
  const r = bytesOf(ctx.c1, 8);
  const ram = {};
  if (cpu === 'dme') {
    const [ri0, ri1, mdptr, mpc] = bytesOf(ctx.c2, 4);
    const regs = { acc: a0, b: a1, psw: a2, sp: a3, dptr: (a4 << 8) | a5, mdptr, mpc };
    // Direct operands: the instruction's 2nd / 3rd bytes are the addresses
    const ib = (row?.bytes ?? '').split(/\s+/).filter(b => /^[0-9a-f]{1,2}$/i.test(b)).map(b => parseInt(b, 16));
    if (ib[1] != null && ib[1] < 0x80) ram[ib[1]] = a6;
    if (ib[2] != null && ib[2] < 0x80) ram[ib[2]] = a7;
    if (r[0] < 0x80) ram[r[0]] = ri0;
    if (r[1] < 0x80) ram[r[1]] = ri1;
    const bank = (a2 >> 3) & 3;
    r.forEach((v, n) => { ram[bank * 8 + n] = v; });
    return { ram, regs };
  }
  const regs = { acc: a0, psw: a1, t: a2, p1: a3, p2: a4, f0: (a5 >> 1) & 1, f1: a5 & 1 };
  ram[r[0] & 0x7f] = a6;
  ram[r[1] & 0x7f] = a7;
  const base = (a1 >> 4) & 1 ? 0x18 : 0;
  r.forEach((v, n) => { ram[base + n] = v; });
  return { ram, regs };
}
