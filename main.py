import asyncio
import asyncpg
import json
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# --- НАСТРОЙКИ ---
TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4"
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
MAIN_ADMIN_ID = 5340841151 

bot = Bot(token=TOKEN)
dp = Dispatcher()

# --- СОСТОЯНИЯ ---
class AdminStates(StatesGroup):
    waiting_for_price = State()
    waiting_for_card = State()
    waiting_for_radius = State()
    prod_id = State()

class CourierStates(StatesGroup):
    change_city = State()

async def get_db_conn():
    return await asyncpg.connect(DB_URL, statement_cache_size=0)

# --- ФУНКЦИИ УВЕДОМЛЕНИЙ ---

async def notify_restaurant(conn, order_id, status_msg):
    order = await conn.fetchrow("SELECT restaurant_name FROM orders WHERE id = $1", order_id)
    if order:
        admin = await conn.fetchrow("SELECT admin_tg_id FROM restaurants WHERE name = $1", order['restaurant_name'])
        target = admin['admin_tg_id'] if admin else MAIN_ADMIN_ID
        try:
            await bot.send_message(target, f"📦 <b>Заказ №{order_id}</b>\nСтатус: {status_msg}", parse_mode="HTML")
        except: pass

async def notify_client(conn, order_id, status_msg):
    order = await conn.fetchrow("SELECT user_data FROM orders WHERE id = $1", order_id)
    if order and order['user_data']:
        try:
            u = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
            if u.get('id'):
                await bot.send_message(u['id'], f"🛎 <b>Ваш заказ №{order_id}</b>\n{status_msg}", parse_mode="HTML")
        except: pass

# ==========================================
#           ОБЩИЕ КОМАНДЫ
# ==========================================
@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🍔 Открыть меню", web_app=WebAppInfo(url="https://leki-app.vercel.app/"))
    ]])
    await message.answer("Ассаламу алейкум! Добро пожаловать в LEKI.\n\n🛠 Админ: /admin\n🛵 Курьер: /courier", reply_markup=kb)

@dp.message(Command("my_id"))
async def cmd_my_id(message: types.Message):
    await message.answer(f"Ваш ID: <code>{message.from_user.id}</code>", parse_mode="HTML")

# ==========================================
#        УПРАВЛЕНИЕ КУРЬЕРАМИ (SUPER)
# ==========================================
@dp.message(Command("add_courier"))
async def admin_add_courier(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split(maxsplit=2)
    if len(args) < 3: return await message.answer("Формат: /add_courier [ID] [Имя]")
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO couriers (tg_id, name, city, is_active) VALUES ($1, $2, '-', false) ON CONFLICT (tg_id) DO UPDATE SET name = $2", int(args[1]), args[2])
        await message.answer(f"✅ Курьер {args[2]} добавлен!")
    finally: await conn.close()

@dp.message(Command("del_courier"))
async def admin_del_courier(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 2: return
    conn = await get_db_conn()
    try:
        await conn.execute("DELETE FROM couriers WHERE tg_id = $1", int(args[1]))
        await message.answer("🚫 Курьер удален.")
    finally: await conn.close()

# ==========================================
#           ПАНЕЛЬ КУРЬЕРА
# ==========================================
async def get_courier_panel_text(conn, tg_id):
    c = await conn.fetchrow("SELECT * FROM couriers WHERE tg_id = $1", tg_id)
    if not c: return None, None
    status_text = "🟢 НА ЛИНИИ" if c['is_active'] else "🔴 ПЕРЕРЫВ"
    text = f"🛵 <b>Кабинет курьера</b>\n\n👤 Имя: {c['name']}\n🏙 Город: {c['city']}\n\nСтатус: <b>{status_text}</b>"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🏙 Изменить город", callback_data="cour_change_city")],
        [InlineKeyboardButton(text="🔴 Уйти на перерыв" if c['is_active'] else "🟢 Выйти на линию", callback_data="cour_toggle")]
    ])
    return text, kb

