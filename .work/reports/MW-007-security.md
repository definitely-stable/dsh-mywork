# MW-007 — Обеспечить runtime permissions и границы workspace

- Предмет: карточка доски `58ec1a48-2fcf-4980-8c03-73219fe73b34` (MW-007), этап `00-foundation`, обязательные пункты §62 — 39
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Дата: `2026-09-18 00:52 – 02:00 +05:00`
- Репозиторий: `H:\Repo\DSH-MyWork`
  - base SHA на старте карточки: `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e` (HEAD MW-006, дерево чистое)
  - собственных коммитов нет: коммит не поручался; head = рабочее дерево поверх `fbee7a0`
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, Windows, pwsh
- Статус: **DONE** — статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020, «поменять все карточки с подобной оговоркой»). Акт приёмки — это указание владельца, а не вывод автора. Содержательная часть ниже не переписана: оговорки о том, что было и не было проверено, сохранены.

> История: предыдущий прогон карточки (00:36–00:45) завершился **BLOCKED** — зависимости MW-006 ещё
> не существовало. В 01:02 MW-006 был поставлен и закоммичен, причина снята, работа продолжена по
> прямому указанию владельца.

---

## 1. Проверка зависимостей

| Зависимость | Проверено | Результат |
|---|---|---|
| **MW-005** | отчёт `reports/MW-005-adapter-sdk.md` (359 строк, `DONE`), исходники `packages/adapter-sdk/src` (8 файлов), 4 коммита, зелёный конвейер | предусловие пройдено |
| **MW-006** | отчёт `reports/MW-006-team-config.md` (203 строки, `READY_FOR_REVIEW`); коммиты `2bbb5d9`, `962f696`, `352e378`, `fbee7a0`; исходники `contracts/src/config.ts`, `core/src/config.ts`, `core/src/team.ts`, `core/src/graph.ts`; `tests/config.test.mjs`, `tests/team.test.mjs`; `pnpm run check` на `fbee7a0` → exit 0, 112 pass / 0 fail | предусловие пройдено |

Проверка велась **по исходникам и git, а не по статусу доски**. Что проверено у MW-006 независимо от
его отчёта: модель конфигурации и режимы (`contracts/src/config.ts`), `ConfigRevision` через реестр
канонических fingerprint'ов (`core/src/config.ts`), фиксация resolved-ревизий при admission
(`core/src/team.ts`, `resolveAttemptRevisions` → `freezeRevisions`), запрет cross-workspace рёбер
(`core/src/graph.ts`, `assertWorkspaceLocalEdges`). Независимый ревьюер карточки подтвердил это
отдельно (§8).

Честные оговорки:

1. MW-006 имеет статус `READY_FOR_REVIEW`, то есть **формальной приёмки владельца нет**. Работа
   продолжена по прямому указанию владельца в сессии («продолжи») и по проверенным артефактам, а не
   по статусной строке; это решение названо, а не замолчано.
2. Правки MW-006 после его собственного ревью повторным верификатором не проверялись (отмечает сам
   MW-006). К объёму MW-007 это не относится: используется его публичный API как есть.

## 2. Решения, согласованные с владельцем до начала работы

Заданы одним пакетом из двух вопросов; выбраны рекомендованные варианты:

1. **Словарь прав.** §31 перечисляет девять доменов, а `Permission` содержал семь значений.
   `Permission` расширен недостающими именами §31 (`network`, `mcp`, `secrets.use`, `task.transition`,
   `production`) — один словарь прав, аддитивно; ни один тест не сверяет `PERMISSIONS` целиком.
2. **Штатная авторизация DSH.** Enforcement — чистые доменные функции: действующая политика harness
   (`read-only` / `workspace-write` / `danger-full-access`) подаётся **входом** и работает потолком.
   Живой профиль DSH не трогается; подключение рантайма — MW-015.

## 3. Сделано

### 3.1 Контракты

