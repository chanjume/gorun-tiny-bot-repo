# gorun-tiny-bot-repo

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/chanjume/gorun-tiny-bot-repo/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/chanjume/gorun-tiny-bot-repo/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

Regime-adaptive paper-trading bot for hourly Solana prices: it buys oversold dips (24h return under -2%, RSI(14) under 32, close under the lower Bollinger band) and exits at the 20-bar mean, plus strict momentum entries (EMA(8) over EMA(21) with 12-bar return over +2% and RSI under 60), with take-profit +15%, stop-loss -5%, RSI exit over 72 and a 36-bar time stop. On the dev window it scores +$321.54 net PnL (41 trades, 7 symbols, max drawdown 2.1%) against buy-and-hold at -$869.34.

## Run it

```sh
node main.ts
```

Requires Node 22. The bot speaks `agent-fun/bars-replay/v1` on stdin/stdout via the vendored SDK in `vendor/makefun-bars.ts`. No network, no clock, no randomness.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2ms6gy71&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
