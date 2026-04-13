import asyncio
import asyncpg
import json
from datetime import datetime, timedelta, timezone
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# --- НАСТРОЙКИ ---
TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4"
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
MAIN_ADMIN_ID = 5340841151 

# --- ЧАСОВОЙ ПОЯС (Дербент/Москва UTC+3) ---
MSK = timezone(timedelta(hours=3))

bot = Bot(token=TOKEN)
dp = Dispatcher()

class AdminStates(StatesGroup):
    waiting_for_price = State()
    waiting_for_card = State()
    waiting_for_radius = State()
    prod_id = State()
    waiting_for_new_name = State()
    waiting_for_new_price = State()
    waiting_for_new_desc = State()

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
        try: await bot.send_message(target, f"📦 <b>Заказ №{order_id}</b>\nСтатус: {status_msg}", parse_mode="HTML")
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
#           ПАНЕЛЬ СУПЕР-АДМИНА
# ==========================================
@dp.message(Command("superadmin"))
async def cmd_superadmin(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    text = (
        "👑 <b>ПАНЕЛЬ СУПЕР-АДМИНА LEKI</b>\n\n"
        "<b>📦 Управление курьерами:</b>\n"
        "• <code>/add_courier ID Имя</code> — Нанять\n"
        "• <code>/del_courier ID</code> — Уволить\n"
        "• <code>/courier_stats</code> — Рейтинг и заказы\n\n"
        "<b>💳 Биллинг (Подписки):</b>\n"
        "• <code>/set_paid res ID Дни</code> — Продлить ресторан\n"
        "• <code>/set_paid cour ID Дни</code> — Продлить курьера\n\n"
        "<b>🌍 Логистика и Цены:</b>\n"
        "• <code>/set_city_price Город База Км</code>\n"
        "<i>Пример: /set_city_price Белиджи 100 20</i>"
    )
    await message.answer(text, parse_mode="HTML")

@dp.message(Command("set_paid"))
async def admin_set_paid(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 4: return await message.answer("Формат: /set_paid [res/cour] [ID] [Дни]")
    
    target_type, target_id, days = args[1], int(args[2]), int(args[3])
    table = "restaurants" if target_type == "res" else "couriers"
    id_col = "id" if target_type == "res" else "tg_id"
    
    conn = await get_db_conn()
    try:
        new_date = datetime.now(timezone.utc) + timedelta(days=days)
        await conn.execute(f"UPDATE {table} SET paid_until = $1 WHERE {id_col} = $2", new_date, target_id)
        await message.answer(f"✅ Доступ продлен до {new_date.strftime('%d.%m.%Y')}")
    finally: await conn.close()

@dp.message(Command("set_city_price"))
async def admin_set_city_price(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 4: return await message.answer("Формат: /set_city_price Город База Км")
    
    city, base, km = args[1], int(args[2]), int(args[3])
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO city_pricing (city_name, base_price, km_price) VALUES ($1, $2, $3) ON CONFLICT (city_name) DO UPDATE SET base_price = $2, km_price = $3", city, base, km)
        await conn.execute("UPDATE restaurants SET base_delivery_price = $1, km_delivery_price = $2 WHERE city = $3", base, km, city)
        await message.answer(f"✅ Цены для г. {city} обновлены: База {base}₽, Км {km}₽\n\nВНИМАНИЕ: Если цены не обновились в приложении, зайдите в таблицу restaurants в базе данных и укажите эти значения вручную для нужного ресторана.")
    finally: await conn.close()

# ==========================================
#           ОБЩИЕ КОМАНДЫ
# ==========================================
@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🍔 Открыть меню", web_app=WebAppInfo(url="https://leki-app.vercel.app/"))],
        [InlineKeyboardButton(text="🆘 Поддержка", url="https://t.me/твой_логин")] # <--- ЗАМЕНИ НА СВОЙ ЛОГИН
    ])
    await message.answer("Ассаламу алейкум! Добро пожаловать в LEKI.\n\n🛠 Админ: /admin\n🛵 Курьер: /courier", reply_markup=kb)

@dp.message(Command("my_id"))
async def cmd_my_id(message: types.Message):
    await message.answer(f"Ваш ID: <code>{message.from_user.id}</code>", parse_mode="HTML")

# --- УПРАВЛЕНИЕ КУРЬЕРАМИ ---
@dp.message(Command("add_courier"))
async def admin_add_courier(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split(maxsplit=2)
    if len(args) < 3: return await message.answer("Формат: /add_courier ID Имя")
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
        c_id = int(args[1])
        await conn.execute("UPDATE orders SET courier_tg_id = NULL WHERE courier_tg_id = $1", c_id)
        await conn.execute("DELETE FROM courier_reviews WHERE courier_tg_id = $1", c_id)
        await conn.execute("DELETE FROM couriers WHERE tg_id = $1", c_id)
        await message.answer(f"🚫 Курьер {c_id} удален.")
    finally: await conn.close()

@dp.message(Command("courier_stats"))
async def courier_stats(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    conn = await get_db_conn()
    try:
        rows = await conn.fetch("""
            SELECT c.name, c.tg_id, ROUND(AVG(r.rating), 1) as rating, COUNT(r.id) as jobs, c.paid_until
            FROM couriers c
            LEFT JOIN courier_reviews r ON c.tg_id = r.courier_tg_id
            GROUP BY c.tg_id, c.name, c.paid_until
            ORDER BY rating DESC NULLS LAST
        """)
        text = "📊 <b>Рейтинг и подписки курьеров:</b>\n\n"
        for r in rows:
            rate = r['rating'] or 0
            paid = r.get('paid_until')
            is_paid = True if not paid else paid > datetime.now(timezone.utc)
            status = "✅" if is_paid else "❌"
            paid_str = paid.strftime('%d.%m') if paid else "Безлимит"
            text += f"{status} <b>{r['name']}</b>: {rate}⭐ ({r['jobs']} зак.)\nДо: {paid_str}\nID: <code>{r['tg_id']}</code>\n\n"
        await message.answer(text, parse_mode="HTML")
    finally: await conn.close()

# ==========================================
#           ПАНЕЛЬ КУРЬЕРА
# ==========================================
async def get_courier_panel_text(conn, tg_id):
    c = await conn.fetchrow("SELECT * FROM couriers WHERE tg_id = $1", tg_id)
    if not c: return None, None
    
    paid = c.get('paid_until')
    is_paid = True if not paid else paid > datetime.now(timezone.utc)
    status_text = "🟢 НА ЛИНИИ" if c['is_active'] and is_paid else "🔴 ПЕРЕРЫВ" if is_paid else "❌ ПОДПИСКА ИСТЕКЛА"
    paid_str = paid.strftime('%d.%m.%Y') if paid else "Безлимит"
    
    text = f"🛵 <b>Кабинет курьера</b>\n\n👤 Имя: {c['name']}\n🏙 Город: {c['city']}\n💳 Оплачено до: {paid_str}\n\nСтатус: <b>{status_text}</b>"
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
        if not text:
            apply_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="📝 Стать курьером", url="https://t.me/твой_логин")]]) # <--- ЗАМЕНИ НА СВОЙ ЛОГИН
            return await message.answer("❌ <b>Доступ запрещен.</b>\nВы не числитесь в нашей системе.\n\nХотите работать в LEKI?", reply_markup=apply_kb, parse_mode="HTML")
        
        c = await conn.fetchrow("SELECT city FROM couriers WHERE tg_id = $1", message.from_user.id)
        if c['city'] == '-':
            await message.answer("Напишите ваш город для работы:")
            await state.set_state(CourierStates.change_city)
        else: await message.answer(text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close()

@dp.callback_query(F.data == "cour_toggle")
async def cour_toggle_status(callback: CallbackQuery):
    conn = await get_db_conn()
    try:
        c = await conn.fetchrow("SELECT city, is_active, paid_until FROM couriers WHERE tg_id = $1", callback.from_user.id)
        paid = c.get('paid_until')
        if paid and paid < datetime.now(timezone.utc):
            return await callback.answer("❌ Срок оплаты истек! Обратитесь к администратору.", show_alert=True)
            
        new_status = not c['is_active']
        await conn.execute("UPDATE couriers SET is_active = $1 WHERE tg_id = $2", new_status, callback.from_user.id)
        text, kb = await get_courier_panel_text(conn, callback.from_user.id)
        await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        
        if new_status:
            pending_orders = await conn.fetch("SELECT o.id, o.restaurant_name, o.address, r.city FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.status = 'accepted' AND o.courier_tg_id IS NULL AND r.city = $1", c['city'])
            for p_order in pending_orders:
                kb_c = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛵 Взять заказ", callback_data=f"take_{p_order['id']}")]])
                try: await bot.send_message(callback.from_user.id, f"🚨 <b>Свободный заказ №{p_order['id']}</b>\nИз: {p_order['restaurant_name']}\nКуда: {p_order['address']}", reply_markup=kb_c, parse_mode="HTML")
                except: pass
                
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

# --- ЛОГИКА ЦЕПОЧКИ ЗАКАЗА ---

@dp.callback_query(F.data.startswith("take_"))
async def take_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        order = await conn.fetchrow("SELECT courier_tg_id, address, restaurant_name, items, total_price FROM orders WHERE id = $1", order_id)
        if not order: return await callback.answer("Заказ не найден!", show_alert=True)
        if order['courier_tg_id']: return await callback.answer("Заказ уже занят другим курьером!", show_alert=True)
        
        await conn.execute("UPDATE orders SET courier_tg_id = $1, status = 'taken' WHERE id = $2", callback.from_user.id, order_id)
        
        await notify_restaurant(conn, order_id, "Курьер принял заказ и едет в ресторан 🏃‍♂️")
        await notify_client(conn, order_id, "Мы нашли курьера! Он уже спешит в ресторан. 🏃‍♂️")
        
        # Расчет суммы доставки для курьера
        items = json.loads(order['items'])
        delivery_fee = order['total_price'] - sum([i['price'] * i['count'] for i in items])
        
        # Кнопка навигатора в ресторан
        res_coords = await conn.fetchrow("SELECT lat, lon FROM restaurants WHERE name = $1", order['restaurant_name'])
        nav_url = f"https://yandex.ru/maps/?pt={res_coords['lon']},{res_coords['lat']}&z=18&l=map" if res_coords and res_coords['lat'] else f"https://yandex.ru/maps/?text={order['restaurant_name']}"
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🗺 Маршрут в ресторан", url=nav_url)],
            [InlineKeyboardButton(text="🏃‍♂️ Забрал заказ", callback_data=f"picked_{order_id}")]
        ])
        await callback.message.edit_text(f"✅ <b>Заказ №{order_id} принят!</b>\n\nЗабрать в: {order['restaurant_name']}\nАдрес доставки: {order['address']}\n💵 <b>Не забудьте получить {delivery_fee} ₽ за доставку в ресторане!</b>", reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("picked_"))
