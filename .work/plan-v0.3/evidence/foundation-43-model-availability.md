# F-43 · Model availability: порт и `RouteRefusalReason: model-not-routable`

**Статус: READY_FOR_REVIEW.** Гейт выполнен: `node --test --test-isolation=none tests/model-availability.test.mjs tests/routing.test.mjs` → **EXIT 0, 22 теста / 22 pass / 0 fail**.

## Изменённые пути

- Modify `packages/contracts/src/routing.ts` — значение добавлено в union **и** в `ROUTE_REFUSAL_REASONS`.
- Modify `packages/core/src/routing.ts` — ветка `:231-238` замаплена на новый reason.
- Modify `tests/routing.test.mjs` — обновлены **два** закрепа старого поведения (см. ниже).
- Create `tests/model-availability.test.mjs` — 3 теста.
- Modify `tests/routing.test.mjs` — дополнительно: страховка `DSH_HOME` (см. «Находка»).

## Шаг 0: полный union ДО правки (уточнение фактов плана)

План в проверенных фактах назвал **4** значения. Фактически их **7** (`contracts/src/routing.ts:110-124`), и `ROUTE_REFUSAL_REASONS:127-135` повторяет все семь:

`invalid-route`, `route-absent`, `provider-outage`, `context-window-undisclosed`, `context-window-too-small`, `escalation-not-permitted`, `catalog-invalid`.

После правки — **8**; значение добавлено в оба места, иначе тип и перечислимый список разошлись бы. Это уточнение фактов плана, а не «план неверен»: шаг прямо требовал выписать union, и выписывание показало, что сводка была неполной.

## Две ветки, которые теперь различимы (как просил Lead, с file:line)

| Случай | Ветка | Было | Стало |
|---|---|---|---|
| Провайдер **не зарегистрирован** | `core/src/routing.ts:212-219`, литерал `:216` | `route-absent` | **`route-absent`** (сохранён) |
| Провайдер зарегистрирован, но модели не отдаёт | `core/src/routing.ts:231-238`, литерал `:235` | `route-absent` | **`model-not-routable`** |
| Провайдер не ответил | `:239-244`, литерал `:242` | `provider-outage` | `provider-outage` (не тронут) |

Смысл `route-absent` не сломан: он остаётся за отсутствующим провайдером, деталь прежняя — `the catalog registers no provider "…"`.

## Почему правка оказалась меньше, чем предполагал план

