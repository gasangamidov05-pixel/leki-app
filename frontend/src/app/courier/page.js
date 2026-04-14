'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'
import Script from 'next/script'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// Функция расчета расстояния (Haversine)
function getDistance(lat1, lon1, lat2, lon2) {
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
  const [location, setLocation] = useState(null)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [offlineTimer, setOfflineTimer] = useState(null) // Секунды до отключения

  // 1. АВТОРИЗАЦИЯ
  useEffect(() => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    async function auth() {
      if (!tgUser?.id) return setIsAuthLoading(false);
      const { data } = await supabase.from('couriers').select('*').eq('tg_id', tgUser.id).single();
      if (data) {
        setCourier(data);
        fetchData(data);
      }
      setIsAuthLoading(false);
    }
    auth();
  }, []);

  // 2. ГЕОЛОКАЦИЯ И ОБНОВЛЕНИЕ БАЗЫ (Раз в 60 сек)
  useEffect(() => {
    if (!courier) return;

    const watchId = navigator.geolocation.watchPosition(async (pos) => {
      const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setLocation(coords);
    }, (err) => console.error(err), { enableHighAccuracy: true });

    const geoInterval = setInterval(async () => {
      if (location && courier) {
        await supabase.from('couriers').update({ 
            lat: location.lat, 
            lon: location.lon, 
            last_seen: new Date().toISOString() 
        }).eq('tg_id', courier.tg_id);
      }
    }, 60000);

    return () => {
        navigator.geolocation.clearWatch(watchId);
        clearInterval(geoInterval);
    };
  }, [courier, location]);

  // 3. АВТООБНОВЛЕНИЕ СПИСКА ЗАКАЗОВ (Раз в 10 сек)
  useEffect(() => {
    if (!courier) return;
    const interval = setInterval(() => fetchData(courier), 10000);
    return () => clearInterval(interval);
  }, [courier, location]);

  const fetchData = async (currCourier) => {
    // Активный заказ
    const { data: active } = await supabase.from('orders').select('*').eq('courier_tg_id', currCourier.tg_id).in('status', ['taken', 'delivering', 'arrived']).maybeSingle();
    setActiveOrder(active);

    if (!active && currCourier.is_active) {
      // Доступные заказы с координатами ресторанов
      const { data: available } = await supabase.from('orders').select('*, restaurants!inner(lat, lon, city)').eq('status', 'accepted').is('courier_tg_id', null).eq('restaurants.city', currCourier.city);
      
      if (available && location) {
          const filtered = available.filter(order => {
              const dist = getDistance(location.lat, location.lon, order.restaurants.lat, order.restaurants.lon);
              const minutesPassed = (new Date() - new Date(order.created_at)) / 60000;
              
              // Логика "Умного радиуса":
              // 0-5 мин: только в радиусе 2км
              // 5-10 мин: радиус 5км
              // 10+ мин: все заказы в городе
              if (minutesPassed < 5) return dist <= 2;
              if (minutesPassed < 10) return dist <= 5;
              return true;
          });
          setAvailableOrders(filtered);
      }
    }
  };

  // 4. ТАЙМЕР ВЫХОДА С ЛИНИИ
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
      // Если на линии - запускаем таймер (буфер)
      const { data } = await supabase.from('settings').select('value').eq('key', 'courier_buffer_sec').single();
      const buffer = data ? parseInt(data.value) : 60;
      setOfflineTimer(buffer);
    } else {
      finishToggleStatus(true);
    }
  };

  const finishToggleStatus = async (val) => {
    await supabase.from('couriers').update({ is_active: val }).eq('tg_id', courier.tg_id);
    setCourier({ ...courier, is_active: val });
  };

  // 5. ДЕЙСТВИЯ (с пушами)
  const notify = async (order, type) => {
      const uData = typeof order.user_data === 'string' ? JSON.parse(order.user_data) : order.user_data;
      const { data: res } = await supabase.from('restaurants').select('admin_tg_id').eq('name', order.restaurant_name).single();
      
      let clientMsg = type === 'taken' ? 'Курьер найден и спешит в ресторан! 🏃‍♂️' : type === 'delivering' ? 'Курьер в пути! 🚴‍♂️' : type === 'arrived' ? 'Курьер у дверей! 📍' : '';
      let resMsg = type === 'taken' ? 'Курьер принял заказ. Готовьте! 🔥' : type === 'delivering' ? 'Курьер забрал еду. ✅' : type === 'completed' ? 'Заказ доставлен! 🏁' : '';

      if (clientMsg && uData?.id) fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: uData.id, message: `🛎 <b>Заказ №${order.id}</b>\n${clientMsg}` }) });
      if (resMsg && res?.admin_tg_id) fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: res.admin_tg_id, message: `📦 <b>Заказ №${order.id}</b>\n${resMsg}` }) });
  }

  const handleTake = async (order) => {
    setIsActionLoading(true);
    await supabase.from('orders').update({ courier_tg_id: courier.tg_id, status: 'taken' }).eq('id', order.id);
    await notify(order, 'taken');
    fetchData(courier);
    setIsActionLoading(false);
  };

  const handleUpdate = async (status) => {
    setIsActionLoading(true);
    await supabase.from('orders').update({ status }).eq('id', activeOrder.id);
    await notify(activeOrder, status);
    fetchData(courier);
    setIsActionLoading(false);
  };

  if (isAuthLoading) return <div className="min-h-screen bg-black flex items-center justify-center text-white font-bold">L E K I ...</div>;
  if (!courier) return <div className="p-10 text-center font-bold text-red-500">Доступ закрыт</div>;

  return (
    <main className="min-h-screen bg-gray-100 flex flex-col p-4 pb-10">
      {/* HEADER */}
      <div className="bg-white rounded-3xl p-5 shadow-sm mb-4 flex justify-between items-center">
        <div>
          <h1 className="font-black text-2xl text-gray-900">LEKI <span className="text-blue-600">PRO</span></h1>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{courier.city} • {courier.name}</p>
        </div>
        <button 
            onClick={offlineTimer ? () => setOfflineTimer(null) : startToggleStatus}
            className={`px-6 py-3 rounded-2xl font-black text-sm transition-all shadow-lg ${courier.is_active ? (offlineTimer ? 'bg-orange-500 text-white animate-pulse' : 'bg-green-500 text-white') : 'bg-gray-200 text-gray-500'}`}
        >
            {offlineTimer ? `ОТМЕНА (${offlineTimer}с)` : (courier.is_active ? 'В СЕТИ' : 'ОФФЛАЙН')}
        </button>
      </div>

      {/* АКТИВНЫЙ ЗАКАЗ */}
      {activeOrder ? (
        <div className="bg-white rounded-[32px] p-6 shadow-xl border-t-4 border-blue-600 flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <span className="bg-blue-50 text-blue-700 px-4 py-2 rounded-xl text-xs font-black">ЗАКАЗ #{activeOrder.id}</span>
                <span className="text-2xl font-black">{activeOrder.total_price} ₽</span>
            </div>

            <div className="space-y-8 flex-1">
                <div className="relative pl-8 border-l-2 border-dashed border-gray-200 ml-2">
                    <div className="absolute -left-[9px] top-0 w-4 h-4 bg-gray-300 rounded-full border-4 border-white"></div>
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-1">ОТКУДА</p>
                    <p className="font-black text-lg leading-tight mb-2">{activeOrder.restaurant_name}</p>
                    <button onClick={() => window.open(`https://yandex.ru/maps/?text=${encodeURIComponent(activeOrder.restaurant_name)}`, '_blank')} className="text-blue-600 font-bold text-xs bg-blue-50 px-3 py-1 rounded-lg">🗺 МАРШРУТ</button>
                </div>

                <div className="relative pl-8 border-l-2 border-transparent ml-2">
                    <div className="absolute -left-[9px] top-0 w-4 h-4 bg-blue-600 rounded-full border-4 border-white shadow-md"></div>
                    <p className="text-[10px] font-black text-blue-500 uppercase mb-1">КУДА</p>
                    <p className="font-black text-lg leading-tight mb-3">{activeOrder.address}</p>
                    <div className="flex gap-2">
                        <button onClick={() => window.open(`https://yandex.ru/maps/?text=${encodeURIComponent(activeOrder.address.split(', кв')[0])}`, '_blank')} className="text-blue-600 font-bold text-xs bg-blue-50 px-3 py-1 rounded-lg">🗺 МАРШРУТ</button>
                        <a href={`tel:${activeOrder.phone}`} className="text-green-600 font-bold text-xs bg-green-50 px-3 py-1 rounded-lg">📞 ПОЗВОНИТЬ</a>
                    </div>
                </div>
            </div>

            <div className="mt-8">
                {activeOrder.status === 'taken' && (
                    <button disabled={isActionLoading} onClick={() => handleUpdate('delivering')} className="w-full bg-blue-600 text-white py-5 rounded-3xl font-black text-xl shadow-blue-200 shadow-2xl active:scale-95 transition-all">🏃‍♂️ ЗАБРАЛ ЗАКАЗ</button>
                )}
                {activeOrder.status === 'delivering' && (
                    <button disabled={isActionLoading} onClick={() => handleUpdate('arrived')} className="w-full bg-orange-500 text-white py-5 rounded-3xl font-black text-xl shadow-orange-200 shadow-2xl active:scale-95 transition-all">📍 Я НА МЕСТЕ</button>
                )}
                {activeOrder.status === 'arrived' && (
                    <button disabled={isActionLoading} onClick={() => handleUpdate('completed')} className="w-full bg-green-600 text-white py-5 rounded-3xl font-black text-xl shadow-green-200 shadow-2xl active:scale-95 transition-all">🏁 ДОСТАВИЛ</button>
                )}
            </div>
        </div>
      ) : (
        /* СПИСОК ДОСТУПНЫХ */
        <div className="flex-1 flex flex-col">
            <h2 className="font-black text-xl text-gray-800 mb-4 px-2">Радар заказов {location ? '🛰' : '📡'}</h2>
            
            {!courier.is_active ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <span className="text-6xl mb-4 opacity-20">💤</span>
                    <p className="font-bold">Вы не на линии</p>
                </div>
            ) : availableOrders.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                    <p className="font-bold">Ищем заказы поблизости...</p>
                    <p className="text-[10px] mt-2 uppercase tracking-widest opacity-50">Радиус увеличивается каждые 5 мин</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {availableOrders.map(order => {
                        let price = 150; // В идеале считать из айтемов, как в прошлом коде
                        return (
                            <div key={order.id} className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 flex justify-between items-center active:scale-[0.98] transition-all">
                                <div className="flex-1">
                                    <p className="text-[10px] font-black text-blue-500 uppercase mb-1">НОВЫЙ ЗАКАЗ</p>
                                    <h3 className="font-black text-lg text-gray-800 mb-1">{order.restaurant_name}</h3>
                                    <p className="text-xs font-bold text-gray-400">📍 Расстояние: ~{(getDistance(location.lat, location.lon, order.restaurants.lat, order.restaurants.lon)).toFixed(1)} км</p>
                                </div>
                                <button onClick={() => handleTake(order)} className="bg-gray-900 text-white px-5 py-4 rounded-2xl font-black text-sm shadow-xl">ПРИНЯТЬ</button>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
      )}
    </main>
  )
}