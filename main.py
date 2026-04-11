import asyncio
import asyncpg
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

# 1. Вставьте ваш Токен от BotFather
TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4"

# 2. Вставьте вашу длинную ссылку на базу данных (ту самую, чистую, с паролем)
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"

bot = Bot(token=TOKEN)
dp = Dispatcher()

# Функция, которая ходит в базу данных за ресторанами
async def get_restaurants():
    try:
        # Подключаемся к базе
        conn = await asyncpg.connect(DB_URL)
        # Запрашиваем активные рестораны
        rows = await conn.fetch("SELECT name, delivery_radius FROM restaurants WHERE is_active = TRUE")
        await conn.close()
        return rows
    except Exception as e:
        print(f"Ошибка базы данных: {e}")
        return []

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    # Запрашиваем список у базы данных
    restaurants = await get_restaurants()
    
    if not restaurants:
        text = "Ассаламу алейкум! К сожалению, сейчас мы обновляем список ресторанов. Попробуйте позже."
    else:
        text = "Ассаламу алейкум! Вот список доступных заведений на сегодня:\n\n"
        # Проходимся по списку и красиво оформляем текст
        for r in restaurants:
            text += f"🍽 **{r['name']}** (радиус доставки: {r['delivery_radius']} км)\n"
            
    text += "\nНажмите кнопку ниже, чтобы открыть полное меню:"

    # Наша кнопка для Mini App
    web_app_button = InlineKeyboardButton(
        text="🍔 Открыть меню",
        web_app=WebAppInfo(url="https://webappcontent.telegram.org/cafe")
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[web_app_button]])
    
    await message.answer(text, reply_markup=keyboard, parse_mode="Markdown")

async def main():
    print("Бот подключен к базе данных и готов к приему заказов!")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())