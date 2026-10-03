# lead-17 — Композиция живого профиля `web` и пресет `standard`

## Факты

- Живой профиль = `C:\Users\Dmitry\.dsh\profiles\web` (`DSH_PROFILE=web`, `DSH_PROFILE_DIR`, env текущей сессии). Корень пуст: `profiles\web\cordis.yml:1-4` — `[]`; вся сборка идёт слоями патчей.
- Пользовательский слой: `profiles\web\cordis.patch.yml` — `agent-preset-registry.config.default = cordis` (`:66-68`), `web-ui-task-board` `sessionDefaultPermission: workspace-write` (`:20-35`), `webserver` `host 0.0.0.0:3080` (`:97-104`).
- Список бандлов (15) — `profiles\web\package.json:20-35`; `patchReload: live` (`:36`). Версия чек-аута `0.1.7-rc.2`.
- Источник пресетов: `packages\bundle\web-app\package.json:43-49` — `dsh.bundle.patch` = `cordis.patch.yml` + `presets/{standard,ptc,minimal,cordis}.patch.yml`. Ряды `standard` — `packages\bundle\web-app\presets\standard.patch.yml:1-146` (29 рядов, 23 включённых).
- Первоисточник ошибки MW-002: `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`, задача `cc19da5a-ff24-45ed-8b19-236e02b2556d`, исполнения `f282db49-…` (started 2026-09-16T18:37:33Z) и `09fcc27f-…` (18:38:20Z), поле `error` = полный список ровно **24** пар `ряд: пакет`. Цитата-пересказ — `.work\plan-v0.3\evidence\decision-00-limitation-and-refutations.md:36-44`.
- Все 24 = **весь agent-plane**; `disabled`-ряды в список не попали (нет `tool-bash`, `tool-pwsh`, `tool-subagent-codex/claude-code`, `tool-ralph`, `tool-plugin-manager`) — совпадает с `mount.ts:193` (`if (entry.disabled) continue`).
- Падение = провал монтирования пресета до первого хода агента: `1789583853269 → 1789583853339` ms, т.е. **70 мс**, `result: "failed"` (`mount.ts:258-267`: `mountPreset` бросает, если `audit.failed.length > 0`).
- Ошибочный текст `N rows name plugins that cannot be resolved:` в текущем чек-ауте **не производится** (grep по всему чек-ауту: 0 вхождений; есть только единственное число в тесте `packages\client\ui-workspace\tests\workspaces-service.client.spec.ts:656`). Текущий код печатает построчно `id (name): never started` (`packages\preset\agent-preset-registry\src\mount.ts:196`).
- Падавшая ревизия пресета — старая: в ней ряд `workflow-worker-thread: @deepseek-ai/dsh-workflow-worker-thread`; в поставляемом `standard` такого ряда нет (там `workflow-ptc`, `standard.patch.yml:119-122`).
- База резолва имён — **каталог своего бандла**, не профиль: `logs\startup-2026-09-26T05-46-53.033Z-….log:22` показывает резолв `@deepseek-ai/dsh-agent-preset-registry` в `packages\bundle\web-app\node_modules\@deepseek-ai\…`, а `:16` — `dsh-permission-presets` в `packages\bundle\base\node_modules\…`.
- Две «фермы» пакетов: свежая `packages\bundle\web-app\node_modules\@deepseek-ai` (137 записей; junction `dsh-workflow-ptc` создан 2026-09-26 10:39) и **устаревшая** `C:\Users\Dmitry\.dsh\profiles\node_modules\@deepseek-ai` (240 записей, создана 2026-09-17 19:35; нет `dsh-workflow-ptc`, `dsh-plugin-manager`, `dsh-agent-preset`, `dsh-agent-preset-registry`; 9 битых junction, напр. `dsh-agent-presets`).
- Проверка резолва `node -e` (`createRequire(...).resolve(name)` по каждому включённому ряду четырёх пресетов, exit 0):
  - база `packages\bundle\web-app\package.json` → **unresolved = 0 у всех четырёх** (standard/cordis/ptc/minimal);
  - база `profiles\web\cordis.yml` → `standard` 1 (`@deepseek-ai/dsh-workflow-ptc`), `cordis` 1 (тот же), `ptc` 0, `minimal` 0.
- Эта сессия исполняется на пресете **`cordis`** (иначе не было бы инструментов `cordis_inspect_*` и навыков `cordis-composition-reference`): `@deepseek-ai/dsh-tool-cordis` объявлен только в `presets\cordis.patch.yml` (grep по четырём файлам: True лишь у cordis). У `cordis` есть **включённый** ряд `workflow-ptc` (`presets\cordis.patch.yml:118-121`), нерезолвимый из профиля ⇒ живёт он на базе бандла ⇒ `standard` сегодня монтируется теми же правилами.

## Способ дампа композиции

