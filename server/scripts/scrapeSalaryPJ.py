#!/usr/bin/env python3
"""
Pesquisa salarial complementar.

O módulo combina:
1. pesquisa de páginas públicas indexadas na web; e
2. estimativa algorítmica local como fallback.

A pesquisa externa NÃO usa login, CAPTCHA ou tentativa de contornar bloqueios.
Se a web não responder ou não houver evidência salarial suficiente, o resultado
volta para a estimativa local e isso fica explícito no payload.
"""
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from html.parser import HTMLParser
from statistics import median


class SearchResultParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results = []
        self._current = None
        self._capture = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())
        if "result" in classes:
            self._current = {"title": "", "url": "", "snippet": ""}
        if self._current is not None:
            if tag == "a" and "result__a" in classes:
                self._capture = "title"
                self._current["url"] = attrs.get("href", "")
            elif tag in ("a", "div", "span") and "result__snippet" in classes:
                self._capture = "snippet"

    def handle_endtag(self, tag):
        if self._capture in ("title", "snippet") and tag in ("a", "div", "span"):
            self._capture = None
        if tag == "div" and self._current is not None and self._current.get("url"):
            self.results.append(self._current)
            self._current = None
            self._capture = None

    def handle_data(self, data):
        if self._current is not None and self._capture:
            self._current[self._capture] += data


