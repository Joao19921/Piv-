from benchmark_worker.normalization.employment import normalize_regime


def test_reconhece_clt():
    assert normalize_regime("CLT - carteira assinada") == "clt"


def test_reconhece_pj():
    assert normalize_regime("Contrato PJ") == "pj"
    assert normalize_regime("Contractor") == "pj"


def test_sem_evidencia_fica_desconhecido():
    # Nao inferir CLT/PJ sem evidencia (PLANO-BENCHMARK-WORKER.md).
    assert normalize_regime("Vaga para analista") == "unknown"
    assert normalize_regime(None) == "unknown"
