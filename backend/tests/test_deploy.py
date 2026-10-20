"""One-service deploy: the API answers under /api as well, and the public-demo model budget turns calls into template fallbacks."""
from app import demo_limit, trace
from app.config import settings


def test_api_is_also_served_under_api_prefix(client):
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/bank/balance").json() == client.get("/bank/balance").json()  # same router, two mounts


def test_demo_budget_per_ip_then_flag(monkeypatch):
    monkeypatch.setattr(settings, "demo_public", True)
    monkeypatch.setattr(settings, "demo_per_minute", 2)
    demo_limit._hits.clear()
    ctx = trace.begin(None, "POST /voice/asr")
    ctx["ip"] = "1.2.3.4"
    assert demo_limit.allowed() and demo_limit.allowed()
    assert not demo_limit.allowed() and ctx["limited"]  # the third call in a minute is refused
    ctx2 = trace.begin(None, "POST /voice/asr")
    ctx2["ip"] = "5.6.7.8"
    assert demo_limit.allowed()  # another visitor is unaffected


def test_budget_is_off_outside_the_public_demo(monkeypatch):
    monkeypatch.setattr(settings, "demo_public", False)
    assert all(demo_limit.allowed() for _ in range(100))
