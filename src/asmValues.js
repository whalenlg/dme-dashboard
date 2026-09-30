// ── Operand values for the LIVE assembly panes ──────────────
//
//  Resolves the data an instruction's operands refer to (registers,
//  direct RAM, @Ri, bits, SFRs) against the latest snapshot:
//    ram  — internal RAM bytes (DME iram / KLR ram), indexed 0..127
//    regs — CPU registers from "SIM: [REGS]" (lower-case names, numbers)
//  Returns a short text such as "A=04 R7=1F @R0[5A]=12 23.2=1", or ''.
//  Immediates and jump/call targets are skipped.

const h2 = v => v == null || isNaN(v) ? '--' : v.toString(16).toUpperCase().padStart(2, '0');

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
    else if (op === '@A+DPTR') out.push(`A+DPTR=${((regs.acc + regs.dptr) & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`);
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
