'use client'

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Script from 'next/script'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const YANDEX_API_KEY = "b9336a86-41c5-4a5a-a3b1-9a1ef4057197";

// ❗️❗️❗️ ВПИШИ СЮДА ССЫЛКУ НА СВОЕ МИНИ-ПРИЛОЖЕНИЕ ТЕЛЕГРАМ
const BOT_APP_URL = "https://t.me/Probnayaaa_bot"

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const parseMods = (modsRaw) => {
    if (!modsRaw) return [];
    if (typeof modsRaw === 'string') {
        try { return JSON.parse(modsRaw); } catch(e) { return []; }
    }
    return Array.isArray(modsRaw) ? modsRaw : [];
}

export default function RestaurantMenu() {
  const params = useParams()
  const router = useRouter()
  const mapRef = useRef(null);
  const ymapsRef = useRef(null);
  
  const [isTelegram, setIsTelegram] = useState(true) // Состояние защиты
  const [deepLinkUrl, setDeepLinkUrl] = useState(BOT_APP_URL)

  const [restaurant, setRestaurant] = useState(null)
  const [products, setProducts] = useState([])
  const [promotions, setPromotions] = useState([]) 
  
  const [cart, setCart] = useState({})
  const [selectedProduct, setSelectedProduct] = useState(null) 
  const [selectedMods, setSelectedMods] = useState([]) 
  
  const [activeCategory, setActiveCategory] = useState('Все')
  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [myOrders, setMyOrders] = useState([])
  const [hasPreviousOrders, setHasPreviousOrders] = useState(false) 

  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  
  const [promoInput, setPromoInput] = useState('')
  const [activePromo, setActivePromo] = useState(null)
  const [promoError, setPromoError] = useState('')
  
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
    // --- ЗАЩИТА ТЕЛЕГРАМ ДЛЯ СТРАНИЦЫ РЕСТОРАНА ---
    const timer = setTimeout(() => {
      const tg = window.Telegram?.WebApp;
      if (!tg || !tg.initData) {
        setIsTelegram(false);
        // Формируем ссылку, которая перекинет прямо в этот ресторан внутри ТГ
        const specificUrl = `${BOT_APP_URL}?startapp=res_${params.id}`;
        setDeepLinkUrl(specificUrl);
        window.location.href = specificUrl; // Авто-редирект
      }
    }, 500);

    const savedPhone = localStorage.getItem('leki_phone');
    const savedApt = localStorage.getItem('leki_apt');
    const savedEnt = localStorage.getItem('leki_ent');
    if (savedPhone) setPhone(savedPhone);
    if (savedApt) setApartment(savedApt);
    if (savedEnt) setEntrance(savedEnt);

    return () => clearTimeout(timer);
  }, [params.id]);

  useEffect(() => {
    async function fetchData() {
      const { data: res } = await supabase.from('restaurants').select('*').eq('id', params.id).single()
      const { data: ratingData } = await supabase.from('restaurant_ratings').select('avg_rating').eq('restaurant_id', params.id).maybeSingle()
      setRestaurant({...res, rating: ratingData?.avg_rating || '5.0'})
      const { data: prod } = await supabase.from('products').select('*').eq('restaurant_id', params.id).order('id')
      setProducts(prod || [])

      if (res?.name) {
          const nowMs = new Date().getTime();
          const { data: promos } = await supabase.from('promotions').select('*').eq('restaurant_name', res.name).eq('is_active', true);
          if (promos) {
             const validPromos = promos.filter(p => !p.expires_at || new Date(p.expires_at).getTime() > nowMs);
             setPromotions(validPromos);
          }
      }

      const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      if (tgUser?.id) {
          const { data: pastOrders } = await supabase.from('orders').select('id, user_data').limit(10);
          if (pastOrders) {
             const userOrders = pastOrders.filter(o => {
                 const uData = typeof o.user_data === 'string' ? JSON.parse(o.user_data) : o.user_data;
                 return uData?.id === tgUser.id;
             });
             if (userOrders.length > 0) setHasPreviousOrders(true);
          }
      }
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
          if (updatedOrder.status === 'awaiting_payment') statusText = "ожидает оплаты 💳";
          if (window.Telegram?.WebApp?.initData) {
            window.Telegram.WebApp.showPopup({ title: `Заказ #${updatedOrder.id}`, message: `Статус: ${statusText}`, buttons: [{ type: "ok" }] });
          }
        }
      }).subscribe();
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
      const map = new ymaps.Map("map_container", { center: [restaurant?.lat || 42.98, restaurant?.lon || 47.50], zoom: 15, controls: ['zoomControl'] });
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
      if (firstGeoObject) { setAddress(firstGeoObject.getAddressLine()); updateDeliveryPrice(coords); }
    });
  };

  const updateDeliveryPrice = (coords) => {
    if (!restaurant?.lat || !restaurant?.lon) return;
    setIsCalculating(true);
    const ymaps = window.ymaps;
    if (ymaps && ymaps.route) {
        ymaps.route([ [restaurant.lat, restaurant.lon], coords ], { routingMode: 'driving' }).then(
            function (route) { calculatePriceLogic(route.getLength() / 1000, "дорогам"); },
            function (error) { calculatePriceLogic(getDistanceFromLatLonInKm(restaurant.lat, restaurant.lon, coords[0], coords[1]), "прямой"); }
        );
    } else {
         calculatePriceLogic(getDistanceFromLatLonInKm(restaurant.lat, restaurant.lon, coords[0], coords[1]), "прямой");
    }
  };

  const calculatePriceLogic = (distance, method) => {
    const MAX_DISTANCE = restaurant?.delivery_radius || 15; 
    const BASE = restaurant?.base_delivery_price || 150;
    const KM_PRICE = restaurant?.km_delivery_price || 22;
    const FREE_KM = restaurant?.free_base_km || 0;
    const SURGE = restaurant?.surge_multiplier || 1.0;
    const WEATHER = restaurant?.weather_bonus || 0;

    if (distance > MAX_DISTANCE) {
        setDeliveryError(`Слишком далеко (${distance.toFixed(1)} км). Доставляем до ${MAX_DISTANCE} км.`);
        setDeliveryPrice(0); setIsAddressValid(false);
    } else {
        setDeliveryError(''); 
        let rawPrice = BASE + (Math.max(0, distance - FREE_KM) * KM_PRICE);
        rawPrice = (rawPrice * SURGE) + WEATHER;
        setDeliveryPrice(Math.round(rawPrice));
        setIsAddressValid(true);
    }
    setIsCalculating(false);
  };

  const getLocation = () => {
    setIsCalculating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        if (mapRef.current) { mapRef.current.map.setCenter(coords, 17); mapRef.current.placemark.geometry.setCoordinates(coords); }
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

  const getCartItemKey = (product, mods) => {
    if (!mods || mods.length === 0) return String(product.id);
    const modNames = mods.map(m => m.name).sort().join(',');
    return `${product.id}|${modNames}`;
  };

  const handleAddToCartClick = (item) => {
      const parsedMods = parseMods(item.modifiers);
      if (parsedMods.length > 0) {
          setSelectedProduct({ ...item, parsedMods });
          setSelectedMods([]); 
      } else {
          addToCart(item, []);
      }
  };

  const addToCart = (item, mods = []) => {
      const key = getCartItemKey(item, mods);
      setCart(prev => {
          const existing = prev[key];
          if (existing) {
              return { ...prev, [key]: { ...existing, count: existing.count + 1 } };
          } else {
              return { ...prev, [key]: { ...item, cartKey: key, count: 1, selectedMods: mods } };
          }
      });
      setSelectedProduct(null); 
  };

  const removeFromCart = (cartKey) => {
      setCart(prev => {
          const existing = prev[cartKey];
          if (!existing) return prev;
          if (existing.count > 1) {
              return { ...prev, [cartKey]: { ...existing, count: existing.count - 1 } };
          } else {
              const newCart = { ...prev };
              delete newCart[cartKey];
              return newCart;
          }
      });
  };

  const getProductTotalCount = (id) => {
      return Object.values(cart).filter(cItem => cItem.id === id).reduce((sum, cItem) => sum + cItem.count, 0);
  };

  const totalSumRaw = Object.values(cart).reduce((sum, item) => {
      const itemModsPrice = item.selectedMods?.reduce((s, m) => s + m.price, 0) || 0;
      return sum + ((item.price + itemModsPrice) * item.count);
  }, 0);

  const discountAmount = activePromo?.reward_type === 'discount' ? activePromo.discount_rub : 0;
  const totalSumDiscounted = Math.max(0, totalSumRaw - discountAmount);

  // ЛОГИКА МИНИМАЛЬНОГО ЗАКАЗА
  const minOrderAmount = restaurant?.min_order_amount || 0;
  const isMinOrderActive = restaurant?.is_min_order_active;
  const canCheckout = !isMinOrderActive || totalSumRaw >= minOrderAmount;

  // ЛОГИКА БЕСПЛАТНОЙ ДОСТАВКИ
  const isFreeDelivery = activePromo?.reward_type === 'free_delivery';
  const finalDeliveryPrice = isFreeDelivery ? 0 : deliveryPrice;

  const applyPromo = () => {
      setPromoError('');
      if (!promoInput.trim()) return;
      
      const code = promoInput.trim().toUpperCase();
      const promo = promotions.find(p => p.code.toUpperCase() === code);

      if (!promo) {
          setPromoError('Промокод не найден');
          setActivePromo(null);
          return;
      }

      if (promo.usage_limit && promo.used_count >= promo.usage_limit) {
          setPromoError('Лимит активаций исчерпан');
          setActivePromo(null);
          return;
      }

      if (promo.is_first_order_only && hasPreviousOrders) {
          setPromoError('Только для первого заказа');
          setActivePromo(null);
          return;
      }

      if (promo.min_cart_total > 0 && totalSumRaw < promo.min_cart_total) {
          setPromoError(`Минимальная сумма: ${promo.min_cart_total} ₽`);
          setActivePromo(null);
          return;
      }

      setActivePromo(promo);
  };

  const removePromo = () => {
      setActivePromo(null);
      setPromoInput('');
      setPromoError('');
  };

  useEffect(() => {
      if (activePromo && activePromo.min_cart_total > 0 && totalSumRaw < activePromo.min_cart_total) {
          removePromo();
      }
  }, [totalSumRaw]);


  const sendOrder = async () => {
    const isYookassa = restaurant?.payment_method === 'yookassa';
    if (!isYookassa && !receiptFile) return alert("Пожалуйста, прикрепите чек об оплате!");

    setIsUploading(true);
    try {
      let publicUrl = null;
      if (!isYookassa && receiptFile) {
        const fileExt = receiptFile.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('receipts').upload(fileName, receiptFile);
        if (uploadError) throw uploadError;
        publicUrl = supabase.storage.from('receipts').getPublicUrl(fileName).data.publicUrl;
      }

      let fullAddressStr = address;
      if (apartment.trim()) fullAddressStr += `, кв/офис: ${apartment.trim()}`;
      if (entrance.trim()) fullAddressStr += `, подъезд: ${entrance.trim()}`;
      
      // Если бесплатная доставка, добавляем скрытый реальный тариф
      fullAddressStr += `\n🚚 Доставка: ${finalDeliveryPrice} ₽`;
      if (isFreeDelivery) fullAddressStr += ` (Тариф: ${deliveryPrice} ₽)`;
      
      if (activePromo) {
          if (activePromo.reward_type === 'discount') {
              fullAddressStr += `\n🎟 Промокод: ${activePromo.code} (-${activePromo.discount_rub}₽)`;
          } else if (activePromo.reward_type === 'gift') {
              fullAddressStr += `\n🎁 ПОДАРОК: ${activePromo.gift_name} (${activePromo.code})`;
          } else if (activePromo.reward_type === 'free_delivery') {
              fullAddressStr += `\n🎟 Промокод: ${activePromo.code} (Бесплатная доставка)`;
          }
      }

      const coords = mapRef.current ? mapRef.current.placemark.geometry.getCoordinates() : null;

      const orderItems = Object.values(cart).map(item => {
          let nameWithMods = item.name;
          if (item.selectedMods && item.selectedMods.length > 0) {
              nameWithMods += ` (${item.selectedMods.map(m => m.name).join(', ')})`;
          }
          const itemTotalPrice = item.price + (item.selectedMods?.reduce((s, m) => s + m.price, 0) || 0);
          return { name: nameWithMods, count: item.count, price: itemTotalPrice };
      });

      if (activePromo?.reward_type === 'gift') {
          orderItems.push({ name: `🎁 ПОДАРОК: ${activePromo.gift_name}`, count: 1, price: 0 });
      }

      const orderData = {
        restaurant_name: restaurant?.name,
        items: orderItems,
        total_price: totalSumDiscounted + finalDeliveryPrice, 
        status: isYookassa ? 'awaiting_payment' : 'new', 
        user_data: window.Telegram?.WebApp?.initDataUnsafe?.user || { first_name: 'Web User' },
        phone,
        address: fullAddressStr,
        receipt_url: publicUrl,
        lat: coords ? coords[0] : null,
        lon: coords ? coords[1] : null
      };

      const { error: insertError } = await supabase.from('orders').insert([orderData]);
      if (insertError) { alert("Ошибка: " + insertError.message); setIsUploading(false); return; }
      
      if (activePromo) {
          await supabase.from('promotions').update({ used_count: activePromo.used_count + 1 }).eq('id', activePromo.id);
      }

      localStorage.setItem('leki_phone', phone);
      localStorage.setItem('leki_apt', apartment);
      localStorage.setItem('leki_ent', entrance);

      window.Telegram?.WebApp?.close();
    } catch (err) { alert("Ошибка: " + err.message); setIsUploading(false); }
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
    if (status === 'awaiting_payment') return <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-xl text-xs font-black uppercase">💳 Ждет оплату</span>;
    if (status === 'processing' || status === 'accepted') return <span className="bg-green-100 text-green-700 px-3 py-1 rounded-xl text-xs font-black uppercase">🔥 Готовится</span>;
    if (status === 'cancelled') return <span className="bg-red-100 text-red-700 px-3 py-1 rounded-xl text-xs font-black uppercase">❌ Отменен</span>;
    return <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-xl text-xs font-black uppercase">{status}</span>;
  };

  const categories = ['Все', ...new Set(products.map(p => p.category || 'Основное'))]
  const filteredProducts = activeCategory === 'Все' ? products : products.filter(p => (p.category || 'Основное') === activeCategory)
  
  // ЗАГЛУШКА ДЛЯ СТРАНИЦЫ РЕСТОРАНА
  if (!isTelegram) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 text-center">
        <span className="text-6xl mb-4">📱</span>
        <h1 className="text-white text-2xl font-black mb-2">Откройте в Telegram</h1>
        <p className="text-gray-400 mb-8">Для заказа из ресторана запустите приложение внутри Telegram.</p>
        <a href={deepLinkUrl} className="bg-blue-600 text-white font-bold py-4 px-8 rounded-2xl shadow-lg shadow-blue-500/30 active:scale-95 transition-all">
          🚀 Открыть в Telegram
        </a>
      </div>
    )
  }

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
          {filteredProducts.map((item) => {
            const countInCart = getProductTotalCount(item.id);
            const hasMods = parseMods(item.modifiers).length > 0;

            return (
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
                        hasMods ? (
                            <button onClick={() => handleAddToCartClick(item)} className="bg-blue-500 text-white px-4 py-2 rounded-xl font-bold shadow-sm text-xs active:scale-95 transition-all">
                                {countInCart > 0 ? `ЕЩЁ (${countInCart})` : '+ ДОБАВИТЬ'}
                            </button>
                        ) : (
                            <>
                                {countInCart > 0 && <button onClick={() => removeFromCart(String(item.id))} className="bg-gray-100 text-gray-600 w-9 h-9 rounded-xl font-bold active:scale-95">-</button>}
                                {countInCart > 0 && <span className="font-bold w-4 text-center">{countInCart}</span>}
                                <button onClick={() => handleAddToCartClick(item)} className="bg-blue-500 text-white w-9 h-9 rounded-xl font-bold shadow-sm active:scale-95">+</button>
                            </>
                        )
                    ) : <span className="text-xs text-red-500 font-bold bg-red-50 px-2 py-1 rounded-lg">Стоп</span>}
                  </div>
                </div>
            );
          })}
        </div>

        {totalSumRaw > 0 && !isCartOpen && !isCheckoutOpen && !isOrdersOpen && !selectedProduct && (
          <div className="fixed bottom-6 left-0 right-0 px-4 z-40">
            <button onClick={() => setIsCartOpen(true)} className="max-w-md mx-auto w-full bg-blue-600 text-white py-4 rounded-2xl font-black flex justify-between px-8 shadow-2xl active:scale-95 transition-all">
              <span>🛒 Корзина</span><span>{totalSumDiscounted} ₽</span>
            </button>
          </div>
        )}

        {/* --- ОКНО ВЫБОРА ДОБАВОК --- */}
        {selectedProduct && (
            <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
                <div className="bg-white rounded-t-[40px] p-6 w-full max-w-md mx-auto pb-10 animate-slide-up">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-2xl font-black">{selectedProduct.name}</h2>
                            <p className="text-blue-600 font-black mt-1">{selectedProduct.price} ₽</p>
                        </div>
                        <button onClick={() => setSelectedProduct(null)} className="bg-gray-100 w-10 h-10 rounded-full font-bold text-gray-500 flex items-center justify-center">✕</button>
                    </div>
                    {selectedProduct.description && <p className="text-sm text-gray-500 mb-6 bg-gray-50 p-3 rounded-xl">{selectedProduct.description}</p>}
                    
                    <div className="space-y-3 mb-8 max-h-[40vh] overflow-y-auto pr-2">
                        <h3 className="font-black text-gray-800 uppercase tracking-wide text-sm mb-4">Добавки по желанию:</h3>
                        {selectedProduct.parsedMods.map((mod, idx) => {
                            const isSelected = selectedMods.some(m => m.name === mod.name);
                            return (
                                <div key={idx} onClick={() => {
                                    if (isSelected) setSelectedMods(prev => prev.filter(m => m.name !== mod.name));
                                    else setSelectedMods(prev => [...prev, mod]);
                                }} className={`flex justify-between items-center p-4 rounded-2xl border-2 cursor-pointer transition-all active:scale-95 ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-100 bg-white hover:border-blue-200'}`}>
                                    <span className="font-bold text-sm">{mod.name}</span>
                                    <div className="flex items-center gap-3">
                                        <span className="font-black text-blue-600">+{mod.price} ₽</span>
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-200'}`}>
                                            {isSelected && '✓'}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    <button onClick={() => addToCart(selectedProduct, selectedMods)} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">
                        В корзину за {selectedProduct.price + selectedMods.reduce((s,m)=>s+m.price, 0)} ₽
                    </button>
                </div>
            </div>
        )}

        {/* --- ОБНОВЛЕННАЯ КОРЗИНА --- */}
        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-8 w-full max-w-md mx-auto pb-10 max-h-[95vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                 <h2 className="text-2xl font-black">Ваш заказ</h2>
                 <button onClick={() => setIsCartOpen(false)} className="bg-gray-100 w-10 h-10 rounded-full font-bold text-gray-500 flex items-center justify-center">✕</button>
              </div>
              <div className="space-y-6 mb-8 pr-2">
                {Object.values(cart).map(cItem => {
                   const modsTotal = cItem.selectedMods?.reduce((s, m) => s + m.price, 0) || 0;
                   return (
                      <div key={cItem.cartKey} className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <div className="flex-1 pr-4">
                            <span className="font-bold block text-sm">{cItem.name}</span>
                            {cItem.selectedMods?.length > 0 && (
                                <span className="text-xs text-gray-400 block mt-1 font-medium bg-gray-50 p-1.5 rounded-lg border border-gray-100">
                                    {cItem.selectedMods.map(m => `+ ${m.name}`).join(', ')}
                                </span>
                            )}
                            <span className="font-black text-blue-600 block mt-1">{(cItem.price + modsTotal)} ₽</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={() => removeFromCart(cItem.cartKey)} className="bg-gray-100 text-gray-600 w-8 h-8 rounded-lg font-black active:scale-95 transition-all">-</button>
                            <span className="font-black w-3 text-center">{cItem.count}</span>
                            <button onClick={() => addToCart(cItem, cItem.selectedMods)} className="bg-blue-100 text-blue-600 w-8 h-8 rounded-lg font-black active:scale-95 transition-all">+</button>
                        </div>
                      </div>
                   )
                })}
              </div>

              {/* ПОЛЕ ВВОДА ПРОМОКОДА */}
              <div className="mb-6 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                  <div className="flex gap-2">
                      <input 
                          type="text" 
                          placeholder="Промокод" 
                          value={promoInput}
                          onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                          disabled={!!activePromo}
                          className="w-full min-w-0 px-3 py-2 border-2 border-gray-200 rounded-xl outline-none focus:border-blue-500 font-bold uppercase disabled:bg-gray-100 disabled:text-gray-400 text-sm"
                      />
                      {activePromo ? (
                          <button onClick={removePromo} className="shrink-0 bg-red-100 text-red-600 px-3 py-2 rounded-xl font-bold active:scale-95 text-xs shadow-sm">✕ ОТМЕНА</button>
                      ) : (
                          <button onClick={applyPromo} className="shrink-0 bg-gray-900 text-white px-3 py-2 rounded-xl font-bold active:scale-95 text-xs shadow-md">ПРИМЕНИТЬ</button>
                      )}
                  </div>
                  {promoError && <p className="text-red-500 text-xs font-bold mt-2 pl-1">{promoError}</p>}
                  {activePromo && (
                      <p className="text-green-600 text-xs font-black mt-2 pl-1 flex items-center gap-1">
                          ✅ Успех! {
                            activePromo.reward_type === 'discount' ? `Скидка ${activePromo.discount_rub} ₽` : 
                            activePromo.reward_type === 'free_delivery' ? 'Бесплатная доставка!' : 
                            `Подарок: ${activePromo.gift_name}`
                          }
                      </p>
                  )}
              </div>

              {activePromo && (
                  <div className="flex justify-between items-center bg-green-50 p-4 rounded-2xl mb-4 border border-green-100">
                      <span className="font-black text-sm text-green-800">
                          {activePromo.reward_type === 'discount' ? 'Скидка по промокоду' : 
                           activePromo.reward_type === 'free_delivery' ? 'Промокод на доставку' : 
                           '🎁 Ваш подарок'}
                      </span>
                      <span className="font-black text-green-700">
                          {activePromo.reward_type === 'discount' ? `-${activePromo.discount_rub} ₽` : 
                           activePromo.reward_type === 'free_delivery' ? 'Бесплатно' : 
                           activePromo.gift_name}
                      </span>
                  </div>
              )}

              <button 
                onClick={() => {
                  if (!canCheckout) return;
                  setIsCartOpen(false); 
                  setIsCheckoutOpen(true);
                }} 
                className={`w-full py-5 rounded-2xl font-black text-lg shadow-xl transition-all flex justify-center gap-2 items-center ${canCheckout ? 'bg-blue-600 text-white active:scale-95' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
              >
                {canCheckout ? (
                  <>
                    Оформить 
                    {activePromo?.reward_type === 'discount' ? (
                        <div className="flex gap-2 items-center ml-2">
                            <span className="line-through text-blue-300 text-sm">{totalSumRaw}₽</span>
                            <span>{totalSumDiscounted} ₽</span>
                        </div>
                    ) : (
                        <span>({totalSumRaw} ₽)</span>
                    )}
                  </>
                ) : (
                  <>Мин. заказ от {minOrderAmount} ₽</>
                )}
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
                
                <div className="bg-blue-50 p-4 rounded-2xl border-2 border-blue-100 text-center mb-2">
                   <p className="text-sm font-bold text-blue-800 mb-2">Поставьте метку на дом, куда доставить заказ:</p>
                   <button onClick={getLocation} className="bg-white text-blue-600 font-black px-4 py-2 rounded-xl text-sm shadow-sm active:scale-95 transition-all">📍 Найти меня (GPS)</button>
                </div>

                <div className="relative w-full h-56 rounded-3xl overflow-hidden border-2 border-gray-200 shadow-inner">
                  <div id="map_container" className="w-full h-full bg-gray-100 flex items-center justify-center">
                    {!isMapApiLoaded && <span className="text-gray-400 font-bold text-sm animate-pulse">Загрузка карты...</span>}
                  </div>
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

                {restaurant?.payment_method === 'yookassa' ? (
                  <div className="bg-green-50 p-5 rounded-3xl space-y-2 mt-2 border-2 border-green-100 text-center">
                    <p className="text-sm font-black text-green-800 uppercase tracking-wide">Онлайн-оплата</p>
                    <p className="text-xs font-medium text-green-700">После оформления бот пришлет вам ссылку на безопасную оплату заказа.</p>
                  </div>
                ) : (
                  <div className="bg-gray-50 p-5 rounded-3xl space-y-3 border-2 border-dashed border-gray-200 mt-2">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Реквизиты для оплаты</p>
                    <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-gray-100">
                      <span className="font-mono font-bold text-sm">{restaurant?.card_number || 'Не указано'}</span>
                      <button onClick={() => {navigator.clipboard.writeText(restaurant?.card_number); alert("Скопировано!")}} className="text-blue-600 text-xs font-black">КОПИРОВАТЬ</button>
                    </div>
                    <p className="text-xs font-bold text-gray-500">
                      Переведите <span className="text-blue-600">{totalSumDiscounted + finalDeliveryPrice} ₽</span> и прикрепите чек:
                    </p>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={(e) => setReceiptFile(e.target.files[0])}
                      className="w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-black file:bg-blue-50 file:text-blue-700"
                    />
                  </div>
                )}

                <div className="bg-blue-50 p-5 rounded-3xl space-y-2 mt-2">
                  {deliveryError ? (
                    <p className="text-red-500 font-bold text-sm text-center">{deliveryError}</p>
                  ) : (
                    <>
                      {restaurant?.surge_multiplier > 1.0 && isAddressValid && (
                         <div className="flex justify-between text-[10px] font-bold text-orange-500">
                            <span>Повышенный спрос:</span><span>x{restaurant.surge_multiplier}</span>
                         </div>
                      )}
                      {restaurant?.weather_bonus > 0 && isAddressValid && (
                         <div className="flex justify-between text-[10px] font-bold text-blue-500">
                            <span>Непогода:</span><span>+{restaurant.weather_bonus} ₽</span>
                         </div>
                      )}

                      <div className="flex justify-between text-sm font-bold text-blue-800 border-t border-blue-100 pt-2">
                          <span>Доставка {isCalculating && '...'}:</span>
                          <span>
                            {isAddressValid ? (
                              isFreeDelivery ? <><span className="line-through text-blue-300 mr-2">{deliveryPrice} ₽</span>0 ₽</> : `${deliveryPrice} ₽`
                            ) : '--'}
                          </span>
                      </div>
                      <div className="flex justify-between font-black text-xl pt-2 border-t border-blue-100 text-blue-900">
                          <span>Итого к оплате:</span><span>{isAddressValid ? totalSumDiscounted + finalDeliveryPrice : totalSumDiscounted} ₽</span>
                      </div>
                    </>
                  )}
                </div>

                <button 
                  onClick={sendOrder} 
                  disabled={!isAddressValid || phone.replace(/\D/g, '').length !== 11 || (!receiptFile && restaurant?.payment_method !== 'yookassa') || isUploading} 
                  className={`w-full py-5 rounded-2xl font-black text-xl shadow-lg transition-all mt-2 ${isAddressValid && phone.replace(/\D/g, '').length === 11 && (receiptFile || restaurant?.payment_method === 'yookassa') && !isUploading ? 'bg-green-500 text-white active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                  {isUploading ? 'ОБРАБОТКА...' : (restaurant?.payment_method === 'yookassa' ? 'ПЕРЕЙТИ К ОПЛАТЕ' : 'ПОДТВЕРДИТЬ')}
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