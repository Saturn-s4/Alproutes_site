import { trackThrough, type TrackPoint } from '../lib/geo';

export type Loc = { ru: string; en: string };
export type Lang = keyof Loc;

export const CATEGORIES = ['1А', '1Б', '2А', '2Б', '3А', '3Б', '4А', '4Б', '5А', '5Б', '6А', '6Б'] as const;
export type Category = (typeof CATEGORIES)[number];
export type Character = 'rock' | 'snowice' | 'combined';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Visibility = 'public' | 'link' | 'private';

export interface ArchivePdf {
  title: Loc;
  year: number;
  meta: Loc;
}

export interface Leg {
  name: Loc;
  h: number;
}

export interface Route {
  id: string;
  peak: Loc;
  name: Loc;
  region: Loc;
  area: Loc;
  category: Category;
  height: number;
  seasons: Season[];
  character: Character;
  time: Loc;
  summit: [number, number];
  track: TrackPoint[] | null;
  tracksCount: number;
  photos: number;
  reviewsCount: number;
  pdfs: ArchivePdf[];
  legs: Leg[];
  description: Loc[];
  /** Set on routes created in this browser. */
  own?: { visibility: Visibility; draft: boolean; updated: string };
}

const l = (ru: string, en: string): Loc => ({ ru, en });

const PLACEHOLDER_TEXT: Loc[] = [
  l(
    '[Текстовое описание маршрута. Подход, точки ночёвок, акклиматизационные выходы, ключевые участки, спуск.]',
    '[Route description: approach, camps, acclimatisation, key sections, descent.]',
  ),
  l(
    '[Второй абзац: снаряжение, опасности, погодные окна, контакты спасслужбы района.]',
    '[Second paragraph: gear, hazards, weather windows, local rescue contacts.]',
  ),
];

const PLACEHOLDER_PDFS: ArchivePdf[] = [
  { title: l('[Описание маршрута]', '[Route description]'), year: 1987, meta: l('скан · 12 стр. · 4,1 МБ', 'scan · 12 pp. · 4.1 MB') },
  { title: l('[Отчёт о восхождении]', '[Ascent report]'), year: 2004, meta: l('скан · 28 стр. · 9,8 МБ', 'scan · 28 pp. · 9.8 MB') },
  { title: l('[Актуальное описание]', '[Current description]'), year: 2019, meta: l('PDF · 6 стр. · 1,2 МБ', 'PDF · 6 pp. · 1.2 MB') },
];

/*
 * Demo catalogue. Coordinates and tracks are approximate and exist only to drive
 * the interface until the routes come from the backend.
 */
