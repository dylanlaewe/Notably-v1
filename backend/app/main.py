from fastapi import FastAPI
from .api.v1.uploads import router as uploads_router
from dotenv import load_dotenv
load_dotenv()  # load variables from a local .env file if present

app = FastAPI(title="Notably API", version="0.0.3")

@app.get("/health")
def health():
    return {"ok": True}

app.include_router(uploads_router, prefix="/v1", tags=["uploads"])

