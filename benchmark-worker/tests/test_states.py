from benchmark_worker.normalization.states import UFS, normalize_state


def test_todas_27_ufs_suportadas():
    assert len(UFS) == 27
    assert "SP" in UFS and "DF" in UFS


def test_aceita_minusculo_e_espacos():
    assert normalize_state(" sp ") == "SP"


def test_rejeita_nome_completo_do_estado():
    # So aceita a sigla -- nao tenta adivinhar a partir do nome da cidade/estado.
    assert normalize_state("Sao Paulo") is None


def test_rejeita_uf_inexistente():
    assert normalize_state("XX") is None


def test_none_e_vazio():
    assert normalize_state(None) is None
    assert normalize_state("") is None
