# lead-18 — Чистка рабочей папки на этапе 0: что удалять и что опасно
База: `MW` = `H:\Repo\DSH-MyWork` @ `0c657ae` (2026-09-22T00:56+05:00), `git status --porcelain` пуст. Снимок 2026-09-27; `.tmp` пишется кампанией plan-v0.3 прямо сейчас (за время инвентаризации `.tmp/plan-v03-verify-a` 0→4 файла, `.tmp/plan-v03-lead` 4→18) ⇒ числа перепроверяются перед удалением.

## Факты
1. Объём: `Get-ChildItem . -Recurse -File -Force | Measure-Object -Sum Length` → **472.2 MB / 8028 файлов**; доли: `.tmp` 178.2 MB/3968 (повторный замер — 179.3/3983), `node_modules` 109.7/1935, `.pnpm-store` 72.3/911, `.git` 42.0/359, `DSH-MyWork.rar` 41.4 MB, `packages` 17.7/533, `.work` 5.3/172, `.beads` 2.8/21, `.analysis` 0.5/33, `.dsh` 0.2/28, `tests` 0.8/32.
2. `git worktree list` (exit 0): `MW` 0c657ae [main]; `.tmp/f-audit` 0c657ae (detached); `.tmp/mw012-review` f22dbc3 (detached); `.tmp/v2-boundary-demo` 0c657ae (detached). `.git/worktrees/` = ровно эти три ⇒ висячих регистраций нет. Ветка одна (`git branch -vv` → `* main`); `git merge-base --is-ancestor f22dbc3 HEAD` exit 0, `git branch -a --contains f22dbc3` → main + origin/main ⇒ коммит worktree уже в истории.
3. Все три worktree грязные (`git -C … status --porcelain`): f-audit — 6 записей (`M packages/beads-adapter/src/runner.ts`, `M pnpm-lock.yaml`, `M tests/beads-adapter.test.mjs`, `?? .tmp-audit/`, `?? *.orig`); mw012-review — 30 (`M packages/beads-adapter/src/{adapter,plan,reconcile}.ts`, `M packages/contracts/src/{artifact,audit,events,index,task}.ts`, …); v2-boundary-demo — 2 (`M packages/core/src/scheduler.ts`, `M packages/scheduler/src/service.ts`).
4. Junction-ловушка: 543 reparse-точки в `.tmp`, из них **21 ведут за пределы `.tmp`, в живое дерево**: `v2-boundary-demo/node_modules → MW\node_modules`; 12× `v2-boundary-demo/packages/*/lib → MW\packages\*\lib`; `mw014-review/live/{packages/{contracts,core,scheduler},tests/lib} → MW\...`; `mw012-mine/execution/node_modules/@dsh-mywork/{contracts,core,evidence,storage} → MW\packages\*`.
5. Мёртвое и воспроизводимое: `.tmp/{beads-probe,pnpm-temp,test-tmp}` — 0 записей; `.tmp/{mw004-verify,mw010-head-verify}` — 0 реальных файлов, 195/216 каталогов, все junction битые (`Test-Path <target>` = False); `f-audit/node_modules` 52.8 MB/931 + `mw012-review/node_modules` 52.8 MB/934 (pnpm-деревья, `pnpm-lock.yaml` рядом) ⇒ 105.6 MB; `pack/dsh-mywork-controller-0.1.0.tgz` 9 KB (`pnpm pack`).
6. `.rar` (NanaZip 7.0, `7z l` exit 0): Rar5, 43 410 533 B → **212 800 430 B, 4592 файла / 1351 папка**, 2026-09-18 02:00:39; верхний уровень `.tmp` 4929, `packages` 442, `.git` 395, `.work` 62, `.dsh` 59, `.analysis` 23, `tests` 18, `scripts` 6, 15 корневых файлов; **`.beads`, `.pnpm-store` и корневой `node_modules` отсутствуют**.
7. Сверка rar ↔ live по путям: rar-only 5199 (`.tmp` 4633, `packages` 301, `.git` 248, `.dsh` 17); после вычета сборок rar-only в `packages` = **0**, в `.work` = **0**; в `.tmp` без сборок = `.tmp/mw008-verify/**` (4608 записей) + `msg-{1..4}-*.txt` (77–652 B); `.dsh` rar-only = `plan-briefing`, `work-card-authoring` — оба живы в `.analysis/retired/`.
8. `.dsh/skills` (context-economy, evidence-gated-delivery, isolation-and-deletion-safety, session-skill-forge) — вне git (`.gitignore:4`) и **в профиле `C:\Users\Dmitry\.dsh\skills` их нет** ⇒ единственная копия; `.beads` игнорируется `.git/info/exclude:9`; секретов не найдено (17 совпадений `sk-|ghp_|AKIA|PRIVATE KEY` — все тест-фикстуры `evidence.test.mjs`/`security.test.mjs`), `.env`-файлов нет. `.work/**` ссылается на 116 разных `.tmp/<имя>`, из них **41 уже отсутствует** (`mw011-sixth-*.txt`, `plan-v03-surface`, `mw020-review`, …); в `.rar` из них есть только `mw008-verify`.

