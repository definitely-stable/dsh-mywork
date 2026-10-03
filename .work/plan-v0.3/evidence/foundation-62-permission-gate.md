# F-62 · Гейт прав: масштаб — сколько карточек формально требует подтверждения

**Статус: READY_FOR_REVIEW.** Оба замера выполнены: «ДО» — `read-only` / **33** карточки; «ПОСЛЕ» — `workspace-write` / **0** карточек. Гейт выполнен по ветке «ожидаем 0».

**Правило гейта (первоисточник, не пересказ):** `requiresPermissionConfirmation(task, sessionDefault) = exceedsSessionDefault(effectivePermission(task), sessionDefault) && task.permissionConfirmedAt === void 0` — `lib\index.js:877-879`.
**Дефолт при отсутствии значения:** `"read-only"` — `lib\index.js:816`, `:5568` (`config?.sessionDefaultPermission ?? "read-only"`).

## Замер «ДО»

| Параметр | Значение |
|---|---|
| `revision` леджера | **324** |
| `sessionDefaultPermission` (живой API доски) | **`"read-only"`** |
| Карточек всего | 55 (backlog 32 / done 19 / failed 1 **без** архивных; 3 архивных) |
| `permission` у всех 55 | `workspace-write` |
| `model` у всех 55 | `opencode-go/deepseek-v4.1-flash` |
| С `permissionConfirmedAt` | **22** |
| **Выше дефолта И без `permissionConfirmedAt`** | **33** (в рабочем наборе без архивных — **31**) |
| `permissionPending: true` (производное поле доски) | 33 — совпадает с правилом |

### Список id без подтверждения (33; по правилу «ДО»)

| Карточка | id | Карточка | id |
|---|---|---|---|
| MW-021 | `1589a35a-91cd-41a9-930a-65293cce9f90` | MW-037 | `82c39792-856d-4168-82a4-3bbb71571e8d` |
| MW-022 | `1924a37d-592e-4858-a290-6d1b84c3a6f5` | MW-038 | `a4edddc3-d7b6-4f39-9b89-c6489c026933` |
| MW-023 | `650491a3-db89-4716-abe7-d317d89482e1` | MW-039 | `c51ae89d-6f5d-49bf-8ebd-8822e10d2e28` |
| MW-024 | `05b08a47-7f0f-4e9a-9b4a-825df16088cc` | MW-040 | `7daa2fc9-9b07-42b4-9b45-4a42861c0ca4` |
| MW-025 | `da617bd1-5146-40e4-879a-ad99d3704f6d` | MW-041 | `d61d6871-0fe1-402f-b965-2557a7da5352` |
| MW-026 | `bee3760c-8eef-49e7-b588-0a27414e3f38` | MW-044 | `26e42d6f-96e4-5ebf-adc5-bb6766e1f670` |
| MW-027 | `e5bdbc44-0dfe-4e0c-ab26-2b526d3d3861` *(архивная)* | MW-045 | `3d6913fa-75e3-5a12-a863-affc3c638d42` |
| MW-028 | `86f92814-522a-4761-9e3c-66f8bde03dff` | MW-046 | `2cff2e90-3411-5ab9-a244-615a47c1c000` |
| MW-029 | `025a73a1-a348-41c6-9846-2fef20f3ee81` | MW-047 | `e85a90ea-d75e-519b-a251-cb8fc747a1bd` |
| MW-030 | `6d13316a-29a6-433d-931a-50fa8b8b76c2` | MW-048 | `9347bde6-36a2-5acf-a3b5-42039584df33` |
| MW-031 | `6eb5bb23-baf6-4260-b885-a66cc3431230` | MW-049 | `6dc3b47e-222f-5e54-a156-a411222d03d6` |
| MW-032 | `92e48d64-4b12-44a6-80d2-8f837b019e7f` | MW-050 | `0518715a-3b1c-5c87-afc3-508f9c711bb0` |
| MW-033 | `1f2ee8a9-f8b0-4981-b6bb-0999d22ce97f` | MW-051 | `3c299779-b7c5-5d8e-ad6f-794f520d4cfc` |
| MW-034 | `55c5025b-bb5d-4f7b-b96c-f21d194a035a` | MW-052 | `73e9b328-3d3e-5125-a02e-4e86a39d6110` |
| MW-035 | `d66573e0-720f-419f-ba72-a8a0bfe2d50f` *(архивная)* | MW-053 | `d1d4b42f-8654-5c2e-ae53-9eaa68ce2b78` |
| MW-036 | `cccb16bb-73ae-457a-814f-2b75cafb5cda` | MW-054 | `64601bdf-7b2a-58fb-a426-888c89957efd` |
|  |  | MW-055 | `71376ee1-20fc-5db7-a424-1651872ac64b` |

