# SmartSchool AI service (FastAPI). Build: docker compose build ai
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 AI_DATA_DIR=/data
WORKDIR /srv
COPY pyproject.toml README.md ./
COPY app app
COPY prompts prompts
RUN pip install --no-cache-dir . && mkdir -p /data && useradd -r -u 10001 ai && chown -R ai /data
USER ai
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
