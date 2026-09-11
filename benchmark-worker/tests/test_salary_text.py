from benchmark_worker.normalization.salary_text import parse_salary_text


def test_faixa_mensal_em_reais():
    parsed = parse_salary_text("R$ 10.000 - R$ 15.000 por mes")
    assert parsed.salary_min == 10000.0
    assert parsed.salary_max == 15000.0
    assert parsed.currency == "brl"
    assert parsed.periodicity == "monthly"


def test_valor_unico_mensal():
    parsed = parse_salary_text("R$ 12.000 por mês")
    assert parsed.salary_min == parsed.salary_max == 12000.0
    assert parsed.periodicity == "monthly"


def test_nao_converte_anual_para_mensal():
    # Regra de ouro: nunca inferir divisao por 12 -- o periodo fica como veio da fonte.
    parsed = parse_salary_text("R$ 144.000 por ano")
    assert parsed.salary_min == parsed.salary_max == 144000.0
    assert parsed.periodicity == "annual"


def test_moeda_usd():
    parsed = parse_salary_text("US$ 5,000 per month")
    assert parsed.currency == "usd"
    assert parsed.salary_min == 5000.0
    assert parsed.periodicity == "monthly"


def test_decimal_formato_br():
    parsed = parse_salary_text("R$ 8.500,50 por mes")
    assert parsed.salary_min == 8500.5


def test_sem_numero_reconhecido():
    parsed = parse_salary_text("A combinar")
    assert parsed.salary_min is None
    assert parsed.salary_max is None
    assert parsed.currency == "unknown"
    assert parsed.periodicity == "unknown"


def test_texto_vazio():
    parsed = parse_salary_text("")
    assert parsed.salary_min is None
    assert parsed.currency == "unknown"
