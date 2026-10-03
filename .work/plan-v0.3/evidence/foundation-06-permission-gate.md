# F-06 · Доказать, что гейт прав снят: карточка без ручного подтверждения запускается

**Статус: READY_FOR_REVIEW.** Гейт **снят и измерен**: `task_board_get`-эквивалент для эталонной карточки `MW-044` даёт `permission: workspace-write` и **не содержит** `permissionPending`/`confirmation-required`; по всему корпусу 0 карточек, требующих подтверждения (было 33).

**Ни одна карточка не запускалась.** `task_board_run` не вызывался ни разу: доказательство построено на состоянии привязки (`task_board_get` → `permission` / `permissionPending`) и на предикате гейта из кода. Это прямо разрешено планом («либо ограничиться чтением состояния привязки (шаг 2) без `run`»).

## Что сделано

1. **Шаг 0 (R-05).** id карточки получен из `task_board_list {query: …}`, дальнейшие обращения — только по UUID.
2. **Найден и вычитан предикат гейта** (не пересказ плана, а сам код установленного плагина).
3. Зафиксировано **состояние «до F-04»**: значение `sessionDefaultPermission` и статус привязки эталонной карточки.
4. Зафиксировано **состояние «после F-04»**: тот же замер повторён после правки профиля.
5. Сделан вывод о снятии гейта **без запуска**.

## Предикат гейта (первоисточник)

`C:\Users\Dmitry\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\lib\index.js`:

```js
816: const DEFAULT_SESSION_PERMISSION = "read-only";
877: function requiresPermissionConfirmation(task, sessionDefault = DEFAULT_SESSION_PERMISSION) {
878: 	return exceedsSessionDefault(effectivePermission(task), sessionDefault) && task.permissionConfirmedAt === void 0;
879: }
```

Комментарий над функцией (`:874-876`) формулирует назначение дословно: «The confirmation-gate predicate: an elevated permission without a human confirmation stamp. Manual run/rerun and cron must refuse such a card.»

Точки применения:
- `:2471` — отказ для ведущей карточки Team-каскада (`teamRun`), `:2478` — для закреплённой подзадачи, `:2485` — для обычного каскада (`participants.find(...)`);
- `:2444` — `throw new Error(bindingRefusalMessage(refusal, this.sessionDefaultPermission, "run"))` — то есть **отказ на запуске**;
- `:2246` — тот же отказ для расписания (`"schedule"`);
- `client.js:1648`, `:1709`, `:4112` — та же логика в клиентской половине (`requiresPermissionConfirmation(current, snapshot.host?.sessionDefaultPermission)`).

**Следствие, важное для F-06:** гейт срабатывает при `permission` **строго выше** session default **и** отсутствии `permissionConfirmedAt`. При `sessionDefaultPermission = "workspace-write"` привязка `workspace-write` **не выше** дефолта, поэтому подтверждение не требуется — и карточка запускается без человеческого действия.

## Таблица «команда → exit code → наблюдение»

| Команда / вызов | exit code | Наблюдение |
|---|---|---|
| `grep -n "requiresPermissionConfirmation\|DEFAULT_SESSION_PERMISSION\|sessionDefaultPermission" <plugin>/lib` | 0 | 28 совпадений; предикат — `index.js:877-879`, дефолт — `index.js:816`, `:5568`; клиентская половина — `client.js:1648`, `:1709`, `:4112`. Все ссылки плана (`:2444-2485`, `:5568`, `:4281`) подтверждены |
| `Read index.js:874-895` | 0 | Дословный предикат + комментарий назначения (см. выше) |
| `Read index.js:2468-2493` | 0 | Отказ возвращается как объект `{kind, title}` по трём ветвям: root (`:2471`), `subtask-pin` (`:2478`), `inherited`/`root` (`:2485-2490`) |
| `task_board_list {includeArchived: true}` — **ДО** | n/a (tool, `ok: true`) | `revision: 324`, **`sessionDefaultPermission: "read-only"`** |
| `task_board_get 26e42d6f…` (MW-044) — **ДО** | n/a (tool, `ok: true`) | `permission: "workspace-write"`, `permissionPending: true`, **`permissionConfirmedAt` отсутствует** ⇒ гейт формально закрыт |
| `Select-String <profile>\cordis.patch.yml -Pattern 'sessionDefaultPermission'` — **ДО** | 0 | Строка 25: `config: { sessionDefaultPermission: workspace-write }` — **вложенный** ключ; mtime профиля 2026-09-26 20:58:52 (правка F-04 ещё не применена) |
| `task_board_list {query: "ZZZ-NO-SUCH-CARD"}` — **ДО** | n/a (tool, `ok: true`) | `revision: 325`, `sessionDefaultPermission: "read-only"` — то есть даже при уже присутствующем в yml `workspace-write` доска отдаёт `read-only` |
| **ПОСЛЕ F-04** — см. следующий раздел | — | — |

