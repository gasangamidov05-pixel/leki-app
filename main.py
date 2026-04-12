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
MAIN_ADMIN_ID = 5340841151 # Твой основной ID

bot = Bot(token=TOKEN)
dp = Dispatcher()

async def get_db_conn():
    # statement_cache_size=0 исправляет ошибки подключения к Supabase
    return await asyncpg.connect(DB_URL, statement_cache_size=0)

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🍔 Открыть меню", web_app=WebAppInfo(url="https://leki-app.vercel.app/"))
    ]])
    await message.answer("Ассаламу алейкум! Добро пожаловать в сервис доставки LEKI.", reply_markup=kb)

async def order_checker():
    print("Радар запущен и проверяет заказы...")
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            # Берем новые заказы
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new' LIMIT 5")
            
            for order in new_orders:
                print(f"Обработка заказа №{order['id']}")
                
                # Данные пользователя и товары
                user = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
                user_tg_id = user.get('id', 0)
                items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
                items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])

                # УМНАЯ МАРШРУТИЗАЦИЯ
                # Ищем админа ресторана (без учета регистра букв)
                res_admin = await conn.fetchrow(
                    "SELECT admin_tg_id FROM restaurants WHERE name ILIKE $1", 
                    order['restaurant_name']
                )
                
                # Если админ найден в базе, используем его ID, иначе шлем главному
                if res_admin and res_admin['admin_tg_id']:
                    target_id = res_admin['admin_tg_id']
                else:
                    target_id = MAIN_ADMIN_ID

                text = (
                    f"🚨 <b>НОВЫЙ ЗАКАЗ №{order['id']}</b>\n"
                    f"🏠 Заведение: <b>{order['restaurant_name']}</b>\n"
                    f"🆔 ID админа: <code>{target_id}</code>\n\n" # Для твоей проверки
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

                try:
                    await bot.send_message(target_id, text, parse_mode="HTML", reply_markup=kb)
                    # Помечаем в базе, что уведомление отправлено
                    await conn.execute("UPDATE orders SET status = 'processing' WHERE id = $1", order['id'])
                except Exception as send_err:
                    print(f"Ошибка отправки админу {target_id}: {send_err}")

        except Exception as e:
            print(f"Ошибка в работе радара: {e}")
        finally:
            if conn: await conn.close()
        
        await asyncio.sleep(15)

@dp.callback_query(F.data.startswith(("ok_", "no_")))
async def handle_buttons(callback: CallbackQuery):
    data = callback.data.split("_")
    action, order_id, client_id = data[0], int(data[1]), int(data[2])
    
    conn = await get_db_conn()
    try:
        if action == "ok":
            await conn.execute("UPDATE orders SET status = 'accepted' WHERE id = $1", order_id)
            if client_id:
                # НОВОЕ СООБЩЕНИЕ ОБ УСПЕХЕ
                await bot.send_message(
                    client_id, 
                    f"🎉 <b>Отличные новости!</b>\nВаш заказ <b>№{order_id}</b> успешно принят заведением и уже начал готовиться. Приятного аппетита!", 
                    parse_mode="HTML"
                )
            await callback.message.edit_text(callback.message.text + "\n\n🟢 СТАТУС: ПРИНЯТ")
        else:
            await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id)
            if client_id:
                # НОВОЕ СООБЩЕНИЕ ОБ ОТМЕНЕ
                await bot.send_message(
                    client_id, 
                    f"😔 <b>К сожалению, отмена...</b>\nЗаведение не смогло принять ваш заказ <b>№{order_id}</b>. Пожалуйста, свяжитесь с поддержкой или попробуйте заказать в другом ресторане.", 
                    parse_mode="HTML"
                )
            await callback.message.edit_text(callback.message.text + "\n\n🔴 СТАТУС: ОТКЛОНЕН")
    except Exception as e:
        print(f"Ошибка при нажатии кнопки: {e}")
    finally:
        await conn.close()
        await callback.answer()

async def main():
    # Запускаем радар в фоновом режиме
    asyncio.create_task(order_checker())
    # Запускаем прием сообщений
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())