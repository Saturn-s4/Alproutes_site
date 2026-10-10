import type { components } from './api/schema';

type AreaType = components['schemas']['AreaType'];
type LocalizedTextValue = components['schemas']['LocalizedText'];
type RouteTypeValue = components['schemas']['RouteType'];
type RouteFeatureKindValue = components['schemas']['RouteFeatureKind'];
type RightsStatusValue = components['schemas']['RightsStatus'];
type SourceTypeValue = components['schemas']['Document']['sourceType'];
import type { Lang } from './prefs';

const ru = {
  'nav.map': 'Карта',
  'nav.catalog': 'Каталог',
  'nav.main': 'Основная навигация',
  'header.lang': 'Язык',
  'header.theme': 'Тема',
  'header.signIn': 'Войти',
  'header.signOut': 'Выйти',
  'theme.system': 'Как в системе',
  'theme.dark': 'Тёмная',
  'theme.light': 'Светлая',

  'common.noData': 'нет данных',
  'common.loading': 'Загрузка…',
  'common.error': 'Не удалось загрузить данные',
  'common.retry': 'Повторить',
  'common.more': 'Показать ещё',
  'common.m': 'м',
  'common.km': 'км',
  'common.translationMissing': 'перевода нет, показан оригинал',

  'map.inView': 'В этой области',
  'map.empty': 'В этой области нет маршрутов с геометрией. Сдвиньте карту или откройте каталог.',
  'map.pickRoute': 'Выберите маршрут на карте или в списке.',
  'map.zoomIn': 'Приблизить',
  'map.zoomOut': 'Отдалить',
  'map.truncated': 'Показаны не все маршруты — приблизьте карту',

  'catalog.title': 'Каталог',
  'catalog.areas': 'Районы',
  'catalog.recent': 'Недавно обновлённые маршруты',
  'catalog.noAreas': 'Районов пока нет.',
  'catalog.noRoutes': 'Маршрутов пока нет.',

  'area.subareas': 'Вложенные районы',
  'area.routes': 'Маршруты',
  'area.elevation': 'Высота',
  'area.noRoutes': 'В этом районе пока нет опубликованных маршрутов.',

  'route.grades': 'Категории',
  'route.noGrade': 'Категория не указана',
  'route.type': 'Тип',
  'route.traverse': 'Траверс',
  'route.gain': 'Перепад',
  'route.length': 'Протяжённость',
  'route.season': 'Сезон',
  'route.firstAscent': 'Первопроходцы',
  'route.firstAscentYear': 'Год первопрохождения',
  'route.sources': 'Источники данных',
  'route.description': 'Описание',
  'route.noDescription': 'Описания пока нет.',
  'route.map': 'Геометрия',
  'route.noGeometry': 'У маршрута нет геометрии: он есть в каталоге района, но не на карте.',
  'route.open': 'Открыть страницу маршрута',
  'route.revision': 'Ревизия',
  'route.updated': 'Обновлено',
  'route.yes': 'да',
  'route.no': 'нет',
  'route.stats': 'Материалы',
  'route.photos': 'Фото',
  'route.tracks': 'Треки',
  'route.ascents': 'Восхождения',
  'route.comments': 'Комментарии',
  'route.documents': 'Документы',
  'route.draft': 'Черновик: ещё не прошёл модерацию',
  'route.hidden': 'Скрыт модератором',
  'route.userPhotos': 'Фото участников',
  'route.noUserPhotos': 'Участники пока не добавили фото.',
  'route.archive': 'Архивные описания',

  'photo.close': 'Закрыть',
  'photo.prev': 'Предыдущее фото',
  'photo.next': 'Следующее фото',

  'doc.none': 'Архивных описаний с выясненным правовым статусом пока нет.',
  'doc.open': 'Открыть',
  'doc.close': 'Свернуть',
  'doc.download': 'Скачать PDF',
  'doc.source': 'Источник',
  'doc.pages': 'стр.',

  'disclaimer.title': 'Важно',
  'disclaimer.text':
    'Описание не гарантирует безопасность. Условия на маршруте меняются: снег, лёд, камнепады, погода. Решение о выходе и ответственность — на восходителе.',

  'login.title': 'Вход',
  'login.devNote': 'Локальная разработка: вход без OAuth через dev-профиль backend. Вход через Google и Apple появится позже.',
  'login.email': 'Email',
  'login.name': 'Имя',
  'login.role': 'Роль',
  'login.submit': 'Войти',
  'login.devUnavailable': 'Dev-вход недоступен: backend запущен не в профиле dev.',
  'login.failed': 'Не удалось войти',
  'login.signedInAs': 'Вы вошли как',

  'notFound.title': 'Страница не найдена',
  'notFound.back': 'На карту',
} as const;

