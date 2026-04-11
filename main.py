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
ADMIN_ID = 5340841151 # ПРОВЕРЬ ЭТОТ ID!

bot = Bot(token=TOKEN)
dp = Dispatcher()

async def get_db_conn():
    return await asyncpg.connect(DB_URL)

# --- РАДАР ЗАКАЗОВ ---
async def order_checker():
    print("Радар запущен и ищет новые заказы...")
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new' LIMIT 5")
            
            for order in new_orders:
                print(f"Обнаружен заказ №{order['id']}")
                local_time = order['created_at'] + timedelta(hours=4)
                time_str = local_time.strftime("%H:%M")

                user = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
                user_tg_id = user.get('id', 0)
                
                items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
                items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])

                text = (
                    f"🚨 <b>ЗАКАЗ №{order['id']}</b>\n"
                    f"👤 Клиент: {user.get('first_name', 'Неизвестно')}\n"
                    f"🏠 {order['restaurant_name']}\n\n"
                    f"{items_text}\n"
                    f"💰 <b>{order['total_price']} ₽</b>"
                )

                # Сокращаем callback_data (лимит 64 символа!)
                kb = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text="✅ Принять", callback_data=f"ok_{order['id']}_{user_tg_id}"),
                    InlineKeyboardButton(text="❌ Отмена", callback_data=f"no_{order['id']}_{user_tg_id}")
                ]])

                await bot.send_message(ADMIN_ID, text, parse_mode="HTML", reply_markup=kb)
                await conn.execute("UPDATE orders SET status = 'processing' WHERE id = $1", order['id'])
                print(f"Заказ №{order['id']} отправлен админу.")

        except Exception as e:
            print(f"ОШИБКА РАДАРА: {e}")
        finally:
            if conn: await conn.close()
        await asyncio.sleep(15)

# --- ОБРАБОТКА КНОПОК ---
@dp.callback_query(F.data.startswith(("ok_", "no_")))
async def handle_buttons(callback: CallbackQuery):
    print(f"Нажата кнопка: {callback.data}")
    data = callback.data.split("_")
    action = data[0]
    order_id = int(data[1])
    client_id = int(data[2])

    conn = await get_db_conn()
    try:
        if action == "ok":
            await conn.execute("UPDATE orders SET status = 'accepted' WHERE id = $1", order_id)
            if client_id:
                await bot.send_message(client_id, "✅ Ваш заказ принят!")
            await callback.message.edit_text(callback.message.text + "\n\n🟢 СТАТУС: ПРИНЯТ")
        else:
            await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id)
            if client_id:
                await bot.send_message(client_id, "❌ Заказ отклонен.")
            await callback.message.edit_text(callback.message.text + "\n\n🔴 СТАТУС: ОТКЛОНЕН")
    except Exception as e:
        print(f"Ошибка кнопки: {e}")
    finally:
        await conn.close()
        await callback.answer()

async def main():
    asyncio.create_task(order_checker())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())