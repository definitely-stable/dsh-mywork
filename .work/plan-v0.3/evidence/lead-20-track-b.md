# Трек B · Один коммит: R-52 (гейт цитат в CI и в корневом `check`), R-51 (сверка права живого профиля), якорь README:103→104

**Статус: READY_FOR_REVIEW.** Коммит — по явному указанию владельца («После A — один коммит кода (трек B)»).
База: `4421c13`, дерево до правок чистое. Дата: 2026-10-03.

## Что сделано

1. **R-52a — гейт цитат в корневом `check`**: в `package.json` шаг `pnpm run check:plan` добавлен последним в `check`.
2. **R-52b — гейт цитат в CI**: в `.github/workflows/ci.yml` (job `build-test`, сразу после Typecheck) добавлен шаг
   `Plan citation gate` → `node scripts/check-plan-citations.mjs`.
3. **R-54 — вскрытое препятствие к R-52b**: корпус плана лежит в `.work/plan-v0.3`, а `.work/` целиком в `.gitignore`,
   поэтому у любого checkout'а (в том числе CI) корпуса нет и скрипт завершался **exit 2** (`plan directory not found`) —
   буквальное подключение дало бы красный CI вместо гейта. Скрипт получил второй явный охват:
   `scope=full` (корпус найден, всё как раньше) и `scope=repository-only` (корпуса нет: проверяются отслеживаемые
   поверхности `README.md` и два манифеста, корпусные положительные контроли печатаются как `control(skipped)`,
   охват виден в строке PASS и в `--json`). Явно переданный `--plan-dir` без каталога остался **exit 2** —
   опечатка не должна зеленеть.
4. **R-51 — сверка права живого профиля**: новый модуль `scripts/lib/profile-permission.mjs` + шаг 9 в
   `scripts/verify-profile.mjs`. Проверяется: у строки `web-ui-task-board` ключ `sessionDefaultPermission` стоит
   **рядом с `plugin`** (а не вложен), значение — `workspace-write`, ключей `autoRun*` — ноль. Профиль без строки
   доски и отсутствие профиля — **пропуск**, а не падение (на чистом CI-раннере профиля нет вовсе).
5. **Тесты к обоим правилам** (негативные фикстуры, чтобы правило, переставшее кусаться, валило прогон):
   `tests/live-profile-permission.test.mjs` (9 кейсов) и `tests/plan-citations-gate.test.mjs` (5 кейсов,
   запускают **копию** гейта в одноразовом «репозитории»).
6. **Якорь**: `packages/controller/src/telemetry.ts:16` — `product-telemetry-otel/README.md:103` → `:104`
   (в чекауте цитата «Caller-selected strings are not redacted automatically…» лежит на строке **104**; других
   вхождений этого якоря в репозитории нет — проверено `grep`).
7. **Комментарии вместо обещаний**: шапка `verify-profile.mjs` описывает новый шаг и его границу; в `ci.yml`
   написано, почему шаг в CI имеет охват `repository-only`.

## Изменённые файлы (все — под один коммит)