class DynamicSalaryResearcher:
    def __init__(self):
        self.seniority_base = {
            "junior": 4500, "júnior": 4500, "mid": 6000, "pleno": 6000,
            "mid-level": 6000, "senior": 8500, "sênior": 8500, "lead": 9500,
            "principal": 11000, "expert": 10000, "especialista": 10000, "trainee": 3500,
        }
        self.tech_multipliers = {
            r"(ia|inteligencia.artificial|machine.learning|ml|nlp|deep|neural|gpt|llm|generative)": 1.35,
            r"(cloud|aws|azure|gcp|kubernetes|k8s|infra)": 1.25,
            r"(devops|sre|decom|site.reliability)": 1.30,
            r"(security|segurança)": 1.28,
            r"(dba|database|postgres|postgresql|mysql|mongodb|elasticsearch|bigdata|data.warehouse)": 1.20,
            r"(backend|api|rest|graphql|node|python|java|golang|rust|scala)": 1.10,
            r"(frontend|react|angular|vue|web|typescript|javascript)": 1.00,
            r"(fullstack|full.stack)": 1.15,
            r"(analytics|bi|business.intelligence|dashboard)": 1.15,
            r"(mobile|ios|android|react.native|flutter)": 1.10,
            r"(qualidade|qa|test|tester)": 0.95,
            r"(suporte|support|helpdesk)": 0.85,
        }
        self.pj_factor = 1.6

    def infer_seniority(self, title, seniority):
        if seniority and seniority.lower().strip() in self.seniority_base:
            return seniority.lower().strip()
        for level, pattern in [
            ("trainee", r"trainee|estagi"), ("junior", r"j[uú]nior|jr\.?"),
            ("pleno", r"pleno|mid[- ]?level|mid"), ("senior", r"s[eê]nior|sr\.?"),
            ("lead", r"lead|tech lead"), ("principal", r"principal"),
            ("expert", r"expert"), ("especialista", r"especialista"),
        ]:
            if re.search(pattern, title.lower()):
                return level
        return "pleno"

    def local_estimate(self, job_title, level):
        base = self.seniority_base.get(level, self.seniority_base["pleno"])
        multiplier = 1.0
        for pattern, value in self.tech_multipliers.items():
            if re.search(pattern, job_title.lower()):
                multiplier = max(multiplier, value)
        adjusted = base * multiplier
        p25, median_value, p75 = int(adjusted * .85), int(adjusted), int(adjusted * 1.25)
        return {
            "salario_clt_p25": p25,
            "salario_clt_mediana": median_value,
            "salario_clt_p75": p75,
            "salario_clt_media": int((p25 + median_value + p75) / 3),
            "pj_factor": self.pj_factor,
            "salario_pj_mensal": int(median_value * self.pj_factor),
            "salario_pj_hora": int(median_value * self.pj_factor / 160),
        }

    @staticmethod
    def _salary_values(text):
        values = []
        # Aceita R$ 12.345,67 e R$ 12.345.
        for match in re.finditer(r"R\\$\\s*([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]{3,6}(?:,[0-9]{2})?)", text, re.I):
            raw = match.group(1).replace(".", "").replace(",", ".")
            try:
                value = float(raw)
                if 1000 <= value <= 100000:
                    values.append(value)
            except ValueError:
                pass
        return values

    @staticmethod
    def _source_name(url):
        host = urllib.parse.urlparse(url).netloc.lower()
        if "salario.com.br" in host:
            return "Portal Salário / CAGED"
        if "glassdoor" in host:
            return "Glassdoor"
        if "vagas.com.br" in host:
            return "Vagas.com.br"
        if "linkedin.com" in host:
            return "LinkedIn"
        return host or "Pesquisa web"

    def _web_search(self, query):
        url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "PivoSalaryResearch/1.0 (+salary research)",
                "Accept-Language": "pt-BR,pt;q=0.9",
            },
        )
        with urllib.request.urlopen(request, timeout=7) as response:
            body = response.read().decode("utf-8", "ignore")
        parser = SearchResultParser()
        parser.feed(body)
        return parser.results[:8]

    def research_web(self, job_title, location):
        queries = [
            f'site:salario.com.br/profissao "{job_title}" salário',
            f'site:vagas.com.br "{job_title}" salário mediano',
            f'site:glassdoor.com.br/Salarios "{job_title}" salário',
        ]
        sources = []
        seen = set()
        for query in queries:
            try:
                results = self._web_search(query)
            except Exception:
                continue
            for result in results:
                source_url = html.unescape(result.get("url", "")).strip()
                if not source_url or source_url in seen:
                    continue
                if not any(domain in source_url.lower() for domain in ("salario.com.br", "vagas.com.br", "glassdoor.com.br", "linkedin.com")):
                    continue
                seen.add(source_url)
                snippet = " ".join(result.get("snippet", "").split())
                title = " ".join(result.get("title", "").split())
                values = self._salary_values(f"{title} {snippet}")
                # Só consideramos valor encontrado se o próprio resultado textual
                # contiver contexto salarial.
                salary_context = re.search(r"(sal[aá]rio|mediana|m[eé]dia salarial|faixa salarial|remunera[cç][aã]o)", f"{title} {snippet}", re.I)
                sources.append({
                    "name": self._source_name(source_url),
                    "url": source_url,
                    "title": title[:180],
                    "snippet": snippet[:500],
                    "matchedSalary": round(median(values), 2) if values and salary_context else None,
                })
                if len(sources) >= 6:
                    return sources
        return sources

    def search(self, job_title, location="Brasil", seniority=None, specialties=None):
        if not isinstance(job_title, str) or not job_title.strip():
            return {"status": "error", "error": "jobTitle é obrigatório e deve ser string"}

        level = self.infer_seniority(job_title, seniority or "")
        local = self.local_estimate(job_title, level)

        sources = self.research_web(job_title, location)
        observed_values = [
            source["matchedSalary"]
            for source in sources
            if isinstance(source.get("matchedSalary"), (int, float))
        ]

        if observed_values:
            market_median = int(round(median(observed_values)))
            p25 = int(round(market_median * 0.85))
            p75 = int(round(market_median * 1.20))
            confidence = min(0.90, 0.55 + (0.10 * min(len(observed_values), 3)))
            source_mode = "WEB_RESEARCH"
            source_label = "Pesquisa web · fontes públicas indexadas"
            notes = (
                f"Referência calculada a partir de {len(observed_values)} resultado(s) salarial(is) "
                f"encontrado(s) em fontes públicas. Os valores e URLs das fontes estão disponíveis "
                f"no campo research.sources."
            )
        else:
            market_median = local["salario_clt_mediana"]
            p25 = local["salario_clt_p25"]
            p75 = local["salario_clt_p75"]
            confidence = 0.65
            source_mode = "LOCAL_ESTIMATE"
            source_label = "Estimativa algorítmica local"
            notes = (
                "Nenhuma referência salarial externa suficiente foi encontrada nesta consulta. "
                "Foi aplicado o estimador local por senioridade e complexidade."
            )

        pj_monthly = int(round(market_median * self.pj_factor))
        return {
            "salario_clt_p25": p25,
            "salario_clt_mediana": market_median,
            "salario_clt_p75": p75,
            "salario_clt_media": int(round((p25 + market_median + p75) / 3)),
            "pj_factor": self.pj_factor,
            "salario_pj_mensal": pj_monthly,
            "salario_pj_hora": int(round(pj_monthly / 160)),
            "confidence": confidence,
            "source": source_mode,
            "notes": notes,
            "status": "success",
            "timestamp": datetime.now().isoformat(),
            "job_title": job_title,
            "location": location,
            "seniority": level,
            "research": {
                "mode": source_mode,
                "sourceCount": len(sources),
                "sources": sources,
                "sourceLabel": source_label,
            },
        }


def main():
    try:
        data = json.loads(sys.stdin.read().strip())
        print(json.dumps(DynamicSalaryResearcher().search(
            data.get("jobTitle", "").strip(),
            data.get("location", "Brasil").strip(),
            data.get("seniority", "").strip(),
            data.get("specialties", "").strip(),
        ), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