Уточнение против формулировки плана: закреплено **33** (а не 12 «MW-044…MW-055»). Из них **2** (MW-027, MW-035) с тех пор ушли в архив (F-07), поэтому в рабочем наборе гейт формально держит **31** карточку.

## Замер «ПОСЛЕ F-04» — ИЗМЕРЕН

| Параметр | ДО | ПОСЛЕ |
|---|---|---|
| `revision` леджера | **324** | **325** |
| `sessionDefaultPermission` (живой API доски) | **`"read-only"`** | **`"workspace-write"`** ✔ |
| `permission` у всех карточек | `workspace-write` | `workspace-write` (не менялось) |
| С `permissionConfirmedAt` | 22 | **22** (не менялось — человек не подтверждал) |
| Без `permissionConfirmedAt` | 33 | **33** (не менялось) |
| `permissionPending: true` (производное поле) | **33** | **0** |
| **Требуют подтверждения по правилу** (`permission` выше дефолта **И** нет `permissionConfirmedAt`) | **33** | **0** ✔ |
| `counts` | backlog 32 / todo 0 / running 0 / done 19 / failed 1 / archived 3 | без изменений |

**Гейт F-62 выполнен по ветке «ожидаем 0»:** при `workspace-write` как session default привязка `workspace-write` перестаёт быть «выше дефолта», и требование подтверждения снимается **для всех 33 карточек сразу**. Массовое подтверждение прав **не выполнялось** (это действие человека) — и не потребовалось: `permissionConfirmedAt` остался пустым у тех же 33 карточек, но они больше не блокируются.

**Предсказание про производное поле подтвердилось.** В F-62 (раздел ниже) было записано: «как только F-04 поднимет дефолт до `workspace-write`, `permissionPending` исчезнет у всех карточек сам». Измерено: `PENDING_COUNT` 33 → **0**, при неизменном `permissionConfirmedAt`. Это доказывает, что `permissionPending` не хранится в леджере, а вычисляется при отдаче (`lib\index.js:4221`) — то есть 33 «блокировки» были артефактом чтения, а не состоянием доски.

### Дополнительно проверено по профилю (независимо от Lead)

| Команда | exit code | Наблюдение |
|---|---|---|
| `Select-String <profile>\cordis.patch.yml -Pattern 'sessionDefaultPermission' -Context 4,4` | 0 | Строка **25** — `sessionDefaultPermission: workspace-write` теперь **верхнеуровневый** ключ, сосед `plugin:` и `announceToAgent:`; вложенного `config: { … }` больше нет |
| `Select-String <profile> -Pattern 'autoRun'` | 0 | `MATCH_autoRun = 0` — 7 ключей `autoRun*` удалены (сверка с заявкой Lead) |
| `Get-Item <profile>` | 0 | `MTIME = 2026-09-27 12:56:02.740 +05:00`, `LINES = 98` |
| `node -e "…createRequire(<anchor>)('yaml').parse(<profile>)"` | **0** | `PARSED_OK type=array len=16` — YAML валиден (от якоря профиля и от якоря плагина; от якоря `bundle/web-app` — `MODULE_NOT_FOUND`, модуля `yaml` там нет) |

### Про «требует перезапуска» — уточнение фактического наблюдения

Ожидание «значение обновится только после перезапуска Host» **не подтвердилось**: живой API отдал `workspace-write` в пределах той же наблюдательской сессии, при том что секундой ранее (на том же `revision: 325`) он отдавал `read-only`. Перезапуск процесса не потребовался — сработало перемонтирование/перечитывание патча живого профиля. Поэтому:
- **F-06 и F-62 закрыты измерением, а не отложены как `PENDING-RESTART`;**
- остаточная неопределённость — только в механизме перечитывания (что именно триггерит перемонтирование плагина), а не в значении.

## Почему «ДО» именно `read-only` при `workspace-write` в файле профиля

Профиль `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml`, строки 20–35 (mtime 2026-09-26 20:58:52.406 +05:00):

