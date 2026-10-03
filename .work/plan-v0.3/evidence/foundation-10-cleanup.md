# foundation-10 — F-10: чистка рабочего каталога, только безопасный класс

- **Задача:** `task-3` (команда v0.3), исполнитель `hygiene-ops`
- **Шаг плана:** F-10 (`H:\Repo\DSH-MyWork\.work\plan-v0.3\20-STEPS-foundation.md:254-283`), источник правок — `evidence/lead-18-cleanup.md`
- **Решение владельца (объём):** удаляется **только безопасный класс**; класс «требует решения владельца» (три грязных worktree, `.rar`, снимки, `*.bak`, sqlite-базы) **не удаляется**, только описывается таблицей.
- **Статус:** `READY_FOR_REVIEW`
- **Время:** 2026-09-27, 12:44–12:48 (локальное)
- **HEAD:** `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`

---

## 1. П0 — координаты и стоп-условие (read-only, выполнено до любых удалений)

```text
$root=(Resolve-Path 'H:\Repo\DSH-MyWork').Path   -> H:\Repo\DSH-MyWork
Test-Path "$root\.git"                            -> True   (корень репозитория подтверждён)

== git worktree list (ДО) ==
H:/Repo/DSH-MyWork                       0c657ae [main]
H:/Repo/DSH-MyWork/.tmp/f-audit          0c657ae (detached HEAD)
H:/Repo/DSH-MyWork/.tmp/mw012-review     f22dbc3 (detached HEAD)
H:/Repo/DSH-MyWork/.tmp/v2-boundary-demo 0c657ae (detached HEAD)

== git status --porcelain (ДО) ==
 M pnpm-lock.yaml
```

**Стоп-условие (факт 7 плана: «чистка запрещена, пока идёт запись в `.tmp`») — проверено, запись не идёт:**

| Момент | `.tmp` файлов | `.tmp` МБ | файлов, изменённых за последние 10–12 мин |
|---|---|---|---|
| T0 12:44:17 | 4046 | 180,92 | — (окно) |
| T1 12:44:47 | 4046 | 180,92 | **0** |
| T2 12:46:40 (после паузы 60 с) | 4046 | 180,92 | **0** |

Снимок `.tmp/plan-v03-*` (9 каталогов) на T0 и T2 **побайтово совпал**: `plan-v03-cards` 21 файл/704 621 B, `plan-v03-decision` 3/9 937, `plan-v03-foundation` 15/99 586, `plan-v03-lead` 20/1 137 577, `plan-v03-red-a` 6/871 540, `plan-v03-red-b` 11/70 084, `plan-v03-red-c` 9/249 982, `plan-v03-verify-a` 10/125 820, `plan-v03-verify-b` 6/498 911. Новейшая запись в `.tmp/plan-v03-*` — 11:58:47, то есть ≈48 мин до начала шага.

**Вывод: стоп-условие не сработало, удаления разрешены.** Ни одна операция шага не касалась `.tmp/plan-v03-*` (запретная зона).

---

## 2. Таблица «путь → класс → что сделано»

Классы: **безопасно** — удалено в этом шаге; **требует решения** — не удалено (решение владельца); **не трогать** — запретная зона.

