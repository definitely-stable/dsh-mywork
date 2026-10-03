# foundation-57 — `auto-review` активен → правило «только deny» (F-57, D15, R-22)

База: `c895070` (F-56). Изменённые файлы: `packages/core/src/review.ts` (добавлен блок правила и
импорт `CardCommand`/`HumanGate`), `packages/core/src/index.ts` (добавлен один блок
`export { … } from './review.ts'`), `tests/auto-review-deny-only.test.mjs` (создан).

## Шаг 0: точка, где MyWork получает решение review

| `файл:строка` | Что там |
|---|---|
| `packages/core/src/review.ts:192` | `export function transitionReview(review, command, meta)` — **точка входа** решения: сюда приходит вердикт обзорного слоя как `command.to` |
| `packages/core/src/review.ts:209` | `if (command.to === 'approved') {` — **ветка, превращающая вердикт в одобрение**; это и есть решение, которое F-57 ограничивает |
| `packages/core/src/review.ts:210` | `const approval = assertApprovable(review, command, meta)` — проверки одобрения (независимость, read-only, артефакт) |
| `packages/core/src/review.ts:322` | `AUTO_REVIEW_COMMANDS` — единственная команда аппрувера |
| `packages/core/src/review.ts:350` | `AUTO_REVIEW_ESCALATION_GATE: HumanGate = 'security-change'` |
| `packages/core/src/review.ts:385` | `ruleOnAutoReview(request)` — вердикт → правило |
| `packages/core/src/review.ts:413` | `assertAutoReviewCommand(command, meta)` — типизированный отказ |

Найдено так: `Select-String -Path packages\**\src\*.ts -Pattern 'review|approve|allow'` → 715
совпадений в `src`; из них точка решения — `transitionReview` (единственный вход состояний
review) и его ветка `approved`.

## Базовая линия и исправляемый дефект R-22

**`auto-review` СМОНТИРОВАН И АКТИВЕН** в живом профиле: `enabled: true`, `fiberPhase: active`
(`20-STEPS-foundation.md:1569`, факт 1 шага F-57). Пакет — `@deepseek-ai/dsh-experimental-auto-review`
**0.1.7-rc.2**, `packages/experimental/auto-review/`, есть `cordis.patch.yml` и `src/`.

Формулировки «по умолчанию выключен» и «в профиле нет строки auto-review» **неверны** (они и были
дефектом R-22 в базовой линии). Поэтому **отсутствие плагина не является защитой**: правило обязано
работать при активном аппрувере, и тест 3 проверяет это явно — правило не ветвится на наличие
плагина.

Live-профиль `C:\Users\Dmitry\.dsh` в этой кампании **не читался** (граница шага); строка выше —
цитата проверенного факта плана, а не моё измерение.

## Решения, которые аппрувер может вернуть

| Источник | Возможные ответы |
|---|---|
| DSH `packages/experimental/auto-review/src/index.ts:65-67` (цитата из `evidence/foundation-16-tools-restrict.md:11`) | `{risk:'low', decision:'allow'}` · `{risk:'medium', decision:'allow'}` · `{risk:'medium'│'high', decision:'deny', reason?}` |
| Словарь MyWork для аппрувера (`review.ts:322`) | ровно одна команда: `review.request-changes` |
| Правило MyWork (`review.ts:385`) | `deny` → `{kind:'denied'}`; `allow`/`approve`/`approved` → `{kind:'human-decision-required', gate:'security-change'}`; **любой другой ответ** (пустой, `'yes'`, `'ALLOW'`, число, объект, массив) → `{kind:'denied'}` |

Разрешающей ветки нет вообще: `AUTO_REVIEW_RULING_KINDS = ['denied', 'human-decision-required']`
(`review.ts:340`), и тест сверяет этот набор с литералами.

## Почему эскалация, а не молчаливый отказ

D15: «`auto-review` **только deny**» — LLM-аппрувер не может разрешить действие. Ответ `allow`
означал бы эскалацию режима **без человека**, а режим — закрытый union из трёх значений
(`DSH:packages/sandbox/sandbox-policy/src/index.ts:90-94`: `read-only`, `workspace-write`,
`danger-full-access`), то есть «разрешающая» ветка review повышала бы его молча. Поэтому `allow`
превращается в **требование человеческого решения** и несёт §28-гейт: единственное, что человек
может решить здесь, — разрешить то, на что аппрувер не имеет полномочий.

