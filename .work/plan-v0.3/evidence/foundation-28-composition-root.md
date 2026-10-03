# F-28 · Composition root: application service `myworkApplication`

**Статус: READY_FOR_REVIEW**

## Что сделано

1. Создан `packages/controller/src/app.ts` — единственный composition root: `createMyWorkApplication(options)` с `start()`/`stop()`, `readonly store?`, `readonly services`.
2. `apply` в `index.ts` создаёт приложение и регистрирует **один** `ctx.effect` (`'mywork controller shutdown'`) вместо двух раздельных; внутри одного эффекта: `service.stop()` → `await app.stop()` → `adapters.close()`.
3. `apply` стал `async` и **дожидается** `app.start()`: строка, которую смонтировали, либо полностью поднята, либо падает на монтировании (никакого «полумонтажа»).
4. Создан `tests/app-lifecycle.test.mjs` — 2 теста (гейт F-28).

## Изменённые пути

- Create `packages/controller/src/app.ts`
- Modify `packages/controller/src/index.ts` (`apply`, реэкспорт `app.ts`/`migration-allocator.ts`)
- Create `tests/app-lifecycle.test.mjs`

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node --test --test-isolation=none tests/app-lifecycle.test.mjs` | **0** | `ℹ tests 2 / ℹ pass 2 / ℹ fail 0 / ℹ skipped 0` — **гейт F-28** |
| Тест 1 | 0 | до `start()`: `store === undefined`, `services.length === 0`; после: `store !== undefined`, `services.length === 5`; `stop()` дважды не бросает |
| Тест 2 | 0 | `stop()` до `start()` — no-op; повторный `start()` не открывает вторую базу (`app.store` тот же объект) и не дублирует подсистемы |
| `tsc --noEmit -p packages/controller/tsconfig.json` | 0 | (после обвязки, выданной Lead'ом: paths/devDeps/alwaysBundle/install) |
| `corepack pnpm --filter @dsh-mywork/controller run build` | **0** | см. ограничение про память ниже |

## Что именно владеет жизненным циклом

- `app.ts` — **единственное** место с `openStore(` (ровно 2 вызова: `registry.sqlite` и `controller.sqlite`), поэтому «второй composition root» невозможен без явного нарушения гейта F-30.
- `index.ts` больше не держит собственных эффектов на `adapters`/`service`: жизненный цикл один — приложение, и оно же снимает свои регистрации в реестре адаптеров (F-31).
- Метка эффекта сохранена (`'mywork controller shutdown'`), потому что её проверяет существующий шаг smoke (`scripts/smoke.mjs`).

## Ограничения

- **Память сборки:** `alwaysBundle` из девяти внутренних пакетов + `dts: true` не укладываются в дефолтный heap — `FATAL ERROR: Ineffective mark-compacts near heap limit … Mark-Compact 6128.6 (6150.0) -> 6127.1 MB`, exit 134, `lib/` остаётся пустым (`clean: true` стирает до падения). С `NODE_OPTIONS=--max-old-space-size=12288` сборка проходит: `lib/index.js` 429,72 kB, `lib/index.d.ts` 139,16 kB, 43 с. Зафиксировано Lead'у: гейту F-46 нужен этот heap (или `dts: false`, или иной состав бандла).
- `apply` теперь async: если Cordis не дожидается промиса из `apply`, смонтированная строка может не иметь store в момент проверки. Это проверено шагом smoke (F-32) — он читает файл сразу после `await fiber.await()`.
- Живой профиль: `apply` резолвит layout из `DSH_HOME`/`~/.dsh`, поэтому любой тест, монтирующий контроллер без своего `DSH_HOME`, создаст `dsh-mywork/state/*.sqlite` в живом доме. `tests/adapters.test.mjs` монтирует контроллер и **не** выставляет `DSH_HOME` (файл не в моём write-scope) — это надо поправить владельцу (или Lead'у).

## Что НЕ проверено

- Поведение при отказе `openStore` в середине `start()` (например, каталог только для чтения): эффект уже зарегистрирован, `stop()` вызовется на dispose — тестом не покрыто.
- Поведение `apply` при `fiber.dispose()` во время незавершённого `start()`.
