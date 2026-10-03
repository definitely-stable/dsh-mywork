# execution-09 — инструменты, видимые сессии; чем MyWork мог бы проверить поверхность

Только факты, только чтение (read/grep/glob/pwsh + один read-only inspect-запрос). Сборка/тесты/install не запускались.

## 1) Где MyWork перечисляет имена инструментов или проверяет их наличие
- grep `tools|toolSurface|toolNames` по `packages/**/src` (include `*.ts`) → 14 совпадений, ни одного списка имён инструментов: packages/contracts/src/context.ts:774,805,836; packages/contracts/src/scheduler.ts:78,193,219,474; packages/contracts/src/security.ts:31; packages/contracts/src/team.ts:51; packages/core/src/context.ts:440,487,613; packages/core/src/scheduler.ts:283; packages/controller/src/dsh-session.ts:93 (`scopedTools: true`).
- grep `tools|toolSurface|toolNames|agentPreset|preset` по `scripts/**` → 0 совпадений (файлы: scripts/pack.mjs, scripts/smoke.mjs, scripts/verify-profile.mjs, scripts/lib/process.mjs).
- grep `toolSurface|listTools|tool surface` по `.work/**` → 16 совпадений, все прозаические (карточки/отчёты): .work/plan-v0.3/evidence/execution-05.md:9-10, .work/reports/MW-015-dsh-runtime.md:33,105,177 и др. Списка имён инструментов нет.
- Вывод-факт: в MyWork нет ни одной строки, где перечислялись бы имена инструментов или проверялось их наличие.

## 2) packages/contracts/src/context.ts:805 `toolSurface`
- packages/contracts/src/context.ts:805 — `readonly toolSurface: readonly string[]` внутри `ContextSnapshot` (описание :770-782: «Tools the attempt could see (§21.8 `scoped tool provider`)»).
- packages/contracts/src/context.ts:836 — поле входит в закрытый список `CONTEXT_SNAPSHOT_FIELDS`.
- packages/core/src/context.ts:440 — то же поле во входе `ContextMaterializationInput` («Tools the attempt may see (§21.8)»); :487 — валидация `requireStringList(input?.toolSurface, 'toolSurface')`; :613 — перекладка во вход снапшота; producer `materializeContextSnapshot` :478.
- Единственные «писатели» значения — тесты: tests/context.test.mjs:78 (`['read','write']`), :946,954 (`['read','edit']`), :124,433,695 (`[]`); tests/skill.test.mjs:137,739; tests/memory.test.mjs:717,1132.
- «Читателей» вне определения/валидации нет: grep по всему репозиторию даёт 9 совпадений в packages (contracts/core) и 7 в tests.
- Факт-ответ: это поле-описание (audit-артефакт снапшота), а не источник поверхности; значение в него подаёт вызывающий, из живого рантайма DSH его никто не заполняет.
- Косвенно: packages/core/src/index.ts:365 реэкспортирует `materializeContextSnapshot`; вызовов этой функции в packages/tests нет (grep `materializeContextSnapshot` → только определение, тип входа/выхода и реэкспорт).

