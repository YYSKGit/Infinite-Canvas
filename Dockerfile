FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --create-home app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install --requirement requirements.txt

COPY --chown=app:app main.py VERSION ./
COPY --chown=app:app static ./static
COPY --chown=app:app workflows ./workflows

RUN mkdir -p API data assets && chown -R app:app API data assets

USER app

EXPOSE 3000

VOLUME ["/app/API", "/app/data", "/app/assets"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3000/', timeout=3)" || exit 1

CMD ["python", "main.py"]