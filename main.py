import asyncio
import asyncpg
import json
from datetime import timedelta
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

# 1. Твои ключи
TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4"
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"

# 2. ВСТАВЬ СЮДА СВОЙ ID ВМЕСТО ЦИФР НИЖЕ !!!
ADMIN_ID = 5340841151 

bot = Bot(token=TOKEN)
dp = Dispatcher()

# Функция для ресторанов
async def get_restaurants():
    try:
        conn = await asyncpg.connect(DB_URL)
        rows = await conn.fetch("SELECT name, delivery_radius FROM restaurants WHERE is_active = TRUE")
        await conn.close()
        return rows
    except Exception as e:
        print(f"Ошибка БД: {e}")
        return []

# --- НОВАЯ СИСТЕМА: РАДАР ДЛЯ ЗАКАЗОВ ---
async def order_checker():
    while True:
        try:
            conn = await asyncpg.connect(DB_URL)
            # Ищем заказы со статусом 'new'
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new'")
            
            for order in new_orders:
                # 1. ПРИБАВЛЯЕМ 4 ЧАСА К ВРЕМЕНИ UTC
                local_time = order['created_at'] + timedelta(hours=4)
                time_str = local_time.strftime("%d.%m.%Y в %H:%M")

                # 2. Распаковываем данные клиента из JSON
                user = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
                client_name = user.get('first_name', 'Неизвестно')
                username = f" (@{user.get('username')})" if user.get('username') else ""

                # 3. Распаковываем корзину и красиво оформляем
                items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
                items_text = ""
                for item in items:
                    items_text += f"▫️ {item['name']} — {item['count']} шт.\n"

                # 4. Собираем текст сообщения для тебя
                text = (
                    f"🚨 <b>НОВЫЙ ЗАКАЗ!</b>\n\n"
                    f"📍 <b>Заведение:</b> {order['restaurant_name']}\n"
                    f"⏰ <b>Время:</b> {time_str}\n"
                    f"👤 <b>Клиент:</b> {client_name}{username}\n\n"
                    f"🍔 <b>Заказ:</b>\n{items_text}\n"
                    f"💰 <b>ИТОГО: {order['total_price']} ₽</b>"
                )

                # 5. Отправляем сообщение тебе в личку
                await bot.send_message(ADMIN_ID, text, parse_mode="HTML")

                # 6. Меняем статус в базе на 'processing' (в обработке), чтобы не отправить этот же заказ второй раз
                await conn.execute("UPDATE orders SET status = 'processing' WHERE id = $1", order['id'])

            await conn.close()
        except Exception as e:
            print(f"Ошибка радара заказов: {e}")
        
        # Бот "спит" 15 секунд, затем снова проверяет базу
        await asyncio.sleep(15)


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    restaurants = await get_restaurants()
    
    if not restaurants:
        text = "Ассаламу алейкум! К сожалению, сейчас мы обновляем список ресторанов. Попробуйте позже."
    else:
        text = "Ассаламу алейкум! Вот список доступных заведений на сегодня:\n\n"
        for r in restaurants:
            text += f"🍽 **{r['name']}** (радиус доставки: {r['delivery_radius']} км)\n"
            
    text += "\nНажмите кнопку ниже, чтобы открыть полное меню:"

    # Я сразу заменил тестовую ссылку на твой живой сайт!
    web_app_button = InlineKeyboardButton(
        text="🍔 Открыть меню",
        web_app=WebAppInfo(url="https://leki-app.vercel.app/")
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[web_app_button]])
    
    await message.answer(text, reply_markup=keyboard, parse_mode="Markdown")

async def main():
    print("Бот запущен. Начинаю следить за новыми заказами...")
    # Запускаем наш "радар" параллельно с основной работой бота
    asyncio.create_task(order_checker())
    
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())