# F-16 · Тест `beads-adapter`: честная проба и удаление ложного EPERM-текста

**Статус: READY_FOR_REVIEW**

## Что сделано

1. Из `tests/beads-adapter.test.mjs` удалено утверждение, что пропуск вызван «DSH file sandbox → EPERM на piped stdio»: проба через `spawnSync('bd', …, { shell: false })` на Windows даёт **ENOENT (-4058)**, а не EPERM.
2. Сообщение о пропуске теперь строится из фактического результата пробы (`describeBeadsProbe`): называет `reason`, `code`, `errno`, текст ошибки и команду установки.
3. Добавлен тест «a skip notice names the failure that actually happened, never a guessed cause» — подаёт фейковый результат пробы и требует `ENOENT`/`-4058`/команду установки и **отсутствие** `EPERM`.
4. Проба переведена на общий `probeBeads` (F-15), то есть тест и Doctor задают один вопрос одной функцией.

## Изменённые пути

- Modify `tests/beads-adapter.test.mjs` (блок пробы и сообщения; новый тест в секции «§0 The seam»)

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node -e "spawnSync('bd',['version'],{shell:false})"` | 0 (probe) | `status=null err=ENOENT errno=-4058` — фактическая причина пропуска на этой машине |
| `node --test --test-isolation=none tests/beads-adapter.test.mjs 2>&1 \| Select-String 'EPERM'` | **0** | **0 совпадений в выводе прогона** (`EPERM_MATCHES=0`) при `ℹ tests 72 / ℹ pass 72 / ℹ fail 0 / ℹ skipped 0` — **гейт F-16** |
| `node --test --test-isolation=none tests/beads-adapter.test.mjs` (без переменной, `bd` есть) | 0 | `ℹ tests 72 / ℹ pass 72 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0`; предупреждение о пропуске в `stderr` не печатается, потому что пропусков нет |
| `node --test --test-isolation=none --test-name-pattern='skip notice' tests/beads-adapter.test.mjs` | 0 | `✔ a skip notice names the failure that actually happened, never a guessed cause` |
| Текст сообщения (собирается из `describeBeadsProbe`) | — | `bd is unavailable: spawn-failed (code=ENOENT errno=-4058); spawn bd ENOENT; install Beads 1.3.0 with "npm install -g @beads/bd@1.3.0" and check \`bd version\`` |
| `Select-String -LiteralPath tests\beads-adapter.test.mjs -Pattern 'EPERM'` | 0 | **3** совпадения в исходнике, и ни одно не является утверждением о причине: `:98` и `:129` — комментарии (история дефекта), `:140` — `assert.doesNotMatch(text, /EPERM/)`, то есть guard нового теста. Гейт F-16 считает совпадения в **выводе прогона**, а не в исходнике |

## Ограничения

- Утверждение про sandbox **не заменено другим утверждением о причине**: сообщение печатает то, что реально вернула проба. Если однажды причиной станет EPERM, сообщение назовёт EPERM — но не раньше.
- Текст остаётся в `stderr` (как и было): это предупреждение о пропуске, а не падение; падение включает F-17.

## Что НЕ проверено

- Поведение под настоящим sandbox-шеллом DSH (сессия работает в `danger-full-access`, поэтому EPERM-путь не воспроизводился).
