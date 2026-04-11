import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'

// Подключаемся к базе данных
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Функция для получения ресторанов
export const revalidate = 0; 
async function getRestaurants() {
  const { data } = await supabase.from('restaurants').select('*').eq('is_active', true)
  return data || []
}

export default async function Home() {
  const restaurants = await getRestaurants()

  return (
    <main className="min-h-screen p-4 bg-gray-50 text-black">
      <div className="max-w-md mx-auto">
        
        <h1 className="text-3xl font-extrabold text-center mb-8 pt-6 text-blue-600">
          LEKI Delivery
        </h1>
        
        <div className="space-y-4">
          {restaurants.length > 0 ? (
            restaurants.map((restaurant) => (
              <div key={restaurant.id} className="p-6 bg-white rounded-3xl shadow-md border border-gray-100">
                <h2 className="text-xl font-bold mb-2">{restaurant.name}</h2>
                <p className="text-gray-500 text-sm mb-4">
                  🚀 Доставка в радиусе {restaurant.delivery_radius} км
                </p>
                <Link href={`/restaurant/${restaurant.id}`} className="w-full">
  <button className="w-full bg-blue-500 text-white font-bold py-3 rounded-2xl active:scale-95 transition-all">
    Перейти к меню
  </button>
</Link>
              </div>
            ))
          ) : (
            <p className="text-center text-gray-400">Рестораны не найдены или загружаются...</p>
          )}
        </div>

      </div>
    </main>
  )
}