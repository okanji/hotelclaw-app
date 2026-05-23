/**
 * Financial functions — present value, future value, payments, NPV, IRR.
 *
 * Sign convention follows Excel/Sheets: outflows are negative, inflows
 * positive. Rate is per-period (not annualized). `nper` is the number of
 * periods.
 */

import { argToScalarNumber, type FunctionImpl } from "./_helpers";

/**
 * PV(rate, nper, pmt, [fv=0], [type=0])
 * Present value of a stream of equal periodic payments + a future value.
 * `type` 0 = payment at period end, 1 = at period start.
 */
function pv(
  rate: number,
  nper: number,
  pmt: number,
  fv: number,
  type: number,
): number {
  if (rate === 0) return -pmt * nper - fv;
  const factor = (1 + rate) ** nper;
  const pmtAdj = pmt * (1 + rate * type);
  return -(pmtAdj * (factor - 1)) / rate / factor - fv / factor;
}

function fv(
  rate: number,
  nper: number,
  pmt: number,
  pv: number,
  type: number,
): number {
  if (rate === 0) return -pv - pmt * nper;
  const factor = (1 + rate) ** nper;
  const pmtAdj = pmt * (1 + rate * type);
  return -pv * factor - (pmtAdj * (factor - 1)) / rate;
}

function pmt(
  rate: number,
  nper: number,
  pv: number,
  fv: number,
  type: number,
): number {
  if (rate === 0) return -(pv + fv) / nper;
  const factor = (1 + rate) ** nper;
  return (
    (-rate * (pv * factor + fv)) / ((1 + rate * type) * (factor - 1))
  );
}

export const FINANCIAL_FUNCTIONS: Record<string, FunctionImpl> = {
  PV(args, resolve) {
    const rate = argToScalarNumber(args[0]!, resolve);
    const nper = argToScalarNumber(args[1]!, resolve);
    const pmt = argToScalarNumber(args[2]!, resolve);
    const fvArg = args[3] ? argToScalarNumber(args[3], resolve) ?? 0 : 0;
    const type = args[4] ? argToScalarNumber(args[4], resolve) ?? 0 : 0;
    if (rate == null || nper == null || pmt == null) return { type: "error" };
    return { type: "number", value: pv(rate, nper, pmt, fvArg, type) };
  },
  FV(args, resolve) {
    const rate = argToScalarNumber(args[0]!, resolve);
    const nper = argToScalarNumber(args[1]!, resolve);
    const pmtArg = argToScalarNumber(args[2]!, resolve);
    const pvArg = args[3] ? argToScalarNumber(args[3], resolve) ?? 0 : 0;
    const type = args[4] ? argToScalarNumber(args[4], resolve) ?? 0 : 0;
    if (rate == null || nper == null || pmtArg == null) return { type: "error" };
    return { type: "number", value: fv(rate, nper, pmtArg, pvArg, type) };
  },
  PMT(args, resolve) {
    const rate = argToScalarNumber(args[0]!, resolve);
    const nper = argToScalarNumber(args[1]!, resolve);
    const pvArg = argToScalarNumber(args[2]!, resolve);
    const fvArg = args[3] ? argToScalarNumber(args[3], resolve) ?? 0 : 0;
    const type = args[4] ? argToScalarNumber(args[4], resolve) ?? 0 : 0;
    if (rate == null || nper == null || pvArg == null) return { type: "error" };
    return { type: "number", value: pmt(rate, nper, pvArg, fvArg, type) };
  },
  NPER(args, resolve) {
    // Solve nper from the FV equation. Closed-form for rate != 0.
    const rate = argToScalarNumber(args[0]!, resolve);
    const pmtArg = argToScalarNumber(args[1]!, resolve);
    const pvArg = argToScalarNumber(args[2]!, resolve);
    const fvArg = args[3] ? argToScalarNumber(args[3], resolve) ?? 0 : 0;
    if (rate == null || pmtArg == null || pvArg == null) return { type: "error" };
    if (rate === 0) {
      if (pmtArg === 0) return { type: "error" };
      return { type: "number", value: -(pvArg + fvArg) / pmtArg };
    }
    const num = pmtArg - fvArg * rate;
    const den = pmtArg + pvArg * rate;
    if (den === 0 || num / den <= 0) return { type: "error" };
    return { type: "number", value: Math.log(num / den) / Math.log(1 + rate) };
  },
  RATE(args, resolve) {
    // Bisection — robust if not the fastest.
    const nper = argToScalarNumber(args[0]!, resolve);
    const pmtArg = argToScalarNumber(args[1]!, resolve);
    const pvArg = argToScalarNumber(args[2]!, resolve);
    const fvArg = args[3] ? argToScalarNumber(args[3], resolve) ?? 0 : 0;
    if (nper == null || pmtArg == null || pvArg == null) return { type: "error" };
    let lo = -0.999;
    let hi = 10;
    function f(r: number): number {
      return fv(r, nper!, pmtArg!, pvArg!, 0) + fvArg;
    }
    let fa = f(lo);
    let fb = f(hi);
    if (fa * fb > 0) return { type: "error" };
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Math.abs(fm) < 1e-9) return { type: "number", value: mid };
      if (fa * fm < 0) {
        hi = mid;
        fb = fm;
      } else {
        lo = mid;
        fa = fm;
      }
    }
    return { type: "number", value: (lo + hi) / 2 };
  },
  NPV(args, resolve) {
    // NPV(rate, value1, value2, ...). Each value is one period in the future.
    const rate = argToScalarNumber(args[0]!, resolve);
    if (rate == null) return { type: "error" };
    let total = 0;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.type === "range") {
        for (const ref of arg.refs) {
          const v = resolve(ref);
          if (v.type === "number") {
            const t = i;
            total += (v.value as number) / (1 + rate) ** t;
          }
        }
      } else {
        const n = argToScalarNumber(arg, resolve);
        if (n != null) total += n / (1 + rate) ** i;
      }
    }
    return { type: "number", value: total };
  },
  IRR(args, resolve) {
    // IRR(values, [guess=0.1]). Bisection over rates.
    if (args.length === 0) return { type: "error" };
    const cashflows: number[] = [];
    const a = args[0]!;
    if (a.type === "range") {
      for (const ref of a.refs) {
        const v = resolve(ref);
        if (v.type === "number") cashflows.push(v.value as number);
      }
    } else {
      const n = argToScalarNumber(a, resolve);
      if (n != null) cashflows.push(n);
    }
    if (cashflows.length < 2) return { type: "error" };
    function npv(rate: number): number {
      let s = 0;
      for (let i = 0; i < cashflows.length; i++) {
        s += cashflows[i]! / (1 + rate) ** i;
      }
      return s;
    }
    let lo = -0.999;
    let hi = 10;
    let fa = npv(lo);
    let fb = npv(hi);
    if (fa * fb > 0) return { type: "error" };
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const fm = npv(mid);
      if (Math.abs(fm) < 1e-9) return { type: "number", value: mid };
      if (fa * fm < 0) {
        hi = mid;
        fb = fm;
      } else {
        lo = mid;
        fa = fm;
      }
    }
    return { type: "number", value: (lo + hi) / 2 };
  },
};
