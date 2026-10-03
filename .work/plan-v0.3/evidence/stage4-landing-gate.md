# Этап 4 — финальный гейт приземления (Lead)

- **Дата:** 2026-09-28 11:38:52 → 11:49:44 +05:00
- **Ветка:** `stage4-execution-pipeline`, **вершина до коммитов:** `33e6919db031fb79b9c34c0ada67d4c600b0405d` (локальный `main`; `origin/main` = `0c657ae`, то есть этапы 0–3 ранее не пушились)
- **Состояние дерева:** 68 изменённых/новых путей, отпечаток `153F5CAD8C0CA56EF50D3EE0AE3A771549C0895BBEA513834C64A4E086FD6151` (321 неигнорируемый файл) **до и после гейта совпал** — гейт шёл на замороженном срезе, писателей в окне не было
- **Бэкап до начала работ:** `C:\DSH-Backups\dsh-mywork-2026-09-28\` (1931 файл, 185,5 МБ, включая `.git`) + `dsh-mywork-2026-09-28.tar.gz` (108 МБ) + `MANIFEST-sha256.txt` (1701 файл)

## Команды и наблюдения

| # | Команда | Exit | Наблюдение |
|---|---|---|---|
| 1 | `corepack pnpm install --frozen-lockfile --offline` | **0** | «all 16 workspace projects», lockfile up to date |
| 2 | `corepack pnpm -r run typecheck` | **0** | 16 проектов `typecheck: Done` (18,5 с) |
| 3 | `corepack pnpm -r run build` | **0** | все пакеты `build: Done`, без OOM (190,9 с; heap — `nodeOptions` в `pnpm-workspace.yaml`) |
| 4 | `node scripts/smoke.mjs` | **0** | «smoke: all steps passed» |
| 5 | `node --test --test-isolation=none "tests/**/*.test.mjs"` | **0** | **tests 1010 / pass 1010 / fail 0 / cancelled 0 / skipped 0** (423,9 с) |
| 6 | `node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js` | **0** | `verify:profile: PASS`: контроллер смонтирован и активирован в изолированном доме, профиль пользователя не тронут (3 отпечатка) |
| 7 | `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` | — | **False** до и после гейта |

Полные логи шагов: `.tmp/lead/gate-<step>.log`, сводка — `.tmp/lead/gate-summary.txt`.

## Что вошло в срез (группы A–E, L этапа 4)

| Группа | Карточка | Что сделано |
|---|---|---|
| A. Изоляция worktree | MW-021 | `packages/worktree-adapter` — единственное место, где исполнение запускает git; отчёт `MW-021-worktree.md` |
| B. Worker | MW-022 | `packages/execution/src/worker.ts` — admission → claim → worktree → snapshot → session → settle; отчёт `MW-022-worker.md` |
| C. Verification gates | MW-023 | `packages/gate-runner` + адмиссия в `execution/src/gates-admission.ts`, производитель `gate-result` в воркере, мост `createAttemptGatePort`; отчёты `MW-023-gates.md`, `MW-023-gates-e17.md`, `MW-023-gates-port.md`, `MW-023-gates-producer.md` |
| D. Review | MW-024 | `execution/src/review-queue.ts` + `review-schema.ts`; отчёт `MW-024-review.md` |
| E. Интегратор | MW-025 | `execution/src/integrator.ts` + `integration-schema.ts`; отчёт `MW-025-integrator.md` |
| L. Контроллер | MW-028 | `controller/src/{runtime-root,app,heartbeat,deployment,errors}.ts`; отчёт `MW-028-controller-modes.md` |

Правки Lead'а в срезе: `packages/contracts/src/verification.ts` (`AttemptGatePort`, `AttemptGateRequest`, `ATTEMPT_GATE_REQUEST_FIELDS`), `packages/execution/src/service.ts` (трансляция `no-head` → `EMPTY_REPOSITORY` в саге), `tests/events.test.mjs` (пин словаря: `STALE_APPROVAL`), `README.md`.

## Что этот гейт НЕ доказывает

1. **Композиция не построена.** Воркер, гейты и порты интегратора не смонтированы в приложение: гейт доказывает, что модули собираются и их контракты выполняются на стендах, а не что конвейер запускается в живом профиле.
2. **CI на GitHub никогда не исполнялся** — этот PR будет его первым запуском; локальные эквиваленты пройдены.
3. **Приёмка карточек не объявлена:** все отчёты в статусе READY_FOR_REVIEW, независимое ревью дельты — отдельный артефакт.
4. Открытые остатки: строгое чтение набора гейтов (информационный гейт блокирует наравне с обязательным), `AttemptGatePort.run` без `signal`, `attempt_worktree.head_sha` пишется только в тестах, `stop()` без дедлайна, B1/F-5/R-26 из этапа 3.

## Независимое ревью и пост-фикс прогоны (продолжение)

| Событие | Вердикт | Ключевое доказательство |
|---|---|---|
| Независимое ревью дельты (`579e819`) | **PASS WITH FINDINGS** — 0 BLOCKER / 0 MAJOR / 3 MINOR / 1 NIT | 34 набора, 231 pass / 0 fail; 4 mutation-check с побайтовым восстановлением; `EMPTY_REPOSITORY` доказан в продакшн-пути пробой (реальный `git init` → реальный порт → реальная сага). Отчёт: `.work/reports/stage4-delta-review.md` |
| Правки F1–F3 (`0e53266`) | **FIXES VERIFIED** | F2 — поведением: отказ `STALE_APPROVAL` возвращается как `Result` на обоих защищённых вызовах, контроль `ENTITY_CYCLE` по-прежнему вылетает; мутация → `pass 1 / fail 2`. F3 — шесть состояний замка. Отчёт: `.work/reports/stage4-delta-verification.md` |
| Новая находка F5 (замок: возраст недостижим для именованного замка) | исправлено в `4bfda86` | Пробы Lead'а, пять состояний: мёртвый pid — 0.10 с; живой pid с mtime −31 мин — 0.13 с; замок без pid старше потолка — 0.11 с; свежий замок с живым владельцем не воруется (ожидающий вышел 3 через 180 с); свободное имя берётся без остатка файла |
| Полный набор после правок | exit 0 | `tests 1010 / pass 1010 / fail 0 / cancelled 0 / skipped 0` |

**Флак, который надо знать.** Один прогон батча (`integrator-*`, `review-*`, `gates-admission`, `worker-flow`, `boundaries`) сразу после пересборки дал `tests 102 / pass 101 / fail 1`; имя упавшего кейса не сохранилось. Семь последующих прогонов того же батча (четыре Lead'а, три ревьюера) — `102/102 fail 0`. Гипотеза «читатель поймал недописанный бандл» опровергнута инъекцией (обрезка бандла даёт `tests 1 / fail 1`, счётчик упал бы до ~72, а не остался 102). Кандидаты: единственное утверждение на реальном времени (`tests/worker-flow.test.mjs:586`, дедлайн 2 с) и транзиентный отказ реального `git` в `integrator-*`.

