import { useState, useEffect, useCallback } from 'react';
import { Euro, DollarSign, PoundSterling, Sun, Moon, AlertCircle } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ExchangeRates {
  rates: {
    EUR: number;
    USD: number;
    GBP: number;
    CHF: number;
  };
}

type Currency = 'HUF' | 'EUR' | 'USD' | 'GBP' | 'CHF';

const FLAG_URLS = {
  HUF: 'https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/hu.svg',
  EUR: 'https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/eu.svg',
  USD: 'https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/us.svg',
  GBP: 'https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/gb.svg',
  CHF: 'https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/ch.svg',
} as const;

interface SortableCurrencyCardProps {
  currency: Currency;
  bgColor: string;
  darkBgColor: string;
  icon: React.ReactNode;
  isDarkMode: boolean;
  rates: ExchangeRates | null;
  amount: string;
  selectedCurrency: Currency;
}

function SortableCurrencyCard(props: SortableCurrencyCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.currency });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : 1,
  };

  const formatNumber = (value: number): string => {
    return new Intl.NumberFormat('hu-HU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getCurrencySymbol = (currency: Currency): string => {
    switch (currency) {
      case 'EUR': return '€';
      case 'USD': return '$';
      case 'GBP': return '£';
      case 'CHF': return '₣';
      default: return 'Ft';
    }
  };

  const getFlagForSymbol = (symbol: string): string => {
    switch (symbol) {
      case '€': return FLAG_URLS.EUR;
      case '$': return FLAG_URLS.USD;
      case '£': return FLAG_URLS.GBP;
      case '₣': return FLAG_URLS.CHF;
      case 'Ft': return FLAG_URLS.HUF;
      default: return FLAG_URLS.HUF;
    }
  };

  const calculateRate = (from: Currency, to: Currency, value: number): number => {
    if (!props.rates || !value) return 0;
    if (from === 'HUF' && to !== 'HUF') return value * props.rates.rates[to];
    if (from !== 'HUF' && to === 'HUF') return value / props.rates.rates[from];
    if (from !== 'HUF' && to !== 'HUF') return (value / props.rates.rates[from]) * props.rates.rates[to];
    return value;
  };

  if (!props.rates || props.currency === 'HUF') return null;

  const rate = formatNumber(1 / props.rates.rates[props.currency]);
  const isConvertingToHUF = props.selectedCurrency === props.currency;
  const convertedAmount = isConvertingToHUF
    ? `${formatNumber(calculateRate(props.currency, 'HUF', parseFloat(props.amount)))} Ft`
    : `${formatNumber(calculateRate(props.selectedCurrency, props.currency, parseFloat(props.amount)))} ${getCurrencySymbol(props.currency)}`;

  const displaySymbol = isConvertingToHUF ? 'Ft' : getCurrencySymbol(props.currency);
  const flagUrl = getFlagForSymbol(displaySymbol);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${props.isDarkMode ? props.darkBgColor : props.bgColor} p-6 rounded-2xl transition-all duration-200
        border ${props.isDarkMode ? 'border-zinc-700/50 hover:border-zinc-600' : 'border-stone-200 hover:border-stone-300'}
        hover:shadow-2xl animate-slide-up relative group cursor-grab active:cursor-grabbing
        ${isDragging ? 'shadow-2xl scale-105 opacity-90 ring-2 ring-cyan-500/50' : 'hover:scale-[1.02]'}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="animate-float">
            {props.icon}
          </div>
        </div>
        <img
          src={flagUrl}
          alt={`${displaySymbol} flag`}
          style={{
            width: '56px',
            height: '36px',
            objectFit: 'cover'
          }}
          className="shadow-md rounded-md border border-white/20"
        />
      </div>
      <div className="flex justify-between items-end">
        <span className={`text-4xl font-bold ${props.isDarkMode ? 'text-zinc-100' : 'text-stone-800'}`}>
          {rate}
        </span>
        <div className={`text-right ${props.isDarkMode ? 'text-zinc-400' : 'text-stone-600'}`}>
          {props.amount && (
            <div className="text-lg font-medium">
              {convertedAmount}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [amount, setAmount] = useState<string>('1');
  const [rates, setRates] = useState<ExchangeRates | null>(() => {
    const savedRates = localStorage.getItem('cachedRates');
    return savedRates ? JSON.parse(savedRates) : null;
  });
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('EUR');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currencyOrder, setCurrencyOrder] = useState<Currency[]>(() => {
    const savedOrder = localStorage.getItem('currencyOrder');
    return savedOrder ? JSON.parse(savedOrder) : ['EUR', 'USD', 'GBP', 'CHF'];
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const fetchRates = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('https://open.er-api.com/v6/latest/HUF');
      if (!response.ok) {
        throw new Error('Hálózati hiba');
      }
      const data = await response.json();
      const newRates = {
        rates: {
          EUR: data.rates.EUR,
          USD: data.rates.USD,
          GBP: data.rates.GBP,
          CHF: data.rates.CHF
        }
      };
      setRates(newRates);
      localStorage.setItem('cachedRates', JSON.stringify(newRates));
    } catch (err) {
      const cachedRates = localStorage.getItem('cachedRates');
      if (!cachedRates) {
        setError('Nem sikerült az árfolyamok betöltése. Kérlek, ellenőrizd az internetkapcsolatot!');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('currencyOrder', JSON.stringify(currencyOrder));
  }, [currencyOrder]);

  useEffect(() => {
    fetchRates();
    const interval = setInterval(fetchRates, 30000);
    return () => clearInterval(interval);
  }, [fetchRates]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9.]/g, '');
    if (value.length <= 12) {
      setAmount(value);
    }
  };

  const handleAmountAdjust = (increment: boolean) => {
    const currentValue = parseFloat(amount) || 0;
    const newValue = increment ? currentValue + 1 : currentValue - 1;
    if (newValue >= 0) {
      setAmount(newValue.toString());
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setCurrencyOrder((items) => {
        const oldIndex = items.indexOf(active.id as Currency);
        const newIndex = items.indexOf(over.id as Currency);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const getCurrencyCardProps = (currency: Currency) => {
    const currencyConfigs: Record<Exclude<Currency, 'HUF'>, { bgColor: string; darkBgColor: string; icon: JSX.Element }> = {
      EUR: {
        bgColor: 'bg-gradient-to-br from-amber-50 to-orange-50',
        darkBgColor: 'bg-gradient-to-br from-zinc-800 to-zinc-900',
        icon: <Euro className={`w-8 h-8 ${isDarkMode ? 'text-cyan-400' : 'text-amber-600'}`} />
      },
      USD: {
        bgColor: 'bg-gradient-to-br from-lime-50 to-emerald-50',
        darkBgColor: 'bg-gradient-to-br from-zinc-800 to-zinc-900',
        icon: <DollarSign className={`w-8 h-8 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
      },
      GBP: {
        bgColor: 'bg-gradient-to-br from-sky-50 to-cyan-50',
        darkBgColor: 'bg-gradient-to-br from-zinc-800 to-zinc-900',
        icon: <PoundSterling className={`w-8 h-8 ${isDarkMode ? 'text-sky-400' : 'text-sky-600'}`} />
      },
      CHF: {
        bgColor: 'bg-gradient-to-br from-rose-50 to-pink-50',
        darkBgColor: 'bg-gradient-to-br from-zinc-800 to-zinc-900',
        icon: <span className={`w-8 h-8 font-bold text-2xl ${isDarkMode ? 'text-rose-400' : 'text-rose-600'}`}>CHF</span>
      }
    };

    return {
      currency,
      ...currencyConfigs[currency as Exclude<Currency, 'HUF'>],
      isDarkMode,
      rates,
      amount,
      selectedCurrency,
    };
  };

  return (
    <div className={`min-h-screen ${
      isDarkMode
        ? 'bg-gradient-to-br from-zinc-950 via-neutral-900 to-zinc-950'
        : 'bg-gradient-to-br from-stone-100 via-amber-50/30 to-stone-100'
    } flex items-center justify-center p-4 transition-colors duration-500`}>
      <div className={`${
        isDarkMode ? 'bg-zinc-900/95 border border-zinc-800' : 'bg-white/90 border border-stone-200'
      } rounded-3xl shadow-2xl backdrop-blur-xl p-8 w-full max-w-md transition-all duration-300`}>
        <h1 className={`text-xs text-center mb-6 ${
          isDarkMode ? 'text-zinc-500' : 'text-stone-500'
        }`}>
          Élő devizaárfolyamok – EUR/HUF, USD/HUF, CHF/HUF, GBP/HUF
        </h1>

        <div className="flex justify-between items-start mb-6">
          <div className="animate-slide-up">
            <div className="flex items-center gap-4">
              <h2 className={`text-4xl font-bold tracking-tight ${
                isDarkMode ? 'text-zinc-100' : 'text-stone-800'
              } hover:text-cyan-500 transition-colors duration-300 drop-shadow-sm`}>
                <span className="font-black">€</span>
                <span className="font-medium tracking-tighter">HUF</span>
              </h2>
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`p-2.5 rounded-xl transition-all duration-500 transform hover:scale-110 ${
                  isDarkMode
                    ? 'bg-zinc-800 text-cyan-400 hover:bg-zinc-700 hover:text-cyan-300 border border-zinc-700'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 border border-stone-300'
                }`}
              >
                {isDarkMode ?
                  <Sun className="w-5 h-5 transition-transform duration-500 rotate-0 hover:rotate-90" /> :
                  <Moon className="w-5 h-5 transition-transform duration-500 rotate-0 hover:-rotate-12" />
                }
              </button>
            </div>
            <div className="mt-5 mb-6 flex gap-3 w-full">
              <div className="relative flex-1 min-w-0 flex">
                <button
                  onClick={() => handleAmountAdjust(false)}
                  className={`absolute left-0 top-0 bottom-0 px-3 rounded-l-xl transition-all z-10 ${
                    isDarkMode
                      ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-cyan-400 border border-zinc-700'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200 border border-stone-300'
                  }`}
                >
                  -
                </button>
                <input
                  type="text"
                  value={amount}
                  onChange={handleAmountChange}
                  className={`w-full py-3 px-11 text-lg text-center rounded-xl transition-all duration-300 border
                    focus:ring-2 focus:ring-cyan-500 focus:border-transparent ${
                    isDarkMode
                      ? 'bg-zinc-800/70 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                      : 'bg-stone-50 border-stone-300 text-stone-800 placeholder-stone-400'
                  }`}
                  placeholder="Összeg"
                />
                <button
                  onClick={() => handleAmountAdjust(true)}
                  className={`absolute right-0 top-0 bottom-0 px-3 rounded-r-xl transition-all z-10 ${
                    isDarkMode
                      ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-cyan-400 border border-zinc-700'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200 border border-stone-300'
                  }`}
                >
                  +
                </button>
              </div>
              <select
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value as Currency)}
                className={`w-32 py-3 px-4 text-lg text-center font-medium rounded-xl transition-all duration-300 border
                  focus:ring-2 focus:ring-cyan-500 focus:border-transparent ${
                  isDarkMode
                    ? 'bg-zinc-800/70 border-zinc-700 text-zinc-100'
                    : 'bg-stone-50 border-stone-300 text-stone-800'
                }`}
              >
                <option value="EUR">EUR</option>
                <option value="HUF">HUF</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {error && (
            <div className={`p-4 rounded-xl flex items-center gap-3 border ${
              isDarkMode ? 'bg-rose-950/30 border-rose-900/50 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}>
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {isLoading && !rates ? (
            <div className="grid grid-cols-1 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`p-6 rounded-2xl animate-pulse border ${
                    isDarkMode ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-stone-100 border-stone-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-8 h-8 rounded-full ${
                      isDarkMode ? 'bg-zinc-700' : 'bg-stone-300'
                    }`}></div>
                    <div className={`w-14 h-9 rounded ${
                      isDarkMode ? 'bg-zinc-700' : 'bg-stone-300'
                    }`}></div>
                  </div>
                  <div className={`w-24 h-10 rounded ${
                    isDarkMode ? 'bg-zinc-700' : 'bg-stone-300'
                  }`}></div>
                </div>
              ))}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={currencyOrder}
                strategy={verticalListSortingStrategy}
              >
                <div className="grid grid-cols-1 gap-4">
                  {currencyOrder.map((currency) => (
                    <SortableCurrencyCard
                      key={currency}
                      {...getCurrencyCardProps(currency)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="mt-6 space-y-4">
          <div className={`p-4 rounded-2xl transition-all duration-300 transform hover:scale-[1.02] border ${
            isDarkMode ? 'bg-zinc-800/50 border-zinc-700/50 hover:border-cyan-600/50' : 'bg-amber-50/50 border-stone-200 hover:border-amber-300'
          } hover:shadow-lg`}>
            <a
              href="https://revolut.com/referral/?referral-code=roland309s!MAR1-25-AR-H1"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center"
            >
              <p className={`text-sm ${isDarkMode ? 'text-zinc-300' : 'text-stone-600'}`}>
                💳 Nyiss Revolut számlát és használd az ingyenes nemzetközi utalásokat!
              </p>
            </a>
          </div>

          <p className={`text-sm text-center px-4 ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
            A megjelenített valutaárfolyam a középárfolyamot mutatja, amely bankoknál és pénzváltóknál kisebb mértékben eltérhet. Valuta eladásánál alacsonyabb, míg vásárlásnál magasabb árfolyamot alkalmaznak.
          </p>
          <div className={`text-center text-xs ${isDarkMode ? 'text-zinc-600' : 'text-stone-400'}`}>
            ⓒ 2025 Minusz
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;