## 3) Готовый способ получить список инструментов живой сессии от платформы
- grep `adapters|capabilit` по packages/controller/src → 23 совпадения; все о реестре портов и декларациях: packages/controller/src/index.ts:118-119,123,127,212,241-269; packages/controller/src/model-catalog.ts:146,149,164,168; packages/controller/src/dsh-session.ts:653,661-664,688,692,695,699.
- packages/controller/src/dsh-session.ts:85-96 `DSH_AGENT_RUNTIME_CAPABILITIES` (`scopedTools: true` :93), :107-112 `DSH_SESSION_CAPABILITIES` (create/events/cancel/processRestart).
- packages/controller/src/dsh-session.ts:17-23 (комментарий-факт): per-session tool allow-list в API DSH не найден, поэтому scope выражается `agentPreset`; методы, читающего инструменты сессии, в модуле нет.
- Итог: в MyWork готового способа нет. В DSH-checkout (только чтение) read-only способ есть: пакет `packages/extensions/tool-cordis/src/providers.ts:66-78` — Inspect Provider `Tool`, метод `listTools`, реализация `ctx.tools.schemas(context.agent)`.
- Проверено вызовом этого метода для текущей сессии: вернулись схемы инструментов; command `Select-String -SimpleMatch '"name": "'` по полному ответу → 52 строки имени, из них 34 на уровне записи инструмента (остальные — вложенные `tags`). Верхний уровень включает read, write, edit, glob, grep, pwsh, present, skill, subagent, subagent_fork, workflow, spawn_teammate, wait_agent, send_message, list_agents, interrupt_agent, team_task_*, task_board_*, job_*, read_image, exit_plan_mode, create_goal/get_goal/update_goal, ask_user_question, cordis_inspect_list/query, plugin_manager, ssh_*, list_mcp_resources/list_mcp_resource_templates/read_mcp_resource.

## 4) scripts/verify-profile.mjs — что проверяет (241 строка)
- :170-171 п.1 — `packController` упаковал тарболл.
- :176-179 п.2 — создан изолированный профиль `mywork-verify` из `--from-default-profile sdk-minimal` (DSH_HOME = `.tmp/verify-profile/home`, :48-51), манифест профиля существует.
- :182-184 п.3 — `dsh plugin --profile … add <tarball>` вернул код 0.
- :187-191 п.4 — манифест профиля зависит от `@dsh-mywork/controller` и содержит его в `dsh.profile.bundles`.
- :195-213 п.5-6 — оверлей `cordis.patch.yml` с `diagnostics: true`; `--dump-config` (код 0) содержит слой бандла, строку `id: mywork-controller`, `name: '@dsh-mywork/controller'` и доехавший `diagnostics: true`.
- :217-225 п.7 — загрузка профиля (код 0) печатает `dsh-mywork: controller mounted` (:30) и `dsh-mywork: controller stopped` (:31).
- :227-232 п.8 — хеши ~/.dsh/profiles/web/package.json, cordis.patch.yml, settings.yaml не изменились.
- :234-241 — `--keep` сохраняет, иначе удаляет рабочую директорию; финальная строка `verify:profile: PASS`.
- Инструменты/пресеты скрипт не проверяет (grep по scripts → 0 совпадений).

## 5) Тесты состава инструментов/пресетов
- grep `preset|agentPreset` по tests/** → 23 совпадения, только tests/runtime.test.mjs:45,60,113,137-147,156-180,412,436,453,461,603 и tests/lib/fixtures.mjs:196; все — про `agentPreset` в запросах `session/create`, конфликт пресета и `/permission preset`.
- tests/context.test.mjs:926,946,954 — `toolSurface` только как вход/выход снапшота (`['read','edit']`), без проверки живого состава.
- Итог: теста, проверяющего реальный состав инструментов или состав пресета, в репозитории нет.

не проверено:
- projects/иные каталоги, кроме packages/**, scripts/**, tests/**, .work/** (например, docs, конфиги профилей вне этой машины).
- Содержимое `packages/**/src` вне совпадений grep: наличие проверки инструментов под другими именами (например, `allow`/`deny`-списки) не искалось.
- Кто и где в DSH фактически формирует `scopedTools` для пресета (внутренности DSH не читались, кроме providers.ts:66-78 и списка пакетов).
- Поведение `verify-profile.mjs` при запуске (не исполнялся: запрет на сборку/install) и реальный exit code.
- Полный список 34 имён инструментов (в отчёте приведена выборка; полный ответ сохранён харнессом в spill-файле вне репозитория).
- Значения `toolSurface` в проде: прод-вызовов `materializeContextSnapshot` не найдено, но поиск ограничен этим репозиторием.
