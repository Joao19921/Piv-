#!/usr/bin/env python3
import json, sys, re
from datetime import datetime

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

    def search(self, job_title, location="São Paulo", seniority=None, specialties=None):
        if not isinstance(job_title, str) or not job_title.strip():
            return {"status": "error", "error": "jobTitle é obrigatório e deve ser string"}
        level = self.infer_seniority(job_title, seniority or "")
        base = self.seniority_base.get(level, self.seniority_base["pleno"])
        multiplier = 1.0
        for pattern, value in self.tech_multipliers.items():
            if re.search(pattern, job_title.lower()):
                multiplier = max(multiplier, value)
        adjusted = base * multiplier
        p25, median, p75 = int(adjusted * .85), int(adjusted), int(adjusted * 1.25)
        return {
            "salario_clt_p25": p25,
            "salario_clt_mediana": median,
            "salario_clt_p75": p75,
            "salario_clt_media": int((p25 + median + p75) / 3),
            "pj_factor": self.pj_factor,
            "salario_pj_mensal": int(median * self.pj_factor),
            "salario_pj_hora": int(median * self.pj_factor / 160),
            "confidence": 0.65,
            "source": "generic_estimation_v2",
            "notes": "Estimativa genérica baseada em senioridade + complexidade tecnológica; não é dado real de mercado. Validar em Glassdoor, Salário.com.br, LinkedIn e Vagas.com.br.",
            "status": "success",
            "timestamp": datetime.now().isoformat(),
            "job_title": job_title,
            "location": location,
            "seniority": level,
        }

def main():
    try:
        data = json.loads(sys.stdin.read().strip())
        print(json.dumps(DynamicSalaryResearcher().search(
            data.get("jobTitle", "").strip(),
            data.get("location", "São Paulo").strip(),
            data.get("seniority", "").strip(),
            data.get("specialties", "").strip(),
        ), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