async def picked_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'delivering' WHERE id = $1", order_id)
        order = await conn.fetchrow("SELECT address, lat, lon FROM orders WHERE id = $1", order_id)
        
        await notify_restaurant(conn, order_id, "Курьер забрал еду и выехал к клиенту 🚴‍♂️")
        await notify_client(conn, order_id, "Курьер забрал ваш заказ и уже в пути! 🚴‍♂️💨")
        
        # Генерируем точную ссылку Яндекс Карт по координатам клиента (lat, lon)
        if order['lat'] and order['lon']:
            nav_url = f"https://yandex.ru/maps/?pt={order['lon']},{order['lat']}&z=18&l=map"
        else:
            safe_addr = order['address'].split(', кв/офис')[0].replace(' ', '+').replace('\n', '+')
            nav_url = f"https://yandex.ru/maps/?text={safe_addr}"
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🗺 Маршрут к клиенту", url=nav_url)],
            [InlineKeyboardButton(text="📍 Я на адресе", callback_data=f"arrived_{order_id}")]
        ])
        await callback.message.edit_text(f"🚴‍♂️ <b>Заказ №{order_id} в пути!</b>\nАдрес: {order['address']}", reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("arrived_"))
async def arrived_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'arrived' WHERE id = $1", order_id)
        await notify_restaurant(conn, order_id, "Курьер прибыл к клиенту 📍")
        await notify_client(conn, order_id, "Курьер уже у ваших дверей! 📍")
        
        order = await conn.fetchrow("SELECT phone, user_data FROM orders WHERE id = $1", order_id)
        u = json.loads(order['user_data'])
        client_id = u.get('id')
        
        kb_arr = []
        if client_id:
            kb_arr.append([InlineKeyboardButton(text="💬 Написать клиенту", url=f"tg://user?id={client_id}")])
        kb_arr.append([InlineKeyboardButton(text="🏁 Доставлено", callback_data=f"done_{order_id}")])
        
        await callback.message.edit_text(
            f"📍 <b>Заказ №{order_id}</b>\nВы на месте. Вручите заказ клиенту.\n\n📱 Телефон клиента: <code>{order['phone']}</code>",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=kb_arr), parse_mode="HTML"
        )
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("done_"))
async def done_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'completed' WHERE id = $1", order_id)
        await notify_restaurant(conn, order_id, "Заказ успешно доставлен! ✅")
        order_data = await conn.fetchrow("SELECT user_data, restaurant_name FROM orders WHERE id = $1", order_id)
        if order_data:
            res = await conn.fetchrow("SELECT id FROM restaurants WHERE name = $1", order_data['restaurant_name'])
            u = json.loads(order_data['user_data'])
            kb_res = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{i} ⭐", callback_data=f"rres_{order_id}_{res['id']}_{i}") for i in range(1, 6)]])
            try: await bot.send_message(u['id'], f"😋 <b>Оцените блюда от {order_data['restaurant_name']}:</b>", reply_markup=kb_res, parse_mode="HTML")
            except: pass
        await callback.message.edit_text(f"🏁 <b>Заказ №{order_id} завершен!</b>")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("rres_"))
