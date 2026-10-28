FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY nutrivia nutrivia
COPY scripts scripts
COPY data/dishes.csv seed/dishes.csv
# БД и фото — на подключённом томе /data (DB_PATH, PHOTOS_DIR); база блюд — из образа
ENV DB_PATH=/data/nutrivia.db PHOTOS_DIR=/data/photos DISHES_CSV=/app/seed/dishes.csv
EXPOSE 8000
# API для приложения. Telegram-бот из того же образа: python -m nutrivia.bot
CMD ["python", "-m", "nutrivia.api"]
