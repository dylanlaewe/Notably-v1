from dotenv import load_dotenv
load_dotenv()  # load variables from a local .env file if present
from fastapi import FastAPI
from .api.v1.uploads import router as uploads_router
from .api.v1.browse import router as browse_router
from .api.v1.export import router as export_router




app = FastAPI(title="Notably API", version="0.0.3")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/auth/ping")
def auth_ping():
    return {"ok": True}

app.include_router(uploads_router, prefix="/v1", tags=["uploads"])
app.include_router(browse_router)
app.include_router(export_router)
