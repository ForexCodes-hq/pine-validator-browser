// ForexCodes validation engine (TypeScript port of /validator v0.2).
// Deterministic, pattern-based static analysis for Pine Script v6.
// Catches: look-ahead bias (L1), repainting (R1), intrabar divergence (L3),
// version/namespace hygiene (C1), and a deterministic intent check (IN).
// Rules aligned to source-verified Pine v6 semantics. Conservative by design:
// strips comments + strings, skips user-defined names, never matches a
// dot-qualified call — a false alarm is as bad as a miss.
const SEV_RANK = { critical: 4, high: 3, medium: 2, info: 1 };
const stripStrings = (l) => l.replace(/"[^"]*"/g, (m) => " ".repeat(m.length)).replace(/'[^']*'/g, (m) => " ".repeat(m.length));
const stripComment = (l) => {
    const i = l.indexOf("//");
    return i >= 0 ? l.slice(0, i) : l;
};
function collectUserNames(safeLines, safe) {
    const names = new Set();
    // Per-line, fully-bounded scanners — no cross-line re-anchoring or unbounded \s* (avoids O(n^2) on whitespace/newline floods).
    const def = /^\s{0,40}(?:export\s{1,8})?(?:method\s{1,8})?([A-Za-z_]\w*)\s{0,20}\([^\n)]{0,400}\)\s{0,20}=>/;
    const def2 = /^\s{0,40}([A-Za-z_]\w*)\s{0,20}=>/;
    for (const line of safeLines) {
        const a = def.exec(line);
        if (a)
            names.add(a[1]);
        const b = def2.exec(line);
        if (b)
            names.add(b[1]);
    }
    let m;
    const imp = /import\s+[\w./]+(?:\/\d+)?\s+as\s+([A-Za-z_]\w*)/g;
    while ((m = imp.exec(safe)))
        names.add(m[1]);
    return names;
}
function checkLookahead(ctx, push) {
    ctx.safeLines.forEach((line, i) => {
        if (/request\.security(_lower_tf)?\s*\(/.test(line)) {
            if (/lookahead_on/.test(line) && !/\[\s*[1-9]\d*\s*\]/.test(line)) {
                push({
                    code: "L1", rule: "LA-SECURITY-LOOKAHEAD-ON-NO-OFFSET", severity: "critical", line: i + 1,
                    message: "Look-ahead bias: request.security() uses barmerge.lookahead_on without a [1] offset — on historical bars it returns the higher-timeframe value before it exists. The backtest looks great; live will not match.",
                    fix: "Offset the series by [1] and keep lookahead_on, e.g. request.security(sym, tf, close[1], lookahead=barmerge.lookahead_on).",
                });
            }
        }
    });
    ctx.safeLines.forEach((line, i) => {
        const m = line.match(/(?<![.\w])([A-Za-z_]\w*)\s*\[\s*-\s*\d+\s*\]/);
        if (m)
            push({
                code: "L1", rule: "LA-NEGATIVE-OFFSET", severity: "critical", line: i + 1,
                message: `Look-ahead bias: ${m[1]}[-N] reads a FUTURE bar — unavailable in real time.`,
                fix: "Use only non-negative history offsets (series[1], series[2], …). For a forward plot shift use the plot offset= argument, not a negative series index.",
            });
    });
}
function checkCalc(ctx, push) {
    if (!/calc_on_every_tick\s*=\s*true/.test(ctx.safe))
        return;
    if (!/strategy\.(entry|order|exit|close)\s*\(/.test(ctx.safe))
        return;
    let ln = 1;
    ctx.safeLines.forEach((l, i) => { if (ln === 1 && /calc_on_every_tick\s*=\s*true/.test(l))
        ln = i + 1; });
    push({
        code: "L3", rule: "REPAINT-CALC-EVERY-TICK", severity: "medium", line: ln,
        message: "Backtest/live divergence: calc_on_every_tick=true makes orders evaluate intrabar live but only on bar close in the backtest.",
        fix: "Use the default calc_on_every_tick=false, or gate order logic with barstate.isconfirmed if intrabar is intended.",
    });
}
function checkRepaint(ctx, push) {
    const confirmed = /barstate\.isconfirmed/.test(ctx.safe);
    const sinkRe = /(?<![.\w])(alertcondition|alert|plotshape|plotchar)\s*\(/;
    const currentSignal = /ta\.(crossover|crossunder|cross)\s*\(/.test(ctx.safe) ||
        /(?<![.\w])crossover\s*\(/.test(ctx.safe) ||
        /(?<![.\w])crossunder\s*\(/.test(ctx.safe) ||
        /(?<![.\w])(close|open|high|low|hl2|hlc3|ohlc4)\s*(>=|<=|>|<|==|!=)/.test(ctx.safe);
    if (!confirmed && currentSignal && sinkRe.test(ctx.safe)) {
        let ln = 1;
        ctx.safeLines.forEach((l, i) => { if (ln === 1 && sinkRe.test(l))
            ln = i + 1; });
        push({
            code: "R1", rule: "REPAINT-CURRENT-BAR-SIGNAL", severity: "medium", line: ln,
            message: "Possible repaint: a signal/alert is derived from the still-forming bar with no barstate.isconfirmed gate — it can flip before the bar closes.",
            fix: 'Gate the condition with "and barstate.isconfirmed" (or use the prior confirmed bar) if a stable signal is intended.',
        });
    }
    if (/(?<![.\w])varip\b/.test(ctx.safe) && /(bgcolor|plotshape|plotchar|alert|strategy\.)/.test(ctx.safe)) {
        let ln = 1;
        ctx.safeLines.forEach((l, i) => { if (ln === 1 && /(?<![.\w])varip\b/.test(l))
            ln = i + 1; });
        push({ code: "R1", rule: "REPAINT-VARIP-STATE", severity: "medium", line: ln, message: "Repaint: varip persists across realtime ticks and is unavailable on historical bars, so signals from it can't be reproduced historically.", fix: "Don't derive reproducible signals from varip tick state." });
    }
    if (/(?<![.\w])timenow\b/.test(ctx.safe)) {
        let ln = 1;
        ctx.safeLines.forEach((l, i) => { if (ln === 1 && /(?<![.\w])timenow\b/.test(l))
            ln = i + 1; });
        push({ code: "R1", rule: "REPAINT-TIMENOW", severity: "medium", line: ln, message: "Repaint: timenow returns wall-clock time with no meaningful historical value, so logic using it behaves differently live vs. on history.", fix: "Use bar time / time_close for reproducible time logic." });
    }
    if (/ta\.(pivothigh|pivotlow)\s*\(/.test(ctx.safe) && /(plot|plotshape|plotchar)\s*\([^\n]*offset\s*=\s*-\s*\w/.test(ctx.safe)) {
        let ln = 1;
        ctx.safeLines.forEach((l, i) => { if (ln === 1 && /(plot|plotshape|plotchar)\s*\([^\n]*offset\s*=\s*-/.test(l))
            ln = i + 1; });
        push({ code: "R1", rule: "REPAINT-FUTURE-PIVOT", severity: "info", line: ln, message: "Confirmation lag: ta.pivothigh/pivotlow is only known N bars later, but a negative plot offset draws it back onto the pivot bar.", fix: "Fine as a visual if you understand the N-bar lag; ensure no alert/entry treats the pivot as available on the pivot bar." });
    }
}
const TA = ["sma", "ema", "wma", "vwma", "rma", "hma", "swma", "alma", "linreg", "rsi", "atr", "tsi", "sar", "supertrend", "macd", "bb", "bbw", "kc", "kcw", "cci", "cmo", "mfi", "mom", "roc", "wpr", "dmi", "stoch", "cog", "dev", "stdev", "variance", "correlation", "median", "mode", "percentrank", "highest", "lowest", "highestbars", "lowestbars", "change", "cross", "crossover", "crossunder", "barssince", "valuewhen", "cum", "falling", "rising", "pivothigh", "pivotlow"];
const MATH = ["abs", "acos", "asin", "atan", "avg", "ceil", "cos", "exp", "floor", "log", "log10", "max", "min", "pow", "random", "round", "round_to_mintick", "sign", "sin", "sqrt", "sum", "tan", "todegrees", "toradians"];
const STR = ["tostring", "tonumber", "format", "contains", "pos", "replace", "replace_all", "lower", "upper", "split", "startswith", "endswith", "substring", "match", "repeat", "trim", "format_time"];
function checkHygiene(ctx, push) {
    const v = ctx.code.match(/\/\/@version\s*=\s*(\d+)/);
    if (!v)
        push({ code: "C1", rule: "MIG-VERSION", severity: "high", line: 1, message: "Missing //@version=6 — without it the script compiles under older, different semantics.", fix: "Add //@version=6 as the first compiler directive." });
    else if (v[1] !== "6")
        push({ code: "C1", rule: "MIG-VERSION", severity: "high", line: 1, message: `Targets Pine v${v[1]}, not v6 — v6 has breaking changes.`, fix: "Migrate to //@version=6 and update namespaced built-ins." });
    const seen = new Set();
    const once = (k, f) => { if (!seen.has(k)) {
        seen.add(k);
        push(f);
    } };
    const isUser = (n) => ctx.userNames.has(n);
    ctx.safeLines.forEach((line, i) => {
        const ln = i + 1;
        const bare = (n) => new RegExp(`(?<![.\\w])${n}\\s*\\(`).test(line) && !isUser(n);
        for (const fn of TA)
            if (bare(fn))
                once("ta:" + fn, { code: "C1", rule: "MIG-TA-NAMESPACE", severity: "high", line: ln, message: `${fn}() must be ta.${fn}() in v6 — a bare call will not compile.`, fix: `Use ta.${fn}().` });
        for (const fn of MATH)
            if (bare(fn))
                once("math:" + fn, { code: "C1", rule: "MIG-MATH-NAMESPACE", severity: "high", line: ln, message: `${fn}() must be math.${fn}() in v6 — a bare call will not compile.`, fix: `Use math.${fn}().` });
        for (const fn of STR)
            if (bare(fn))
                once("str:" + fn, { code: "C1", rule: "MIG-STR-NAMESPACE", severity: "high", line: ln, message: `${fn}() must be str.${fn}() in v6.`, fix: `Use str.${fn}().` });
        if (bare("study"))
            once("study", { code: "C1", rule: "MIG-STUDY", severity: "high", line: ln, message: "study() was removed — will not compile in v6.", fix: "Use indicator()." });
        if (bare("security"))
            once("security", { code: "C1", rule: "MIG-SECURITY", severity: "high", line: ln, message: "Bare security() was namespaced — will not compile in v6.", fix: "Use request.security()." });
        if (bare("iff"))
            once("iff", { code: "C1", rule: "MIG-IFF", severity: "medium", line: ln, message: "iff() was removed.", fix: "Use a ternary: cond ? a : b." });
    });
}
function checkIntent(ctx, push) {
    if (!/(?<![.\w])strategy\s*\(/.test(ctx.safe))
        return;
    const riskInput = /\b\w*(stop|sl|risk|tp|takeprofit|trail|loss)\w*\s*=\s*input\./i.test(ctx.safe);
    const hasExit = /strategy\.exit\s*\(/.test(ctx.safe) || /strategy\.(entry|order)\s*\([^\n]*(stop|loss|limit|profit|trail)\s*=/.test(ctx.safe);
    if (riskInput && !hasExit) {
        let ln = 1;
        ctx.safeLines.forEach((l, i) => { if (ln === 1 && /\b\w*(stop|sl|risk|tp|takeprofit|trail|loss)\w*\s*=\s*input\./i.test(l))
            ln = i + 1; });
        push({ code: "IN", rule: "INTENT-DEAD-STOP-INPUT", severity: "medium", line: ln, message: "Intent mismatch: a stop/risk input is declared but never wired into a strategy.exit(stop=...) — the risk control doesn't exist in the executed logic.", fix: 'Register it, e.g. strategy.exit("x", stop=...); or remove the dead input.' });
    }
}
const CHECKS = [checkLookahead, checkCalc, checkRepaint, checkHygiene, checkIntent];
// Does this even look like Pine Script? Rejects plain-English / non-code so we never score
// gibberish. Looks for unambiguous Pine signals: the version directive, a declaration/plot/input
// call, a namespaced builtin (ta./math./request./strategy.…), or the := / => operators.
const PINE_SIGNAL = /\/\/@version|(?:^|[^.\w])(?:indicator|strategy|study|plot|plotshape|plotchar|plotcandle|hline|bgcolor|fill|input|alertcondition)\s*\(|\b(?:ta|math|request|str|array|matrix|map|strategy|box|line|label|table|barstate|syminfo|timeframe|ticker|color|chart)\.[a-z]|:=|=>/;
export function looksLikePine(code) {
    return PINE_SIGNAL.test(code);
}
export function validate(code) {
    const cmtLines = code.split(/\r?\n/).map(stripComment);
    const safeLines = code.split(/\r?\n/).map((l) => stripStrings(stripComment(l)));
    const safe = safeLines.join("\n");
    const ctx = { code, cmtLines, safeLines, safe, userNames: collectUserNames(safeLines, safe) };
    const findings = [];
    for (const c of CHECKS)
        c(ctx, (f) => findings.push(f));
    findings.sort((a, b) => a.line - b.line || SEV_RANK[b.severity] - SEV_RANK[a.severity]);
    const counts = { critical: 0, high: 0, medium: 0, info: 0 };
    for (const f of findings)
        counts[f.severity]++;
    let verdict;
    if (counts.critical)
        verdict = "NEEDS FIXES — critical correctness issue(s)";
    else if (counts.high)
        verdict = "NEEDS FIXES — high-severity issue(s)";
    else if (counts.medium)
        verdict = "REVIEW — issues to confirm";
    else if (counts.info)
        verdict = "REVIEW — advisory note(s) only";
    else
        verdict = "CLEAN — no issues detected by the checks run";
    return { findings, counts, verdict };
}