async def handle_rate_res(callback: CallbackQuery):
    _, order_id, res_id, stars = callback.data.split("_")
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO restaurant_reviews (restaurant_id, order_id, rating) VALUES ($1, $2, $3)", int(res_id), int(order_id), int(stars))
        order = await conn.fetchrow("SELECT courier_tg_id FROM orders WHERE id = $1", int(order_id))
        kb_cour = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{i} ⭐", callback_data=f"rcour_{order_id}_{order['courier_tg_id']}_{i}") for i in range(1, 6)]])
        await callback.message.edit_text(f"✅ Оценка еды сохранена!\n\n🛵 <b>А как вам работа курьера?</b>", reply_markup=kb_cour, parse_mode="HTML")
    except: await callback.answer("Уже оценено!")
    finally: await conn.close()

@dp.callback_query(F.data.startswith("rcour_"))
async def handle_rate_cour(callback: CallbackQuery):
    _, order_id, courier_id, stars = callback.data.split("_")
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO courier_reviews (courier_tg_id, order_id, rating) VALUES ($1, $2, $3)", int(courier_id), int(order_id), int(stars))
        await callback.message.edit_text("🙏 Спасибо! Это помогает нам становиться лучше.")
    except: await callback.answer("Уже оценено!")
    finally: await conn.close()