- `packages/contracts/src/team.ts` (numstat `24/1`): `Permission` расширен пятью именами §31,
  `PERMISSIONS` — 12 значений.
- `packages/contracts/src/security.ts` (новый, 303 строки / 282 непустых): `OperationDomain` +
  `OPERATION_DOMAINS` (девять доменов §31), `OPERATION_PERMISSIONS` (`"domain.action"` → право),
  `OPERATIONS_REQUIRING_PATH`, `HARNESS_GOVERNED_PERMISSIONS`, `HarnessPolicy`, `HARNESS_POLICIES`,
  `HARNESS_POLICY_CEILING`, `CredentialReference` + `CREDENTIAL_REFERENCE_FIELDS`, гейты §28
  (`HumanGate`, `HUMAN_GATES`, `DOMAIN_IMPLIED_GATES`), `REVIEWER_DEFAULT_PERMISSIONS`,
  `IMPLEMENTATION_WRITE_PERMISSIONS`, закрытые схемы, типы `AuthorizationContext`,
  `OperationRequest`, `AuthorizationDecision` (с `path` и `boundaryRoot`).
- `packages/contracts/src/index.ts` (+1 мой; файл общий с параллельной сессией — её экспорты рядом).

### 3.2 Enforcement (`packages/core/src/security.ts`, новый, 592 строки / 558 непустых)

`authorizeOperation(context, request, meta)` — единственная точка входа; порядок проверок фиксирован,
поэтому один вход всегда даёт один отказ:

1. схема контекста и запроса — закрытые схемы по **собственным ключам, включая неперечислимые**,
   плюс запрет symbol-полей и необычного прототипа (значение с унаследованными полями не читается
   как грант);
2. дефект «одобряющий грант с правами записи» (`reviewer-write-grant`) — по наличию `review.approve`,
   а не по флагу `reviewer`;
3. известность операции (`unknown-operation`) — таблица, а не параметр вызывающего;
4. гейт §28 (`human-gate`);
5. привязка к workspace (`foreign-workspace`, §52);
6. обязательность пути для файловых операций (`path-missing`);
7. независимость ревьюера (`self-approval` — сравнение без учёта регистра и Unicode-композиции;
   `unverifiable-independence`);
8. право в гранте (`permission-missing` — отказ, а не эскалация);
9. credential reference (`credential-required`, `credential-not-expected`, `secret-material`);
10. потолок политики harness (`harness-policy`);
11. границы пути (`path-escape`, `worktree-escape`).

`isWithinRoot(root, candidate)` — текстовый разбор: унификация разделителей, снятие `.`, раскрытие
`..` (выход выше старта → отказ, а не clamp), отказ на сегменте, который Win32 обрезал бы
(заканчивается на `.` или пробел), посегментное сравнение (`C:\ws-evil` не внутри `C:\ws`),
регистронезависимость только для Windows-префиксов. `assertCredentialReference(value, meta)` —
отдельная проверка ссылки для вызывающих, которые её хранят.

### 3.3 Тесты и документация

- `tests/security.test.mjs` (новый, 411 строк / 357 непустых, **38 тестов**): по сценарию на каждый
  пункт приёмки, отказы проверяются по `details.reason`.
- `README.md` (+61): раздел «Права и границы (§31)».
- `packages/core/src/index.ts` (+1): экспорт `authorizeOperation`, `assertCredentialReference`,
  `isWithinRoot`.

## 4. Приёмка: пункт → тест