## Таблица классификации

| путь | размер | файлов | назначение (доказательство) | класс |
|---|---|---|---|---|
| `.tmp/f-audit/node_modules`, `.tmp/mw012-review/node_modules` | 105.6 MB | 1865 | pnpm-деревья worktree; откат — `pnpm install --frozen-lockfile` по `pnpm-lock.yaml` рядом | **безопасно** |
| `.tmp/mw004-verify`, `.tmp/mw010-head-verify` | 0 B | 0 реальных | 195/216 каталогов, все junction битые (п. 5) | **безопасно** |
| `.tmp/{beads-probe,pnpm-temp,test-tmp}`, `.tmp/pack`, `.tmp/pack-logs` | ~9 KB | 3 | пустые каталоги; вывод `pnpm pack` (регенерируется) | **безопасно** |
| `.tmp/f-audit` (без node_modules) | 14.2 MB | 289 | worktree @0c657ae, 6 грязных записей = несохранённый фикс `beads-adapter` (п. 3) | требует решения |
| `.tmp/mw012-review` (без node_modules) | 10.5 MB | 432 | worktree @f22dbc3 (в истории), 30 грязных файлов — состояние ревью-мутаций | требует решения |
| `.tmp/v2-boundary-demo` | 2.4 MB | 192 | worktree @0c657ae, 2 грязных файла + 13 junction в живое дерево (п. 4) | требует решения (только `git worktree remove`) |
| `.tmp/mw018-review` | 20.4 MB | 150 | `mut/`+`vfix/` копии `lib` (9.9+9.5 MB), `pristine/`, `MW-018-*.md` | требует решения |
| `.tmp/mw012-full-backup` | 11.1 MB | 515 | копия `packages`+`tests`+lock без `.git` (снимок 17→19.09) | требует решения |
| `.tmp/mw018-mut`, `.tmp/mw012-mutation-backup`, `.tmp/mw011-{adv5,d4}-snap`, `.tmp/{d3,delta,vfix}-backup`, `.tmp/mw018-fix` | 5.1 MB | 43 | снимки файлов до мутаций; в git — текущие версии, снимок = копия старой ревизии | требует решения |
| `.tmp/*.bak`, `*.backup{,2}` (`errors.ts`, `svc`, `mg-core`, `mg-planner`, `mw020-session.ts`, `index.js`) | 0.6 MB | 8 | до-мутационные копии файлов | требует решения |
| `.tmp/*.log/*.txt/*.mjs/*.ps1` (прогоны и пробы MW-005…MW-020) | ~5 MB | ~300 | доказательства закрытых карточек; часть ссылок уже висит (п. 8) | требует решения |
| `.tmp/mw008-review/db/**`, `.tmp/mw008-vfix/db/**` | ~1 MB | 22 sqlite | синтетические реестры прогона 2026-09-18 01:5x, не данные продукта | требует решения |
| `.tmp/plan-v03-*` (cards/decision/foundation/lead/verify-a/verify-b) | ~0.9 MB | 33 | активная кампания v0.3, пишется сейчас | **не трогать** |
| `DSH-MyWork.rar` | 41.4 MB | 1 | снапшот workspace 2026-09-18 02:00 (212.8 MB / 4592 файла) | требует решения (сначала вынуть уникальное — П5) |
| `.work`, `.analysis`, `.dsh`, `.beads`, `.git` | 50.8 MB | 613 | отчёты; retired-скиллы; 4 скилла вне git (п. 8); dolt-данные доски; история + 9 refs | **не трогать** |
| `node_modules`, `.pnpm-store` (корень) | 182.0 MB | 2846 | воспроизводимо из `pnpm-lock.yaml`, но **не в `.rar`** ⇒ удаление = полная переустановка | требует решения (вне этапа 0) |
| `packages/`, `tests/`, `scripts/`, root config | 18.5 MB | 569 | tracked, `git status` пуст | не трогать (чистить нечего) |

## Единственные экземпляры
- `.tmp/mw008-verify/**` — есть только в `.rar` (4608 записей). Коммит `fbee7a0` жив (`git cat-file -t` → commit, ancestor exit 0), но по `MW-008-evidence-audit.md:116,281` «поверх скопировано рабочее дерево» параллельной сессии MW-007 ⇒ эта копия рабочего дерева больше нигде не существует.
- `.dsh/skills/{context-economy,evidence-gated-delivery,isolation-and-deletion-safety,session-skill-forge}` — вне git, нет в профиле, нет и в `.rar`; `.beads/embeddeddolt/mw/.dolt/**` + `.beads/backup/*.darc` — данные доски, вне git, в `.rar` отсутствуют.
- `.tmp/msg-{1..4}-*.txt` (77–652 B) — только в `.rar`, в `.work` не цитируются; `.analysis/{HUMAN-TURNS.md,retired/**,report-*.md}` — вне git, в `.rar` только версия 18.09.
- Грязные файлы worktree (3 + 30 + 2) — вне git; уникальны, пока не снят `git diff`. Секретов и чужих репозиториев не найдено (п. 8).

