'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function CourierApp() {
  const [courier, setCourier] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [activeOrder, setActiveOrder] = useState(null)
  const [availableOrders, setAvailableOrders] = useState([])
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [offlineTimer, setOfflineTimer] = useState(null)
  const [gpsStatus, setGpsStatus] = useState('поиск...')
  const locRef = useRef(null);

  // 1. АВТОРИЗАЦИЯ
  useEffect(() => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    async function auth() {
      if (!tgUser?.id) return setIsAuthLoading(false);
      const { data } = await supabase.from('couriers').select('*').eq('tg_id', tgUser.id).single();
      if (data) setCourier(data);
      setIsAuthLoading(false);
    }
    auth();
  }, []);

  // 2. GPS
  useEffect(() => {
    if (!courier) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => { 
        locRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGpsStatus('OK');
      },
      (err) => { setGpsStatus('Ошибка'); },
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [courier]);

  // 3. ЗАГРУЗКА ДАННЫХ (срабатывает при изменении статуса курьера или по интервалу)
  const fetchAll = async () => {
    if (!courier) return;

    // Ищем активный заказ
    const { data: active } = await supabase.from('orders').select('*').eq('courier_tg_id', courier.tg_id).in('status', ['taken', 'delivering', 'arrived']).maybeSingle();
    setActiveOrder(active || null);

    if (!active && courier.is_active) {
      // 1. Берем все висящие заказы
      const { data: orders } = await supabase.from('orders').select('*').eq('status', 'accepted').is('courier_tg_id', null);
      // 2. Берем все рестораны
      const { data: restaurants } = await supabase.from('restaurants').select('*').eq('city', courier.city);

      if (orders && restaurants) {
        const currentLoc = locRef.current;
        const filtered = orders.map(order => {
            const resInfo = restaurants.find(r => r.name === order.restaurant_name);
            if (!resInfo) return null;
            return { ...order, res_data: resInfo };
        }).filter(item => {
            if (!item) return false;
            if (!currentLoc) return true; // Если GPS еще нет, показываем всё

            const dist = getDistance(currentLoc.lat, currentLoc.lon, item.res_data.lat, item.res_data.lon);
            const minutesPassed = (new Date() - new Date(item.created_at)) / 60000;

            // Логика радиуса:
            if (minutesPassed < 5) return dist <= 3.5;
            if (minutesPassed < 10) return dist <= 7.0;
            return true;
        });
        setAvailableOrders(filtered);
      }
    } else {
      setAvailableOrders([]);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [courier?.is_active, courier?.tg_id]);

  // 4. ТАЙМЕР ВЫХОДА
  useEffect(() => {
    let timer;
    if (offlineTimer !== null && offlineTimer > 0) {
      timer = setTimeout(() => setOfflineTimer(offlineTimer - 1), 1000);
    } else if (offlineTimer === 0) {
      finishToggleStatus(false);
      setOfflineTimer(null);
    }
    return () => clearTimeout(timer);
  }, [offlineTimer]);

  const startToggleStatus = async () => {
    if (courier.is_active) {
      const { data } = await supabase.from('settings').select('value').eq('key', 'courier_buffer_sec').single();
      setOfflineTimer(data ? parseInt(data.value) : 60);
    } else { finishToggleStatus(true); }
  };

  const finishToggleStatus = async (val) => {
    await supabase.from('couriers').update({ is_active: val }).eq('tg_id', courier.tg_id);
    setCourier({ ...courier, is_active: val });
    // Принудительно обновляем список сразу после выхода в онлайн
    if (val) setTimeout(fetchAll, 500);
  };

  // 5. УВЕДОМЛЕНИЯ И ДЕЙСТВИЯ
  const notify = async (order, type) => {
    try {
      const uData = typeof order.user_data === 'string' ? JSON.parse(order.user_data) : order.user_data;
      const { data: res } = await supabase.from('restaurants').select('id, admin_tg_id').eq('name', order.restaurant_name).single();
      
      let clientMsg = type === 'taken' ? 'Курьер найден!' : type === 'delivering' ? 'Курьер в пути!' : type === 'arrived' ? 'Курьер у дверей!' : '';
      if (clientMsg && uData?.id) await fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: uData.id, message: `🛎 <b>Заказ №${order.id}</b>\n${clientMsg}` }) });
      
      if (type === 'completed' && uData?.id) {
         const kb = { inline_keyboard: [[{ text: "5 ⭐", callback_data: `rres_${order.id}_${res.id}_5` }]] };
         await fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: uData.id, message: `Оцените еду:`, reply_markup: kb }) });
      }
    } catch(e) {}
  }

  const handleTake = async (order) => {
    setIsActionLoading(true);
    await supabase.from('orders').update({ courier_tg_id: courier.tg_id, status: 'taken' }).eq('id', order.id);
    await notify(order, 'taken');
    fetchAll();
    setIsActionLoading(false);
  };

  const handleUpdate = async (status) => {
    setIsActionLoading(true);
    await supabase.from('orders').update({ status }).eq('id', activeOrder.id);
    await notify(activeOrder, status);
    fetchAll();
    setIsActionLoading(false);
  };

  if (isAuthLoading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">ЗАГРУЗКА...</div>;
  if (!courier) return <div className="p-10 text-center font-bold">Доступ закрыт</div>;

  return (
    <main className="min-h-screen bg-gray-100 flex flex-col fixed inset-0">
      <div className="bg-white p-5 shadow-sm z-20 flex justify-between items-center">
        <div>
          <h1 className="font-black text-xl">LEKI PRO</h1>
          <p className="text-[10px] text-gray-400 font-bold uppercase">GPS: {gpsStatus} • {courier.city}</p>
        </div>
        <button onClick={offlineTimer ? () => setOfflineTimer(null) : startToggleStatus} className={`px-5 py-2 rounded-xl font-black text-sm ${courier.is_active ? 'bg-green-500 text-white' : 'bg-gray-300'}`}>
            {offlineTimer ? `ЖДИТЕ ${offlineTimer}с` : (courier.is_active ? 'В СЕТИ' : 'ОФФЛАЙН')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeOrder ? (
            <div className="bg-white rounded-3xl p-6 shadow-sm border h-full flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <span className="font-black">ЗАКАЗ #{activeOrder.id}</span>
                    <span className="text-xl font-black text-blue-600">{activeOrder.total_price} ₽</span>
                </div>
                <div className="flex-1 space-y-6">
                    <div>
                        <p className="text-[10px] font-black text-gray-400">РЕСТОРАН:</p>
                        <p className="font-black text-lg">{activeOrder.restaurant_name}</p>
                        <button onClick={() => window.open(`https://yandex.ru/maps/?text=${encodeURIComponent(activeOrder.restaurant_name)}`)} className="text-blue-500 font-bold text-xs mt-1">🗺 КАРТА</button>
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-gray-400">КЛИЕНТ:</p>
                        <p className="font-black text-lg">{activeOrder.address}</p>
                        <div className="flex gap-4 mt-1">
                            <button onClick={() => window.open(`https://yandex.ru/maps/?text=${encodeURIComponent(activeOrder.address.split(',')[0])}`)} className="text-blue-500 font-bold text-xs">🗺 МАРШРУТ</button>
                            <a href={`tel:${activeOrder.phone}`} className="text-green-500 font-bold text-xs">📞 ЗВОНОК</a>
                        </div>
                    </div>
                </div>
                <div className="mt-6">
                    {activeOrder.status === 'taken' && <button onClick={() => handleUpdate('delivering')} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black">🏃‍♂️ ЗАБРАЛ ЗАКАЗ</button>}
                    {activeOrder.status === 'delivering' && <button onClick={() => handleUpdate('arrived')} className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black">📍 НА МЕСТЕ</button>}
                    {activeOrder.status === 'arrived' && <button onClick={() => handleUpdate('completed')} className="w-full bg-green-500 text-white py-4 rounded-2xl font-black">🏁 ДОСТАВИЛ</button>}
                </div>
            </div>
        ) : (
            <div className="space-y-4">
                <h2 className="font-black text-gray-800">Доступно: {availableOrders.length}</h2>
                {availableOrders.length === 0 && courier.is_active && (
                    <div className="text-center py-20 text-gray-400 font-bold">Заказов пока нет...</div>
                )}
                {availableOrders.map(order => (
                    <div key={order.id} className="bg-white rounded-2xl p-5 shadow-sm border flex justify-between items-center">
                        <div>
                            <p className="font-black">{order.restaurant_name}</p>
                            <p className="text-xs text-blue-500 font-bold">Доплата курьеру: {order.total_price - 500} ₽</p>
                        </div>
                        <button onClick={() => handleTake(order)} className="bg-black text-white px-6 py-3 rounded-xl font-black text-xs">ПРИНЯТЬ</button>
                    </div>
                ))}
            </div>
        )}
      </div>
    </main>
  )
}