@dp.message(Command("courier"))
async def cmd_courier(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        text, kb = await get_courier_panel_text(conn, message.from_user.id)
        if not text: return await message.answer("❌ Доступ запрещен.")
        c = await conn.fetchrow("SELECT city FROM couriers WHERE tg_id = $1", message.from_user.id)
        if c['city'] == '-':
            await message.answer("Напишите ваш город:")
            await state.set_state(CourierStates.change_city)
        else:
            await message.answer(text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close()

@dp.callback_query(F.data == "cour_toggle")
async def cour_toggle_status(callback: CallbackQuery):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE couriers SET is_active = NOT COALESCE(is_active, TRUE) WHERE tg_id = $1", callback.from_user.id)
        text, kb = await get_courier_panel_text(conn, callback.from_user.id)
        await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.message(CourierStates.change_city)
async def cour_save_city(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE couriers SET city = $1 WHERE tg_id = $2", message.text, message.from_user.id)
        await message.answer(f"✅ Город установлен: {message.text}")
        await state.clear()
        text, kb = await get_courier_panel_text(conn, message.from_user.id)
        await message.answer(text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close()

# --- ЦЕПОЧКА СТАТУСОВ КУРЬЕРА ---

@dp.callback_query(F.data.startswith("take_"))
async def take_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        order = await conn.fetchrow("SELECT courier_tg_id, address, restaurant_name FROM orders WHERE id = $1", order_id)
        if order['courier_tg_id']: return await callback.answer("Заказ уже занят!", show_alert=True)
        
        await conn.execute("UPDATE orders SET courier_tg_id = $1, status = 'taken' WHERE id = $2", callback.from_user.id, order_id)
        
        await notify_restaurant(conn, order_id, "Курьер принял заказ и едет в ресторан 🏃‍♂️")
        await notify_client(conn, order_id, "Мы нашли курьера! Он уже спешит в ресторан за вашим заказом. 🏃‍♂️")
        
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🏃‍♂️ Забрал заказ", callback_data=f"picked_{order_id}")]])
        await callback.message.edit_text(f"✅ <b>Заказ №{order_id} принят!</b>\n\nЗабрать в: {order['restaurant_name']}\nАдрес: {order['address']}", reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("picked_"))
async def picked_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'delivering' WHERE id = $1", order_id)
        await notify_restaurant(conn, order_id, "Курьер забрал еду и выехал к клиенту 🚴‍♂️")
        await notify_client(conn, order_id, "Курьер забрал ваш заказ и выехал к вам! Скоро будем. 🚴‍♂️💨")
        
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="📍 Я на адресе", callback_data=f"arrived_{order_id}")]])
        await callback.message.edit_text(f"🚴‍♂️ <b>Заказ №{order_id} в пути!</b>", reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("arrived_"))
async def arrived_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'arrived' WHERE id = $1", order_id)
        await notify_restaurant(conn, order_id, "Курьер прибыл к клиенту 📍")
        await notify_client(conn, order_id, "Курьер уже у ваших дверей! Приготовьтесь встречать. 📍")
        
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🏁 Доставлено", callback_data=f"done_{order_id}")]])
        await callback.message.edit_text(f"📍 <b>Заказ №{order_id}</b>\nВы на месте. Вручите заказ клиенту.", reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("done_"))
async def done_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'completed' WHERE id = $1", order_id)
        await notify_restaurant(conn, order_id, "Заказ успешно доставлен! ✅")
        await notify_client(conn, order_id, "Заказ доставлен! Приятного аппетита! 😊")
        await callback.message.edit_text(f"🏁 <b>Заказ №{order_id} завершен!</b>")
    finally: await conn.close(); await callback.answer()

# ==========================================
#           АДМИН РЕСТОРАНА
# ==========================================
@dp.message(Command("admin"))
async def cmd_admin(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT id, name, card_number, delivery_radius FROM restaurants WHERE admin_tg_id = $1", message.from_user.id)
        if not res and message.from_user.id == MAIN_ADMIN_ID:
            res = await conn.fetchrow("SELECT id, name, card_number, delivery_radius FROM restaurants LIMIT 1")
        if not res: return await message.answer("❌ Нет доступа.")

        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🗺 Меню", callback_data=f"adm_menu_{res['id']}")],
            [InlineKeyboardButton(text="💳 Реквизиты", callback_data=f"adm_card_{res['id']}")],
            [InlineKeyboardButton(text=f"📍 Радиус: {res['delivery_radius'] or 15} км", callback_data=f"adm_radius_{res['id']}")]
        ])
        await message.answer(f"🛠 <b>Управление: {res['name']}</b>", parse_mode="HTML", reply_markup=kb)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_card_"))