```yaml
- {
    id: web-ui-task-board,
    config:
      {
        plugin: "@linxin666/dsh-client-ui-task-board",
        config: { sessionDefaultPermission: workspace-write },   # ← строка 25: ВЛОЖЕННЫЙ ключ
        announceToAgent: true,
        autoRunTodo: true,
        …
      }
  }
```

Схема плагина объявляет `sessionDefaultPermission` **верхнеуровневым** ключом своего Config (`lib\index.js:5391-5400`):

```js
const Config = z.object({
	announceToAgent: z.boolean().default(false).volatile(),
	enabled: z.boolean().default(true).volatile(),
	preventIdleSleep: z.boolean().default(false).volatile(),
	trustedProxyHosts: z.array(z.string()).default([]),
	proxyTokenEnv: z.string().min(1).default(DEFAULT_PROXY_TOKEN_ENV),
	sessionDefaultPermission: z.union(TASK_PERMISSIONS).default(DEFAULT_SESSION_PERMISSION),   // ← :5397
	maxSubtaskDepth: z.number().min(1).max(3).default(1).volatile(),
	teamProvider: z.string().min(1).default(DEFAULT_TEAM_PROVIDER)
});
```

Присвоение в Host-сервис (`:5568`): `sessionDefaultPermission: config?.sessionDefaultPermission ?? "read-only"`.

**Цепочка:** вложенный `config: { sessionDefaultPermission: workspace-write }` кладёт значение под ключ с именем `config`, а не в сам Config → `config.sessionDefaultPermission` = `undefined` → срабатывает `?? "read-only"` → доска отдаёт `read-only`, хотя в yml написано `workspace-write`. Плоские соседи (`announceToAgent`, `autoRun*`) до Config доходят и работают — отсюда асимметрия, описанная в F-62 как дефект F-04. Цепочка подтверждена **живым наблюдением**: `sessionDefaultPermission = "read-only"` при уже присутствующем в файле `workspace-write`.

## `permissionPending` — производное поле, а не сохранённый флаг

`lib\index.js:4221` (сериализатор карточки):

```js
...task.permissionConfirmedAt === void 0 ? {} : { permissionConfirmedAt: task.permissionConfirmedAt },
...requiresPermissionConfirmation(task, sessionDefault ?? "read-only") ? { permissionPending: true } : {},
```

`permissionPending` вычисляется **в момент отдачи** из текущего `sessionDefault`. Следствие-предсказание: как только F-04 поднимет дефолт до `workspace-write`, `permissionPending` исчезнет у всех карточек **сам**, без подтверждения хотя бы одной из них, и без записи в леджер. Если после F-04 поле останется — это признак, что дефолт не поднялся (либо доска не перечитала конфиг), а не «33 карточки всё ещё ждут человека».

## Таблица «команда → exit code → наблюдение»

| Команда / вызов | exit code | Наблюдение |
|---|---|---|
| `task_board_list {includeArchived: true, limit: 200}` | n/a (tool, `ok: true`) | `revision: 324`, `sessionDefaultPermission: "read-only"`, `counts: backlog 32 / todo 0 / running 0 / done 19 / failed 1 / archived 3`, `armedSchedules: 0`, `maxSubtaskDepth: 1`, `timeZone: Asia/Yekaterinburg` — совпадает с исходными фактами кампании |
| Разбор леджера: `Group-Object {permission}\|{permissionPending}\|{permissionConfirmedAt}` | 0 | `workspace-write\|pending=False\|confirmed=True => 22`; `workspace-write\|pending=True\|confirmed=False => 33`. Третьего класса нет |
| `grep -n "requiresPermissionConfirmation\|DEFAULT_SESSION_PERMISSION" <plugin>/lib` | 0 | `index.js:816` дефолт; `:877-879` предикат; `:4221` производство `permissionPending`; `:5568` чтение конфига; `client.js:1648/:1709/:4112` — клиентская половина |
| `Read index.js:5388-5405`, `:5558-5575` | 0 | Схема Config и точка чтения значения — цепочка дефекта F-04 (см. выше) |
| `Select-String <profile>\cordis.patch.yml -Pattern 'sessionDefaultPermission'` | 0 | Строка 25 — вложенный ключ; mtime профиля 2026-09-26 20:58:52.406 |
| `Select-String <profile>\cordis.patch.yml -Pattern 'agent-preset-registry' -Context` | 0 | **Строки 59–61** (после правки F-04 якорь сдвинулся с 66–68; ключ `sessionDefaultPermission` теперь на строке 25): `59: - id: agent-preset-registry` / `60: config:` / `61: default: cordis` |
| `task_board_list {query: "ZZZ-NO-SUCH-CARD"}` | n/a (tool, `ok: true`) | Компактный способ читать только сводку доски: `revision: 325`, `sessionDefaultPermission: "read-only"` |
| `task_board_list {query: "ZZZ-NO-SUCH-CARD"}` — **ПОСЛЕ** | n/a (tool, `ok: true`) | `revision: 325`, **`sessionDefaultPermission: "workspace-write"`** |
| `task_board_list {includeArchived: true, query: "MW-"}` — **ПОСЛЕ** | n/a (tool, `ok: true`) | 55 карточек; матрица `pending=False\|confirmed=True => 22`, `pending=False\|confirmed=False => 33`; **`permissionPending` отсутствует у всех**; правило → **0 нарушений** |
| `task_board_list {query: "MW-044"}` — **ПОСЛЕ** | n/a (tool, `ok: true`) | `permission: workspace-write`, `permissionPending` **отсутствует** |

