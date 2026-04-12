import asyncio
import asyncpg
import json
from datetime import timedelta
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# --- НАСТРОЙКИ ---
TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4"
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
MAIN_ADMIN_ID = 5340841151 # Твой основной ID

bot = Bot(token=TOKEN)
dp = Dispatcher()

class EditPrice(StatesGroup):
    waiting_for_price = State()
    prod_id = State()

async def get_db_conn():
    return await asyncpg.connect(DB_URL, statement_cache_size=0)

@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🍔 Открыть меню", web_app=WebAppInfo(url="https://leki-app.vercel.app/"))
    ]])
    await message.answer("Ассаламу алейкум! Добро пожаловать в сервис доставки LEKI.", reply_markup=kb)

# ==========================================
#           АДМИН ПАНЕЛЬ ЗАВЕДЕНИЯ
# ==========================================
@dp.message(Command("admin"))
async def cmd_admin(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT id, name FROM restaurants WHERE admin_tg_id = $1", message.from_user.id)
        if not res and message.from_user.id == MAIN_ADMIN_ID:
            res = await conn.fetchrow("SELECT id, name FROM restaurants LIMIT 1")
        if not res:
            await message.answer("❌ У вас нет прав администратора или привязанного заведения.")
            return

        res_id, res_name = res['id'], res['name']
        products = await conn.fetch("SELECT id, name, is_active FROM products WHERE restaurant_id = $1 ORDER BY id", res_id)
        
        kb = []
        for p in products:
            is_active = p['is_active'] if p['is_active'] is not None else True
            status = "✅" if is_active else "🚫"
            kb.append([InlineKeyboardButton(text=f"{status} {p['name']}", callback_data=f"adm_p_{p['id']}")])
            
        reply_markup = InlineKeyboardMarkup(inline_keyboard=kb)
        await message.answer(f"🛠 <b>Панель управления: {res_name}</b>\nВыберите блюдо для настройки:", parse_mode="HTML", reply_markup=reply_markup)
    finally:
        await conn.close()

@dp.callback_query(F.data.startswith("adm_p_"))
async def admin_product_menu(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        p = await conn.fetchrow("SELECT * FROM products WHERE id = $1", prod_id)
        if not p: return

        is_active = p['is_active'] if p['is_active'] is not None else True
        status_text = "🟢 В меню" if is_active else "🔴 В СТОП-ЛИСТЕ"
        text = f"🍔 <b>{p['name']}</b>\n💰 Цена: {p['price']} ₽\n📊 Статус: <b>{status_text}</b>"
        
        toggle_text = "🚫 Убрать в стоп-лист" if is_active else "✅ Вернуть в меню"
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💵 Изменить цену", callback_data=f"adm_price_{p['id']}")],
            [InlineKeyboardButton(text=toggle_text, callback_data=f"adm_toggle_{p['id']}")],
            [InlineKeyboardButton(text="🔙 Назад к списку", callback_data="adm_back")]
        ])
        await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    finally:
        await conn.close()
        await callback.answer()

@dp.callback_query(F.data == "adm_back")
async def admin_back(callback: CallbackQuery, state: FSMContext):
    await callback.message.delete()
    await cmd_admin(callback.message, state)

@dp.callback_query(F.data.startswith("adm_toggle_"))
async def admin_toggle(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET is_active = NOT COALESCE(is_active, TRUE) WHERE id = $1", prod_id)
        await admin_product_menu(callback) 
    finally:
        await conn.close()

@dp.callback_query(F.data.startswith("adm_price_"))
async def admin_price(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[2])
    await state.update_data(prod_id=prod_id)
    await state.set_state(EditPrice.waiting_for_price)
    
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="adm_cancel")]])
    await callback.message.edit_text("Отправьте новую цену цифрами (например: 350):", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data == "adm_cancel")
async def admin_cancel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.delete()
    await cmd_admin(callback.message, state)