export type MessageKey = keyof typeof ru;

const en: Record<MessageKey, string> = {
  'nav.map': 'Map',
  'nav.catalog': 'Catalogue',
  'nav.main': 'Main navigation',
  'header.lang': 'Language',
  'header.theme': 'Theme',
  'header.signIn': 'Sign in',
  'header.signOut': 'Sign out',
  'theme.system': 'System',
  'theme.dark': 'Dark',
  'theme.light': 'Light',

  'common.noData': 'no data',
  'common.loading': 'Loading…',
  'common.error': 'Failed to load data',
  'common.retry': 'Retry',
  'common.more': 'Show more',
  'common.m': 'm',
  'common.km': 'km',
  'common.translationMissing': 'no translation, original shown',

  'map.inView': 'In this area',
  'map.empty': 'No routes with geometry here. Move the map or open the catalogue.',
  'map.pickRoute': 'Pick a route on the map or in the list.',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.truncated': 'Not all routes are shown — zoom in',

  'catalog.title': 'Catalogue',
  'catalog.areas': 'Areas',
  'catalog.recent': 'Recently updated routes',
  'catalog.noAreas': 'No areas yet.',
  'catalog.noRoutes': 'No routes yet.',

  'area.subareas': 'Sub-areas',
  'area.routes': 'Routes',
  'area.elevation': 'Elevation',
  'area.noRoutes': 'No published routes in this area yet.',

  'route.grades': 'Grades',
  'route.noGrade': 'Grade not specified',
  'route.type': 'Type',
  'route.traverse': 'Traverse',
  'route.gain': 'Elevation gain',
  'route.length': 'Length',
  'route.season': 'Season',
  'route.firstAscent': 'First ascent',
  'route.firstAscentYear': 'First ascent year',
  'route.sources': 'Data sources',
  'route.description': 'Description',
  'route.noDescription': 'No description yet.',
  'route.map': 'Geometry',
  'route.noGeometry': 'This route has no geometry: it is listed in its area but not on the map.',
  'route.open': 'Open route page',
  'route.revision': 'Revision',
  'route.updated': 'Updated',
  'route.yes': 'yes',
  'route.no': 'no',
  'route.stats': 'Materials',
  'route.photos': 'Photos',
  'route.tracks': 'Tracks',
  'route.ascents': 'Ascents',
  'route.comments': 'Comments',
  'route.documents': 'Documents',
  'route.draft': 'Draft: not yet reviewed',
  'route.hidden': 'Hidden by a moderator',
  'route.userPhotos': 'Participants\' photos',
  'route.noUserPhotos': 'No participant photos yet.',
  'route.archive': 'Archival descriptions',

  'photo.close': 'Close',
  'photo.prev': 'Previous photo',
  'photo.next': 'Next photo',

  'doc.none': 'No archival descriptions with a cleared rights status yet.',
  'doc.open': 'Open',
  'doc.close': 'Collapse',
  'doc.download': 'Download PDF',
  'doc.source': 'Source',
  'doc.pages': 'pp.',

  'disclaimer.title': 'Important',
  'disclaimer.text':
    'This description does not guarantee safety. Conditions change: snow, ice, rockfall, weather. The decision to go and the responsibility rest with the climber.',

  'login.title': 'Sign in',
  'login.devNote': 'Local development: sign in without OAuth via the backend dev profile. Google and Apple sign-in come later.',
  'login.email': 'Email',
  'login.name': 'Name',
  'login.role': 'Role',
  'login.submit': 'Sign in',
  'login.devUnavailable': 'Dev sign-in is unavailable: the backend is not running with the dev profile.',
  'login.failed': 'Sign-in failed',
  'login.signedInAs': 'Signed in as',

  'notFound.title': 'Page not found',
  'notFound.back': 'Back to map',
};

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ru, en };

export function translator(lang: Lang) {
  const dict = dictionaries[lang];
  return (key: MessageKey) => dict[key];
}

