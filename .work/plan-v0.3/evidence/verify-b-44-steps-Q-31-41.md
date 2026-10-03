# verify-b-44 · Q-31 и Q-41 (`23-STEPS-quality.md`) + гейт MW-074 / правка C-32 (`30-CARD-EDITS.md`)

**Режим:** falsify (задача — опровергнуть). Только чтение; записан лишь этот файл. `pnpm`/`node --test` не запускались.
**Базлайн (SHA256 / строк):** `23-STEPS-quality.md` = `EB802DB3B0F8D899B715D007DC24C28C092586F9540B9F3FBB06FC8229EAB462` / 871 (совпал до и после работы);
`30-CARD-EDITS.md` = `ADB75A79…F63C0` / 1476 → **переписан во время проверки** → `726196CF1877A4B25E2D9AE908DA2B126B2298EBC3B38BF879E5CE9B1BE946D9` / 1497 (якоря C-32/MW-074 перепроверены на новой ревизии: `:450`, `:1119`, `:1113`, `:1216`);
`10-DECISIONS.md` = `0E2B860A…C5B8` / 1890 → **переписан** → `9E72F4A3D9933163424063039C4ED2D1585A61B858BDEF08340AAA6EB0B5A8A3` / 1893.
Репозиторий: `git status --short` = 0 строк, HEAD `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`.

## 1. Гейт карточки MW-074 и правка C-32 (главное задание)