### Состояние «ПОСЛЕ F-04» — ИЗМЕРЕНО

| Команда / вызов | exit code | Наблюдение |
|---|---|---|
| `Select-String <profile>\cordis.patch.yml -Pattern 'sessionDefaultPermission' -Context` | 0 | Строка **25** — ключ теперь **на верхнем уровне**, сосед `plugin:`/`announceToAgent:`. mtime профиля **2026-09-27 12:56:02.740 +05:00** (правка Lead). `MATCH_sessionDefaultPermission = 1`, `MATCH_autoRun = 0`, `LINES = 98`; YAML разобран `yaml.parse` от якоря профиля → `array len=16` |
| `node -e "createRequire(<profile>/web/package.json)('yaml').parse(<profile>)"` | **0** | `PARSED_OK type=array len=16` — файл валиден (тот же приём от якоря `dsh-client-ui-task-board/package.json` тоже даёт 16) |
| `task_board_list {query: "ZZZ-NO-SUCH-CARD"}` — **ПОСЛЕ** | n/a (tool, `ok: true`) | `revision: 325`, **`sessionDefaultPermission: "workspace-write"`** |
| `task_board_list {query: "MW-044"}` — **ПОСЛЕ** | n/a (tool, `ok: true`) | `permission: "workspace-write"`, **`permissionPending` ОТСУТСТВУЕТ** (было `true`), `permissionConfirmedAt` по-прежнему отсутствует |
| Полный разбор леджера (55 карточек) — **ПОСЛЕ** | 0 | Матрица: `perm=workspace-write\|pending=False\|confirmed=True => 22`; `perm=workspace-write\|pending=False\|confirmed=False => 33`. **`PENDING_COUNT = 0`** (было 33). `CONFIRMED_COUNT = 22` — не изменилось. Правило «выше дефолта И без подтверждения» → **0 нарушений** |

**Гейт F-06 выполнен буквально в формулировке плана:** эталонная карточка `MW-044` даёт `permission: workspace-write` и **не содержит** `confirmation-required` / `permissionPending`. Гейт снят.

## Вывод

**До F-04** гейт закрыт: при `sessionDefaultPermission = "read-only"` привязка `workspace-write` выше дефолта, `permissionConfirmedAt` отсутствует — карточка формально требует подтверждения человека, и запуск отказывает на `index.js:2444`.

**После F-04** гейт снят для всего корпуса сразу: `sessionDefaultPermission = "workspace-write"`, дефолт перестал быть ниже привязки, `permissionPending` исчез у всех 33 карточек — **при том, что `permissionConfirmedAt` не появился ни у одной** (22 было, 22 осталось). То есть карточки запускаемы **без единого человеческого подтверждения**, ровно как требует цель F-06.

**Механизм снятия гейта — не «правка yml», а значение `sessionDefaultPermission`, которое доска реально отдаёт.** Оно берётся из `config?.sessionDefaultPermission ?? "read-only"` (`:5568`) и по умолчанию равно `"read-only"` (`:816`). Пока в профиле ключ лежал вложенным (`config: { sessionDefaultPermission: … }`), плагин его не видел и падал в дефолт — это наблюдалось живьём. После переноса ключа на верхний уровень значение стало `workspace-write`.

**Уточнение к ожиданию «PENDING-RESTART»:** перезапуск Host **не потребовался**. Значение в живом API изменилось в пределах той же сессии-наблюдателя (замер «до» → `read-only` при rev 325, замер «после» → `workspace-write` при той же rev 325).