| Пункт приёмки | Тест |
|---|---|
| path escape | `a path that climbs out of the workspace is refused`, `an absolute path outside the workspace is refused`, `a sibling directory sharing the root prefix is not inside the root`, `windows roots compare case-insensitively and posix roots do not`, `a segment windows would strip before resolving is refused`, `a file operation that names no path is refused instead of trusted` |
| worktree escape | `a path may not leave the worktree of the attempt`, `a worktree boundary cannot be skipped by omitting the path`, `a worktree outside the workspace is a configuration error, not a boundary` |
| запрет self-approval | `nobody approves their own attempt`, `an identity that differs only in case is the same actor`, `an identity that differs only in unicode composition is the same actor`, `an approval without the worker identity cannot prove independence`, `an independent reviewer with the permission approves` |
| доступ к чужому workspace | `an agent may not touch a workspace it is not bound to`, `a foreign workspace is reported even when the path is missing` |
| эскалация полномочий | `a permission that was not granted is refused, not escalated`, `a §28 gate is never decided by a permission`, `the harness policy is a ceiling the gate will not exceed` |
| prompt и memory не расширяют права | `a prompt or memory field inside a request cannot widen the grant`, `a grant field outside the schema is refused, so memory cannot become a permission source`, `a non-enumerable field outside the schema is refused too`, `a grant cannot arrive through a prototype or a symbol field`, `a grant read through an accessor cannot hand the gate a wider list than it validates` |
| неизвестная capability не даёт разрешение | `an unknown capability grants nothing`, `a grant carrying an unknown permission is refused loudly` |
| reviewer read-only по умолчанию | `an approving grant is read-only whether or not it is flagged as a reviewer`, `the reviewer default of §31 is read, verify, and approve only`, `a reviewer without a write permission cannot write the implementation it reviews` |
| credential references вместо секретов | `a credential is used as a reference and never as a secret`, `a reference that names a store is not mistaken for a secret`, `a credential reference on an operation that has no use for it is refused`, `the credential check is available on its own…` |
| домены §31 в runtime | `a task transition needs its own permission`, `an operation without a filesystem effect needs no path`, `a path is checked only for the operation that names one`, `a granted read inside the workspace is authorized`, `a decision carries the root the path was checked against` |

## 5. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short` / `git rev-parse HEAD` (старт) | 0 | дерево чистое, `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e` |
| `pnpm run check` на `fbee7a0` (до правок) | 0 | 112 pass / 0 fail |
| `pnpm run typecheck` | 1 → 0 | `HARNESS_POLICY_CEILING` не выводился в `readonly Permission[]` (`as const`); `segments[index]` при `noUncheckedIndexedAccess` (явная проверка `undefined`); затем `Done` по всем пакетам |
| `pnpm run build` | 0 | сборка всех пакетов |
| `node --test --test-isolation=none tests/security.test.mjs` | 1 → 0 | 25/26 → 26/26 (тест worktree ожидал отказа на относительном пути — неверен был тест) → после раунда 1 — 32/32 → после раунда 2 — **38 pass / 0 fail** |
| **mutation check, раунд 1** *(исторический: артефакт до правок ревью, 26 тестов; независимо не воспроизводим — снимка нет)* | — | path-guard → 2 fail; permission-guard → 3 fail; harness-ceiling → 1 fail; восстановление → 26/0 |
| **mutation check, раунд 2** (32 теста) | — | `path-missing` → **2 fail**; approving-grant → **1 fail**; идентичность: отключение всей ветки self-approval → 2 fail, минимальная мутация только casefold → **1 fail** (уточнено верификатором); prototype-guard → **1 fail**; восстановление → 32/0 |
| **mutation check, раунд 3** (38 тестов, после правок раунда 2) | — | сегмент с точкой/пробелом → 1 fail; правило колоночного присваивания → 1 fail; алфавит base64url-прогона → 1 fail; неперечислимое поле → 1 fail; **десинхронизация чтения гранта → 1 fail**; восстановление → 38/0 |
| `node --test --test-isolation=none tests/security.test.mjs` (изолированно) | 0 | **38 pass / 0 fail** — мои тесты |
| `pnpm run check` (итоговый) | 0 | **170 pass / 0 fail** на смешанном дереве: 112 прежних + 38 моих + 16 `evidence` + 4 прироста `boundaries` от параллельной сессии (MW-008). Мой вклад измерен изолированно (38) |
| `git diff --numstat` | 0 | README `61/0`, `contracts/src/team.ts` **`24/1`**, `core/src/index.ts` `1/0`, `contracts/src/index.ts` `3/0` (1 мой + 2 параллельной сессии) |
| подсчёт строк | 0 | `contracts/src/security.ts` 303/282, `core/src/security.ts` 592/558, `tests/security.test.mjs` 411/357 (метрика названа: все / непустые) |

