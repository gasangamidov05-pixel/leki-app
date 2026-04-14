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

  // 1. Авторизация курьера
  useEffect(() => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    
    // ДЛЯ ТЕСТОВ В БРАУЗЕРЕ (раскомментируй строку ниже и впиши свой ID из бота)
    // const tgUser = { id: 5340841151 }; 

    async function authCourier() {
      if (!tgUser?.id) {
        setIsAuthLoading(false);
        return;
      }
      
      const { data } = await supabase.from('couriers').select('*').eq('tg_id', tgUser.id).single();
      if (data) {
        setCourier(data);
        fetchOrders(data.tg_id, data.city);
      }
      setIsAuthLoading(false);
    }
    
    authCourier();
  }, []);

  // 2. Подписка на обновления базы (Realtime)
  useEffect(() => {
    if (!courier) return;

    const channel = supabase.channel('courier_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
        fetchOrders(courier.tg_id, courier.city);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'couriers', filter: `tg_id=eq.${courier.tg_id}` }, payload => {
        setCourier(payload.new);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel) };
  }, [courier]);

  // Загрузка заказов
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
        .select('*, restaurants!inner(city, name, lat, lon)')
        .eq('status', 'accepted')
        .is('courier_tg_id', null)
        .eq('restaurants.city', city);
        
      setAvailableOrders(available || []);
    } else {
      setAvailableOrders([]);
    }
  };

  // 3. GPS Трекинг и Карта
  useEffect(() => {
    if (!courier || !isMapLoaded) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        setLocation(coords);
        
        if (!mapRef.current) {
          initMap(coords);
        } else {
          mapRef.current.courierPlacemark.geometry.setCoordinates(coords);
          if (!activeOrder) {
             mapRef.current.map.setCenter(coords);
          }
        }
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [courier, isMapLoaded]);

  // Построение маршрута
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
    }
  }, [activeOrder, location]);

  const drawRoute = (from, to) => {
      ymapsRef.current.route([from, to], { routingMode: 'driving' }).then(route => {
          routeRef.current = route;
          mapRef.current.map.geoObjects.add(route);
          const bounds = route.properties.get('boundedBy');
          mapRef.current.map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 30 });
      });
  };

  const initMap = (centerCoords) => {
    const ymaps = window.ymaps;
    ymapsRef.current = ymaps;
    const map = new ymaps.Map("courier_map", { center: centerCoords, zoom: 16, controls: ['zoomControl'] });
    const placemark = new ymaps.Placemark(centerCoords, {}, { preset: 'islands#blueBicycleIcon' });
    map.geoObjects.add(placemark);
    mapRef.current = { map, courierPlacemark: placemark };
  };

  // 4. Действия с заказами
  const toggleStatus = async () => {
    await supabase.from('couriers').update({ is_active: !courier.is_active }).eq('tg_id', courier.tg_id);
  };

  const takeOrder = async (orderId) => {
    await supabase.from('orders').update({ courier_tg_id: courier.tg_id, status: 'taken' }).eq('id', orderId);
  };

  const updateOrderStatus = async (newStatus) => {
    if (!activeOrder) return;
    await supabase.from('orders').update({ status: newStatus }).eq('id', activeOrder.id);
  };

  if (isAuthLoading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 font-black text-gray-400">Загрузка...</div>;
  if (!courier) return <div className="min-h-screen flex items-center justify-center bg-gray-50 font-black text-red-500 text-center p-6">Доступ запрещен.<br/>Вы не зарегистрированы как курьер.</div>;

  const isPaid = !courier.paid_until || new Date(courier.paid_until) > new Date();

  return (
    <main className="min-h-screen bg-gray-100 flex flex-col fixed inset-0">
      <Script src={`https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=ru_RU`} strategy="afterInteractive" onLoad={() => setIsMapLoaded(true)} />

      {/* ШАПКА */}
      <div className="bg-white p-4 shadow-sm z-10 flex justify-between items-center">
        <div>
          <h1 className="font-black text-xl text-blue-600 leading-none">LEKI COURIER</h1>
          <p className="text-xs font-bold text-gray-400">{courier.name} • {courier.city}</p>
        </div>
        
        {isPaid ? (
            <button 
                onClick={toggleStatus} 
                className={`px-4 py-2 rounded-xl font-black text-sm transition-all shadow-sm ${courier.is_active ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}
            >
                {courier.is_active ? '🟢 НА ЛИНИИ' : '🔴 ПЕРЕРЫВ'}
            </button>
        ) : (
            <span className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-black">Подписка истекла</span>
        )}
      </div>

      {/* КАРТА */}
      <div className="flex-1 relative">
        <div id="courier_map" className="w-full h-full bg-gray-200">
            {!isMapLoaded && <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold">Загрузка карты...</div>}
        </div>
        {!location && isMapLoaded && (
            <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center font-black text-blue-600 animate-pulse">
                Поиск GPS сигнала...
            </div>
        )}
      </div>

      {/* ПАНЕЛЬ ЗАКАЗОВ */}
      <div className="bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-20 flex flex-col" style={{ height: '40vh' }}>
        
        {activeOrder ? (
            <div className="p-6 flex flex-col h-full">
                <div className="flex justify-between items-start mb-4">
                    <span className="bg-blue-100 text-blue-600 font-black px-3 py-1 rounded-lg text-xs uppercase">Текущий заказ #{activeOrder.id}</span>
                    <span className="font-black text-lg">{activeOrder.total_price} ₽</span>
                </div>
                
                <div className="flex-1 overflow-y-auto mb-4 space-y-2">
                    <p className="text-sm font-bold text-gray-500">Забрать:</p>
                    <p className="font-black bg-gray-50 p-3 rounded-xl mb-2">{activeOrder.restaurant_name}</p>
                    <p className="text-sm font-bold text-gray-500">Отвезти:</p>
                    <p className="font-black bg-gray-50 p-3 rounded-xl">{activeOrder.address}</p>
                    <p className="text-sm font-bold text-blue-500 mt-2">📞 {activeOrder.phone}</p>
                </div>

                {activeOrder.status === 'taken' && (
                    <button onClick={() => updateOrderStatus('delivering')} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg active:scale-95 shadow-lg">🏃‍♂️ ЗАБРАЛ ЗАКАЗ</button>
                )}
                {activeOrder.status === 'delivering' && (
                    <button onClick={() => updateOrderStatus('arrived')} className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-lg active:scale-95 shadow-lg">📍 Я НА АДРЕСЕ</button>
                )}
                {activeOrder.status === 'arrived' && (
                    <button onClick={() => updateOrderStatus('completed')} className="w-full bg-green-500 text-white py-4 rounded-2xl font-black text-lg active:scale-95 shadow-lg">🏁 ВРУЧИЛ КЛИЕНТУ</button>
                )}
            </div>
        ) : (
            <div className="p-6 flex flex-col h-full">
                <h2 className="font-black text-xl mb-4">Доступные заказы</h2>
                {!courier.is_active ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <span className="text-5xl mb-2">☕</span>
                        <p className="text-gray-400 font-bold">Вы на перерыве.<br/>Выйдите на линию, чтобы получать заказы.</p>
                    </div>
                ) : availableOrders.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                        <p className="text-gray-400 font-bold">Ждем новые заказы...</p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto space-y-3">
                        {availableOrders.map(order => {
                             // Вычисляем долю курьера (разницу между total_price и стоимостью блюд)
                             let itemsTotal = 0;
                             try {
                                 const itemsArr = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                                 itemsTotal = itemsArr.reduce((sum, item) => sum + (item.price * item.count), 0);
                             } catch(e) {}
                             const deliveryFee = order.total_price - itemsTotal;

                             return (
                                <div key={order.id} className="border-2 border-gray-100 rounded-2xl p-4 flex flex-col">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="font-black text-lg">{order.restaurant_name}</span>
                                        <div className="text-right">
                                            <span className="font-black text-blue-600 block">{deliveryFee} ₽</span>
                                            <span className="text-[10px] text-gray-400 font-bold uppercase">Ваша доля</span>
                                        </div>
                                    </div>
                                    <span className="text-xs font-bold text-gray-400 bg-gray-50 p-2 rounded-lg truncate mb-3">📍 Скрыто до принятия</span>
                                    <button onClick={() => takeOrder(order.id)} className="w-full bg-blue-600 text-white py-3 rounded-xl font-black text-sm active:scale-95">🛵 ПРИНЯТЬ ЗАКАЗ</button>
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