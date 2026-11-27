import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _reset_throttles(settings):
    cache.clear()
    settings.FINPILOT_REGISTRATION = "open"  # les tests de synchro créent plusieurs comptes librement
    yield