@dp.message(EditPrice.waiting_for_price)
async def process_new_price(message: types.Message, state: FSMContext):
    if not message.text.isdigit():
        await message.answer("⚠️ Пожалуйста, отправьте только число (например: 350).")
        return
        
    new_price = int(message.text)
    data = await state.get_data()
    prod_id = data['prod_id']
    
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET price = $1 WHERE id = $2", new_price, prod_id)
        await message.answer(f"✅ Цена успешно обновлена на {new_price} ₽!")
        await state.clear()
        await cmd_admin(message, state)
    finally:
        await conn.close()

# ==========================================
#           РАДАР ЗАКАЗОВ (БЕЗ СПАМА)
# ==========================================
async def order_checker():
    print("Радар запущен и проверяет заказы...")
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            # Ищем новые заказы (status='new'), которые мы еще НЕ отправляли (is_notified=false)
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new' AND is_notified = false LIMIT 5")
            
            for order in new_orders:
                user = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
                user_tg_id = user.get('id', 0)
                items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
                items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])

                # Расчет суммы за еду
                food_total = sum(i['price'] * i['count'] for i in items)
                
                # Обработка адреса и выделение строки доставки
                raw_address = order.get('address', 'Не указан')
                if "\n🚚" in raw_address:
                    address_part, delivery_part = raw_address.split("\n🚚", 1)
                    delivery_str = f"🚚 {delivery_part.strip()}"
                else:
                    address_part = raw_address
                    delivery_str = ""

                res_admin = await conn.fetchrow("SELECT admin_tg_id FROM restaurants WHERE name ILIKE $1", order['restaurant_name'])
                target_id = res_admin['admin_tg_id'] if res_admin and res_admin['admin_tg_id'] else MAIN_ADMIN_ID

                text = (
                    f"🚨 <b>НОВЫЙ ЗАКАЗ №{order['id']}</b>\n"
                    f"🏠 Заведение: <b>{order['restaurant_name']}</b>\n\n" 
                    f"👤 Клиент: {user.get('first_name', 'Неизвестно')}\n"
                    f"📞 Телефон: {order.get('phone', 'Не указан')}\n"
                    f"📍 Адрес: {address_part}\n\n"
                    f"{items_text}\n"
                    f"{delivery_str}\n"
                    f"🍔 Заказ: {food_total} ₽\n"
                    f"💰 <b>ИТОГО: {order['total_price']} ₽</b>"
                )

                kb = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text="✅ Принять", callback_data=f"ok_{order['id']}_{user_tg_id}"),
                    InlineKeyboardButton(text="❌ Отмена", callback_data=f"no_{order['id']}_{user_tg_id}")
                ]])

                try:
                    await bot.send_message(target_id, text, parse_mode="HTML", reply_markup=kb)
                    # Помечаем, что уведомили, но статус оставляем 'new'
                    await conn.execute("UPDATE orders SET is_notified = true WHERE id = $1", order['id'])
                except Exception as send_err:
                    print(f"Ошибка отправки админу: {send_err}")

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
    try:
        if action == "ok":
            await conn.execute("UPDATE orders SET status = 'accepted' WHERE id = $1", order_id)
            if client_id:
                await bot.send_message(client_id, f"🎉 <b>Отличные новости!</b>\nВаш заказ <b>№{order_id}</b> успешно принят заведением и уже начал готовиться. Приятного аппетита!", parse_mode="HTML")
            await callback.message.edit_text(callback.message.text + "\n\n🟢 СТАТУС: ПРИНЯТ")
        else:
            await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id)
            if client_id:
                await bot.send_message(client_id, f"😔 <b>К сожалению, отмена...</b>\nЗаведение не смогло принять ваш заказ <b>№{order_id}</b>. Пожалуйста, свяжитесь с поддержкой или попробуйте заказать в другом ресторане.", parse_mode="HTML")
            await callback.message.edit_text(callback.message.text + "\n\n🔴 СТАТУС: ОТКЛОНЕН")
    except Exception as e:
        print(f"Ошибка кнопок: {e}")
    finally:
        await conn.close()
        await callback.answer()

async def main():
    asyncio.create_task(order_checker())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())