1. **Живой Host (рекомендуется, не мутирует, 0 квоты):** `cordis_inspect_list` → `cordis_inspect_query{platform:"host", provider:"Config", method:"listConfigs", input:{offset:0,limit:100}}` (страницы по 100; всего 218 записей). Даёт по каждому ряду `id`, `patchId`, `name`, `status` (`tree|schema|inactive|absent`) прямо из живого Loader-дерева (`packages\extensions\tool-cordis\src\config.ts:85,98,102`). Плюс `provider:"Tool", method:"listTools"` — эффективный набор инструментов **вашего** пресета. Ограничение: `config.ts:92` — «runtime-created Agent preset trees are outside the Loader», т.е. пресеты этим дампом **не** видны.
2. **CLI (композиция, не запуск):** `dsh --profile web --dump-config --skip-build` (или `--dump-config-schema`, `--dump-default-config`) — `apps\cli\src\args.ts:170-172`, реализация boot-free и без вычисления `!!js` (`apps\cli\src\dump-config.ts:38-41`). `--skip-build` обязателен: `dsh.cmd` сначала гоняет `dsh-guard.mjs`, который иначе делает `pnpm install`/`pnpm run build` (`C:\Users\Dmitry\.dsh\bin\dsh-guard.mjs:477-501`, флаг гасит это на `:424-427`). Оговорка: `--dump-config` перезаписывает `profiles\web\cordis.yml` константой `PROFILE_ROOT_CONFIG` (`apps\cli\src\profile-boot.ts:171`), байт-в-байт совпадающей с текущим файлом (`:81-85`) — содержимое не меняется, mtime меняется. **Я эту команду не запускал.**
3. **Лог загрузки:** `C:\Users\Dmitry\.dsh\logs\startup-*.log` — диагностика композиции с уже разрешёнными путями (именно так установлена база резолва).

## Пресеты: что работает / что нет

- `cordis` — **работает** (доказано живьём: эта сессия; 24 включённых ряда, 0 unresolved от базы бандла). Набор: persona, agent-instructions, tool-bash/pwsh (платформенный гейт), tool-fs, tool-fs-search, tool-jobs, command-goal, tool-goal, планирование (plan-mode), компакция (compaction-basic, command-compact, tool-result-pruner), делегирование (tool-subagent-control, /list-agents, tool-subagent, -fork, -codex/claude-code disabled, workflow-ptc, tool-workflow, tool-ralph disabled), tool-ask-user, tool-todo, tool-web, **tool-cordis**, skill-filesystem (+skills пресета), tool-skill, present, tool-plugin-manager (гейт `!ctx.get('profileContext')`).
- `standard` — по резолву **работает** (0 unresolved от базы бандла); живого подтверждения нет. 23 ряда: тот же agent-plane без `tool-cordis`, с `skill-filesystem` без `customSkillDirs`; `tool-plugin-manager` `disabled: true`.
- `ptc` — **работает** по резолву (0 unresolved в обеих базах): `workflow-ptc` и `tool-plugin-manager` там `disabled: true` (`presets\ptc.patch.yml:119-120,150-151`).
- `minimal` — **работает** по резолву (6 рядов, 2 включённых: persona + `terminal-bash`/`tool-bash-persistent` под платформенным гейтом; `dsh-terminal`/`-bash`/`-bash-persistent` есть в обеих фермах).
- Сломан **только** `standard` образца 2026-09-16 (прежняя ревизия, 24 ряда) — сегодня невоспроизводимо.

## Опровержения/неожиданное

- Опровергнуто `decision-00-limitation-and-refutations.md:46` («в профиле нет соответствующих пакетов»): из профиля не хватает ровно **двух** пакетов, из базы бандла — **ни одного**; 24-рядный отказ сегодня не воспроизводится.
- Записанный текст ошибки не существует в текущих исходниках ⇒ в тот момент грузилась другая (старая/npm) сборка реестра; и ревизия пресета с тех пор сменилась (`workflow-worker-thread` → `workflow-ptc`).
- `Config.listConfigs` **не** показывает пресеты (`config.ts:92`), поэтому одним вызовом «что реально смонтировано» не получить.
- Устаревшая ферма `C:\Users\Dmitry\.dsh\profiles\node_modules` — ловушка: наивный `require.resolve` от каталога профиля даёт **неверный** ответ (2 ложных «FAIL»), хотя живьём всё резолвится.
- `--dump-config` не является строго читающим: он идемпотентно перезаписывает `cordis.yml`.

## Не проверено

- Ни одна команда `dsh`/`pnpm` не запускалась (риск `pnpm install`/`build` из guard'а) — способ №2 описан, но не выполнен.
- Живой ростер пресетов (`agentPresets.list()/resolve()`, поле `broken`) не прочитан: у Inspect нет read-only метода для бизнес-сервиса; бесплатная проверка — открыть «Настройки → Agent presets».
- Точная историческая причина массового отказа 2026-09-16 (состояние чек-аута/установки на ту дату): логов за 16.09 нет, ближайший startup-лог — 26.09.
- Не выполнялся платный прогон, поэтому «карточка MW-002 теперь проходит» не подтверждено эмпирически.

## Что это значит для плана

1. Этап 0, новый пункт: карточкам MyWork **ставить `mode: cordis`** — это дефолт деплоя (`profiles\web\cordis.patch.yml:66-68`) и единственный пресет с живым доказательством монтирования; `standard` не пинить (отличается лишь отсутствием `tool-cordis`, живого подтверждения нет).
2. `mode` задавать явно на каждой карточке: провал монтирования пресета — это отказ за ~70 мс без хода агента, и он виден только в `error` исполнения карточки.
3. В приёмку этапа 0 добавить бесплатную проверку: Settings → Agent presets показывает `broken` по каждому пресету без запуска сессии; зафиксировать id пресета в отчёте.
4. Инвариант для плагина: не полагаться на `C:\Users\Dmitry\.dsh\profiles\node_modules` (устаревшая ферма) при резолве имён; база — каталог бандла.