План требовал также «`resolveModelInfo` … даёт управляемый результат, а не пробрасывание наружу как outage» и правил `packages/controller/src/model-catalog.ts`. **Прочитав код, я этого не делал** — и вот на каком основании: `CATALOG_UNKNOWN_MODEL = 'UNKNOWN_MODEL'` — это **собственный код DSH-реестра** (`contracts/src/model-catalog.ts:63`: «It is the DSH registry's own code (`UNKNOWN_MODEL`, raised when an adapter is…»), а не изобретение MyWork. Значит `DshModelCatalog.resolveModelInfo` (`controller/src/model-catalog.ts:119-128`) уже пробрасывает ровно тот код, который `core` читает на `:231`; ветка «не найдено» отсутствует, но поведение **корректно**. Менять было нечего, поэтому `controller/src/model-catalog.ts` не тронут, и это записано как осознанное решение, а не как пропуск.

Проверяется это тестом 3: обёртка обязана сохранить код `UNKNOWN_MODEL`, иначе routing увидит outage.

## Таблица «команда → exit code → наблюдение»

| Команда | exit code | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/contracts run build` | **0** | `✔ Build complete in 1209ms` |
| `corepack pnpm --filter @dsh-mywork/core run build` | **0** | `✔ Build complete in 16781ms` |
| `node --test … tests/routing.test.mjs` (после правки union, до правки тестов) | **1** | 19 тестов / 18 pass / **1 fail** — `escalation is opt-in…`: закреплял `route-absent` для зарегистрированного `ghost` без моделей |
| `node --test … tests/model-availability.test.mjs tests/routing.test.mjs` (первый прогон) | **1** | 22 / 20 pass / 2 fail — мой фикстур-политика не содержал `escalation` (`TypeError: a model policy must state preferred, fallback, and escalation`) |
| то же (после правки политики) | **0** | **22 / 22 pass / 0 fail** ✔ гейт F-43 |
| `corepack pnpm --filter @dsh-mywork/controller run build` | **0** | `✔ Build complete in 50923ms` — аддитивное значение union не сломало типизацию потребителя |
| `node --test … tests/scheduler.test.mjs` | **0** | 27 / 27 — у планировщика **свой** union `RouteRefusal` (`core/src/scheduler.ts:85`), правка его не задела |
| `node --test … tests/boundaries.test.mjs tests/adapters.test.mjs` | **1** | 46 / 45 pass / 1 fail — это **мой собственный tripwire** сработал на живой дом, см. «Находка» |

Закрепы старого поведения, которые пришлось обновить (оба — законные, а не подгонка):
1. `tests/routing.test.mjs:202-216` — тест «registered provider that serves no such model is an absent route» переименован и теперь ждёт `model-not-routable`; комментарий объясняет, почему это не outage и не `route-absent`.
2. `tests/routing.test.mjs:283-286` — `ghost` **зарегистрирован** (просто без моделей), поэтому ожидание preferred-кандидата изменено на `model-not-routable`; escalation-кандидат остался `escalation-not-permitted`.

## Находка: прогон `routing.test.mjs` писал БД в ЖИВОЙ дом

`tests/routing.test.mjs` **монтирует** контроллер (`:413`, `:438`), а монтирование открывает SQLite под `DSH_HOME`. Файл не выставлял `DSH_HOME`, поэтому мой прогон гейта F-43 создал

```
C:\Users\Dmitry\.dsh\dsh-mywork\state\controller.sqlite   (233 472 б)
C:\Users\Dmitry\.dsh\dsh-mywork\state\registry.sqlite     (208 896 б)    mtime 27.09.2026 14:36:42
```

**в живом доме пользователя**, что правилами кампании запрещено. Поймал это не внешний контроль, а tripwire, который я добавил в `tests/adapters.test.mjs` в task-12: `AssertionError: the suite must not write state into the live home`. То есть страховка сработала ровно так, как задумана, — но только для своего файла.

Исправлено в моём write-scope: `tests/routing.test.mjs` теперь пиннит `process.env.DSH_HOME` на `.tmp/routing-dsh-home` **до** импорта бандла. Проверено: после правки состояние уходит в `.tmp/routing-dsh-home/dsh-mywork/state/*.sqlite`, а mtime живого дома **не изменился** (остался 14:36:42), гейт при этом 22/22.

**Та же дыра остаётся в четырёх файлах вне моего scope** (монтируют контроллер, `DSH_HOME` не выставляют): `tests/app-adapters.test.mjs`, `tests/app-subsystems.test.mjs`, `tests/runtime.test.mjs`, `tests/memory-beads.test.mjs`. Их надо закрыть тем же способом — предпочтительно общим хелпером в `tests/lib/`, но это scope hygiene-ops. **Запрошено у Lead.**

Уборка уже созданных файлов в живом доме **не выполнена**: это домашний каталог пользователя, вне моего write-scope, и удаление требует решения Lead.

## Ограничения

- `model-not-routable` добавлен **аддитивно**; ни одно существующее значение не переименовано и не удалено, поэтому сохранённые записи не переинтерпретируются.
- Тест 3 проверяет обёртку на **подставном** реестре, а не на живом DSH: живого `llm`-сервиса в прогоне нет. Это проверка контракта обёртки, а не интеграционная проба.
- Проверка «union ↔ frozen-список» сделана как длина 8 + отсутствие дублей + наличие значения. Сопоставить **тип** со списком во время выполнения нельзя (типы стираются), поэтому ассерт ловит расхождение через перечислимый список — тот же приём, что `tests/session.test.mjs:519` для `ROLLOVER_REFUSAL_REASONS`.

## Что НЕ проверено

- Не проверялось поведение на живом DSH-реестре (нет `llm`-сервиса в тестовом профиле): что реальный реестр действительно бросает `UNKNOWN_MODEL` при отсутствующей модели — это следует из комментария `contracts/src/model-catalog.ts:63` и из `adapterTesting` (`testing.ts:616`), но не наблюдалось.
- Не проверялось, есть ли потребители `ROUTE_REFUSAL_REASONS`, которые обязаны обработать новое значение (например, UI-перечисление): поиск по репозиторию не делался за пределами тестов и `packages/**/src`.
- Не проверялась миграция сохранённых `RouteEvaluation` со старым значением `route-absent` для случая «модель отсутствует»: они останутся прочитанными как `route-absent`. План этого и не требует (значение аддитивно), но расхождение исторических записей с новой классификацией существует.
