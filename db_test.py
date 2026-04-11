import asyncio
import asyncpg

# Вставьте вашу длинную ссылку из блокнота между кавычками
# Она должна начинаться на postgresql://
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"

async def test_db():
    print("⏳ Пытаемся подключиться к базе данных Supabase...")
    try:
        # Подключаемся к базе
        conn = await asyncpg.connect(DB_URL)
        print("✅ Ура! Успешное подключение к облачной базе!")

        # Создаем таблицу ресторанов
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS restaurants (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100),
                delivery_radius INT,
                is_active BOOLEAN DEFAULT TRUE
            )
        ''')
        print("✅ Таблица 'restaurants' успешно создана!")

        # Закрываем соединение
        await conn.close()
    except Exception as e:
        print(f"❌ Ошибка подключения: {e}")

if __name__ == "__main__":
    asyncio.run(test_db())