| Файл | Что |
| --- | --- |
| `package.json` | `check` += `&& pnpm run check:plan` |
| `.github/workflows/ci.yml` | шаг `Plan citation gate` в `build-test` |
| `scripts/check-plan-citations.mjs` | два охвата, `--plan-dir` явный → fail-closed, `scope`/`skippedControls` в отчёте и JSON |
| `scripts/lib/profile-permission.mjs` | новый модуль (R-51), чистые функции над текстом |
| `scripts/verify-profile.mjs` | шаг 9 + импорты + абзац в шапке |
| `tests/live-profile-permission.test.mjs` | новый, 9 кейсов |
| `tests/plan-citations-gate.test.mjs` | новый, 5 кейсов |
| `packages/controller/src/telemetry.ts` | якорь `:103` → `:104` |
| `docs/ops/profile-restore.md` | процедура восстановления под снимок 2026-10-03 (трек A, F-03) |

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `corepack pnpm -r run typecheck` | **0** | **15/15** проектов (`typecheck: Done`), включая `packages/controller` |
| `corepack pnpm -r run build` | **0** | сборка всех пакетов, `packages/controller lib\index.js 607.87 kB` |
| `corepack pnpm run build` (корневой скрипт) | **1** | **не мой дефект, а R-06/F-01**: тело скрипта — `pnpm -r run build`, вложенный bare `pnpm` берётся из PATH и попадает в `.bin` DSH-чекаута (v11.7.0), который отказывается работать при `packageManager: pnpm@12.4.2` («Your current pnpm is v11.7.0»). Рабочая форма — `-r` |
| `node --check` на трёх изменённых скриптах | 0 | синтаксис в порядке |
| `node --test --test-isolation=none tests/live-profile-permission.test.mjs` | **0** | `pass 9 / fail 0` |
| `node --test --test-isolation=none tests/plan-citations-gate.test.mjs` | **0** | `pass 5 / fail 0` |
| `node scripts/check-plan-citations.mjs --dsh-checkout <чекаут>` | **0** | `scope=full`, `PASS`, findings 0 (advisory 57 — линейные ссылки, не энфорсится) |
| `node scripts/check-plan-citations.mjs --plan-dir .tmp/does-not-exist` | **2** | «plan directory not found (requested explicitly, fail-closed)» |
| `corepack pnpm run check:plan` | **0** | та же команда через npm-скрипт — то, что вызывает корневой `check` |
| `node scripts/pack.mjs` | _см. §Гейты_ | упаковка бандлов |
| `node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js` | _см. §Гейты_ | изолированный профиль, ожидается `verify:profile: PASS` + `ok live profile board row keeps sessionDefaultPermission "workspace-write" beside plugin` |
| `node scripts/run-tests.mjs "tests/**/*.test.mjs"` | _см. §Гейты_ | полный прогон (было 1031 теста; +14 новых) |

## Решение по стилю (и его граница)

`check:plan` в корневом `check` вызван как `pnpm run check:plan`, а не `node scripts/check-plan-citations.mjs`:
это ровно тот npm-скрипт, который называют план и владелец. Побочное следствие честно: агрегатный `check` на **этой**
машине не запускается одним вызовом **и без моей правки** — все его шаги `pnpm run X` упираются в тот же вложенный
`pnpm` (R-06/F-01). CI запускает шаги через `corepack pnpm -r run …` и от этого дефекта не зависит; локально
использовать `corepack pnpm -r run typecheck|build` + прямые `node scripts/…`. Починка самого `pnpm` — предмет F-01/R-06,
а не этого коммита.

## Ограничения и что НЕ проверено

- **CI не прогонялся** (нет доступа к GitHub Actions). Проверено локально: шаг выполняется той же командой, что и в
  workflow (тем же рабочим каталогом и тем же скриптом), и его поведение при отсутствии корпуса закреплено тестом.
  «Зелёный workflow» ≠ «зелёный продукт», и здесь это неприменимо: workflow не запускался вовсе.
- Охват `repository-only` **не покрывает весь прежний гейт**: дрейф цитат *внутри* корпуса плана по-прежнему ловится
  только там, где корпус лежит (машина владельца). Это записано как открытая граница в R-54.
- Лексический характер правил `profile-permission.mjs` не проверен на всех формах YAML: покрыты живая форма, flow-стиль,
  иной отступ, отсутствие `plugin`, дубликат ключа, похожий id и отсутствие строки. Не покрыты экзотика (якоря, `!!js`,
  многострочные скаляры) — для строки доски они не встречаются.
- Отдельного прогона «verify:profile на машине без живого профиля» (чистый раннер) не делалось: путь пропуска
  закреплён только кодом и текстом, не прогоном в среде без `~/.dsh`.

## Независимое ревью

Запущено параллельно (отдельный read-only субагент, свои копии файлов в `.tmp/`); вердикт — в конце этого файла
после получения отчёта. Факты трека A независимо проверяет второй субагент (режим falsify).

---

## Итог: коммиты, ревью и исправления (2026-10-03, 15:0x)

