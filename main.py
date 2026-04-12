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
MAIN_ADMIN_ID = 5340841151 

bot = Bot(token=TOKEN)
dp = Dispatcher()

async def get_db_conn():
    # statement_cache_size=0 лечит ошибку, которую мы видели в логах Amvera
    return await asyncpg.connect(DB_URL, statement_cache_size=0)

async def get_restaurants():
    conn = await get_db_conn()
    rows = await conn.fetch("SELECT name FROM restaurants WHERE is_active = TRUE")
    await conn.close()
    return rows

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🍔 Открыть меню", web_app=WebAppInfo(url="https://leki-app.vercel.app/"))
    ]])
    await message.answer("Ассаламу алейкум! Добро пожаловать в сервис доставки LEKI.", reply_markup=kb)

async def order_checker():
    print("Радар запущен...")
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new' LIMIT 5")
            
            for order in new_orders:
                user = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
                user_tg_id = user.get('id', 0)
                
                items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
                items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])

                text = (
                    f"🚨 <b>НОВЫЙ ЗАКАЗ №{order['id']}</b>\n"
                    f"🏠 Заведение: <b>{order['restaurant_name']}</b>\n"
                    f"👤 Клиент: {user.get('first_name', 'Неизвестно')}\n"
                    f"📞 Телефон: {order.get('phone', 'Не указан')}\n"
                    f"📍 Адрес: {order.get('address', 'Не указан')}\n\n"
                    f"{items_text}\n"
                    f"💰 <b>ИТОГО: {order['total_price']} ₽</b>"
                )

                kb = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text="✅ Принять", callback_data=f"ok_{order['id']}_{user_tg_id}"),
                    InlineKeyboardButton(text="❌ Отмена", callback_data=f"no_{order['id']}_{user_tg_id}")
                ]])

                # Ищем админа конкретного ресторана
                res_admin = await conn.fetchrow("SELECT admin_tg_id FROM restaurants WHERE name = $1", order['restaurant_name'])
                target_id = res_admin['admin_tg_id'] if (res_admin and res_admin['admin_tg_id']) else MAIN_ADMIN_ID

                await bot.send_message(target_id, text, parse_mode="HTML", reply_markup=kb)
                await conn.execute("UPDATE orders SET status = 'processing' WHERE id = $1", order['id'])

        except Exception as e:
            print(f"Ошибка радара: {e}")
        finally:
            if conn: await conn.close()
        await asyncio.sleep(15)

@dp.callback_query(F.data.startswith(("ok_", "no_")))
async def handle_buttons(callback: CallbackQuery):
    data = callback.data.split("_")
    action, order_id, client_id = data[0], int(data[1]), int(data[2])
    conn = await get_db_conn()
    if action == "ok":
        await conn.execute("UPDATE orders SET status = 'accepted' WHERE id = $1", order_id)
        await bot.send_message(client_id, "✅ Ваш заказ принят!")
        await callback.message.edit_text(callback.message.text + "\n\n🟢 СТАТУС: ПРИНЯТ")
    else:
        await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id)
        await bot.send_message(client_id, "❌ Заказ отклонен.")
        await callback.message.edit_text(callback.message.text + "\n\n🔴 СТАТУС: ОТКЛОНЕН")
    await conn.close()
    await callback.answer()

async def main():
    asyncio.create_task(order_checker())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())