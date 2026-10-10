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
  'catalog.routesTitle': 'Каталог маршрутов',
  'catalog.filters': 'Фильтры',
  'catalog.category': 'Категория',
  'catalog.gradeSystem': 'Система категорий',
  'catalog.gradeNote': 'Маршруты без категории в системе {system} не показываются.',
  'catalog.region': 'Район',
  'catalog.allRegions': 'Все районы',
  'catalog.openArea': 'Страница района',
  'catalog.materials': 'Материалы',
  'catalog.reset': 'Сбросить фильтры',
  'catalog.sort': 'Сортировка',
  'catalog.sort.name': 'По названию',
  'catalog.sort.grade': 'По категории',
  'catalog.sort.gain': 'По перепаду',
  'catalog.sort.updated': 'Новые',
  'catalog.noPhoto': '[фото]',
  'catalog.nextPage': 'Дальше',
  'catalog.firstPage': 'В начало',
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

  'nav.moderation': 'Модерация',
  'ed.edit': 'Редактировать',
  'ed.newRoute': 'Новый маршрут',
  'ed.editRoute': 'Правка маршрута',
  'ed.newArea': 'Новый район',
  'ed.newSubarea': 'Вложенный район',
  'ed.editArea': 'Редактировать район',
  'ed.signIn': 'Чтобы предлагать маршруты и правки, войдите.',
  'ed.moderatorsOnly': 'Это действие доступно только модераторам.',
  'ed.loadFailed': 'Не удалось загрузить данные для правки.',
  'ed.saveFailed': 'Не удалось сохранить',
  'ed.fixErrors': 'Исправьте отмеченные поля.',
  'ed.factsRule': 'Заполняйте только то, что подтверждено источником. Если данных нет — оставьте поле пустым: «нет данных» лучше выдуманной категории, перепада или координаты.',
  'ed.main': 'Основное',
  'ed.facts': 'Характеристики',
  'ed.area': 'Район',
  'ed.areaSearch': 'Начните вводить название района…',
  'ed.areaRequired': 'Выберите район',
  'ed.change': 'Изменить',
  'ed.name': 'Название',
  'ed.nameRequired': 'Нужно название хотя бы на одном языке',
  'ed.slug': 'Адрес страницы (slug)',
  'ed.slugHint': 'Необязательно: сервер сделает его из названия.',
  'ed.slugAreaHint': 'Строчные латинские буквы, цифры и дефисы.',
  'ed.gradesHint': 'Каждая категория — в своей системе, не больше одной на систему. Не переводите категории между системами.',
  'ed.addGrade': '+ Добавить категорию',
  'ed.gradeValueRequired': 'Выберите значение категории',
  'ed.seasonHint': 'Ничего не выбрано — «нет данных».',
  'ed.sourcesHint': 'Откуда взяты данные: классификатор, отчёт, путеводитель.',
  'ed.descriptionPhotos': 'Фото в описании',
  'ed.descriptionPhotosHint': 'Порядок и подписи сохраняются в ревизии вместе с описанием.',
  'ed.addFromGallery': 'Добавить из фото маршрута:',
  'ed.noRoutePhotos': 'У маршрута пока нет загруженных фото.',
  'ed.photoUnavailable': 'Фото недоступно (удалено или скрыто)',
  'ed.photosAfterCreate': 'Фото в описание добавляются после создания маршрута: сначала их нужно загрузить к нему.',
  'ed.summary': 'Что изменено',
  'ed.summaryHint': 'Коротко для модератора: «уточнил спуск по отчёту 2019 г.»',
  'ed.publishNow': 'Сразу опубликовать (модератор)',
  'ed.submit': 'Отправить на модерацию',
  'ed.savePublish': 'Сохранить и опубликовать',
  'ed.save': 'Сохранить',
  'ed.conflict': 'Маршрут изменили, пока вы его редактировали. Сравните с текущей версией и перенесите свои правки.',
  'ed.seeCurrent': 'Открыть текущую ревизию',
  'ed.parentArea': 'Родительский район',
  'ed.parentHint': 'Пусто — район верхнего уровня.',
  'ed.areaType': 'Тип',
  'ed.elevationHint': 'Только если высота подтверждена источником.',
  'ed.center': 'Центр на карте',
  'ed.centerHint': 'Кликните по карте.',
  'ed.status': 'Статус',
  'ed.status.published': 'Опубликован',
  'ed.status.draft': 'Черновик',
  'ed.status.hidden': 'Скрыт',
  'geo.points': 'Точки',
  'geo.lines': 'Линии',
  'geo.finish': 'Готово',
  'geo.undo': 'Отменить точку',
  'geo.cancel': 'Отмена',
  'geo.delete': 'Удалить',
  'geo.up': 'Выше',
  'geo.down': 'Ниже',
  'geo.vertices': 'точ.',
  'geo.elevation': 'Высота по описанию, м',
  'geo.note': 'Примечание',
  'geo.none': 'Геометрии нет. Маршрут без геометрии виден в каталоге района, но не на карте.',
  'geo.hintEmpty': 'Выберите точку или линию сверху и кликните по карте',
  'geo.hintSelect': 'Клик — выбрать, перетаскивание — сдвинуть, правый клик по вершине — удалить её',
  'geo.hintPoint': 'Кликните по карте, чтобы поставить точку',
  'geo.hintLine': 'Кликайте по карте; Enter или двойной клик — закончить, Esc — отмена',
  'rev.history': 'История правок',
  'rev.missing': 'Ревизия не найдена или недоступна.',
  'rev.current': 'Опубликована сейчас',
  'rev.status.pending': 'На модерации',
  'rev.status.approved': 'Одобрена',
  'rev.status.rejected': 'Отклонена',
  'rev.revertCopy': 'откат',
  'rev.reviewedBy': 'Рассмотрел',
  'rev.moderateHint': 'Проверьте изменения по источникам. Одобрение публикует ревизию.',
  'rev.notePlaceholder': 'Комментарий (для отклонения и отката обязателен)',
  'rev.noteRequired': 'Укажите причину.',
  'rev.approve': 'Одобрить и опубликовать',
  'rev.reject': 'Отклонить',
  'rev.revert': 'Откатить к этой ревизии',
  'rev.editFrom': 'Предложить правку на основе этой версии',
  'rev.stale': 'После этой правки опубликована другая ревизия: одобрение затёрло бы чужие изменения. Отклоните правку или попросите автора пересоздать её.',
  'rev.changes': 'Изменения',
  'rev.firstRevision': 'Первая ревизия маршрута — сравнивать не с чем.',
  'rev.noChanges': 'Содержимое не отличается от базовой ревизии.',
  'rev.field': 'Поле',
  'rev.before': 'Было',
  'rev.after': 'Стало',
  'rev.objects': 'объектов',
  'rev.geometryChanged': 'геометрия изменена',
  'rev.empty': 'нет',
  'rev.noSummary': 'Без описания изменений',
  'mod.title': 'Модерация',
  'mod.revisions': 'Правки маршрутов',
  'mod.noRevisions': 'Очередь пуста.',
  'mod.new': 'новый',
  'mod.documents': 'Документы без проверки прав',
  'mod.noDocuments': 'Все документы проверены.',
  'mod.rightsNote': 'Лицензия, разрешение или основание',
  'mod.publish': 'Опубликовать',
  'mod.keepHidden': 'Сохранить скрытым',
  'mod.rightsRule': 'Архивные описания из классификаторов, как правило, защищены авторским правом. Публикуйте только с выясненным правовым статусом.',

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
  'catalog.routesTitle': 'Route catalogue',
  'catalog.filters': 'Filters',
  'catalog.category': 'Grade',
  'catalog.gradeSystem': 'Grading system',
  'catalog.gradeNote': 'Routes without a grade in {system} are not shown.',
  'catalog.region': 'Area',
  'catalog.allRegions': 'All areas',
  'catalog.openArea': 'Area page',
  'catalog.materials': 'Materials',
  'catalog.reset': 'Reset filters',
  'catalog.sort': 'Sort',
  'catalog.sort.name': 'By name',
  'catalog.sort.grade': 'By grade',
  'catalog.sort.gain': 'By elevation gain',
  'catalog.sort.updated': 'Newest',
  'catalog.noPhoto': '[photo]',
  'catalog.nextPage': 'Next',
  'catalog.firstPage': 'First page',
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

  'nav.moderation': 'Moderation',
  'ed.edit': 'Edit',
  'ed.newRoute': 'New route',
  'ed.editRoute': 'Edit route',
  'ed.newArea': 'New area',
  'ed.newSubarea': 'Sub-area',
  'ed.editArea': 'Edit area',
  'ed.signIn': 'Sign in to propose routes and edits.',
  'ed.moderatorsOnly': 'Only moderators can do this.',
  'ed.loadFailed': 'Failed to load data for editing.',
  'ed.saveFailed': 'Failed to save',
  'ed.fixErrors': 'Fix the highlighted fields.',
  'ed.factsRule': 'Fill in only what a source confirms. If there is no data, leave the field empty: "no data" beats an invented grade, elevation or coordinate.',
  'ed.main': 'Main',
  'ed.facts': 'Facts',
  'ed.area': 'Area',
  'ed.areaSearch': 'Start typing an area name…',
  'ed.areaRequired': 'Choose an area',
  'ed.change': 'Change',
  'ed.name': 'Name',
  'ed.nameRequired': 'A name in at least one language is required',
  'ed.slug': 'Page address (slug)',
  'ed.slugHint': 'Optional: the server derives it from the name.',
  'ed.slugAreaHint': 'Lowercase Latin letters, digits and hyphens.',
  'ed.gradesHint': 'Each grade in its own system, at most one per system. Do not convert grades between systems.',
  'ed.addGrade': '+ Add grade',
  'ed.gradeValueRequired': 'Choose a grade value',
  'ed.seasonHint': 'Nothing selected means "no data".',
  'ed.sourcesHint': 'Where the data comes from: classifier, report, guidebook.',
  'ed.descriptionPhotos': 'Photos in the description',
  'ed.descriptionPhotosHint': 'Order and captions are saved in the revision together with the description.',
  'ed.addFromGallery': 'Add from the route photos:',
  'ed.noRoutePhotos': 'No photos have been uploaded to this route yet.',
  'ed.photoUnavailable': 'Photo unavailable (deleted or hidden)',
  'ed.photosAfterCreate': 'Photos are added to the description after the route is created: they are uploaded to the route first.',
  'ed.summary': 'What changed',
  'ed.summaryHint': 'A short note for the moderator: "fixed the descent per the 2019 report"',
  'ed.publishNow': 'Publish right away (moderator)',
  'ed.submit': 'Submit for review',
  'ed.savePublish': 'Save and publish',
  'ed.save': 'Save',
  'ed.conflict': 'The route was changed while you were editing. Compare with the current version and carry your edits over.',
  'ed.seeCurrent': 'Open the current revision',
  'ed.parentArea': 'Parent area',
  'ed.parentHint': 'Empty means a top-level area.',
  'ed.areaType': 'Type',
  'ed.elevationHint': 'Only if a source confirms the elevation.',
  'ed.center': 'Centre on the map',
  'ed.centerHint': 'Click the map.',
  'ed.status': 'Status',
  'ed.status.published': 'Published',
  'ed.status.draft': 'Draft',
  'ed.status.hidden': 'Hidden',
  'geo.points': 'Points',
  'geo.lines': 'Lines',
  'geo.finish': 'Done',
  'geo.undo': 'Undo point',
  'geo.cancel': 'Cancel',
  'geo.delete': 'Delete',
  'geo.up': 'Up',
  'geo.down': 'Down',
  'geo.vertices': 'pts',
  'geo.elevation': 'Elevation per description, m',
  'geo.note': 'Note',
  'geo.none': 'No geometry. A route without geometry is listed in its area but not on the map.',
  'geo.hintEmpty': 'Pick a point or a line above and click the map',
  'geo.hintSelect': 'Click to select, drag to move, right-click a vertex to delete it',
  'geo.hintPoint': 'Click the map to place the point',
  'geo.hintLine': 'Click the map; Enter or double-click to finish, Esc to cancel',
  'rev.history': 'Edit history',
  'rev.missing': 'Revision not found or not available.',
  'rev.current': 'Currently published',
  'rev.status.pending': 'Under review',
  'rev.status.approved': 'Approved',
  'rev.status.rejected': 'Rejected',
  'rev.revertCopy': 'revert',
  'rev.reviewedBy': 'Reviewed by',
  'rev.moderateHint': 'Check the changes against the sources. Approval publishes the revision.',
  'rev.notePlaceholder': 'Comment (required to reject or revert)',
  'rev.noteRequired': 'Give a reason.',
  'rev.approve': 'Approve and publish',
  'rev.reject': 'Reject',
  'rev.revert': 'Revert to this revision',
  'rev.editFrom': 'Propose an edit based on this version',
  'rev.stale': 'Another revision was published after this edit: approving would overwrite those changes. Reject it or ask the author to redo it.',
  'rev.changes': 'Changes',
  'rev.firstRevision': 'First revision of the route: nothing to compare with.',
  'rev.noChanges': 'Content is identical to the base revision.',
  'rev.field': 'Field',
  'rev.before': 'Before',
  'rev.after': 'After',
  'rev.objects': 'objects',
  'rev.geometryChanged': 'geometry changed',
  'rev.empty': 'none',
  'rev.noSummary': 'No change summary',
  'mod.title': 'Moderation',
  'mod.revisions': 'Route edits',
  'mod.noRevisions': 'The queue is empty.',
  'mod.new': 'new',
  'mod.documents': 'Documents awaiting a rights decision',
  'mod.noDocuments': 'All documents have been reviewed.',
  'mod.rightsNote': 'Licence, permission or basis',
  'mod.publish': 'Publish',
  'mod.keepHidden': 'Keep hidden',
  'mod.rightsRule': 'Archival classifier descriptions are usually copyrighted. Publish only with a cleared rights status.',

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

/** "маршрут" / "маршрута" / "маршрутов" for n. */
export function routeWord(n: number, lang: Lang) {
  const form = new Intl.PluralRules(lang).select(n);
  return routeWords[lang][form] ?? routeWords[lang].other ?? '';
}

/** "1 маршрут", "2 маршрута", "5 маршрутов". */
export function routeCount(n: number, lang: Lang) {
  return `${formatInt(n, lang)} ${routeWord(n, lang)}`;
}
