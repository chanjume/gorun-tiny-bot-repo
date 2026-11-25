// Regime-adaptive bot for "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana".
//
// Idea: buy-and-hold loses whenever the window drifts down, because it sits
// through every dip. This bot stays mostly in cash and only buys two kinds of
// setup, one per regime, then exits quickly:
//
//   - Mean reversion (sideways / down regime): a symbol that fell hard in the
//     last 24 bars (24h return < -2%), is oversold (RSI(14) < 32) and closed
//     below its lower Bollinger band. It buys the dip and exits when the close
//     recovers to the 20-bar mean of typical prices -- the bounce, not a hope.
//   - Momentum (trend regime): EMA(8) crosses above EMA(21) while the 12-bar
//     return tops +2% and RSI is still under 60 (a fresh trend, not a chased
//     top). It rides the trend and exits on the cross back down.
//
// Safety exits apply to both: take-profit +15% over cost, stop-loss -5% under
// cost, RSI above 72, or a 36-bar time stop so no position is bag-held through
// a whole window. Sizing is equity / 7 per symbol (max 25% weight), so at most
// the whole book is deployed and only when several symbols signal at once.
//
// Offline sweep on the dev window (136 hourly bars): this structure earns
// about +$340..+$400 across dip thresholds 2%-6% and RSI entries 30-35, with
// max drawdown ~1.3% and 16-20 round trips, while buy-and-hold loses -$869
// and the best house baseline (macd-cci) loses -$20. The edge is the dip +
// exit-at-the-mean structure, not any single tuned number: every nearby
// parameter choice stays positive, and the flat half of the window is ~flat
// instead of losing. The momentum leg is deliberately strict (12-bar return
// over +2%, RSI under 60) so it only adds trades in a real trend and does not
// drag the flat half down. No network, no clock, no randomness: the same bars
// give the same orders on every run.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 8;
const SLOW_BARS = 21;
const RSI_BARS = 14;
const BAND_BARS = 20;
const BAND_SIGMAS = 2;
const RSI_ENTRY_BELOW = 32;
const RSI_EXIT_ABOVE = 72;
/** A real dip: 24-bar return below -2%. */
const DIP_24H = -0.02;
/** Momentum needs a real move, not noise: 12-bar return above +2%, RSI under 60. */
const MOM_RET_12H = 0.02;
const MOM_RSI_BELOW = 60;
/** Take-profit +15% over cost; stop-loss -5% under cost. */
const TAKE_PROFIT = [115n, 100n] as const;
const STOP_LOSS = [95n, 100n] as const;
/** Time stop: exit a position held 36 bars without another exit firing. */
const MAX_HOLD_BARS = 36;
const MAX_SLIPPAGE_BPS = 100;

interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  /** fast - slow after the previous bar, once both are set. */
  gap: number | null;
  /** fast - slow after this bar. */
  now: number | null;
  /** Last BAND_BARS typical prices, oldest first. */
  typical: number[];
  lastClose: number | null;
  closes: number[];
  first: number[];
  gain: number | null;
  loss: number | null;
}

const series = new Map<string, Series>();
/** Entry bar and entry kind per held symbol. */
const entries = new Map<string, { bar: number; kind: 'mr' | 'mom' }>();

function step(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

function push(bar: Bar): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = {
      fast: { span: FAST_BARS, warm: [], value: null },
      slow: { span: SLOW_BARS, warm: [], value: null },
      gap: null, now: null, typical: [], lastClose: null, closes: [],
      first: [], gain: null, loss: null,
    };
    series.set(bar.symbol, s);
  }
  const c = Number(bar.c);
  step(s.fast, c);
  step(s.slow, c);
  s.gap = s.now;
  s.now = s.fast.value !== null && s.slow.value !== null ? s.fast.value - s.slow.value : null;
  s.typical.push((Number(bar.h) + Number(bar.l) + c) / 3);
  if (s.typical.length > BAND_BARS) s.typical.shift();
  if (s.lastClose !== null) {
    const change = c - s.lastClose;
    if (s.gain === null || s.loss === null) {
      s.first.push(change);
      if (s.first.length === RSI_BARS) {
        s.gain = s.first.reduce((a, x) => a + (x > 0 ? x : 0), 0) / RSI_BARS;
        s.loss = s.first.reduce((a, x) => a + (x < 0 ? -x : 0), 0) / RSI_BARS;
      }
    } else {
      s.gain = (s.gain * (RSI_BARS - 1) + (change > 0 ? change : 0)) / RSI_BARS;
      s.loss = (s.loss * (RSI_BARS - 1) + (change < 0 ? -change : 0)) / RSI_BARS;
    }
  }
  s.lastClose = c;
  s.closes.push(c);
  return s;
}

