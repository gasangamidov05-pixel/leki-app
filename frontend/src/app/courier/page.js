'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'
import Script from 'next/script'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const YANDEX_API_KEY = "b9336a86-41c5-4a5a-a3b1-9a1ef4057197";

export default function CourierApp() {
  const mapRef = useRef(null);
  const ymapsRef = useRef(null);
  const routeRef = useRef(null);

  const [courier, setCourier] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  
  const [activeOrder, setActiveOrder] = useState(null)
  const [availableOrders, setAvailableOrders] = useState([])
  
  const [location, setLocation] = useState(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  const [isActionLoading, setIsActionLoading] = useState(false)

  // --- 1. АВТОРИЗАЦИЯ ---
  useEffect(() => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    
    async function authCourier() {
      if (!tgUser?.id) return setIsAuthLoading(false);
      const { data } = await supabase.from('couriers').select('*').eq('tg_id', tgUser.id).single();
      if (data) {
        setCourier(data);
        fetchOrders(data.tg_id, data.city);
      }
      setIsAuthLoading(false);
    }
    authCourier();
  }, []);

  // --- 2. ЖЕЛЕЗОБЕТОННОЕ АВТООБНОВЛЕНИЕ (Каждые 10 сек) ---
  useEffect(() => {
    if (!courier) return;
    const interval = setInterval(() => {
      fetchOrders(courier.tg_id, courier.city);
    }, 10000);
    return () => clearInterval(interval);
  }, [courier]);

  const fetchOrders = async (tg_id, city) => {
    const { data: active } = await supabase
      .from('orders')
      .select('*')
      .eq('courier_tg_id', tg_id)
      .in('status', ['taken', 'delivering', 'arrived'])
      .limit(1)
      .single();
    
    setActiveOrder(active || null);

    if (!active) {
      const { data: available } = await supabase
        .from('orders')
        .select('*, restaurants!inner(city, name, lat, lon, admin_tg_id)')
        .eq('status', 'accepted')
        .is('courier_tg_id', null)
        .eq('restaurants.city', city);
      setAvailableOrders(available || []);
    } else {
      setAvailableOrders([]);
    }
  };

  // --- 3. GPS И КАРТА ---
  useEffect(() => {
    if (!courier || !isMapLoaded) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        setLocation(coords);
        if (!mapRef.current) initMap(coords);
        else mapRef.current.courierPlacemark.geometry.setCoordinates(coords);
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [courier, isMapLoaded]);

  useEffect(() => {
    if (!mapRef.current || !ymapsRef.current || !location) return;
    if (routeRef.current) {
        mapRef.current.map.geoObjects.remove(routeRef.current);
        routeRef.current = null;
    }

    if (activeOrder) {
        if (activeOrder.status === 'taken') {
            supabase.from('restaurants').select('lat, lon').eq('name', activeOrder.restaurant_name).single().then(({data}) => {
                if(data && data.lat) drawRoute(location, [data.lat, data.lon]);
            });
        } else if (activeOrder.status === 'delivering' || activeOrder.status === 'arrived') {
            if (activeOrder.lat && activeOrder.lon) {
                drawRoute(location, [activeOrder.lat, activeOrder.lon]);
            } else {
                ymapsRef.current.geocode(activeOrder.address.split(', кв')[0]).then(res => {
                    const firstGeoObject = res.geoObjects.get(0);
                    if (firstGeoObject) drawRoute(location, firstGeoObject.geometry.getCoordinates());
                });
            }
        }
    } else {
        mapRef.current.map.setCenter(location, 15);
    }
  }, [activeOrder, location]);

  const drawRoute = (from, to) => {
      ymapsRef.current.route([from, to], { routingMode: 'driving' }).then(route => {
          routeRef.current = route;
          mapRef.current.map.geoObjects.add(route);
          mapRef.current.map.setBounds(route.properties.get('boundedBy'), { checkZoomRange: true, zoomMargin: 20 });
      });
  };

  const initMap = (centerCoords) => {
    const ymaps = window.ymaps;
    ymapsRef.current = ymaps;
    const map = new ymaps.Map("courier_map", { center: centerCoords, zoom: 15, controls: ['zoomControl'] });
    const placemark = new ymaps.Placemark(centerCoords, {}, { preset: 'islands#blueBicycleIcon' });
    map.geoObjects.add(placemark);
    mapRef.current = { map, courierPlacemark: placemark };
  };

  // --- 4. УВЕДОМЛЕНИЯ В ТЕЛЕГРАМ ЧЕРЕЗ НАШ API ---
  const notifyTelegram = async (order, type) => {
      try {
          const uData = typeof order.user_data === 'string' ? JSON.parse(order.user_data) : order.user_data;
          
          // Пуш клиенту
          let clientMsg = "";
          if (type === 'taken') clientMsg = `Мы нашли курьера! Он уже спешит в ресторан. 🏃‍♂️`;
          if (type === 'delivering') clientMsg = `Курьер забрал заказ и уже в пути! 🚴‍♂️💨`;
          if (type === 'arrived') clientMsg = `Курьер уже у ваших дверей! 📍`;
          
          if (uData?.id && clientMsg) {
              await fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: uData.id, message: `🛎 <b>Ваш заказ №${order.id}</b>\n${clientMsg}` }) });
          }

          // Пуш ресторану
          const { data: res } = await supabase.from('restaurants').select('admin_tg_id').eq('name', order.restaurant_name).single();
          const adminId = res?.admin_tg_id || 5340841151;
          
          let resMsg = "";
          if (type === 'taken') resMsg = `Курьер платформы принял заказ и едет к вам 🏃‍♂️`;
          if (type === 'delivering') resMsg = `Курьер забрал заказ и выехал к клиенту 🚴‍♂️`;
          if (type === 'completed') resMsg = `Заказ успешно доставлен курьером платформы! ✅`;

          if (resMsg) {
              await fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: adminId, message: `📦 <b>Заказ №${order.id}</b>\nСтатус: ${resMsg}` }) });
          }
      } catch(e) { console.error("Notify error", e) }
  }

  // --- 5. ДЕЙСТВИЯ ---
  const toggleStatus = async () => {
    const newStatus = !courier.is_active;
    await supabase.from('couriers').update({ is_active: newStatus }).eq('tg_id', courier.tg_id);
    setCourier({...courier, is_active: newStatus});
    fetchOrders(courier.tg_id, courier.city);
  };

  const takeOrder = async (order) => {
    setIsActionLoading(true);
    await supabase.from('orders').update({ courier_tg_id: courier.tg_id, status: 'taken' }).eq('id', order.id);
    await notifyTelegram(order, 'taken');
    await fetchOrders(courier.tg_id, courier.city);
    setIsActionLoading(false);
  };

  const updateOrderStatus = async (newStatus) => {
    if (!activeOrder) return;
    setIsActionLoading(true);
    await supabase.from('orders').update({ status: newStatus }).eq('id', activeOrder.id);
    await notifyTelegram(activeOrder, newStatus);
    await fetchOrders(courier.tg_id, courier.city);
    setIsActionLoading(false);
  };

  if (isAuthLoading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 font-black text-gray-400">Загрузка...</div>;
  if (!courier) return <div className="min-h-screen flex items-center justify-center bg-gray-50 font-black text-red-500 text-center p-6">Доступ запрещен.<br/>Вы не зарегистрированы.</div>;

  const isPaid = !courier.paid_until || new Date(courier.paid_until) > new Date();

  return (
    <main className="min-h-screen bg-gray-100 flex flex-col fixed inset-0">
      <Script src={`https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=ru_RU`} strategy="afterInteractive" onLoad={() => setIsMapLoaded(true)} />

      {/* ШАПКА */}
      <div className="bg-white p-4 shadow-sm z-20 flex justify-between items-center relative">
        <div>
          <h1 className="font-black text-xl text-blue-600 leading-none">LEKI PRO</h1>
          <p className="text-xs font-bold text-gray-400">{courier.name} • {courier.city}</p>
        </div>
        {isPaid ? (
            <button onClick={toggleStatus} className={`px-5 py-2 rounded-xl font-black text-sm transition-all shadow-md ${courier.is_active ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {courier.is_active ? '🟢 НА ЛИНИИ' : '🔴 ПЕРЕРЫВ'}
            </button>
        ) : <span className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-black">Оплатите доступ</span>}
      </div>

      {/* КОМПАКТНАЯ КАРТА СВЕРХУ (35% ЭКРАНА) */}
      <div className="h-[35vh] relative w-full border-b-4 border-gray-200 shadow-inner">
        <div id="courier_map" className="w-full h-full bg-gray-200">
            {!isMapLoaded && <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold">Загрузка карты...</div>}
        </div>
        {!location && isMapLoaded && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center font-black text-blue-600 animate-pulse">
                Поиск GPS...
            </div>
        )}
      </div>

      {/* ПАНЕЛЬ ЗАКАЗОВ СНИЗУ (ОСТАВШАЯСЯ ЧАСТЬ ЭКРАНА) */}
      <div className="flex-1 bg-gray-50 overflow-y-auto">
        {activeOrder ? (
            <div className="p-5 flex flex-col min-h-full bg-white">
                <div className="flex justify-between items-center mb-5 border-b border-gray-100 pb-4">
                    <span className="bg-blue-100 text-blue-700 font-black px-3 py-1.5 rounded-xl text-xs uppercase tracking-wide">Заказ #{activeOrder.id}</span>
                    <span className="font-black text-2xl text-gray-800">{activeOrder.total_price} ₽</span>
                </div>
                
                <div className="flex-1 space-y-4 mb-6">
                    <div className="relative pl-6 border-l-2 border-dashed border-gray-200 ml-3 space-y-6">
                        <div className="relative">
                            <div className="absolute -left-[31px] top-1 w-4 h-4 bg-gray-200 border-2 border-white rounded-full"></div>
                            <p className="text-[10px] font-black text-gray-400 uppercase">ЗАБРАТЬ ИЗ:</p>
                            <p className="font-black text-lg text-gray-800 leading-tight">{activeOrder.restaurant_name}</p>
                        </div>
                        <div className="relative">
                            <div className="absolute -left-[31px] top-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-sm"></div>
                            <p className="text-[10px] font-black text-blue-400 uppercase">ОТВЕЗТИ:</p>
                            <p className="font-black text-lg text-blue-900 leading-tight">{activeOrder.address}</p>
                            <a href={`tel:${activeOrder.phone}`} className="inline-block mt-2 bg-gray-100 text-gray-700 font-black px-4 py-2 rounded-xl text-sm active:scale-95">📞 Позвонить клиенту</a>
                        </div>
                    </div>
                </div>

                <div className="mt-auto">
                    {activeOrder.status === 'taken' && (
                        <button disabled={isActionLoading} onClick={() => updateOrderStatus('delivering')} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-transform disabled:opacity-50">🏃‍♂️ ЗАБРАЛ ЗАКАЗ</button>
                    )}
                    {activeOrder.status === 'delivering' && (
                        <button disabled={isActionLoading} onClick={() => updateOrderStatus('arrived')} className="w-full bg-orange-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-transform disabled:opacity-50">📍 Я НА АДРЕСЕ</button>
                    )}
                    {activeOrder.status === 'arrived' && (
                        <button disabled={isActionLoading} onClick={() => updateOrderStatus('completed')} className="w-full bg-green-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-transform disabled:opacity-50">🏁 ВРУЧИЛ КЛИЕНТУ</button>
                    )}
                </div>
            </div>
        ) : (
            <div className="p-4 h-full">
                {!courier.is_active ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6">
                        <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center text-3xl mb-4 opacity-50">☕</div>
                        <h3 className="font-black text-xl text-gray-800 mb-2">Смена закрыта</h3>
                        <p className="text-gray-500 font-medium text-sm">Выйдите на линию, чтобы радар начал искать для вас заказы.</p>
                    </div>
                ) : availableOrders.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                        <div className="relative w-16 h-16 mb-4">
                            <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20"></div>
                            <div className="absolute inset-2 bg-blue-500 rounded-full flex items-center justify-center shadow-lg"><span className="text-white text-xl">📡</span></div>
                        </div>
                        <h3 className="font-black text-lg text-gray-800">Радар включен</h3>
                        <p className="text-gray-400 font-medium text-sm">Ожидаем новые заказы...</p>
                    </div>
                ) : (
                    <div className="space-y-3 pb-6">
                        <h2 className="font-black text-lg px-1 text-gray-800">Доступные заказы ({availableOrders.length})</h2>
                        {availableOrders.map(order => {
                             let itemsTotal = 0;
                             try {
                                 const itemsArr = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                                 itemsTotal = itemsArr.reduce((sum, item) => sum + (item.price * item.count), 0);
                             } catch(e) {}
                             const deliveryFee = order.total_price - itemsTotal;

                             return (
                                <div key={order.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 relative overflow-hidden">
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Ресторан</span>
                                            <span className="font-black text-lg leading-none text-gray-800">{order.restaurant_name}</span>
                                        </div>
                                        <div className="text-right bg-blue-50 p-2 rounded-xl">
                                            <span className="font-black text-blue-600 block text-lg leading-none">{deliveryFee} ₽</span>
                                            <span className="text-[9px] text-blue-400 font-black uppercase">Ваша доля</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 mb-4 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                        <span className="text-xl">📍</span>
                                        <div>
                                            <span className="text-[10px] font-black text-gray-400 uppercase block leading-none mb-1">Куда везти</span>
                                            <span className="text-xs font-bold text-gray-600 truncate block">Точный адрес после принятия</span>
                                        </div>
                                    </div>
                                    <button disabled={isActionLoading} onClick={() => takeOrder(order)} className="w-full bg-gray-900 text-white py-3.5 rounded-xl font-black text-sm active:scale-95 transition-all shadow-md hover:bg-black disabled:opacity-50">
                                        ВЗЯТЬ ЗАКАЗ
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )}
      </div>
    </main>
  )
}