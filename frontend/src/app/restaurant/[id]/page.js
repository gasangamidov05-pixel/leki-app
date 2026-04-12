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
  
  const [isMapApiLoaded, setIsMapApiLoaded] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const { data: res } = await supabase.from('restaurants').select('*').eq('id', params.id).single()
      setRestaurant(res)
      const { data: prod } = await supabase.from('products').select('*').eq('restaurant_id', params.id).order('id')
      setProducts(prod || [])
    }
    fetchData()
  }, [params.id]);

  // Следим за открытием модалки и загрузкой скрипта, чтобы создать карту
  useEffect(() => {
    if (isCheckoutOpen && isMapApiLoaded && !mapRef.current) {
      initMap();
    }
    // Если закрыли модалку - уничтожаем карту, чтобы потом создать заново без багов
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

      // Подсказки адресов
      const suggestView = new ymaps.SuggestView('suggest_address');
      suggestView.events.add('select', (e) => {
        const selectedAddress = e.get('item').value;
        setAddress(selectedAddress);
        geocodeAddress(selectedAddress);
      });

      // Создаем карту
      const map = new ymaps.Map("map_container", {
        center: [restaurant?.lat || 42.98, restaurant?.lon || 47.50],
        zoom: 15,
        controls: ['zoomControl']
      });

      // Создаем метку
      const placemark = new ymaps.Placemark(map.getCenter(), {}, {
        preset: 'islands#blueFoodIcon',
        draggable: true
      });

      map.geoObjects.add(placemark);

      // Движение метки
      placemark.events.add('dragend', () => {
        reverseGeocode(placemark.geometry.getCoordinates());
      });

      // Клик по карте
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
        const addr = firstGeoObject.getAddressLine();
        setAddress(addr);
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

  // ВЕРНУЛИ ФУНКЦИЮ GPS
  const getLocation = () => {
    setIsCalculating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        
        // Передвигаем карту к пользователю
        if (mapRef.current) {
          mapRef.current.map.setCenter(coords, 17);
          mapRef.current.placemark.geometry.setCoordinates(coords);
        }
        
        // Превращаем координаты в текстовый адрес
        reverseGeocode(coords);
      },
      () => {
        alert("Включите GPS в настройках телефона!");
        setIsCalculating(false);
      }
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
      {/* Загружаем API Яндекса сразу в фоне */}
      <Script 
        src={`https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=ru_RU`} 
        strategy="afterInteractive"
        onLoad={() => setIsMapApiLoaded(true)}
      />

      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-center mb-6">
          <Link href="/" className="text-blue-500 font-bold">← Назад</Link>
          <h1 className="text-2xl font-black">{restaurant?.name || 'Загрузка...'}</h1>
        </div>

        <div className="grid gap-3">
          {products.map((item) => (
            <div key={item.id} className={`bg-white p-3 rounded-2xl shadow-sm flex items-center gap-4 ${item.is_active === false && 'opacity-50 grayscale'}`}>
              <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                <img src={item.image_url || 'https://via.placeholder.com/150'} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm">{item.name}</h3>
                <p className="text-blue-600 font-black">{item.price} ₽</p>
              </div>
              <div className="flex items-center gap-2">
                {item.is_active !== false ? (
                  <>
                    {cart[item.id] > 0 && <button onClick={() => {const c={...cart}; c[item.id]--; setCart(c)}} className="bg-gray-100 w-8 h-8 rounded-lg">-</button>}
                    {cart[item.id] > 0 && <span className="font-bold">{cart[item.id]}</span>}
                    <button onClick={() => setCart({...cart, [item.id]: (cart[item.id]||0)+1})} className="bg-blue-500 text-white w-8 h-8 rounded-lg">+</button>
                  </>
                ) : <span className="text-xs text-red-500 font-bold">Стоп</span>}
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

        {isCheckoutOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-6 w-full animate-slide-up pb-10 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black">Доставка</h2>
                <button onClick={() => setIsCheckoutOpen(false)} className="text-gray-400 font-bold text-xl">✕</button>
              </div>

              <div className="space-y-4">
                <input type="tel" value={phone} onChange={handlePhoneInput} placeholder="+7 (999) 000-00-00" className="w-full border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-bold"/>
                
                <div className="relative">
                  <input 
                    id="suggest_address"
                    type="text" 
                    value={address} 
                    onChange={(e) => {setAddress(e.target.value); setIsAddressValid(false)}}
                    placeholder="Введите адрес..." 
                    className="w-full border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-medium pr-16"
                  />
                  {/* КНОПКА GPS ВЕРНУЛАСЬ СЮДА */}
                  <button onClick={getLocation} className="absolute right-2 top-2 bottom-2 bg-blue-50 text-blue-600 font-bold px-3 rounded-xl text-sm border border-blue-100">
                    📍 GPS
                  </button>
                </div>

                <div className="relative w-full h-64 rounded-3xl overflow-hidden border-2 border-gray-100">
                  <div id="map_container" className="w-full h-full bg-gray-200 flex items-center justify-center">
                    {!isMapApiLoaded && <span className="text-gray-400 font-bold">Загрузка карты...</span>}
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
  disabled={!isAddressValid || phone.replace(/\D/g, '').length !== 11} 
  className={`w-full py-5 rounded-2xl font-black text-xl shadow-lg transition-all ${isAddressValid && phone.replace(/\D/g, '').length === 11 ? 'bg-green-500 text-white active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
>
  {isCalculating ? 'СЧИТАЕМ...' : 'ПОДТВЕРДИТЬ'}
</button>
              </div>
            </div>
          </div>
        )}

        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-8 w-full">
              <div className="flex justify-between items-center mb-6">
                 <h2 className="text-2xl font-black">Ваш заказ</h2>
                 <button onClick={() => setIsCartOpen(false)} className="text-gray-400 font-bold text-xl">✕</button>
              </div>
              <div className="space-y-4 mb-8">
                {products.filter(p => cart[p.id] > 0).map(p => (
                  <div key={p.id} className="flex justify-between font-bold">
                    <span>{p.name} <span className="text-gray-400 ml-1">x{cart[p.id]}</span></span>
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