## Безопасные команды (только с префильтром-проверкой)
```powershell
# П0. Координаты (read-only): корень репозитория, чистое дерево, известные регистрации worktree
$root=(Resolve-Path 'H:\Repo\DSH-MyWork').Path; if(-not(Test-Path "$root\.git")){throw 'not repo root'}; git -C $root worktree list; git -C $root status --porcelain
# П1. Пустые каталоги: LiteralPath и только после проверки на пустоту
foreach($d in '.tmp\beads-probe','.tmp\pnpm-temp','.tmp\test-tmp'){ if((Get-ChildItem "$root\$d" -Recurse -Force|Measure-Object).Count -ne 0){throw "не пусто: $d"}; Remove-Item -LiteralPath "$root\$d" -Force }
# П2. Мёртвые скаффолды: 0 реальных файлов, только битые junction (rmdir сносит ссылку, не цель)
foreach($d in '.tmp\mw004-verify','.tmp\mw010-head-verify'){ if((Get-ChildItem "$root\$d" -Recurse -Force -File|?{-not($_.Attributes -band [IO.FileAttributes]::ReparsePoint)}|Measure-Object).Count -ne 0){throw "есть реальные файлы: $d"}; cmd /c rmdir /s /q "$root\$d" }
# П3. node_modules двух worktree (105.6 MB) — только если сами worktree решено сохранить; откат = pnpm install --frozen-lockfile
Test-Path "$root\.tmp\f-audit\pnpm-lock.yaml"; cmd /c rmdir /s /q "$root\.tmp\f-audit\node_modules"; cmd /c rmdir /s /q "$root\.tmp\mw012-review\node_modules"
# П4. Worktree — только через git: штатный remove сам откажет на грязном дереве (отказ и есть префильтр)
git -C "$root\.tmp\mw012-review" diff > "$root\.tmp\plan-v03-lead\mw012-review-dirty.patch"; git worktree remove ".tmp\mw012-review"   # --force и prune — только по явному решению владельца
# П5. Перед удалением .rar вынуть уникальное; распаковка ВНЕ репозитория
7z x DSH-MyWork.rar -o"$env:TEMP\dsh-mw-rar" ".tmp/msg-*.txt" ".tmp/mw008-verify/packages/*/src/*"
```

## Чего делать нельзя
- `Remove-Item -Recurse -Force` по `.tmp\v2-boundary-demo`, `.tmp\mw014-review`, `.tmp\mw012-mine`: внутри 21 junction в `node_modules`, `packages/*/lib`, `packages/{contracts,core,scheduler}`, `tests/lib` живого дерева; на `powershell.exe` 5.1 рекурсия уходит в цель и сносит её (п. 4).
- `Remove-Item -Recurse -Force` по `$root\.tmp`, по маске, по переменной, из вычисленного пути — это класс инцидента «снесли HOME».
- `git clean -xdf`/`-xdfd` где угодно: снесёт `.work`, `.analysis`, `.dsh`, `.beads`, `.tmp` — все вне git (`.gitignore:1-5`, `.git/info/exclude:9`).
- `git worktree remove --force`, `git worktree prune` до решения владельца: 30 + 3 + 2 незакоммиченных файла.
- Любая запись или удаление в `.beads` (+ `.beads.gate.lock`, `embeddeddolt`), `.dsh/skills`, `.analysis/retired`, `.tmp/plan-v03-*`; удаление `.rar` до П5; любые удаления в `.tmp`, пока идёт запись.

## Не проверено
- Содержимое `.rar` не читалось (только листинг `7z l`) ⇒ «в `mw008-verify` лежала незакоммиченная копия MW-007» опирается на `MW-008-evidence-audit.md`, а не на глаза.
- `*.bak`/`*-backup`/`*-snap` не сравнивались с git HEAD по хэшу (класс «требует решения» выставлен по имени и дате).
- Внутренности `.git` (loose vs packed, reflog, целостность объектов) не аудировались; проверено только `git for-each-ref` → 9 refs (2 codex + 4 dsh-turn-rewind).
- Поведение `Remove-Item -Recurse` на junction не проверялось экспериментально (ничего не удалялось) — рекомендация `cmd /c rmdir /s /q` основана на известном различии pwsh 7 и powershell.exe 5.1.
- Ссылки `.work` на отсутствующие `.tmp`-пути не сверялись построчно: подтверждён только факт 41 отсутствующего имени из 116.
