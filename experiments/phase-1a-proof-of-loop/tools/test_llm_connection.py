"""
Phase 1A.2-C — Minimum LLM Connection Test
==========================================
Objetivo: Verificar que Python puede comunicarse con el LLM Runtime
y recibir una decisión estructurada validable con Pydantic.

RESTRICCIONES DE SEGURIDAD:
- La API key NUNCA se imprime, registra ni expone.
- Solo se verifica su PRESENCIA (true/false).
"""
import os
import sys
from abc import ABC, abstractmethod

from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

# ─── 1. Cargar .env (sin exponer la clave) ────────────────────────────────────
load_dotenv()

api_key = os.environ.get("GEMINI_API_KEY", "")
GEMINI_API_KEY_PRESENT = bool(api_key and len(api_key) > 0)
print(f"GEMINI_API_KEY_PRESENT={str(GEMINI_API_KEY_PRESENT).lower()}")

if not GEMINI_API_KEY_PRESENT:
    print("STATUS=BLOCKED")
    print("REASON=GEMINI_API_KEY no encontrada en .env")
    sys.exit(1)

# ─── 2. Importar SDK ──────────────────────────────────────────────────────────
try:
    from google import genai
    import google.genai as genai_module
    genai_version = genai_module.__version__
    print(f"SDK_VERSION=google-genai=={genai_version}")
except ImportError as exc:
    print(f"STATUS=BLOCKED")
    print(f"REASON=google-genai no instalado: {exc}")
    sys.exit(1)

# ─── 3. Esquema Pydantic estructurado ─────────────────────────────────────────
class Decision(BaseModel):
    status: str
    agent_name: str
    observation: str

# ─── 4. Abstracción AgentRuntime ──────────────────────────────────────────────
class AgentRuntime(ABC):
    @abstractmethod
    def decide(self, context: dict) -> Decision:
        pass

# ─── 5. Implementación GeminiRuntime ─────────────────────────────────────────
MODEL_NAME = "gemini-3.8-flash"

class GeminiRuntime(AgentRuntime):
    def __init__(self) -> None:
        # El cliente usa GEMINI_API_KEY del entorno automáticamente
        self.client = genai.Client()
        self.model_name = MODEL_NAME

    def decide(self, context: dict) -> Decision:
        import time
        prompt = (
            "Eres un agente de prueba. Procesa este contexto y devuelve "
            "una decisión estructurada en JSON con los campos: "
            "status (string), agent_name (string), observation (string).\n"
            f"Contexto: {context}"
        )
        last_exc: Exception | None = None
        for attempt in range(1, 4):  # 3 intentos
            try:
                response = self.client.models.generate_content(
                    model=self.model_name,
                    contents=prompt,
                    config=genai.types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=Decision,
                    ),
                )
                return Decision.model_validate_json(response.text)
            except Exception as exc:
                last_exc = exc
                if "503" in str(exc) or "UNAVAILABLE" in str(exc):
                    wait = 2 ** attempt  # 2s, 4s, 8s
                    print(f"  [retry {attempt}/3] 503 transitorio, esperando {wait}s...")
                    time.sleep(wait)
                else:
                    raise  # error no transitorio → falla inmediata
        raise last_exc  # agotados los reintentos

# ─── 6. Main ──────────────────────────────────────────────────────────────────
def main() -> dict:
    results: dict = {
        "python_version": sys.version.split()[0],
        "sdk_version": genai_version,
        "api_key_present": GEMINI_API_KEY_PRESENT,
        "model": MODEL_NAME,
        "positive_test": "PENDING",
        "negative_test": "PENDING",
        "status": "PENDING",
        "errors": [],
    }

    print("\n=== FASE 1A.2-C: LLM CONNECTION TEST ===")
    print(f"Python: {results['python_version']}")
    print(f"SDK: {results['sdk_version']}")
    print(f"Model: {results['model']}")

    # ── Test positivo ─────────────────────────────────────────────────────────
    print("\n[1/2] TEST POSITIVO: llamada real al LLM con esquema Pydantic")
    context_dummy = {
        "test_id": "cartoon_factory_phase_1a_2c",
        "instruction": (
            "Devuelve status='connected', "
            "agent_name='CartoonFactory_Runtime', "
            "y una observation describiendo que esta es una prueba de conexión."
        ),
    }

    try:
        runtime = GeminiRuntime()
        decision = runtime.decide(context_dummy)
        # Validar que los campos requeridos están presentes y con tipos correctos
        assert isinstance(decision.status, str) and len(decision.status) > 0
        assert isinstance(decision.agent_name, str) and len(decision.agent_name) > 0
        assert isinstance(decision.observation, str) and len(decision.observation) > 0

        results["positive_test"] = "PASS"
        print(f"  status       : {decision.status}")
        print(f"  agent_name   : {decision.agent_name}")
        print(f"  observation  : {decision.observation}")
        print("  POSITIVE_TEST=PASS")
    except Exception as exc:
        results["positive_test"] = "FAIL"
        results["errors"].append(f"positive_test: {type(exc).__name__}: {exc}")
        print(f"  POSITIVE_TEST=FAIL — {type(exc).__name__}: {exc}")

    # ── Test negativo ─────────────────────────────────────────────────────────
    print("\n[2/2] TEST NEGATIVO: JSON incompleto debe ser rechazado por Pydantic")
    incomplete_json = '{"status": "connected", "agent_name": "CartoonFactory_Runtime"}'
    # Falta el campo obligatorio 'observation'
    try:
        Decision.model_validate_json(incomplete_json)
        results["negative_test"] = "FAIL"
        results["errors"].append("negative_test: Pydantic aceptó un esquema inválido")
        print("  NEGATIVE_TEST=FAIL (Pydantic debería haber rechazado esto)")
    except ValidationError:
        results["negative_test"] = "PASS"
        print("  NEGATIVE_TEST=PASS (Pydantic rechazó correctamente el esquema incompleto)")

    # ── Resultado global ──────────────────────────────────────────────────────
    if results["positive_test"] == "PASS" and results["negative_test"] == "PASS":
        results["status"] = "PASS"
    elif results["positive_test"] == "FAIL":
        results["status"] = "FAIL"
    else:
        results["status"] = "FAIL"

    print(f"\nSTATUS={results['status']}")
    return results


if __name__ == "__main__":
    final = main()
    sys.exit(0 if final["status"] == "PASS" else 1)
