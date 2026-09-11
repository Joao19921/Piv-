from benchmark_worker.normalization.seniority import normalize_seniority


def test_reconhece_senior_em_ingles_e_portugues():
    assert normalize_seniority("Senior Business Intelligence Analyst") == ("senior", True)
    assert normalize_seniority("Analista Sênior") == ("senior", True)


def test_reconhece_pleno():
    assert normalize_seniority("Mid-level Engineer") == ("pleno", True)


def test_desconhecido_nao_e_inventado():
    assert normalize_seniority("Rockstar ninja developer") == ("unknown", False)


def test_vazio_e_desconhecido():
    assert normalize_seniority(None) == ("unknown", False)
    assert normalize_seniority("  ") == ("unknown", False)