**Коммиты сделаны не этой сессией.** Пока шла работа, параллельная сессия владельца закоммитила трек B
четырьмя коммитами поверх `4421c13` → **HEAD `b45f6c4`**:
`9559b8b` (R-51: модуль + шаг 9 + тест), `4290d6a` (R-52/R-54: гейт цитат в `check` и CI + тест), `4c0e256` (якорь `:104`),
`b45f6c4` (решение владельца: корпус `.work/` теперь **отслеживается** — 325 файлов в HEAD, правило `/.work/` снято с `.gitignore`).
Это закрыло открытую границу R-54: в реальном checkout'е (в том числе в CI) гейт идёт `scope=full`, а `scope=repository-only`
остаётся охватом копии без `.work/`. Мои правки ниже — в рабочем дереве, **не закоммичены**.

**Ревью трека B: `PASS WITH FINDINGS`** (независимый read-only субагент, свои копии файлов). 14 находок:
3 MAJOR (F1/F2 — чекер пропускал вложенный ключ в компактной записи и определял «рядом с plugin» по отступу строки;
F3 — расхождение текстов «корпус игнорируется / отслеживается», снято решением владельца), 7 MINOR, 4 NIT.

**Исправлено всё, кроме явно принятого:** чекер переписан на **структурный обход** (путь ключа из блочных отступов и
flow-скобок; `sessionDefaultPermission` принимается только как прямой потомок `config`-маппинга строки), срезаются
комментарии (с учётом кавычек и экранирования), вхождения считаются по распознанным ключам, допускается кавычное имя
ключа, ловятся дубликаты-сиблинги, `disabled: true/True` **уровня строки** пропускается (внутри config — нет),
снимается BOM, проверяются **все** записи с этим id (дубль id — находка), `verify-profile` читает живой патч в `try/catch`
и делает это **до** сверки отпечатков; в `docs/ops/profile-restore.md` разведены 14 бандлов снимка 2026-09-27 и 11 скипнутых.

**F11 (открытый вопрос о «лжном запрете») закрыт экспериментом** (изолированный профиль `.tmp/sub-patch-merge`, `--dump-config`,
`exit 0`, предупреждений нет): bare-ключ уровня записи становится **полем строки**, а не частью `config`; при монтировании
плагину передаётся только `options.config` (`vendor/include/src/index.ts:77,120-123`, `vendor/loader/src/config/entry.ts:234`).
Значит правило «ключ обязан быть прямым потомком `config`» — не ложное срабатывание.

**Верификация дельты** (второй read-only субагент, режим verify-fixes): **10 VERIFIED**, 4 PARTIAL (F4, F6, F7, F10) и
5 новых дефектов, внесённых моими же правками (D1 экранированная кавычка, D2/D3 `disabled` без проверки пути и регистра,
D4 док, D5 два некусающихся кейса). Все PARTIAL и D1–D5 исправлены; для каждого правила прогнана **матрица мутаций**
(8 мутаций на копиях в `.tmp/mutcheck`): baseline `exit 0`, все семь — `exit 1`, то есть каждое правило имеет кейс,
который его ломает. Ложных срабатываний на живом файле нет (`found:true, disabled:false, findings:[]`, в том числе для
CRLF и BOM-вариантов).

## Гейты (после всех правок)

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `corepack pnpm -r run typecheck` | 0 | 15/15 проектов |
| `corepack pnpm -r run build` | 0 | сборка всех пакетов |
| `node scripts/pack.mjs` | 0 | оба бандла упакованы |
| `node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js` | **0** | `verify:profile: PASS`; `ok user profile untouched (3 fingerprints unchanged)`; **`ok live profile board row keeps sessionDefaultPermission "workspace-write" in its config mapping`** |
| `node scripts/run-tests.mjs "tests/**/*.test.mjs"` | **0** | **1057/1057, 0 fail, 0 skipped** (было 1045; прогон на состоянии «19 + 7» новых кейсов). После последних трёх правок перепрогнаны обе затронутые сюиты: **21/21** и **7/7**; их импортируют только они и `verify-profile.mjs` (проверено `grep`), поэтому остальные 1037 тестов правками не затронуты |
| `node scripts/check-plan-citations.mjs --dsh-checkout <checkout>` | **0** | `PASS (scope=full)`, findings 0 |

**Что осталось незакрытым:** правки не закоммичены (коммит — по указанию владельца); реальный GitHub Actions не запускался;
`check:plan` в корневом `check` на этой машине упирается в R-06 (вложенный bare `pnpm`), как и остальные шаги агрегата.