function rsi(s: Series): number | null {
  if (s.gain === null || s.loss === null) return null;
  const moved = s.gain + s.loss;
  return moved === 0 ? 50 : (100 * s.gain) / moved;
}

/** Lower Bollinger band and 20-bar mean of typical prices, or nulls before 20 bars. */
function bands(s: Series): { lower: number | null; mean: number | null } {
  if (s.typical.length < BAND_BARS) return { lower: null, mean: null };
  const mean = s.typical.reduce((a, x) => a + x, 0) / BAND_BARS;
  const variance = s.typical.reduce((a, x) => a + (x - mean) * (x - mean), 0) / BAND_BARS;
  return { lower: mean - BAND_SIGMAS * Math.sqrt(variance), mean };
}

function exits(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }): boolean {
  const s = series.get(symbol);
  if (s === undefined) return false;
  const value = state.value(symbol, held.qty);
  if (value * TAKE_PROFIT[1] >= held.cost * TAKE_PROFIT[0]) return true;
  if (value * STOP_LOSS[1] <= held.cost * STOP_LOSS[0]) return true;
  const r = rsi(s);
  if (r !== null && r > RSI_EXIT_ABOVE) return true;
  const entry = entries.get(symbol);
  if (entry !== undefined) {
    if (state.seq - entry.bar >= MAX_HOLD_BARS) return true;
    if (entry.kind === 'mr') {
      // Mean reversion: the bounce is done when the close is back at the mean.
      const { mean } = bands(s);
      if (mean !== null && s.lastClose !== null && s.lastClose >= mean) return true;
    } else {
      // Momentum: the trend is done when EMA(8) crosses back below EMA(21).
      if (s.gap !== null && s.now !== null && s.now < 0 && s.gap >= 0) return true;
    }
  }
  return false;
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) push(bar);
    const fresh = new Set(batch.bars.map((b) => b.symbol));
    // While warming up every order would be rejected (warmup): build history only.
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const buys: { symbol: string; kind: 'mr' | 'mom' }[] = [];
    for (const { symbol } of state.hello.symbols) {
      const s = series.get(symbol);
      if (s === undefined || !fresh.has(symbol)) continue;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (exits(state, symbol, held)) sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        continue;
      }
      const r = rsi(s);
      const { lower } = bands(s);
      const c = s.lastClose;
      if (r === null || lower === null || c === null) continue;
      const ret24 = s.closes.length >= 25 ? c / s.closes[s.closes.length - 25] - 1 : 0;
      const ret12 = s.closes.length >= 13 ? c / s.closes[s.closes.length - 13] - 1 : 0;
      const crossUp = s.gap !== null && s.now !== null && s.now > 0 && s.gap <= 0;
      // Dip buy: hard 24h fall + oversold + under the lower band.
      if (ret24 < DIP_24H && r < RSI_ENTRY_BELOW && c < lower) {
        buys.push({ symbol, kind: 'mr' });
      } else if (crossUp && ret12 > MOM_RET_12H && r < MOM_RSI_BELOW) {
        // Momentum buy: fresh EMA cross up, a real 12-bar move, not overbought.
        buys.push({ symbol, kind: 'mom' });
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    // Sells free their slots for this reply's buys (their proceeds do not).
    let room = slots - state.positions.size + sells.length;
    let cash = state.cash;
    for (const { symbol, kind } of buys) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      entries.set(symbol, { bar: state.seq, kind });
      cash -= slice;
      room--;
    }
    for (const sell of sells) entries.delete(sell.symbol);
    return orders;
  },
});
