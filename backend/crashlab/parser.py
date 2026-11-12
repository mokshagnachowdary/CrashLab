"""Deterministic Story Mode parser: free text -> scenario fields and transparent assumptions."""
from __future__ import annotations

import re

NUM = r"([+-]?\d+(?:\.\d+)?)\s*(?:%|percent|per cent)"
DOWN = r"(?:fall\w*|drop\w*|crash\w*|declin\w*|plung\w*|slump\w*|los\w*|tumble\w*|sink\w*|depress\w*|tank\w*|crater\w*|collapse\w*|wipe(?:s|d)?\s+out|sell[- ]?off|rout|hammer\w*|crush\w*|wreck\w*|freefall)"
UP = r"(?:ris\w*|increas\w*|gain\w*|jump\w*|surge\w*|spik\w*|rall\w*|climb\w*|soar\w*|moon\w*|skyrocket\w*|boom\w*|rip\w*|through\s+the\s+roof)"
ASSET_PATTERNS = {
    "NIFTY": r"(?:nifty(?:\s*50)?|sensex|index|market|equities|stocks?|shares?)", "BANK": r"(?:bank(?:ing)?(?:\s+(?:stocks|index|sector|nifty))?|nifty\s*bank)",
    "IT": r"(?:\bit\b(?:\s+(?:stocks|sector|index))?|tech(?:nology)?(?:\s+stocks)?|nifty\s*it)",
    "GOLD": r"gold", "CRUDE": r"(?:crude(?:\s+oil)?|\boil\b|brent|wti)",
}
QUALITATIVE_SHOCKS = {"NIFTY": .10, "BANK": .12, "IT": .10, "GOLD": .08, "CRUDE": .12}
NEGATION = re.compile(
    r"\b(?:not(?!\s+only)|never|no|without|avoid\w*|didn't|doesn't|don't|"
    r"isn't|won't|can't)\b(?:\W+\w+){0,3}\W*$"
)
EVENT_TEMPLATES = (
    ("geopolitical shock", r"\b(?:war|trade war|conflict|invasion|geopolitical|military escalation|supply disruption|sanctions?)\b",
     {"NIFTY": -.08, "BANK": -.09, "IT": -.06, "GOLD": .08, "CRUDE": .15, "USDINR": .03}, "extreme"),
    ("recession", r"\b(?:recession|depression|economic slowdown|contraction|stagflation|credit crunch|debt crisis)\b",
     {"NIFTY": -.12, "BANK": -.15, "IT": -.10, "GOLD": .05, "CRUDE": -.15, "USDINR": .04}, "extreme"),
    ("oil shock", r"\b(?:(?:oil|energy|crude)\s+shock|energy crisis|oil prices?\s+(?:spik\w*|surge\w*|soar\w*))\b",
     {"NIFTY": -.07, "BANK": -.08, "IT": -.05, "GOLD": .04, "CRUDE": .20, "USDINR": .03}, "elevated"),
    ("inflation/rate shock", r"\b(?:inflation shock|inflation surges?|rate hikes?|rates? (?:hike|rise|increase)|interest rates? (?:rise|increase|hike)|monetary tightening)\b",
     {"NIFTY": -.08, "BANK": -.10, "IT": -.07, "GOLD": -.05, "CRUDE": .02, "USDINR": .03}, "elevated"),
    ("broad market stress", r"\b(?:crisis|crash|meltdown|panic|turmoil|contagion|sell[- ]?off|bear market|market rout|market collapse|pandemic|stocks? tank\w*|shares? tank\w*)\b",
     {"NIFTY": -.10, "BANK": -.12, "IT": -.08, "GOLD": .05, "CRUDE": -.05, "USDINR": .03}, "extreme"),
    ("broad market rally", r"\b(?:bull market|market rally|market boom|economic boom|melt[- ]?up)\b",
     {"NIFTY": .10, "BANK": .12, "IT": .10, "GOLD": -.03, "CRUDE": .06, "USDINR": -.02}, "normal"),
)


def _is_negated(text: str, position: int) -> bool:
    prefix = text[max(0, position - 40):position]
    prefix = re.split(r"[,;.]|\b(?:but|however|although)\b", prefix)[-1]
    return bool(NEGATION.search(prefix))


def _first_asserted(pattern: str, text: str, group: int = 0):
    return next(
        (
            match for match in re.finditer(pattern, text)
            if not _is_negated(text, match.start(group))
            and not re.match(
                r"\W*(?:(?:is|are|was|were|will|would|could|may|might|should|can|"
                r"did|does|do)\s+)?(?:not\b|unlikely\b|improbable\b|ruled\s+out\b)",
                text[match.end(group):],
            )
        ),
        None,
    )


def _find_sign_pct(text: str, asset_pat: str):
    for m in re.finditer(asset_pat, text):
        window = re.split(r"[,;.]|\band\b", text[m.end(): m.end() + 70])[0]  # stay inside this clause
        ctx = text[max(0, m.start() - 25): m.end() + 70]
        n = re.search(NUM, window)
        seg = window[: n.start()] if n else window
        rising = re.search(rf"(?:{UP})|\b(?:up|higher|stronger)\b", seg)
        falling = re.search(rf"(?:{DOWN})|\b(?:down|lower|weaker|wrecked)\b", seg)
        if (rising and _is_negated(text, m.end() + rising.start())) or (
            falling and _is_negated(text, m.end() + falling.start())
        ):
            continue
        if n:
            magnitude = abs(float(n.group(1))) / 100
            if rising: return magnitude, ctx, False
            if falling: return -magnitude, ctx, False
            if n.group(1).startswith(("+", "-")) and not _is_negated(text, m.end() + n.start()):
                return float(n.group(1)) / 100, ctx, False
        elif rising or falling:
            return (1 if rising else -1) * QUALITATIVE_SHOCKS.get("NIFTY", .10), ctx, True
    return None, None, False


