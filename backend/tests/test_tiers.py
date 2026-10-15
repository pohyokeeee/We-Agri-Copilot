from datetime import datetime
from itertools import product

import pytest

from app.risk.tiers import BASE_TIER, GREEN, RED, YELLOW, _RANK, classify

DAY = datetime(2026, 7, 10, 12, 0)


def test_reads_green():
    assert classify("read", now=DAY)["final_tier"] == GREEN
    assert classify("analysis", now=DAY)["final_tier"] == GREEN


def test_transfer_known_payee_small_is_yellow():
    r = classify("transfer", now=DAY, amount=500, balance=10_000)
    assert (r["base_tier"], r["final_tier"], r["reasons"]) == (YELLOW, YELLOW, [])


@pytest.mark.parametrize("kw,reason", [
    (dict(payee_known=False), "new payee"),
    (dict(usual_amount=100, amount=201), "2x usual"),
    (dict(balance=1000, amount=501), "50% of balance"),
    (dict(now=datetime(2026, 7, 10, 23, 0)), "night"),
    (dict(now=datetime(2026, 7, 10, 5, 59)), "night"),
])
def test_each_raise_rule_lifts_yellow_to_red(kw, reason):
    args = dict(now=DAY, amount=10, balance=1_000_000) | kw
    r = classify("schedule", **args)  # schedule is base yellow, so only the raise rules can move it
    assert r["base_tier"] == YELLOW and r["final_tier"] == RED
    assert any(reason in x for x in r["reasons"])


def test_boundaries_do_not_raise():
    # exactly 2x usual, exactly 50% of balance, 06:00 and 22:59 are all fine
    assert classify("schedule", now=DAY, amount=200, usual_amount=100, balance=1_000_000)["final_tier"] == YELLOW
    assert classify("schedule", now=DAY, amount=500, balance=1000)["final_tier"] == YELLOW
    assert classify("schedule", now=datetime(2026, 7, 10, 6, 0), amount=1)["final_tier"] == YELLOW
    assert classify("schedule", now=datetime(2026, 7, 10, 22, 59), amount=1)["final_tier"] == YELLOW


def test_daily_cumulative_crossing_1000():
    ok = classify("transfer", now=DAY, amount=400, daily_total=600, balance=10_000)
    assert ok["final_tier"] == YELLOW  # exactly 1000 is still allowed
    over = classify("transfer", now=DAY, amount=401, daily_total=600, balance=10_000)
    assert (over["base_tier"], over["final_tier"]) == (RED, RED)
    assert any("daily total" in x for x in over["reasons"])


def test_new_payee_transfer_base_red():
    assert classify("transfer", now=DAY, amount=1, payee_known=False)["base_tier"] == RED


def test_fixed_base_tiers():
    assert BASE_TIER["financing_submit"] == RED and BASE_TIER["unlock"] == RED
    for a in ("reserve", "schedule", "financing_prefill", "schedule_cancel"):
        assert classify(a, now=DAY, amount=1, balance=1000)["base_tier"] == YELLOW


def test_cosigner_only_when_protected_and_red():
    assert classify("unlock", now=DAY, protection_mode=True)["requires_cosigner"]
    assert not classify("unlock", now=DAY, protection_mode=False)["requires_cosigner"]
    assert not classify("transfer", now=DAY, amount=1, protection_mode=True)["requires_cosigner"]  # yellow


def test_never_lowers_tier():
    for action, known, amt, daily, night in product(BASE_TIER | {"transfer": 0}, (True, False), (0, 5, 5000), (0, 999), (False, True)):
        r = classify(action, now=datetime(2026, 7, 10, 2 if night else 12), amount=amt, payee_known=known,
                     daily_total=daily, balance=100, usual_amount=1)
        assert _RANK[r["final_tier"]] >= _RANK[r["base_tier"]]
        if action in ("read", "analysis"):
            assert r["final_tier"] == GREEN