Отдельно отмечу инцидент, который поймал mutation-check: тест на accessor-грант сначала был
**вакуумным** — грант собирался через спред в хелпере, из-за чего геттер вычислялся один раз и до гейта
доходил обычный массив. Мутация «десинхронизация чтения» такой тест не ломала. Тест переписан без
хелпера (геттер объявлен прямо в литерале) и теперь падает на этой мутации; заодно найдено и
исправлено настоящее чтение `permissions` дважды (`Array.isArray(...)` + присваивание).

## 6. Ограничения и что осталось за рамками

- **Текстовая проверка, не файловая.** `isWithinRoot` не раскрывает symlink/junction: реальную
  файловую систему по-прежнему ограничивает sandbox DSH. Скрытая ссылка внутри workspace теоретически
  может увести за его пределы — это известно и не заявляется как закрытое.
- **Регистр.** Регистронезависимо сравниваются только Windows-префиксы (диск, UNC); POSIX-пути —
  регистрозависимо (возможен ложный отказ, безопасное направление).
- **Идентификаторы агентов.** Для независимости ревьюера `AgentId` сравнивается без учёта регистра и
  Unicode-композиции, хотя в контракте это обычная строка. Соседняя проверка
  `assertReviewerIndependence` в `transitionReview` (MW-003) по-прежнему сравнивает точно — **это
  открытый пункт для владельца**: правка принятой MW-003 выходит за рамки MW-007.
- **`shell` и `mcp` не имеют пути.** `shell` ограничен потолком политики harness и рабочим каталогом
  рантайма (MW-015); `mcp.invoke` — только своим правом и самим MCP-сервером, то есть MCP-инструмент
  с файловым эффектом **не** проходит через границу, которую закрывает эта карточка. MCP-рантайма в
  дереве ещё нет; ограничение названо, а не спрятано.
- **Эвристика секретов консервативна в обе стороны, и её границы названы.** Отклоняются: PEM, JWT (в
  том числе за `Bearer`), вендорские токены, присваивания `key=value` и `password: value`/`"password":`
  (в том числе в JSON), hex от 32 символов, длинный прогон base64/base64url со смешением регистра и
  цифр. Принимаются ссылки без признаков секрета (`dsh:credential/deploy-key`,
  `op://prod/db-password:prod`, `secret:db-credential`, dashed UUID). Остаточные дыры, признанные
  честно: `token:abc123` без пробела после двоеточия и «секрет, разбитый разделителями на короткие
  куски» проходят; длинный непрозрачный id может быть отклонён как ключ. Это цена эвристики, а не
  заявленная полнота.
- **Закрытость схем.** Проверяются собственные ключи (включая неперечислимые) и symbol-поля; `Proxy`,
  который лжёт про свои ключи, в процессе не поймать, а объект из другого realm (`node:vm`)
  отклоняется (сравнение с `Object.prototype` этого realm) — переотказ в безопасную сторону.
- **Гейты §28** объявляет вызывающий: гейт отказывает (`human-gate`), но обнаружение того, что
  операция является миграцией или релизом, — задача control-surface; запись об одобрении человека не
  изобретается.
- **`production` не авторизуется никогда** (домен подразумевает гейт §28).
- **Живой рантайм DSH не подключался** (решение владельца): маппинг решения на sandbox/approval DSH —
  MW-015. Живой профиль, чужие проекты и доска не изменялись.