def parse_story(text: str) -> dict:
    t = " ".join(text.lower().split())
    shocks, found, warnings = {}, [], []
    # Currency first: rupee depreciates N% => USDINR +N% ; appreciates => USDINR -N% (strictly, rupee +N% => USDINR -N/(1+N))
    currency_pattern = r"((?:rupee|inr|usd/inr|usdinr))[^.,;]{0,40}?(depreciat\w*|weaken\w*|fall\w*|drop\w*|slid\w*|down|lower|tank\w*|crash\w*|collaps\w*|apprecia\w*|strengthen\w*|gain\w*|ris\w*|up|higher|stronger)[^.,;]{0,20}?" + NUM
    m = _first_asserted(currency_pattern, t, 2)
    if m:
        v = abs(float(m.group(3))) / 100
        pair = m.group(1) in ("usd/inr", "usdinr")
        verb = m.group(2)
        if pair:
            shocks["USDINR"] = v if re.search(UP, verb) else -v
        else:
            appreciates = verb.startswith(("apprec", "strength", "gain", "ris", "up", "higher"))
            shocks["USDINR"] = -v / (1 + v) if appreciates else v
        found.append(f"USD/INR {shocks['USDINR']:+.1%}")
    else:
        currency_direction_pattern = r"((?:rupee|inr|usd/inr|usdinr))[^.,;]{0,40}?(" + f"{DOWN}|{UP}|weak\\w*|depreciat\\w*|freefall|strength\\w*|apprecia\\w*|up|higher|stronger" + r")"
        m = _first_asserted(currency_direction_pattern, t, 2)
        if m:
            pair = m.group(1) in ("usd/inr", "usdinr")
            falling = bool(re.search(DOWN, m.group(2)) or re.search(r"\b(?:down|lower|weaker)\b", m.group(2)) or re.search(r"weak\w*|depreciat\w*|freefall", m.group(2)))
            sign = (-1 if falling else 1) if pair else (1 if falling else -1)
            shocks["USDINR"] = sign * .03
            action = "weakening" if shocks["USDINR"] > 0 else "strengthening"
            found.append(f"USD/INR {shocks['USDINR']:+.1%} (illustrative default for a {action} rupee)")
            warnings.append(f"No currency percentage was given; used an illustrative {shocks['USDINR']:+.0%} USD/INR move.")
    t_assets = re.sub(r"(?:rupee|inr|usd/inr|usdinr)[^.,;]*", " ", t)
    for a in ("BANK", "IT", "GOLD", "CRUDE", "NIFTY"):
        pat = ASSET_PATTERNS[a]
        text_a = t_assets if a != "NIFTY" else re.sub(ASSET_PATTERNS["BANK"], " ", t_assets)
        v, _, qualitative = _find_sign_pct(text_a, pat)
        if v is not None and a not in shocks:
            if qualitative:
                magnitude = QUALITATIVE_SHOCKS.get(a, .03)
                v = magnitude if v > 0 else -magnitude
                warnings.append(f"No percentage was given for {a}; used an illustrative {v:+.0%} move.")
            shocks[a] = v; found.append(f"{a} {v:+.1%}")

    template = next(
        (
            (name, values, regime)
            for name, pattern, values, regime in EVENT_TEMPLATES
            if _first_asserted(pattern, t)
        ),
        None,
    )
    if template:
        name, values, _ = template
        inferred = [asset for asset in values if asset not in shocks]
        for asset in inferred:
            shocks[asset] = values[asset]
        if inferred:
            found.append(f"inferred {name} template")
            warnings.append(f"Applied an illustrative {name} template to unspecified assets; review or edit the assumed shocks.")

    hz = None
    m = re.search(r"(?:over|in|within|across)\s+(?:the\s+(?:next|last)\s+)?(\d{1,2})\s*(trading\s+days?|days?|weeks?|sessions?)", t)
    if m:
        hz = int(m.group(1)) * (5 if m.group(2).startswith("week") else 1); found.append(f"horizon {hz} trading days")
    regime = None
    if _first_asserted(r"extreme(?:ly)?\s+(?:volatil|vol)|severe\s+volatil|panic|turmoil", t): regime = "extreme"
    elif _first_asserted(r"(?:elevated|high|heightened|rising|increased)\s+volatil|volatility\s+(?:spike|surge|rises?)|volatile", t): regime = "elevated"
    elif _first_asserted(r"calm|low volatil|stable", t): regime = "normal"
    elif template: regime = template[2]
    if regime: found.append(f"regime {regime}")
    if not shocks and hz is None and regime is None:
        warnings.append("No market scenario was recognised. Mention an asset and market move, or an event such as a recession, war, oil shock, rate hike, or market rally.")
    if hz is not None and hz > 20: warnings.append("Horizon capped to 20 trading days (model maximum).")
    return {"shocks": shocks, "horizon": min(hz, 20) if hz else None, "regime": regime, "found": found, "warnings": warnings}
