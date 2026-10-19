"""The H5 preview may call the API from localhost and private-LAN addresses on its port; nobody else gets a CORS header."""
import pytest


@pytest.mark.parametrize("origin,allowed", [
    ("http://localhost:10086", True), ("http://192.168.0.10:10086", True), ("http://10.1.2.3:10086", True),
    ("https://evil.example.com", False), ("http://192.168.0.10:9999", False), ("http://8.8.8.8:10086", False)])
def test_cors_only_for_the_preview_origins(client, origin, allowed):
    r = client.options("/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
    assert (r.headers.get("access-control-allow-origin") == origin) is allowed