| Путь | Класс | Проверка-предусловие (фактическая) | Что сделано |
|---|---|---|---|
| `.tmp\beads-probe` | безопасно | entries=0 (обход без следования reparse-точкам, вкл. hidden) | **УДАЛЕНО** `Remove-Item -LiteralPath` (без `-Recurse`) |
| `.tmp\pnpm-temp` | безопасно | entries=0 | **УДАЛЕНО** `Remove-Item -LiteralPath` |
| `.tmp\test-tmp` | безопасно | entries=0 | **УДАЛЕНО** `Remove-Item -LiteralPath` |
| `.tmp\mw004-verify` | безопасно | realFiles=**0**, links=115, subdirs=80; ссылок вне `.tmp`: 0, неразрешённых: 0 | **УДАЛЕНО** `cmd /c rmdir /s /q "<точный путь>"`, exit=0 |
| `.tmp\mw010-head-verify` | безопасно | realFiles=**0**, links=127, subdirs=89; ссылок вне `.tmp`: 0, неразрешённых: 0 | **УДАЛЕНО** `cmd /c rmdir /s /q "<точный путь>"`, exit=0 |
| `.tmp\f-audit\node_modules` | безопасно | `Test-Path .tmp\f-audit\pnpm-lock.yaml`=**True**; realFiles=931, MB=52,77, links=116 (все резолвятся внутрь `.tmp`), сам каталог не reparse-точка | **УДАЛЕНО** `cmd /c rmdir /s /q "<точный путь>"`, exit=0 |
| `.tmp\mw012-review\node_modules` | безопасно | `Test-Path .tmp\mw012-review\pnpm-lock.yaml`=**True**; realFiles=934, MB=52,78, links=114 (все внутрь `.tmp`), сам каталог не reparse-точка | **УДАЛЕНО** `cmd /c rmdir /s /q "<точный путь>"`, exit=0 |
| `.tmp\pack`, `.tmp\pack-logs` | безопасно (по плану) | существуют: 1 файл/0,01 МБ и 2 файла/0,00 МБ | **НЕ УДАЛЕНО** — их нет в авторизованном списке `task-3`; удаление отложено до явного расширения объёма |
| `.tmp\f-audit` (без `node_modules`) | требует решения | 289 файлов / 14,14 МБ, worktree грязный (6 записей) | НЕ УДАЛЕНО (несохранённый фикс `beads-adapter`) |
| `.tmp\mw012-review` (без `node_modules`) | требует решения | 432 файла / 10,51 МБ, worktree грязный (30 записей) | НЕ УДАЛЕНО |
| `.tmp\v2-boundary-demo` | требует решения | 192 файла / 2,43 МБ; `node_modules` — **живая junction** → `H:\Repo\DSH-MyWork\node_modules` | НЕ УДАЛЕНО (корректно; см. §4 и §6) |
| `.tmp\mw018-review` (20,41 МБ), `.tmp\mw012-full-backup` (11,15 МБ), `.tmp\mw012-mine` (0,76 МБ), `.tmp\mw014-review` (0,37 МБ) и прочие `*-backup`/`*-snap`/`*-mut`/`*-review`/`*-fix` | требует решения | существуют, не тронуты | НЕ УДАЛЕНО |
| `.tmp\mw008-review\db\**`, `.tmp\mw008-vfix\db\**` (22 sqlite) | требует решения | существуют, не тронуты | НЕ УДАЛЕНО |
| ~275 свободных файлов в корне `.tmp` (`*.log`, `*.txt`, `*.mjs`, `*.ps1`, `*.bak`, `*.orig`), 3,61 МБ | требует решения | 275 файлов; часть ссылок из `.work` уже висит | НЕ УДАЛЕНО |
| `H:\Repo\DSH-MyWork\DSH-MyWork.rar` (41,4 МБ) | требует решения | не тронут; П5 (извлечение уникального) не выполнялся | НЕ УДАЛЕНО |
| корневые `node_modules` (109,69 МБ) + `.pnpm-store` | требует решения | воспроизводимы, но не в `.rar` ⇒ удаление = полная переустановка | НЕ УДАЛЕНО |
| `.tmp\plan-v03-*` (9 каталогов) | не трогать | активная кампания; снимки T0=T2 | НЕ УДАЛЕНО, не изменялось |
| `.work`, `.analysis`, `.dsh`, `.beads`, `.git`, `packages\`, `tests\`, `scripts\`, корневые конфиги | не трогать | — | НЕ УДАЛЕНО |

Запрещённые средства не применялись: `Remove-Item -Recurse` — 0 раз, `git clean` — 0 раз, `git worktree remove/prune` — 0 раз.

---

## 3. Журнал удалений (raw, из исполненного скрипта)

```text
JOURNAL: DELETED empty-dir     H:\Repo\DSH-MyWork\.tmp\beads-probe (entries=0)
JOURNAL: DELETED empty-dir     H:\Repo\DSH-MyWork\.tmp\pnpm-temp (entries=0)
JOURNAL: DELETED empty-dir     H:\Repo\DSH-MyWork\.tmp\test-tmp (entries=0)
JOURNAL: DELETED junction-shell H:\Repo\DSH-MyWork\.tmp\mw004-verify realFiles=0 links=115 exit=0
JOURNAL: DELETED junction-shell H:\Repo\DSH-MyWork\.tmp\mw010-head-verify realFiles=0 links=127 exit=0
JOURNAL: DELETED H:\Repo\DSH-MyWork\.tmp\f-audit\node_modules realFiles=931 links=116 linksOutsideTmp=0 lockfile=present exit=0
JOURNAL: DELETED H:\Repo\DSH-MyWork\.tmp\mw012-review\node_modules realFiles=934 links=114 linksOutsideTmp=0 lockfile=present exit=0
ALL7_DELETED=True
```

Структурные предохранители, вшитые в скрипт (каждый — исполняемая проверка, не проза):
1. `Guard`: путь обязан начинаться с `H:\Repo\DSH-MyWork\.tmp\`, не быть корнем `.tmp`, не содержать `*?[]` и `..`, совпадать с `GetFullPath` символ-в-символ, и сам целевой каталог не может быть reparse-точкой — иначе `throw` до удаления.
2. Пути переданы **литералами** в 7 отдельных блоках; ни один путь не собран из переменной/шаблона/маски. `cmd /c rmdir /s /q "<литерал>"` — точная строка на каждый из 4 reparse-содержащих каталогов.
3. Перед каждым удалением предусловие перепроверено **в том же процессе** (пустота / realFiles=0 / наличие lockfile / 0 ссылок вне `.tmp`); при невыполнении — `throw`, каталог остаётся.
4. После каждого удаления — `Test-Path` → `False`, иначе `throw`.
5. Обход дерева для подсчётов — собственный (стек + `EnumerateFileSystemEntries`), **не следует** в reparse-точки, поэтому счётчики описывают только содержимое цели.

---

## 4. Measure-Object по `.tmp` (до/после)

| Момент | Файлов | МБ |
|---|---|---|
| ДО (12:44:17) | 4046 | 180,92 |
| ПОСЛЕ (12:47:40) | 2181 | 75,37 |
| **Освобождено** | **1865** | **105,55** |

Сходимость: удалено реальных файлов 0+0+0+0+0+931+934 = **1865**; объём 52,77+52,78 = **105,55 МБ** — совпадает с дельтой агрегата до знака. (Плановая оценка «105,6 МБ, 1865 файлов» подтверждена.)

---

## 5. Обязательные проверки целостности живого дерева (после удалений)

```text
INTEGRITY node_modules=True packages\core\lib=True tests\lib=True
```

Усилено отпечатками (сняты ДО удалений и повторены ПОСЛЕ — совпали побайтово по составу):

| Живой путь | Файлов ДО | МБ ДО | Файлов ПОСЛЕ | МБ ПОСЛЕ | Вердикт |
|---|---|---|---|---|---|
| `H:\Repo\DSH-MyWork\node_modules` | 1936 | 109,69 | 1936 | 109,69 | без изменений |
| `H:\Repo\DSH-MyWork\packages\core\lib` | 4 | 1,85 | 4 | 1,85 | без изменений |
| `H:\Repo\DSH-MyWork\tests\lib` | 4 | 0,02 | 4 | 0,02 | без изменений |

SHA-256 `packages\core\package.json` до и после: `BA80377BBA5B234D…` — идентичен.

**Инcидентов нет.** Все три проверки — `True`, отпечатки не изменились, ни один живой каталог не пострадал.

### Junction-ловушка `.tmp\v2-boundary-demo\node_modules`

```text
exists=True  reparse=True  target=H:\Repo\DSH-MyWork\node_modules
```

Путь **не удалялся** и остался на месте. Это расходится с буквой гейта F-10 (`Test-Path … → False`) и согласуется с решением владельца: `False` получался бы только после удаления самого worktree `v2-boundary-demo` (П4), которое в этом шаге запрещено. Наличие живой junction подтверждает, что ловушка не тронута (и что живой `node_modules` на месте — цель ссылки резолвится).

---

## 6. `git worktree list` и `git status` после

```text
== git worktree list (ПОСЛЕ) ==
H:/Repo/DSH-MyWork                       0c657ae [main]
H:/Repo/DSH-MyWork/.tmp/f-audit          0c657ae (detached HEAD)
H:/Repo/DSH-MyWork/.tmp/mw012-review     f22dbc3 (detached HEAD)
H:/Repo/DSH-MyWork/.tmp/v2-boundary-demo 0c657ae (detached HEAD)