- **Коммита нет** (не поручался), push/merge/publish не выполнялись.
- **Параллельная сессия в том же дереве.** Соседняя сессия начала MW-008: `packages/contracts/src/{artifact,audit}.ts`,
  `packages/evidence/`, `tests/evidence.test.mjs`, правки `contracts/src/{ids,index}.ts`,
  `tests/lib/fixtures.mjs`, `tsconfig.base.json`, `pnpm-lock.yaml`. Эти файлы не трогались; в общем
  `contracts/src/index.ts` мой экспорт сохранён (проверено чтением). Общий файл — риск конфликта:
  правки рядом, не поверх.

## 7. Независимое ревью

Отчёт передан субагенту-ревьюеру в режиме review (состязательная проверка, read-only, словарь
`PASS` / `PASS WITH FINDINGS` / `FAIL`), затем — второму субагенту в режиме verify-fixes
(словарь `FIXES VERIFIED` / `FIXES PARTIALLY VERIFIED` / `FIXES NOT VERIFIED`).

## 8. Ревью, раунд 1: PASS WITH FINDINGS

Ревьюер воспроизвёл `pnpm run check` (138 pass / 0 fail), подтвердил mutation-check (2/3/1 падение и
побитово идентичный `lib/index.js` после пересборки), подтвердил процессную чистоту и прогнал свои
пробы: 48 состязательных кейсов `isWithinRoot`, 30 атак на гейт, 15 образцов credential. Обхода
границ пути/worktree он не нашёл; два обхода он нашёл в другом месте.

| # | Severity | Замечание | Исправление |
|---|---|---|---|
| F1 | **MAJOR** | Проверка границ выполнялась только при наличии `path`, а схема путь не требовала: `filesystem.write` **без пути** авторизовался | `OPERATIONS_REQUIRING_PATH` (`filesystem.*`, `git.*`) + отказ `path-missing`; проверенный путь входит в решение. Тест + мутация (2 fail) |
| F2 | **MAJOR** | Дефект «грант с правами записи» срабатывал только при `reviewer: true`: с `reviewer: false` одобряющий грант с `workspace.write`/`git.write`/`shell` авторизовался | Проверка привязана к наличию `review.approve`; такой грант отклоняется целиком. Тест + мутация (1 fail) |
| F3 | MINOR | Закрытость схем покрывала только собственные перечислимые строковые ключи (прототип читался как грант, symbol игнорировался) | Запрет необычного прототипа и symbol-полей. Тест + мутация (1 fail) |
| F4 | MINOR | Эвристика секретов пропускала `Bearer <JWT>`/base64/hex/`aws AKIA…` и ложно отклоняла законные ссылки | Шаблоны без якорей, снятие `Bearer`, правила hex-32 и непрозрачного прогона, сужение присваивания. Тесты; часть дыр осталась (см. §6) |
| F5 | MINOR | `workerAgentId: 'neo-1'` при `agentId: 'Neo-1'` проходил проверку независимости | Сравнение без учёта регистра (+ Unicode-композиции). Тесты + мутация |
| F6 | NIT | «259/461/223 строки» — непустые строки без названия метрики | В §5 названы обе метрики |

## 9. Верификация исправлений, раунд 2: FIXES PARTIALLY VERIFIED

Второй субагент проверил **дельту** (не второе ревью): F1, F2, F3, F5, F6 — **VERIFIED** с
воспроизведёнными мутациями и без найденных обходов (в том числе: перебор всех 12 ключей
`OPERATION_PERMISSIONS` показал, что множество операций с файловым правом совпадает с
`OPERATIONS_REQUIRING_PATH` побитово; 27/27 комбинаций «право записи × флаг reviewer» отказаны;
дубликаты, варианты регистра, пробелы, symbol/прототип/вложенность/`Set`/`Uint8Array`/геттер/Proxy —
все отказ). **F4 — PARTIAL**: заявленные образцы закрыты, но остались обходы.

