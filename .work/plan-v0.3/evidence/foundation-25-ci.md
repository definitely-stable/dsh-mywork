# F-25 · Минимальный CI: три джобы, два разных гейта, тег `v0.1.0-m1`

**Статус: READY_FOR_REVIEW (локально) / НЕ ПРОВЕРЕНО В CI.** Workflow создан и разобран парсером; `MYWORK_REQUIRE_BEADS=1` проставлен по заявке потока beads. **Джоба `beads-backend` при первом прогоне будет красной** — см. раздел «Обнаруженный дефект backend'а»: это зафиксировано как находка, а не замалчено (дефект R-21).

## Изменённые пути

- Create `.github/workflows/ci.yml` — три джобы, все `runs-on: windows-latest`.
- Тег `v0.1.0-m1` **не создавался** — по границам задачи его ставит Lead. `git tag --list` → 0 тегов.

## Разделение гейтов (исправление R-21)

| Джоба | Гейт | Что нужно | Шаги |
|---|---|---|---|
| `build-test` | **L** (локальный) | ничего, кроме Node | `corepack enable` → `corepack pnpm install --frozen-lockfile` → `pnpm -r run typecheck` → `pnpm -r run build` → `node scripts/smoke.mjs` → `node --test --test-isolation=none "tests/**/*.test.mjs"` |
| `beads-backend` | отдельный | установка Beads 1.3.0 | `npm install -g @beads/bd@1.3.0` → `bd --version` → `MYWORK_REQUIRE_BEADS=1 node --test … tests/beads-adapter.test.mjs` |
| `profile` | **P** (профиль) | CLI `dsh` | `npm install -g @deepseek-ai/dsh@0.1.7-rc.2` → `dsh --version` → `node scripts/pack.mjs` → `node scripts/verify-profile.mjs --dsh-bin dsh`; `needs: build-test` |

«Не удалось поставить backend» и «backend сломан» различимы: падение шага `Install Beads` — это первое, падение теста — второе.

`--frozen-lockfile` **добавлен**, потому что условие плана выполнено: `git status --porcelain pnpm-lock.yaml` → пусто, то есть F-11 закрыт и лок-файл чист. До этого шаг добавлять было запрещено (ложная диагностика на рассинхроне).

## Таблица «команда → exit code → наблюдение»

| Команда | exit code | Наблюдение |
|---|---|---|
| `Test-Path .github` (**до**) | 0 | `False` — каталога не было |
| `node -e "…('yaml').parse('.github/workflows/ci.yml')"` | **0** | `PARSE_OK name=ci`; `JOBS=build-test,beads-backend,profile`; у всех `runs-on=windows-latest`; `profile: needs=build-test`; шагов 8/7/9 |
| разбор `env` джобы beads | 0 | `BEADS_ENV={"MYWORK_REQUIRE_BEADS":"1"}` |
| `where.exe bd` | 0 | `C:\Users\Dmitry\AppData\Roaming\npm\bd`, `bd.cmd` |
| `bd --version` | 0 | `bd version 1.3.0 (f45b249ce)` |
| `npm ls -g --depth=0` | 0 | `@beads/bd@1.3.0` — имя пакета для CI подтверждено, а не угадано |
| `Get-Content …\npm\bd.cmd` | 0 | ссылается на `node_modules\@beads\bd\bin\bd.js` — то же имя пакета |
| `git status --porcelain pnpm-lock.yaml` | 0 | пусто ⇒ `--frozen-lockfile` безопасен |
| `git tag --list` | 0 | 0 тегов; `v0.1.0-m1` отсутствует (ожидаемо — тег ставит Lead) |
| `where.exe dsh` | 0 | `C:\Users\Dmitry\.dsh\bin\dsh.cmd` — CLI на машине есть |
| `dsh --version` | 0 | `dsh-guard: skipped (help/version)` — шим перехватывает version-вызовы, поэтому гейт P локально **не** прогонялся |
| `MYWORK_REQUIRE_BEADS=1 node --test … tests/beads-adapter.test.mjs` | **1** | `ℹ tests 72 / ℹ pass 71 / ℹ fail 1 / ℹ skipped 0` — см. ниже |

