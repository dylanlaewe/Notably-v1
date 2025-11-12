from dotenv import load_dotenv
load_dotenv()  # load variables from a local .env file if present
from fastapi import FastAPI
from fastapi import Depends
from .api.v1.uploads import router as uploads_router
from .api.v1.browse import router as browse_router
from .api.v1.export import router as export_router
from .api.v1.meetings import router as meetings_router
from .api.v1.tags import router as tags_router
from .api.v1.admin import router as admin_router
from .api.v1.health import router as health_router
from .api.v1.actions import router as actions_router
from .security import ApiKeyAuthMiddleware, RateLimitMiddleware
from .api.v1.search import router as search_router
from fastapi.middleware.cors import CORSMiddleware
from .auth import require_user
from backend.app.api.v1.teams import router as teams_router
from backend.app.api.v1.my import router as my_router
from .api.v1 import auth_routes


app = FastAPI(title="Notably API", version="0.0.3")


app.add_middleware(RateLimitMiddleware)
app.add_middleware(ApiKeyAuthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}

@app.get("/auth/ping")
def auth_ping():
    return {"ok": True}


app.include_router(uploads_router, prefix="/v1", tags=["uploads"])
app.include_router(browse_router)
app.include_router(export_router)
app.include_router(meetings_router)
app.include_router(tags_router)
app.include_router(admin_router)
app.include_router(health_router)
app.include_router(actions_router)
app.include_router(search_router)
app.include_router(uploads_router, dependencies=[Depends(require_user)])
app.include_router(search_router,  dependencies=[Depends(require_user)])
app.include_router(export_router,  dependencies=[Depends(require_user)])
app.include_router(actions_router, dependencies=[Depends(require_user)])
app.include_router(tags_router,    dependencies=[Depends(require_user)])
app.include_router(browse_router,  dependencies=[Depends(require_user)])
app.include_router(teams_router)
app.include_router(my_router)
app.include_router(auth_routes.router)