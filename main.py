import asyncio
import asyncpg
import json
from datetime import timedelta
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, CallbackQuery

# --- НАСТРОЙКИ ---
TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4"
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
ADMIN_ID = 5340841151  # Твой ID (убедись, что он правильный!)

bot = Bot(token=TOKEN)
dp = Dispatcher()

# --- ФУНКЦИИ БАЗЫ ДАННЫХ ---
async def get_db_conn():
    return await asyncpg.connect(DB_URL)

async def get_restaurants():
    conn = await get_db_conn()
    rows = await conn.fetch("SELECT name, delivery_radius FROM restaurants WHERE is_active = TRUE")
    await conn.close()
    return rows

# --- РАДАР ЗАКАЗОВ ---
async def order_checker():
    while True:
        try:
            conn = await get_db_conn()
            # Берем только новые заказы
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new'")
            
            for order in new_orders:
                local_time = order['created_at'] + timedelta(hours=4)
                time_str = local_time.strftime("%H:%M")

                user = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
                # Сохраняем ID пользователя Телеграм, чтобы потом ему ответить
                user_tg_id = user.get('id') 
                client_name = user.get('first_name', 'Клиент')

                items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
                items_text = "".join([f"▫️ {i['name']} — {i['count']} шт.\n" for i in items])

                text = (
                    f"🚨 <b>НОВЫЙ ЗАКАЗ №{order['id']}</b>\n\n"
                    f"⏰ Время: {time_str}\n"
                    f"👤 Клиент: {client_name}\n"
                    f"🏠 Ресторан: {order['restaurant_name']}\n\n"
                    f"📋 Состав:\n{items_text}\n"
                    f"💰 <b>ИТОГО: {order['total_price']} ₽</b>"
                )

                # КНОПКИ УПРАВЛЕНИЯ
                keyboard = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text="✅ Принять", callback_data=f"ord_accept_{order['id']}_{user_tg_id}"),
                    InlineKeyboardButton(text="❌ Отклонить", callback_data=f"ord_cancel_{order['id']}_{user_tg_id}")
                ]])

                await bot.send_message(ADMIN_ID, text, parse_mode="HTML", reply_markup=keyboard)
                # Помечаем как "в обработке", чтобы кнопки не дублировались
                await conn.execute("UPDATE orders SET status = 'processing' WHERE id = $1", order['id'])

            await conn.close()
        except Exception as e:
            print(f"Ошибка радара: {e}")
        await asyncio.sleep(15)

# --- ОБРАБОТКА НАЖАТИЙ НА КНОПКИ ---
@dp.callback_query(F.data.startswith("ord_"))
async def handle_order_buttons(callback: CallbackQuery):
    _, action, order_id, client_tg_id = callback.data.split("_")
    conn = await get_db_conn()

    if action == "accept":
        # 1. Обновляем базу
        await conn.execute("UPDATE orders SET status = 'accepted' WHERE id = $1", int(order_id))
        # 2. Пишем клиенту (если у нас есть его ID)
        try:
            await bot.send_message(client_tg_id, "✅ <b>Ваш заказ принят!</b>\nРесторан уже начал его готовить. Ожидайте доставку.", parse_mode="HTML")
        except: pass
        # 3. Обновляем сообщение у админа
        await callback.message.edit_text(callback.message.text + "\n\n🟢 <b>СТАТУС: ПРИНЯТ</b>", parse_mode="HTML")

    elif action == "cancel":
        await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", int(order_id))
        try:
            await bot.send_message(client_tg_id, "❌ <b>Заказ отклонен.</b>\nК сожалению, ресторан не может выполнить заказ прямо сейчас.", parse_mode="HTML")
        except: pass
        await callback.message.edit_text(callback.message.text + "\n\n🔴 <b>СТАТУС: ОТКЛОНЕН</b>", parse_mode="HTML")

    await conn.close()
    await callback.answer()

# --- СТАНДАРТНЫЕ КОМАНДЫ ---
@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    restaurants = await get_restaurants()
    text = "Ассаламу алейкум! Доступные заведения:\n\n" + "\n".join([f"🍽 {r['name']}" for r in restaurants])
    
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🍔 Открыть меню", web_app=WebAppInfo(url="https://leki-app.vercel.app/"))
    ]])
    await message.answer(text, reply_markup=kb)

async def main():
    asyncio.create_task(order_checker())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())