# ==========================================
#           АДМИН РЕСТОРАНА
# ==========================================
@dp.message(Command("admin"))
async def cmd_admin(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT * FROM restaurants WHERE admin_tg_id = $1", message.from_user.id)
        if not res and message.from_user.id == MAIN_ADMIN_ID:
            res = await conn.fetchrow("SELECT * FROM restaurants LIMIT 1")
        if not res: return await message.answer("❌ Нет доступа.")
        
        paid = res.get('paid_until')
        is_paid = True if not paid else paid > datetime.now(timezone.utc)
        status = "✅ Оплачено" if is_paid else "❌ Подписка истекла"
        paid_str = paid.strftime('%d.%m') if paid else "Безлимит"
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🗺 Меню", callback_data=f"adm_menu_{res['id']}")],
            [InlineKeyboardButton(text="💳 Реквизиты", callback_data=f"adm_card_{res['id']}")],
            [InlineKeyboardButton(text=f"📍 Радиус: {res.get('delivery_radius') or 15} км", callback_data=f"adm_radius_{res['id']}")]
        ])
        await message.answer(f"🛠 <b>Управление: {res['name']}</b>\n💳 Статус: {status} (до {paid_str})", parse_mode="HTML", reply_markup=kb)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_add_new_"))
async def adm_start_add(callback: CallbackQuery, state: FSMContext):
    res_id = int(callback.data.split("_")[3])
    await state.update_data(res_id=res_id)
    await state.set_state(AdminStates.waiting_for_new_name)
    await callback.message.answer("Название блюда:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_new_name)
async def adm_new_name(message: types.Message, state: FSMContext):
    await state.update_data(name=message.text)
    await message.answer("Цена:")
    await state.set_state(AdminStates.waiting_for_new_price)

@dp.message(AdminStates.waiting_for_new_price)
async def adm_new_price(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return await message.answer("Только цифры!")
    await state.update_data(price=int(message.text))
    await message.answer("Описание (или '-'):")
    await state.set_state(AdminStates.waiting_for_new_desc)

@dp.message(AdminStates.waiting_for_new_desc)
async def adm_new_desc(message: types.Message, state: FSMContext):
    data = await state.get_data()
    desc = "" if message.text == "-" else message.text
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO products (restaurant_id, name, price, description, is_active) VALUES ($1, $2, $3, $4, true)", data['res_id'], data['name'], data['price'], desc)
        await message.answer("✅ Добавлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_menu_"))
async def adm_show_menu(callback: CallbackQuery):
    res_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        products = await conn.fetch("SELECT id, name, is_active FROM products WHERE restaurant_id = $1 ORDER BY id DESC", res_id)
        kb = [[InlineKeyboardButton(text="➕ ДОБАВИТЬ БЛЮДО", callback_data=f"adm_add_new_{res_id}")]]
        for p in products:
            kb.append([InlineKeyboardButton(text=f"{'✅' if p['is_active'] else '🚫'} {p['name']}", callback_data=f"adm_p_{p['id']}")])
        kb.append([InlineKeyboardButton(text="🔙 Назад", callback_data="adm_cancel")])
        await callback.message.edit_text("Меню:", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_p_"))
async def admin_product_menu(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        p = await conn.fetchrow("SELECT * FROM products WHERE id = $1", prod_id)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💵 Цена", callback_data=f"adm_price_{p['id']}")],
            [InlineKeyboardButton(text="🚫 Стоп-лист" if p['is_active'] else "✅ В Меню", callback_data=f"adm_toggle_{p['id']}")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data=f"adm_menu_{p['restaurant_id']}")]
        ])
        await callback.message.edit_text(f"🍔 {p['name']}\nЦена: {p['price']}₽", reply_markup=kb)
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
    await callback.message.answer("Новая цена:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_price)
async def process_price(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return
    data = await state.get_data()
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET price = $1 WHERE id = $2", int(message.text), data['prod_id'])
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_card_"))
async def adm_card(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_card)
    await callback.message.answer("Новые реквизиты:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_card)
async def process_card(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET card_number = $1 WHERE admin_tg_id = $2", message.text, message.from_user.id)
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_radius_"))
async def adm_radius(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_radius)
    await callback.message.answer("Новый радиус (км):")
    await callback.answer()

@dp.message(AdminStates.waiting_for_radius)
async def process_radius(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET delivery_radius = $1 WHERE admin_tg_id = $2", int(message.text), message.from_user.id)
        await message.answer("✅ Обновлено!")
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
                res_info = await conn.fetchrow("SELECT city, admin_tg_id, paid_until FROM restaurants WHERE name = $1", order['restaurant_name'])
                paid = res_info.get('paid_until') if res_info else None
                if paid and paid < datetime.now(timezone.utc): continue
                
                target = res_info['admin_tg_id'] if res_info and res_info['admin_tg_id'] else MAIN_ADMIN_ID
                u = json.loads(order['user_data'])
                items = json.loads(order['items'])
                items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])
                city_name = res_info['city'] if res_info else '-'
                
                # РАСЧЕТ ДОЛИ КУРЬЕРА ДЛЯ УВЕДОМЛЕНИЯ РЕСТОРАНА
                items_sum = sum([i['price'] * i['count'] for i in items])
                delivery_fee = order['total_price'] - items_sum
                
                active_couriers = await conn.fetchval("SELECT COUNT(*) FROM couriers WHERE city = $1 AND is_active = true AND (paid_until > now() OR paid_until IS NULL)", city_name)
                courier_warning = f"🔴 <b>ВНИМАНИЕ! На линии 0 курьеров!</b>" if active_couriers == 0 else f"🟢 Курьеров на линии: {active_couriers}"
                
                text = (f"🚨 <b>НОВЫЙ ЗАКАЗ №{order['id']}</b>\n\n🏙 Город: {city_name}\n👤 {u.get('first_name')}\n📍 {order['address']}\n\n{items_text}\n💰 <b>ИТОГО: {order['total_price']} ₽</b>\n\n❗️ <b>ОПЛАТА КУРЬЕРУ: Выдайте курьеру {delivery_fee} ₽ при передаче заказа.</b>\n\n{courier_warning}")
                
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="✅ Принять (Выбрать время)", callback_data=f"time_{order['id']}_{u.get('id')}")],
                    [InlineKeyboardButton(text="💬 Написать клиенту", url=f"tg://user?id={u.get('id')}")],
                    [InlineKeyboardButton(text="❌ Отмена", callback_data=f"no_{order['id']}_{u.get('id')}")]
                ])
                
                try:
                    if order['receipt_url']: await bot.send_photo(target, order['receipt_url'], caption=text, reply_markup=kb, parse_mode="HTML")
                    else: await bot.send_message(target, text, reply_markup=kb, parse_mode="HTML")
                except: pass
                await conn.execute("UPDATE orders SET is_notified = true WHERE id = $1", order['id'])
        except: pass
        finally: 
            if conn: await conn.close()
        await asyncio.sleep(15)

