"""This quarter's tax estimate: information only, never filing. Numbers: code. Thresholds and rates: rule_tax rows only."""
from sqlmodel import Session, select

from app import clock
from app.agent.grounding import assert_wording
from app.analysis.common import load_rules, n, period_bounds, rules_view
from app.analysis.reconcile import monthly_class_totals, reconcile_range
from app.audit import chain
from app.models import BankAccount, BankCustomer, BankTxn

FOOTER = "这是估算，不是报税 · 请咨询12366"  # a fixed disclaimer, like compliance.DISCLAIMER: it names what this is NOT
RULE_IDS = ["vat_ann2026_no10_threshold", "vat_law_art24_own_produce", "eit_small_low_profit", "eit_agri_primary_exempt",
            "eit_trading_not_exempt", "iit_individual_placeholder"]
STRUCTURE_ZH = {"individual": "个人", "个体工商户": "个体工商户", "cooperative": "合作社", "company": "公司"}
POT_LABEL = "税金预留"  # same label as the tax pot the standing rule fills


def current_period() -> str:
    t = clock.today()
    return f"{t.year}-Q{(t.month - 1) // 3 + 1}"


def estimate_tax(s: Session, customer_id: int, period: str | None = None) -> dict:
    """Audited; caller commits. VAT: exempt only while the sales are BELOW the threshold (reaching it taxes all of them).
    Income tax: only the resale margin can be taxed (own produce is exempt); no individual rate table is in the rules, so the
    upper figure uses the one rate the table has (small low-profit enterprise) and says so."""
    period = period or current_period()
    start, end = period_bounds(period)
    cust = s.get(BankCustomer, customer_id)
    if not cust:
        raise ValueError("customer not found")
    rules = load_rules(s, RULE_IDS)
    q = reconcile_range(s, customer_id, start, end)
    months = monthly_class_totals(s, start, end)

    thr = rules["vat_ann2026_no10_threshold"].rate_or_threshold
    q_limit, m_limit, rate = thr["thresholds"]["quarter"], thr["thresholds"]["month"], thr["levy_rate"]
    by = q["by_class"]
    resale, own = by["resale"], by["own_produce"]
    other = round(by["processed"] + by["needs_confirmation"], 2)
    month_resale = {m: c["resale"] for m, c in months.items()}
    quarter_reached = resale >= q_limit  # strictly below = exempt
    reached_months = [m for m, v in month_resale.items() if v >= m_limit]
    vat = round(resale * rate, 2) if quarter_reached else round(sum(month_resale[m] for m in reached_months) * rate, 2)
    reached = quarter_reached or bool(reached_months)

    acct = s.exec(select(BankAccount).where(BankAccount.customer_id == customer_id)).one()
    bought = round(sum(t.amount for t in s.exec(select(BankTxn).where(
        BankTxn.account_id == acct.id, BankTxn.direction == "debit", BankTxn.category == "supplier_honey",
        BankTxn.ts >= start, BankTxn.ts < end))), 2)
    margin = round(max(resale - bought, 0.0), 2)
    eit = rules["eit_small_low_profit"].rate_or_threshold["effective_rate"]
    income_high = round(margin * eit, 2)
    high = round(vat + income_high, 2)

    vat_text = (f"增值税：本季度转卖销售额{n(resale)}元，季度门槛{n(q_limit)}元，单月门槛{n(m_limit)}元。"
                + (f"已达到门槛，按规则全额计税（征收率{rate:.0%}），约{n(vat)}元。" if reached
                   else "目前低于门槛，按规则免征，约0元。自产蜂蜜按增值税法第二十四条免征。"))
    income_text = (f"所得税：自产部分的农业所得免征，转卖部分的毛利约{n(margin)}元（转卖销售额减去本季度已付邻居蜂蜜款）。"
                   f"规则表里没有个人所得税率表，这里只能按表里唯一的税率（小型微利企业约{eit:.0%}）给个参考上限，约{n(income_high)}元，下限为0。")
    assumptions = [vat_text, income_text, "数字取自本季度已记录的平台订单和银行流水，是估算，不是纳税结果"]
    assert_wording(assumptions)
    used = set(RULE_IDS)
    chain.append(s, "analysis", "tax_estimated", {"customer_id": customer_id, "period": period, "vat": vat, "income_tax_high": income_high,
                 "rule_ids": sorted(used)})
    return {
        "period": period, "structure_zh": STRUCTURE_ZH.get(cust.profile.get("structure", ""), "未登记"),
        "own_produce": own, "resale": resale, "other": other,
        "vat_threshold_quarter": q_limit, "vat_threshold_month": m_limit, "vat_status": "reached" if reached else "below",
        "vat": vat, "income_tax_low": 0.0, "income_tax_high": income_high, "total_low": vat, "total_high": high,
        "reserve_label": POT_LABEL, "reserve_amount": high,
        "readback_zh": f"把 {n(high)} 元先存起来做税金，只是留出来，不转走，对吗？" if high else "",
        "assumptions": assumptions, "rules": rules_view(rules, used), "rule_ids": sorted(used), "footer_zh": FOOTER,
    }
