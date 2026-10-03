# 12 манифестов MyWork — evidence (read-only, H:\Repo\DSH-MyWork)

## ПОДТВЕРЖДЕНО
- Команда 1 (Get-ChildItem packages -Directory | ConvertFrom-Json) → exit 0, ровно 12 строк, у всех 12 есть package.json:
1 adapter-sdk: @dsh-mywork/adapter-sdk private=True files=lib peer=— dsh=—
2 beads-adapter: @dsh-mywork/beads-adapter private=True files=lib peer=— dsh=—
3 contracts: @dsh-mywork/contracts private=True files=lib peer=— dsh=—
4 controller: @dsh-mywork/controller private=True files=lib,cordis.patch.yml peer={"@deepseek-ai/cordis":"^4.0.2"} dsh={"bundle":{"patch":"./cordis.patch.yml"}}
5 core: @dsh-mywork/core private=True files=lib peer=— dsh=—
6 evidence: @dsh-mywork/evidence private=True files=lib peer=— dsh=—
7 execution: @dsh-mywork/execution private=True files=lib peer=— dsh=—
8 lease: @dsh-mywork/lease private=True files=lib peer=— dsh=—
9 memory-native: @dsh-mywork/memory-native private=True files=lib peer=— dsh=—
10 planner: @dsh-mywork/planner private=True files=lib peer=— dsh=—
11 scheduler: @dsh-mywork/scheduler private=True files=lib peer=— dsh=—
12 storage: @dsh-mywork/storage private=True files=lib peer=— dsh=—
- contracts/package.json:4 private=true, :17-19 files=["lib"] (та же форма у 11); controller/package.json:17-20 files=["lib","cordis.patch.yml"], :21-25 dsh.bundle.patch=./cordis.patch.yml, :30-32 peer cordis ^4.0.2.
- Проверка полей по всем 12: dsh=True и peer=True только у controller, у остальных 11 оба False.
- Команда 2 → exit 0 (security.ts, skip 190 first 40 = строки 191-230; всего в файле 303 строки).
- packages/contracts/src/security.ts:201-206 REVIEWER_DEFAULT_PERMISSIONS = ['workspace.read','git.read','tests','review.approve'].
- packages/contracts/src/security.ts:212-216 IMPLEMENTATION_WRITE_PERMISSIONS = ['workspace.write','git.write','shell'].
- packages/contracts/src/security.ts:193 DOMAIN_IMPLIED_GATES = {production:'production-access'}; :219-227 AUTHORIZATION_CONTEXT_FIELDS, последнее поле 'workerAgentId'.
- Команда 3 → exit 0: Test-Path …\packages\ui = False; Test-Path …\packages\web = False.
- Команда 4 → exit 0: allowlist = 0 совпадений; restrict = 11; worker = 346 (регистронезависимо).
- worker-поверхности нет: файлов/каталогов с именем *worker*|*allowlist*|*restrict* под packages — 0 совпадений.

## ОПРОВЕРГНУТО / УТОЧНЕНО
- Уточнено: 346 совпадений «worker» — 224 из них внутри MyWorkError (регистронезависимый матч «WorkError» → «worker»); реальных worker-токенов (case-sensitive \bworker\b) 68, и это домен worker-агент/attempt/pool.
- Уточнено: «12 манифестов» верно только для каталогов пакетов; всего package.json под packages — 26, лишние 14 лежат в node_modules (фикстуры @dsh-mywork/.ignored_*), не манифесты пакетов.
- Уточнено: 11 совпадений restrict — фильтры выдачи/скана, не ограничения прав (contracts/src/context.ts:308, contracts/src/memory.ts:983, contracts/src/taskgraph.ts:111, storage/src/outbox.ts:91).
- Уточнено: независимость ревьюера реализована не как worker-поверхность — core/src/review.ts:132 отказ 'a reviewer must not hold workspace.write'; contracts/src/security.ts:264 workerAgentId — поле контекста.
- packages/ui и packages/web отсутствуют: 12 манифестов — это contract/core/service-пакеты плюс контроллер, UI/Web-пакета в MyWork нет.

## НЕ ПРОВЕРЕНО
- Полный вывод команды 4 целиком в отчёт не вынесен (346 строк, >100 строк шума MyWorkError) — приведены счётчики и якоря.
- Код за пределами прочитанных строк не читался; поведение (build/test/typecheck) не запускалось по условиям READ-ONLY.
- packages/*/package.json, кроме contracts и controller, прочитаны только через ConvertFrom-Json (поля), без построчного чтения.
- Живой профиль C:\Users\Dmitry\.dsh\profiles\web и DSH-checkout 0.1.7-rc.2 не проверялись — вне вопроса.

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-18-manifests.md
