# Vercel Python 함수 진입점. 앱 코드는 backend/ 패키지에 둔다(ADR A9).
from backend.routes import app  # noqa: F401