Найденное верификатором и исправленное в этом же прогоне:

| # | Severity | Дефект | Исправление |
|---|---|---|---|
| V1 | MINOR | `AuthorizationDecision.path` нёс сырую строку без корня: потребитель не мог понять, какой файл авторизован | В решение добавлен `boundaryRoot` (worktree или workspace). Тесты `a decision carries the root the path was checked against`, проверка `boundaryRoot` в worktree-тесте |
| V2 | MINOR | Сужение правила присваивания до `key=` открыло колоночные формы (`password: hunter2`, `{"password":"hunter2"}`) | Добавлено отдельное правило колоночного присваивания (ключ в начале/после кавычки/пробела **и** пробел/кавычка после разделителя), поэтому `secret:db-credential` и `op://prod/db-password:prod` остаются принятыми. Тесты + мутация (1 fail) |
| V3 | MINOR | `hasOpaqueKeyRun` разбивал прогон по `-`/`_` — то есть по алфавиту base64url — и пропускал такие ключи | `-`/`_` включены в алфавит прогона. Тест + мутация (1 fail) |
| V4 | NIT | `readContext` читал `permissions` более одного раза: accessor мог отдать проверяемый и используемый массивы разные | Чтение ровно один раз (найдено также моим mutation-check: тест на accessor был вакуумным). Тест `a grant read through an accessor…` + мутация десинхронизации (1 fail) |
| V5 | NIT | `path-missing` стоял перед `foreign-workspace` и скрывал нарушение §52 в причине отказа | Порядок изменён на `foreign-workspace` → `path-missing`; докстрока приведена в соответствие. Тест `a foreign workspace is reported even when the path is missing` |
| V6 | NIT | Закрытые схемы игнорировали собственные **неперечислимые** поля | `Object.getOwnPropertyNames` вместо `Object.keys`. Тест `a non-enumerable field outside the schema is refused too` + мутация (1 fail) |
| V7 | NIT | `sameAgent` не нормализовал Unicode: NFC против NFD проходили как разные акторы | `normalize('NFC')` перед сравнением. Тест `an identity that differs only in unicode composition is the same actor` |
| V8 | NIT | Сегмент с висячей точкой/пробелом (Win32 их обрезает) сравнивался как литеральное имя | Такой сегмент отклоняется. Тест `a segment windows would strip before resolving is refused` + мутация (1 fail) |
| V9 | NIT | `mcp.invoke` не требует пути и не управляется потолком harness — MCP-инструмент с файловым эффектом вне границы | Граница названа в §6 и README (MCP-рантайма в дереве нет; протокол пути для MCP не изобретается) |
| V10 | NIT | `team.ts` указан как `+25/−1`, тогда как numstat даёт `24/1` | Исправлено в §3.1 и §5 |
| V11 | — | Расхождение чисел: `pnpm run check` = 164 у верификатора против 160 в отчёте (соседняя сессия добавила 4 теста `boundaries`) | Итоговое значение и состав названы в §5; мой вклад измерен изолированно (38) |

Заявление верификатора о раунде 1 («identity-casefold → 2 fail») уточнено: 2 падения даёт отключение
всей ветки self-approval, а минимальная мутация только casefold — 1 падение; обе цифры в §5 названы
вместе с тем, какая именно мутация что даёт.

**Что осталось непроверенным независимо:** исправления V1–V11 независимым верификатором **не
перепроверялись** — третий проход не запускался. Проверка этих правок опирается на мои собственные
тесты и mutation-check (§5, раунд 3), то есть **не является независимой приёмкой**. Остаточные
границы эвристики секретов (§6) сохраняются осознанно.

**Статус: DONE** — переведён из `READY_FOR_REVIEW` по прямому указанию владельца (сессия MW-020). Приёмка — акт владельца; она не отменяет §9: исправления V1–V11 независимым верификатором не перепроверялись, а остаточные границы эвристики секретов (§6) сохраняются осознанно.
