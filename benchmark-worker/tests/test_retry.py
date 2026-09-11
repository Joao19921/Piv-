import pytest

from benchmark_worker.domain.errors import AdapterDisabledError, SourceUnavailableError
from benchmark_worker.retry import retry_with_backoff, run_isolated


def test_retorna_no_primeiro_sucesso_sem_retry():
    calls = []

    def fn():
        calls.append(1)
        return "ok"

    assert retry_with_backoff(fn, max_retries=3, backoff_seconds=0) == "ok"
    assert len(calls) == 1


def test_tenta_novamente_em_erro_retryable(monkeypatch):
    monkeypatch.setattr("benchmark_worker.retry.time.sleep", lambda _seconds: None)
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] < 3:
            raise SourceUnavailableError("timeout")
        return "ok"

    assert retry_with_backoff(fn, max_retries=5, backoff_seconds=0) == "ok"
    assert calls["n"] == 3


def test_desiste_apos_max_retries(monkeypatch):
    monkeypatch.setattr("benchmark_worker.retry.time.sleep", lambda _seconds: None)

    def fn():
        raise SourceUnavailableError("timeout")

    with pytest.raises(SourceUnavailableError):
        retry_with_backoff(fn, max_retries=2, backoff_seconds=0)


def test_adapter_disabled_nunca_e_retryable(monkeypatch):
    sleeps = []
    monkeypatch.setattr("benchmark_worker.retry.time.sleep", lambda seconds: sleeps.append(seconds))

    def fn():
        raise AdapterDisabledError("sem autorizacao")

    with pytest.raises(AdapterDisabledError):
        retry_with_backoff(fn, max_retries=5, backoff_seconds=1)
    assert sleeps == []


def test_run_isolated_captura_qualquer_excecao():
    def fails():
        raise RuntimeError("boom")

    result, error = run_isolated("fonte-x", fails)
    assert result is None
    assert isinstance(error, RuntimeError)


def test_run_isolated_repassa_sucesso():
    result, error = run_isolated("fonte-x", lambda: 42)
    assert result == 42
    assert error is None