export type Translate = ReturnType<typeof translator>;

/**
 * Picks a translation: interface language → ru → any available (contract rule).
 * `fallback` tells the UI the text is not in the interface language.
 */
export function loc(
  text: LocalizedTextValue | undefined | null,
  lang: Lang,
): { text: string; lang: string; fallback: boolean } | null {
  if (!text) return null;
  const own = text[lang];
  if (own) return { text: own, lang, fallback: false };
  const code = text.ru ? 'ru' : Object.keys(text).find((k) => text[k]);
  return code ? { text: text[code] as string, lang: code, fallback: true } : null;
}

/** Same as `loc` but returns plain text, for titles and labels. */
export function locText(text: LocalizedTextValue | undefined | null, lang: Lang): string {
  return loc(text, lang)?.text ?? '';
}

const areaTypes: Record<AreaType, [string, string]> = {
  mountain_system: ['Горная система', 'Mountain system'],
  region: ['Район', 'Region'],
  ridge: ['Хребет', 'Ridge'],
  massif: ['Массив', 'Massif'],
  summit: ['Вершина', 'Summit'],
  other: ['Другое', 'Other'],
};

const routeTypes: Record<RouteTypeValue, [string, string]> = {
  rock: ['Скальный', 'Rock'],
  snow_ice: ['Снежно-ледовый', 'Snow/ice'],
  combined: ['Комбинированный', 'Mixed'],
};

const featureKinds: Record<RouteFeatureKindValue, [string, string]> = {
  start: ['Начало маршрута', 'Route start'],
  summit: ['Вершина', 'Summit'],
  bivouac: ['Ночёвка', 'Bivouac'],
  descent_start: ['Начало спуска', 'Descent start'],
  route_line: ['Нитка маршрута', 'Route line'],
  approach: ['Подход', 'Approach'],
  descent: ['Спуск', 'Descent'],
};

const rightsStatuses: Record<RightsStatusValue, [string, string]> = {
  unknown: ['права не выяснены', 'rights unknown'],
  public_domain: ['общественное достояние', 'public domain'],
  licensed: ['открытая лицензия', 'open licence'],
  permission_granted: ['с разрешения правообладателя', 'by permission'],
  own_work: ['работа автора загрузки', 'uploader\'s own work'],
  restricted: ['публикация запрещена', 'restricted'],
};

const sourceTypes: Record<SourceTypeValue, [string, string]> = {
  classifier: ['Классификатор', 'Classifier'],
  ascent_report: ['Отчёт о восхождении', 'Ascent report'],
  guidebook: ['Путеводитель', 'Guidebook'],
  periodical: ['Периодика', 'Periodical'],
  other: ['Другое', 'Other'],
};

const idx = (lang: Lang) => (lang === 'ru' ? 0 : 1);

export const rightsLabel = (v: RightsStatusValue, lang: Lang) => rightsStatuses[v][idx(lang)];
export const sourceTypeLabel = (v: SourceTypeValue, lang: Lang) => sourceTypes[v][idx(lang)];

export const areaTypeLabel = (v: AreaType, lang: Lang) => areaTypes[v][idx(lang)];
export const routeTypeLabel = (v: RouteTypeValue, lang: Lang) => routeTypes[v][idx(lang)];
export const featureKindLabel = (v: RouteFeatureKindValue, lang: Lang) => featureKinds[v][idx(lang)];

export function monthName(m: number, lang: Lang) {
  return new Intl.DateTimeFormat(lang, { month: 'short' }).format(new Date(Date.UTC(2000, m - 1, 1)));
}

export function formatDate(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
}

export function formatInt(n: number, lang: Lang) {
  return new Intl.NumberFormat(lang).format(n);
}

const routeWords: Record<Lang, Partial<Record<Intl.LDMLPluralRule, string>>> = {
  ru: { one: 'маршрут', few: 'маршрута', many: 'маршрутов', other: 'маршрута' },
  en: { one: 'route', other: 'routes' },
};

/** "1 маршрут", "2 маршрута", "5 маршрутов". */
export function routeCount(n: number, lang: Lang) {
  const form = new Intl.PluralRules(lang).select(n);
  return `${formatInt(n, lang)} ${routeWords[lang][form] ?? routeWords[lang].other}`;
}
