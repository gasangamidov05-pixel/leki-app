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
  
  const [activeCategory, setActiveCategory] = useState('Все')
  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [myOrders, setMyOrders] = useState([])

  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [apartment, setApartment] = useState('')
  const [entrance, setEntrance] = useState('')

  const [receiptFile, setReceiptFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)

  const [deliveryPrice, setDeliveryPrice] = useState(150)
  const [deliveryError, setDeliveryError] = useState('') 
  const [isCalculating, setIsCalculating] = useState(false)
  const [isAddressValid, setIsAddressValid] = useState(false)
  const [isMapApiLoaded, setIsMapApiLoaded] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const { data: res } = await supabase.from('restaurants').select('*').eq('id', params.id).single()
      const { data: ratingData } = await supabase.from('restaurant_ratings').select('avg_rating').eq('restaurant_id', params.id).maybeSingle()
      setRestaurant({...res, rating: ratingData?.avg_rating || '5.0'})
      const { data: prod } = await supabase.from('products').select('*').eq('restaurant_id', params.id).order('id')
      setProducts(prod || [])
    }
    fetchData()
  }, [params.id]);

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
      const MAX_DISTANCE = restaurant?.delivery_radius || 15; 

      const BASE = restaurant?.base_delivery_price || 150;
      const KM_PRICE = restaurant?.km_delivery_price || 22;

      if (distance > MAX_DISTANCE) {
        setDeliveryError(`Слишком далеко (${Math.round(distance)} км). Доставляем до ${MAX_DISTANCE} км.`);
        setDeliveryPrice(0);
        setIsAddressValid(false);
      } else {
        setDeliveryError(''); 
        setDeliveryPrice(Math.round(BASE + (distance * KM_PRICE)));
        setIsAddressValid(true);
      }
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

  const sendOrder = async () => {
    if (!receiptFile) return alert("Пожалуйста, прикрепите чек об оплате!");

    setIsUploading(true);
    try {
      const fileExt = receiptFile.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(fileName, receiptFile);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('receipts')
        .getPublicUrl(fileName);

      let fullAddressStr = address;
      if (apartment.trim()) fullAddressStr += `, кв/офис: ${apartment.trim()}`;
      if (entrance.trim()) fullAddressStr += `, подъезд: ${entrance.trim()}`;
      fullAddressStr += `\n🚚 Доставка: ${deliveryPrice} ₽`;

      const coords = mapRef.current ? mapRef.current.placemark.geometry.getCoordinates() : null;

      const orderData = {
        restaurant_name: restaurant?.name,
        items: filteredProducts.filter(p => cart[p.id] > 0).map(p => ({ name: p.name, count: cart[p.id], price: p.price })),
        total_price: totalSum + deliveryPrice,
        status: 'new',
        user_data: window.Telegram?.WebApp?.initDataUnsafe?.user || { first_name: 'Web User' },
        phone,
        address: fullAddressStr,
        receipt_url: publicUrl,
        lat: coords ? coords[0] : null,
        lon: coords ? coords[1] : null
      };

      const { error: insertError } = await supabase.from('orders').insert([orderData]);
      if (insertError) {
        alert("Ошибка сохранения в базу: " + insertError.message);
        setIsUploading(false);
        return; 
      }

      window.Telegram?.WebApp?.close();
    } catch (err) {
      alert("Ошибка при отправке: " + err.message);
      setIsUploading(false);
    }
  };

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
        <div className="flex justify-between items-center mb-6">
          <Link href="/" className="text-blue-500 font-bold">← Назад</Link>
          <button onClick={openMyOrders} className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-all">
            📜 Мои заказы
          </button>
        </div>

        <h1 className="text-3xl font-black mb-1">{restaurant?.name || 'Загрузка...'}</h1>
        <div className="flex items-center gap-1 mb-6 text-yellow-500 font-bold">
          <span>⭐ {restaurant?.rating || '5.0'}</span>
          <span className="text-gray-400 text-xs font-medium">• Ресторан</span>
        </div>

        <div className="flex overflow-x-auto gap-2 mb-6 pb-2" style={{ scrollbarWidth: 'none' }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-5 py-2.5 rounded-xl whitespace-nowrap font-bold transition-all ${activeCategory === cat ? 'bg-blue-600 text-white shadow-md' : 'bg-white border-2 border-gray-100 text-gray-600'}`}>{cat}</button>
          ))}
        </div>

        <div className="grid gap-3">
          {filteredProducts.map((item) => (
            <div key={item.id} className={`bg-white p-3 rounded-2xl shadow-sm border-2 border-transparent flex items-center gap-4 ${item.is_active === false ? 'opacity-50 grayscale' : ''}`}>
              <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                <img src={item.image_url || 'https://via.placeholder.com/150'} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-md leading-tight mb-1">{item.name}</h3>
                {item.description && <p className="text-xs text-gray-500 mb-1 line-clamp-2">{item.description}</p>}
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

        {totalSum > 0 && !isCartOpen && !isCheckoutOpen && !isOrdersOpen && (
          <div className="fixed bottom-6 left-0 right-0 px-4 z-40">
            <button onClick={() => setIsCartOpen(true)} className="max-w-md mx-auto w-full bg-blue-600 text-white py-4 rounded-2xl font-black flex justify-between px-8 shadow-2xl active:scale-95 transition-all">
              <span>🛒 Корзина</span><span>{totalSum} ₽</span>
            </button>
          </div>
        )}

        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-8 w-full max-w-md mx-auto">
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

        {isCheckoutOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-6 w-full max-w-md mx-auto pb-10 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black">Доставка</h2>
                <button onClick={() => setIsCheckoutOpen(false)} className="bg-gray-100 w-10 h-10 rounded-full font-bold text-gray-500">✕</button>
              </div>

              <div className="space-y-4">
                <input type="tel" value={phone} onChange={handlePhoneInput} placeholder="+7 (999) 000-00-00" className="w-full border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-bold"/>
                
                {/* ИЗМЕНЕННЫЙ БЛОК КАРТЫ */}
                <div className="bg-blue-50 p-4 rounded-2xl border-2 border-blue-100 text-center mb-2">
                   <p className="text-sm font-bold text-blue-800 mb-2">Поставьте метку на дом, куда доставить заказ:</p>
                   <button onClick={getLocation} className="bg-white text-blue-600 font-black px-4 py-2 rounded-xl text-sm shadow-sm active:scale-95 transition-all">📍 Найти меня (GPS)</button>
                </div>

                <div className="relative w-full h-56 rounded-3xl overflow-hidden border-2 border-gray-200 shadow-inner">
                  <div id="map_container" className="w-full h-full bg-gray-100 flex items-center justify-center">
                    {!isMapApiLoaded && <span className="text-gray-400 font-bold text-sm animate-pulse">Загрузка карты...</span>}
                  </div>
                  {/* Показываем адрес текстом ПОВЕРХ карты для удобства */}
                  {address && (
                      <div className="absolute bottom-2 left-2 right-2 bg-white/90 backdrop-blur-md p-2 rounded-xl border border-white/50 text-xs font-bold text-center shadow-lg line-clamp-2">
                          {address}
                      </div>
                  )}
                </div>

                <div className="flex gap-3 mt-2">
                  <input type="text" value={apartment} onChange={(e) => setApartment(e.target.value)} placeholder="Кв / Офис" className="w-1/2 border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-medium text-sm text-center"/>
                  <input type="text" value={entrance} onChange={(e) => setEntrance(e.target.value)} placeholder="Подъезд" className="w-1/2 border-2 border-gray-100 p-4 rounded-2xl outline-none focus:border-blue-500 font-medium text-sm text-center"/>
                </div>
                {/* КОНЕЦ ИЗМЕНЕННОГО БЛОКА КАРТЫ */}

                <div className="bg-gray-50 p-5 rounded-3xl space-y-3 border-2 border-dashed border-gray-200 mt-2">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Реквизиты для оплаты</p>
                  <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-gray-100">
                    <span className="font-mono font-bold text-sm">{restaurant?.card_number || 'Оплата при получении'}</span>
                    <button onClick={() => {navigator.clipboard.writeText(restaurant?.card_number); alert("Скопировано!")}} className="text-blue-600 text-xs font-black">КОПИРОВАТЬ</button>
                  </div>
                  <p className="text-xs font-bold text-gray-500">
                    Переведите <span className="text-blue-600">{totalSum + deliveryPrice} ₽</span> и прикрепите чек:
                  </p>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={(e) => setReceiptFile(e.target.files[0])}
                    className="w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-black file:bg-blue-50 file:text-blue-700"
                  />
                </div>

                <div className="bg-blue-50 p-5 rounded-3xl space-y-2 mt-2">
                  {deliveryError ? (
                    <p className="text-red-500 font-bold text-sm text-center">{deliveryError}</p>
                  ) : (
                    <>
                      <div className="flex justify-between text-sm font-bold text-blue-800"><span>Доставка {isCalculating && '...'}:</span><span>{isAddressValid ? deliveryPrice : '--'} ₽</span></div>
                      <div className="flex justify-between font-black text-xl pt-2 border-t border-blue-100 text-blue-900"><span>Итого:</span><span>{isAddressValid ? totalSum + deliveryPrice : totalSum} ₽</span></div>
                    </>
                  )}
                </div>

                <button 
                  onClick={sendOrder} 
                  disabled={!isAddressValid || phone.replace(/\D/g, '').length !== 11 || !receiptFile || isUploading} 
                  className={`w-full py-5 rounded-2xl font-black text-xl shadow-lg transition-all mt-2 ${isAddressValid && phone.replace(/\D/g, '').length === 11 && receiptFile && !isUploading ? 'bg-green-500 text-white active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                  {isUploading ? 'ОТПРАВЛЯЕМ...' : 'ПОДТВЕРДИТЬ'}
                </button>
              </div>
            </div>
          </div>
        )}

        {isOrdersOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-6 max-w-md mx-auto w-full pb-10 max-h-[85vh] flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black">Мои заказы</h2>
                <button onClick={() => setIsOrdersOpen(false)} className="bg-gray-100 w-10 h-10 rounded-full font-bold text-gray-500">✕</button>
              </div>
              <div className="overflow-y-auto space-y-4 pr-2 pb-6">
                {myOrders.length === 0 ? (
                  <div className="text-center py-10"><span className="text-5xl block mb-4">🛒</span><p className="text-gray-400 font-bold">Вы еще ничего не заказывали</p></div>
                ) : (
                  myOrders.map(o => {
                    const itemsList = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
                    return (
                      <div key={o.id} className="border-2 border-gray-100 rounded-3xl p-5 shadow-sm bg-white">
                        <div className="flex justify-between items-center mb-4"><span className="font-black text-xl">Заказ #{o.id}</span>{getStatusBadge(o.status)}</div>
                        <div className="text-sm text-gray-500 mb-5 space-y-2 border-l-2 border-blue-100 pl-3">
                          {itemsList.map((item, idx) => (<div key={idx} className="flex justify-between items-center"><span className="font-medium">{item.name}</span><span className="font-black text-gray-400">x{item.count}</span></div>))}
                        </div>
                        <div className="border-t-2 border-dashed border-gray-100 pt-4 flex justify-between items-center font-black"><span className="text-gray-400">Итого:</span><span className="text-blue-600 text-xl">{o.total_price} ₽</span></div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}