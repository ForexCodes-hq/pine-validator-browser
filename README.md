# ForexCodes — Pine Script Validator (browser extension)

Validate your **TradingView Pine Script** for look-ahead bias, repainting and v6 hygiene issues — straight from your browser toolbar, without leaving TradingView.

- **Free** and **local** — the check is deterministic static analysis that runs entirely in your browser. Your code never leaves the machine; there's no login and no API.
- Shows a **Strategy Health Score™** (0–100, code correctness only) and every finding with the exact fix.
- One click to the full audit (AI explanations + shareable badge) at [forexcodes.com](https://forexcodes.com).

## How to use (v0.1)

1. Click the ForexCodes icon in your toolbar.
2. Paste your Pine Script (or **Paste from clipboard** after copying it in the TradingView editor).
3. Hit **Check** — you'll see the Health Score and each look-ahead / repaint / hygiene / intent issue with its fix.

## Load it locally (for testing before the Chrome Web Store)

1. Go to `chrome://extensions`, enable **Developer mode** (top-right).
2. Click **Load unpacked** and select this folder.
3. The ForexCodes icon appears in your toolbar.

## Roadmap

- **v0.2 — in-editor read:** a "Validate with ForexCodes" button injected directly into the TradingView Pine editor that reads your open script automatically. This needs testing against TradingView's live editor (its DOM changes), so it ships once verified there — the toolbar popup above works today regardless.
- Icons + Chrome Web Store listing.

## Honest by design

Code-correctness analysis only — whether your script does what it says and whether its backtest is reproducible. **Not** a measure of profitability, and nothing here is financial advice. Trading involves substantial risk of loss.

MIT © Veltrix Technology LLC (ForexCodes)