## Ограничения

- `permissionConfirmedAt` — единственный признак «человек подтвердил». Я его **не выставлял и не снимал** ни у одной карточки: это действие человека (запрещено границами задачи и планом: «Массовое подтверждение — действие человека, не агента»).
- Числа «ДО» сняты с `revision: 324`. Единственная моя мутация леджера — пин `mode: cordis` на MW-002 (F-61), поднявший ревизию до **325**; на `permission`/`permissionConfirmedAt` она не повлияла (проверено до/после на MW-002). Поэтому «31/33» после неё не пересчитывались: ни одна карточка не сменила permission-привязку.
- Значение `revision` для замера «ПОСЛЕ» будет **больше** 325 — из-за моей же правки `mode` и возможных правок Lead. Сравнивать «ДО/ПОСЛЕ» по ревизии можно только как «ревизия на момент замера», не как дельту от одной причины.
- Предикат вычитан из собранного бандла плагина (`lib/index.js`), не из `src/**` — исходников `src/core/handover.ts` на машине нет. Ссылка плана на `handover.ts:44` как на путь **не подтверждена**; её суть подтверждена через `lib/index.js:816`.

## Что НЕ проверено

- Не проверено, действительно ли **запуск** 31 карточки пройдёт после снятия гейта: ни одна карточка не запускалась (расход квоты запрещён границами задачи).
- Не проверено, перечитывает ли живой процесс профиль без перезапуска/перезагрузки плагина: замер «ПОСЛЕ» покажет это косвенно (значение в API изменится только после перечитывания конфига).
- Не проверено, как гейт ведёт себя для карточки с `permission` ниже дефолта (`read-only` при `workspace-write`) — таких карточек в леджере нет.
- Не проверялся `autoRun*`-путь: `autoRunTodo: true`, но `autoRunPaused: true`, `armedSchedules: 0` — автозапуска не было и он вне F-62.

---

## Переисполнение 2026-10-03 (R-47) — см. `foundation-47-stage0-restore.md` §C–§D

Числа перемерены **до** и **после** починки ключа на живом леджере `revision: 341` (55 карточек):
до — фактический дефолт `read-only`, гейт **33** (`MW-021…MW-041`, `MW-044…MW-055` — тот же перечень, что в таблице «ДО»);
после (F-04 применён в живом профиле) — **`sessionDefaultPermission: "workspace-write"`, гейт 0**. Значение снято с живого
API `task_board_list`, а не из файла; предикат взят **из установленного артефакта 0.4.4** (извлечён и исполнен на леджере),
а не переписан вручную; контроль — `MW-002` с `permissionConfirmedAt`, у которого предикат `false` в обоих режимах.
Строка 150 («не проверено, перечитывает ли живой процесс профиль без перезапуска») **закрыта положительно**:
значение в API изменилось без перезапуска — ряд `hmr` базового бандла наблюдает `profile.patchPath`
(`packages/boot/hmr/src/index.ts:215,235`) и пересобирает патчи. Массовое подтверждение прав не потребовалось:
при `workspace-write` как дефолте привязка `workspace-write` не «выше дефолта» (`exceedsSessionDefault` — строгое `>`).
Ложная картина защиты от runaway-запусков снята вместе с 7 мёртвыми ключами `autoRun*` (F-05): после правки `autoRun` — 0 совпадений.
Ревизия 341 в обоих замерах — дельта по ревизии не накопилась: правка профиля леджер не трогала.
