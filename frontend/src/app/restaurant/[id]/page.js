'use client'

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Script from 'next/script'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// !!! ТВОЙ КЛЮЧ ЯНДЕКСА !!!
const YANDEX_API_KEY = "b9336a86-41c5-4a5a-a3b1-9a1ef4057197"; 

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function RestaurantMenu() {
  const params = useParams()
  const mapRef = useRef(null);
  const ymapsRef = useRef(null);
  const [restaurant, setRestaurant] = useState(null)
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState({})
  
  const [activeCategory, setActiveCategory] = useState('Все')
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [deliveryPrice, setDeliveryPrice] = useState(150)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isAddressValid, setIsAddressValid] = useState(false)

  // Загрузка данных ресторана и меню
  useEffect(() => {
    async function fetchData() {
      const { data: res } = await supabase.from('restaurants').select('*').eq('id', params.id).single()
      setRestaurant(res)
      const { data: prod } = await supabase.from('products').select('*').eq('restaurant_id', params.id).order('id')
      setProducts(prod || [])
    }
    fetchData()
  }, [params.id]);

  // Инициализация Яндекс Карт
  const initMap = () => {
    const ymaps = window.ymaps;
    ymapsRef.current = ymaps;

    ymaps.ready(() => {
      // 1. Создаем подсказки для поля ввода
      const suggestView = new ymaps.SuggestView('suggest_address');
      
      suggestView.events.add('select', (e) => {
        const selectedAddress = e.get('item').value;
        setAddress(selectedAddress);
        geocodeAddress(selectedAddress);
      });

      // 2. Создаем карту (по умолчанию в центре ресторана или города)
      const map = new ymaps.Map("map_container", {
        center: [restaurant?.lat || 42.98, restaurant?.lon || 47.50],
        zoom: 15,
        controls: ['zoomControl']
      });

      // 3. Создаем перетаскиваемую метку
      const placemark = new ymaps.Placemark(map.getCenter(), {}, {
        preset: 'islands#blueFoodIcon',
        draggable: true
      });

      map.geoObjects.add(placemark);

      // При движении метки вручную
      placemark.events.add('dragend', () => {
        const coords = placemark.geometry.getCoordinates();
        reverseGeocode(coords);
      });

      // При клике на карту - переставляем метку
      map.events.add('click', (e) => {
        const coords = e.get('coords');
        placemark.geometry.setCoordinates(coords);
        reverseGeocode(coords);
      });

      mapRef.current = { map, placemark };
    });
  };

  // Перевод адреса в координаты (когда выбрали из подсказок)
  const geocodeAddress = (addr) => {
    setIsCalculating(true);
    ymapsRef.current.geocode(addr).then((res) => {
      const firstGeoObject = res.geoObjects.get(0);
      const coords = firstGeoObject.geometry.getCoordinates();
      
      mapRef.current.map.setCenter(coords, 15);
      mapRef.current.placemark.geometry.setCoordinates(coords);
      
      updateDeliveryPrice(coords);
    });
  };

  // Перевод координат в адрес (когда двигаем метку пальцем)
  const reverseGeocode = (coords) => {
    setIsCalculating(true);
    ymapsRef.current.geocode(coords).then((res) => {
      const firstGeoObject = res.geoObjects.get(0);
      const addr = firstGeoObject.getAddressLine();
      setAddress(addr);
      updateDeliveryPrice(coords);
    });
  };

  const updateDeliveryPrice = (coords) => {
    if (restaurant?.lat) {
      const distance = getDistanceFromLatLonInKm(restaurant.lat, restaurant.lon, coords[0], coords[1]);
      setDeliveryPrice(Math.round(150 + (distance * 22)));
      setIsAddressValid(true);
    }
    setIsCalculating(false);
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

  const sendOrder = async () => {
    const orderData = {
      restaurant_name: restaurant?.name,
      items: products.filter(p => cart[p.id] > 0).map(p => ({ name: p.name, count: cart[p.id], price: p.price })),
      total_price: totalSum + deliveryPrice,
      status: 'new',
      user_data: window.Telegram?.WebApp?.initDataUnsafe?.user || { first_name: 'Web User' },
      phone,
      address: address + `\n🚚 Доставка: ${deliveryPrice} ₽`
    };
    await supabase.from('orders').insert([orderData]);
    window.Telegram?.WebApp?.close();
  };

  const totalSum = products.reduce((sum, item) => sum + (item.price * (cart[item.id] || 0)), 0);

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-black pb-32">
      {/* Загружаем API Яндекса только когда открыто оформление */}
      <Script 
        src={`https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=ru_RU`} 
        onLoad={isCheckoutOpen ? initMap : null}
      />

      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-center mb-6">
          <Link href="/" className="text-blue-500 font-bold">← Назад</Link>
          <h1 className="text-2xl font-black">{restaurant?.name || 'Загрузка...'}</h1>
        </div>

        {/* Список товаров */}
        <div className="grid gap-3">
          {products.map((item) => (
            <div key={item.id} className="bg-white p-3 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                <img src={item.image_url} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm">{item.name}</h3>
                <p className="text-blue-600 font-black">{item.price} ₽</p>
              </div>
              <div className="flex items-center gap-2">
                {cart[item.id] > 0 && <button onClick={() => {const c={...cart}; c[item.id]--; setCart(c)}} className="bg-gray-100 w-8 h-8 rounded-lg">-</button>}
                {cart[item.id] > 0 && <span className="font-bold">{cart[item.id]}</span>}
                <button onClick={() => setCart({...cart, [item.id]: (cart[item.id]||0)+1})} className="bg-blue-500 text-white w-8 h-8 rounded-lg">+</button>
              </div>
            </div>
          ))}
        </div>

        {totalSum > 0 && (
          <div className="fixed bottom-6 left-0 right-0 px-4">
            <button onClick={() => setIsCartOpen(true)} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold flex justify-between px-8 shadow-xl">
              <span>🛒 Корзина</span><span>{totalSum} ₽</span>
            </button>
          </div>
        )}

        {/* Модалка оформления */}
        {isCheckoutOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-6 w-full animate-slide-up pb-10 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black">Доставка</h2>
                <button onClick={() => setIsCheckoutOpen(false)} className="text-gray-400">✕</button>
              </div>

              <div className="space-y-4">
                <input type="tel" value={phone} onChange={handlePhoneInput} placeholder="+7 (999) 000-00-00" className="w-full border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-bold"/>
                
                <input 
                  id="suggest_address"
                  type="text" 
                  value={address} 
                  onChange={(e) => {setAddress(e.target.value); setIsAddressValid(false)}}
                  placeholder="Введите адрес..." 
                  className="w-full border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-medium"
                />

                {/* КОНТЕЙНЕР ДЛЯ КАРТЫ */}
                <div className="relative w-full h-64 rounded-3xl overflow-hidden border-2 border-gray-100">
                  <div id="map_container" className="w-full h-full bg-gray-50"></div>
                  <div className="absolute top-2 left-2 bg-white/80 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold text-gray-500">
                    Нажмите на карту или двигайте метку
                  </div>
                </div>

                <div className="bg-blue-50 p-5 rounded-3xl space-y-2">
                  <div className="flex justify-between text-sm font-bold text-blue-800">
                    <span>Доставка {isCalculating && '...'}:</span>
                    <span>{isAddressValid ? deliveryPrice : '--'} ₽</span>
                  </div>
                  <div className="flex justify-between font-black text-xl pt-2 border-t border-blue-100 text-blue-900">
                    <span>Итого:</span>
                    <span>{isAddressValid ? totalSum + deliveryPrice : totalSum} ₽</span>
                  </div>
                </div>

                <button 
                  onClick={sendOrder} 
                  disabled={!isAddressValid || phone.length < 18} 
                  className={`w-full py-5 rounded-2xl font-black text-xl shadow-lg transition-all ${isAddressValid && phone.length >= 18 ? 'bg-green-500 text-white active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                  {isCalculating ? 'СЧИТАЕМ...' : 'ПОДТВЕРДИТЬ'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Простая корзина */}
        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-8 w-full">
              <h2 className="text-2xl font-black mb-6">Ваш заказ</h2>
              <div className="space-y-4 mb-8">
                {products.filter(p => cart[p.id] > 0).map(p => (
                  <div key={p.id} className="flex justify-between font-bold">
                    <span>{p.name} x {cart[p.id]}</span>
                    <span>{p.price * cart[p.id]} ₽</span>
                  </div>
                ))}
              </div>
              <button onClick={() => {setIsCartOpen(false); setIsCheckoutOpen(true)}} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl">
                Перейти к оформлению
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}