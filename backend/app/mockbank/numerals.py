"""Amounts as words, deterministic (no LLM): 4250 -> 四千二百五十, 12.5 -> 十二元五角."""
D = "零一二三四五六七八九"
U = ["", "十", "百", "千"]
BIG = ["", "万", "亿"]


def _four(v: int) -> str:
    s, zero = "", False
    for i, ch in enumerate(f"{v:04d}"):
        d, pos = int(ch), 3 - i
        if d == 0:
            zero = True
            continue
        if zero and s:
            s += "零"
        zero = False
        s += D[d] + U[pos]
    return s


def int_zh(n: int) -> str:
    if n == 0:
        return "零"
    groups = []
    while n:
        groups.append(n % 10000)
        n //= 10000
    out, zero = "", False
    for gi in range(len(groups) - 1, -1, -1):
        v = groups[gi]
        if v == 0:
            zero = True
            continue
        if out and (zero or v < 1000):
            out += "零"
        out += _four(v) + BIG[gi]
        zero = False
    return out[1:] if out.startswith("一十") else out


def amount_zh(x: float) -> str:
    """With the unit: 800 -> 八百元, 12.5 -> 十二元五角, 0.05 -> 零元零五分."""
    yuan, rest = divmod(round(x * 100), 100)
    jiao, fen = divmod(rest, 10)
    s = int_zh(yuan) + "元"
    if jiao:
        s += D[jiao] + "角"
    if fen:
        s += ("零" if not jiao else "") + D[fen] + "分"
    return s


def amount_digits(x: float) -> str:
    return f"{x:,.2f}".rstrip("0").rstrip(".")
