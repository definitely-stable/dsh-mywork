# decision-00 — ограничение сбора доказательств и ключевые опровержения

## Ограничение: субагенты недоступны с этого уровня

Задание требовало минимум 4–6 субагентов. С уровня teammate'а инструмент `subagent` недоступен:

```
subagent(...) → Error: subagent depth 2 exceeds maxDepth 1   (4 попытки, все отклонены)
```

Вызовы запускались батчем из четырёх независимых вопросов (D01 транспорт, D02 зоны, D04 peer-гейт, D05 бюджет) — все четыре отклонены с одинаковой ошибкой. Поэтому **все доказательства собраны лично `decision-desk`** через `read`/`grep`/`pwsh` и два инструмента платформы: `cordis_inspect_query host/Service` (живой каталог Host-сервисов, 81 ключ) и `node` -скрипт в `.tmp/plan-v03-decision/`.

Следствие: файл `10-DECISIONS.md` собран одним агентом, и независимая проверка якорей (её делает `verifier-a` по плану) здесь особенно нужна. Lead уведомлён отдельным сообщением.

## Что это дало взамен

Каталог Host-сервисов — источник, который не доступен через grep по чек-ауту (там только `lib/types/*.d.ts`, `src` не публикуется): `docs\user\develop\basic\publish.md` — «`./src/*` объявлен, `src` в `files` нет». Именно из него получены точные сигнатуры `webServer`, `typertGateway`, `workflowEngine`, `jobs`, `skills`, `systemPrompt`, `tools`, `tokenMeter`, `productTelemetry`, `agentTeams`, `userQuestions`, `approval`, `storageDomain`, `sandboxPolicy`, `invariants`.

## Ключевые опровержения (полный список — §2 `10-DECISIONS.md`)

| № | Что считалось верным | Что измерено |
|---|---|---|
| О-1 | «9 падений на `done`» (`FINAL-REPORT §7.4`, P9) | Падений на `done`-карточках — **7**; ещё 2 — на `backlog`-карточке MW-002. Ни одно из 11 падений не является вердиктом о работе: 7 × `workspace not found: 3fc33afb…`, 2 × `agent-presets: preset "standard" failed to mount: 24 rows…`, 2 × `agent turn ended with an error` |
| О-2 | «четыре источника статуса» — верно, числа не названы | `ledger-v2.json` (rev. 324): 55 карточек, `failed 2 / backlog 34 / done 19`, 31 исполнение; `tasks.json`: 55 карточек, `planned 53 / superseded 2`, **0 исполнений**; `board-export.json`: 41 карточка, **все `backlog`**, 0 исполнений |
| О-3 | `MW-042.md:21`: «**AutonomyLevel** … объявлены в контрактах» | `grep -rn "AutonomyLevel\|AUTONOMY_LEVELS\|autonomy"` по репозиторию → **нет совпадений**. Остальные пять имён объявлены |
| О-4 | `MW-054.md:18`: «6 done в `47b14762`, 35 незавершённых в `3fc33afb`» | `47b14762`: **19** done; `3fc33afb`: **3** карточки |
| О-5 | `00-RECON.md:158`: `MemoryProvider`/`SkillProvider` — платформенные швы | Шов есть для навыков (`ctx.skills`); сервиса памяти в DSH **нет** (в 81 ключе каталога нет `memory`); `MemoryProviderPort` — собственный тип MyWork |
| О-6 | `MW-048.md:21`: «в бандле нет hex-литералов», «build-gate отклоняет value-импорт» | У прецедента стили — CSS-модули (`board.module.css`, 1032+ строк); build-gate в `src/client` не найден |
| О-7 | Аутентификация HTTP наследуется от `ctx.webServer` (план v0.2 §5.6) | `WebServer` **не содержит** ни auth-хука, ни middleware между `register` и handler (`packages\host\webserver\src\index.ts:319-360`); 0.4.3 пишет свой забор (`P\src\host-routes.ts:150-160`) |

## Находка вне задач решений (для Lead'а)

Пресет `standard` называет **24 строки**, которые не резолвятся в живом профиле. Полный список — в тексте ошибки исполнения MW-002 (два падения):

```
agent-presets: preset "standard" failed to mount: 24 rows name plugins that cannot be resolved:
- persona: @deepseek-ai/dsh-persona            - tool-fs: @deepseek-ai/dsh-tool-fs
- agent-instructions: @deepseek-ai/dsh-agent-instructions   - tool-fs-search: …
- tool-jobs: @deepseek-ai/dsh-tool-jobs        - skill-filesystem: @deepseek-ai/dsh-skill-filesystem
- tool-skill: … - command-goal: … - tool-goal: … - plan-mode: … - compaction-basic: …
- command-compact: … - tool-result-pruner: … - tool-subagent-control: … - tool-subagent: …
- tool-subagent-fork: … - workflow-worker-thread: … - tool-workflow: … - tool-ralph: …
- tool-ask-user: … - tool-todo: … - tool-web: … - present: @deepseek-ai/dsh-tool-present
```

Это отдельный дефект окружения: он не про MyWork, но он дважды сорвал исполнение и, вероятно, связан с тем, что в профиле нет соответствующих пакетов.

## Скрипты, которыми получены числа

- `.tmp/plan-v03-decision/count-done-failed.mjs` — ценз трёх леджеров (статусы, исполнения, `done`+`failed`), exit 0.
- Однострочные `node -e` по `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` — разбивка по воркспейсам, таблица причин `error`, карточки MW-001/MW-016.
