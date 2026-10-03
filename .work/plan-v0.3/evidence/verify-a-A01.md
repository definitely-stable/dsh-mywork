# verify-a-A01 — Пакеты, размер кода, тесты, манифесты

Ревизия репозитория MyWork: `git -C H:\Repo\DSH-MyWork rev-parse HEAD` = `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (`2026-09-22`), `git status --porcelain` → 0 строк (дерево чистое).
Проверялись только чтением: `H:\Repo\DSH-MyWork\**`, `H:\Repo\DSH-MyWork\.tmp\**` (артефакты прошлых прогонов) и `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`.
**Ни одной мутации, install, build и ни одного прогона тестов не выполнялось.** Единственная запись — этот файл.

---

## Якорь A01-1: 01-MASTER-PLAN.md:45 → `packages/*/package.json`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `01-MASTER-PLAN.md` offset 30 limit 60 (строка 45); `Get-ChildItem H:\Repo\DSH-MyWork\packages -Directory` → 12 каталогов; `Get-ChildItem 'packages\*\package.json' | ConvertFrom-Json` → печать `name/version/private` по каждому (12 файлов)
- **Фактическое значение:**
  - `01-MASTER-PLAN.md:45`: `| Пакеты | 12: contracts, core, storage, adapter-sdk, beads-adapter, lease, planner, scheduler, execution, evidence, memory-native, controller | packages/*/package.json (все @dsh-mywork/* 0.1.0, все private: true) |`
  - Вывод команды: `adapter-sdk | @dsh-mywork/adapter-sdk | 0.1.0 | True` … `storage | @dsh-mywork/storage | 0.1.0 | True` (12/12 строк в этой форме)
- **Оценка severity:** info
- **Комментарий:** Имена совпадают с перечнем якоря буква в букву, порядок отличается только алфавитным выводом каталогов. Все 12 манифестов дают `version=0.1.0`, `private=True`, префикс `@dsh-mywork/` — ровно как в цитате. Дополнительно: корневой `package.json` тоже `private=True` (в якорь не входит).

## Якорь A01-2: 01-MASTER-PLAN.md:46 → `packages/*/src`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `01-MASTER-PLAN.md` (строка 46, источник указан как `FINAL-REPORT §8.1`); read `.work\analysis\2026-09-26\FINAL-REPORT.md` (строка 170 — таблица §8.1); подсчёт `Get-ChildItem -Path packages -Recurse -File | ? FullName -match '\\src\\' -and -notmatch '\\node_modules\\'` + `Get-Content | Measure-Object -Line` по каждому файлу; перечисление всех каталогов `src` в репозитории
- **Фактическое значение:**
  - `01-MASTER-PLAN.md:46`: `| Код | 111 файлов src, 36 674 строки (без build output) | FINAL-REPORT §8.1 |`
  - `FINAL-REPORT.md:170`: `уточнение: «125 383 строки» — метрика с build output; чистых src — 111 файлов / 36 674 строки`
  - Вывод команд: `REAL_SRC_FILES=111` / `REAL_SRC_LINES=36674`
- **Оценка severity:** info
- **Комментарий:** Числа воспроизводятся точно (все 111 файлов — `.ts`). Ловушка, из-за которой якорь легко «опровергнуть» ложно: наивный рекурсивный подсчёт по `packages/**` даёт `325 файлов / 76 534 строки` — это включает вложенные `packages/<pkg>/node_modules/@dsh-mywork/.ignored_*/src` (`execution`, `lease`; 15 лишних каталогов `src`). Единственные каталоги `src` вне `.tmp` — ровно 12, по одному на пакет (проверено перечислением). Оговорка: оба числа совпали с цитатой только при измерении «число переводов строки» (`Measure-Object -Line`), т.е. без учёта необрывающейся последней строки — тот же метод, что в FINAL-REPORT.

## Якорь A01-3: 01-MASTER-PLAN.md:48 → repo (тесты)

- **Вердикт:** НЕ ПРОВЕРЕНО (полный прогон запрещён условием задания; сверка снимка кода показывает, что цитируемый прогон устарел)
- **Что проверено:** read `01-MASTER-PLAN.md` (строка 48); read `.work\analysis\2026-09-26\FINAL-REPORT.md` (строки 37, 341, 372, 533); read хвоста лога `.tmp\f-audit\.tmp-audit\tests-full.log` (59937 б, mtime `2026-09-26 22:17:51`, строки 706-717); поиск более свежего лога тестов по всему репозиторию вне `node_modules`
- **Фактическое значение:**
  - `01-MASTER-PLAN.md:48`: `| Тесты | 710: 687 pass / 0 fail / 23 skip (87,6 с) после сборки tsdown (204,7 с) | §8.1 |`
  - `tests-full.log` (последние строки): `ℹ tests 710` / `ℹ pass 687` / `ℹ fail 0` / `ℹ skipped 23` / `ℹ duration_ms 87615.2611`
  - Хеш-сверка текущего `packages/*/src` со снимком `.tmp\f-audit\packages\*\src`: `identical=15 changed=96 missing_in_snapshot=0`
- **Оценка severity:** major
- **Комментарий:** Цитата в плане **дословно совпадает** с логом прогона и с FINAL-REPORT:37/341/533 — 710/687/0/23 и 87,6 с (`87615,26 мс`) воспроизводятся из первоисточника, а не из пересказа. Но прогон датирован `2026-09-26 22:17:51`, и с тех пор **96 из 111 файлов `src` изменились побайтово** (совпали только 15; ни один файл не добавлен/удалён). Свежего лога тестов (`tests 7xx`) в репозитории нет ни одного. Поэтому утверждение верно как описание прошлого прогона, но не подтверждено как свойство текущего дерева — и без прогона, запрещённого заданием, это принципиально не проверяемо здесь.
- **Как проверять при снятии запрета:** `corepack pnpm run build` (`tsdown`, ~205 с), затем прогон тестов **одним процессом** — лог FINAL-REPORT §P14 (`FINAL-REPORT.md:372`) фиксирует `--test-isolation=none`; ожидаемый вывод — блок `tests 710 / pass 687 / fail 0 / skipped 23`; сравнить с `tests-full.log`. Побочный признак старения: 23 `skipped` в плане привязаны к сломанному `bd`-seam на Windows (D-2, `01-MASTER-PLAN.md:62`), где после починки раннера ожидались `pass 68 / fail 2`.

## Якорь A01-4: 01-MASTER-PLAN.md:70 → repo

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `01-MASTER-PLAN.md` offset 30 limit 60 (строка 70); `ConvertFrom-Json` по всем `package.json` репозитория вне `node_modules` (корень + 12 пакетов) с печатью `peerDependencies`; `Test-Path .github\workflows`; поиск файлов `*.yml|*.yaml` в каталогах `.github|.gitlab|azure-pipelines|.circleci`; `git tag | Measure-Object`
- **Фактическое значение:**
  - `01-MASTER-PLAN.md:70`: `| D-10 | Публикация невозможна by construction: private: true ×12, devDeps на непубликуемые @dsh-mywork/*, нет CI, 0 тегов, нет peerDependencies (только @deepseek-ai/cordis) → peer-compat gate платформы молчит |`
  - `packages\controller\package.json | peer=@deepseek-ai/cordis@^4.0.2`; у остальных 11 пакетов и у корня — `peer=<none>`
  - `gh_workflows: False`; вывод `git tag` — пустой (`0`); `git status --short` — 0 строк
- **Оценка severity:** info
- **Комментарий:** Все четыре составляющие подтверждены по первоисточникам: `private: true` ×12, CI-конфигурации нет, тегов git нет. Точность формулировки требует уточнения, а не исправления: `peerDependencies` есть **ровно у одного** пакета из 12 (`controller` → `@deepseek-ai/cordis@^4.0.2`), а не у всех с одним и тем же peer; у корня `peerDependencies` нет вовсе. Смысл вывода («peer-compat gate молчит для 11 пакетов и однотипен для 12-го») от этого не меняется, поэтому это `info`, а не дефект якоря.

## Якорь A01-5: 01-MASTER-PLAN.md:51 → `.work/tasks/INDEX.md`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `01-MASTER-PLAN.md` (строка 51); `Select-String INDEX.md -Pattern '^\| \[MW-(\d{3})\]'` → 55 строк; `Select-String -Pattern 'MW-(\d{3})'` → уникальные ID; `Get-ChildItem .work\tasks\MW-*.md` → 55 файлов
- **Фактическое значение:**
  - `01-MASTER-PLAN.md:51`: `| Карточки | 55 (MW-001…MW-055), из них 22 исполнены/в работе по отчётам .work/reports/ | .work/tasks/INDEX.md, .work/reports/ |`
  - Вывод команд: `INDEX_MW_ROWS=55`, `INDEX_UNIQUE_IDS=55`, `INDEX_FIRST_LAST=001..055`, `CARD_FILES=55`
- **Оценка severity:** info
- **Комментарий:** Пятьдесят пять строк-карточек таблиц INDEX.md, 55 уникальных ID, диапазон 001…055 без пропусков, и 55 файлов `MW-001.md…MW-055.md` на диске — сходятся все три независимых признака. Вторая половина утверждения («22 исполнены/в работе») в этот якорь не входит и отдельно не проверялась; для контекста: сам план на строке 89 даёт «21 отчёт `DONE` + MW-043 `BLOCKED`», что к 22 не сводится тривиально — это тема соседнего якоря, а не этого.

## Якорь A01-6: 01-MASTER-PLAN.md:304 → три леджера

- **Вердикт:** НЕВЕРНАЯ СТРОКА — строка/файл другие (числа верны, см. комментарий)
- **Что проверено:** read `01-MASTER-PLAN.md` offset 296 limit 20 (строки 300-306) — `:304` это `D18` про пакет `@dsh-mywork/web`, никакого отношения к леджерам; grep `board-export|ledger-v2|tasks\.js` по `.work\plan-v0.3\*.md` → таблица трёх леджеров найдена в `10-DECISIONS.md` (строки 1599-1603); read `10-DECISIONS.md` offset 1588 limit 30; `ConvertFrom-Json` по `.work\tasks\tasks.json` и `.work\tasks\board-export.json`; read-only чтение `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`
- **Фактическое значение:**
  - `01-MASTER-PLAN.md:304`: `| D18 | Отдельный пакет **@dsh-mywork/web** по форме 0.4.3 (exports["./client"], dsh.client{platform,inject,external,immediately}, slots.inject) … |`
  - `10-DECISIONS.md:1601-1603`: ``| `…\ledger-v2.json` | 55 | failed 2 / backlog 34 / done 19 | 31 |`` / ``| `.work\tasks\tasks.json` | 55 | planned 53 / superseded 2 | 0 |`` / ``| `.work\tasks\board-export.json` | 41 | backlog 41 | 0 |``
  - Первоисточники: `tasks.json` → `tasks=55 planRevision=2 schemaVersion=1`, `planned=53, superseded=2`; `board-export.json` → `tasks=41 revision=82`, `backlog=41`; живой леджер → `size=369634 schemaVersion=3 revision=324 tasks=55`, `backlog=34, done=19, failed=2`
- **Оценка severity:** minor
- **Комментарий:** Файл `01-MASTER-PLAN.md` в строке 304 содержит решение D18 о пакете `@dsh-mywork/web`; таблицы трёх леджеров там нет ни в строке 304, ни в допуске ±10 строк (ближайшее к теме — строка 87 «55 в `tasks.json`, 55 в `INDEX.md`, 41 в живом леджере», но это внутри §1.3 и не про `10-DECISIONS`). Фактический адрес таблицы — `10-DECISIONS.md:1599-1603`. Перечень «файлов» в якоре тоже смещён: в репозитории лежат `tasks.json` и `board-export.json`, а третьего файла-леджера (`ledger-v2.json`) в репозитории нет вовсе — он живёт в профиле (`C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`; поиск по репозиторию → пусто). При этом **сами числа 55/55/41 верны** и подтверждены сличением именно первоисточников, а не пересказа: `tasks.json=55`, `board-export.json=41`, живой леджер `=55` (на ревизии 324, размер 369 634 б). Оговорка: живой леджер меняется хостом, поэтому его «55» — снимок на момент проверки.

---

## Сводка

| Якорь | Вердикт | Severity |
|---|---|---|
| A01-1 (пакеты 12 × 0.1.0 × private) | ПОДТВЕРЖДЕНО | info |
| A01-2 (111 файлов / 36 674 строки) | ПОДТВЕРЖДЕНО | info |
| A01-3 (710 тестов: 687/0/23) | НЕ ПРОВЕРЕНО (прогон запрещён; снимок старше правок 96/111 файлов) | major |
| A01-4 (нет CI, 0 тегов, peer только cordis) | ПОДТВЕРЖДЕНО | info |
| A01-5 (55 карточек MW-001…MW-055) | ПОДТВЕРЖДЕНО | info |
| A01-6 (три леджера 55/55/41) | НЕВЕРНАЯ СТРОКА → `10-DECISIONS.md:1599-1603`; числа верны | minor |

СУММА: подтверждено 4, неверная строка 1, ложно 0, не существует 0, устарело 0, не проверено 1.

**Что осталось непроверенным и почему:** (1) актуальный прогон тестов — задание прямо запрещает полный прогон; (2) «22 исполнены/в работе» из строки 51 — вне этого якоря; (3) изменчивость живого леджера — хост переписывает `ledger-v2.json` при каждом исполнении, число 55 относится к revision 324.