### Гейт P в CI вакуумен по хэшам — это записано в самом workflow

`scripts/verify-profile.mjs:5-10` хэширует манифесты **реального** профиля (`$env:USERPROFILE\.dsh`) до и после прогона. На чистом раннере этого каталога нет, поэтому половина «хэши не изменились» **вакуумна**. Доказательством является только строка `verify:profile: PASS` (tarball поставился и плагин смонтировался в изолированном `DSH_HOME`). Это вписано комментарием в шаг workflow, чтобы следующая правка не приняла вакуум за доказательство.

## Обнаруженный дефект backend'а (находка, не замалчивание)

Строгий локальный прогон **не** скрыл проблему — он её вскрыл, и это ровно то, ради чего F-17 существует:

```
✖ a heartbeat refreshes a held claim and reclaim reverts a stale one (real bd) (13691.4554ms)
  AssertionError [ERR_ASSERTION]: Got unwanted rejection.
  Actual message: "dsh-mywork: bd heartbeat mw-u1q failed (exit 1)"
  at tests\beads-adapter.test.mjs:1429:1
ℹ tests 72 / pass 71 / fail 1 / skipped 0   duration_ms 249062
```

- **Механизм F-17 работает:** `skipped 0` вместо 23 молчаливых пропусков, прогон даёт 72 теста вместо 49 значимых.
- **За этим скрывался настоящий отказ** `bd heartbeat` (exit 1) на реальном Beads 1.3.0. Это дефект потока beads (F-14…F-17), а не CI-файла.
- Пока он не исправлен, джоба `beads-backend` будет красной. Это ожидаемое и правильное поведение: гейт должен быть красным, если контракт backend'а нарушен.
- Расхождение с планом: план ожидал `# pass 70`; фактически **72 теста, 71 pass, 1 fail**. Записано фактическое число (шаг F-17 прямо требовал «проверить фактически»).

## Ограничения

- **CI на GitHub не запускался** — workflow ни разу не исполнялся в раннере. Все утверждения о CI-джобах получены разбором YAML и локальными прогонами отдельных шагов, а не наблюдением зелёного/красного CI.
- Гейт L целиком локально **не прогонялся**: это гейт Lead'а (§5.4 брифа), и repo-wide команды в этом заходе запускать было запрещено.
- Гейт P локально не прогонялся: `verify-profile.mjs` требует сборку (`pnpm run build`), а сборка не моя; плюс `dsh --version` перехвачен `dsh-guard`.
- Тег `v0.1.0-m1` не создан (границы задачи).

## Что НЕ проверено

- Не проверено, что `npm install -g @beads/bd@1.3.0` и `@deepseek-ai/dsh@0.1.7-rc.2` ставятся в раннере (сеть/кэш/доступность версии в реестре не проверялись).
- Не проверено, что `corepack enable` в windows-latest даёт ту же версию pnpm, что локально (12.4.2).
- Не проверено поведение тестов с `--test-isolation=none` в CI при параллельной записи в SQLite (риск P14, отмеченный планом как диагностический для первого прогона).

## Поправка Lead'а (после закрытия потока beads)

Строки выше с `fail 1` — **снимок промежуточного состояния**: в момент замера поток beads (F-22) ещё правил `heartbeat`, и `bd heartbeat` без актора действительно отказывал (`issue already claimed by worker-a`). На замороженном дереве (`07e6850`, тег `v0.1.0-m1`) гейт F-27 проходит:

```text
MYWORK_REQUIRE_BEADS=1 node --test --test-isolation=none tests/beads-adapter.test.mjs
  → tests 72 / pass 72 / fail 0 / skipped 0 , exit 0
```

Проверено дважды и независимо: потоком beads и Lead'ом (`foundation-stage1-gate.md` §2), плюс независимым ревьюером этапа 1. Число тестов в CI-джобе `beads-backend` следует ожидать `72 / pass 72 / fail 0` (не 70, как в плане: два теста добавлены потоком).
- Не проверялось, зелёный ли `build-test` в CI: локально отдельные его шаги не запускались (repo-wide typecheck/build — за Lead).