**Граница с D14 (записана, не замаскирована).** `HumanDecision` — durable-сущность D14, и её в
репозитории **нет**: `git grep -n HumanDecision HEAD -- packages` → **0 совпадений** (exit 1).
Это работа stage-4 (MW-030/E-52), и F-57 её не изобретает. «Эскалация к человеку» выражена тем
словарём, который существует: явный типизированный исход `human-decision-required` плюс
`HumanGate` (`packages/contracts/src/security.ts:171-190`). Когда D14 появится, решение человека
понесёт этот же гейт; сегодня гейт — не заглушка, а единственная существующая форма «это решает
человек».

## Команды и наблюдения

| Команда | exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/auto-review-deny-only.test.mjs` (до реализации) | 1 | красный: `TypeError: core.ruleOnAutoReview is not a function`, `tests 3 / pass 0 / fail 3` |
| `corepack pnpm --filter @dsh-mywork/core run typecheck` | 0 | ошибок нет |
| `corepack pnpm --filter @dsh-mywork/core run build` (под `.tmp/build.lock`) | 0 | `✔ Build complete in 16332ms` |
| `node --test --test-isolation=none tests/auto-review-deny-only.test.mjs` (после) | 0 | `tests 3 / pass 3 / fail 0 / cancelled 0`, `duration_ms 23.71` |
| гейт: `git grep -n "kind: 'allowed'" -- packages` | 1 | **0 совпадений** на пути review (до шага было тоже 0 — гейт подтверждает, что правило не внесло разрешающей ветки) |
| `git grep -n HumanDecision HEAD -- packages` | 1 | **0 совпадений** — сущности D14 в репозитории нет |
| `git grep -c "auto-review" HEAD -- packages` | 1 | **0 совпадений** — правило новое, дубля нет |
| Мутация M1 в собранном `lib/index.js`: `kind: "human-decision-required"` → `kind: "allowed"` | 1 | `pass 0 / fail 3`; тест 1 упал на `Expected "actual" to be strictly unequal to` |
| Мутация M2 там же: условие `assertAutoReviewCommand` → `if (true)` | 1 | тот же прогон; тест 2 упал на `"review.approve" must be refused` |
| Мутация M3 там же: `ruleOnAutoReview` ветвится на `request.autoReviewActive === false` | 1 | `pass 2 / fail 1`; упал именно тест 3: `deny: the ruling must not depend on the composition` |
| Восстановление бандла из копии, SHA256 до/после | 0 | `PRISTINE = RESTORED = F290A5387C48266F37F26D5F982DC7A13873DDA6E19E80F1EAD65C1E86695B48`; повторный прогон `pass 3 / fail 0` |

Вывод после реализации:

```
✔ an approving verdict never raises the mode (1.2085ms)
✔ the automatic approver holds only review.request-changes (0.3289ms)
✔ the rule holds with the approver mounted and with it absent (0.213ms)
ℹ tests 3 / ℹ pass 3 / ℹ fail 0
```

## Что не сделано

- `auto-review` **не выключался** конфигурацией профиля: это действие человека над живым профилем и
  вне границ кампании (прямой запрет шага F-57).
- Живой профиль не менялся и не читался.
- Плагин не патчился и не оборачивался: правило живёт в MyWork, как требует D15.
- **Вызовы не подключены.** Инвариант и его тесты — здесь; подключение на путях исполнения владеют
  `plan-execution` (E-40) и `card-ledger` (MW-069) — раздел «Стык» шага F-57
  (`20-STEPS-foundation.md:1586`) прямо говорит, что там вызовы и приёмки, а здесь фиксируется
  инвариант. `transitionReview` не изменён: новая ветка в нём была бы правкой поведения, которой
  шаг не требует, и её приёмка принадлежит E-40.
- D14 не реализован и не подменён: `HumanDecision` не изобретался ни как тип, ни как заглушка.

## Процессная заметка: строка barrel'а уехала в чужой коммит

`packages/core/src/index.ts` — общий barrel (правило «один писатель», task-2/budget). Мой блок
`export { … } from './review.ts'` лежал в рабочем дереве некоммитнутым, и коммит соседа
`88ea6f9 feat(core): break the agent cycle on its own step ceiling` застейджил файл целиком —
строка попала в его коммит. Проверено:

```
git log --oneline -S "AUTO_REVIEW_COMMANDS" -- packages/core/src/index.ts
→ 88ea6f9 feat(core): break the agent cycle on its own step ceiling
```

Содержимое верное (`packages/core/src/index.ts:234-245` в `88ea6f9`), коммит F-57
(`28793b3`) несёт `review.ts` и тест. Отдельного коммита под строку barrel'а не делалось: она уже
в истории, и переписывать чужой коммит нельзя. Для F-56 той же коллизии удалось избежать — его
строка barrel'а закоммичена своим коммитом `c895070` через явный blob
(`git update-index --cacheinfo`), чтобы не утащить чужой незакоммиченный блок.
