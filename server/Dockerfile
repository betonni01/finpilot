FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -r -u 1001 finpilot && chown -R finpilot /app
USER finpilot
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn finpilot_server.wsgi:application --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-3} --timeout 60"]