== git status --porcelain (ПОСЛЕ) ==
(пусто)

== грязные состояния worktree сохранены ==
f-audit:       M packages/beads-adapter/src/runner.ts | M pnpm-lock.yaml | M tests/beads-adapter.test.mjs | ?? .tmp-audit/ | ?? packages/beads-adapter/src/runner.ts.orig | ?? tests/beads-adapter.test.mjs.orig   (6 записей)
mw012-review:  30 записей
```

**Расхождение с гейтом F-10 «`git worktree list` → ровно 1 запись» — осознанное и не является дефектом шага:** решение владельца ограничило объём безопасным классом, П4 (`git worktree remove`) не выполнялся, все три вложенных worktree и их грязные файлы сохранены (это и было целью ограничения). Гейт в редакции плана недостижим без удаления worktree; фактический гейт этого шага — сохранность worktree + три проверки целостности.

`git status` изменился с ` M pnpm-lock.yaml` на пусто **не из-за этого шага** (см. §8).

---

## 7. Что НЕ удалено и почему

1. **Класс «требует решения владельца»** — не удалён по прямому решению владельца: три worktree (`f-audit` 14,14 МБ, `mw012-review` 10,51 МБ, `v2-boundary-demo` 2,43 МБ), `mw018-review` 20,41 МБ, `mw012-full-backup` 11,15 МБ, `mw012-mine`, `mw014-review`, прочие `*-backup`/`*-snap`/`*-mut`, 275 свободных `*.log/*.txt/*.mjs/*.ps1/*.bak` (3,61 МБ, часть имён уже висит ссылками из `.work`), sqlite-базы `mw008-*/db/**`, `DSH-MyWork.rar` (41,4 МБ, единственный экземпляр `mw008-verify/**`), корневые `node_modules` + `.pnpm-store`.
2. **Запретная зона** — `.tmp/plan-v03-*`, `.work`, `.analysis`, `.dsh`, `.beads`, `.git`, `packages/`, `tests/`, `scripts/`, корневые конфиги, `*.rar`: не тронуты.
3. **`.tmp/pack`, `.tmp/pack-logs`** — план относит их к безопасному классу, но в авторизованном списке `task-3` их нет ⇒ не удалены (запас на явное расширение объёма).
4. Ничего вне списка из 7 путей не удалялось; ни один каталог не удалялся рекурсивным `Remove-Item`.

---

## 8. Наблюдения и уточнения к базе плана

1. **Факт 3 плана («все junction битые») уточнён:** в `.tmp\mw004-verify` (115) и `.tmp\mw010-head-verify` (127) ссылки **живые**, но ведут внутрь того же поддерева `.tmp` (`…/packages/<x>/node_modules/@dsh-mywork/<pkg> → …/mw004-verify/packages/<pkg>`), а цели — реальные пустые каталоги. Значимо то же: `realFiles = 0` выполнено, ссылок за пределы `.tmp` — 0, поэтому `cmd rmdir /s` снимал ссылки, а не цели.
2. **Уточнение по ссылкам внутри удалённых `node_modules`:** 116 и 114 reparse-точек — все резолвятся внутрь `.tmp` (вне `.tmp`: 0, неразрешённых: 0) — проверено `ResolveLinkTarget($true)` на каждой. То есть даже гипотетическое следование по ссылке не могло вывести за пределы `.tmp`.
3. **Параллельное событие вне моего write-scope:** корневой `pnpm-lock.yaml` был возвращён к HEAD во время шага (mtime 12:47:49, `git status pnpm-lock.yaml` пусто, `git diff --numstat` пусто) — это работа соседнего потока F-11, не следствие удалений. Мои операции ограничены путями под `.tmp\`, файл на месте (28 980 B).
4. **Объёмы после шага:** `.tmp` 2181 файл / 75,37 МБ; крупнейшие оставшиеся — `mw018-review` 20,41, `f-audit` 14,14, `mw012-review` 10,51, `mw012-full-backup` 11,15.
5. **Ещё одно параллельное событие:** в 12:47:49–12:47:50, уже **после** фазы удалений (и во время after-замеров), соседний поток записал `.tmp\pack-logs\pnpm-pack.err.log` и `.tmp\pack-logs\pnpm-pack.out.log`. Ни один удалённый путь этим не затронут, стоп-условие на момент удалений было чистым (0 записей за 12+ мин). Это подтверждает правильность того, что `.tmp\pack` / `.tmp\pack-logs` остались нетронутыми: они не входили в авторизованный список `task-3` и являются местом живой записи.

## 9. Что остаётся недоказанным

- Поведение `Remove-Item -Recurse` на junction **экспериментально не проверялось** (ничего рекурсивно не удалялось) — рекомендация `cmd /c rmdir /s /q` взята из `lead-18` и в этом шаге только **применена**, не проверена контрфактически.
- Содержимое `.rar` не читалось; П5 не выполнялся.
- Снимки `*-backup`/`*-snap`/`*-mut` не сверялись с HEAD по хэшу (класс выставлен по имени/дате) — остаётся на решение владельца.
- Ссылки `.work` на удалённые `.tmp`-пути не сверялись построчно; удалённые 7 путей — это пустые каталоги, мёртвые скаффолды и два воспроизводимых `node_modules` (откат: `pnpm install --frozen-lockfile` по сохранённым `pnpm-lock.yaml`), поэтому висячих ссылок от них ожидать не следует, но проверка не выполнялась.

**Вердикт: `READY_FOR_REVIEW`.** Освобождено 105,55 МБ / 1865 файлов; живое дерево цело (3/3 `True`, отпечатки и хэш совпали); junction-ловушка на месте; ни один объект класса «требует решения владельца» не удалён.