@dp.callback_query(F.data.startswith("time_"))
async def ask_prep_time(callback: CallbackQuery):
    _, order_id, client_id = callback.data.split("_")
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="15 мин", callback_data=f"ok_{order_id}_{client_id}_15"),
            InlineKeyboardButton(text="30 мин", callback_data=f"ok_{order_id}_{client_id}_30")
        ],
        [
            InlineKeyboardButton(text="45 мин", callback_data=f"ok_{order_id}_{client_id}_45"),
            InlineKeyboardButton(text="1 час", callback_data=f"ok_{order_id}_{client_id}_60")
        ]
    ])
    await callback.message.edit_reply_markup(reply_markup=kb)

@dp.callback_query(F.data.startswith(("ok_", "no_")))
async def handle_decision(callback: CallbackQuery):
    data = callback.data.split("_")
    action, order_id, client_id = data[0], int(data[1]), int(data[2])
    conn = await get_db_conn()
    try:
        if action == "ok":
            prep_time = int(data[3])
            
            # --- ТУТ ИСПОЛЬЗУЕМ ВРЕМЯ МСК ДЛЯ КОРРЕКТНОГО ОТОБРАЖЕНИЯ ---
            ready_time = (datetime.now(MSK) + timedelta(minutes=prep_time)).strftime('%H:%M')
            
            await conn.execute("UPDATE orders SET status = 'accepted' WHERE id = $1", order_id)
            if client_id: await bot.send_message(client_id, f"🎉 Заказ №{order_id} принят! Еда будет готова примерно к {ready_time}. Ищем курьера.")
            order_info = await conn.fetchrow("SELECT o.address, o.items, o.total_price, r.city, o.restaurant_name FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.id = $1", order_id)
            
            items = json.loads(order_info['items'])
            delivery_fee = order_info['total_price'] - sum([i['price'] * i['count'] for i in items])
            
            couriers = await conn.fetch("SELECT tg_id FROM couriers WHERE city = $1 AND is_active = true AND (paid_until > now() OR paid_until IS NULL)", order_info['city'])
            kb_c = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛵 Взять заказ", callback_data=f"take_{order_id}")]])
            
            for c in couriers:
                try: await bot.send_message(c['tg_id'], f"🚨 Новый заказ №{order_id}\nИз: {order_info['restaurant_name']}\nКуда: {order_info['address']}\n💵 <b>Оплата за доставку: {delivery_fee} ₽ (заберете в ресторане)</b>\n\n⏳ <b>Будет готово к {ready_time} (через {prep_time} мин)</b>", reply_markup=kb_c, parse_mode="HTML")
                except: pass
            
            caption = (callback.message.caption or callback.message.text).split('\n\n🔴')[0].split('\n\n🟢')[0]
            caption += f"\n\n🟢 ПРИНЯТ (Готовность: к {ready_time})"
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