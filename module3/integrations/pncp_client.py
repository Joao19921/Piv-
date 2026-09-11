"""Cliente mínimo, sem autenticação, para a API pública do PNCP."""

from __future__ import annotations

from datetime import date, timedelta
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json


def search(term: str) -> list[dict]:
    end = date.today()
    query = urlencode({
        "dataInicial": (end - timedelta(days=30)).strftime("%Y%m%d"),
        "dataFinal": end.strftime("%Y%m%d"),
        "pagina": 1,
        "tamanhoPagina": 100,
        "criterioBusca": term,
    })
    request = Request(f"https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?{query}", headers={"Accept": "application/json"})
    with urlopen(request, timeout=float(os.getenv("MOD3_REQUEST_TIMEOUT_SECONDS", "10"))) as response:
        return json.load(response).get("data", [])


if __name__ == "__main__":
    import sys
    print(json.dumps(search(" ".join(sys.argv[1:]) or "Desenvolvedor React"), ensure_ascii=False))