async def adm_change_card(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_card)
    await callback.message.answer("Введите новые реквизиты:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_card)
async def process_card(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET card_number = $1 WHERE admin_tg_id = $2", message.text, message.from_user.id)
        await message.answer("✅ Реквизиты обновлены!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_radius_"))
async def adm_change_radius(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_radius)
    await callback.message.answer("Введите радиус (число):")
    await callback.answer()

@dp.message(AdminStates.waiting_for_radius)
async def process_radius(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET delivery_radius = $1 WHERE admin_tg_id = $2", int(message.text), message.from_user.id)
        await message.answer("✅ Радиус обновлен!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_menu_"))
async def adm_show_menu(callback: CallbackQuery):
    res_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        products = await conn.fetch("SELECT id, name, is_active FROM products WHERE restaurant_id = $1 ORDER BY id", res_id)
        kb = [[InlineKeyboardButton(text=f"{'✅' if p['is_active'] else '🚫'} {p['name']}", callback_data=f"adm_p_{p['id']}")] for p in products]
        kb.append([InlineKeyboardButton(text="🔙 Назад", callback_data="adm_cancel")])
        await callback.message.edit_text("Меню:", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_p_"))
async def admin_product_menu(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        p = await conn.fetchrow("SELECT * FROM products WHERE id = $1", prod_id)
        is_active = p['is_active'] if p['is_active'] is not None else True
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💵 Изменить цену", callback_data=f"adm_price_{p['id']}")],
            [InlineKeyboardButton(text="🚫 В Стоп-лист" if is_active else "✅ В Меню", callback_data=f"adm_toggle_{p['id']}")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data=f"adm_menu_{p['restaurant_id']}")]
        ])
        await callback.message.edit_text(f"🍔 {p['name']}\nЦена: {p['price']} ₽", reply_markup=kb)
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_toggle_"))
async def admin_toggle(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET is_active = NOT COALESCE(is_active, TRUE) WHERE id = $1", prod_id)
        await admin_product_menu(callback)
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_price_"))
async def admin_price(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[2])
    await state.update_data(prod_id=prod_id)
    await state.set_state(AdminStates.waiting_for_price)
    await callback.message.answer("Введите цену:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_price)
async def process_price(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return
    data = await state.get_data()
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET price = $1 WHERE id = $2", int(message.text), data['prod_id'])
        await message.answer("✅ Цена обновлена!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data == "adm_cancel")
async def admin_cancel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.delete()
    await cmd_admin(callback.message, state)

# ==========================================
#           РАДАР ЗАКАЗОВ
# ==========================================
async def order_checker():
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new' AND is_notified = false LIMIT 5")
            for order in new_orders:
                res_info = await conn.fetchrow("SELECT city, admin_tg_id FROM restaurants WHERE name = $1", order['restaurant_name'])
                target = res_info['admin_tg_id'] if res_info else MAIN_ADMIN_ID
                user = json.loads(order['user_data'])
                items = json.loads(order['items'])
                items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])
                text = (f"🚨 <b>НОВЫЙ ОПЛАЧЕННЫЙ ЗАКАЗ №{order['id']}</b>\n\n🏙 Город: {res_info['city'] if res_info else '-'}\n👤 {user.get('first_name')}\n📍 {order['address']}\n\n{items_text}\n💰 <b>ИТОГО: {order['total_price']} ₽</b>")
                kb = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text="✅ Принять (Оплачено)", callback_data=f"ok_{order['id']}_{user.get('id')}"),
                    InlineKeyboardButton(text="❌ Отмена", callback_data=f"no_{order['id']}_{user.get('id')}")
                ]])
                try:
                    if order['receipt_url']: await bot.send_photo(target, order['receipt_url'], caption=text, reply_markup=kb, parse_mode="HTML")
                    else: await bot.send_message(target, text, reply_markup=kb, parse_mode="HTML")
                except: pass
                await conn.execute("UPDATE orders SET is_notified = true WHERE id = $1", order['id'])
        except: pass
        finally: 
            if conn: await conn.close()
        await asyncio.sleep(15)

@dp.callback_query(F.data.startswith(("ok_", "no_")))
async def handle_decision(callback: CallbackQuery):
    data = callback.data.split("_")
    action, order_id, client_id = data[0], int(data[1]), int(data[2])
    conn = await get_db_conn()
    try:
        if action == "ok":
            await conn.execute("UPDATE orders SET status = 'accepted' WHERE id = $1", order_id)
            if client_id: await bot.send_message(client_id, f"🎉 Заказ №{order_id} принят! Мы начали его готовить и скоро найдем курьера.")
            
            order_info = await conn.fetchrow("SELECT o.address, r.city, o.restaurant_name FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.id = $1", order_id)
            couriers = await conn.fetch("SELECT tg_id FROM couriers WHERE city = $1 AND is_active = true", order_info['city'])
            kb_c = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛵 Взять заказ", callback_data=f"take_{order_id}")]])
            for c in couriers:
                try: await bot.send_message(c['tg_id'], f"🚨 Новый заказ №{order_id}\nИз: {order_info['restaurant_name']}\nКуда: {order_info['address']}", reply_markup=kb_c)
                except: pass
            
            caption = (callback.message.caption or callback.message.text) + "\n\n🟢 ПРИНЯТ"
            if callback.message.photo: await callback.message.edit_caption(caption=caption)
            else: await callback.message.edit_text(text=caption)
        else:
            await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id)
            await callback.message.edit_text(text="🔴 ОТМЕНЕН")
    finally: await conn.close(); await callback.answer()

async def main():
    asyncio.create_task(order_checker())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())