**Механизм remount'а подтверждён (независимое ревью + моя проверка по коду).** В `C:\Users\Dmitry\.dsh\profiles\web\node_modules\@linxin666\dsh-web-all\lib\shell-DWqLngib.js`:
`:1170` — `if (mounted !== void 0 && mounted.spec === spec && sameFamilyConfig(mounted.config, family)) return;` (ранний выход, когда family-конфиг не изменился);
`:1171-1179` — при изменении конфига предыдущий маунт **dispose**-ится (`await previous.dispose?.()`), после чего строка переимпортируется;
`:1214-1216` — `ctx.on("loader/volatile-update", () => { schedule(); })` — пересинхронизация строки запускается событием Loader'а, а не перезапуском процесса.
То есть изменение патча живого профиля приводит к перемонтированию строки плагина: Host-сервис доски создаётся заново и `config?.sessionDefaultPermission` (`index.js:5568`) читается с новым значением. Остаточная неопределённость: точно установлено, что перемонтирование произошло **на стороне Host** (иначе `task_board_list` не сменил бы значение — оно берётся из `TaskBoardHostService`), но какой именно loader-контекст инициировал volatile-update, я не трассировал.

## Ограничения

- Доказательство **не включает реальный запуск**, поэтому «снятие гейта» подтверждено на уровне предиката и состояния привязки, а не наблюдённым успешным прогоном. Это сознательный выбор: план разрешает его прямо («Mitigation: проверять на карточке-пустышке либо ограничиться чтением состояния привязки (шаг 2) без `run`»), а запуск тратит квоту.
- Предикат вычитан из **собранного** бандла (`lib/index.js`, минифицирован по пробелам, но не по именам), а не из исходников `src/core/handover.ts` — их в этой машине нет (`Get-ChildItem -Filter handover.ts` под `C:\Reposit` → ничего). Ссылка плана на `src/core/handover.ts:44` **не подтверждена как путь**; подтверждена её суть по `lib/index.js:816`.

## Что НЕ проверено

- Не проверено поведение гейта при `permission` **ниже** дефолта (например `read-only` при `workspace-write`): карточек с `read-only` в леджере нет — все 55 имеют `permission: workspace-write`.
- Не проверено действие `task_board_run` на карточке с неподтверждённой привязкой — то есть фактический текст отказа `bindingRefusalMessage(..., "run")` не наблюдался. Он выведен из кода (`:2444`).
- Не проверялся `teamRun`-путь (`:2471`) и путь расписания (`:2246`): карточек с `teamRun` и расписаний в леджере нет (`armedSchedules: 0`).
- Массовое подтверждение прав **не выполнялось** — это действие человека (запрещено границами задачи).

---

## Переисполнение 2026-10-03 (R-47) — см. `foundation-47-stage0-restore.md` §C–§D

Гейт снят в живом профиле и **наблюдён на живом API без перезапуска DSH**: `task_board_list` до правки →
`sessionDefaultPermission: "read-only"`; после правки `cordis.patch.yml` (ключ поднят на уровень `plugin:`) →
**`"workspace-write"`**; `revision: 341` в обоих замерах. `task_board_get` карточки MW-044 (была в гейте,
`permissionConfirmedAt` отсутствует) → `permission: workspace-write`, полей `permissionPending` / `confirmation-required` нет.
Предикат, **извлечённый из установленного 0.4.4** и исполненный на живом леджере: **гейт@read-only = 33 → гейт@workspace-write = 0**
(`MW-044`: true → false; контроль `MW-002` с подтверждением: false в обоих режимах — предикат не «всегда false»).

Это снимает **остаточную неопределённость** прежнего прохода (§«То есть изменение патча живого профиля приводит к
перемонтированию строки плагина», строки 72–75 этого файла): там было не трассировано, какой loader-контекст инициирует
`volatile-update`. Теперь корень назван: базовый бандл монтирует ряд `hmr` (`@deepseek-ai/dsh-hmr`,
`packages/bundle/base/cordis.patch.yml:28-29`), и он **безусловно** вешает наблюдение за `profile.patchPath` —
`packages/boot/hmr/src/index.ts:215,235` (`watchConfig(profile.patchPath, () => refresh(false))` → `reconcileProfilePatches`).
Повторное монтирование безопасно: `mountOnce` (`lib/index.js:5850-5874`) снимает имя в `dispose` и выполняет отложенный `mount`.
Якоря перемерены на **0.4.4**; прежние (`index.js:5568`, `:1170-1216`) остаются историческим замером 0.4.3.
Карточки не запускались; `patchReload: "live"` в `profiles\web\package.json` — инертная метка (0 читателей), живое
перечитывание даёт ряд `hmr`, а не она.
