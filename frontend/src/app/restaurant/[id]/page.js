'use client'

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Script from 'next/script'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const YANDEX_API_KEY = "b9336a86-41c5-4a5a-a3b1-9a1ef4057197"; 

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function RestaurantMenu() {
  const params = useParams()
  const mapRef = useRef(null);
  const ymapsRef = useRef(null);
  
  const [restaurant, setRestaurant] = useState(null)
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState({})
  
  // КАТЕГОРИИ И ИСТОРИЯ
  const [activeCategory, setActiveCategory] = useState('Все')
  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [myOrders, setMyOrders] = useState([])

  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [apartment, setApartment] = useState('')
  const [entrance, setEntrance] = useState('')

  // НОВОЕ: ЧЕК И ЗАГРУЗКА
  const [receiptFile, setReceiptFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)

  const [deliveryPrice, setDeliveryPrice] = useState(150)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isAddressValid, setIsAddressValid] = useState(false)
  const [isMapApiLoaded, setIsMapApiLoaded] = useState(false)

  // Загрузка данных
  useEffect(() => {
    async function fetchData() {
      const { data: res } = await supabase.from('restaurants').select('*').eq('id', params.id).single()
      setRestaurant(res)
      const { data: prod } = await supabase.from('products').select('*').eq('restaurant_id', params.id).order('id')
      setProducts(prod || [])
    }
    fetchData()
  }, [params.id]);

  // РАДАР СТАТУСОВ ДЛЯ ИСТОРИИ ЗАКАЗОВ
  useEffect(() => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    const channel = supabase
      .channel('public:orders')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        const updatedOrder = payload.new;
        const uData = typeof updatedOrder.user_data === 'string' ? JSON.parse(updatedOrder.user_data) : updatedOrder.user_data;
        
        if ((tgUser && uData?.id === tgUser.id) || !tgUser) {
          setMyOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
          let statusText = "обновлен 🔄";
          if (updatedOrder.status === 'accepted') statusText = "принят и начал готовиться! 🔥";
          if (updatedOrder.status === 'cancelled') statusText = "отменен заведением ❌";
          if (window.Telegram?.WebApp?.initData) {
            window.Telegram.WebApp.showPopup({ title: `Заказ #${updatedOrder.id}`, message: `Статус: ${statusText}`, buttons: [{ type: "ok" }] });
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel) };
  }, []);

  // Карта Яндекса
  useEffect(() => {
    if (isCheckoutOpen && isMapApiLoaded && !mapRef.current) initMap();
    if (!isCheckoutOpen && mapRef.current) {
      mapRef.current.map.destroy();
      mapRef.current = null;
    }
  }, [isCheckoutOpen, isMapApiLoaded]);

  const initMap = () => {
    const ymaps = window.ymaps;
    if (!ymaps) return;
    ymaps.ready(() => {
      ymapsRef.current = ymaps;
      const suggestView = new ymaps.SuggestView('suggest_address');
      suggestView.events.add('select', (e) => {
        const selectedAddress = e.get('item').value;
        setAddress(selectedAddress);
        geocodeAddress(selectedAddress);
      });

      const map = new ymaps.Map("map_container", {
        center: [restaurant?.lat || 42.98, restaurant?.lon || 47.50],
        zoom: 15,
        controls: ['zoomControl']
      });

      const placemark = new ymaps.Placemark(map.getCenter(), {}, { preset: 'islands#blueFoodIcon', draggable: true });
      map.geoObjects.add(placemark);

      placemark.events.add('dragend', () => reverseGeocode(placemark.geometry.getCoordinates()));
      map.events.add('click', (e) => {
        const coords = e.get('coords');
        placemark.geometry.setCoordinates(coords);
        reverseGeocode(coords);
      });

      mapRef.current = { map, placemark };
    });
  };

  const geocodeAddress = (addr) => {
    setIsCalculating(true);
    ymapsRef.current.geocode(addr).then((res) => {
      const firstGeoObject = res.geoObjects.get(0);
      if (firstGeoObject) {
        const coords = firstGeoObject.geometry.getCoordinates();
        mapRef.current.map.setCenter(coords, 16);
        mapRef.current.placemark.geometry.setCoordinates(coords);
        updateDeliveryPrice(coords);
      }
    });
  };

  const reverseGeocode = (coords) => {
    setIsCalculating(true);
    ymapsRef.current.geocode(coords).then((res) => {
      const firstGeoObject = res.geoObjects.get(0);
      if (firstGeoObject) {
        setAddress(firstGeoObject.getAddressLine());
        updateDeliveryPrice(coords);
      }
    });
  };

  const updateDeliveryPrice = (coords) => {
    if (restaurant?.lat && restaurant?.lon) {
      const distance = getDistanceFromLatLonInKm(restaurant.lat, restaurant.lon, coords[0], coords[1]);
      setDeliveryPrice(Math.round(150 + (distance * 22)));
      setIsAddressValid(true);
    }
    setIsCalculating(false);
  };

  const getLocation = () => {
    setIsCalculating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        if (mapRef.current) {
          mapRef.current.map.setCenter(coords, 17);
          mapRef.current.placemark.geometry.setCoordinates(coords);
        }
        reverseGeocode(coords);
      },
      () => { alert("Включите GPS в настройках телефона!"); setIsCalculating(false); }
    );
  };

  const handlePhoneInput = (e) => {
    let input = e.target.value.replace(/\D/g, '').substring(0, 11);
    if (!input) { setPhone(''); return; }
    if (input[0] === '9') input = '7' + input;
    let formatted = input[0] === '8' ? '8' : '+7';
    if (input.length > 1) formatted += ' (' + input.substring(1, 4);
    if (input.length >= 5) formatted += ') ' + input.substring(4, 7);
    if (input.length >= 8) formatted += '-' + input.substring(7, 9);
    if (input.length >= 10) formatted += '-' + input.substring(9, 11);
    setPhone(formatted);
  };

  // ОБНОВЛЕННАЯ ФУНКЦИЯ ОТПРАВКИ (С ФОТО ЧЕКА)
  const sendOrder = async () => {
    if (!receiptFile) return alert("Пожалуйста, прикрепите чек об оплате!");

    setIsUploading(true);
    try {
      // 1. Грузим чек в Storage
      const fileExt = receiptFile.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(fileName, receiptFile);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('receipts')
        .getPublicUrl(fileName);

      // 2. Формируем адрес
      let fullAddressStr = address;
      if (apartment.trim()) fullAddressStr += `, кв/офис: ${apartment.trim()}`;
      if (entrance.trim()) fullAddressStr += `, подъезд: ${entrance.trim()}`;
      fullAddressStr += `\n🚚 Доставка: ${deliveryPrice} ₽`;

      // 3. Сохраняем заказ в БД
      const orderData = {
        restaurant_name: restaurant?.name,
        items: filteredProducts.filter(p => cart[p.id] > 0).map(p => ({ name: p.name, count: cart[p.id], price: p.price })),
        total_price: totalSum + deliveryPrice,
        status: 'new',
        user_data: window.Telegram?.WebApp?.initDataUnsafe?.user || { first_name: 'Web User' },
        phone,
        address: fullAddressStr,
        receipt_url: publicUrl // Ссылка на фото чека
      };

      await supabase.from('orders').insert([orderData]);
      window.Telegram?.WebApp?.close();
    } catch (err) {
      alert("Ошибка при отправке: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // ФУНКЦИИ ИСТОРИИ ЗАКАЗОВ
  const openMyOrders = async () => {
    setIsOrdersOpen(true);
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    try {
      const { data } = await supabase.from('orders').select('*').order('id', { ascending: false }).limit(20);
      setMyOrders(data.filter(o => {
        if (!tgUser?.id) return true;
        const uData = typeof o.user_data === 'string' ? JSON.parse(o.user_data) : o.user_data;
        return uData?.id === tgUser.id;
      }).slice(0, 5));
    } catch (err) {}
  };

  const getStatusBadge = (status) => {
    if (status === 'new') return <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-xl text-xs font-black uppercase">🕒 Ожидает</span>;
    if (status === 'processing' || status === 'accepted') return <span className="bg-green-100 text-green-700 px-3 py-1 rounded-xl text-xs font-black uppercase">🔥 Готовится</span>;
    if (status === 'cancelled') return <span className="bg-red-100 text-red-700 px-3 py-1 rounded-xl text-xs font-black uppercase">❌ Отменен</span>;
    return <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-xl text-xs font-black uppercase">{status}</span>;
  };

  const categories = ['Все', ...new Set(products.map(p => p.category || 'Основное'))]
  const filteredProducts = activeCategory === 'Все' ? products : products.filter(p => (p.category || 'Основное') === activeCategory)
  const totalSum = products.reduce((sum, item) => sum + (item.price * (cart[item.id] || 0)), 0);

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-black pb-32">
      <Script src={`https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=ru_RU`} strategy="afterInteractive" onLoad={() => setIsMapApiLoaded(true)} />

      <div className="max-w-md mx-auto">
        {/* ШАПКА И КНОПКА ИСТОРИИ */}
        <div className="flex justify-between items-center mb-6">
          <Link href="/" className="text-blue-500 font-bold">← Назад</Link>
          <button onClick={openMyOrders} className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-all">
            📜 Мои заказы
          </button>
        </div>

        <h1 className="text-3xl font-black mb-4">{restaurant?.name || 'Загрузка...'}</h1>

        {/* КАТЕГОРИИ */}
        <div className="flex overflow-x-auto gap-2 mb-6 pb-2" style={{ scrollbarWidth: 'none' }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-5 py-2.5 rounded-xl whitespace-nowrap font-bold transition-all ${activeCategory === cat ? 'bg-blue-600 text-white shadow-md' : 'bg-white border-2 border-gray-100 text-gray-600'}`}>{cat}</button>
          ))}
        </div>

        {/* СПИСОК ТОВАРОВ */}
        <div className="grid gap-3">
          {filteredProducts.map((item) => (
            <div key={item.id} className={`bg-white p-3 rounded-2xl shadow-sm border-2 border-transparent flex items-center gap-4 ${item.is_active === false && 'opacity-50 grayscale'}`}>
              <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                <img src={item.image_url || 'https://via.placeholder.com/150'} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-md leading-tight mb-1">{item.name}</h3>
                <p className="text-blue-600 font-black">{item.price} ₽</p>
              </div>
              <div className="flex items-center gap-2">
                {item.is_active !== false ? (
                  <>
                    {cart[item.id] > 0 && <button onClick={() => {const c={...cart}; c[item.id]--; setCart(c)}} className="bg-gray-100 text-gray-600 w-9 h-9 rounded-xl font-bold">-</button>}
                    {cart[item.id] > 0 && <span className="font-bold w-4 text-center">{cart[item.id]}</span>}
                    <button onClick={() => setCart({...cart, [item.id]: (cart[item.id]||0)+1})} className="bg-blue-500 text-white w-9 h-9 rounded-xl font-bold shadow-sm">+</button>
                  </>
                ) : <span className="text-xs text-red-500 font-bold bg-red-50 px-2 py-1 rounded-lg">Стоп</span>}
              </div>
            </div>
          ))}
        </div>

        {/* КНОПКА КОРЗИНЫ */}
        {totalSum > 0 && !isCartOpen && !isCheckoutOpen && !isOrdersOpen && (
          <div className="fixed bottom-6 left-0 right-0 px-4 z-40">
            <button onClick={() => setIsCartOpen(true)} className="max-w-md mx-auto w-full bg-blue-600 text-white py-4 rounded-2xl font-black flex justify-between px-8 shadow-2xl active:scale-95 transition-all">
              <span>🛒 Корзина</span><span>{totalSum} ₽</span>
            </button>
          </div>
        )}

        {/* МОДАЛКА КОРЗИНЫ */}
        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-8 w-full max-w-md mx-auto animate-slide-up">
              <div className="flex justify-between items-center mb-6">
                 <h2 className="text-2xl font-black">Ваш заказ</h2>
                 <button onClick={() => setIsCartOpen(false)} className="bg-gray-100 w-10 h-10 rounded-full font-bold text-gray-500">✕</button>
              </div>
              <div className="space-y-4 mb-8 max-h-[40vh] overflow-y-auto">
                {products.filter(p => cart[p.id] > 0).map(p => (
                  <div key={p.id} className="flex justify-between items-center border-b border-gray-50 pb-3">
                    <span className="font-bold">{p.name} <span className="text-gray-400 text-sm ml-1">x{cart[p.id]}</span></span>
                    <span className="font-black text-blue-600">{p.price * cart[p.id]} ₽</span>
                  </div>
                ))}
              </div>
              <button onClick={() => {setIsCartOpen(false); setIsCheckoutOpen(true)}} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">
                К оформлению
              </button>
            </div>
          </div>
        )}

        {/* МОДАЛКА ОФОРМЛЕНИЯ */}
        {isCheckoutOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-6 w-full max-w-md mx-auto animate-slide-up pb-10 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black">Доставка</h2>
                <button onClick={() => setIsCheckoutOpen(false)} className="bg-gray-100 w-10 h-10 rounded-full font-bold text-gray-500">✕</button>
              </div>

              <div className="space-y-4">
                <input type="tel" value={phone} onChange={handlePhoneInput} placeholder="+7 (999) 000-00-00" className="w-full border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-bold"/>
                
                <div className="relative">
                  <input id="suggest_address" type="text" value={address} onChange={(e) => {setAddress(e.target.value); setIsAddressValid(false)}} placeholder="Введите адрес..." className="w-full border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-medium pr-16 text-sm"/>
                  <button onClick={getLocation} className="absolute right-2 top-2 bottom-2 bg-blue-50 text-blue-600 font-bold px-3 rounded-xl text-sm border border-blue-100">📍 GPS</button>
                </div>