export const DEMO_ROUTES: Route[] = [
  {
    id: 'elbrus-west-south',
    peak: l('Эльбрус Западный', 'Elbrus West'),
    name: l('Классика с юга, через седловину', 'Classic south route via the saddle'),
    region: l('Приэльбрусье', 'Elbrus area'),
    area: l('Центральный Кавказ', 'Central Caucasus'),
    category: '2А',
    height: 5642,
    seasons: ['summer'],
    character: 'combined',
    time: l('8–12 ч', '8–12 h'),
    summit: [43.3499, 42.4453],
    track: trackThrough([
      [43.3106, 42.4613, 3847],
      [43.3249, 42.4568, 4700],
      [43.3466, 42.4515, 5300],
      [43.3499, 42.4453, 5642],
    ]),
    tracksCount: 14,
    photos: 24,
    reviewsCount: 42,
    pdfs: PLACEHOLDER_PDFS,
    legs: [
      { name: l('Бочки — приют', 'Barrels — hut'), h: 3847 },
      { name: l('Скалы Пастухова', 'Pastukhov rocks'), h: 4700 },
      { name: l('Седловина', 'Saddle'), h: 5300 },
      { name: l('Вершина', 'Summit'), h: 5642 },
    ],
    description: PLACEHOLDER_TEXT,
  },
  {
    id: 'elbrus-east-north',
    peak: l('Эльбрус Восточный', 'Elbrus East'),
    name: l('С севера, от Джилы-Су', 'From the north, via Jily-Su'),
    region: l('Приэльбрусье', 'Elbrus area'),
    area: l('Центральный Кавказ', 'Central Caucasus'),
    category: '2А',
    height: 5621,
    seasons: ['summer'],
    character: 'snowice',
    time: l('10–14 ч', '10–14 h'),
    summit: [43.3527, 42.4586],
    track: trackThrough([
      [43.4386, 42.5222, 2380],
      [43.3927, 42.4867, 3800],
      [43.37, 42.47, 4700],
      [43.3527, 42.4586, 5621],
    ]),
    tracksCount: 6,
    photos: 11,
    reviewsCount: 18,
    pdfs: PLACEHOLDER_PDFS.slice(2),
    legs: [
      { name: l('Джилы-Су — северный приют', 'Jily-Su — north hut'), h: 3800 },
      { name: l('Скалы Ленца', 'Lenz rocks'), h: 4700 },
      { name: l('Вершина', 'Summit'), h: 5621 },
    ],
    description: PLACEHOLDER_TEXT,
  },
  {
    id: 'via-tau-ridge',
    peak: l('Виа-Тау', 'Via-Tau'),
    name: l('По гребню', 'Along the ridge'),
    region: l('Адыл-Су', 'Adyl-Su'),
    area: l('Центральный Кавказ', 'Central Caucasus'),
    category: '1Б',
    height: 3785,
    seasons: ['summer', 'autumn'],
    character: 'rock',
    time: l('6–8 ч', '6–8 h'),
    summit: [43.241, 42.533],
    track: trackThrough([
      [43.256, 42.514, 2350],
      [43.244, 42.528, 3200],
      [43.241, 42.533, 3785],
    ]),
    tracksCount: 3,
    photos: 8,
    reviewsCount: 27,
    pdfs: PLACEHOLDER_PDFS.slice(0, 1),
    legs: [
      { name: l('Альплагерь — ночёвки', 'Camp — bivouac'), h: 2900 },
      { name: l('Выход на гребень', 'Onto the ridge'), h: 3400 },
      { name: l('Вершина', 'Summit'), h: 3785 },
    ],
    description: PLACEHOLDER_TEXT,
  },
  {
    id: 'gumachi-pass',
    peak: l('Гумачи', 'Gumachi'),
    name: l('С перевала', 'From the pass'),
    region: l('Адыл-Су', 'Adyl-Su'),
    area: l('Центральный Кавказ', 'Central Caucasus'),
    category: '1Б',
    height: 3805,
    seasons: ['summer'],
    character: 'combined',
    time: l('7–9 ч', '7–9 h'),
    summit: [43.262, 42.558],
    track: trackThrough([
      [43.256, 42.514, 2350],
      [43.26, 42.545, 3300],
      [43.262, 42.558, 3805],
    ]),
    tracksCount: 2,
    photos: 5,
    reviewsCount: 9,
    pdfs: [],
    legs: [
      { name: l('Подход к перевалу', 'Approach to the pass'), h: 3300 },
      { name: l('Вершина', 'Summit'), h: 3805 },
    ],
    description: PLACEHOLDER_TEXT,
  },
  {
    id: 'kazbek-gergeti',
    peak: l('Казбек', 'Kazbek'),
    name: l('Через ледник Гергети', 'Via the Gergeti glacier'),
    region: l('Казбеги', 'Kazbegi'),
    area: l('Центральный Кавказ', 'Central Caucasus'),
    category: '2А',
    height: 5033,
    seasons: ['summer'],
    character: 'snowice',
    time: l('9–12 ч', '9–12 h'),
    summit: [42.6977, 44.5186],
    track: trackThrough([
      [42.6628, 44.6203, 2170],
      [42.6853, 44.5344, 3650],
      [42.692, 44.523, 4450],
      [42.6977, 44.5186, 5033],
    ]),
    tracksCount: 9,
    photos: 16,
    reviewsCount: 31,
    pdfs: PLACEHOLDER_PDFS.slice(1),
    legs: [
      { name: l('Гергети — метеостанция', 'Gergeti — weather station'), h: 3650 },
      { name: l('Плато', 'Plateau'), h: 4450 },
      { name: l('Вершина', 'Summit'), h: 5033 },
    ],
    description: PLACEHOLDER_TEXT,
  },
  {
    id: 'lenin-razdelnaya',
    peak: l('Пик Ленина', 'Lenin Peak'),
    name: l('По Раздельной', 'Via Razdelnaya'),
    region: l('Памир', 'Pamir'),
    area: l('Заалайский хребет', 'Trans-Alay Range'),
    category: '5А',
    height: 7134,
    seasons: ['summer'],
    character: 'snowice',
    time: l('14–20 дней', '14–20 days'),
    summit: [39.3444, 72.8775],
    track: null,
    tracksCount: 0,
    photos: 12,
    reviewsCount: 14,
    pdfs: PLACEHOLDER_PDFS,
    legs: [
      { name: l('Ачик-Таш — ABC', 'Achik-Tash — ABC'), h: 4400 },
      { name: l('Лагерь 2', 'Camp 2'), h: 5300 },
      { name: l('Пик Раздельная', 'Razdelnaya peak'), h: 6148 },
      { name: l('Вершина', 'Summit'), h: 7134 },
    ],
    description: PLACEHOLDER_TEXT,
  },
];

export const loc = (v: Loc, lang: Lang) => v[lang] || v.ru;

export function categoryIndex(c: Category) {
  return CATEGORIES.indexOf(c);
}