- **Файла нет (НЕ_СУЩЕСТВУЕТ).** `H:\Repo\DSH-MyWork\scripts\` = `pack.mjs`, `smoke.mjs`, `verify-profile.mjs`, `lib\`; `glob`-поиск `verify-package-invariants*` по репозиторию → 0 совпадений; `.ts`-файлов под `scripts\`/`tests\` → 0. Команда `npx tsx scripts/verify-package-invariants.ts` в целевом репозитории падает на отсутствии модуля при любом исходе проверки.
- **`tsx` нет ни в devDependencies, ни в дереве.** `package.json:21-26` (devDeps: `@deepseek-ai/cordis`, `@types/node`, `tsdown`, `typescript`); `"tsx"` отсутствует во **всех 54** `package.json` вне `node_modules`; `node_modules\.bin\` = только `cordis`, `tsc`, `tsdown`, `tsserver`. Значит исполнение опирается на сетевую докачку `npx` (в CI это скрытая зависимость).
- **Скрипт существует ровно в другом месте и сканирует другой корень.** DSH-чек-аут `C:\Reposit\deepseek-harness\deepseek-harness\scripts\verify-package-invariants.ts` — 21 строка, SHA256 `6F3EFB525FFA1BDA80E62D574E54C5A4E85CA20F418122B3AD9F7FC679C26DBC`; `:10` `const root = resolve(import.meta.dirname, '..')` — корень **DSH**, не MyWork. `tsx` есть в platform-root (`node_modules\.bin\tsx.cmd`), т.е. команда исполниму в чужом дереве и проверяет companion'ы DSH.
- **Что говорит сам план — противоречиво, и это фиксируется как внутренний конфликт.** `23-…:628` и `:787` называют гейт «платформенный…, **если применим**»; `30-CARD-EDITS.md:450` (C-32) и `:1119` (MW-074, приёмка 1) требуют его **безусловно**, а строка сводки `:1216` объявляет его гейтом-критерием. `01-MASTER-PLAN.md:390` требует «гейт прогоняется **буквально той командой, что написана**» — то есть латентный конфликт не гасится формулировкой «если применим». Ни в одной из трёх карточек (MW-039 стр. 17, MW-074 объём) нет действия «создать/портировать скрипт».
- **Владение разделено между двумя карточками:** `:450` (C-32 → MW-039) и `:1119` (MW-074) — один и тот же гейт, назначения владельца нет.

## 2. Q-31 · Doctor: сверка mtime/хэшей профиля (`23-…:563-578`)

- **(а) Верно:** `scripts/verify-profile.mjs:127-134` — `realProfileFingerprint()` по 3 путям, `hashFile` `:120`; `packages/storage/src/layout.ts:66-68` — `defaultDshHome()` = `~/.dsh`. **Неверно:** `packages/controller/src/doctor.ts` и `tests/doctor-profile.test.mjs` не существуют (`packages/controller/src` = `dsh-session.ts`, `index.ts`, `model-catalog.ts`; в `tests\` 28 файлов, ни одного `doctor*`), т.е. «Create» оправдан, но шаг уже описан в `Q-33` как «Modify» того же файла — порядок создания не назначен. Шаг 0 обещан в `:567` («решить в шаге 0»), а шагов 0 в Q-31 нет (перечень 1–6).
- **(б) Команды исполнимы:** `node --test tests/doctor-profile.test.mjs` — файла нет (падает «нет модуля»), `node scripts/verify-profile.mjs` существует и печатает `: PASS`.
- **(в) Счёты согласованы:** 3 описанных теста (`:569-572`) ↔ `pass 3 / fail 0` (`:574`); в Q-41 так же 3↔3.
- **(г) Гейт не доказывает заявленное:** `verify-profile.mjs:138` печатает `home: ${home} (isolated; the user profile is not used)` — скрипт работает в изолированном `DSH_HOME`, поэтому «3 хэша реального профиля не изменились» (`:575`) не является следствием прогона гейта; в самом шаге базы сравнения нет («между двумя прогонами», `:569`).
- **(д) Дублей нет:** Doctor владеют только `Q-31`…`Q-33`.

## 3. Q-41 · Recovery гейтов и снапшотов (`23-…:694-707`)

- **(а) Факты верны частично.** Точно: `packages\execution\src\service.ts:115` — объявление `recover(...)`, `:878` — реализация (файл 1238 стр.); `planner\src\service.ts:436` — докблок `enterRecovery`; `beads-adapter\src\reconcile.ts:6` — «the crash-recovery cases §9 and §49». **Неверно:** `Modify packages/core/src/human-decision.ts` — файла нет (`packages/core/src` = 23 файла, `human-decision.ts` отсутствует); `expireHumanDecisions` — 0 совпадений в репозитории, при этом `23-…:293` (Q-11) перечисляет точный набор «функций ровно пять (`open`, `answer`, `expire`, `pending`, `humanDecisionOfTask`)» и требует `Create packages/core/src/human-decision.ts` (`:286`). Значит Q-41 предполагает **существующий** модуль, который создаёт другой шаг, и называет функцию не из его контракта.
- **(б) Команда исполниму как написана** (путь теста корректен, запрещённого `pnpm` нет); изоляция не указана — см. §4.
- **(в) 3↔3 согласовано** (`:701-704` ↔ `:705`).
- **(г) Противоречие с фактом о снапшотах:** шаг 3 требует `verifyContextSnapshot → missing`, но `packages\core\src\context.ts:670` возвращает `ContextVerification` только вида `intact|drifted` (`core\lib\index.d.ts:5584`); тип `missing` ни один файл шага не вводит.
- **(д) Дублей файлов нет:** F-45/E-46 закрывают reconcile §49 (`21-…:168`), Q-41 не дублирует его конструкции.

## 4. Общая инварианта, задевающая оба шага

Все 88 команд `node --test` в `23-…` идут **без** `--test-isolation=none` (единственное упоминание — сводная строка `:785`), тогда как в `21-STEPS-execution.md` таких 127 из 128, в `22-STEPS-surface.md` — 153 из 156, и именно эта форма объявлена каноном (`22-…:18`, `21-…:91-92`). В §10 `23-…` постулируется «команда + ожидаемый вывод», но неверная форма команды делает гейт зависимым от изоляции тест-раннера.

## 5. Итог

ПОДТВЕРЖДЕНО: факты-якоря Q-31 (`verify-profile.mjs:127-134`, `layout.ts:66-68`) и Q-41 (`service.ts:115,878`, `planner:436`, `reconcile.ts:6`), числа тестов 3↔3 в обоих шагах, отсутствие дублей шагов. ЧАСТИЧНО: Q-31 (Create-файлы и гейт), Q-41 (Modify-цель). НЕВЕРНАЯ_СТРОКА: `23-…:450/1119` в связке с `01-MASTER-PLAN.md:390`. НЕ_СУЩЕСТВУЕТ: `scripts/verify-package-invariants.ts`, `tsx`, `core/src/human-decision.ts`, `expireHumanDecisions`, тип `missing`. Не запускалось: `npx tsx` (нет зависимостей и запрет на прогоны), `node --test` (запрещено заданием).
